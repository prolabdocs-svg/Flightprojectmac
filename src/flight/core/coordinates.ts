// Single coordinate convention for the whole flight model (spec section 3).
//
//   WORLD (three.js / Rapier): +Y up, right-handed, +Z = north. Gravity = -Y.
//   BODY  (aircraft-fixed, origin = model datum): +Z = nose, +Y = up, +X = LEFT wing.
//         Right-handed (X x Y = Z), identical to the rendered aircraft mesh, so the Rapier
//         quaternion maps BODY -> WORLD with no extra rotation.
//
// Aeronautical angles in this convention:
//   alpha  = atan2(-vy, vz)                  > 0 : airflow arrives from below (nose above flow)
//   beta   = atan2(vRight, hypot(vy, vz))     > 0 : velocity has a component toward the RIGHT wing
//                                                  (relative wind from the right, nose left of flow)
//   p = +wz  roll rate, right wing down positive
//   q = -wx  pitch rate, nose up positive
//   r = -wy  yaw rate, nose right positive
// Deflection sign convention (all surfaces): delta > 0 INCREASES the element's lift along +n
// (trailing edge down on a horizontal surface). The control mixer owns the mapping from pilot
// intent to that sign.

import * as THREE from 'three';

export type Vec3 = [number, number, number];

/** Cached BODY<->WORLD rotation for one physics tick. */
export class BodyFrame {
  readonly q = new THREE.Quaternion();
  readonly qInv = new THREE.Quaternion();

  set(x: number, y: number, z: number, w: number): this {
    this.q.set(x, y, z, w).normalize();
    this.qInv.copy(this.q).invert();
    return this;
  }

  /** world vector -> body vector (velocity, angular velocity, wind...). */
  toBody(worldVec: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 {
    return out.copy(worldVec).applyQuaternion(this.qInv);
  }

  /** body vector -> world vector (force, torque, axes). */
  toWorld(bodyVec: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 {
    return out.copy(bodyVec).applyQuaternion(this.q);
  }
}

/** Velocity of a body-fixed point r (relative to the CG): v = vCG + w x r (all in BODY axes). */
export function pointVelocityBody(vCg: THREE.Vector3, wBody: THREE.Vector3, r: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 {
  return out.copy(wBody).cross(r).add(vCg);
}

export function angleOfAttack(vBody: THREE.Vector3): number {
  return Math.atan2(-vBody.y, vBody.z);
}

export function sideslip(vBody: THREE.Vector3): number {
  return Math.atan2(-vBody.x, Math.hypot(vBody.y, vBody.z));
}

/** Body angular rates (p, q, r) in the aeronautical sense from a body-axes angular velocity. */
export function bodyRates(wBody: THREE.Vector3): { p: number; q: number; r: number } {
  return { p: wBody.z, q: -wBody.x, r: -wBody.y };
}

/** Euler-style attitude for display/telemetry: pitch (nose up +), roll (right wing down +). */
export function attitude(frame: BodyFrame, fwd: THREE.Vector3, left: THREE.Vector3, up: THREE.Vector3) {
  fwd.set(0, 0, 1).applyQuaternion(frame.q);
  left.set(1, 0, 0).applyQuaternion(frame.q);
  up.set(0, 1, 0).applyQuaternion(frame.q);
  return {
    pitchRad: Math.asin(Math.max(-1, Math.min(1, fwd.y))),
    rollRad: Math.atan2(left.y, up.y),
  };
}
