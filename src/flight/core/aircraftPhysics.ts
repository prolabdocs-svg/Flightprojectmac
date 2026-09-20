// 6-DOF rigid-body aircraft (spec sections 4, 7). Rapier owns the integration; this class owns
// what acts on the body: it turns aerodynamic elements + extra loads into ONE force and ONE
// torque about the CG per tick (exactly equivalent to per-element addForceAtPoint, but two WASM
// calls instead of dozens) and adds the gyroscopic term Rapier does not integrate:
//     I w_dot = M - w x (I w)
// Nothing in here writes position, orientation or velocity to steer the aircraft.
//
// Tick protocol (called by FlightSimulation):
//   readState() -> [compute loads] -> addBodyLoad()/addWorldForceAtPoint() -> integrate()

import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { PHYSICS_DT } from './constants';
import { BodyFrame, angleOfAttack, pointVelocityBody, sideslip, type Vec3 } from './coordinates';
import { getAirfoilTable, type AirfoilTable } from '../aero/airfoil';
import { AeroContext, AeroElement, BluffBody, newElementResult, type ElementResult } from '../aero/aeroElement';
import { groundInducedFactor, groundLiftGain } from '../aero/groundEffect';
import { sampleAtmosphere, type AtmosphereSample } from '../atmosphere/atmosphere';
import type { AircraftDefinition } from '../aircraft/aircraftDefinition';
import { computeMassProperties, principalAxes, type Mat3, type MassProperties } from '../aircraft/massModel';

/** Deflections in the lift-positive sense (see coordinates.ts), radians. */
export interface SurfaceDeflections {
  elevator: number;
  aileronLeft: number;
  aileronRight: number;
  rudder: number;
}

/** Slipstream state handed to the aero elements. */
export interface Slipstream {
  axialMs: number;
  swirl: number;
  discRadiusM: number;
  discCentreY: number;
}

const MAX_ANGULAR_RATE = 25; // rad/s: defensive numerical guard, never expected in normal flight
const MAX_SPEED = 120; // m/s

export class AircraftPhysics {
  readonly world: RAPIER.World;
  readonly body: RAPIER.RigidBody;
  readonly def: AircraftDefinition;
  readonly elements: AeroElement[] = [];
  readonly bluff: BluffBody[] = [];
  readonly results: ElementResult[] = [];
  readonly bluffResults: ElementResult[] = [];
  readonly frame = new BodyFrame();
  readonly ctx = new AeroContext();
  readonly atmosphere: AtmosphereSample = { temperatureK: 288.15, pressurePa: 101325, densityKgM3: 1.225 };
  mass!: MassProperties;
  fuelL: number;
  /** Counters for the numerical safety nets; must stay 0 in every automated flight test. */
  guardEvents = { angularRate: 0, speed: 0, nonFinite: 0 };

  // Per-tick state (world unless noted).
  readonly pos = new THREE.Vector3();
  readonly cgWorld = new THREE.Vector3();
  readonly velWorld = new THREE.Vector3();
  readonly wWorld = new THREE.Vector3();
  readonly velBody = new THREE.Vector3();
  readonly wBody = new THREE.Vector3();
  readonly windBody = new THREE.Vector3();
  readonly airBody = new THREE.Vector3(); // velocity relative to the air, at the CG, body axes
  readonly upBody = new THREE.Vector3();
  readonly forceBody = new THREE.Vector3();
  readonly momentBody = new THREE.Vector3();
  heightAglM = 100;
  airspeedMs = 0;
  alphaRad = 0;
  betaRad = 0;
  wingCl = 0;
  liftBodyN = 0;
  dragBodyN = 0;

