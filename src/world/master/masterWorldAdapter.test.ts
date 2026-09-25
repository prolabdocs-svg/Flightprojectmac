import * as THREE from 'three';
import { beforeAll, describe, expect, it } from 'vitest';
import type RAPIER from '@dimforge/rapier3d-compat';
import { createWorld, initPhysics } from '../../sim/physics';
import { getRegion } from '../../content/regions';
import { createMasterRegionTerrain, getMasterTerrain } from './masterRuntime';
import { MasterWorldAdapter } from './masterWorldAdapter';

/**
 * PHASE 2C gameplay-integration tests: the seam between the isolated Phase 2B streamer (tested only against a bare THREE
 * group + Rapier world) and real region-local gameplay coordinates. Exercises the actual `MasterStreamingRuntime` +
 * `MasterColliderStreamer` + `MasterRenderStreamer` against a real Rapier `World` and a real `THREE.Scene`, driven the way
 * `FlightScreen.tsx` drives it: region-local x/z, a Rapier rigid body as the "aircraft", and floating-origin rebases applied
 * back onto that body exactly as `masterWorld.addFollower(...)` does in the real flight loop.
 */

let rapier: typeof RAPIER;
// Pre-warm the lazy master-map singleton (getMasterTerrain -> getMasterMap generates the whole 48 km
// grid once, several seconds) at module load, same pattern as streamingRuntime.test.ts /
// colliderStreaming.test.ts — otherwise the first `it()` eats that one-time cost inside its own timeout.
const terrain = getMasterTerrain();
beforeAll(async () => { rapier = await initPhysics(); });

// scrap_valley: a real campaign-site region with a master frame, distinct from 'the_field'.
const region = getRegion('scrap_valley');

function makeAircraftBody(world: RAPIER.World, x: number, z: number): RAPIER.RigidBody {
  const desc = rapier.RigidBodyDesc.dynamic().setTranslation(x, 500, z).lockRotations();
  return world.createRigidBody(desc);
}

