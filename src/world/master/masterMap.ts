import { createNoise2D } from 'simplex-noise';
import { FIELD_RIVER_POINTS, fieldElevation } from '../fieldGeography';
import {
  BLOBS, NAMED_AREA_ANCHORS, CELL_M, SITE_GRADING, COAST_ROUGHNESS, DAMS, EASTERN_ISLAND_COAST, GRID_N, HALF_M, LAKES, MAINLAND_COAST, MASTER_SEED, MESAS,
  PRIMARY_RANGE, REGION_IDS, REGION_SEEDS, RIDGES, RIVERS, STARTER_BASIN, SUMMITS, fieldLocalToMaster, worldToGeo,
  type Blob, type Pt, type RegionId, type Ridge, type RiverDef,
} from './masterGeography';

/**
 * MASTER GEOGRAPHIC MAP V1 generator + query surface. Renderer-independent: pure typed arrays.
 *
 * Pipeline (spec §32/§58): coast -> authored macro elevation (ridges/massifs/mesas/uplands, noise only
 * as a secondary multiplier) -> lakes -> valley carving along the drainage skeleton (floors forced to
 * descend, meanders where the gradient drops) -> dam -> The Field terrain handed over verbatim inside
 * the Starter Basin core -> stream-power erosion -> channel enforcement -> hydrology (priority-flood,
 * flow accumulation, basins) -> relief-derived regions.
 */

const N = GRID_N;
const CELLS = N * N;
const KM = 1000;
const SEA = 0;
const SEA_FLOOR_MAX_M = 720;

/* ------------------------------ small utilities ------------------------------ */
const clamp = (v: number, a: number, b: number): number => (v < a ? a : v > b ? b : v);
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
const smooth = (e0: number, e1: number, x: number): number => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};
const eOf = (i: number): number => (-HALF_M + (i + 0.5) * CELL_M) / KM;
const nOf = (j: number): number => (-HALF_M + (j + 0.5) * CELL_M) / KM;

function hashSeed(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function mulberry(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), s | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const lakeNoise = (e: number, n: number): number => 1 + 0.22 * lakeNoiseFn(e * 3 + 7, n * 3);
const makeNoise = (channel: string) => createNoise2D(mulberry(hashSeed(`${MASTER_SEED}:${channel}`)));

const lakeNoiseFn = createNoise2D(mulberry(hashSeed(`${MASTER_SEED}:lake`)));

/** Bilinear sample of a grid at geographic km. */
function bilinear(a: Float32Array, e: number, n: number): number {
  const fi = clamp((e * KM + HALF_M) / CELL_M - 0.5, 0, N - 1.001);
  const fj = clamp((n * KM + HALF_M) / CELL_M - 0.5, 0, N - 1.001);
  const i = Math.floor(fi), j = Math.floor(fj), u = fi - i, v = fj - j, k = j * N + i;
  return lerp(lerp(a[k], a[k + 1], u), lerp(a[k + N], a[k + N + 1], u), v);
}

/* ------------------------------ coast: polygon -> mask -> signed distance ------------------------------ */
function catmullClosed(pts: ReadonlyArray<Pt>, seg: number): Pt[] {
  const out: Pt[] = [];
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n], p1 = pts[i], p2 = pts[(i + 1) % n], p3 = pts[(i + 2) % n];
    for (let k = 0; k < seg; k++) {
      const t = k / seg, t2 = t * t, t3 = t2 * t;
      const c = (a: number, b: number, cc: number, d: number) =>
        0.5 * (2 * b + (-a + cc) * t + (2 * a - 5 * b + 4 * cc - d) * t2 + (-a + 3 * b - 3 * cc + d) * t3);
      out.push([c(p0[0], p1[0], p2[0], p3[0]), c(p0[1], p1[1], p2[1], p3[1])]);
    }
  }
  return out;
}

/** Seeded midpoint displacement: meso/micro coastline detail bounded by segment length. */
function displaceClosed(poly: Pt[], rough: number, rng: () => number, rounds: number): Pt[] {
  let cur = poly;
  for (let r = 0; r < rounds; r++) {
    const next: Pt[] = [];
    for (let i = 0; i < cur.length; i++) {
      const a = cur[i], b = cur[(i + 1) % cur.length];
      const dx = b[0] - a[0], dz = b[1] - a[1], len = Math.hypot(dx, dz) || 1e-9;
      const off = (rng() * 2 - 1) * rough * len * 0.5;
      next.push(a, [(a[0] + b[0]) / 2 - (dz / len) * off, (a[1] + b[1]) / 2 + (dx / len) * off]);
    }
    cur = next;
  }
  return cur;
}

function rasterizePolys(polys: ReadonlyArray<ReadonlyArray<Pt>>): Uint8Array {
  const mask = new Uint8Array(CELLS);
  for (let j = 0; j < N; j++) {
    const y = nOf(j);
    const xs: number[] = [];
    for (const poly of polys) {
      for (let k = 0; k < poly.length; k++) {
        const a = poly[k], b = poly[(k + 1) % poly.length];
        if ((a[1] <= y) !== (b[1] <= y)) xs.push(a[0] + ((y - a[1]) / (b[1] - a[1])) * (b[0] - a[0]));
      }
    }
    xs.sort((p, q) => p - q);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const i0 = Math.max(0, Math.ceil((xs[k] * KM + HALF_M) / CELL_M - 0.5));
      const i1 = Math.min(N - 1, Math.floor((xs[k + 1] * KM + HALF_M) / CELL_M - 0.5));
      for (let i = i0; i <= i1; i++) mask[j * N + i] = 1;
    }
  }
  return mask;
}

function edt1d(f: Float64Array, n: number, d: Float64Array, v: Int32Array, z: Float64Array): void {
  let k = 0;
  v[0] = 0; z[0] = -1e30; z[1] = 1e30;
  for (let q = 1; q < n; q++) {
    let s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    while (s <= z[k]) { k--; s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]); }
    k++; v[k] = q; z[k] = s; z[k + 1] = 1e30;
  }
  k = 0;
  for (let q = 0; q < n; q++) { while (z[k + 1] < q) k++; d[q] = (q - v[k]) * (q - v[k]) + f[v[k]]; }
}

/** Exact Euclidean distance (cells) from every cell to the nearest cell whose mask value equals `target`. */
function distanceTo(mask: Uint8Array, target: number): Float32Array {
  const g = new Float64Array(CELLS);
  for (let i = 0; i < CELLS; i++) g[i] = mask[i] === target ? 0 : 1e12;
  const f = new Float64Array(N), d = new Float64Array(N), v = new Int32Array(N), z = new Float64Array(N + 1);
  for (let x = 0; x < N; x++) {
    for (let y = 0; y < N; y++) f[y] = g[y * N + x];
    edt1d(f, N, d, v, z);
    for (let y = 0; y < N; y++) g[y * N + x] = d[y];
  }
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) f[x] = g[y * N + x];
    edt1d(f, N, d, v, z);
    for (let x = 0; x < N; x++) g[y * N + x] = d[x];
  }
  const out = new Float32Array(CELLS);
  for (let i = 0; i < CELLS; i++) out[i] = Math.sqrt(g[i]);
  return out;
}

