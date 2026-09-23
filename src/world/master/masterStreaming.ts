import { HALF_M } from './masterGeography';

/**
 * MASTER WORLD STREAMING / LOD / FLOATING ORIGIN (Phase 2) — pure logic, no THREE, no Rapier, no I/O.
 *
 * Terrain is a quadtree of square TILES. Every tile has the same vertex count (33x33), so a tile of level L is 512·2^L m wide with
 * 16·2^L m spacing:   L0 16 m (512 m tile, physics-grade)  L1 32 m  L2 64 m  L3 128 m  L4 256 m  L5 512 m (16.4 km root tiles).
 * A constant vertex budget per tile makes GPU/collider memory proportional to the NUMBER of tiles, which the selection bounds.
 *
 * Heights come from ONE analytic function of world x/z (MasterTerrain.elevationAt/groundAt) sampled on a lattice that is a strict
 * subset relation between levels, so LOD boundaries only need the classic 2:1 T-junction fix (odd edge vertices = midpoints of the
 * coarse neighbour's edge). The selection enforces the 2:1 balance, hence the result is watertight by construction.
 *
 * World frame: +Z north, east = -X (world/compass.ts). Tiles are indexed from the world's MIN corner (-WORLD_SPAN/2).
 */

export const TILE_BASE_M = 512;
export const TILE_VERTS = 33;
export const MAX_LEVEL = 5;
/** The world is 48 km; a 3x3 grid of level-5 roots (49,152 m) covers it, centred on the origin. */
export const WORLD_SPAN_M = 3 * TILE_BASE_M * 2 ** MAX_LEVEL;
export const WORLD_MIN_M = -WORLD_SPAN_M / 2;
export const ROOTS_PER_AXIS = 3;
/** The map itself is HALF_M = 24,000; anything beyond is open sea and never needs a mesh. */
export const MAP_HALF_M = HALF_M;

export interface TileKey { level: number; ix: number; iz: number }
export const tileId = (t: TileKey): string => `${t.level}:${t.ix}:${t.iz}`;
export const tileSizeM = (level: number): number => TILE_BASE_M * 2 ** level;
export const tileSpacingM = (level: number): number => tileSizeM(level) / (TILE_VERTS - 1);
export const tileMinX = (t: TileKey): number => WORLD_MIN_M + t.ix * tileSizeM(t.level);
export const tileMinZ = (t: TileKey): number => WORLD_MIN_M + t.iz * tileSizeM(t.level);

export function tileAt(level: number, x: number, z: number): TileKey {
  const s = tileSizeM(level), n = ROOTS_PER_AXIS * 2 ** (MAX_LEVEL - level);
  return { level, ix: Math.min(n - 1, Math.max(0, Math.floor((x - WORLD_MIN_M) / s))), iz: Math.min(n - 1, Math.max(0, Math.floor((z - WORLD_MIN_M) / s))) };
}
export const parentOf = (t: TileKey): TileKey => ({ level: t.level + 1, ix: t.ix >> 1, iz: t.iz >> 1 });
export const childrenOf = (t: TileKey): TileKey[] => {
  const l = t.level - 1, x = t.ix * 2, z = t.iz * 2;
  return [{ level: l, ix: x, iz: z }, { level: l, ix: x + 1, iz: z }, { level: l, ix: x, iz: z + 1 }, { level: l, ix: x + 1, iz: z + 1 }];
};

/** Distance (m) from a point to the tile's XZ box (0 inside). */
export function distanceToTile(t: TileKey, x: number, z: number): number {
  const s = tileSizeM(t.level), x0 = tileMinX(t), z0 = tileMinZ(t);
  return Math.hypot(Math.max(x0 - x, 0, x - (x0 + s)), Math.max(z0 - z, 0, z - (z0 + s)));
}

/* ------------------------------ selection ------------------------------ */

export interface StreamView {
  x: number; z: number;
  /** Horizontal velocity (m/s), for look-ahead and the physics ring. */
  vx: number; vz: number;
  /** Height above ground (m): higher = coarser tiles are acceptable. */
  aglM: number;
}

