import { GRID_N, HALF_M, WORLD_HALF_M, NATURAL_LANDMARKS, fieldLocalToMaster } from '../world/master/masterGeography';
import { getMasterMap, sampleMaster } from '../world/master/masterMap';
import type { MapLabel, RegionMap } from './mapGeography';
import { getRegionMap } from './mapGeography';

/**
 * World Map adapter for the MASTER world (Phase 2): returns the same `RegionMap` contract `WorldMapCanvas` already renders, built ONLY
 * from the same master core and peripheral geography used by streamed terrain. Coordinates are master WORLD metres (+Z north, east = -X), rect = ±36 km.
 * Use it with `getRegionMap('master')`.
 */
export const MASTER_MAP_ID = 'master';
export const MASTER_RASTER_SIZE = 512;

/** Same deterministic peripheral landforms used by streamed runtime terrain. */
export function outerlandElevation(x: number, z: number): number {
  if (Math.abs(x) > WORLD_HALF_M || Math.abs(z) > WORLD_HALF_M) return -260;
  const e = -x / 1000, n = z / 1000;
  const islands = [[-31, -11, 7.4, 10, 720], [-30, 14, 7.1, 9.6, 1180], [30, -15, 7.8, 10.5, 940], [30, 15, 8.3, 9, 1350]] as const;
  let elevation = -260;
  for (const [ce, cn, rx, rz, peak] of islands) {
    const q = Math.hypot((e - ce) / rx, (n - cn) / rz), shore = 1 - smooth(0.82, 1.1, q);
    if (shore <= 0) continue;
    const ridges = Math.max(0, Math.sin((e * 0.42 + n * 0.19) * Math.PI) * Math.cos((n * 0.31 - e * 0.08) * Math.PI));
    elevation = Math.max(elevation, shore * (35 + peak * Math.pow(Math.max(0, 1 - q * q), 0.75) + ridges * 110));
  }
  return elevation;
}
const smooth = (e0: number, e1: number, x: number) => { const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };

// [elevation m, r, g, b]: hypsometric ramp to the 2,850 m ceiling (matches the validation artifacts' palette)
const RAMP: ReadonlyArray<readonly [number, number, number, number]> = [
  [0, 132, 170, 112], [40, 150, 186, 116], [150, 184, 198, 128], [300, 210, 204, 138], [520, 208, 178, 116], [800, 184, 146, 98],
  [1200, 156, 122, 94], [1700, 146, 130, 122], [2200, 182, 180, 180], [2850, 250, 250, 252],
];
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
function ramp(e: number): [number, number, number] {
  if (e <= RAMP[0][0]) return [RAMP[0][1], RAMP[0][2], RAMP[0][3]];
  for (let i = 1; i < RAMP.length; i++) if (e <= RAMP[i][0]) { const u = (e - RAMP[i - 1][0]) / (RAMP[i][0] - RAMP[i - 1][0]); return [lerp(RAMP[i - 1][1], RAMP[i][1], u), lerp(RAMP[i - 1][2], RAMP[i][2], u), lerp(RAMP[i - 1][3], RAMP[i][3], u)]; }
  const l = RAMP[RAMP.length - 1]; return [l[1], l[2], l[3]];
}

export function buildMasterRegionMap(): RegionMap {
  const m = getMasterMap(), N = MASTER_RASTER_SIZE;
  const rgba = new Uint8ClampedArray(N * N * 4), elevation = new Float32Array(N * N);
  const cellM = (2 * WORLD_HALF_M) / N;
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const x = -WORLD_HALF_M + (i + 0.5) * cellM, z = WORLD_HALF_M - (j + 0.5) * cellM;
    elevation[j * N + i] = Math.abs(x) <= HALF_M && Math.abs(z) <= HALF_M ? sampleMaster(m, x, z).elevationM : outerlandElevation(x, z);
  }
  const at = (i: number, j: number) => elevation[Math.min(N - 1, Math.max(0, j)) * N + Math.min(N - 1, Math.max(0, i))];
  const L = [-0.55, 0.55, 0.63];
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const k = j * N + i, e = elevation[k];
    const x = -WORLD_HALF_M + (i + 0.5) * cellM, z = WORLD_HALF_M - (j + 0.5) * cellM;
    const core = Math.abs(x) <= HALF_M && Math.abs(z) <= HALF_M;
    const mc = core ? Math.round((z + HALF_M) / (2 * HALF_M) * (GRID_N - 1)) * GRID_N + Math.round(( -x + HALF_M) / (2 * HALF_M) * (GRID_N - 1)) : -1;
    const w = mc >= 0 ? m.water[mc] : 0;
    let c: readonly number[];
    if (e <= 0) { const d = Math.min(1, -e / 400); c = [lerp(60, 20, d), lerp(112, 52, d), lerp(150, 100, d)]; }
    else if (w === 2 || w === 3) c = [70, 124, 166];
    else if (w === 1) c = [64, 118, 160];
    else {
      c = ramp(e);
      const sE = (at(i + 2, j) - at(i - 2, j)) / (4 * cellM), sN = (at(i, j - 2) - at(i, j + 2)) / (4 * cellM);
      const ex = 2.6, nl = Math.hypot(sE * ex, sN * ex, 1), shade = (-sE * ex * L[0] - sN * ex * L[1] + L[2]) / nl;
      const f = Math.min(1.3, Math.max(0.55, 1.04 + (shade - 0.63) * 1.35));
      c = [c[0] * f, c[1] * f, c[2] * f];
    }
    rgba[k * 4] = c[0]; rgba[k * 4 + 1] = c[1]; rgba[k * 4 + 2] = c[2]; rgba[k * 4 + 3] = 255;
  }
  const rivers = m.rivers.filter((r) => r.kind === 'perennial').map((r): Array<[number, number]> => Array.from(r.e, (e, q): [number, number] => [-e * 1000, r.n[q] * 1000]));
  const labels: MapLabel[] = NATURAL_LANDMARKS.map((l) => ({ id: `lbl_${l.id}`, name: l.name, x: -l.e * 1000, z: l.n * 1000, kind: l.kind === 'lake' ? 'water' : 'mountain' }));
  labels.push({ id: 'lbl_rio_principal', name: 'Río Principal', x: -1.0 * 1000, z: -1.8 * 1000, kind: 'water' });
  // The starter basin remains authored in The Field's original local frame. Transform every
  // cartographic layer through the exact same translation used by terrain and airfields.
  const field = getRegionMap('the_field');
  const point = ([x, z]: readonly [number, number]): [number, number] => fieldLocalToMaster(x, z);
  rivers.push(...field.rivers.map((river) => river.map(point)));
  const roads = field.roads.map((road) => ({ ...road, pts: road.pts.map(point) }));
  const bridges = field.bridges.map((bridge) => { const [x, z] = point([bridge.x, bridge.z]); return { x, z }; });
  const parcels = field.parcels.map((parcel) => ({ ...parcel, center: point(parcel.center) }));
  const pois = field.pois.map((poi) => { const [x, z] = point([poi.x, poi.z]); return { ...poi, x, z }; });
  labels.push(...field.labels.map((label) => { const [x, z] = point([label.x, label.z]); return { ...label, x, z }; }));
  return { regionId: MASTER_MAP_ID, rect: { minX: -WORLD_HALF_M, maxX: WORLD_HALF_M, minZ: -WORLD_HALF_M, maxZ: WORLD_HALF_M }, raster: { size: N, rgba, elevation }, rivers, roads, bridges, parcels, pois, labels };
}
