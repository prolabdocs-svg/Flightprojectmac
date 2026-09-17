// Core flight simulation: applies aerodynamic forces + propulsion to a single dynamic
// rigid body per tick (spec sections 8, 9, 34). Runs at a fixed 60Hz timestep.

import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import type { ResolvedAircraft } from '../content/assembly';
import { airDensityAtAltitude, dynamicPressure, groundEffectInducedDragFactor, liftDragCurve } from './aero';
import {
  applyGroundImpact,
  createDamageState,
  getAeroEffectivenessMultiplier,
  getGroundHandlingPenalty,
  listDamagedPartIds,
  listDetachedPartIds,
  type CrashOutcome,
  type DamageState,
} from './damageSystem';
import { computeCrosswindMs, computeRollPitchDeg } from './touchdownTelemetry';
import { validateLanding, type LandingTelemetry, type RunwayConditions } from '../world/landingValidator';
import type { TerrainQueryService } from '../world/terrainQuery';
import { GROUND_SURFACES } from '../world/surfaces';
import { computeEngineRpm } from './engine';

/** Used when a mission has no destinationAirfieldId (or none is provided) — a mid-tolerance
 * surface so an un-linked mission's landing scoring isn't unrealistically easy or hard. */
export const DEFAULT_RUNWAY_CONDITIONS: RunwayConditions = { surface: 'grass', roughness: 0.4 };

export type FlightState =
  | 'prestart'
  | 'taxi'
  | 'airborne'
  | 'landingApproach'
  | 'groundRoll'
  | 'crashed'
  | 'stopped';

export interface ResolvedControls {
  throttle: number;
  rudder: number;
  pitch: number;
  roll: number;
  engineOn: boolean;
  brake: boolean;
  flapsDown: boolean;
  chuteDeployed: boolean;
  assistMode: 'assisted' | 'standard' | 'acro';
}

export interface FlightTelemetry {
  state: FlightState;
  speedMs: number;
  altitudeM: number;
  aoaDeg: number;
  distanceM: number;
  maxAltitudeM: number;
  maxSpeedMs: number;
  fuelFraction: number;
  crashed: boolean;
  landed: boolean;
  landingQuality: number;
  rpm: number;
  onGround: boolean;
  /** Damage system (src/sim/damageSystem.ts): 'none' below the impact-safe threshold,
   * 'hardLanding' for a damaging but survivable impact, 'totalLoss' once it crosses the
   * same vertical-speed threshold that already sets `crashed`. */
  crashOutcome: CrashOutcome;
  damagedPartIds: string[];
  detachedPartIds: string[];
  /** Reasons the touchdown failed validateLanding() (src/world/landingValidator.ts), e.g.
   * 'verticalSpeed'/'roll'/'pitch'/'crosswind'. Empty before any landing/on a clean one. */
  landingFailures: string[];
  /** Authoritative fixed-step flight duration. Unlike wall-clock time this excludes
   * pauses/background time, so it is safe for time-trial rewards and results. */
  elapsedS: number;
  /** World-space location at the current fixed simulation tick. */
  position: [number, number, number];
  /** Compass heading in degrees: 0 = world north/+Z, clockwise (see world/compass.ts). */
  headingDeg: number;
  /** True airspeed (relative to the air mass). `speedMs` stays total inertial speed. */
  airspeedMs: number;
  groundSpeedMs: number;
  /** World vertical speed, m/s, positive = climbing. */
  verticalSpeedMs: number;
  /** Nose-up positive. */
  pitchDeg: number;
  /** Right-wing-down positive. */
  rollDeg: number;
  /** Smoothed engine throttle actually applied, 0..1. */
  throttle: number;
  engineOn: boolean;
  outOfFuel: boolean;
  /** Approaching critical angle of attack or below 1.15x stall speed while airborne. */
  stallWarning: boolean;
  /** Wing past critical angle of attack (lift collapsing). */
  stalled: boolean;
  /** 1g stall speed of the current configuration (flaps aware), m/s. */
  stallSpeedMs: number;
  /** Number of landing-gear wheels touching the ground (0..3). */
  wheelsOnGround: number;
  /** Load factor along the aircraft's up axis, g. */
  gForce: number;
  /** Vertical speed (m/s, negative = sinking) at the most recent touchdown, null before any. */
  lastTouchdownVsMs: number | null;
  /** Why the flight ended in a crash, null otherwise. */
  crashReason: 'terrain' | 'obstacle' | 'hardLanding' | 'flipped' | 'water' | 'wingStrike' | null;
}