/* ------------------------------ feature evaluation ------------------------------ */
interface RidgeC { e: Float64Array; n: Float64Array; h: Float64Array; w: Float64Array; sharp: number; x0: number; x1: number; y0: number; y1: number }
function compileRidge(r: Ridge, hScale = 1): RidgeC {
  const m = r.pts.length;
  const c: RidgeC = { e: new Float64Array(m), n: new Float64Array(m), h: new Float64Array(m), w: new Float64Array(m), sharp: r.sharp, x0: 1e9, x1: -1e9, y0: 1e9, y1: -1e9 };
  let wMax = 0;
  r.pts.forEach((p, i) => {
    c.e[i] = p[0]; c.n[i] = p[1]; c.h[i] = p[2] * hScale; c.w[i] = p[3]; wMax = Math.max(wMax, p[3]);
    c.x0 = Math.min(c.x0, p[0]); c.x1 = Math.max(c.x1, p[0]); c.y0 = Math.min(c.y0, p[1]); c.y1 = Math.max(c.y1, p[1]);
  });
  const pad = wMax * 3.2;
  c.x0 -= pad; c.x1 += pad; c.y0 -= pad; c.y1 += pad;
  return c;
}
function ridgeValue(c: RidgeC, e: number, n: number): number {
  if (e < c.x0 || e > c.x1 || n < c.y0 || n > c.y1) return 0;
  let best = 1e18, bt = 0, bi = 0;
  for (let i = 0; i < c.e.length - 1; i++) {
    const ax = c.e[i], ay = c.n[i], bx = c.e[i + 1] - ax, by = c.n[i + 1] - ay;
    const t = clamp(((e - ax) * bx + (n - ay) * by) / (bx * bx + by * by), 0, 1);
    const dx = e - (ax + bx * t), dy = n - (ay + by * t), d2 = dx * dx + dy * dy;
    if (d2 < best) { best = d2; bt = t; bi = i; }
  }
  const w = lerp(c.w[bi], c.w[bi + 1], bt), h = lerp(c.h[bi], c.h[bi + 1], bt);
  return h * Math.exp(-Math.pow(Math.sqrt(best) / w, c.sharp));
}
/** Nearest-point info on a ridge (used to place the arc's absolute heights). */
function ridgeAbsolute(c: RidgeC, e: number, n: number): { h: number; prof: number } {
  if (e < c.x0 || e > c.x1 || n < c.y0 || n > c.y1) return { h: 0, prof: 0 };
  let best = 1e18, bt = 0, bi = 0;
  for (let i = 0; i < c.e.length - 1; i++) {
    const ax = c.e[i], ay = c.n[i], bx = c.e[i + 1] - ax, by = c.n[i + 1] - ay;
    const t = clamp(((e - ax) * bx + (n - ay) * by) / (bx * bx + by * by), 0, 1);
    const dx = e - (ax + bx * t), dy = n - (ay + by * t), d2 = dx * dx + dy * dy;
    if (d2 < best) { best = d2; bt = t; bi = i; }
  }
  const w = lerp(c.w[bi], c.w[bi + 1], bt);
  return { h: lerp(c.h[bi], c.h[bi + 1], bt), prof: Math.exp(-Math.pow(Math.sqrt(best) / w, c.sharp)) };
}

function ellipseR(e: number, n: number, b: { e: number; n: number; a: number; b: number; rotDeg: number }): number {
  const c = Math.cos((b.rotDeg * Math.PI) / 180), s = Math.sin((b.rotDeg * Math.PI) / 180);
  const dx = e - b.e, dy = n - b.n;
  const u = (dx * c + dy * s) / b.a, v = (-dx * s + dy * c) / b.b;
  return Math.sqrt(u * u + v * v);
}
const blobValue = (b: Blob, e: number, n: number): number => {
  const r = ellipseR(e, n, b);
  return r > 5 ? 0 : b.h * Math.exp(-Math.pow(r, b.k));
};

/** Ridge spurs branching off the primary crest (structured branching, seeded jitter only). */
function buildSpurs(): Ridge[] {
  const rng = mulberry(hashSeed(`${MASTER_SEED}:spurs`));
  const crest = PRIMARY_RANGE.pts;
  // Resample crest at 0.2 km.
  const dense: Array<{ e: number; n: number; h: number }> = [];
  for (let i = 0; i < crest.length - 1; i++) {
    const a = crest[i], b = crest[i + 1], len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const steps = Math.max(1, Math.round(len / 0.2));
    for (let k = 0; k < steps; k++) dense.push({ e: lerp(a[0], b[0], k / steps), n: lerp(a[1], b[1], k / steps), h: lerp(a[2], b[2], k / steps) });
  }
  const spurs: Ridge[] = [];
  let acc = 0, sIdx = 0;
  for (let i = 1; i < dense.length - 1; i++) {
    acc += Math.hypot(dense[i].e - dense[i - 1].e, dense[i].n - dense[i - 1].n);
    if (acc < 2.1 + rng() * 0.9) continue;
    acc = 0;
    const p = dense[i], t = [dense[i + 1].e - dense[i - 1].e, dense[i + 1].n - dense[i - 1].n];
    const tl = Math.hypot(t[0], t[1]);
    const tx = t[0] / tl, ty = t[1] / tl;
    for (const side of [-1, 1] as const) {
      if (rng() > (side === -1 ? 0.92 : 0.62)) continue;
      let nx = -ty, ny = tx; // left normal (points north-east for an ESE-trending crest)
      if (side === -1) { nx = -nx; ny = -ny; } // south-west normal
      const ang = (rng() - 0.5) * 0.8;
      let dx = nx * Math.cos(ang) - ny * Math.sin(ang) + tx * 0.28, dy = nx * Math.sin(ang) + ny * Math.cos(ang) + ty * 0.28;
      const dl = Math.hypot(dx, dy); dx /= dl; dy /= dl;
      const L = side === -1 ? 4.6 + rng() * 4.2 : 3 + rng() * 3, h0 = p.h * (0.64 + rng() * 0.1);
      const px = -dy, py = dx, phase = rng() * 6.28, amp = 0.35 + rng() * 0.5;
      const pts: Array<[number, number, number, number]> = [];
      for (let u = 0; u <= 1.0001; u += 0.25) {
        const off = amp * Math.sin(phase + u * (3 + rng() * 2)) * (0.4 + u);
        pts.push([p.e + dx * (0.7 + L * u) + px * off, p.n + dy * (0.7 + L * u) + py * off, h0 * (1 - 0.92 * Math.pow(u, 1.05)), 0.8 + 0.55 * u]);
      }
      spurs.push({ id: `spur_${sIdx++}`, pts, sharp: 1.9 });
    }
  }
  return spurs;
}

/* ------------------------------ rivers ------------------------------ */
export interface MasterSiteInfo { namedAreaId: string; datumM: number; rectGeoKm: [number, number, number, number] }

export interface RiverPath {
  id: string; name: string; kind: 'perennial' | 'dry'; parent?: string;
  /** Dense centreline, geographic km. */
  e: Float64Array; n: Float64Array;
  /** Bed/valley-floor elevation along the path (m); non-increasing downstream. */
  floorM: Float64Array;
  /** Samples [fixedFrom, fixedTo) come from the Field's own (verbatim) river and keep their Field floors. */
  fixedFrom: number; fixedTo: number;
  lengthKm: number;
}

function splineOpen(ctrl: ReadonlyArray<Pt>, ds: number): Array<[number, number]> {
  const dense: Array<[number, number]> = [];
  const m = ctrl.length;
  for (let i = 0; i < m - 1; i++) {
    const p0 = ctrl[Math.max(0, i - 1)], p1 = ctrl[i], p2 = ctrl[i + 1], p3 = ctrl[Math.min(m - 1, i + 2)];
    for (let k = 0; k < 12; k++) {
      const t = k / 12, t2 = t * t, t3 = t2 * t;
      const c = (a: number, b: number, cc: number, d: number) =>
        0.5 * (2 * b + (-a + cc) * t + (2 * a - 5 * b + 4 * cc - d) * t2 + (-a + 3 * b - 3 * cc + d) * t3);
      dense.push([c(p0[0], p1[0], p2[0], p3[0]), c(p0[1], p1[1], p2[1], p3[1])]);
    }
  }
  dense.push([ctrl[m - 1][0], ctrl[m - 1][1]]);
  return resampleUniform(dense, ds);
}
function resampleUniform(pts: Array<[number, number]>, ds: number): Array<[number, number]> {
  const out: Array<[number, number]> = [pts[0]];
  let carry = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i], len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    let d = ds - carry;
    while (d <= len) { out.push([lerp(a[0], b[0], d / len), lerp(a[1], b[1], d / len)]); d += ds; }
    carry = len - (d - ds);
  }
  const last = pts[pts.length - 1], lo = out[out.length - 1];
  if (Math.hypot(last[0] - lo[0], last[1] - lo[1]) > ds * 0.3) out.push(last);
  return out;
}

