import * as THREE from 'three';
import { FloatingOrigin } from '../floatingOrigin';
import { createWaterMaterial } from '../../render/waterMaterial';
import { applySurfaceDetail } from '../../render/surfaceDetail';
import {
  FLOATING_ORIGIN_CONFIG, TILE_VERTS, tileHeightGrid, tileMinX, tileMinZ, tileSpacingM,
  type HeightFn, type MasterStreamer, type StreamPlan, type StreamView, type TilePlanEntry,
} from './masterStreaming';

/**
 * RENDER STREAMING (Phase 2B): turns a `MasterStreamer` plan into real THREE.js geometry.
 *
 * masterStreaming.ts owns every decision (which tiles, LOD, stitching, ring, prefetch); this file only builds/disposes the
 * meshes it's told to and reuses the shared FloatingOrigin so tiles never need their vertex buffers touched on rebase — only
 * `mesh.position` shifts (see FloatingOrigin.update). One material per LOD level (5 total) avoids per-tile material churn.
 */

export interface RenderStreamMetrics {
  activeTiles: number;
  pendingLoads: number;
  triangleCount: number;
  lastGenerateMs: number;
  lastUploadMs: number;
}

const stitchKey = (s: TilePlanEntry['stitch']): number => (s.n ? 1 : 0) | (s.s ? 2 : 0) | (s.e ? 4 : 0) | (s.w ? 8 : 0);

/** Ground colour at a (same frame as the height fn) x/z, given elevation and slope; writes into `out`. */
export type GroundColorFn = (x: number, z: number, elevationM: number, slopeDeg: number, out: THREE.Color) => void;

/** Builds a tile's local-space (0..size on x/z) BufferGeometry from the shared height authority. */
function buildTileGeometry(heightFn: HeightFn, entry: TilePlanEntry, colorFn: GroundColorFn | null): THREE.BufferGeometry {
  const grid = tileHeightGrid(heightFn, entry.key, entry.stitch);
  const n = TILE_VERTS, sp = tileSpacingM(entry.key.level);
  const positions = new Float32Array(n * n * 3);
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const idx = (j * n + i) * 3;
      positions[idx] = i * sp;
      positions[idx + 1] = grid[j * n + i];
      positions[idx + 2] = j * sp;
    }
  }
  const index: number[] = [];
  for (let j = 0; j < n - 1; j++) {
    for (let i = 0; i < n - 1; i++) {
      const a = j * n + i, b = a + 1, c = a + n, d = c + 1;
      index.push(a, c, b, b, c, d);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setIndex(index);
  geo.computeVertexNormals();
  if (colorFn) {
    // Baked per-vertex ground colour (biome, slope, altitude): the tile reads as designed terrain, not one flat tint per LOD.
    const nrm = geo.getAttribute('normal'), colors = new Float32Array(n * n * 3), c = new THREE.Color();
    const x0 = tileMinX(entry.key), z0 = tileMinZ(entry.key);
    for (let v = 0; v < n * n; v++) {
      const slopeDeg = Math.acos(Math.min(1, Math.max(-1, nrm.getY(v)))) * 180 / Math.PI;
      colorFn(x0 + positions[v * 3], z0 + positions[v * 3 + 2], positions[v * 3 + 1], slopeDeg, c);
      colors[v * 3] = c.r; colors[v * 3 + 1] = c.g; colors[v * 3 + 2] = c.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  }
  return geo;
}

/** Standing-water surface (m, same frame as the height fn) at x/z, or null on land. */
export type WaterSurfaceFn = (x: number, z: number) => number | null;
/** Water sits this far above the tile (which is flat AT the surface over sea/lakes) so the two never z-fight. */
const WATER_LIFT_M = 0.3;

/** The tile's water: every cell with at least one wet corner, flat at that water level, so the surface runs into the
 * rising shore and the terrain clips it along the true contour instead of a one-cell-short staircase. */
function buildTileWater(waterFn: WaterSurfaceFn, entry: TilePlanEntry): THREE.BufferGeometry | null {
  const n = TILE_VERTS, sp = tileSpacingM(entry.key.level), x0 = tileMinX(entry.key), z0 = tileMinZ(entry.key);
  const level = new Float32Array(n * n);
  let any = false;
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const w = waterFn(x0 + i * sp, z0 + j * sp);
    level[j * n + i] = w ?? NaN;
    if (w !== null) any = true;
  }
  if (!any) return null;
  const pos: number[] = [];
  for (let j = 0; j < n - 1; j++) for (let i = 0; i < n - 1; i++) {
    const a = j * n + i, ys = [level[a], level[a + 1], level[a + n], level[a + n + 1]].filter((v) => !Number.isNaN(v));
    if (!ys.length) continue;
    const h = Math.max(...ys) + WATER_LIFT_M;
    const X0 = i * sp, X1 = X0 + sp, Z0 = j * sp, Z1 = Z0 + sp;
    pos.push(X0, h, Z0, X0, h, Z1, X1, h, Z0, X1, h, Z0, X0, h, Z1, X1, h, Z1);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.computeVertexNormals();
  return geo;
}

/** One material per LOD level. With a ground colour fn the colour lives in the vertices and the material is faceted
 * (flatShading) with the shared surface detail, matching the authored field ground; without one, the old flat tint. */
function materialForLevel(level: number, coloured: boolean): THREE.Material {
  if (coloured) return applySurfaceDetail(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0, flatShading: true }), { macro: 0.55, soil: 0.2 });
  const shade = 0.42 + level * 0.06;
  const color = new THREE.Color(shade * 0.55, shade * 0.62, shade * 0.42);
  return new THREE.MeshStandardMaterial({ color, roughness: 0.95, metalness: 0, vertexColors: false });
}