const FIXED_DT = 1 / 60;
// The main collider's half-height (see halfExtents.y below): the body origin rests at
// this height above the ground plane when the aircraft's belly/wheels are touching down.
// "altitude" is reported/thresholded relative to the belly, not the rigid-body origin,
// otherwise a resting aircraft never reads as grounded (a real bug that broke taxi/
// landing/crash state detection: 0.8 m of body-origin height is always > the old 0.6 m
// grounded threshold).
const GROUND_REST_OFFSET_M = 0.8;

// Arcade tuning per assist mode (spec 38 "Mode 2" presets), aimed at the GTA San
// Andreas / Dodo feel: immediate, punchy control response rather than a heavy,
// realistic RC-plane feel. 'assisted' is left at the original tuned values so
// beginners keep the gentle, forgiving handling; 'standard' and 'acro' get more
// control-surface throw, less auto-leveling, and more headroom to spin/loop.
const ASSIST_AUTHORITY_MUL: Record<ResolvedControls['assistMode'], number> = {
  assisted: 1.0,
  standard: 1.35,
  acro: 1.65,
};
// Air (not ground) stability gain multiplier: lower means the aircraft holds a bank/
// pitch attitude and lets rotation carry through loops/rolls instead of snapping level.
const ASSIST_AIR_STABILITY_MUL: Record<ResolvedControls['assistMode'], number> = {
  assisted: 1.0,
  standard: 0.55,
  acro: 0.3,
};
// Angular speed safety clamp (rad/s) - kept low for 'assisted' so it can't be thrown
// into a disorienting spin, raised for 'standard'/'acro' so fast rolls/loops aren't
// artificially capped.
const ASSIST_MAX_ANG_SPEED: Record<ResolvedControls['assistMode'], number> = {
  assisted: 6,
  standard: 8,
  acro: 10,
};

export class FlightController {
  world: RAPIER.World;
  body: RAPIER.RigidBody;
  collider: RAPIER.Collider;
  aircraft: ResolvedAircraft;

  private spawnPos: THREE.Vector3;
  private readonly spawnHeadingDeg: number;
  private throttleSmoothed = 0;
  private fuelL: number;
  private fuelCapacityL: number;
  private distanceM = 0;
  private maxAltitudeM = 0;
  private maxSpeedMs = 0;
  private state: FlightState = 'prestart';
  private crashed = false;
  private landed = false;
  private landingQuality = 0;
  private elapsedS = 0;
  private lastVerticalSpeed = 0;
  private rpm = 0;
  private wasGrounded = true;
  private damageState: DamageState;
  private runwayConditions: RunwayConditions;
  /** Captured the instant the airframe transitions airborne -> grounded (see step()'s
   * touchdown edge below); null until the first such transition this flight. */
  private touchdownTelemetry: LandingTelemetry | null = null;
  private landingFailures: string[] = [];
  private lastWindWorld = new THREE.Vector3();
  private terrainQuery: TerrainQueryService;