/* ------------------------------ priority-flood hydrology ------------------------------ */
class MinHeap {
  keys: Float64Array; vals: Int32Array; size = 0; topK = 0; topV = 0;
  constructor(cap: number) { this.keys = new Float64Array(cap); this.vals = new Int32Array(cap); }
  push(k: number, v: number): void {
    let i = this.size++;
    while (i > 0) { const p = (i - 1) >> 1; if (this.keys[p] <= k) break; this.keys[i] = this.keys[p]; this.vals[i] = this.vals[p]; i = p; }
    this.keys[i] = k; this.vals[i] = v;
  }
  pop(): void {
    this.topK = this.keys[0]; this.topV = this.vals[0];
    const k = this.keys[--this.size], v = this.vals[this.size];
    let i = 0;
    for (;;) {
      let c = 2 * i + 1;
      if (c >= this.size) break;
      if (c + 1 < this.size && this.keys[c + 1] < this.keys[c]) c++;
      if (this.keys[c] >= k) break;
      this.keys[i] = this.keys[c]; this.vals[i] = this.vals[c]; i = c;
    }
    this.keys[i] = k; this.vals[i] = v;
  }
}
const DI = [-1, 0, 1, -1, 1, -1, 0, 1], DJ = [-1, -1, -1, 0, 0, 1, 1, 1];
const DDIST = [Math.SQRT2, 1, Math.SQRT2, 1, 1, Math.SQRT2, 1, Math.SQRT2];

export interface Hydrology {
  /** Terrain with depressions filled to their sill. */
  filled: Float32Array;
  /** Receiver cell index (-1 for sea / outlet). */
  recv: Int32Array;
  /** Upstream cell count (including the cell itself). */
  accum: Float32Array;
  /** Cells in the order the flood reached them (sea first): upstream cells always come later than their receiver. */
  order: Int32Array;
}

function priorityFlood(h: Float32Array): Hydrology {
  const filled = new Float32Array(CELLS), recv = new Int32Array(CELLS).fill(-1);
  const closed = new Uint8Array(CELLS), order = new Int32Array(CELLS);
  const heap = new MinHeap(CELLS + 8);
  let oc = 0;
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const k = j * N + i;
      if (h[k] > SEA) continue;
      closed[k] = 1; filled[k] = h[k];
      let edge = false;
      for (let d = 0; d < 8 && !edge; d++) {
        const ii = i + DI[d], jj = j + DJ[d];
        if (ii >= 0 && jj >= 0 && ii < N && jj < N && h[jj * N + ii] > SEA) edge = true;
      }
      if (edge) heap.push(h[k], k);
    }
  }
  while (heap.size > 0) {
    heap.pop();
    const c = heap.topV, ck = heap.topK, ci = c % N, cj = (c / N) | 0;
    order[oc++] = c;
    for (let d = 0; d < 8; d++) {
      const ii = ci + DI[d], jj = cj + DJ[d];
      if (ii < 0 || jj < 0 || ii >= N || jj >= N) continue;
      const n = jj * N + ii;
      if (closed[n]) continue;
      closed[n] = 1;
      const f = Math.max(h[n], ck);
      filled[n] = f; recv[n] = c;
      heap.push(f, n);
    }
  }
  const accum = new Float32Array(CELLS).fill(1);
  const ord = order.subarray(0, oc);
  for (let q = oc - 1; q >= 0; q--) { const c = ord[q], r = recv[c]; if (r >= 0) accum[r] += accum[c]; }
  return { filled, recv, accum, order: ord };
}

/* ------------------------------ result type ------------------------------ */
export interface MasterMapData {
  seed: string;
  cellM: number; n: number; halfM: number;
  heightM: Float32Array;
  slopeDeg: Float32Array;
  /** Signed distance to the coast in km (+ inland, − offshore). */
  coastKm: Float32Array;
  hydro: Hydrology;
  /** Basin id per cell (0 = ocean); ids are outlets (river mouths / coastal cells). */
  basin: Int32Array;
  /** Region index into REGION_IDS (255 = water/none). */
  region: Uint8Array;
  /** 0 none, 1 river/stream (accum threshold), 2 lake (filled), 3 lagoon. */
  water: Uint8Array;
  rivers: RiverPath[];
  fieldWeight: Float32Array;
  lakeCells: { id: string; name: string; areaKm2: number; levelM: number }[];
  damPointKm: [number, number] | null;
  known: KnownLake[];
  /** Graded campaign sites: flat platform datum (m) and the graded rectangle in geographic km [e0,n0,e1,n1]. */
  sites: MasterSiteInfo[];
  /** 0 ocean, 1 mainland, 2 eastern island, 3+ small islands. */
  landComponent: Uint8Array;
}

export const RIVER_ACCUM_CELLS = 1000; // ≈2.3 km² of catchment
export const STREAM_ACCUM_CELLS = 250;

/** Zones where standing water is intentional: Lago Espejo, the reservoir, the lagoon and the Field's own lake. */
const FIELD_LAKE_GEO = ((): Pt => { const [wx, wz] = fieldLocalToMaster(2500, 1900); const [e, n] = worldToGeo(wx, wz); return [e, n]; })();
export interface KnownLake { id: string; e: number; n: number; rKm: number; levelM: number; tolM: number }
export function declaredLakes(dam: { e: number; n: number; levelM: number } | null): KnownLake[] {
  const out: KnownLake[] = [
    { id: 'lake_a_espejo', e: LAKES[0].e, n: LAKES[0].n, rKm: 1.8, levelM: LAKES[0].levelM, tolM: 90 },
    { id: 'lake_c_laguna', e: LAKES[1].e, n: LAKES[1].n, rKm: 2.4, levelM: 0.4, tolM: 2 },
    { id: 'lake_field', e: FIELD_LAKE_GEO[0], n: FIELD_LAKE_GEO[1], rKm: 1.4, levelM: -12 + STARTER_BASIN.elevationOffsetM, tolM: 4 },
  ];
  if (dam) out.push({ id: 'lake_b_presa', e: dam.e, n: dam.n, rKm: 6, levelM: dam.levelM, tolM: 4 });
  return out;
}
export const isDeclaredLake = (known: ReadonlyArray<KnownLake>, e: number, n: number, filledM: number): boolean =>
  known.some((k) => Math.hypot(e - k.e, n - k.n) < k.rKm && Math.abs(filledM - k.levelM) <= k.tolM);

