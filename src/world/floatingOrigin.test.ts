import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { FloatingOrigin } from './floatingOrigin';

describe('FloatingOrigin', () => {
  it('keeps local position bounded over a 50+ km flight', () => {
    const fo = new FloatingOrigin(5000);
    const global = new THREE.Vector3(0, 0, 0);
    for (let i = 0; i < 500; i++) {
      global.x += 100; // 50,000 m total
      fo.update(global);
      expect(fo.toLocal(global).length()).toBeLessThan(5000);
    }
    expect(fo.toGlobal(fo.toLocal(global)).distanceTo(global)).toBeLessThan(1e-6);
  });

  it('shifts registered objects by the rebase delta, preserving relative offsets', () => {
    const fo = new FloatingOrigin(1000);
    const plane = new THREE.Object3D();
    const landmark = new THREE.Object3D();
    landmark.position.set(200, 0, 0);
    fo.register(plane);
    fo.register(landmark);

    const globalPlane = new THREE.Vector3(1500, 0, 0);
    plane.position.copy(fo.toLocal(globalPlane));
    const relativeBefore = landmark.position.clone().sub(plane.position).length();

    const delta = fo.update(globalPlane);

    expect(delta).not.toBeNull();
    plane.position.copy(fo.toLocal(globalPlane));
    const relativeAfter = landmark.position.clone().sub(plane.position).length();
    expect(relativeAfter).toBeCloseTo(relativeBefore, 5);
  });

  it('does not rebase while under the threshold', () => {
    const fo = new FloatingOrigin(5000);
    const global = new THREE.Vector3(4000, 0, 0);
    expect(fo.update(global)).toBeNull();
    expect(fo.originOffset.length()).toBe(0);
  });

  it('unregister stops an object from being shifted', () => {
    const fo = new FloatingOrigin(1000);
    const obj = new THREE.Object3D();
    fo.register(obj);
    fo.unregister(obj);
    fo.update(new THREE.Vector3(1500, 0, 0));
    expect(obj.position.length()).toBe(0);
  });
});
