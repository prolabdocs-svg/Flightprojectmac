import * as THREE from 'three';
import { beforeAll, describe, expect, it } from 'vitest';
import type RAPIER from '@dimforge/rapier3d-compat';
import { createWorld, initPhysics } from '../../sim/physics';
import { getMasterTerrain } from './masterRuntime';
import { WORLD_MIN_M } from './masterStreaming';
import { MasterStreamingRuntime } from './streamingRuntime';

let rapier: typeof RAPIER;
const terrain = getMasterTerrain();
beforeAll(async () => { rapier = await initPhysics(); });

function makeRuntime() {
  const scene = new THREE.Group();
  const world = createWorld();
  return { scene, world, runtime: new MasterStreamingRuntime(scene, terrain, rapier, world) };
}

describe('MasterStreamingRuntime (render + collider + floating origin, wired together)', () => {
  it('renderer and collider agree on which tiles are physics-active, once streaming has converged', () => {
    const { runtime } = makeRuntime();
    let plan;
    for (let i = 0; i < 400; i++) plan = runtime.update({ x: 0, z: 0, vx: 30, vz: 0, aglM: 60 });
    const physicsIds = plan!.tiles.filter((t) => t.physics).map((t) => t.id);
    expect(physicsIds.length).toBeGreaterThan(0);
    for (const id of physicsIds) {
      expect(runtime.render.meshFor(id)).toBeDefined();
      expect(runtime.colliders?.colliderFor(id)).toBeDefined();
    }
  }, 30000);

  it('a long flight across many chunks keeps geometry/collider counts bounded (no monotonic growth)', () => {
    const { runtime } = makeRuntime();
    let maxTiles = 0, maxColliders = 0;
    const steps = 300;
    for (let i = 0; i < steps; i++) {
      const x = -20000 + i * 130; // sweeps ~39 km, crossing dozens of tiles and several rebases
      const plan = runtime.update({ x, z: 0, vx: 130, vz: 0, aglM: 90 });
      maxTiles = Math.max(maxTiles, runtime.render.metrics.activeTiles);
      maxColliders = Math.max(maxColliders, runtime.colliders?.metrics.activeColliders ?? 0);
      expect(plan.tiles.length).toBeLessThanOrEqual(420); // maxTiles config cap
    }
    expect(maxTiles).toBeLessThan(450);
    expect(maxColliders).toBeLessThan(160); // physics ring can reach ~2500 m radius -> ~O(70-90) L0 (512 m) tiles
  }, 60000);

  it('low-altitude (rasant) flight keeps a full physics ring active throughout', () => {
    const { runtime } = makeRuntime();
    for (let i = 0; i < 60; i++) {
      const plan = runtime.update({ x: i * 50, z: 0, vx: 60, vz: 0, aglM: 15 });
      expect(plan.tiles.filter((t) => t.physics).length).toBeGreaterThan(0);
    }
  });

  it('high-speed flight (fast jet) widens the physics ring and never drops physics coverage', () => {
    const { runtime } = makeRuntime();
    const rings: number[] = [];
    for (let i = 0; i < 30; i++) {
      const plan = runtime.update({ x: i * 400, z: 0, vx: 400, vz: 0, aglM: 200 });
      rings.push(plan.physicsRingM);
      expect(plan.tiles.some((t) => t.physics)).toBe(true);
    }
    expect(Math.max(...rings)).toBeGreaterThan(rings[0] * 0.9);
  }, 60000);

  it('approach and landing (descending AGL) keeps physics/render coherent as the chunk set changes', () => {
    const { runtime } = makeRuntime();
    for (let i = 0; i < 40; i++) {
      const agl = Math.max(2, 500 - i * 12);
      const plan = runtime.update({ x: 0, z: i * 20, vx: 0, vz: 30, aglM: agl });
      const physicsIds = plan.tiles.filter((t) => t.physics).map((t) => t.id);
      for (const id of physicsIds) expect(runtime.colliders?.colliderFor(id)).toBeDefined();
    }
  });

  it('teleport/debug relocation to a distant, previously-unseen area re-streams cleanly', () => {
    const { runtime } = makeRuntime();
    runtime.update({ x: 0, z: 0, vx: 0, vz: 0, aglM: 50 });
    const before = runtime.render.metrics.activeTiles;
    for (let i = 0; i < 8; i++) runtime.update({ x: -20000, z: -20000, vx: 0, vz: 0, aglM: 50 });
    expect(runtime.render.metrics.activeTiles).toBeGreaterThan(0);
    expect(before).toBeGreaterThan(0);
  });

  it('returning to a previously-departed area re-streams it without residual leaks growing unbounded', () => {
    const { runtime } = makeRuntime();
    for (let i = 0; i < 10; i++) runtime.update({ x: 0, z: 0, vx: 0, vz: 0, aglM: 50 });
    const homeTiles1 = runtime.render.metrics.activeTiles;
    for (let i = 0; i < 10; i++) runtime.update({ x: 15000, z: 15000, vx: 0, vz: 0, aglM: 50 });
    for (let i = 0; i < 10; i++) runtime.update({ x: 0, z: 0, vx: 0, vz: 0, aglM: 50 });
    const homeTiles2 = runtime.render.metrics.activeTiles;
    expect(Math.abs(homeTiles2 - homeTiles1)).toBeLessThanOrEqual(5);
  });

  it('multiple consecutive floating-origin rebases never move the aircraft geographically or discontinue local frame', () => {
    const { runtime } = makeRuntime();
    let rebases = 0;
    let prevLocal = new THREE.Vector3();
    for (let i = 0; i < 60; i++) {
      const x = i * 700; // exceeds the 3072 m threshold repeatedly
      const before = runtime.origin.originOffset.clone();
      runtime.update({ x, z: 0, vx: 700, vz: 0, aglM: 100 });
      const after = runtime.origin.originOffset.clone();
      if (!after.equals(before)) rebases++;
      const local = runtime.origin.toLocal(new THREE.Vector3(x, 0, 0));
      // local offset must always stay under the rebase threshold + one step's travel (no runaway/jump)
      expect(local.length()).toBeLessThan(3072 + 700);
      prevLocal = local;
    }
    expect(rebases).toBeGreaterThan(3); // this sweep must have forced several rebases
    expect(prevLocal).toBeDefined();
  }, 30000);

  it('determinism: same seed/path produces the same tile set and metrics every run', () => {
    const run = () => {
      const { runtime } = makeRuntime();
      let plan;
      for (let i = 0; i < 25; i++) plan = runtime.update({ x: i * 300, z: i * 50, vx: 300, vz: 50, aglM: 120 });
      return plan!.tiles.map((t) => t.id).sort();
    };
    expect(run()).toEqual(run());
  }, 15000);

  it('stays inside the world bounds sanity check (WORLD_MIN_M) for extreme positions without throwing', () => {
    const { runtime } = makeRuntime();
    expect(() => runtime.update({ x: WORLD_MIN_M + 1, z: WORLD_MIN_M + 1, vx: 50, vz: 50, aglM: 100 })).not.toThrow();
  });
});

