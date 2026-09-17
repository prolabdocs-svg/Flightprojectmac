// Core flight simulation: applies aerodynamic forces + propulsion to a single dynamic
// rigid body per tick (spec sections 8, 9, 34). Runs at a fixed 60Hz timestep.

import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import type { ResolvedAircraft } from '../content/assembly';
import { airDensityAtAltitude, dynamicPressure, liftDragCurve } from './aero';
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
}

const FIXED_DT = 1 / 60;
const GROUND_LEVEL_Y = 0;
// The main collider's half-height (see halfExtents.y below): the body origin rests at
// this height above the ground plane when the aircraft's belly/wheels are touching down.
// "altitude" is reported/thresholded relative to the belly, not the rigid-body origin,
// otherwise a resting aircraft never reads as grounded (a real bug that broke taxi/
// landing/crash state detection: 0.8 m of body-origin height is always > the old 0.6 m
// grounded threshold).
const GROUND_REST_OFFSET_M = 0.8;

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

  constructor(world: RAPIER.World, aircraft: ResolvedAircraft, spawnPos: THREE.Vector3, spawnHeadingDeg: number) {
    this.world = world;
    this.aircraft = aircraft;
    this.spawnPos = spawnPos.clone();
    this.spawnHeadingDeg = spawnHeadingDeg;
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
  }

  /** Advances one fixed physics tick. Wind is a world-space m/s vector. */
  step(controls: ResolvedControls, windWorld: THREE.Vector3) {
    const dt = FIXED_DT;
    this.elapsedS += dt;

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

    const altitude = Math.max(0, pos.y - GROUND_LEVEL_Y - GROUND_REST_OFFSET_M);
    const rho = airDensityAtAltitude(altitude);
    const onGround = altitude < 0.3;

    if (!this.crashed && !this.landed) {
      // --- Fuel & engine ---
      const throttleTarget = controls.engineOn ? controls.throttle : 0;
      this.throttleSmoothed += (throttleTarget - this.throttleSmoothed) * Math.min(1, dt / Math.max(0.05, this.aircraft.engine?.responseTime ?? 0.3));

      if (this.aircraft.engine && this.fuelL > 0 && controls.engineOn) {
        const burnRate = (this.aircraft.engine.maxPowerKw / 9) * 1.1 * this.throttleSmoothed; // L/min approx
        this.fuelL = Math.max(0, this.fuelL - (burnRate / 60) * dt);
      }
      this.rpm = this.aircraft.engine
        ? this.aircraft.engine.idleRpm + this.throttleSmoothed * (this.aircraft.engine.redlineRpm - this.aircraft.engine.idleRpm)
        : 0;

      // --- Propulsion ---
      if (this.aircraft.engine && this.fuelL > 0) {
        const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(quat);
        const availableW = this.aircraft.engine.maxPowerKw * 1000 * this.throttleSmoothed * this.aircraft.engine.propEfficiency;
        const forwardSpeed = Math.max(0, bodyVel.dot(forward));
        const staticThrust = availableW / 30;
        const thrustN = staticThrust / (1 + forwardSpeed / 15);
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

        let deflectionDeg = 0;
        if (surf.controlAxis === 'pitch') {
          deflectionDeg = controls.pitch * (surf.maxDeflectionDeg ?? 0) * (surf.controlAuthority ?? 1);
        } else if (surf.controlAxis === 'roll') {
          const sign = surf.id.endsWith('_l') ? -1 : 1;
          deflectionDeg = controls.roll * (surf.maxDeflectionDeg ?? 0) * sign * (surf.controlAuthority ?? 1);
        } else if (surf.controlAxis === 'yaw') {
          deflectionDeg = controls.rudder * (surf.maxDeflectionDeg ?? 0) * (surf.controlAuthority ?? 1);
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
          aoaDeg = (Math.atan2(-verticalFlow, Math.max(0.1, forwardSpeed)) * 180) / Math.PI + deflectionDeg;
          liftDirWorld = new THREE.Vector3(0, 1, 0).applyQuaternion(quat);
        }

        const { cl, cd } = liftDragCurve(aoaDeg, surf.stallPositiveDeg, surf.stallNegativeDeg, surf.parasiticCd, surf.inducedDragFactor);
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
        const speedFactor = onGround ? 1 : Math.min(1, forwardSpeed / 12);
        const stabilityGain = 1.6 * speedFactor * this.aircraft.totalMassKg;

        // Damping: oppose pitch/roll rate only (leave yaw free for rudder turns).
        const yawComponent = worldUp.clone().multiplyScalar(bodyAngVel.dot(worldUp));
        const pitchRollRate = bodyAngVel.clone().sub(yawComponent);
        const dampingGain = 5.0 * this.aircraft.totalMassKg;

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

      // --- Wheel brake (simple linear damping boost while on ground) ---
      // Damaged/detached gear (damageSystem.ts) makes braking less effective, standing in
      // for a busted wheel/strut without touching the rest of the ground-roll tuning.
      const gearPenalty = getGroundHandlingPenalty(this.damageState);
      if (onGround && controls.brake) {
        const decel = bodyVel.clone().multiplyScalar((-2.5 / gearPenalty) * this.aircraft.totalMassKg);
        this.body.addForce({ x: decel.x, y: 0, z: decel.z }, true);
      }

      if (controls.chuteDeployed && altitude > 2) {
        this.body.setLinearDamping(2.0);
      }
    }

    this.world.step();

    // --- Safety clamps (spec 8.3 allows limiting extreme high-speed/contact events).
    // These are a last-resort net on top of the tuned constants above, not a substitute
    // for them: normal flight should stay well inside these bounds.
    {
      const av = this.body.angvel();
      const angSpeed = Math.hypot(av.x, av.y, av.z);
      const maxAngSpeed = 6; // rad/s
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
    const newLinvel = this.body.linvel();
    const speedNow = Math.hypot(newLinvel.x, newLinvel.y, newLinvel.z);
    const altitudeNow = Math.max(0, newPos.y - GROUND_LEVEL_Y - GROUND_REST_OFFSET_M);
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
    }
    this.wasGrounded = groundedNow;

    if (!this.crashed && !this.landed) {
      if (groundedNow && this.lastVerticalSpeed < -8) {
        this.crashed = true;
        this.state = 'crashed';
      } else if (groundedNow && this.elapsedS > 1.2 && this.maxAltitudeM > 1.5 && speedNow < 6) {
        this.landed = true;
        this.state = 'stopped';
        this.landingQuality = Math.max(0, 1 - Math.abs(this.lastVerticalSpeed) / 6);
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
    };
  }
}
