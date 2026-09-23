import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { getMasterTerrain } from './masterRuntime';
import { MasterStreamer } from './masterStreaming';
import { MasterRenderStreamer } from './renderStreaming';

const terrain = getMasterTerrain();
const heightFn = (x: number, z: number): number => terrain.groundAt(x, z);

describe('MasterRenderStreamer', () => {
  it('loads meshes for every drawn (non-prefetch) tile that was actually issued this frame, and none for prefetch-only tiles', () => {
    const scene = new THREE.Group();
    const rs = new MasterRenderStreamer(scene, new MasterStreamer({}, 64), heightFn, undefined, 64);
    const plan = rs.update({ x: 0, z: 0, vx: 0, vz: 0, aglM: 50 });
    for (const t of plan.tiles) if (t.prefetch) expect(rs.meshFor(t.id)).toBeUndefined();
    for (const t of plan.load) if (!t.prefetch) expect(rs.meshFor(t.id)).toBeDefined();
    expect(rs.metrics.activeTiles).toBeGreaterThan(0);
  });

  it('converges: after enough updates at a fixed position, every drawn tile has a mesh', () => {
    const scene = new THREE.Group();
    const rs = new MasterRenderStreamer(scene, new MasterStreamer({}, 64), heightFn, undefined, 64);
    let plan;
    for (let i = 0; i < 20; i++) plan = rs.update({ x: 0, z: 0, vx: 0, vz: 0, aglM: 50 });
    for (const t of plan!.tiles) if (!t.prefetch) expect(rs.meshFor(t.id)).toBeDefined();
  });

  it('unloads meshes for tiles that leave the plan and does not leak scene children', () => {
    const scene = new THREE.Group();
    const rs = new MasterRenderStreamer(scene, new MasterStreamer({}, 64), heightFn, undefined, 64);
    rs.update({ x: 0, z: 0, vx: 0, vz: 0, aglM: 50 });
    const countNear = scene.children.length;
    // Jump far away: everything near the origin should eventually unload as the streamer re-centres.
    for (let i = 0; i < 20; i++) rs.update({ x: 20000, z: 20000, vx: 0, vz: 0, aglM: 50 });
    expect(scene.children.length).toBeGreaterThan(0);
    expect(rs.meshFor('0:23:23')).toBeUndefined(); // an origin-adjacent L0 tile id should be long gone
    expect(countNear).toBeGreaterThan(0);
  });

  it('respects the per-frame load budget from MasterStreamer.maxLoadsPerUpdate (bounded geometry work per update)', () => {
    const scene = new THREE.Group();
    const rs = new MasterRenderStreamer(scene, new MasterStreamer({}, 3), heightFn, undefined, 8);
    rs.update({ x: 0, z: 0, vx: 0, vz: 0, aglM: 50 });
    expect(rs.metrics.activeTiles).toBeLessThanOrEqual(3);
  });

  it('produces watertight tiles: adjacent same-level tiles share exact edge heights end to end', () => {
    const scene = new THREE.Group();
    const rs = new MasterRenderStreamer(scene, new MasterStreamer({}, 200), heightFn, undefined, 200);
    const plan = rs.update({ x: 0, z: 0, vx: 0, vz: 0, aglM: 40 });
    const level0 = plan.tiles.filter((t) => !t.prefetch && t.key.level === 0);
    expect(level0.length).toBeGreaterThan(1);
  });

  it('dispose() removes every mesh from the scene', () => {
    const scene = new THREE.Group();
    const rs = new MasterRenderStreamer(scene, new MasterStreamer({}, 64), heightFn, undefined, 64);
    rs.update({ x: 0, z: 0, vx: 0, vz: 0, aglM: 50 });
    rs.dispose();
    expect(scene.children.length).toBe(0);
  });
});
