// Core flight simulation (spec sections 8, 9, 34). One dynamic Rapier rigid body per
// aircraft; this layer applies aerodynamics, thrust, landing-gear and structural contact
// forces every fixed 60 Hz tick. Terrain is the analytic TerrainQueryService surface, so
// gear/hard-point contact, crash detection and AGL are resolved here explicitly. The Rapier
// heightfield is the same surface; only the tiny body collider (BODY_RADIUS_M) touches it.
//
// Handling model: control inputs command angular accelerations whose authority scales
// with dynamic pressure; aerodynamic damping and weathervane stability (AoA / sideslip)
// oppose them. The result is arcade-immediate response with real consequences: controls
// go mushy when slow, the wing stalls past its critical AoA and the nose drops, banked
// lift turns the aircraft, and the gear carries it on the ground.
//
// Axes (local): +Z nose, +Y up, +X LEFT wing. Rates: nose-up q = -wx, roll-right p = +wz,
// nose-right r = -wy.

import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import type { ResolvedAircraft } from '../content/assembly';
import { airDensityAtAltitude, groundEffectInducedDragFactor } from './aero';
import {
  applyGroundImpact,
  createDamageState,
  getAeroEffectivenessMultiplier,
  getGroundHandlingPenalty,
  listDamagedPartIds,
  listDetachedPartIds,
  gearPartId,
  type DamageState,
} from './damageSystem';
import { validateLanding, type LandingTelemetry, type RunwayConditions } from '../world/landingValidator';
import type { TerrainQueryService } from '../world/terrainQuery';
import { GROUND_SURFACES } from '../world/surfaces';
import { computeEngineRpm } from './engine';
import { compassBearingDeg } from '../world/compass';
import { pointInObstacle, type Obstacle } from '../world/obstacles';
import {
  GRAVITY,
  Q_REF,
  SEA_LEVEL_RHO,
  deriveFlightModel,
  dragCoefficient,
  liftCoefficient,
  stallAlpha,
  stallSpeed,
  thrustAt,
  type FlightModelSpec,
} from './flightModel';

// Shared flight types live in flight/flightTypes.ts (used by both the legacy and the new model).
export { DEFAULT_RUNWAY_CONDITIONS } from '../flight/flightTypes';
export type { FlightState, ResolvedControls, CrashReason, FlightTelemetry } from '../flight/flightTypes';
import { DEFAULT_RUNWAY_CONDITIONS, type FlightState, type ResolvedControls, type CrashReason, type FlightTelemetry } from '../flight/flightTypes';

const FIXED_DT = 1 / 60;
/** Minimum continuous airborne time / height before the flight counts as "has flown". */
const FLOWN_MIN_AIRBORNE_S = 1.2;
const FLOWN_MIN_HEIGHT_M = 2.5;
/** Ground speed under which a flown aircraft counts as stopped. */
const STOPPED_SPEED_MS = 1.2;
const STOPPED_HOLD_S = 0.6;

interface AssistTuning {
  authority: number;
  autoLevel: number;
  /** AoA protection gain (rad/s^2 per rad past the protection angle). */
  aoaProtection: number;
  bankLimitRad: number;
  pitchLimitRad: number;
  turnAssist: number;
  wingDrop: number;
}

// 'assisted' is the default for new players: gentle auto-level, soft bank/pitch limits and
// automatic back-pressure in turns. 'standard' and 'acro' remove the training wheels.
const ASSIST: Record<ResolvedControls['assistMode'], AssistTuning> = {
  assisted: { authority: 0.9, autoLevel: 2.6, aoaProtection: 40, bankLimitRad: (60 * Math.PI) / 180, pitchLimitRad: (40 * Math.PI) / 180, turnAssist: 1, wingDrop: 0.3 },
  standard: { authority: 1, autoLevel: 0, aoaProtection: 8, bankLimitRad: 0, pitchLimitRad: 0, turnAssist: 0.45, wingDrop: 0.7 },
  acro: { authority: 1.3, autoLevel: 0, aoaProtection: 0, bankLimitRad: 0, pitchLimitRad: 0, turnAssist: 0, wingDrop: 1 },
};

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const smoothSign = (v: number, width: number) => Math.tanh(v / width);

/** Body collider radius == the deep-penetration floor above terrain, so the Rapier heightfield
 * and the analytic floor clamp agree on where the CG stops. Gear/hard points engage far above. */
