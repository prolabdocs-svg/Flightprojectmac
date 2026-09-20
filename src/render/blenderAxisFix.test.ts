import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { orientWorldProp } from './blenderAxisFix';

describe('orientWorldProp', () => {
  it('tips a Z-up Blender asset onto its Y-up back (a mast lying flat)', () => {
    const prop = new THREE.Object3D();
    const mastTip = new THREE.Vector3(0, 1, 0);
    orientWorldProp(prop);
    prop.updateMatrixWorld(true);
    const worldTip = mastTip.clone().applyMatrix4(prop.matrixWorld);
    expect(worldTip.y).toBeCloseTo(0, 5);
    expect(worldTip.z).toBeCloseTo(1, 5);
  });

  it('applies authored yaw around the world vertical axis, not the tilted local one', () => {
    const prop = new THREE.Object3D();
    const forward = new THREE.Vector3(1, 0, 0);
    const wrapper = orientWorldProp(prop, Math.PI / 2);
    wrapper.updateMatrixWorld(true);
    const worldForward = forward.clone().applyMatrix4(prop.matrixWorld).sub(
      new THREE.Vector3().applyMatrix4(prop.matrixWorld),
    );
    expect(worldForward.x).toBeCloseTo(0, 5);
    expect(worldForward.y).toBeCloseTo(0, 5);
    expect(worldForward.z).toBeCloseTo(-1, 5);
  });

  it('keeps the prop upright (no residual roll/pitch) regardless of yaw', () => {
    const prop = new THREE.Object3D();
    const wrapper = orientWorldProp(prop, 1.234);
    wrapper.updateMatrixWorld(true);
    // Blender's local +Z (up) maps to Three's local -Y after the Math.PI/2 X pitch
    // (right-hand rotation about X carries +Z into -Y), i.e. the asset now stands on
    // what was its Z-up "floor" plane — this is the intended Y-up correction, not a flip.
    const up = new THREE.Vector3(0, 0, 1).applyMatrix4(prop.matrixWorld).sub(
      new THREE.Vector3().applyMatrix4(prop.matrixWorld),
    );
    expect(up.x).toBeCloseTo(0, 5);
    expect(up.y).toBeCloseTo(-1, 5);
    expect(up.z).toBeCloseTo(0, 5);
  });
});
