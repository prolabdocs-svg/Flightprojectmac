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
import { AeroModel, type SurfaceDeflections, type Slipstream } from '../aero/aeroModel';
import { sampleAtmosphere, type AtmosphereSample } from '../atmosphere/atmosphere';
import type { AircraftDefinition } from '../aircraft/aircraftDefinition';
import { computeMassProperties, principalAxes, type Mat3, type MassProperties } from '../aircraft/massModel';

export type { SurfaceDeflections, Slipstream };

const MAX_ANGULAR_RATE = 25; // rad/s: defensive numerical guard, never expected in normal flight
const MAX_SPEED = 120; // m/s

export class AircraftPhysics {
  readonly world: RAPIER.World;
  readonly body: RAPIER.RigidBody;
  readonly def: AircraftDefinition;
  readonly aero: AeroModel;
  readonly frame = new BodyFrame();
  readonly atmosphere: AtmosphereSample = { temperatureK: 288.15, pressurePa: 101325, densityKgM3: 1.225 };
  mass!: MassProperties;
  fuelL: number;
  /** Test hook: scales air density (0 = vacuum) to verify torque-free rigid-body motion. */
  densityScale = 1;
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
  /** Aerodynamic-only force/moment of the last computeAero() (body axes), for lift/drag telemetry. */
  readonly aeroForce = new THREE.Vector3();
  readonly forceBody = new THREE.Vector3();
  readonly momentBody = new THREE.Vector3();
  /** Loads already expressed in world axes (ground contact); folded in at integrate(). */
  readonly forceWorld = new THREE.Vector3();
  readonly momentWorld = new THREE.Vector3();
  heightAglM = 100;
  airspeedMs = 0;
  alphaRad = 0;
  betaRad = 0;
  liftBodyN = 0;
  dragBodyN = 0;

  private readonly aeroInput = { rho: 1.225, velBody: this.velBody, wBody: this.wBody, windBody: this.windBody, upBody: this.upBody, heightAglM: 100, cg: [0, 0, 0] as Vec3, densityScale: 1 };
  private readonly terrainHeight: (x: number, z: number) => number;
  private readonly tmpA = new THREE.Vector3();
  private readonly tmpB = new THREE.Vector3();
  private readonly tmpF = new THREE.Vector3();
  private readonly tmpM = new THREE.Vector3();
  private readonly tmpR = new THREE.Vector3();
  private readonly inertia: Mat3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];
  private lastFuelForMass = -1;

  constructor(world: RAPIER.World, def: AircraftDefinition, terrainHeight: (x: number, z: number) => number = () => 0) {
    this.world = world;
    this.def = def;
    this.terrainHeight = terrainHeight;
    this.fuelL = def.mass.fuelCapacityL;
    world.timestep = PHYSICS_DT;

    this.aero = new AeroModel(def);

    this.body = world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic().setLinearDamping(0).setAngularDamping(0).setCanSleep(false).setCcdEnabled(false),
    );
    // Mass properties are authored (setAdditionalMassProperties); the collider only exists so the
    // body is a valid Rapier body and contributes zero mass.
    world.createCollider(RAPIER.ColliderDesc.ball(0.3).setDensity(0), this.body);
    this.refreshMass(true);
  }

  get elements() { return this.aero.elements; }
  get bluff() { return this.aero.bluff; }
  get results() { return this.aero.results; }
  get bluffResults() { return this.aero.bluffResults; }
  get ctx() { return this.aero.ctx; }
  get wingCl() { return this.aero.wingCl; }
  get stallMarginRad() { return this.aero.stallMarginRad; }

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
    this.aero.setCg(cg);
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
    this.forceWorld.set(0, 0, 0);
    this.momentWorld.set(0, 0, 0);
  }

  /** Step 2: all aerodynamic elements. Adds to forceBody/momentBody. */
  computeAero(surf: SurfaceDeflections, slip: Slipstream | null, effectiveness: (damageId: string) => number): void {
    this.aeroInput.rho = this.atmosphere.densityKgM3;
    this.aeroInput.heightAglM = this.heightAglM;
    this.aeroInput.cg = this.mass.cg;
    this.aeroInput.densityScale = this.densityScale;
    this.aero.compute(this.aeroInput, surf, slip, effectiveness);
    this.forceBody.add(this.aero.force);
    this.momentBody.add(this.aero.moment);
    this.aeroForce.copy(this.aero.force);
    this.liftBodyN = this.aero.liftSumN;
    this.dragBodyN = this.aero.dragSumN;
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

  /** Adds a world-axes force acting at world point `p` (moment about the CG is derived). */
  addWorldForceAtPoint(f: THREE.Vector3, p: THREE.Vector3): void {
    this.forceWorld.add(f);
    this.tmpR.copy(p).sub(this.cgWorld);
    this.momentWorld.add(this.tmpB.copy(this.tmpR).cross(f));
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

    this.frame.toWorld(this.forceBody, this.tmpF).add(this.forceWorld);
    this.frame.toWorld(this.momentBody, this.tmpM).add(this.momentWorld);
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
