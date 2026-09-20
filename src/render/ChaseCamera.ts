// Chase camera (game-feel owner). FlightScene only forwards the interpolated aircraft pose
// plus this small flight-state struct; all framing/FOV/shake logic lives here.

import * as THREE from 'three';

export interface ChaseCameraInput {
  speedMs: number;
  onGround: boolean;
  gForce: number;
  stalled: boolean;
}

const CHASE_POSITION_RESPONSE = 3.7;
const CHASE_LOOK_RESPONSE = 9.75;
const BASE_FOV = 62;
const MAX_FOV = 74;
const FOV_SPEED_MIN_MS = 12;
const FOV_SPEED_MAX_MS = 55;
// Flight-path awareness (spec section 35): the camera looks partly along the velocity vector so
// sideslip/AoA are visible, drops a little under positive G, and stiffens near the ground.
const VELOCITY_LOOK_MIN_MS = 8;
const VELOCITY_LOOK_MAX_MS = 25;
const VELOCITY_LOOK_BLEND = 0.55;
const G_DROP_M = 0.35;
const GROUND_STIFFEN = 1.8;

export class ChaseCamera {
  readonly camera: THREE.PerspectiveCamera;
  private lookTarget = new THREE.Vector3();
  private pos = new THREE.Vector3(0, 6, -15);
  private shakeTimeRemainingS = 0;
  private shakeMagnitude = 0;
  private currentFov = BASE_FOV;
  private currentRollLean = 0;
  private readonly lastPos = new THREE.Vector3();
  private hasLastPos = false;
  private readonly velocity = new THREE.Vector3();
  private readonly velDir = new THREE.Vector3();
  private currentG = 1;
  private readonly behind = new THREE.Vector3();
  private readonly desiredPos = new THREE.Vector3();
  private readonly ahead = new THREE.Vector3();
  private readonly desiredLook = new THREE.Vector3();
  private readonly shake = new THREE.Vector3();
  private readonly up = new THREE.Vector3();
  private readonly tmpLook = new THREE.Vector3();

  constructor() {
    this.camera = new THREE.PerspectiveCamera(BASE_FOV, 1, 0.1, 6000);
  }

  update(position: THREE.Vector3, quaternion: THREE.Quaternion, dtS: number, input: ChaseCameraInput) {
    const dt = Math.max(0, dtS);
    // Inertial velocity from consecutive poses (render-side only; never fed back to the simulation).
    if (this.hasLastPos && dt > 1e-4) this.velocity.copy(position).sub(this.lastPos).multiplyScalar(1 / dt).clampLength(0, 120);
    this.lastPos.copy(position);
    this.hasLastPos = true;
    this.currentG += (input.gForce - this.currentG) * (1 - Math.exp(-4 * dt));
    // Portrait screens need a centered, longer chase vector; the desktop three-quarter
    // angle otherwise crops the wing and makes the aircraft read as UI-adjacent clutter.
    const portrait = this.camera.aspect < 0.8;
    const behind = this.behind
      .set(portrait ? -2.8 : -7.2, portrait ? 7.2 : 5.6, portrait ? -21 : -13.4)
      .applyQuaternion(quaternion);
    const desiredPos = this.desiredPos.copy(position).add(behind);
    // Positive G sinks the camera slightly (heavy pull-ups feel heavy); zero/negative G lifts it.
    desiredPos.y -= THREE.MathUtils.clamp(this.currentG - 1, -1.5, 3) * G_DROP_M;
    // Landing stabilisation: near the ground at low speed the chase point stops floating.
    const stiffen = input.onGround && input.speedMs < 12 ? GROUND_STIFFEN : 1;
    this.pos.lerp(desiredPos, 1 - Math.exp(-CHASE_POSITION_RESPONSE * stiffen * dt));
    this.camera.position.copy(this.pos);

    const speedT = THREE.MathUtils.clamp((input.speedMs - FOV_SPEED_MIN_MS) / (FOV_SPEED_MAX_MS - FOV_SPEED_MIN_MS), 0, 1);
    const targetFov = THREE.MathUtils.lerp(BASE_FOV, MAX_FOV, speedT);
    this.currentFov = THREE.MathUtils.lerp(this.currentFov, targetFov, 1 - Math.pow(0.001, dt));
    if (Math.abs(this.camera.fov - this.currentFov) > 0.01) {
      this.camera.fov = this.currentFov;
      this.camera.updateProjectionMatrix();
    }

    this.up.set(0, 1, 0).applyQuaternion(quaternion);
    const aircraftRoll = Math.atan2(this.up.x, this.up.y);
    this.currentRollLean = THREE.MathUtils.lerp(this.currentRollLean, aircraftRoll, 1 - Math.pow(0.0005, dt));
    this.camera.up.set(Math.sin(this.currentRollLean * 0.35), Math.cos(this.currentRollLean * 0.35), 0);

    if (this.shakeTimeRemainingS > 0) {
      this.shakeTimeRemainingS = Math.max(0, this.shakeTimeRemainingS - dt);
      const amount = this.shakeMagnitude * this.shakeTimeRemainingS;
      this.shake.set((Math.random() - 0.5) * amount, (Math.random() - 0.5) * amount, (Math.random() - 0.5) * amount);
      this.camera.position.add(this.shake);
    }

    const ahead = this.ahead.set(0, 0.5, 6).applyQuaternion(quaternion);
    const desiredLook = this.desiredLook.copy(position).add(ahead);
    const vSpeed = this.velocity.length();
    if (vSpeed > VELOCITY_LOOK_MIN_MS) {
      const k = THREE.MathUtils.clamp((vSpeed - VELOCITY_LOOK_MIN_MS) / (VELOCITY_LOOK_MAX_MS - VELOCITY_LOOK_MIN_MS), 0, 1) * VELOCITY_LOOK_BLEND;
      this.velDir.copy(this.velocity).multiplyScalar(6 / vSpeed);
      desiredLook.lerp(this.tmpLook.copy(position).add(this.velDir), k);
    }
    this.lookTarget.lerp(desiredLook, 1 - Math.exp(-CHASE_LOOK_RESPONSE * dt));
    this.camera.lookAt(this.lookTarget);
  }

  triggerShake(magnitude: number, durationS = 0.4) {
    this.shakeMagnitude = magnitude;
    this.shakeTimeRemainingS = durationS;
  }

  resize(width: number, height: number) {
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }
}