export interface StreamConfig {
  /** A tile splits while (3D distance) < splitK · size. Higher = finer everywhere. */
  splitK: number;
  /** Hysteresis: a tile that was split last update keeps splitting up to splitK·(1+h); one that was not needs splitK·(1−h). */
  hysteresis: number;
  /** Hard cap on visible tiles: splitK is reduced until the leaf count fits. */
  maxTiles: number;
  /** Physics ring: radius (m) of L0 tiles that need colliders = clamp(minRing, maxRing, baseRing + speed·secondsAhead). */
  physicsMinRingM: number; physicsMaxRingM: number; physicsBaseRingM: number; physicsSecondsAhead: number;
  /** Above this AGL the physics ring collapses to the tile under the aircraft (+neighbours): nothing can touch the ground. */
  physicsAglCutoffM: number;
}

export const DEFAULT_STREAM_CONFIG: StreamConfig = {
  splitK: 2.4, hysteresis: 0.12, maxTiles: 420,
  physicsMinRingM: 700, physicsMaxRingM: 2500, physicsBaseRingM: 600, physicsSecondsAhead: 14, physicsAglCutoffM: 700,
};

export interface TilePlanEntry {
  key: TileKey;
  id: string;
  /** Neighbour is COARSER by one level on this side (T-junction to stitch): N=+z, S=-z, E=-x (east is -X), W=+x. */
  stitch: { n: boolean; s: boolean; e: boolean; w: boolean };
  /** L0 tile inside the physics ring: needs a collider. */
  physics: boolean;
  /** Prefetch only (ahead of the aircraft); not yet drawn. */
  prefetch: boolean;
}

export interface StreamPlan {
  tiles: TilePlanEntry[];
  load: TilePlanEntry[];
  unload: string[];
  physicsRingM: number;
  splitKUsed: number;
}

/**
 * Stateful selector. `update()` is deterministic in (view, previous state, config): same inputs => same plan (testable, replayable).
 * Loads are prioritised physics > nearest; `maxLoadsPerUpdate` bounds per-frame work.
 */
export class MasterStreamer {
  private prevSplit = new Set<string>();
  private resident = new Map<string, TilePlanEntry>();
  private readonly cfg: StreamConfig;
  private readonly maxLoadsPerUpdate: number;
  constructor(cfg: Partial<StreamConfig> = {}, maxLoadsPerUpdate = 12) { this.cfg = { ...DEFAULT_STREAM_CONFIG, ...cfg }; this.maxLoadsPerUpdate = maxLoadsPerUpdate; }

  physicsRing(view: StreamView): number {
    const c = this.cfg, speed = Math.hypot(view.vx, view.vz);
    if (view.aglM > c.physicsAglCutoffM) return tileSizeM(0);
    return Math.min(c.physicsMaxRingM, Math.max(c.physicsMinRingM, c.physicsBaseRingM + speed * c.physicsSecondsAhead));
  }