/* ------------------------------ build ------------------------------ */
export function buildMasterMap(): MasterMapData {
  const rngCoast = mulberry(hashSeed(`${MASTER_SEED}:coast`));
  const mainland = displaceClosed(catmullClosed(MAINLAND_COAST, 6), COAST_ROUGHNESS.mainland, rngCoast, 3);
  const island = displaceClosed(catmullClosed(EASTERN_ISLAND_COAST, 6), COAST_ROUGHNESS.island, rngCoast, 3);
  // The master domain extends beyond the original authored continent. Add three deterministic
  // peripheral landforms in that new margin so the extra 24 km is explorable geography, not a
  // blank ocean apron. Existing macro geography and named-area coordinates remain unchanged.
  const landMask = rasterizePolys([mainland, island]);
  const dSea = distanceTo(landMask, 0); // for land cells: cells to nearest sea
  const dLand = distanceTo(landMask, 1); // for sea cells: cells to nearest land
  const coastKm = new Float32Array(CELLS);
  for (let k = 0; k < CELLS; k++) coastKm[k] = landMask[k] ? ((dSea[k] - 0.5) * CELL_M) / KM : -((dLand[k] - 0.5) * CELL_M) / KM;

  const seaBlur = boxBlur(coastKm, 6);
  const nCrest = makeNoise('crest'), nRough = makeNoise('rough'), nBase = makeNoise('base'), nMesa = makeNoise('mesa'), nWarp = makeNoise('warp');
  const ridges = [PRIMARY_RANGE, ...buildSpurs(), ...RIDGES.filter((r) => r.id !== 'arco_sur')].map((r) => compileRidge(r));
  const arc = compileRidge(RIDGES.find((r) => r.id === 'arco_sur') as Ridge);
  const blobs: Blob[] = [...BLOBS, ...SUMMITS];

  const h = new Float32Array(CELLS);
  for (let j = 0; j < N; j++) {
    const n = nOf(j);
    for (let i = 0; i < N; i++) {
      const e = eOf(i), k = j * N + i, cd = coastKm[k];
      if (cd <= 0) {
        // Sea floor: shelf then abyss, lifted along the submerged volcanic arc.
        let sea = -SEA_FLOOR_MAX_M * (1 - Math.exp(-(-Math.min(cd, seaBlur[k] * 0.5 + cd * 0.5)) / 6.5)) - 0.4;
        if (n < -12 || e > 14) {
          const we = e + 0.6 * nWarp(e * 0.65, n * 0.65), wn = n + 0.6 * nWarp(e * 0.65 + 50, n * 0.65 - 20);
          const a = ridgeAbsolute(arc, we, wn);
          const hh = a.h * (1 + 0.5 * nWarp(e * 1.7 + 9, n * 1.7 - 4)) + 25 * nWarp(e * 4, n * 4);
          if (a.prof > 0.002) sea = Math.max(sea, lerp(sea, hh, a.prof));
        }
        h[k] = sea;
        continue;
      }
      const inland = smooth(0, 0.9, cd);
      // Secondary irregularity only: displaces feature coordinates by <= ~0.65 km so parallel spurs/valleys are not ruler-straight.
      const fe = e + 0.5 * nWarp(e * 0.34 + 90, n * 0.34) + 0.17 * nWarp(e * 1.1, n * 1.1 + 70);
      const fn = n + 0.5 * nWarp(e * 0.34 + 30, n * 0.34 + 60) + 0.17 * nWarp(e * 1.1 + 40, n * 1.1);
      let acc = 0;
      for (const r of ridges) { const v = ridgeValue(r, fe, fn); if (v > 0) acc += v ** 6; }
      for (const b of blobs) { const v = blobValue(b, fe, fn); if (v > 0) acc += v ** 6; }
      for (const m of MESAS) {
        const r = ellipseR(fe, fn, m) * (1 + 0.16 * nMesa(e * 1.3, n * 1.3) + 0.1 * nMesa(e * 3.1 + 11, n * 3.1));
        if (r > 1.2) continue;
        const v = m.h * (0.66 * (1 - smooth(1 - m.edge, 1, r)) + 0.34 * (1 - smooth(0.55 - m.edge * 0.5, 0.55, r)));
        if (v > 0) acc += v ** 6;
      }
      let u = Math.pow(acc, 1 / 6) * (1 + 0.06 * nCrest(e * 0.9, n * 0.9));
      u += 20 * nRough(e * 3.4, n * 3.4) * clamp(u / 500, 0, 1) + 7 * nRough(e * 9 + 40, n * 9) * clamp(u / 900, 0, 1) + 42 * nRough(e * 1.1 + 20, n * 1.1 - 8) * clamp(u / 250, 0, 1) * (1 - 0.4 * clamp(u / 2000, 0, 1));
      const base = 3 + 34 * (1 - Math.exp(-cd / 3.5)) + 5.5 * Math.min(cd, 22) + 4 * nBase(e * 0.5, n * 0.5) * inland;
      {
        // Alpine crags: ridged detail only above ~1,100 m so crests are sharp; the authored crest/summits still decide where the peaks are.
        const hi = smooth(1100, 2100, u);
        if (hi > 0) u += hi * (190 * Math.pow(1 - Math.abs(nRough(e * 2.2 + 70, n * 2.2)), 2.2) - 65);
      }
      let land = base + u * inland;
      if (land > 2600) land = 2600 + 250 * Math.tanh((land - 2600) / 250); // spec §4: peak ≈ 2,850 m
      // Arc islands can rise from the sea only; on land the arc is irrelevant.
      h[k] = Math.max(land, 0.6);
    }
  }

  /* ---- lakes: excavated depressions with a sill ---- */
  const protect: Array<[number, number, number]> = []; // [E, N, radius km] where erosion/enforcement must not touch
  for (const L of LAKES) {
    const rr = 1.6;
    const outlet = L.outletBearingDeg == null ? null : (L.outletBearingDeg * Math.PI) / 180;
    for (let j = 0; j < N; j++) {
      const n = nOf(j);
      if (n < L.n - L.a * 3 || n > L.n + L.a * 3) continue;
      for (let i = 0; i < N; i++) {
        const e = eOf(i);
        if (e < L.e - L.a * 3 || e > L.e + L.a * 3) continue;
        const r = ellipseR(e, n, L) * (L.kind === 'lagoon' ? lakeNoise(e, n) : 1), k = j * N + i;
        if (r < 1) h[k] = Math.min(h[k], L.levelM - L.depthM * (1 - r * r));
        else if (L.kind === 'lagoon' && r < 1.9) h[k] = Math.min(h[k], lerp(L.levelM + 0.3, h[k], smooth(1, 1.9, r))); // gentle shore, no cliff
        else if (r < rr && outlet != null) {
          const ang = Math.atan2(e - L.e, n - L.n); // bearing from north, clockwise
          const dAng = Math.abs(Math.atan2(Math.sin(ang - outlet), Math.cos(ang - outlet)));
          if (dAng > 0.55) h[k] = Math.max(h[k], L.levelM + 14 * (1 - (r - 1) / (rr - 1)) + 2);
        }
      }
    }
    if (outlet != null) protect.push([L.e + Math.sin(outlet) * L.a * 1.1, L.n + Math.cos(outlet) * L.a * 1.1, 0.55]);
  }
  // Lagoon inlet: a narrow cut from the lagoon to the sea so it is tidal-connected.
  {
    const L = LAKES.find((l) => l.kind === 'lagoon');
    if (L) {
      const from: Pt = [L.e + 0.3, L.n - 0.3], to: Pt = [6.6, -13.4];
      const steps = 80;
      for (let s = 0; s <= steps; s++) {
        const pe = lerp(from[0], to[0], s / steps), pn = lerp(from[1], to[1], s / steps);
        const ci = Math.round((pe * KM + HALF_M) / CELL_M - 0.5), cj = Math.round((pn * KM + HALF_M) / CELL_M - 0.5);
        for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
          const k = (cj + dj) * N + ci + di;
          if (k >= 0 && k < CELLS && h[k] > 0) h[k] = Math.min(h[k], 0.15);
        }
      }
    }
  }

  /* ---- rivers: skeleton -> meandered path -> descending floors -> valley carving ---- */
  const paths = new Map<string, RiverPath>();
  const DS = 0.09; // km
  const carveRiver = (def: RiverDef): void => {
    let prefix: Array<[number, number]> = [], prefixFloor: number[] = [];
    if (def.fieldPrefix) {
      for (const p of FIELD_RIVER_POINTS) {
        const [wx, wz] = fieldLocalToMaster(p[0], p[1]);
        const [pe, pn] = worldToGeo(wx, wz);
        prefix.push([pe, pn]); prefixFloor.push(p[2] + STARTER_BASIN.elevationOffsetM);
      }
    }
    const ctrl: ReadonlyArray<Pt> = def.fieldPrefix ? [prefix[prefix.length - 1], ...def.pts] : def.pts;
    let headPath: Array<[number, number]> = def.fieldPrefix && def.headPts?.length ? splineOpen([...def.headPts, prefix[0]], DS).slice(0, -1) : [];
    if (headPath.length > 4) {
      // The headwaters live in the fusion zone (outside the verbatim core): give them natural meanders, tapering to zero where
      // they meet the Field's own river so the hand-over is continuous.
      const hp = headPath, hn = hp.length;
      headPath = hp.map((p, i) => {
        const a = hp[Math.max(0, i - 1)], b = hp[Math.min(hn - 1, i + 1)], tl = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1e-9;
        const nx = -(b[1] - a[1]) / tl, ny = (b[0] - a[0]) / tl;
        const off = 0.32 * smooth(0, 0.6, i * DS) * smooth(0, 0.8, (hn - 1 - i) * DS) * Math.sin((2 * Math.PI * i * DS) / 1.9 + 0.7);
        return [p[0] + nx * off, p[1] + ny * off] as [number, number];
      });
    }
    let pts = splineOpen(ctrl, DS);
    // Snap the mouth onto the parent's centreline so the confluence is exact.
    let parentFloorAtMouth = -Infinity;
    if (def.parent) {
      const P = paths.get(def.parent) as RiverPath;
      const last = pts[pts.length - 1];
      let bi = 0, bd = 1e9;
      for (let i = 0; i < P.e.length; i++) { const d = Math.hypot(P.e[i] - last[0], P.n[i] - last[1]); if (d < bd) { bd = d; bi = i; } }
      pts[pts.length - 1] = [P.e[bi], P.n[bi]];
      parentFloorAtMouth = P.floorM[bi];
    }
    const total = pts.length;
    // Meanders where the terrain gradient is low, tapered at both ends.
    const hs = pts.map((p) => bilinear(h, p[0], p[1]));
    const wMid = def.valley[1];
    const lambda = def.kind === 'dry' ? 4.2 : 4.2 * wMid + 1.6, amp = (def.kind === 'dry' ? 0.34 : clamp(0.5 * wMid, 0.12, 0.85)) * def.meander;
    const phase = mulberry(hashSeed(def.id))() * 6.28;
    const moved: Array<[number, number]> = [];
    for (let i = 0; i < total; i++) {
      const a = pts[Math.max(0, i - 1)], b = pts[Math.min(total - 1, i + 1)];
      const tl = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1e-9, nx = -(b[1] - a[1]) / tl, ny = (b[0] - a[0]) / tl;
      const i2 = Math.min(total - 1, i + 10), i1 = Math.max(0, i - 10);
      const slope = Math.abs(hs[i1] - hs[i2]) / (((i2 - i1) * DS) * KM || 1);
      const flat = def.kind === 'dry' ? 1 : 1 - smooth(0.006, 0.03, slope);
      const taper = smooth(0, 1.3, i * DS) * smooth(0, 1.3, (total - 1 - i) * DS);
      const off = amp * flat * taper * Math.sin((2 * Math.PI * i * DS) / lambda + phase);
      moved.push([pts[i][0] + nx * off, pts[i][1] + ny * off]);
    }
    const mouthPt = pts[pts.length - 1];
    pts = resampleUniform(moved, DS);
    if (Math.hypot(pts[pts.length - 1][0] - mouthPt[0], pts[pts.length - 1][1] - mouthPt[1]) < DS * 0.6) pts[pts.length - 1] = mouthPt; else pts.push(mouthPt);
    const fa = headPath.length, fb = fa + (def.fieldPrefix ? prefix.length - 1 : 0);
    if (def.fieldPrefix) pts = [...headPath, ...prefix.slice(0, -1), ...pts];
    const cnt = pts.length;

    // Floors: smoothed terrain minus incision, then forced to descend downstream.
    const raw = pts.map((p) => bilinear(h, p[0], p[1]));
    const floor = new Float64Array(cnt);
    for (let i = 0; i < cnt; i++) {
      let s = 0, c = 0;
      for (let q = -8; q <= 8; q++) { const ii = i + q; if (ii >= 0 && ii < cnt) { s += raw[ii]; c++; } }
      floor[i] = Math.min(s / c, raw[i]) - def.incisionM; // never above the local terrain: mouths arrive at sea level
    }
    for (let i = fa; i < fb; i++) floor[i] = prefixFloor[i - fa];
    if (def.id === 'rio_principal') floor[0] = Math.min(floor[0], (LAKES[0].levelM - 1));
    for (const pin of def.pins ?? []) {
      let bi = 0, bd = 1e9;
      for (let i = 0; i < cnt; i++) { const d = Math.hypot(pts[i][0] - pin[0], pts[i][1] - pin[1]); if (d < bd) { bd = d; bi = i; } }
      floor[bi] = Math.min(floor[bi], pin[2]);
    }
    const eps = 0.00035 * DS * KM; // minimum 0.35 m/km
    for (let i = 1; i < cnt; i++) { if (i >= fa && i < fb) continue; floor[i] = Math.min(floor[i], floor[i - 1] - eps); }
    if (def.parent) floor[cnt - 1] = Math.max(floor[cnt - 1], parentFloorAtMouth + 0.35);
    for (let i = cnt - 2; i >= 0; i--) { if (i >= fa && i < fb) continue; floor[i] = Math.max(floor[i], floor[i + 1] + eps); }
    // Rivers that reach the sea must not dip below 0 before the mouth.
    if (!def.parent) for (let i = cnt - 2; i >= fb; i--) floor[i] = Math.max(floor[i], floor[cnt - 1] + eps * (cnt - 1 - i));

    const eArr = new Float64Array(cnt), nArr = new Float64Array(cnt);
    pts.forEach((p, i) => { eArr[i] = p[0]; nArr[i] = p[1]; });
    paths.set(def.id, { id: def.id, name: def.name, kind: def.kind, parent: def.parent, e: eArr, n: nArr, floorM: floor, fixedFrom: fa, fixedTo: fb, lengthKm: cnt * DS });

    // Splat: nearest-sample distance and floor per cell within the local valley half-width.
    const bestD = new Float32Array(CELLS).fill(1e9), bestF = new Float32Array(CELLS), bestW = new Float32Array(CELLS);
    for (let s = 0; s < cnt; s++) {
      const u = s / (cnt - 1);
      const W = u < 0.5 ? lerp(def.valley[0], def.valley[1], u * 2) : lerp(def.valley[1], def.valley[2], (u - 0.5) * 2);
      const rc = Math.ceil((W * KM) / CELL_M) + 1;
      const ci = Math.round((pts[s][0] * KM + HALF_M) / CELL_M - 0.5), cj = Math.round((pts[s][1] * KM + HALF_M) / CELL_M - 0.5);
      for (let dj = -rc; dj <= rc; dj++) {
        const jj = cj + dj; if (jj < 0 || jj >= N) continue;
        for (let di = -rc; di <= rc; di++) {
          const ii = ci + di; if (ii < 0 || ii >= N) continue;
          const d = Math.hypot(eOf(ii) - pts[s][0], nOf(jj) - pts[s][1]);
          const k = jj * N + ii;
          if (d < bestD[k] && d < W) { bestD[k] = d; bestF[k] = floor[s]; bestW[k] = W; }
        }
      }
    }
    for (let k = 0; k < CELLS; k++) {
      const d = bestD[k];
      if (d >= 1e8 || h[k] <= 0) continue;
      const W = bestW[k], w = 1 - smooth(0.4 * W, W, d);
      const target = bestF[k] + Math.max(0, d - 0.4 * W) * 12;
      const cur = h[k];
      let out = lerp(cur, target, w);
      if (out > cur) out = Math.min(out, cur + 25 * w);
      if (def.kind === 'perennial') out -= Math.min(5, def.incisionM * 0.6) * (1 - smooth(0, 0.11, d));
      h[k] = out;
    }
  };
  for (const def of RIVERS) carveRiver(def);

  /* ---- reservoir: dyked basin on a tributary; the site needing the least embankment wins ---- */
  let damPoint: [number, number] | null = null;
  let damLevel = 0;
  const noEnforce: Array<[number, number, number]> = [];
  for (const D of DAMS) {
    interface Cand { P: RiverPath; k: number; volume: number; level: number; tx: number; ty: number }
    const cands: Cand[] = [];
    for (const rid of D.rivers) {
      const P = paths.get(rid) as RiverPath, cnt = P.e.length;
      for (let k = Math.round(D.searchFrom * (cnt - 1)); k <= Math.round(D.searchTo * (cnt - 1)); k += 3) {
        const dx = P.e[Math.min(cnt - 1, k + 3)] - P.e[Math.max(0, k - 3)], dy = P.n[Math.min(cnt - 1, k + 3)] - P.n[Math.max(0, k - 3)], l = Math.hypot(dx, dy) || 1;
        const tx = dx / l, ty = dy / l, basin = { e: P.e[k], n: P.n[k], a: D.lengthKm, b: D.widthKm, rotDeg: (Math.atan2(ty, tx) * 180) / Math.PI };
        if (bilinear(coastKm, basin.e, basin.n) < 3) continue;
        // ring band terrain outside the flow axis
        const band: number[] = [];
        for (let q = 0; q < 72; q++) {
          const ang = (q / 72) * Math.PI * 2, c = Math.cos(ang), sn = Math.sin(ang);
          if (Math.abs(c) > 0.8) continue; // skip the inflow/outflow sectors
          const r = 1.25, ex = basin.a * r * c, ey = basin.b * r * sn;
          band.push(bilinear(h, basin.e + ex * tx - ey * ty, basin.n + ex * ty + ey * tx));
        }
        if (band.length < 20) continue;
        const level = Math.min(...band) + 12;
        const volume = band.reduce((sum, v) => sum + Math.max(0, level + 3 - v), 0);
        cands.push({ P, k, volume, level, tx, ty });
      }
    }
    cands.sort((p, q) => p.volume - q.volume);
    const build = (c: Cand, log: Array<[number, number]>): void => {
      const basin = { e: c.P.e[c.k], n: c.P.n[c.k], a: D.lengthKm, b: D.widthKm, rotDeg: (Math.atan2(c.ty, c.tx) * 180) / Math.PI };
      const rc = Math.ceil((D.lengthKm * 2.2 * KM) / CELL_M), ci = Math.round((basin.e * KM + HALF_M) / CELL_M - 0.5), cj = Math.round((basin.n * KM + HALF_M) / CELL_M - 0.5);
      for (let dj = -rc; dj <= rc; dj++) for (let di = -rc; di <= rc; di++) {
        const ii = ci + di, jj = cj + dj; if (ii < 0 || jj < 0 || ii >= N || jj >= N) continue;
        const e = eOf(ii), n = nOf(jj), dx = e - basin.e, dy = n - basin.n, r = ellipseR(e, n, basin) * lakeNoise(e, n), k = jj * N + ii;
        if (r < 1) { log.push([k, h[k]]); h[k] = Math.min(h[k], c.level - D.depthM * (1 - r * r)); continue; }
        if (r >= 1.6) continue;
        const along = (dx * c.tx + dy * c.ty) / (Math.hypot(dx, dy) || 1), across = Math.abs(-dx * c.ty + dy * c.tx);
        if (along < -0.8) continue; // inflow: the river enters here
        log.push([k, h[k]]);
        h[k] = Math.max(h[k], along > 0.8 && across < 0.06 ? c.level : c.level + (along > 0.8 ? 4 : 3));
      }
    };
    let chosen: Cand | null = null;
    for (const c of cands.slice(0, 12)) {
      const log: Array<[number, number]> = [];
      build(c, log);
      const hyd = priorityFlood(h);
      let lake = 0;
      const ci = Math.round((c.P.e[c.k] * KM + HALF_M) / CELL_M - 0.5), cj = Math.round((c.P.n[c.k] * KM + HALF_M) / CELL_M - 0.5), rc = Math.round((4 * KM) / CELL_M);
      for (let dj = -rc; dj <= rc; dj++) for (let di = -rc; di <= rc; di++) { const k = (cj + dj) * N + ci + di; if (Math.abs(hyd.filled[k] - c.level) < 5 && hyd.filled[k] - h[k] > 1) lake++; }
      if ((lake * CELL_M * CELL_M) / 1e6 >= 0.9) { chosen = c; break; }
      for (let q = log.length - 1; q >= 0; q--) h[log[q][0]] = log[q][1];
    }
    if (!chosen) throw new Error('no viable reservoir site for ' + D.id);
    const outAt: [number, number] = [chosen.P.e[chosen.k] + chosen.tx * D.lengthKm * 1.4, chosen.P.n[chosen.k] + chosen.ty * D.lengthKm * 1.4];
    damPoint = outAt; damLevel = chosen.level;
    protect.push([chosen.P.e[chosen.k], chosen.P.n[chosen.k], D.lengthKm * 1.9]);
    noEnforce.push([outAt[0], outAt[1], 1.0]);
  }

  /* ---- The Field: verbatim inside the core, blended out by fadeEnd ---- */
  const fieldWeight = new Float32Array(CELLS);
  {
    const [ox, oz] = STARTER_BASIN.worldOffsetM;
    const lim = STARTER_BASIN.fadeEndM / KM + 0.5;
    const [homeE, homeN] = STARTER_BASIN.homeGeoKm;
    for (let j = 0; j < N; j++) {
      const n = nOf(j);
      if (Math.abs(n - homeN) > lim) continue;
      for (let i = 0; i < N; i++) {
        const e = eOf(i);
        if (Math.abs(e - homeE) > lim) continue;
        const lx = -e * KM - ox, lz = n * KM - oz;
        const cheb = Math.max(Math.abs(lx), Math.abs(lz));
        const w = 1 - smooth(STARTER_BASIN.coreRadiusM, STARTER_BASIN.fadeEndM, cheb);
        if (w <= 0) continue;
        const k = j * N + i;
        fieldWeight[k] = w;
        h[k] = lerp(h[k], fieldElevation(lx, lz) + STARTER_BASIN.elevationOffsetM, w);
      }
    }
  }

  /* ---- campaign sites: grade each region-local footprint to ONE flat platform (spec §33 runway grading) ---- */
  const sites: MasterSiteInfo[] = [];
  for (const S of NAMED_AREA_ANCHORS) {
    const [ae, an] = S.anchorGeoKm;
    // local x -> geographic E offset is -x/1000 (east is -X); local z -> +N
    const e0 = ae - (S.footprintLocalM.x[1] + SITE_GRADING.marginM) / 1000, e1 = ae - (S.footprintLocalM.x[0] - SITE_GRADING.marginM) / 1000;
    const n0 = an + (S.footprintLocalM.z[0] - SITE_GRADING.marginM) / 1000, n1 = an + (S.footprintLocalM.z[1] + SITE_GRADING.marginM) / 1000;
    const blend = SITE_GRADING.blendM / 1000;
    const vals: number[] = [];
    const i0 = Math.max(0, Math.floor(((e0 - blend) * KM + HALF_M) / CELL_M)), i1 = Math.min(N - 1, Math.ceil(((e1 + blend) * KM + HALF_M) / CELL_M));
    const j0 = Math.max(0, Math.floor(((n0 - blend) * KM + HALF_M) / CELL_M)), j1 = Math.min(N - 1, Math.ceil(((n1 + blend) * KM + HALF_M) / CELL_M));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const e = eOf(i), n = nOf(j);
      if (e >= e0 && e <= e1 && n >= n0 && n <= n1) vals.push(h[j * N + i]);
    }
    vals.sort((a, b) => a - b);
    const datum = vals[Math.floor(vals.length / 2)];
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const e = eOf(i), n = nOf(j), k = j * N + i;
      const d = Math.hypot(Math.max(e0 - e, 0, e - e1), Math.max(n0 - n, 0, n - n1));
      const w = 1 - smooth(0, blend, d);
      if (w > 0 && h[k] > 1) h[k] = lerp(h[k], datum, w);
    }
    protect.push([(e0 + e1) / 2, (n0 + n1) / 2, Math.hypot(e1 - e0, n1 - n0) / 2 + blend + 0.1]);
    sites.push({ namedAreaId: S.id, datumM: datum, rectGeoKm: [e0, n0, e1, n1] });
  }

  /* ---- stream-power erosion (dendritic gullies on flanks); masked off the Field core, lakes, dam, sills ---- */
  const emask = new Float32Array(CELLS);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const k = j * N + i;
    let m = 1 - fieldWeight[k];
    const e = eOf(i), n = nOf(j);
    for (const p of protect) if (Math.hypot(e - p[0], n - p[1]) < p[2]) { m = 0; break; }
    emask[k] = h[k] > 1.5 ? m : 0;
  }
  const ITER = 6, K_E = 11;
  // Deterministic sub-metre jitter used ONLY to pick drainage directions during erosion: breaks the ruler-straight gullies
  // that D8 carves on planar slopes (steepest-descent ties would otherwise all choose the same direction).
  const jrng = mulberry(hashSeed(`${MASTER_SEED}:jitter`));
  const jitter = new Float32Array(CELLS);
  for (let k = 0; k < CELLS; k++) jitter[k] = (jrng() - 0.5) * 24;
  for (let it = 0; it < ITER; it++) {
    const hj = new Float32Array(CELLS);
    for (let k = 0; k < CELLS; k++) hj[k] = h[k] + jitter[k];
    const hyd = priorityFlood(hj);
    const next = new Float32Array(h);
    const cut = new Float32Array(CELLS);
    for (let k = 0; k < CELLS; k++) {
      const r = hyd.recv[k];
      if (r < 0 || emask[k] <= 0) continue;
      const dx = (Math.abs((k % N) - (r % N)) + Math.abs(((k / N) | 0) - ((r / N) | 0))) === 2 ? Math.SQRT2 : 1;
      const drop = h[k] - h[r];
      if (drop <= 0) continue;
      const slope = drop / (dx * CELL_M);
      const areaKm2 = hyd.accum[k] * (CELL_M / KM) * (CELL_M / KM);
      const e = K_E * Math.sqrt(areaKm2) * slope * emask[k];
      cut[k] = Math.min(e, 0.25 * drop);
    }
    // Spread each cell's incision over its neighbourhood: V-shaped valleys instead of 1-cell slots.
    for (let j = 1; j < N - 1; j++) for (let i = 1; i < N - 1; i++) {
      const k = j * N + i;
      if (emask[k] <= 0) continue;
      const c = 0.36 * cut[k] + 0.09 * (cut[k - 1] + cut[k + 1] + cut[k - N] + cut[k + N]) + 0.07 * (cut[k - N - 1] + cut[k - N + 1] + cut[k + N - 1] + cut[k + N + 1]);
      next[k] = h[k] - c * 1.6;
    }
    // gentle creep on flat-ish ground removes grid staircasing without touching crests/canyon walls
    // Hillslope diffusion where the catchment is small: erases the 45° rill lattice D8 leaves on planar slopes,
    // while channels (large catchment) stay sharp.
    for (let pass = 0; pass < 2; pass++) {
      const src = pass === 0 ? next : h;
      const dst = pass === 0 ? h : next;
      for (let j = 1; j < N - 1; j++) for (let i = 1; i < N - 1; i++) {
        const k = j * N + i;
        if (emask[k] <= 0 || src[k] <= 1.5) { dst[k] = src[k]; continue; }
        const mean = (src[k - 1] + src[k + 1] + src[k - N] + src[k + N] + 0.7 * (src[k - N - 1] + src[k - N + 1] + src[k + N - 1] + src[k + N + 1])) / 6.8;
        const w = (hyd.accum[k] < 60 ? 0.55 : hyd.accum[k] < 300 ? 0.3 : 0.15) * emask[k];
        dst[k] = src[k] + w * (mean - src[k]);
      }
    }
  }

  /* ---- enforce river thalwegs so the drainage skeleton is exactly downhill after erosion ---- */
  for (const P of paths.values()) {
    for (let s = 0; s < P.e.length; s++) {
      if (s >= P.fixedFrom && s < P.fixedTo) continue;
      const e = P.e[s], n = P.n[s];
      if (noEnforce.some((p) => Math.hypot(e - p[0], n - p[1]) < p[2])) continue; // dam wall
      const ci = Math.round((e * KM + HALF_M) / CELL_M - 0.5), cj = Math.round((n * KM + HALF_M) / CELL_M - 0.5);
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        const ii = ci + di, jj = cj + dj; if (ii < 0 || jj < 0 || ii >= N || jj >= N) continue;
        const k = jj * N + ii;
        if (h[k] <= 0) continue;
        const d = Math.hypot(eOf(ii) - e, nOf(jj) - n) * KM / CELL_M;
        if (d > 1.3) continue;
        if (h[k] - P.floorM[s] > 25) continue; // deep cuts through crests are made by the valley carve, not a knife slot
        h[k] = Math.min(h[k], P.floorM[s] + 0.9 * d);
      }
    }
  }

  // Remove accidental depressions (<15 m deep) so the only standing water is intentional: lakes, reservoir, lagoon.
  {
    const hyd = priorityFlood(h);
    const known = declaredLakes(damPoint ? { e: damPoint[0], n: damPoint[1], levelM: damLevel } : null);
    const keep = (k: number): boolean => {
      const e = eOf(k % N), n = nOf((k / N) | 0);
      return isDeclaredLake(known, e, n, hyd.filled[k]) || fieldWeight[k] >= 0.999; // Field core stays verbatim
    };
    for (let k = 0; k < CELLS; k++) if (h[k] > SEA && hyd.filled[k] - h[k] > 0 && hyd.filled[k] - h[k] < 400 && !keep(k)) h[k] = hyd.filled[k];
  }
  // The platform datum is what the FINAL terrain says (pit filling can lift a graded basin floor), never an intermediate value.
  for (const st of sites) {
    const [e0, n0, e1, n1] = st.rectGeoKm, vals: number[] = [];
    for (let j = Math.ceil((n0 * KM + HALF_M) / CELL_M - 0.5); j <= Math.floor((n1 * KM + HALF_M) / CELL_M - 0.5); j++) for (let i = Math.ceil((e0 * KM + HALF_M) / CELL_M - 0.5); i <= Math.floor((e1 * KM + HALF_M) / CELL_M - 0.5); i++) vals.push(h[j * N + i]);
    vals.sort((x, y) => x - y);
    st.datumM = vals[Math.floor(vals.length / 2)];
  }
  return finishMap(h, coastKm, fieldWeight, [...paths.values()], damPoint, sites, declaredLakes(damPoint ? { e: damPoint[0], n: damPoint[1], levelM: damLevel } : null));
}

