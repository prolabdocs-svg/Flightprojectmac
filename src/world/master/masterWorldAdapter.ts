import type RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import type { RegionDefinition } from '../../core/types';
import { MasterStreamingRuntime } from './streamingRuntime';
import type { ColliderBudget } from './colliderStreaming';
import type { StreamConfig, StreamPlan } from './masterStreaming';
import { getMasterTerrain, type MasterTerrain } from './masterRuntime';

/**
 * PHASE 2C GAMEPLAY ADAPTER: the seam between `MasterStreamingRuntime` (Phase 2B, tested only against an isolated THREE
 * group + Rapier world, no gameplay) and the real flight loop's coordinates.
 *
 * `MasterStreamingRuntime` and its `FloatingOrigin` work in TRUE MASTER-WORLD metres. Every other gameplay system
 * (`FlightModel`, the Rapier aircraft body, `TerrainQueryService`, spawn points, missions) works in a campaign region's
 * LOCAL frame — small numbers centred near the region's own origin, exactly as `createMasterRegionTerrain` in
 * `masterRuntime.ts` already reproduces. This adapter keeps everything in that same local frame instead of introducing a
 * second, world-absolute coordinate space into the render loop: it offsets the height function by the region's
 * `CampaignFrame` so tile terrain matches `TerrainQueryService` exactly, and it re-expresses the floating origin's rebase
 * delta (which `FloatingOrigin` already applies to every registered THREE `Object3D`) so gameplay's own local-frame state —
 * the aircraft's Rapier body, camera, render-interpolation vectors — can be shifted the same way. Nothing here duplicates
 * masterStreaming/masterRuntime/renderStreaming/colliderStreaming decision logic.
 */
export class MasterWorldAdapter {
  readonly runtime: MasterStreamingRuntime;
  private readonly followers: Array<(delta: { x: number; z: number }) => void> = [];

  constructor(
    region: RegionDefinition,
    scene: THREE.Object3D,
    rapier: typeof RAPIER | null,
    physicsWorld: RAPIER.World | null,
    terrain: MasterTerrain = getMasterTerrain(),
    cfg: Partial<StreamConfig> = {},
    colliderBudget: Partial<ColliderBudget> = {},
  ) {
    if (!terrain.hasFrame(region.id)) throw new Error(`MasterWorldAdapter: no master frame for region ${region.id}`);
    const frame = terrain.frame(region.id);
    // Region-local elevation (matches TerrainQueryService's `natural` fn from createMasterRegionTerrain): master collidable
    // ground translated into the region's own x/z + vertical datum, so streamed tiles and terrainQuery.getElevation can
    // never disagree.
    const localGroundAt = (x: number, z: number): number => terrain.groundAt(x + frame.originWorld[0], z + frame.originWorld[1]) - frame.datumM;
    // Standing water (sea, lakes, lagoon) in the same local frame; rivers are 1 m ribbons, not surfaces over the tile.
    const localWaterSurfaceAt = (x: number, z: number): number | null => {
      const w = terrain.waterAt(x + frame.originWorld[0], z + frame.originWorld[1]);
      return w && w.kind !== 'river' ? w.surfaceM - frame.datumM : null;
    };
    this.runtime = new MasterStreamingRuntime(scene, { groundAt: localGroundAt, waterSurfaceAt: localWaterSurfaceAt }, rapier, physicsWorld, cfg, colliderBudget);
  }

  /** Register a callback that must shift its own state by a floating-origin rebase delta (region-local x/z). Used for
   * anything holding a region-local position that ISN'T a registered THREE `Object3D` — the Rapier aircraft body, and the
   * render loop's interpolation vectors (`previousPosition`/`currentPosition`/`renderPosition`), which are read from the
   * body every physics tick and would otherwise silently drift back out of sync with the rebased terrain. */
  addFollower(shift: (delta: { x: number; z: number }) => void): void {
    this.followers.push(shift);
  }

  /** Call once per render frame with the aircraft's REGION-LOCAL x/z, horizontal velocity and AGL (metres). Applies any
   * floating-origin rebase to every registered follower before returning the plan, so a caller reading the aircraft's
   * position back off its Rapier body immediately after `update()` sees the post-rebase value. */
  update(x: number, z: number, vx: number, vz: number, aglM: number): StreamPlan {
    const plan = this.runtime.update({ x, z, vx, vz, aglM });
    const delta = this.runtime.lastRebaseDeltaXZ;
    if (delta) for (const f of this.followers) f(delta);
    return plan;
  }

  metrics() { return this.runtime.metrics(); }
  dispose(): void { this.runtime.dispose(); }
}