const BODY_RADIUS_M = 0.2;

export class FlightController {
  world: RAPIER.World;
  body: RAPIER.RigidBody;
  collider: RAPIER.Collider;
  aircraft: ResolvedAircraft;
  readonly spec: FlightModelSpec;
  readonly dtS = FIXED_DT;

  private readonly spawnXZ: [number, number];
  private readonly spawnHeadingDeg: number;
  private readonly terrainQuery: TerrainQueryService;
  private readonly runwayConditions: RunwayConditions;
  private readonly obstacles: Obstacle[];
  private readonly restHeightM: number;
  private readonly springK: [number, number, number];
  private readonly springC: [number, number, number];

  private throttleSmoothed = 0;
  private fuelL: number;
  private distanceM = 0;
  private maxAltitudeM = 0;
  private maxSpeedMs = 0;
  private state: FlightState = 'prestart';
  private crashed = false;
  private crashReason: CrashReason | null = null;
  private landed = false;
  private landingQuality = 0;
  private landingFailures: string[] = [];
  private elapsedS = 0;
  private rpm = 0;
  private damageState: DamageState;
  private hasFlown = false;
  private airborneS = 0;
  private stoppedS = 0;
  private wasOnGear = true;
  private wheelContacts = 0;
  private touchdown: LandingTelemetry | null = null;
  private lastTouchdownVsMs: number | null = null;
  private stallSide = 1;
  // Last-tick aero state for telemetry.
  private alpha = 0;
  private airspeed = 0;
  private gForce = 1;
  private stalled = false;
  private stallWarning = false;
  private chuteDamping = false;

  // Scratch objects (no per-tick allocation).
  private readonly q = new THREE.Quaternion();
  private readonly qInv = new THREE.Quaternion();
  private readonly pos = new THREE.Vector3();
  private readonly vel = new THREE.Vector3();
  private readonly angVel = new THREE.Vector3();
  private readonly fwd = new THREE.Vector3();
  private readonly up = new THREE.Vector3();
  private readonly left = new THREE.Vector3();
  private readonly air = new THREE.Vector3();
  private readonly airLocal = new THREE.Vector3();
  private readonly localW = new THREE.Vector3();
  private readonly force = new THREE.Vector3();
  private readonly torque = new THREE.Vector3();
  private readonly tmp = new THREE.Vector3();
  private readonly tmp2 = new THREE.Vector3();
  private readonly point = new THREE.Vector3();
  private readonly pointVel = new THREE.Vector3();
  private readonly normal = new THREE.Vector3();
  private readonly nonGravity = new THREE.Vector3();

  constructor(
    world: RAPIER.World,
    aircraft: ResolvedAircraft,
    spawnPos: THREE.Vector3,
    spawnHeadingDeg: number,
    terrainQuery: TerrainQueryService,
    runwayConditions: RunwayConditions = DEFAULT_RUNWAY_CONDITIONS,
    obstacles: Obstacle[] = [],
  ) {
    this.world = world;
    this.aircraft = aircraft;
    this.spec = deriveFlightModel(aircraft);
    this.spawnXZ = [spawnPos.x, spawnPos.z];
    this.spawnHeadingDeg = spawnHeadingDeg;
    this.terrainQuery = terrainQuery;
    this.runwayConditions = runwayConditions;
    this.obstacles = obstacles;
    this.fuelL = this.spec.fuelCapacityL;

    // Springs sized so the static load compresses each strut by staticCompressionM.
    const g = this.spec.gear;
    const noseZ = g.wheels[0][2];
    const mainZ = g.wheels[1][2];
    const noseShare = -mainZ / (noseZ - mainZ);
    const shares = [noseShare, (1 - noseShare) / 2, (1 - noseShare) / 2];
    this.springK = shares.map((s) => (s * this.spec.massKg * GRAVITY) / g.staticCompressionM) as [number, number, number];
    this.springC = shares.map((s, i) => 2 * 0.65 * Math.sqrt(this.springK[i] * s * this.spec.massKg)) as [number, number, number];
    this.restHeightM = -g.wheels[1][1] - g.staticCompressionM;

    const bodyDesc = RAPIER.RigidBodyDesc.dynamic()
      .setLinearDamping(0)
      .setAngularDamping(0)
      .setCanSleep(false)
      .setCcdEnabled(false);
    this.body = world.createRigidBody(bodyDesc);
    // Mass properties are authored; the collider only exists for the deep safety floor.
    this.collider = world.createCollider(RAPIER.ColliderDesc.ball(BODY_RADIUS_M).setDensity(0).setFriction(0.5), this.body);
    const [ip, iy, ir] = this.spec.inertia;
    this.body.setAdditionalMassProperties(this.spec.massKg, { x: 0, y: 0, z: 0 }, { x: ip, y: iy, z: ir }, { x: 0, y: 0, z: 0, w: 1 }, true);

    this.damageState = createDamageState(aircraft.aeroSurfaces.map((s) => s.id));
    this.placeAtSpawn();
  }

