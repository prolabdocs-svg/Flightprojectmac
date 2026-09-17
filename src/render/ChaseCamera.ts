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

export class ChaseCamera {
  readonly camera: THREE.PerspectiveCamera;
  private lookTarget = new THREE.Vector3();
  private pos = new THREE.Vector3(0, 6, -15);
  private shakeTimeRemainingS = 0;
  private shakeMagnitude = 0;
  private currentFov = BASE_FOV;
  private currentRollLean = 0;
  private readonly behind = new THREE.Vector3();
  private readonly desiredPos = new THREE.Vector3();
  private readonly ahead = new THREE.Vector3();
  private readonly desiredLook = new THREE.Vector3();
  private readonly shake = new THREE.Vector3();
  private readonly up = new THREE.Vector3();

  constructor() {
    this.camera = new THREE.PerspectiveCamera(BASE_FOV, 1, 0.1, 6000);
  }

  update(position: THREE.Vector3, quaternion: THREE.Quaternion, dtS: number, input: ChaseCameraInput) {
    const dt = Math.max(0, dtS);
    const behind = this.behind.set(-5.2, 3.8, -11.8).applyQuaternion(quaternion);
    const desiredPos = this.desiredPos.copy(position).add(behind);
    this.pos.lerp(desiredPos, 1 - Math.exp(-CHASE_POSITION_RESPONSE * dt));
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