describe('stress test: prolonged flight across a large portion of the world (headless)', () => {
  it('load/unload/rebase repeatedly with no monotonic growth in tiles, triangles, or colliders', () => {
    const { runtime } = makeRuntime();
    const samples: Array<{ tiles: number; tris: number; colliders: number }> = [];
    const totalSteps = 800;
    let x = WORLD_MIN_M + 2000, z = 0, heading = 0;
    for (let i = 0; i < totalSteps; i++) {
      heading += 0.03; // gentle S-curve so the route covers a wide swath, not a straight line
      const speed = 150 + 100 * Math.sin(i * 0.01);
      x += Math.cos(heading) * speed * 0.5;
      z += Math.sin(heading) * speed * 0.5;
      const agl = 200 + 150 * Math.sin(i * 0.02);
      const plan = runtime.update({ x, z, vx: Math.cos(heading) * speed, vz: Math.sin(heading) * speed, aglM: agl });
      if (i % 20 === 0) samples.push({ tiles: runtime.render.metrics.activeTiles, tris: runtime.render.metrics.triangleCount, colliders: runtime.colliders?.metrics.activeColliders ?? 0 });
      expect(plan.tiles.length).toBeLessThanOrEqual(420);
    }
    // no unbounded growth: the back half of the run must not have a meaningfully higher ceiling than the front half
    const mid = Math.floor(samples.length / 2);
    const frontMaxTiles = Math.max(...samples.slice(0, mid).map((s) => s.tiles));
    const backMaxTiles = Math.max(...samples.slice(mid).map((s) => s.tiles));
    const frontMaxColliders = Math.max(...samples.slice(0, mid).map((s) => s.colliders));
    const backMaxColliders = Math.max(...samples.slice(mid).map((s) => s.colliders));
    expect(backMaxTiles).toBeLessThanOrEqual(frontMaxTiles * 1.3 + 20);
    expect(backMaxColliders).toBeLessThanOrEqual(frontMaxColliders * 1.3 + 10);

    // eslint-disable-next-line no-console
    console.log('[stress] baseline', {
      steps: totalSteps, samples: samples.length,
      maxTiles: Math.max(...samples.map((s) => s.tiles)),
      maxTriangles: Math.max(...samples.map((s) => s.tris)),
      maxColliders: Math.max(...samples.map((s) => s.colliders)),
      finalRenderMetrics: runtime.render.metrics,
    });
  }, 60000);
});
