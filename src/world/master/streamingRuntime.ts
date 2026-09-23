import type RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { FloatingOrigin } from '../floatingOrigin';
import { MasterColliderStreamer, type ColliderBudget } from './colliderStreaming';
import { DEFAULT_STREAM_CONFIG, FLOATING_ORIGIN_CONFIG, MasterStreamer, type StreamConfig, type StreamPlan, type StreamView } from './masterStreaming';
import { MasterRenderStreamer, type WaterSurfaceFn } from './renderStreaming';
import type { MasterTerrain } from './masterRuntime';

/**
 * Phase 2B orchestrator: the ONLY place that calls `MasterStreamer.update` (a stateful call that must happen exactly once
 * per frame) and the single owner of the shared `FloatingOrigin`. Wires masterStreaming's logical plan into the THREE.js and
 * Rapier adapters so render, physics and the floating origin can never see different tile sets or drift on a rebase.
 *
 * Call `update()` once per simulation/render frame with the aircraft's world position, velocity and AGL.
 */
export class MasterStreamingRuntime {
  readonly streamer: MasterStreamer;
  readonly origin: FloatingOrigin;
  readonly render: MasterRenderStreamer;
  readonly colliders: MasterColliderStreamer | null;
  /** Distance (m) from the aircraft to the nearest boundary of the streamed tile set — 0 while inside prepared terrain. */
  distanceToUnpreparedM = 0;
  /** Set by `update()` on a frame where the floating origin rebased, else null. A gameplay caller with objects positioned
   * in this same local frame but NOT registered with `origin` (e.g. a Rapier rigid body — `FloatingOrigin.register` only
   * shifts THREE `Object3D.position`) must subtract this from those objects' x/z once per rebase (see masterWorldAdapter.ts). */
  lastRebaseDeltaXZ: { x: number; z: number } | null = null;

  constructor(
    scene: THREE.Object3D,
    terrain: Pick<MasterTerrain, 'groundAt'> & { waterSurfaceAt?: WaterSurfaceFn },
    rapier: typeof RAPIER | null,
    physicsWorld: RAPIER.World | null,
    cfg: Partial<StreamConfig> = {},
    colliderBudget: Partial<ColliderBudget> = {},
  ) {
    this.streamer = new MasterStreamer(cfg);
    this.origin = new FloatingOrigin(FLOATING_ORIGIN_CONFIG.rebaseThresholdM, FLOATING_ORIGIN_CONFIG.gridSnapM);
    const heightFn = (x: number, z: number): number => terrain.groundAt(x, z);
    this.render = new MasterRenderStreamer(scene, this.streamer, heightFn, this.origin, undefined, terrain.waterSurfaceAt ?? null);
    this.colliders = rapier && physicsWorld ? new MasterColliderStreamer(rapier, physicsWorld, heightFn, this.origin, colliderBudget) : null;
  }

  update(view: StreamView): StreamPlan {
    const delta = this.origin.update(new THREE.Vector3(view.x, 0, view.z));
    this.lastRebaseDeltaXZ = delta ? { x: delta.x, z: delta.z } : null;
    const plan = this.streamer.update(view);
    this.render.applyPlan(plan);
    if (this.colliders) {
      this.colliders.apply(plan);
      if (delta) this.colliders.rebase({ x: delta.x, z: delta.z });
    }
    this.distanceToUnpreparedM = this.computeDistanceToUnprepared(view, plan);
    return plan;
  }

  /** `MasterStreamer` guarantees colliders (and matching L0 geometry) out to `plan.physicsRingM` around the aircraft at all
   * times (see masterStreaming.ts `physicsRing`) — that guaranteed radius IS the distance to unprepared terrain along any
   * heading. Above `physicsAglCutoffM` the ring collapses because nothing can touch the ground, so "unprepared" is moot. */
  private computeDistanceToUnprepared(view: StreamView, plan: StreamPlan): number {
    return view.aglM > DEFAULT_STREAM_CONFIG.physicsAglCutoffM ? Infinity : plan.physicsRingM;
  }

  readonly metrics = () => ({
    render: this.render.metrics,
    colliders: this.colliders?.metrics ?? { activeColliders: 0, lastRebuildMs: 0 },
    distanceToUnpreparedM: this.distanceToUnpreparedM,
  });

  dispose(): void { this.render.dispose(); this.colliders?.dispose(); }
}

export { DEFAULT_STREAM_CONFIG };