  update(view: StreamView): StreamPlan {
    const c = this.cfg, ring = this.physicsRing(view);
    let k = c.splitK, leaves: TileKey[] = [], split = new Set<string>();
    for (let attempt = 0; attempt < 12; attempt++) {
      ({ leaves, split } = this.select(view, k, ring));
      if (leaves.length <= c.maxTiles) break;
      k *= 0.9;
    }
    this.prevSplit = split;
    const leafSet = new Map(leaves.map((t) => [tileId(t), t]));
    const tiles: TilePlanEntry[] = leaves.map((key) => ({
      key, id: tileId(key), stitch: this.stitchOf(key, split),
      physics: key.level === 0 && distanceToTile(key, view.x, view.z) < ring, prefetch: false,
    }));
    // look-ahead: mark the L0/L1 tiles the aircraft reaches within `secondsAhead` seconds as prefetch if not already leaves
    const speed = Math.hypot(view.vx, view.vz);
    if (speed > 1 && view.aglM < c.physicsAglCutoffM * 2) {
      const ahead = Math.min(6000, speed * c.physicsSecondsAhead);
      for (let d = tileSizeM(0); d <= ahead; d += tileSizeM(0)) {
        const t = tileAt(0, view.x + (view.vx / speed) * d, view.z + (view.vz / speed) * d);
        const id = tileId(t);
        if (!leafSet.has(id) && !tiles.some((e) => e.id === id)) tiles.push({ key: t, id, stitch: { n: false, s: false, e: false, w: false }, physics: false, prefetch: true });
      }
    }
    const next = new Map(tiles.map((t) => [t.id, t]));
    const unload = [...this.resident.keys()].filter((id) => !next.has(id));
    const load = tiles.filter((t) => !this.resident.has(t.id))
      .sort((a, b) => Number(b.physics) - Number(a.physics) || distanceToTile(a.key, view.x, view.z) - distanceToTile(b.key, view.x, view.z))
      .slice(0, this.maxLoadsPerUpdate);
    // only tiles that were actually issued become resident; the rest are retried next update (bounded work per frame)
    for (const t of load) this.resident.set(t.id, t);
    for (const id of unload) this.resident.delete(id);
    for (const t of tiles) if (this.resident.has(t.id)) this.resident.set(t.id, t);
    return { tiles, load, unload, physicsRingM: ring, splitKUsed: k };
  }

  /** Tiles currently resident (issued for load and not unloaded). */
  residentIds(): string[] { return [...this.resident.keys()]; }

  private select(view: StreamView, k: number, ring: number): { leaves: TileKey[]; split: Set<string> } {
    const split = new Set<string>();
    const shouldSplit = (t: TileKey): boolean => {
      if (t.level === 0) return false;
      const size = tileSizeM(t.level), dh = distanceToTile(t, view.x, view.z);
      // any tile touching the physics ring must reach L0
      if (dh < ring + size) return true;
      const d3 = Math.hypot(dh, view.aglM);
      const was = this.prevSplit.has(tileId(t));
      return d3 < size * k * (was ? 1 + this.cfg.hysteresis : 1 - this.cfg.hysteresis);
    };
    const visit = (t: TileKey): void => { if (shouldSplit(t)) { split.add(tileId(t)); for (const c of childrenOf(t)) visit(c); } };
    for (let iz = 0; iz < ROOTS_PER_AXIS; iz++) for (let ix = 0; ix < ROOTS_PER_AXIS; ix++) visit({ level: MAX_LEVEL, ix, iz });
    // 2:1 balance: a leaf may not touch a leaf that is 2+ levels coarser
    for (let pass = 0; pass < 16; pass++) {
      let changed = false;
      for (const leaf of this.leavesOf(split)) {
        for (const p of this.edgeProbes(leaf)) {
          const other = this.leafAt(split, p[0], p[1]);
          if (other && other.level > leaf.level + 1) { this.forceSplit(split, other); changed = true; }
        }
      }
      if (!changed) break;
    }
    return { leaves: this.leavesOf(split), split };
  }

  private leavesOf(split: Set<string>): TileKey[] {
    const out: TileKey[] = [];
    const walk = (t: TileKey): void => { if (t.level > 0 && split.has(tileId(t))) for (const c of childrenOf(t)) walk(c); else out.push(t); };
    for (let iz = 0; iz < ROOTS_PER_AXIS; iz++) for (let ix = 0; ix < ROOTS_PER_AXIS; ix++) walk({ level: MAX_LEVEL, ix, iz });
    return out;
  }
  private leafAt(split: Set<string>, x: number, z: number): TileKey | null {
    if (x < WORLD_MIN_M || z < WORLD_MIN_M || x >= -WORLD_MIN_M || z >= -WORLD_MIN_M) return null;
    let t = tileAt(MAX_LEVEL, x, z);
    while (t.level > 0 && split.has(tileId(t))) t = tileAt(t.level - 1, x, z);
    return t;
  }
  private forceSplit(split: Set<string>, t: TileKey): void {
    for (let p = t; p.level <= MAX_LEVEL; p = parentOf(p)) { split.add(tileId(p)); if (p.level === MAX_LEVEL) break; }
  }
  private edgeProbes(t: TileKey): Array<[number, number]> {
    const s = tileSizeM(t.level), x0 = tileMinX(t), z0 = tileMinZ(t), e = 0.5;
    return [[x0 + s / 2, z0 + s + e], [x0 + s / 2, z0 - e], [x0 - e, z0 + s / 2], [x0 + s + e, z0 + s / 2]];
  }
  private stitchOf(t: TileKey, split: Set<string>): TilePlanEntry['stitch'] {
    const coarser = (px: number, pz: number): boolean => { const o = this.leafAt(split, px, pz); return !!o && o.level === t.level + 1; };
    const [n, s, w, e] = this.edgeProbes(t).map((p) => coarser(p[0], p[1]));
    // probes are ordered +z, -z, -x, +x ; east is -X so "east" = the -x probe
    return { n, s, e: w, w: e };
  }
}

