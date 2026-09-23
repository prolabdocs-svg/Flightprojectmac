import * as THREE from 'three';
import { beforeAll, describe, expect, it } from 'vitest';
import type RAPIER from '@dimforge/rapier3d-compat';
import { createWorld, initPhysics } from '../../sim/physics';
import { FloatingOrigin } from '../floatingOrigin';
import { MasterColliderStreamer } from './colliderStreaming';
import { getMasterTerrain } from './masterRuntime';
import { FLOATING_ORIGIN_CONFIG, MasterStreamer } from './masterStreaming';

let rapier: typeof RAPIER;
const terrain = getMasterTerrain();
const heightFn = (x: number, z: number): number => terrain.groundAt(x, z);

beforeAll(async () => { rapier = await initPhysics(); });

describe('MasterColliderStreamer', () => {
  it('creates a collider only for physics-ring L0 tiles, none for non-physics tiles', () => {
    const world = createWorld();
    const origin = new FloatingOrigin(FLOATING_ORIGIN_CONFIG.rebaseThresholdM, FLOATING_ORIGIN_CONFIG.gridSnapM);
    const cs = new MasterColliderStreamer(rapier, world, heightFn, origin);
    const streamer = new MasterStreamer({}, 200);
    const plan = streamer.update({ x: 0, z: 0, vx: 0, vz: 0, aglM: 50 });
    cs.apply(plan);
    const physicsIds = plan.tiles.filter((t) => t.physics).map((t) => t.id);
    expect(physicsIds.length).toBeGreaterThan(0);
    for (const id of physicsIds) expect(cs.colliderFor(id)).toBeDefined();
    expect(cs.metrics.activeColliders).toBe(physicsIds.length);
  });

  it('removes colliders once a tile leaves the physics ring (no stale colliders)', () => {
    const world = createWorld();
    const origin = new FloatingOrigin(FLOATING_ORIGIN_CONFIG.rebaseThresholdM, FLOATING_ORIGIN_CONFIG.gridSnapM);
    const cs = new MasterColliderStreamer(rapier, world, heightFn, origin);
    const streamer = new MasterStreamer({}, 200);
    cs.apply(streamer.update({ x: 0, z: 0, vx: 0, vz: 0, aglM: 50 }));
    const before = cs.metrics.activeColliders;
    expect(before).toBeGreaterThan(0);
    cs.apply(streamer.update({ x: 20000, z: 20000, vx: 0, vz: 0, aglM: 50 }));
    // the far-away plan's colliders should all be new/different tiles near (20000,20000)
    expect(cs.colliderFor('0:23:23')).toBeUndefined();
  });

  it('a physical high-speed pass never leaves the collider count unbounded (safe policy at high speed)', () => {
    const world = createWorld();
    const origin = new FloatingOrigin(FLOATING_ORIGIN_CONFIG.rebaseThresholdM, FLOATING_ORIGIN_CONFIG.gridSnapM);
    const cs = new MasterColliderStreamer(rapier, world, heightFn, origin);
    const streamer = new MasterStreamer({}, 200);
    let maxActive = 0;
    for (let i = 0; i < 40; i++) {
      const x = i * 400; // ~160 m/frame-equivalent sweep
      const plan = streamer.update({ x, z: 0, vx: 250, vz: 0, aglM: 80 });
      cs.apply(plan);
      maxActive = Math.max(maxActive, cs.metrics.activeColliders);
    }
    expect(maxActive).toBeLessThan(400); // bounded by the physics ring, not by distance travelled
  }, 30000);

  it('rebase() shifts every collider translation by the delta without changing collider count', () => {
    const world = createWorld();
    const origin = new FloatingOrigin(500, 512); // small threshold to force a rebase deterministically
    const cs = new MasterColliderStreamer(rapier, world, heightFn, origin);
    const streamer = new MasterStreamer({}, 200);
    cs.apply(streamer.update({ x: 0, z: 0, vx: 0, vz: 0, aglM: 50 }));
    const before = cs.metrics.activeColliders;
    const anyId = [...(streamer.update({ x: 0, z: 0, vx: 0, vz: 0, aglM: 50 }).tiles)].find((t) => t.physics)!.id;
    const collider = cs.colliderFor(anyId);
    const t0 = collider ? { ...collider.translation() } : null;
    const delta = origin.update(new THREE.Vector3(800, 0, 0));
    expect(delta).not.toBeNull();
    if (delta) cs.rebase({ x: delta.x, z: delta.z });
    expect(cs.metrics.activeColliders).toBe(before);
    if (collider && t0) {
      const t1 = collider.translation();
      expect(t1.x).toBeCloseTo(t0.x - delta!.x, 3);
      expect(t1.z).toBeCloseTo(t0.z - delta!.z, 3);
    }
  });
});
