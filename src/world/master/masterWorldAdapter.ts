import type RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import type { RegionDefinition } from '../../core/types';
import { MasterStreamingRuntime } from './streamingRuntime';
import type { ColliderBudget } from './colliderStreaming';
import type { StreamConfig, StreamPlan } from './masterStreaming';
import { getMasterTerrain, type MasterTerrain } from './masterRuntime';
import type { GroundColorFn } from './renderStreaming';
import type { GroundSurfaceId } from '../surfaces';
import { fieldGroundColor } from '../../render/fieldTerrainColor';
import { masterGroundColor } from '../../render/groundPalette';
import { buildRegionGroundPalette, regionGroundColor } from '../../render/regionTerrainColor';
import { getRegionArtBible } from '../regionArtBible';

/**
 * PHASE 2C GAMEPLAY ADAPTER: the seam between `MasterStreamingRuntime` (Phase 2B, tested only against an isolated THREE
 * group + Rapier world, no gameplay) and the real flight loop's world coordinates.
 *
 * `MasterStreamingRuntime` and gameplay both use TRUE MASTER-WORLD metres. Legacy content is translated once when it is
 * loaded; this adapter never adds a named-area origin. It re-expresses the floating origin's rebase
 * delta (which `FloatingOrigin` already applies to every registered THREE `Object3D`) so gameplay's own local physics state —
 * the aircraft's Rapier body, camera, render-interpolation vectors — can be shifted the same way. Nothing here duplicates
 * masterStreaming/masterRuntime/renderStreaming/colliderStreaming decision logic.
 */
export class MasterWorldAdapter {
  readonly runtime: MasterStreamingRuntime;
  private readonly followers: Array<(delta: { x: number; z: number }) => void> = [];
  private readonly scene: THREE.Object3D;

  constructor(
    region: RegionDefinition,
    scene: THREE.Object3D,
    rapier: typeof RAPIER | null,
    physicsWorld: RAPIER.World | null,
    terrain: MasterTerrain = getMasterTerrain(),
    cfg: Partial<StreamConfig> = {},
    colliderBudget: Partial<ColliderBudget> = {},
  ) {
    this.scene = scene;
    // Master-world elevation is the shared authority for streaming and flight physics.
    const localGroundAt = (x: number, z: number): number => terrain.groundAt(x, z);
    // Standing water (sea, lakes, lagoon) in the same world frame; rivers are 1 m ribbons, not surfaces over the tile.
    const localWaterSurfaceAt = (x: number, z: number): number | null => {
      const w = terrain.waterAt(x, z);
      return w && w.kind !== 'river' ? w.surfaceM : null;
    };
    // Art-directed ground colour: The Field keeps its authored geography palette; everywhere else takes the shared
    // master palette keyed on the natural surface, so all regions share one ground language.
    // surfaceAt resamples height/slope/water (~5x a height lookup); the surface class is a coarse field, so sample it on a
    // 32 m lattice and memoise. ponytail: cleared wholesale at 200k cells, an LRU if long flights ever thrash it.
    const surfaces = new Map<number, GroundSurfaceId>();
    const surfaceMemo = (wx: number, wz: number): GroundSurfaceId => {
      const qx = Math.round(wx / 32), qz = Math.round(wz / 32), k = qx * 1e6 + qz;
      let v = surfaces.get(k);
      if (v === undefined) { if (surfaces.size > 200_000) surfaces.clear(); v = terrain.surfaceAt(qx * 32, qz * 32); surfaces.set(k, v); }
      return v;
    };
    const regionBase = new THREE.Color(region.groundColor);
    const regionPalette = buildRegionGroundPalette(getRegionArtBible(region.environment.terrain), regionBase.clone());
    const groundColorAt: GroundColorFn = region.id === 'the_field'
      ? (x, z, e, slope, out) => { fieldGroundColor(x, z, e, slope, out); }
      : (x, z, e, slope, out) => {
        const wx = x, wz = z;
        masterGroundColor(surfaceMemo(wx, wz), wx, wz, e, slope, out);
        // Same authored regional identity the static ground used (WorldEnvironment): base tint, then the art bible's
        // cliff/strata/low-ground accents, so Red Canyon reads as red sandstone rather than generic scrub.
        out.lerp(regionBase, 0.45);
        // Low-ground accent off (lowRef -Infinity): some bibles use it for surf foam (coast: #fff), which would whiten
        // every streamed tile at the datum.
        regionGroundColor(regionPalette, e, slope, -Infinity, out);
      };
    this.runtime = new MasterStreamingRuntime(scene, { groundAt: localGroundAt, waterSurfaceAt: localWaterSurfaceAt, groundColorAt }, rapier, physicsWorld, cfg, colliderBudget);
  }

  /** Register a callback that must shift its own state by a floating-origin rebase delta (world x/z). Used for
   * anything holding a region-local position that ISN'T a registered THREE `Object3D` — the Rapier aircraft body, and the
   * render loop's interpolation vectors (`previousPosition`/`currentPosition`/`renderPosition`), which are read from the
   * body every physics tick and would otherwise silently drift back out of sync with the rebased terrain. */
  addFollower(shift: (delta: { x: number; z: number }) => void): void {
    this.followers.push(shift);
  }

  /** Call once per render frame with the aircraft's WORLD x/z, horizontal velocity and AGL (metres). Applies any
   * floating-origin rebase to every registered follower before returning the plan, so a caller reading the aircraft's
   * position back off its Rapier body immediately after `update()` sees the post-rebase value. */
  update(x: number, z: number, vx: number, vz: number, aglM: number): StreamPlan {
    const plan = this.runtime.update({ x, z, vx, vz, aglM });
    const delta = this.runtime.lastRebaseDeltaXZ;
    if (delta) {
      // Everything else in the scene (WorldEnvironment.root, runway, target marker, props…) lives in the same world-local
      // frame, so it shifts by the same delta; streamed tiles were already shifted by FloatingOrigin. Per-frame-driven
      // children (aircraft, sun) are harmlessly overwritten next frame.
      for (const child of this.scene.children) {
        if (this.runtime.origin.has(child)) continue;
        child.position.x -= delta.x; child.position.z -= delta.z;
        if (!child.matrixAutoUpdate) child.updateMatrix();
      }
      for (const f of this.followers) f(delta);
    }
    return plan;
  }

  metrics() { return this.runtime.metrics(); }
  dispose(): void { this.runtime.dispose(); }
}
