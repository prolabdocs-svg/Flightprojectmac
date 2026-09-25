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

const FPV_FLIP = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI);
// Cockpit framing: a wider fixed lens and the head tipped slightly down, so the horizon sits in the
// upper third and the Kestrel's primaries in the lower third without the player looking down.
const FPV_FOV = 72;
const FPV_PITCH_RAD = -9 * Math.PI / 180;

export class ChaseCamera {
  readonly camera: THREE.PerspectiveCamera;
  fpv = false;
  /** Pilot eye in aircraft-local space (+Z forward); FlightScene sets it from the pilot mesh. */
  readonly eye = new THREE.Vector3(0.24, 1.3, 0.85);
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
  /** Free-look offsets from pointer drag (radians); ease back to 0 when not dragging. */
  lookYaw = 0;
  lookPitch = 0;
  dragging = false;
  private readonly lookAxis = new THREE.Vector3();
  private readonly lookQuat = new THREE.Quaternion();
  private readonly lookEuler = new THREE.Euler(0, 0, 0, 'YXZ');

  /** Drag delta in pixels → yaw/pitch. */
  drag(dxPx: number, dyPx: number) {
    this.lookYaw = THREE.MathUtils.euclideanModulo(this.lookYaw - dxPx * 0.006 + Math.PI, Math.PI * 2) - Math.PI;
    this.lookPitch = THREE.MathUtils.clamp(this.lookPitch + dyPx * 0.006, -1.2, 1.2);
  }

  constructor() {
    this.camera = new THREE.PerspectiveCamera(BASE_FOV, 1, 0.1, 6000);
  }

  /** Floating-origin rebase: move the smoothed camera state by the same x/z delta as the world. */
  shift(dx: number, dz: number) {
    for (const v of [this.pos, this.lastPos, this.lookTarget, this.camera.position]) { v.x -= dx; v.z -= dz; }
  }

  update(position: THREE.Vector3, quaternion: THREE.Quaternion, dtS: number, input: ChaseCameraInput) {
    const dt = Math.max(0, dtS);
    // Inertial velocity from consecutive poses (render-side only; never fed back to the simulation).
    if (this.hasLastPos && dt > 1e-4) this.velocity.copy(position).sub(this.lastPos).multiplyScalar(1 / dt).clampLength(0, 120);
    this.lastPos.copy(position);
    this.hasLastPos = true;
    if (!this.dragging) {
      const k = Math.exp(-2.5 * dt);
      this.lookYaw *= k; this.lookPitch *= k;
    }
    if (this.fpv) {
      // Rigid cockpit mount; keep the chase state tracking so switching back doesn't swoop in from afar.
      this.pos.copy(position).add(this.behind.set(0, 5.6, -13.4).applyQuaternion(quaternion));
      this.lookTarget.copy(position);
      this.camera.position.copy(this.desiredPos.copy(this.eye).applyQuaternion(quaternion).add(position));
      this.camera.quaternion.copy(quaternion).multiply(FPV_FLIP)
        .multiply(this.lookQuat.setFromEuler(this.lookEuler.set(FPV_PITCH_RAD - this.lookPitch, this.lookYaw, 0)));
      if (this.camera.fov !== FPV_FOV) { this.camera.fov = FPV_FOV; this.camera.updateProjectionMatrix(); }
      return;
    }
    this.currentG += (input.gForce - this.currentG) * (1 - Math.exp(-4 * dt));
    // Portrait screens need a centered, longer chase vector; the desktop three-quarter
    // angle otherwise crops the wing and makes the aircraft read as UI-adjacent clutter.
    const portrait = this.camera.aspect < 0.8;
    const behind = this.behind
      .set(portrait ? -2.8 : -7.2, portrait ? 7.2 : 5.6, portrait ? -21 : -13.4)
      .applyQuaternion(quaternion)
      .applyAxisAngle(this.lookAxis.set(0, 1, 0), this.lookYaw);
    this.lookAxis.set(0, 1, 0).cross(behind).normalize();
    if (this.lookAxis.lengthSq() > 0.5) behind.applyAxisAngle(this.lookAxis, -this.lookPitch);
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