/* ------------------------------ hydrology + regions + derived layers ------------------------------ */
function finishMap(h: Float32Array, coastKm: Float32Array, fieldWeight: Float32Array, rivers: RiverPath[], damPoint: [number, number] | null, sites: MasterSiteInfo[], known: KnownLake[]): MasterMapData {
  const hydro = priorityFlood(h);
  const slopeDeg = new Float32Array(CELLS);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const i0 = Math.max(0, i - 1), i1 = Math.min(N - 1, i + 1), j0 = Math.max(0, j - 1), j1 = Math.min(N - 1, j + 1);
    const gx = (h[j * N + i1] - h[j * N + i0]) / ((i1 - i0) * CELL_M), gz = (h[j1 * N + i] - h[j0 * N + i]) / ((j1 - j0) * CELL_M);
    slopeDeg[j * N + i] = (Math.atan(Math.hypot(gx, gz)) * 180) / Math.PI;
  }

  // Land components (8-connected): 1 = mainland (largest), 2 = eastern island (largest other), 3+ = islets.
  const comp = new Uint8Array(CELLS);
  {
    const sizes: number[] = [0];
    const labels = new Int32Array(CELLS);
    let next = 1;
    const stack: number[] = [];
    for (let s = 0; s < CELLS; s++) {
      if (h[s] <= SEA || labels[s]) continue;
      let size = 0; labels[s] = next; stack.push(s);
      while (stack.length) {
        const c = stack.pop() as number; size++;
        const ci = c % N, cj = (c / N) | 0;
        for (let d = 0; d < 8; d++) {
          const ii = ci + DI[d], jj = cj + DJ[d];
          if (ii < 0 || jj < 0 || ii >= N || jj >= N) continue;
          const nn = jj * N + ii;
          if (h[nn] > SEA && !labels[nn]) { labels[nn] = next; stack.push(nn); }
        }
      }
      sizes[next] = size; next++;
    }
    const idx = sizes.map((sz, l) => ({ sz, l })).filter((o) => o.l > 0).sort((a, b) => b.sz - a.sz);
    const remap = new Map<number, number>();
    idx.forEach((o, r) => remap.set(o.l, Math.min(250, r + 1)));
    for (let k = 0; k < CELLS; k++) if (labels[k]) comp[k] = remap.get(labels[k]) as number;
  }

  // Basins: outlet id propagated upstream. Outlets are receiver-less land cells touching the sea.
  const basin = new Int32Array(CELLS);
  {
    let id = 0;
    for (let q = 0; q < hydro.order.length; q++) {
      const c = hydro.order[q];
      if (h[c] <= SEA) continue;
      const r = hydro.recv[c];
      basin[c] = h[r] <= SEA ? ++id : basin[r];
    }
  }

  // Water layers. Flow across a graded airfield platform is sheet drainage, never a river channel (a D8 line on a flat
  // platform is a tie-break artefact that moves whenever any upstream terrain changes).
  const onSitePlatform = (k: number): boolean => {
    const e = eOf(k % N), n = nOf((k / N) | 0);
    return sites.some(({ rectGeoKm: [e0, n0, e1, n1] }) => e >= e0 && e <= e1 && n >= n0 && n <= n1);
  };
  const water = new Uint8Array(CELLS);
  const lakeCells: MasterMapData['lakeCells'] = [];
  for (let k = 0; k < CELLS; k++) {
    if (h[k] <= SEA) continue;
    const fd = hydro.filled[k] - h[k];
    if (fd > 0.4 && isDeclaredLake(known, eOf(k % N), nOf((k / N) | 0), hydro.filled[k])) water[k] = 2;
    else if (hydro.accum[k] >= RIVER_ACCUM_CELLS && !onSitePlatform(k)) water[k] = 1;
  }
  for (const L of LAKES.filter((l) => l.kind === 'lagoon')) {
    for (let k = 0; k < CELLS; k++) {
      if (h[k] > L.levelM + 0.05) continue;
      if (ellipseR(eOf(k % N), nOf((k / N) | 0), L) * lakeNoise(eOf(k % N), nOf((k / N) | 0)) < 1.05) water[k] = 3;
    }
  }
  {
    const seen = new Uint8Array(CELLS), stack: number[] = [];
    for (let s = 0; s < CELLS; s++) {
      if (water[s] !== 2 || seen[s]) continue;
      let size = 0, sumLevel = 0; seen[s] = 1; stack.push(s);
      while (stack.length) {
        const c = stack.pop() as number; size++; sumLevel += hydro.filled[c];
        const ci = c % N, cj = (c / N) | 0;
        for (let d = 0; d < 8; d++) {
          const ii = ci + DI[d], jj = cj + DJ[d];
          if (ii < 0 || jj < 0 || ii >= N || jj >= N) continue;
          const nn = jj * N + ii;
          if (water[nn] === 2 && !seen[nn]) { seen[nn] = 1; stack.push(nn); }
        }
      }
      if (size >= 8) lakeCells.push({ id: `lake_${s}`, name: '', areaKm2: (size * CELL_M * CELL_M) / 1e6, levelM: sumLevel / size });
    }
  }

  const region = classifyRegions(h, coastKm, comp, fieldWeight);
  return {
    seed: MASTER_SEED, cellM: CELL_M, n: N, halfM: HALF_M, heightM: h, slopeDeg, coastKm, hydro, basin, region, water, rivers,
    fieldWeight, lakeCells, damPointKm: damPoint, known, sites, landComponent: comp,
  };
}

