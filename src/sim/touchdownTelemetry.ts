// Pure helpers for turning a rigid body's orientation + the ambient wind into the
// touchdown telemetry validateLanding() (src/world/landingValidator.ts) expects. Kept
// free of Rapier/FlightController so they can be unit tested in isolation.

import * as THREE from 'three';

export interface QuatLike {
  x: number;
  y: number;
  z: number;
  w: number;
}

/**
 * Extracts bank (roll) and nose-up/down (pitch) angles, in degrees, from a body
 * orientation quaternion. Assumes the aircraft's local forward axis is +Z, local up is
 * +Y and local right is +X (matches FlightController's rigid body setup).
 *
 * pitchDeg: positive = nose up.
 * rollDeg: positive = right wing down.
 */
export function computeRollPitchDeg(quat: QuatLike): { rollDeg: number; pitchDeg: number } {
  const q = new THREE.Quaternion(quat.x, quat.y, quat.z, quat.w);
  const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(q);
  const right = new THREE.Vector3(1, 0, 0).applyQuaternion(q);

  const pitchDeg = THREE.MathUtils.radToDeg(Math.asin(THREE.MathUtils.clamp(forward.y, -1, 1)));

  const rightHorizontalLen = Math.hypot(right.x, right.z);
  const rollDeg = THREE.MathUtils.radToDeg(Math.atan2(-right.y, rightHorizontalLen));

  return { rollDeg, pitchDeg };
}

/**
 * Signed lateral wind speed (m/s) relative to the aircraft's heading: the component of
 * the world-space wind vector along the body's local right axis. Magnitude is what
 * validateLanding() cares about, but the sign is kept for potential future use (e.g.
 * "gusting from the right").
 */
export function computeCrosswindMs(windWorld: THREE.Vector3, quat: QuatLike): number {
  const q = new THREE.Quaternion(quat.x, quat.y, quat.z, quat.w);
  const right = new THREE.Vector3(1, 0, 0).applyQuaternion(q);
  return windWorld.dot(right);
}