  private readonly terrainHeight: (x: number, z: number) => number;
  private readonly tmpA = new THREE.Vector3();
  private readonly tmpB = new THREE.Vector3();
  private readonly tmpF = new THREE.Vector3();
  private readonly tmpM = new THREE.Vector3();
  private readonly tmpR = new THREE.Vector3();
  private readonly inertia: Mat3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];
  private lastFuelForMass = -1;
  private readonly wingAc: Vec3;
  private readonly wingElementCount: number;

  constructor(world: RAPIER.World, def: AircraftDefinition, terrainHeight: (x: number, z: number) => number = () => 0) {
    this.world = world;
    this.def = def;
    this.terrainHeight = terrainHeight;
    this.fuelL = def.mass.fuelCapacityL;
    world.timestep = PHYSICS_DT;

    const tables: Record<string, AirfoilTable> = {
      wing: getAirfoilTable(def.aero.airfoils.wing),
      htail: getAirfoilTable(def.aero.airfoils.tail),
      vtail: getAirfoilTable(def.aero.airfoils.fin),
    };
    // Wings first: the tailplane needs the wing's CL for downwash.
    const ordered = [...def.aero.elements].sort((a, b) => (a.group === 'wing' ? 0 : 1) - (b.group === 'wing' ? 0 : 1));
    for (const spec of ordered) {
      this.elements.push(new AeroElement(spec, tables[spec.group]));
      this.results.push(newElementResult());
    }
    for (const b of def.aero.bluffBodies) {
      this.bluff.push(new BluffBody(b));
      this.bluffResults.push(newElementResult());
    }
    this.wingElementCount = this.elements.filter((e) => e.spec.group === 'wing').length;
    this.wingAc = def.geometry.wingAcPosition;

    this.body = world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic().setLinearDamping(0).setAngularDamping(0).setCanSleep(false).setCcdEnabled(false),
    );
    // Mass properties are authored (setAdditionalMassProperties); the collider only exists so the
    // body is a valid Rapier body and contributes zero mass.
    world.createCollider(RAPIER.ColliderDesc.ball(0.3).setDensity(0), this.body);
    this.refreshMass(true);
  }

  /** Recomputes mass/CG/inertia from the definition + current fuel and pushes it to Rapier. */
  refreshMass(force = false): void {
    if (!force && Math.abs(this.fuelL - this.lastFuelForMass) < 0.02) return;
    this.lastFuelForMass = this.fuelL;
    const d = this.def.mass;
    const items = [...d.items, { id: 'fuel', massKg: Math.max(0, this.fuelL) * d.fuelDensityKgL, position: d.fuelPosition, size: d.fuelSize }];
    this.mass = computeMassProperties(items);
    this.inertia.splice(0, 9, ...this.mass.inertia);
    const { moments, quaternion } = principalAxes(this.mass.inertia);
    const cg = this.mass.cg;
    this.body.setAdditionalMassProperties(
      this.mass.massKg,
      { x: cg[0], y: cg[1], z: cg[2] },
      { x: moments[0], y: moments[1], z: moments[2] },
      { x: quaternion[0], y: quaternion[1], z: quaternion[2], w: quaternion[3] },
      true,
    );
    for (const e of this.elements) e.setCg(cg);
    for (const b of this.bluff) b.setCg(cg);
  }

  /** Places the aircraft (spawn/reset only). `pos` is the model datum, not the CG. */
  place(pos: THREE.Vector3, quat: THREE.Quaternion, velWorld = new THREE.Vector3()): void {
    this.body.setTranslation(pos, true);
    this.body.setRotation(quat, true);
    this.body.setLinvel(velWorld, true);
    this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    this.body.resetForces(true);
    this.body.resetTorques(true);
  }

  /** Step 1: read Rapier state, environment and body-axes kinematics. */
  readState(windWorld: THREE.Vector3): void {
    this.body.resetForces(true);
    this.body.resetTorques(true);
    const t = this.body.translation();
    const r = this.body.rotation();
    const lv = this.body.linvel();
    const av = this.body.angvel();
    const cg = this.body.worldCom();
    this.pos.set(t.x, t.y, t.z);
    this.cgWorld.set(cg.x, cg.y, cg.z);
    this.velWorld.set(lv.x, lv.y, lv.z);
    this.wWorld.set(av.x, av.y, av.z);
    this.frame.set(r.x, r.y, r.z, r.w);
    this.frame.toBody(this.velWorld, this.velBody);
    this.frame.toBody(this.wWorld, this.wBody);
    this.frame.toBody(windWorld, this.windBody);
    this.upBody.set(0, 1, 0).applyQuaternion(this.frame.qInv);
    this.heightAglM = this.cgWorld.y - this.terrainHeight(this.cgWorld.x, this.cgWorld.z);
    sampleAtmosphere(this.cgWorld.y, this.atmosphere);
    this.airBody.copy(this.velBody).sub(this.windBody);
    this.airspeedMs = this.airBody.length();
    this.alphaRad = this.airspeedMs > 0.5 ? angleOfAttack(this.airBody) : 0;
    this.betaRad = this.airspeedMs > 0.5 ? sideslip(this.airBody) : 0;
    this.forceBody.set(0, 0, 0);
    this.momentBody.set(0, 0, 0);
  }

  /** Step 2: all aerodynamic elements. Adds to forceBody/momentBody. */
  computeAero(surf: SurfaceDeflections, slip: Slipstream | null, effectiveness: (damageId: string) => number): void {
    const c = this.ctx;
    c.rho = this.atmosphere.densityKgM3;
    c.vx = this.velBody.x; c.vy = this.velBody.y; c.vz = this.velBody.z;
    c.wx = this.wBody.x; c.wy = this.wBody.y; c.wz = this.wBody.z;
    c.windX = this.windBody.x; c.windY = this.windBody.y; c.windZ = this.windBody.z;
    c.upX = this.upBody.x; c.upY = this.upBody.y; c.upZ = this.upBody.z;
    c.cgHeightAglM = this.heightAglM;
    if (slip) {
      c.slipAxialMs = slip.axialMs; c.slipSwirl = slip.swirl; c.discRadiusM = slip.discRadiusM; c.discCentreY = slip.discCentreY;
    } else {
      c.slipAxialMs = 0;
    }
    // Ground effect from the height of the wing (not the CG): height of wing AC above ground.
    const cg = this.mass.cg;
    const wingRelUp = this.upBody.x * (this.wingAc[0] - cg[0]) + this.upBody.y * (this.wingAc[1] - cg[1]) + this.upBody.z * (this.wingAc[2] - cg[2]);
    const wingHeight = Math.max(0, this.heightAglM + wingRelUp);
    const phi = groundInducedFactor(wingHeight, this.def.geometry.wingspanM);
    c.groundInducedFactor = phi;
    c.groundLiftGain = groundLiftGain(phi);

    let clArea = 0;
    let wingArea = 0;
    let lift = 0;
    let drag = 0;
    for (let i = 0; i < this.elements.length; i++) {
      const el = this.elements[i];
      const s = el.spec;
      if (i === this.wingElementCount) {
        // Wings done: downwash angle at the tail, reduced near the ground (less downwash in ground effect).
        this.wingCl = wingArea > 0 ? clArea / wingArea : 0;
        c.downwashRad = ((2 * this.wingCl) / (Math.PI * this.def.geometry.wingspanM * this.def.geometry.wingspanM / this.def.geometry.wingAreaM2)) * phi;
      }
      el.effectiveness = effectiveness(s.damageId);
      el.deflectionRad = deflectionFor(s.control?.kind, s.outboard, surf);
      const r = el.compute(c, this.results[i]);
      this.forceBody.x += r.fx; this.forceBody.y += r.fy; this.forceBody.z += r.fz;
      this.momentBody.x += r.mx; this.momentBody.y += r.my; this.momentBody.z += r.mz;
      if (i < this.wingElementCount) {
        clArea += r.cl * s.areaM2;
        wingArea += s.areaM2;
      }
      lift += r.liftN;
      drag += r.dragN;
    }
    for (let i = 0; i < this.bluff.length; i++) {
      const r = this.bluff[i].compute(c, this.bluffResults[i]);
      this.forceBody.x += r.fx; this.forceBody.y += r.fy; this.forceBody.z += r.fz;
      this.momentBody.x += r.mx; this.momentBody.y += r.my; this.momentBody.z += r.mz;
      drag += r.dragN;
    }
    this.liftBodyN = lift;
    this.dragBodyN = drag;
  }

  /** Adds a force (body axes) applied at a body-fixed point `p` (datum coordinates) and an optional pure moment. */
  addBodyLoad(fx: number, fy: number, fz: number, p: Vec3 | null, mx = 0, my = 0, mz = 0): void {
    this.forceBody.x += fx; this.forceBody.y += fy; this.forceBody.z += fz;
    this.momentBody.x += mx; this.momentBody.y += my; this.momentBody.z += mz;
    if (p) {
      const cg = this.mass.cg;
      const rx = p[0] - cg[0]; const ry = p[1] - cg[1]; const rz = p[2] - cg[2];
      this.momentBody.x += ry * fz - rz * fy;
      this.momentBody.y += rz * fx - rx * fz;
      this.momentBody.z += rx * fy - ry * fx;
    }
  }

  /** Velocity of a body-fixed datum point through the ground frame, world axes (for wheels). */
  pointVelocityWorld(p: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 {
    this.tmpR.copy(p).sub(this.cgWorld);
    return out.copy(this.wWorld).cross(this.tmpR).add(this.velWorld);
  }

  /** World position of a body-fixed datum point. */
  pointWorld(p: Vec3, out: THREE.Vector3): THREE.Vector3 {
    return out.set(p[0], p[1], p[2]).applyQuaternion(this.frame.q).add(this.pos);
  }

  /** Step 3: apply body loads + gyroscopic term, integrate one fixed tick. `extraGyro` = propeller angular momentum (body). */
  integrate(propAngularMomentum: THREE.Vector3 | null = null): void {
    // Gyroscopic torque of the rigid body: -w x (I w); plus rotating prop: -w x L.
    const I = this.inertia;
    const w = this.wBody;
    this.tmpA.set(
      I[0] * w.x + I[1] * w.y + I[2] * w.z,
      I[3] * w.x + I[4] * w.y + I[5] * w.z,
      I[6] * w.x + I[7] * w.y + I[8] * w.z,
    );
    if (propAngularMomentum) this.tmpA.add(propAngularMomentum);
    this.tmpB.copy(w).cross(this.tmpA);
    this.momentBody.sub(this.tmpB);

    this.frame.toWorld(this.forceBody, this.tmpF);
    this.frame.toWorld(this.momentBody, this.tmpM);
    this.body.addForce(this.tmpF, true);
    this.body.addTorque(this.tmpM, true);
    this.world.step();
    this.guard();
  }

  /** Defensive numerical safety net (spec 26). Counts events so tests can prove it never fires. */
  private guard(): void {
    const t = this.body.translation();
    const lv = this.body.linvel();
    const av = this.body.angvel();
    if (!Number.isFinite(t.x + t.y + t.z + lv.x + lv.y + lv.z + av.x + av.y + av.z)) {
      this.guardEvents.nonFinite++;
      this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
      return;
    }
    const w = Math.hypot(av.x, av.y, av.z);
    if (w > MAX_ANGULAR_RATE) {
      this.guardEvents.angularRate++;
      const k = MAX_ANGULAR_RATE / w;
      this.body.setAngvel({ x: av.x * k, y: av.y * k, z: av.z * k }, true);
    }
    const v = Math.hypot(lv.x, lv.y, lv.z);
    if (v > MAX_SPEED) {
      this.guardEvents.speed++;
      const k = MAX_SPEED / v;
      this.body.setLinvel({ x: lv.x * k, y: lv.y * k, z: lv.z * k }, true);
    }
  }

  /** Velocity of a body-fixed point in BODY axes (debug/telemetry). */
  pointVelocityBodyAxes(r: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 {
    return pointVelocityBody(this.velBody, this.wBody, r, out);
  }
}

function deflectionFor(kind: string | undefined, outboard: number, s: SurfaceDeflections): number {
  switch (kind) {
    case 'elevator': return s.elevator;
    case 'rudder': return s.rudder;
    case 'aileron': return outboard > 0 ? s.aileronLeft : s.aileronRight;
    default: return 0;
  }
}
