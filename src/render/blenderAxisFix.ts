import * as THREE from 'three';

/**
 * Wraps a Blender-exported (Z-up) GLB in a Y-up parent so it can be placed with a plain
 * world-space yaw. Applying rotation.x and rotation.y directly on the same object is not
 * equivalent to this: Three's Euler composes axes in local (rotated) space, so a yaw set
 * after the Z-up->Y-up pitch would spin around the asset's now-tilted local Y, not the
 * world's vertical axis. Two nested objects — inner pitch, outer yaw — keeps each rotation
 * on its own unrotated axis.
 */
export function orientWorldProp(prop: THREE.Object3D, rotationY = 0): THREE.Group {
  prop.rotation.set(Math.PI / 2, 0, 0);
  const wrapper = new THREE.Group();
  wrapper.rotation.y = rotationY;
  wrapper.add(prop);
  return wrapper;
}