/**
 * Regions are NOT drawn. Each region has seed cores; least-cost propagation across the terrain
 * (slope and climb are expensive) assigns every land cell, so boundaries settle on ridges, escarpments
 * and valley walls. Islands are assigned by component, and the South Coast is the low coastal plain.
 */
function classifyRegions(h: Float32Array, coastKm: Float32Array, comp: Uint8Array, fieldWeight: Float32Array): Uint8Array {
  const F = 2, NC = N / F, CC = NC * NC, cs = CELL_M * F;
  const hc = new Float32Array(CC), landC = new Uint8Array(CC), compC = new Uint8Array(CC);
  for (let j = 0; j < NC; j++) for (let i = 0; i < NC; i++) {
    let s = 0, land = 0, c = 0;
    for (let dj = 0; dj < F; dj++) for (let di = 0; di < F; di++) {
      const k = (j * F + dj) * N + i * F + di; s += h[k]; if (h[k] > SEA) { land++; c = comp[k] || c; }
    }
    hc[j * NC + i] = s / (F * F); landC[j * NC + i] = land >= (F * F) / 2 ? 1 : 0; compC[j * NC + i] = c;
  }
  const VALLEY_IDX = REGION_IDS.indexOf('R02_central_valley');
  const cost = new Float64Array(CC).fill(Infinity), lab = new Int16Array(CC).fill(-1);
  const heap = new MinHeap(CC * 9 + 16);
  const eC = (i: number) => (-HALF_M + (i + 0.5) * cs) / KM;
  const nC = (j: number) => (-HALF_M + (j + 0.5) * cs) / KM;
  REGION_IDS.forEach((rid, ri) => {
    for (const [se, sn, sr] of REGION_SEEDS[rid]) {
      for (let j = 0; j < NC; j++) for (let i = 0; i < NC; i++) {
        const k = j * NC + i;
        if (!landC[k]) continue;
        if (Math.hypot(eC(i) - se, nC(j) - sn) <= sr && cost[k] > 0) { cost[k] = 0; lab[k] = ri; heap.push(0, k); }
      }
    }
  });
  while (heap.size > 0) {
    heap.pop();
    const c = heap.topV, ck = heap.topK;
    if (ck > cost[c]) continue;
    const ci = c % NC, cj = (c / NC) | 0;
    for (let d = 0; d < 8; d++) {
      const ii = ci + DI[d], jj = cj + DJ[d];
      if (ii < 0 || jj < 0 || ii >= NC || jj >= NC) continue;
      const nn = jj * NC + ii;
      if (!landC[nn] || compC[nn] !== compC[c]) continue;
      const dist = cs * DDIST[d], dh = hc[nn] - hc[c], s = Math.abs(dh) / dist;
      // The Central Valley is defined by its floor: for it, climbing a wall is far more expensive, so the walls fall to the neighbours.
      const climb = lab[c] === VALLEY_IDX ? 160 : 30;
      const nc = ck + dist * (1 + 120 * s) + climb * Math.max(0, dh);
      if (nc < cost[nn]) { cost[nn] = nc; lab[nn] = lab[c]; heap.push(nc, nn); }
    }
  }
  const hb = boxBlur(h, 7);
  const region = new Uint8Array(CELLS).fill(255);
  const seedList = REGION_IDS.flatMap((rid, ri) => REGION_SEEDS[rid].map((s) => ({ ri, s })));
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const k = j * N + i;
    if (h[k] <= SEA) continue;
    let r = lab[((j / F) | 0) * NC + ((i / F) | 0)];
    if (r < 0) { // unreachable land: nearest seed by distance
      let bd = 1e9;
      for (const o of seedList) { const d = Math.hypot(eOf(i) - o.s[0], nOf(j) - o.s[1]) - o.s[2]; if (d < bd) { bd = d; r = o.ri; } }
    }
    // South Coast = the low coastal plain facing the southern sea (mainland only).
    if (comp[k] === 1 && coastKm[k] < 6 && hb[k] < 100 && fieldWeight[k] < 0.5 && (nOf(j) < -8.5 || (eOf(i) > 4.5 && nOf(j) < -3))) r = REGION_IDS.indexOf('R06_south_coast');
    region[k] = r;
  }
  return region;
}