/* ------------------------------ tile geometry ------------------------------ */

/** Height sampler: world x/z -> metres. In production this is `terrain.groundAt` (collidable) or `elevationAt` (bed). */
export type HeightFn = (x: number, z: number) => number;

/**
 * Row-major (row = z, col = x) height grid of a tile. Where a neighbour is COARSER, the odd vertices along that edge are replaced by
 * the linear interpolation of the even ones, which is exactly what the coarse neighbour draws: no cracks, no skirts needed.
 */
export function tileHeightGrid(h: HeightFn, t: TileKey, stitch: TilePlanEntry['stitch'] = { n: false, s: false, e: false, w: false }): Float32Array {
  const n = TILE_VERTS, sp = tileSpacingM(t.level), x0 = tileMinX(t), z0 = tileMinZ(t), g = new Float32Array(n * n);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) g[j * n + i] = h(x0 + i * sp, z0 + j * sp);
  const mid = (a: number, b: number): number => 0.5 * (g[a] + g[b]);
  // edges: north = last row (max z), south = first row, west = last col (max x), east = first col (min x, east is -X)
  if (stitch.n) for (let i = 1; i < n - 1; i += 2) g[(n - 1) * n + i] = mid((n - 1) * n + i - 1, (n - 1) * n + i + 1);
  if (stitch.s) for (let i = 1; i < n - 1; i += 2) g[i] = mid(i - 1, i + 1);
  if (stitch.w) for (let j = 1; j < n - 1; j += 2) g[j * n + n - 1] = mid((j - 1) * n + n - 1, (j + 1) * n + n - 1);
  if (stitch.e) for (let j = 1; j < n - 1; j += 2) g[j * n] = mid((j - 1) * n, (j + 1) * n);
  return g;
}

/* ------------------------------ floating origin ------------------------------ */

/**
 * Floating-origin policy for the master world. World coordinates are float64 in JS (exact); the GPU and Rapier are float32, whose
 * resolution at distance d is ≈ d·6e-8 m (2 mm at 24 km, 0.3 mm at 5 km). The origin is therefore rebased for SUB-MILLIMETRE stability
 * of physics/particles rather than out of necessity, and it snaps to the 512 m tile lattice so tile vertex buffers (which hold
 * origin-relative positions) are reused unchanged after a rebase.
 */
export const FLOATING_ORIGIN_CONFIG = { rebaseThresholdM: 3072, gridSnapM: TILE_BASE_M } as const;

export function float32ResolutionM(distanceM: number): number { return Math.abs(distanceM) * 2 ** -24; }

/** Pure equivalent of `FloatingOrigin.update` (world.floatingOrigin) for tests and the streaming loop. */
export function rebaseOrigin(origin: readonly [number, number], world: readonly [number, number], cfg: { rebaseThresholdM: number; gridSnapM: number } = FLOATING_ORIGIN_CONFIG): [number, number] {
  const dx = world[0] - origin[0], dz = world[1] - origin[1];
  if (Math.hypot(dx, dz) < cfg.rebaseThresholdM) return [origin[0], origin[1]];
  const g = cfg.gridSnapM;
  return [Math.round(world[0] / g) * g, Math.round(world[1] / g) * g];
}