export class MasterRenderStreamer {
  readonly origin: FloatingOrigin;
  private readonly meshes = new Map<string, THREE.Mesh>();
  private readonly materials = new Map<number, THREE.Material>();
  readonly metrics: RenderStreamMetrics = { activeTiles: 0, pendingLoads: 0, triangleCount: 0, lastGenerateMs: 0, lastUploadMs: 0 };
  /** Per-frame budget for STITCH-ONLY rebuilds (a resident tile whose neighbour split/merged). New loads are already
   * bounded by `MasterStreamer.maxLoadsPerUpdate` and must all be built the frame they're offered (see `applyPlan`). */
  readonly maxBuildsPerUpdate: number;

  private readonly scene: THREE.Object3D;
  private readonly streamer: MasterStreamer;
  private readonly heightFn: HeightFn;

  private readonly waterFn: WaterSurfaceFn | null;
  private waterMaterial: THREE.Material | null = null;
  private readonly colorFn: GroundColorFn | null;

  constructor(scene: THREE.Object3D, streamer: MasterStreamer, heightFn: HeightFn, origin?: FloatingOrigin, maxBuildsPerUpdate = 8, waterFn: WaterSurfaceFn | null = null, colorFn: GroundColorFn | null = null) {
    this.waterFn = waterFn;
    this.colorFn = colorFn;
    this.scene = scene;
    this.streamer = streamer;
    this.heightFn = heightFn;
    this.origin = origin ?? new FloatingOrigin(FLOATING_ORIGIN_CONFIG.rebaseThresholdM, FLOATING_ORIGIN_CONFIG.gridSnapM);
    this.maxBuildsPerUpdate = maxBuildsPerUpdate;
  }

  private materialFor(level: number): THREE.Material {
    let m = this.materials.get(level);
    if (!m) { m = materialForLevel(level, this.colorFn !== null); this.materials.set(level, m); }
    return m;
  }

  /** Standalone convenience: rebases the origin (x/z only, so altitude never triggers a rebase), runs the logical streamer
   * exactly once, and applies the resulting plan. When composed with collider streaming, drive `MasterStreamingRuntime`
   * instead (it must call `MasterStreamer.update` exactly once per frame and share the plan with the collider streamer). */
  update(view: StreamView): StreamPlan {
    this.origin.update(new THREE.Vector3(view.x, 0, view.z));
    const plan = this.streamer.update(view);
    this.applyPlan(plan);
    return plan;
  }

