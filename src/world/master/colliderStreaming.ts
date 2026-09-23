import type RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { FloatingOrigin } from '../floatingOrigin';
import { TILE_VERTS, tileHeightGrid, tileMinX, tileMinZ, tileSizeM, type HeightFn, type StreamPlan, type TilePlanEntry } from './masterStreaming';

/**
 * RAPIER STREAMING (Phase 2B): colliders only for tiles the plan marks `physics: true` (the L0 ring around the aircraft that
 * `MasterStreamer` already computes — see masterStreaming.ts `physicsRing`). Heights come from the exact same `HeightFn` as the
 * renderer (MasterTerrain.groundAt), so collider and visual surface can never disagree.
 *
 * A tile's collider translation is expressed in the SAME local (floating-origin) frame as its render mesh; `rebase()` must be
 * called with the origin's rebase delta (returned by FloatingOrigin.update / MasterRenderStreamer.update) so colliders move
 * exactly like every other registered object — never regenerated, never drifting from the visuals.
 */

export interface ColliderStreamMetrics {
  activeColliders: number;
  lastRebuildMs: number;
  /** Physics-ring tiles waiting for a collider because this frame's create budget ran out (Phase 2C). Drained over the
   * following frames; a positive value for more than a few frames means the budget is too small for the current speed. */
  pendingCreates: number;
}

/** Per-frame cap on heightfield collider churn (Phase 2C — 2B shipped with no cap, see docs/world/PHASE_2B_STREAMING_RUNTIME.md).
 * Building a 33x33 Rapier heightfield is the expensive part; removal is cheap, so removes get a looser cap and the
 * "unload" correctness net (below) is never throttled — a tile Rapier still holds after leaving the plan entirely is a bug,
 * not a perf tradeoff. Defaults sized so a single L0 ring at the default physics-ring radii still resolves in one frame
 * (see colliderStreaming.test.ts) while a large/fast ring spreads its churn over a few frames instead of spiking. */
export interface ColliderBudget { maxCreatesPerFrame: number; maxRemovesPerFrame: number }
export const DEFAULT_COLLIDER_BUDGET: ColliderBudget = { maxCreatesPerFrame: 16, maxRemovesPerFrame: 32 };

export class MasterColliderStreamer {
  private readonly colliders = new Map<string, RAPIER.Collider>();
  /** Local (floating-origin-relative) x/z of each collider's centre, kept in lockstep for `rebase()`. */
  private readonly centersLocal = new Map<string, THREE.Vector2>();
  readonly metrics: ColliderStreamMetrics = { activeColliders: 0, lastRebuildMs: 0, pendingCreates: 0 };

  private readonly rapier: typeof RAPIER;
  private readonly world: RAPIER.World;
  private readonly heightFn: HeightFn;
  private readonly origin: FloatingOrigin;
  private readonly budget: ColliderBudget;

  constructor(rapier: typeof RAPIER, world: RAPIER.World, heightFn: HeightFn, origin: FloatingOrigin, budget: Partial<ColliderBudget> = {}) {
    this.rapier = rapier;
    this.world = world;
    this.heightFn = heightFn;
    this.origin = origin;
    this.budget = { ...DEFAULT_COLLIDER_BUDGET, ...budget };
  }

  /** Apply a streaming plan: add colliders for newly-physics tiles, remove colliders for tiles no longer in the physics ring
   * or no longer resident at all. Non-physics tiles never get a collider (no duplicated ground surfaces). A tile this frame's
   * budget can't reach simply isn't built yet — it stays in the plan (the aircraft hasn't left its ring) and is retried next
   * frame, so nothing is starved, only spread out. */
  apply(plan: StreamPlan): void {
    const t0 = performance.now();
    const wantPhysics = new Set(plan.tiles.filter((t) => t.physics).map((t) => t.id));
    let removes = 0;
    for (const id of [...this.colliders.keys()]) {
      if (wantPhysics.has(id)) continue;
      if (removes >= this.budget.maxRemovesPerFrame) break;
      this.removeTile(id);
      removes++;
    }
    let creates = 0;
    let pending = 0;
    for (const entry of plan.tiles) {
      if (!entry.physics || this.colliders.has(entry.id)) continue;
      if (creates >= this.budget.maxCreatesPerFrame) { pending++; continue; }
      this.addTile(entry);
      creates++;
    }
    // Correctness net, never budget-limited: a tile the plan has fully unloaded must never keep a stray collider, at any
    // speed — this is a small, bounded list (MasterStreamer.maxLoadsPerUpdate caps unload/frame too), not a perf cliff.
    for (const id of plan.unload) if (this.colliders.has(id)) this.removeTile(id);
    this.metrics.activeColliders = this.colliders.size;
    this.metrics.pendingCreates = pending;
    this.metrics.lastRebuildMs = performance.now() - t0;
  }

  private addTile(entry: TilePlanEntry): void {
    const n = TILE_VERTS, segments = n - 1, size = tileSizeM(entry.key.level);
    const grid = tileHeightGrid(this.heightFn, entry.key, entry.stitch);
    // Rapier heightfield wants column-major (nrows+1)*(ncols+1) heights; `grid` is row-major (row = z, col = x).
    const columnMajor = new Float32Array(n * n);
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) columnMajor[i * n + j] = grid[j * n + i];
    const desc = this.rapier.ColliderDesc.heightfield(segments, segments, columnMajor, { x: size, y: 1, z: size });
    const centerWorld = new THREE.Vector3(tileMinX(entry.key) + size / 2, 0, tileMinZ(entry.key) + size / 2);
    const centerLocal = this.origin.toLocal(centerWorld);
    desc.setTranslation(centerLocal.x, 0, centerLocal.z);
    const collider = this.world.createCollider(desc);
    this.colliders.set(entry.id, collider);
    this.centersLocal.set(entry.id, new THREE.Vector2(centerLocal.x, centerLocal.z));
  }

  private removeTile(id: string): void {
    const c = this.colliders.get(id);
    if (!c) return;
    this.world.removeCollider(c, true);
    this.colliders.delete(id);
    this.centersLocal.delete(id);
  }

  /** Shift every active collider by a floating-origin rebase delta (x/z only — see FloatingOrigin.update). Colliders are
   * translated in place; their heightfield data is untouched, so this is O(active colliders), not a rebuild. */
  rebase(deltaXZ: { x: number; z: number }): void {
    for (const [id, collider] of this.colliders) {
      const center = this.centersLocal.get(id)!;
      center.x -= deltaXZ.x; center.y -= deltaXZ.z;
      collider.setTranslation({ x: center.x, y: 0, z: center.y });
    }
  }

  colliderFor(id: string): RAPIER.Collider | undefined { return this.colliders.get(id); }

  dispose(): void {
    for (const id of [...this.colliders.keys()]) this.removeTile(id);
    this.metrics.activeColliders = 0;
    this.metrics.pendingCreates = 0;
  }
}