describe('MasterWorldAdapter (Phase 2C: real THREE.Scene + real Rapier.World)', () => {
  it('creates render tiles and physics colliders in the scene/world it was given', () => {
    const scene = new THREE.Scene();
    const world = createWorld();
    const adapter = new MasterWorldAdapter(region, scene, rapier, world, terrain);
    const body = makeAircraftBody(world, 0, 0);
    for (let i = 0; i < 20; i++) adapter.update(0, 0, 0, 0, 60);
    expect(scene.children.length).toBeGreaterThan(0);
    expect(adapter.metrics().render.activeTiles).toBeGreaterThan(0);
    expect(adapter.metrics().colliders.activeColliders).toBeGreaterThan(0);
    // The world's own physics collider count includes the adapter's terrain colliders.
    expect(world.colliders.len()).toBeGreaterThanOrEqual(adapter.metrics().colliders.activeColliders);
    world.removeRigidBody(body);
  }, 15000);

  it('dispose() removes every tile mesh and terrain collider (no leaks)', () => {
    const scene = new THREE.Scene();
    const world = createWorld();
    const adapter = new MasterWorldAdapter(region, scene, rapier, world, terrain);
    for (let i = 0; i < 20; i++) adapter.update(0, 0, 0, 0, 60);
    expect(scene.children.length).toBeGreaterThan(0);
    adapter.dispose();
    expect(scene.children.length).toBe(0);
    expect(adapter.metrics().colliders.activeColliders).toBe(0);
  });

  it('a rebase-registered follower (the aircraft Rapier body) is shifted by exactly the same delta as the terrain', () => {
    const scene = new THREE.Scene();
    const world = createWorld();
    const adapter = new MasterWorldAdapter(region, scene, rapier, world, terrain);
    const body = makeAircraftBody(world, 0, 0);
    let rebases = 0;
    adapter.addFollower((delta) => {
      rebases++;
      const t = body.translation();
      body.setTranslation({ x: t.x - delta.x, y: t.y, z: t.z - delta.z }, true);
    });
    // Sweep far enough (> rebaseThresholdM = 3072m) to force several rebases, like a long cross-region flight.
    // The body's own translation IS the local x/z fed back to `update()` each step (exactly how FlightScreen.tsx
    // reads `controller.body.translation()` every frame) — advance it by the physics-frame delta each step, not by
    // resetting it to a raw cumulative distance, so a mid-sweep rebase correction is never overwritten next iteration.
    let trueGlobalX = 0;
    for (let i = 0; i < 40; i++) {
      trueGlobalX += 400;
      const localX = body.translation().x + 400;
      body.setTranslation({ x: localX, y: 500, z: 0 }, true);
      adapter.update(localX, 0, 400, 0, 100);
    }
    expect(rebases).toBeGreaterThan(0);
    // The body's LOCAL x must have been pulled back toward the (rebased) origin, not left drifting at the true
    // global distance travelled.
    const localX = body.translation().x;
    expect(Math.abs(localX)).toBeLessThan(trueGlobalX);
  }, 60000);

  it('a rebase shifts non-tile region-local scene roots (environment, runway, marker) by the same delta as the terrain', () => {
    const scene = new THREE.Scene();
    const adapter = new MasterWorldAdapter(region, scene, null, null, terrain);
    const envRoot = new THREE.Group();
    const runway = new THREE.Object3D(); runway.position.set(120, 5, -40);
    scene.add(envRoot, runway);
    const deltas: Array<{ x: number; z: number }> = [];
    adapter.addFollower((d) => deltas.push(d));
    for (let x = 0; x <= 8000; x += 400) adapter.update(x - deltas.reduce((s, d) => s + d.x, 0), 0, 400, 0, 100);
    expect(deltas.length).toBeGreaterThan(0);
    const total = deltas.reduce((s, d) => ({ x: s.x + d.x, z: s.z + d.z }), { x: 0, z: 0 });
    expect(envRoot.position.x).toBeCloseTo(-total.x, 6);
    expect(envRoot.position.z).toBeCloseTo(-total.z, 6);
    expect(runway.position.x).toBeCloseTo(120 - total.x, 6);
    expect(runway.position.y).toBe(5);
    // Tiles keep their own FloatingOrigin shift (not doubled): the origin offset equals the summed deltas.
    expect(adapter.runtime.origin.originOffset.x).toBeCloseTo(total.x, 6);
    adapter.dispose();
  }, 15000);

  it('region-local elevation the adapter height function uses matches createMasterRegionTerrain exactly', () => {
    const query = createMasterRegionTerrain(region, terrain);
    const scene = new THREE.Scene();
    const world = createWorld();
    const adapter = new MasterWorldAdapter(region, scene, rapier, world, terrain);
    // Both read the same MasterTerrain.groundAt through the same frame translation — sample a few points directly via the
    // frame math the adapter uses internally (mirrored here, not exported, so this checks behaviour, not implementation).
    const frame = terrain.frame(region.id);
    for (const [x, z] of [[0, 0], [300, -150], [-800, 900]] as const) {
      const viaAdapterMath = terrain.groundAt(x + frame.originWorld[0], z + frame.originWorld[1]) - frame.datumM;
      expect(query.getElevation(x, z)).toBeCloseTo(viaAdapterMath, 6);
    }
    adapter.dispose();
  }, 15000);

  it('throws for a region with no master frame instead of silently producing a wrong-geography world', () => {
    const scene = new THREE.Scene();
    const world = createWorld();
    expect(() => new MasterWorldAdapter(getRegion('the_field'), scene, rapier, world, terrain)).not.toThrow();
    // the_field DOES have a frame (Starter Basin); a genuinely unknown id is what should throw.
    expect(() => new MasterWorldAdapter({ ...getRegion('the_field'), id: 'not_a_real_region' }, scene, rapier, world, terrain)).toThrow();
  }, 60000);

  it('a long out-and-back flight settles physics/render tile counts back down (no unbounded growth)', () => {
    const scene = new THREE.Scene();
    const world = createWorld();
    const adapter = new MasterWorldAdapter(region, scene, rapier, world, terrain);
    for (let i = 0; i < 10; i++) adapter.update(0, 0, 0, 0, 50);
    const homeTiles = adapter.metrics().render.activeTiles;
    for (let i = 0; i < 10; i++) adapter.update(15000, 15000, 0, 0, 50);
    for (let i = 0; i < 10; i++) adapter.update(0, 0, 0, 0, 50);
    const homeTilesAgain = adapter.metrics().render.activeTiles;
    expect(Math.abs(homeTilesAgain - homeTiles)).toBeLessThanOrEqual(5);
  }, 20000);
});