  /** Apply an already-computed plan (see `MasterStreamingRuntime`). Does not touch the floating origin or call
   * `MasterStreamer.update` — both must happen exactly once per frame, owned by the caller. */
  applyPlan(plan: StreamPlan): void {
    const t0 = performance.now();

    for (const id of plan.unload) this.unloadTile(id);

    // `plan.load` is ALREADY the per-frame budget (MasterStreamer.maxLoadsPerUpdate): a tile that enters `load` becomes
    // "resident" in the logical layer whether or not we build it, so every entry here must be built now — deferring any of
    // them would starve them forever (the streamer would never re-offer an already-resident id). Extra rebuilds for a
    // stitching change (below) get their own, separate budget since the streamer doesn't account for those.
    for (const entry of plan.load) if (!entry.prefetch) this.buildOrRebuildTile(entry);

    // Resident tiles whose stitching changed (a neighbour split/merged) need a crack-free rebuild too.
    let stitchRebuilds = 0;
    for (const entry of plan.tiles) {
      if (entry.prefetch || stitchRebuilds >= this.maxBuildsPerUpdate) continue;
      const mesh = this.meshes.get(entry.id);
      if (mesh && mesh.userData.stitchKey !== stitchKey(entry.stitch)) { this.buildOrRebuildTile(entry); stitchRebuilds++; }
    }

    const elapsed = performance.now() - t0;
    this.metrics.lastGenerateMs = elapsed;
    this.metrics.lastUploadMs = elapsed; // THREE uploads lazily on next render; generation dominates here
    this.metrics.activeTiles = this.meshes.size;
    this.metrics.pendingLoads = plan.tiles.filter((t) => !t.prefetch && !this.meshes.has(t.id)).length;
    let tris = 0;
    for (const m of this.meshes.values()) tris += (m.geometry.index?.count ?? 0) / 3;
    this.metrics.triangleCount = tris;
  }

  /** Water child of a tile (inherits its position, floating-origin shifts and unload). Built once per tile: stitching only
   * moves land edge vertices, never the flat water. */
  private attachWater(mesh: THREE.Mesh, entry: TilePlanEntry): void {
    const geo = this.waterFn && buildTileWater(this.waterFn, entry);
    if (!geo) return;
    this.waterMaterial ??= createWaterMaterial({ shallow: '#4fa9b4', deep: '#1d5f80', rippleM: 1.6 });
    const water = new THREE.Mesh(geo, this.waterMaterial);
    water.name = `master-water:${entry.id}`;
    mesh.add(water);
  }

  private buildOrRebuildTile(entry: TilePlanEntry): void {
    const existing = this.meshes.get(entry.id);
    if (existing) { existing.geometry.dispose(); existing.geometry = buildTileGeometry(this.heightFn, entry, this.colorFn); existing.userData.stitchKey = stitchKey(entry.stitch); return; }
    const geo = buildTileGeometry(this.heightFn, entry, this.colorFn);
    const mesh = new THREE.Mesh(geo, this.materialFor(entry.key.level));
    this.attachWater(mesh, entry);
    mesh.userData.stitchKey = stitchKey(entry.stitch);
    mesh.name = `master-tile:${entry.id}`;
    mesh.matrixAutoUpdate = false;
    const local = this.origin.toLocal(new THREE.Vector3(tileMinX(entry.key), 0, tileMinZ(entry.key)));
    mesh.position.copy(local);
    mesh.updateMatrix();
    this.origin.register(mesh);
    this.scene.add(mesh);
    this.meshes.set(entry.id, mesh);
  }

  private unloadTile(id: string): void {
    const mesh = this.meshes.get(id);
    if (!mesh) return;
    this.origin.unregister(mesh);
    this.scene.remove(mesh);
    mesh.geometry.dispose();
    for (const c of mesh.children) (c as THREE.Mesh).geometry.dispose();
    this.meshes.delete(id);
  }

  /** Test/inspection hook: the mesh currently drawn for a tile id, if any. */
  meshFor(id: string): THREE.Mesh | undefined { return this.meshes.get(id); }

  /** Full teardown (scene change, test cleanup). */
  dispose(): void { for (const id of [...this.meshes.keys()]) this.unloadTile(id); for (const m of this.materials.values()) m.dispose(); this.waterMaterial?.dispose(); }
}