function boxBlur(a: Float32Array, r: number): Float32Array {
  const tmp = new Float32Array(CELLS), out = new Float32Array(CELLS), w = 2 * r + 1;
  for (let j = 0; j < N; j++) {
    let s = 0;
    for (let i = -r; i <= r; i++) s += a[j * N + clamp(i, 0, N - 1)];
    for (let i = 0; i < N; i++) { tmp[j * N + i] = s / w; s += a[j * N + clamp(i + r + 1, 0, N - 1)] - a[j * N + clamp(i - r, 0, N - 1)]; }
  }
  for (let i = 0; i < N; i++) {
    let s = 0;
    for (let j = -r; j <= r; j++) s += tmp[clamp(j, 0, N - 1) * N + i];
    for (let j = 0; j < N; j++) { out[j * N + i] = s / w; s += tmp[clamp(j + r + 1, 0, N - 1) * N + i] - tmp[clamp(j - r, 0, N - 1) * N + i]; }
  }
  return out;
}

/* ------------------------------ query surface ------------------------------ */
export interface MasterSample {
  land: boolean;
  elevationM: number;
  slopeDeg: number;
  region: RegionId | null;
  /** Basin outlet id (0 = none/ocean). */
  basinId: number;
  water: 'sea' | 'river' | 'lake' | 'lagoon' | null;
  /** Signed distance to the coast (m; + inland). */
  coastDistM: number;
  /** Upstream catchment (km²) draining through this cell (0 offshore). */
  catchmentKm2: number;
}