  constructor(
    world: RAPIER.World,
    aircraft: ResolvedAircraft,
    spawnPos: THREE.Vector3,
    spawnHeadingDeg: number,
    terrainQuery: TerrainQueryService,
    runwayConditions: RunwayConditions = DEFAULT_RUNWAY_CONDITIONS,
  ) {
    this.world = world;
    this.aircraft = aircraft;
    this.spawnPos = spawnPos.clone();
    this.spawnHeadingDeg = spawnHeadingDeg;
    this.runwayConditions = runwayConditions;
    this.terrainQuery = terrainQuery;
    this.fuelCapacityL = aircraft.fuelCapacityL;
    this.fuelL = aircraft.fuelCapacityL;

    const headingRad = (spawnHeadingDeg * Math.PI) / 180;
    const quat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), headingRad);

    const bodyDesc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(spawnPos.x, spawnPos.y, spawnPos.z)
      .setRotation({ x: quat.x, y: quat.y, z: quat.z, w: quat.w })
      .setLinearDamping(0.02)
      .setAngularDamping(4.0)
      .setCcdEnabled(false);
    this.body = world.createRigidBody(bodyDesc);

    // Approximate fuselage + wing bounding box as a single compound-ish cuboid collider.
    const halfExtents = { x: 5.2, y: 0.8, z: 2.6 };
    const colliderDesc = RAPIER.ColliderDesc.cuboid(halfExtents.x, halfExtents.y, halfExtents.z)
      .setDensity(0.001) // mass is set explicitly below
      // The collider approximates the whole airframe as one box resting flat on the runway
      // (no separate rolling wheel colliders), so a friction coefficient in the 0.7-0.85
      // range (appropriate for a sliding block) made Rapier's contact solver apply huge
      // ground friction forces (~0.5x aircraft weight) any time the box was in contact -
      // this was the dominant, unrealistic force driving the taxi/ground speed
      // oscillation seen during tuning. A low value here approximates rolling resistance
      // on wheels; deliberate stopping is handled by the explicit wheel-brake force below.
      .setFriction(0.04 * aircraft.groundFrictionMul)
      .setRestitution(0.0);
    this.collider = world.createCollider(colliderDesc, this.body);

    this.body.setAdditionalMass(aircraft.totalMassKg, true);

    this.damageState = createDamageState(aircraft.aeroSurfaces.map((s) => s.id));
  }

  getState() {
    return this.state;
  }

  reset() {
    const headingRad = (this.spawnHeadingDeg * Math.PI) / 180;
    const quat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), headingRad);
    this.body.setTranslation(this.spawnPos, true);
    this.body.setRotation(quat, true);
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    this.fuelL = this.fuelCapacityL;
    this.distanceM = 0;
    this.maxAltitudeM = 0;
    this.maxSpeedMs = 0;
    this.state = 'prestart';
    this.crashed = false;
    this.landed = false;
    this.landingQuality = 0;
    this.elapsedS = 0;
    this.throttleSmoothed = 0;
    this.wasGrounded = true;
    this.damageState = createDamageState(this.aircraft.aeroSurfaces.map((s) => s.id));
    this.touchdownTelemetry = null;
    this.landingFailures = [];
  }

  /** Advances one fixed physics tick. Wind is a world-space m/s vector. */
  step(controls: ResolvedControls, windWorld: THREE.Vector3) {
    const dt = FIXED_DT;
    this.elapsedS += dt;
    this.lastWindWorld.copy(windWorld);

    // ROOT CAUSE of the taxi/ground-roll speed oscillation (bisected with a headless
    // Rapier harness: a bare rigid body + a single constant addForce() call, no
    // aircraft code, no ground, no gravity, reproduced the same runaway growth).
    // RAPIER.RigidBody.addForce()/addForceAtPoint()/addTorque() accumulate into a
    // persistent "user force" that is NOT cleared by World.step() in this engine
    // version/binding (@dimforge/rapier3d-compat) - every call below adds onto
    // whatever thrust/drag/lift/stability force was still queued from the previous
    // tick. With that never reset, the net force applied grows roughly linearly
    // with elapsed frames instead of being recomputed fresh each tick: acceleration
    // (and therefore speed) ramps up far faster than the model intends, drag
    // eventually catches up (it's recomputed from velocity each tick and grows with
    // v^2) and overshoots the other way, and the cycle repeats - a large, sustained
    // limit cycle that shows up exactly as the taxi speed "cyclically oscillating"
    // symptom, on the ground or airborne, with or without any aero surfaces. It is
    // not a contact-solver/single-box-collider artifact - it reproduced identically
    // with the ground collider and gravity removed entirely. Clearing the
    // accumulated force/torque at the start of every tick, before any of this
    // frame's forces are added, makes each tick's applied force depend only on this
    // tick's state again, matching the intended explicit-Euler force model.
    this.body.resetForces(true);
    this.body.resetTorques(true);

    const pos = this.body.translation();
    const rot = this.body.rotation();
    const quat = new THREE.Quaternion(rot.x, rot.y, rot.z, rot.w);
    const linvel = this.body.linvel();
    const angvel = this.body.angvel();
    const bodyPos = new THREE.Vector3(pos.x, pos.y, pos.z);
    const bodyVel = new THREE.Vector3(linvel.x, linvel.y, linvel.z);
    const bodyAngVel = new THREE.Vector3(angvel.x, angvel.y, angvel.z);

    const terrainYHere = this.terrainQuery.getElevation(pos.x, pos.z);
    const altitude = Math.max(0, pos.y - terrainYHere - GROUND_REST_OFFSET_M);
    const rho = airDensityAtAltitude(altitude);
    const onGround = altitude < 0.3;
    // Sampled once per tick (not per force) - ground contact never changes surface mid-tick.
    const groundSurface = onGround ? GROUND_SURFACES[this.terrainQuery.getSurfaceId(pos.x, pos.z)] : null;

    if (!this.crashed && !this.landed) {
      // --- Fuel & engine ---
      const throttleTarget = controls.engineOn ? controls.throttle : 0;
      this.throttleSmoothed += (throttleTarget - this.throttleSmoothed) * Math.min(1, dt / Math.max(0.05, this.aircraft.engine?.responseTime ?? 0.3));

      if (this.aircraft.engine && this.fuelL > 0 && controls.engineOn) {
        const burnRate = (this.aircraft.engine.maxPowerKw / 9) * 1.1 * this.throttleSmoothed; // L/min approx
        this.fuelL = Math.max(0, this.fuelL - (burnRate / 60) * dt);
      }
      this.rpm = computeEngineRpm(this.aircraft.engine, controls.engineOn, this.fuelL, this.throttleSmoothed);

      // --- Propulsion (actuator-disk / Rankine-Froude momentum theory) ---
      // Previously: staticThrust = availableW / 8 and a hand-picked speed-falloff constant
      // (28) - two arbitrary numbers disconnected from the propeller's actual size, and
      // `engine.propDiameterM` (already authored per-engine in parts.ts) was dead data, never
      // read anywhere. Momentum theory instead derives both quantities from real physics:
      // for an ideal actuator disk of area A in static conditions (V0=0), thrust and power
      // are related by P = T*v_i and T = 2*rho*A*v_i^2 (v_i = induced/slipstream velocity),
      // which combine to a closed form for static thrust: T_static = (2*rho*A*P^2)^(1/3).
      // This correctly makes static thrust depend on the propeller's disk area (a bigger
      // prop genuinely produces more static thrust for the same power) and on air density
      // (thrust drops at altitude, previously not modeled at all - rho only affected the
      // wings before this change). The forward-flight falloff denominator is likewise no
      // longer a bare tuning constant: it's derived from the disk's own static induced
      // velocity v_i (the speed scale at which the free-stream begins to matter), so a
      // bigger/more efficient disk naturally keeps more of its thrust at higher airspeed.
      if (this.aircraft.engine && this.fuelL > 0) {
        const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(quat);
        const availableW = this.aircraft.engine.maxPowerKw * 1000 * this.throttleSmoothed * this.aircraft.engine.propEfficiency;
        const forwardSpeed = Math.max(0, bodyVel.dot(forward));
        const propRadiusM = this.aircraft.engine.propDiameterM / 2;
        const diskAreaM2 = Math.PI * propRadiusM * propRadiusM;
        // cbrt(2*rho*A*P^2): closed-form static thrust from actuator-disk momentum theory.
        const staticThrustN = Math.cbrt(2 * rho * diskAreaM2 * availableW * availableW);
        // Guard: at zero throttle (availableW=0) staticThrustN and staticInducedVelMs are
        // both exactly 0, which would divide 0/0 below (NaN) once forwardSpeed is also 0
        // (e.g. engine idling before the first tick of motion) - thrust is simply zero here.
        let thrustN = 0;
        if (staticThrustN > 1e-6) {
          const staticInducedVelMs = Math.sqrt(staticThrustN / (2 * rho * diskAreaM2));
          // Denominator scale (2x the static induced velocity) approximates where the exact
          // momentum-theory thrust-lapse curve sits without solving the full cubic in v_i
          // for every tick - a standard simplification for real-time propeller models.
          thrustN = staticThrustN / (1 + forwardSpeed / (2 * staticInducedVelMs));
        }
        const enginePoint = bodyPos.clone().add(new THREE.Vector3(0, 0, 2.1).applyQuaternion(quat));
        const force = forward.multiplyScalar(thrustN);
        this.body.addForceAtPoint({ x: force.x, y: force.y, z: force.z }, { x: enginePoint.x, y: enginePoint.y, z: enginePoint.z }, true);
      }

      // --- Aerodynamic surfaces ---
      for (const surf of this.aircraft.aeroSurfaces) {
        // Damage system (spec 142.2 "damaged aero"): a detached surface contributes
        // nothing; a damaged one produces degraded lift/drag. See damageSystem.ts.
        const damageMul = getAeroEffectivenessMultiplier(this.damageState, surf.id);
        if (damageMul <= 0) continue;

        const localPos = new THREE.Vector3(...surf.localPosition);
        const worldPos = bodyPos.clone().add(localPos.clone().applyQuaternion(quat));
        const r = worldPos.clone().sub(bodyPos);
        const pointVel = bodyVel.clone().add(bodyAngVel.clone().cross(r));
        const airVel = pointVel.clone().sub(windWorld);
        // Clamp the local airspeed used for force magnitude: an unclamped ω×r term at a
        // surface far from the CoM (e.g. a wingtip during a fast roll) grows the local
        // point velocity, and since aero force scales with V^2, that can runaway under
        // explicit integration. This keeps forces bounded to a still-generous envelope
        // (252 km/h air) without touching the AoA/direction math below.
        const rawSpeed = airVel.length();
        if (rawSpeed < 0.05) continue;
        const speed = Math.min(rawSpeed, 70);

        const invQuat = quat.clone().invert();
        const localFlow = airVel.clone().applyQuaternion(invQuat);
        const forwardSpeed = localFlow.z;
        const verticalFlow = localFlow.y;
        const lateralFlow = localFlow.x;

        // Arcade agility: 'standard'/'acro' get more control-surface throw than the raw
        // part data specifies, so turns feel as snappy as GTA San Andreas' planes instead
        // of a realistic RC model. 'assisted' keeps the tuned-for-beginners authority as-is.
        const authorityMul = ASSIST_AUTHORITY_MUL[controls.assistMode];
        let deflectionDeg = 0;
        if (surf.controlAxis === 'pitch') {
          deflectionDeg = controls.pitch * (surf.maxDeflectionDeg ?? 0) * (surf.controlAuthority ?? 1) * authorityMul;
        } else if (surf.controlAxis === 'roll') {
          const sign = surf.id.endsWith('_l') ? -1 : 1;
          deflectionDeg = controls.roll * (surf.maxDeflectionDeg ?? 0) * sign * (surf.controlAuthority ?? 1) * authorityMul;
        } else if (surf.controlAxis === 'yaw') {
          deflectionDeg = controls.rudder * (surf.maxDeflectionDeg ?? 0) * (surf.controlAuthority ?? 1) * authorityMul;
        }
        if (controls.flapsDown && surf.id === 'wing_root_main') {
          deflectionDeg += 12; // crude flap camber boost
        }

        const isVerticalFin = surf.controlAxis === 'yaw';
        let aoaDeg: number;
        let liftDirWorld: THREE.Vector3;
        if (isVerticalFin) {
          aoaDeg = (Math.atan2(lateralFlow, Math.max(0.1, forwardSpeed)) * 180) / Math.PI + deflectionDeg;
          liftDirWorld = new THREE.Vector3(1, 0, 0).applyQuaternion(quat);
        } else {
          // BUG FIX (playability): zeroLiftAoADeg (the surface's built-in incidence, spec
          // 6.2) was defined on every wing/tail part but never actually applied here, so a
          // level fuselage always meant AoA == 0 == zero lift, no matter the speed. Since the
          // aircraft's single flat-bottomed box collider is fully seated on the ground
          // collider while taxiing, Rapier's contact solver resists any pitch rotation until
          // the wings are already generating enough lift to unweight it - a chicken-and-egg
          // problem that meant the aircraft could accelerate indefinitely down the runway and
          // never leave the ground. Subtracting the surface's zero-lift AoA gives the main
          // wing real lift at level attitude once ground speed builds, matching its authored
          // incidence (see parts.ts) instead of leaving that field dead.
          aoaDeg = (Math.atan2(-verticalFlow, Math.max(0.1, forwardSpeed)) * 180) / Math.PI + deflectionDeg - surf.zeroLiftAoADeg;
          liftDirWorld = new THREE.Vector3(0, 1, 0).applyQuaternion(quat);
        }

        // Finite-wing aspect ratio (span^2/area) drives this surface's own lift-curve slope
        // (aero.ts finiteWingLiftSlope) instead of every surface sharing one constant - a
        // rudder's stubby AR (~1.5) genuinely produces less lift per degree than the main
        // wing's AR (~7), which now falls directly out of each part's authored span/area.
        const aspectRatio = (surf.spanM * surf.spanM) / surf.areaM2;

        // Ground effect (McCormick/Wieselsberger induced-drag reduction, aero.ts
        // groundEffectInducedDragFactor): the closer a surface is to the ground relative to
        // its own span, the less induced drag it produces - the real "ground cushion" that
        // lets an aircraft float just above the runway as speed bleeds off in the landing
        // flare, instead of sinking the instant lift starts to drop.
        const heightAboveGroundM = worldPos.y - this.terrainQuery.getElevation(worldPos.x, worldPos.z);
        const groundEffectMul = groundEffectInducedDragFactor(heightAboveGroundM, surf.spanM);
        const effectiveInducedDragFactor = surf.inducedDragFactor * groundEffectMul;

        const { cl, cd } = liftDragCurve(
          aoaDeg,
          surf.stallPositiveDeg,
          surf.stallNegativeDeg,
          surf.parasiticCd,
          effectiveInducedDragFactor,
          aspectRatio,
        );
        const q = dynamicPressure(rho, speed);
        const liftMag = q * surf.areaM2 * cl * damageMul;
        const dragMag = q * surf.areaM2 * cd * damageMul;

        const dragDirWorld = airVel.clone().normalize().multiplyScalar(-1);
        const force = liftDirWorld.multiplyScalar(liftMag).add(dragDirWorld.multiplyScalar(dragMag));
        this.body.addForceAtPoint({ x: force.x, y: force.y, z: force.z }, { x: worldPos.x, y: worldPos.y, z: worldPos.z }, true);
      }

      // --- Empirical stability term (spec 8.6): a small self-leveling torque so the
      // arcade model stays pleasant on mobile instead of tumbling indefinitely.
      // This is a proper PD controller (proportional restoring torque + derivative
      // damping on pitch/roll rate) rather than proportional-only, which oscillated
      // and could diverge under explicit integration. Full gain applies on the
      // ground (approximating tricycle-gear resistance to pitch/roll) and tapers in
      // with airspeed once airborne.
      {
        const forwardSpeed = Math.max(0, bodyVel.dot(new THREE.Vector3(0, 0, 1).applyQuaternion(quat)));
        const localUp = new THREE.Vector3(0, 1, 0).applyQuaternion(quat);
        const worldUp = new THREE.Vector3(0, 1, 0);
        const correctionAxis = new THREE.Vector3().crossVectors(localUp, worldUp);
        // Ground self-leveling must taper off with speed too, not just after liftoff: at
        // full gain regardless of forwardSpeed, it fought the elevator hard enough that the
        // aircraft could never rotate (pitch up) during the takeoff roll, so AoA/lift stayed
        // near zero at any ground speed and the plane simply never left the runway. Tapering
        // it down as the ground roll builds speed keeps low-speed taxi stable (full gain near
        // a standstill) while leaving real elevator authority for rotation near flying speed.
        const speedFactor = onGround ? Math.max(0.15, 1 - forwardSpeed / 20) : Math.min(1, forwardSpeed / 12);
        // Full gain on the ground regardless of assist mode (taxi/takeoff stays easy to
        // handle); airborne gain is tapered further per assist mode so 'standard'/'acro'
        // can hold a bank through a turn or carry a loop instead of auto-leveling out of it.
        const airStabilityMul = onGround ? 1 : ASSIST_AIR_STABILITY_MUL[controls.assistMode];
        const stabilityGain = 1.6 * speedFactor * airStabilityMul * this.aircraft.totalMassKg;

        // Damping: oppose pitch/roll rate only (leave yaw free for rudder turns).
        const yawComponent = worldUp.clone().multiplyScalar(bodyAngVel.dot(worldUp));
        const pitchRollRate = bodyAngVel.clone().sub(yawComponent);
        // Damping is only partially tapered (never below half) even for 'acro' - it exists
        // to keep explicit integration numerically stable, not just to auto-level, so it
        // can't be relaxed as much as the leveling term above without risking divergence.
        const dampingMul = onGround ? 1 : 0.5 + 0.5 * airStabilityMul;
        const dampingGain = 5.0 * dampingMul * this.aircraft.totalMassKg;

        const torque = correctionAxis
          .multiplyScalar(stabilityGain)
          .addScaledVector(pitchRollRate, -dampingGain);
        this.body.addTorque({ x: torque.x, y: torque.y, z: torque.z }, true);
      }

      // --- Fuselage parasitic drag ---
      {
        const speed = bodyVel.length();
        if (speed > 0.1) {
          const q = dynamicPressure(rho, speed);
          const dragMag = q * this.aircraft.totalDragArea * this.aircraft.totalDragCoefficient;
          const dragDir = bodyVel.clone().normalize().multiplyScalar(-1);
          const force = dragDir.multiplyScalar(dragMag);
          this.body.addForce({ x: force.x, y: force.y, z: force.z }, true);
        }
      }

      // --- Rolling resistance (per-surface taxi drag, GROUND_SURFACES from surfaces.ts) ---
      // Ground contact/friction itself is handled by the manual terrain-snap below, not by
      // Rapier collider friction (see the setFriction(...) comment above), so surface roll
      // drag has to be applied here as an explicit force too. groundFrictionMul (airframe/gear
      // quality) is a separate multiplicative factor on top of the surface's own resistance.
      if (onGround && groundSurface) {
        const horizVel = new THREE.Vector3(bodyVel.x, 0, bodyVel.z);
        const speedHoriz = horizVel.length();
        if (speedHoriz > 0.05) {
          const rollMag = groundSurface.rollingResistance * this.aircraft.groundFrictionMul * 9.81 * this.aircraft.totalMassKg;
          const rollForce = horizVel.normalize().multiplyScalar(-rollMag);
          this.body.addForce({ x: rollForce.x, y: 0, z: rollForce.z }, true);
        }
      }

      // --- Wheel brake (simple linear damping boost while on ground) ---
      // Damaged/detached gear (damageSystem.ts) makes braking less effective, standing in
      // for a busted wheel/strut without touching the rest of the ground-roll tuning.
      const gearPenalty = getGroundHandlingPenalty(this.damageState);
      if (onGround && controls.brake) {
        const gripMul = groundSurface ? groundSurface.brakingGripDry : 1;
        const decel = bodyVel.clone().multiplyScalar((-2.5 * gripMul / gearPenalty) * this.aircraft.totalMassKg);
        this.body.addForce({ x: decel.x, y: 0, z: decel.z }, true);
      }

      if (controls.chuteDeployed && altitude > 2) {
        this.body.setLinearDamping(2.0);
      }
    }

    this.world.step();

    // --- Terrain collision (arcade-fidelity, no Rapier heightfield) ---
    // The Rapier world only has a flat safety-net ground plane far below the map (see
    // FlightScreen.tsx) - a real RAPIER.ColliderDesc.heightfield(...) sampled from
    // TerrainQueryService (src/world/terrainQuery.ts) reliably crashed the Rapier wasm
    // module ("memory access out of bounds") when tried, so ground contact against the
    // undulating visual terrain is instead enforced manually here every tick: if the
    // aircraft's belly would sit below the terrain height sampled at its own x/z, snap it
    // to rest on the surface and kill downward velocity, the same net effect a solid
    // heightfield collider would have. This treats local terrain as horizontal at the
    // sampled point (ignores slope tilt) - an acceptable simplification for this arcade
    // model, and the reason the aircraft no longer visually clips through hills/valleys.
    {
      const p = this.body.translation();
      const terrainYNow = this.terrainQuery.getElevation(p.x, p.z);
      const bellyY = p.y - GROUND_REST_OFFSET_M;
      if (bellyY < terrainYNow) {
        this.body.setTranslation({ x: p.x, y: terrainYNow + GROUND_REST_OFFSET_M, z: p.z }, true);
        const v = this.body.linvel();
        if (v.y < 0) {
          this.body.setLinvel({ x: v.x, y: 0, z: v.z }, true);
        }
      }
    }

    // --- Safety clamps (spec 8.3 allows limiting extreme high-speed/contact events).
    // These are a last-resort net on top of the tuned constants above, not a substitute
    // for them: normal flight should stay well inside these bounds.
    {
      const av = this.body.angvel();
      const angSpeed = Math.hypot(av.x, av.y, av.z);
      const maxAngSpeed = ASSIST_MAX_ANG_SPEED[controls.assistMode]; // rad/s
      if (angSpeed > maxAngSpeed) {
        const scale = maxAngSpeed / angSpeed;
        this.body.setAngvel({ x: av.x * scale, y: av.y * scale, z: av.z * scale }, true);
      }
      const lv = this.body.linvel();
      const linSpeed = Math.hypot(lv.x, lv.y, lv.z);
      const maxLinSpeed = 90; // m/s (~324 km/h), well above the tuned cruise/dive envelope
      if (linSpeed > maxLinSpeed) {
        const scale = maxLinSpeed / linSpeed;
        this.body.setLinvel({ x: lv.x * scale, y: lv.y * scale, z: lv.z * scale }, true);
      }
    }

    // --- Post-step bookkeeping ---
    const newPos = this.body.translation();
    const newRot = this.body.rotation();
    const newLinvel = this.body.linvel();
    const speedNow = Math.hypot(newLinvel.x, newLinvel.y, newLinvel.z);
    const terrainYNow = this.terrainQuery.getElevation(newPos.x, newPos.z);
    const altitudeNow = Math.max(0, newPos.y - terrainYNow - GROUND_REST_OFFSET_M);
    this.distanceM = Math.hypot(newPos.x - this.spawnPos.x, newPos.z - this.spawnPos.z);
    this.maxAltitudeM = Math.max(this.maxAltitudeM, altitudeNow);
    this.maxSpeedMs = Math.max(this.maxSpeedMs, speedNow);

    const verticalSpeed = newLinvel.y;
    const groundedNow = altitudeNow < 0.3;

    // Damage system: register a fresh touchdown/impact (not sustained ground contact) the
    // moment the airframe transitions from airborne to grounded, using the pre-contact
    // vertical speed as the impact-severity proxy (damageSystem.ts applyGroundImpact).
    if (groundedNow && !this.wasGrounded) {
      this.damageState = applyGroundImpact(this.damageState, this.lastVerticalSpeed);

      // Real touchdown telemetry (spec world-graph foundation's landingValidator, task:
      // wire it into the sim instead of leaving it dead code): sampled at the exact
      // airborne->grounded transition, using the same pre-contact vertical speed the
      // damage system uses as its impact-severity proxy.
      const { rollDeg, pitchDeg } = computeRollPitchDeg(newRot);
      this.touchdownTelemetry = {
        verticalSpeedMs: this.lastVerticalSpeed,
        groundSpeedMs: Math.hypot(newLinvel.x, newLinvel.z),
        rollDeg,
        pitchDeg,
        crosswindMs: computeCrosswindMs(this.lastWindWorld, newRot),
      };
    }
    this.wasGrounded = groundedNow;

    if (!this.crashed && !this.landed) {
      if (groundedNow && this.lastVerticalSpeed < -8) {
        this.crashed = true;
        this.state = 'crashed';
      } else if (groundedNow && this.elapsedS > 1.2 && this.maxAltitudeM > 1.5 && speedNow < 6) {
        this.landed = true;
        this.state = 'stopped';
        const telemetryForValidation: LandingTelemetry = this.touchdownTelemetry ?? {
          verticalSpeedMs: this.lastVerticalSpeed,
          groundSpeedMs: speedNow,
          rollDeg: 0,
          pitchDeg: 0,
          crosswindMs: 0,
        };
        const landingResult = validateLanding(telemetryForValidation, this.runwayConditions);
        this.landingQuality = landingResult.qualityScore;
        this.landingFailures = landingResult.failures;
      } else if (!groundedNow && this.maxAltitudeM > 1.5) {
        this.state = 'airborne';
      } else if (groundedNow) {
        this.state = this.elapsedS < 0.3 ? 'prestart' : 'taxi';
      }
    }
    this.lastVerticalSpeed = verticalSpeed;

    return this.getTelemetry(speedNow, altitudeNow, groundedNow);
  }

  private getTelemetry(speedNow: number, altitudeNow: number, onGround: boolean): FlightTelemetry {
    const rotation = this.body.rotation();
    const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(new THREE.Quaternion(rotation.x, rotation.y, rotation.z, rotation.w));
    const headingDeg = (Math.atan2(forward.x, forward.z) * 180 / Math.PI + 360) % 360;
    return {
      state: this.state,
      speedMs: speedNow,
      altitudeM: altitudeNow,
      aoaDeg: 0,
      distanceM: this.distanceM,
      maxAltitudeM: this.maxAltitudeM,
      maxSpeedMs: this.maxSpeedMs,
      fuelFraction: this.fuelCapacityL > 0 ? this.fuelL / this.fuelCapacityL : 0,
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
      position: [this.body.translation().x, this.body.translation().y, this.body.translation().z],
      headingDeg,
      airspeedMs: speedNow,
      groundSpeedMs: speedNow,
      verticalSpeedMs: this.body.linvel().y,
      pitchDeg: 0,
      rollDeg: 0,
      throttle: this.throttleSmoothed,
      engineOn: this.rpm > 0,
      outOfFuel: this.fuelL <= 0,
      stallWarning: false,
      stalled: false,
      stallSpeedMs: 12,
      wheelsOnGround: onGround ? 3 : 0,
      gForce: 1,
      lastTouchdownVsMs: null,
      crashReason: this.crashed ? 'hardLanding' : null,
    };
  }
}