  getState() {
    return this.state;
  }

  private placeAtSpawn() {
    const [x, z] = this.spawnXZ;
    const y = this.terrainQuery.getElevation(x, z) + this.restHeightM;
    const quat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), (-this.spawnHeadingDeg * Math.PI) / 180);
    this.body.setTranslation({ x, y, z }, true);
    this.body.setRotation(quat, true);
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
  }

  reset() {
    this.placeAtSpawn();
    this.body.setLinearDamping(0);
    this.fuelL = this.spec.fuelCapacityL;
    this.distanceM = 0;
    this.maxAltitudeM = 0;
    this.maxSpeedMs = 0;
    this.state = 'prestart';
    this.crashed = false;
    this.crashReason = null;
    this.landed = false;
    this.landingQuality = 0;
    this.landingFailures = [];
    this.elapsedS = 0;
    this.throttleSmoothed = 0;
    this.hasFlown = false;
    this.airborneS = 0;
    this.stoppedS = 0;
    this.wasOnGear = true;
    this.touchdown = null;
    this.lastTouchdownVsMs = null;
    this.chuteDamping = false;
    this.damageState = createDamageState(this.aircraft.aeroSurfaces.map((s) => s.id));
  }

  /** Advances one fixed physics tick. Wind is a world-space m/s vector. */
  step(controls: ResolvedControls, windWorld: THREE.Vector3): FlightTelemetry {
    const dt = FIXED_DT;
    const spec = this.spec;
    this.elapsedS += dt;

    // Rapier accumulates user forces across steps in this binding; start every tick clean.
    this.body.resetForces(true);
    this.body.resetTorques(true);

    const t = this.body.translation();
    const r = this.body.rotation();
    const lv = this.body.linvel();
    const av = this.body.angvel();
    this.pos.set(t.x, t.y, t.z);
    this.q.set(r.x, r.y, r.z, r.w);
    this.qInv.copy(this.q).invert();
    this.vel.set(lv.x, lv.y, lv.z);
    this.angVel.set(av.x, av.y, av.z);
    this.fwd.set(0, 0, 1).applyQuaternion(this.q);
    this.up.set(0, 1, 0).applyQuaternion(this.q);
    this.left.set(1, 0, 0).applyQuaternion(this.q);
    this.nonGravity.set(0, 0, 0);

    const groundY = this.terrainQuery.getElevation(t.x, t.z);
    const heightAboveGround = t.y - groundY;
    const rho = airDensityAtAltitude(Math.max(0, t.y));
    const active = !this.crashed;

    // --- Engine & fuel ---
    const engineRunning = controls.engineOn && this.fuelL > 0 && spec.hasEngine && active && !this.landed;
    const throttleTarget = engineRunning ? clamp(controls.throttle, 0, 1) : 0;
    this.throttleSmoothed += (throttleTarget - this.throttleSmoothed) * Math.min(1, dt / Math.max(0.05, spec.engineResponseS));
    if (engineRunning) {
      this.fuelL = Math.max(0, this.fuelL - ((spec.fuelBurnLpm * (0.12 + 0.88 * this.throttleSmoothed)) / 60) * dt);
    }
    this.rpm = computeEngineRpm(this.aircraft.engine, engineRunning, this.fuelL, this.throttleSmoothed);

    // --- Air data ---
    this.air.copy(this.vel).sub(windWorld);
    this.airLocal.copy(this.air).applyQuaternion(this.qInv);
    const V = this.air.length();
    this.airspeed = V;
    const qbar = 0.5 * rho * V * V;
    const qn = qbar / Q_REF;
    const alpha = V > 0.5 ? Math.atan2(-this.airLocal.y, Math.max(0.1, this.airLocal.z)) : 0;
    const beta = V > 0.5 ? Math.atan2(this.airLocal.x, Math.max(0.5, Math.abs(this.airLocal.z))) : 0;
    this.alpha = alpha;
    const flaps = controls.flapsDown;
    const aStall = stallAlpha(spec, flaps);

    const wingMul = getAeroEffectivenessMultiplier(this.damageState, 'wing_root_main');
    const aileronMul = Math.min(getAeroEffectivenessMultiplier(this.damageState, 'aileron_l'), getAeroEffectivenessMultiplier(this.damageState, 'aileron_r'));
    const elevatorMul = getAeroEffectivenessMultiplier(this.damageState, 'elevator');
    const rudderMul = getAeroEffectivenessMultiplier(this.damageState, 'rudder');
    const aileronAsym = getAeroEffectivenessMultiplier(this.damageState, 'aileron_l') - getAeroEffectivenessMultiplier(this.damageState, 'aileron_r');

    if (active) {
      // --- Thrust ---
      const thrust = thrustAt(spec, this.throttleSmoothed, Math.max(0, this.vel.dot(this.fwd)), rho / SEA_LEVEL_RHO);
      this.force.copy(this.fwd).multiplyScalar(thrust);
      this.addForce(this.force);

      // --- Lift / drag / side force ---
      if (V > 0.5) {
        const wingHeight = heightAboveGround + 0.4;
        const ge = groundEffectInducedDragFactor(Math.max(0, wingHeight), spec.wingSpanM);
        const cl = liftCoefficient(spec, alpha, flaps) * wingMul * (1 + 0.12 * (1 - ge));
        const cd = dragCoefficient(spec, alpha, cl, flaps, ge) + (1 - wingMul) * 0.05;
        const airDir = this.tmp.copy(this.air).divideScalar(V);
        // Lift acts perpendicular to the airflow within the symmetry plane.
        const liftDir = this.tmp2.crossVectors(airDir, this.left);
        const liftLen = liftDir.length();
        if (liftLen > 1e-3) {
          this.force.copy(liftDir).multiplyScalar((qbar * spec.wingAreaM2 * cl) / liftLen);
          this.addForce(this.force);
        }
        this.force.copy(airDir).multiplyScalar(-qbar * spec.wingAreaM2 * cd);
        this.addForce(this.force);
        // Fuselage side area resists sideslip.
        this.force.copy(this.left).multiplyScalar(-qbar * spec.sideAreaM2 * 1.1 * Math.sin(beta));
        this.addForce(this.force);
      }
      if (controls.chuteDeployed && heightAboveGround > 3) {
        this.chuteDamping = true;
      }
      if (this.chuteDamping) {
        this.force.copy(this.air).multiplyScalar(-0.5 * rho * V * 18 * 1.3);
        this.addForce(this.force);
      }

      // --- Handling moments (angular accelerations) ---
      const h = spec.handling;
      const assist = ASSIST[controls.assistMode];
      this.localW.copy(this.angVel).applyQuaternion(this.qInv);
      const pRate = this.localW.z;
      const qRate = -this.localW.x;
      const rRate = -this.localW.y;
      const qnc = Math.min(qn, 1.5);
      const dampScale = 0.35 + 0.65 * Math.sqrt(qnc);
      const throttleWash = this.throttleSmoothed * 0.18;
      const ePitch = Math.min(1.25, qn + throttleWash) * elevatorMul;
      const eRoll = Math.min(1.25, qn) * aileronMul;
      const eYaw = Math.min(1.25, qn + throttleWash * 1.4) * rudderMul;

      const bank = Math.atan2(this.left.y, this.up.y); // right wing down positive (left wing is +X)
      const pitchAtt = Math.asin(clamp(this.fwd.y, -1, 1));
      const airborne = this.wheelContacts === 0;

      // Turn assist: extra trim AoA so banked lift still holds altitude.
      const cosBank = Math.max(0.5, Math.cos(bank));
      const turnAlpha = airborne ? assist.turnAssist * (0.62 / spec.clAlpha) * (1 / cosBank - 1) : 0;
      const trimAlpha = spec.trimAlphaRad + turnAlpha;
      const alphaErr = clamp(alpha - trimAlpha, -0.7, 0.7);

      // Assisted: fade stick authority as the aircraft approaches the bank limit.
      let rollIn = clamp(controls.roll, -1, 1);
      if (assist.bankLimitRad > 0 && Math.sign(rollIn) === Math.sign(bank)) {
        rollIn *= clamp((assist.bankLimitRad - Math.abs(bank)) / 0.35, 0, 1);
      }
      let pitchIn = clamp(controls.pitch, -1, 1);
      if (assist.pitchLimitRad > 0 && Math.sign(pitchIn) === Math.sign(pitchAtt)) {
        pitchIn *= clamp((assist.pitchLimitRad - Math.abs(pitchAtt)) / 0.3, 0, 1);
      }

      let aq = h.pitchAuthority * assist.authority * ePitch * pitchIn
        - h.pitchDamping * dampScale * qRate
        - h.pitchStability * qnc * alphaErr;
      let ap = h.rollAuthority * assist.authority * eRoll * rollIn
        - h.rollDamping * dampScale * pRate
        + h.dihedral * qnc * beta
        + aileronAsym * 1.5 * qnc;
      let ar = h.yawAuthority * assist.authority * eYaw * clamp(controls.rudder, -1, 1)
        - h.yawDamping * dampScale * rRate
        - h.yawStability * qnc * beta;

      if (airborne) {
        if (assist.autoLevel > 0 && Math.abs(controls.roll) < 0.15 && Math.abs(bank) < 1.75) {
          ap -= assist.autoLevel * bank * Math.min(1, qn);
        }
        if (assist.bankLimitRad > 0 && Math.abs(bank) > assist.bankLimitRad) {
          ap -= Math.sign(bank) * (Math.abs(bank) - assist.bankLimitRad) * 30;
        }
        if (assist.pitchLimitRad > 0 && Math.abs(pitchAtt) > assist.pitchLimitRad) {
          aq -= Math.sign(pitchAtt) * (Math.abs(pitchAtt) - assist.pitchLimitRad) * 25 * Math.min(1, qn + 0.4);
        }
        // AoA protection pushes the nose down before the break, strongest in 'assisted'.
        const protectAlpha = aStall - 0.035;
        if (alpha > protectAlpha) aq -= assist.aoaProtection * (alpha - protectAlpha) * Math.max(0.35, Math.min(1, qn));
        // Stall break: the wing drops toward the side that was already yawing/slipping.
        this.stalled = alpha > aStall + 0.01 && V > 3;
        if (this.stalled) {
          if (Math.abs(rRate) > 0.05) this.stallSide = Math.sign(rRate);
          const depth = clamp((alpha - aStall) / 0.2, 0, 1);
          ap += this.stallSide * 2.2 * depth * assist.wingDrop * Math.min(1, qn * 2);
          aq -= 1.2 * depth * Math.min(1, qn * 2);
        }
      } else {
        this.stalled = false;
      }
      this.stallWarning = airborne && V > 3 && (alpha > aStall - 0.045 || V < stallSpeed(spec, flaps, rho) * 1.08);

      const [ip, iy, ir] = spec.inertia;
      // Local torque -> world: pitch about -X, yaw about -Y, roll about +Z.
      this.torque.set(-aq * ip, -ar * iy, ap * ir).applyQuaternion(this.q);
      this.body.addTorque(this.torque, true);
    } else {
      this.stalled = false;
      this.stallWarning = false;
    }

    // --- Landing gear & structure contact ---
    this.resolveContacts(controls, dt);

    this.world.step();

    // Deep-penetration safety: never let the body center sink below the terrain surface.
    const t2 = this.body.translation();
    const floor = this.terrainQuery.getElevation(t2.x, t2.z) + BODY_RADIUS_M;
    if (t2.y < floor) {
      this.body.setTranslation({ x: t2.x, y: floor, z: t2.z }, true);
      const v2 = this.body.linvel();
      if (v2.y < 0) this.body.setLinvel({ x: v2.x, y: 0, z: v2.z }, true);
    }
    // Numerical safety net only; normal flight stays far inside these.
    const w2 = this.body.angvel();
    const wMag = Math.hypot(w2.x, w2.y, w2.z);
    if (wMag > 8) this.body.setAngvel({ x: (w2.x * 8) / wMag, y: (w2.y * 8) / wMag, z: (w2.z * 8) / wMag }, true);
    const v3 = this.body.linvel();
    const vMag = Math.hypot(v3.x, v3.y, v3.z);
    if (vMag > 90) this.body.setLinvel({ x: (v3.x * 90) / vMag, y: (v3.y * 90) / vMag, z: (v3.z * 90) / vMag }, true);

    return this.postStep(dt);
  }

  private addForce(f: THREE.Vector3) {
    this.body.addForce(f, true);
    this.nonGravity.add(f);
  }

  private addForceAt(f: THREE.Vector3, p: THREE.Vector3) {
    this.body.addForceAtPoint(f, p, true);
    this.nonGravity.add(f);
  }

  /** Terrain normal from a small finite difference (only called for touching points). */
  private terrainNormal(x: number, z: number): THREE.Vector3 {
    const e = 0.75;
    const hx = this.terrainQuery.getElevation(x + e, z) - this.terrainQuery.getElevation(x - e, z);
    const hz = this.terrainQuery.getElevation(x, z + e) - this.terrainQuery.getElevation(x, z - e);
    return this.normal.set(-hx / (2 * e), 1, -hz / (2 * e)).normalize();
  }

  private pointVelocity(p: THREE.Vector3): THREE.Vector3 {
    this.tmp.copy(p).sub(this.pos);
    return this.pointVel.copy(this.angVel).cross(this.tmp).add(this.vel);
  }

  private resolveContacts(controls: ResolvedControls, dt: number) {
    const spec = this.spec;
    const g = spec.gear;
    const gearGone = listDetachedPartIds(this.damageState).includes(gearPartId());
    const gearPenalty = getGroundHandlingPenalty(this.damageState);
    let wheels = 0;
    let maxSink = 0;

    if (!gearGone) {
      for (let i = 0; i < 3; i++) {
        const w = g.wheels[i];
        this.point.set(w[0], w[1], w[2]).applyQuaternion(this.q).add(this.pos);
        const ground = this.terrainQuery.getElevation(this.point.x, this.point.z);
        const depth = ground - this.point.y;
        if (depth <= 0) continue;
        wheels++;
        const n = this.terrainNormal(this.point.x, this.point.z);
        const pv = this.pointVelocity(this.point);
        const vn = pv.dot(n);
        maxSink = Math.max(maxSink, -vn);
        const compression = depth * n.y;
        let fn = this.springK[i] * compression - this.springC[i] * vn;
        if (compression > g.travelM) fn += this.springK[i] * 8 * (compression - g.travelM) - this.springC[i] * 2 * vn;
        fn = Math.max(0, fn);
        this.force.copy(n).multiplyScalar(fn);

        // Tyre frame: rolling direction is the (steered) nose direction projected on the ground.
        const steer = i === 0 ? clamp(controls.rudder, -1, 1) * g.maxSteerRad * clamp(1 - this.vel.length() / 30, 0.2, 1) : 0;
        const roll = this.tmp2.copy(this.fwd).applyAxisAngle(this.up, -steer);
        roll.addScaledVector(n, -roll.dot(n)).normalize();
        const side = this.tmp.crossVectors(n, roll);
        const vRoll = pv.dot(roll);
        const vSide = pv.dot(side);
        const surface = GROUND_SURFACES[this.terrainQuery.getSurfaceId(this.point.x, this.point.z)];
        const rr = surface.rollingResistance * 0.45 * g.rollingResistanceMul * gearPenalty;
        let fLong = -rr * fn * smoothSign(vRoll, 0.4);
        if (i > 0 && controls.brake) fLong -= 0.55 * surface.brakingGripDry * fn * smoothSign(vRoll, 0.5) / gearPenalty;
        const lateralCap = 0.85 * surface.brakingGripDry * fn;
        const fSide = -clamp(vSide * fn * 2.2, -lateralCap, lateralCap);
        this.force.addScaledVector(roll, fLong).addScaledVector(side, fSide);
        this.addForceAt(this.force, this.point);
      }
    }

    // Structure: tips, nose, tail, canopy, belly. Scrapes are survivable, impacts are not.
    let structural = 0;
    for (const hp of spec.hardPoints) {
      this.point.set(hp.p[0], hp.p[1], hp.p[2]).applyQuaternion(this.q).add(this.pos);
      const ground = this.terrainQuery.getElevation(this.point.x, this.point.z);
      const depth = ground - this.point.y;
      if (!this.crashed && this.obstacles.length > 0) this.checkObstacles(this.point);
      if (depth <= 0) continue;
      structural++;
      const n = this.terrainNormal(this.point.x, this.point.z);
      const pv = this.pointVelocity(this.point);
      const vn = pv.dot(n);
      const speed = pv.length();
      if (!this.crashed) {
        if (hp.id === 'canopy') this.crash('flipped');
        else if ((hp.id === 'wingtipL' || hp.id === 'wingtipR') && (-vn > 2.5 || speed > 9)) this.crash('wingStrike');
        else if (hp.id === 'nose' && (-vn > 2.5 || speed > 6)) this.crash('terrain');
        else if ((hp.id === 'bellyFront' || hp.id === 'bellyRear') && -vn > (gearGone ? 3.5 : 2.5)) this.crash('terrain');
        else if (hp.id === 'tail' && -vn > 4) this.crash('terrain');
      }
      const fn = Math.max(0, this.spec.massKg * 60 * depth - this.spec.massKg * 4 * vn);
      this.force.copy(n).multiplyScalar(fn);
      this.tmp2.copy(pv).addScaledVector(n, -vn);
      const slide = this.tmp2.length();
      if (slide > 0.01) this.force.addScaledVector(this.tmp2, (-0.6 * fn * smoothSign(slide, 0.5)) / slide);
      this.addForceAt(this.force, this.point);
    }

    const onGear = wheels > 0;
    // Touchdown edge: gear contact after a real airborne phase.
    if (onGear && !this.wasOnGear && this.airborneS > 0.25 && !this.crashed) {
      this.registerTouchdown(maxSink);
    }
    this.wasOnGear = onGear || structural > 0;
    this.wheelContacts = wheels;

    // Water: anything touching a lake/sea surface ends the flight.
    if (!this.crashed && (onGear || structural > 0) && this.terrainQuery.getWaterDepth(this.pos.x, this.pos.z) > 0.3) {
      this.crash('water');
    }
    // Upside down on the ground is a crash even without a canopy hit.
    if (!this.crashed && (onGear || structural > 0) && this.up.y < 0.1) this.crash('flipped');

    if (this.crashed && (onGear || structural > 0)) {
      // Wreck comes to rest.
      this.body.setLinearDamping(1.5);
      this.body.setAngularDamping(3);
    }
    void dt;
  }

  private registerTouchdown(sinkMs: number) {
    const spec = this.spec;
    const tol = spec.gear.toleranceMs;
    this.lastTouchdownVsMs = -sinkMs;
    // Map sink onto the damage model: crash threshold (1.8x tolerance) == IMPACT_HARD (8).
    this.damageState = applyGroundImpact(this.damageState, sinkMs * (8 / (tol * 1.8)));
    if (sinkMs > tol * 1.8) {
      this.crash('hardLanding');
      return;
    }
    const pitchDeg = (Math.asin(clamp(this.fwd.y, -1, 1)) * 180) / Math.PI;
    const rollDeg = (Math.atan2(this.left.y, this.up.y) * 180) / Math.PI;
    const right = this.tmp.copy(this.left).multiplyScalar(-1);
    const wind = this.tmp2.copy(this.vel).sub(this.air);
    const sample: LandingTelemetry = {
      verticalSpeedMs: -sinkMs,
      groundSpeedMs: Math.hypot(this.vel.x, this.vel.z),
      rollDeg,
      pitchDeg,
      crosswindMs: wind.dot(right),
    };
    // Keep the worst touchdown of this landing sequence (bounces count).
    if (!this.touchdown || Math.abs(sample.verticalSpeedMs) > Math.abs(this.touchdown.verticalSpeedMs)) {
      this.touchdown = sample;
    }
  }

  private checkObstacles(p: THREE.Vector3) {
    for (const o of this.obstacles) {
      const reach = o.kind === 'cylinder' ? o.radiusM : Math.hypot(o.halfX, o.halfZ);
      if (Math.abs(p.x - o.x) > reach + 1 || Math.abs(p.z - o.z) > reach + 1) continue;
      if (pointInObstacle(o, p.x, p.y, p.z)) {
        this.crash('obstacle');
        return;
      }
    }
  }

  private crash(reason: CrashReason) {
    if (this.crashed) return;
    this.crashed = true;
    this.crashReason = reason;
    this.state = 'crashed';
    this.damageState = applyGroundImpact(this.damageState, 99);
  }

  private postStep(dt: number): FlightTelemetry {
    const t = this.body.translation();
    const lv = this.body.linvel();
    const speed = Math.hypot(lv.x, lv.y, lv.z);
    const groundSpeed = Math.hypot(lv.x, lv.z);
    const agl = Math.max(0, t.y - this.terrainQuery.getElevation(t.x, t.z) - this.restHeightM);
    const onGround = this.wheelContacts > 0 || agl < 0.15;

    this.distanceM = Math.hypot(t.x - this.spawnXZ[0], t.z - this.spawnXZ[1]);
    this.maxAltitudeM = Math.max(this.maxAltitudeM, agl);
    this.maxSpeedMs = Math.max(this.maxSpeedMs, speed);
    // Upward specific force (lift + gear + thrust) over weight.
    this.gForce = this.nonGravity.dot(this.up) / (this.spec.massKg * GRAVITY);

    if (this.wheelContacts === 0) {
      this.airborneS += dt;
      if (this.airborneS > FLOWN_MIN_AIRBORNE_S && agl > FLOWN_MIN_HEIGHT_M) this.hasFlown = true;
      if (this.airborneS > 3) this.touchdown = null;
    } else {
      this.airborneS = 0;
    }

    if (!this.crashed && !this.landed) {
      if (this.wheelContacts === 0 && agl > 0.3) {
        this.state = this.hasFlown ? 'airborne' : 'taxi';
      } else if (this.hasFlown) {
        this.state = 'groundRoll';
        if (groundSpeed < STOPPED_SPEED_MS && this.wheelContacts >= 2) {
          this.stoppedS += dt;
          if (this.stoppedS >= STOPPED_HOLD_S) this.completeLanding(groundSpeed);
        } else {
          this.stoppedS = 0;
        }
      } else {
        this.state = this.rpm > 0 || groundSpeed > 0.5 ? 'taxi' : 'prestart';
      }
    }

    const up = this.up;
    const fwd = this.fwd;
    return {
      state: this.state,
      speedMs: speed,
      altitudeM: agl,
      aoaDeg: (this.alpha * 180) / Math.PI,
      distanceM: this.distanceM,
      maxAltitudeM: this.maxAltitudeM,
      maxSpeedMs: this.maxSpeedMs,
      fuelFraction: this.spec.fuelCapacityL > 0 ? this.fuelL / this.spec.fuelCapacityL : 0,
      crashed: this.crashed,
      landed: this.landed,
      landingQuality: this.landingQuality,
      rpm: this.rpm,
      onGround,
      crashOutcome: this.damageState.outcome,
      damagedPartIds: listDamagedPartIds(this.damageState),
      detachedPartIds: listDetachedPartIds(this.damageState),
      landingFailures: this.landingFailures,
      elapsedS: this.elapsedS,
      position: [t.x, t.y, t.z],
      headingDeg: compassBearingDeg(fwd.x, fwd.z),
      airspeedMs: this.airspeed,
      groundSpeedMs: groundSpeed,
      verticalSpeedMs: lv.y,
      pitchDeg: (Math.asin(clamp(fwd.y, -1, 1)) * 180) / Math.PI,
      rollDeg: (Math.atan2(this.left.y, up.y) * 180) / Math.PI,
      throttle: this.throttleSmoothed,
      engineOn: this.rpm > 0,
      outOfFuel: this.spec.hasEngine && this.fuelL <= 0,
      stallWarning: this.stallWarning,
      stalled: this.stalled,
      stallSpeedMs: stallSpeed(this.spec, false),
      wheelsOnGround: this.wheelContacts,
      gForce: this.gForce,
      lastTouchdownVsMs: this.lastTouchdownVsMs,
      crashReason: this.crashReason,
    };
  }

  private completeLanding(groundSpeed: number) {
    this.landed = true;
    this.state = 'stopped';
    const sample = this.touchdown ?? {
      verticalSpeedMs: this.lastTouchdownVsMs ?? 0,
      groundSpeedMs: groundSpeed,
      rollDeg: 0,
      pitchDeg: 0,
      crosswindMs: 0,
    };
    const result = validateLanding(sample, this.runwayConditions);
    this.landingQuality = result.qualityScore;
    this.landingFailures = result.failures;
  }
}