export function sampleMaster(map: MasterMapData, x: number, z: number): MasterSample {
  const [e, n] = worldToGeo(x, z);
  const fi = clamp(Math.round((e * KM + HALF_M) / CELL_M - 0.5), 0, N - 1), fj = clamp(Math.round((n * KM + HALF_M) / CELL_M - 0.5), 0, N - 1);
  const k = fj * N + fi;
  const elevationM = bilinear(map.heightM, e, n);
  const land = elevationM > SEA;
  const w = map.water[k];
  const r = map.region[k];
  return {
    land, elevationM, slopeDeg: map.slopeDeg[k],
    region: land && r !== 255 ? REGION_IDS[r] : null,
    basinId: land ? map.basin[k] : 0,
    water: !land ? (w === 3 ? 'lagoon' : 'sea') : w === 1 ? 'river' : w === 2 ? 'lake' : w === 3 ? 'lagoon' : null,
    coastDistM: bilinear(map.coastKm, e, n) * KM,
    catchmentKm2: land ? map.hydro.accum[k] * (CELL_M / KM) ** 2 : 0,
  };
}

let cached: MasterMapData | null = null;
/** Lazily built, deterministic (fixed seed) singleton. */
export function getMasterMap(): MasterMapData {
  return (cached ??= buildMasterMap());
}

export { REGION_IDS };
