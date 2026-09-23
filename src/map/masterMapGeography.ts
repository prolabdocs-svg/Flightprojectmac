import { GRID_N, HALF_M, NATURAL_LANDMARKS } from '../world/master/masterGeography';
import { getMasterMap } from '../world/master/masterMap';
import type { MapLabel, RegionMap } from './mapGeography';

/**
 * World Map adapter for the MASTER world (Phase 2): returns the same `RegionMap` contract `WorldMapCanvas` already renders, built ONLY
 * from masterMap data (no terrainQuery, no 3D assets). Coordinates are master WORLD metres (+Z north, east = -X), rect = ±24 km.
 * Use it with `getRegionMap('master')`.
 */
export const MASTER_MAP_ID = 'master';
export const MASTER_RASTER_SIZE = 512;

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
  const m = getMasterMap(), N = MASTER_RASTER_SIZE, F = GRID_N / N; // F master cells per pixel (≈2)
  const rgba = new Uint8ClampedArray(N * N * 4), elevation = new Float32Array(N * N);
  const cell = (i: number, j: number) => Math.min(GRID_N - 1, Math.max(0, j)) * GRID_N + Math.min(GRID_N - 1, Math.max(0, i));
  const px = (i: number, j: number): number => { // mean elevation of the F×F master cells under pixel (i, j); pixel j grows southwards
    let s = 0;
    for (let b = 0; b < F; b++) for (let a = 0; a < F; a++) s += m.heightM[cell(i * F + a, (N - 1 - j) * F + b)];
    return s / (F * F);
  };
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) elevation[j * N + i] = px(i, j);
  const at = (i: number, j: number) => elevation[Math.min(N - 1, Math.max(0, j)) * N + Math.min(N - 1, Math.max(0, i))];
  const cellM = (2 * HALF_M) / N, L = [-0.55, 0.55, 0.63];
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const k = j * N + i, e = elevation[k], mc = cell(i * F + (F >> 1), (N - 1 - j) * F + (F >> 1)), w = m.water[mc];
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
  return { regionId: MASTER_MAP_ID, rect: { minX: -HALF_M, maxX: HALF_M, minZ: -HALF_M, maxZ: HALF_M }, raster: { size: N, rgba, elevation }, rivers, roads: [], bridges: [], parcels: [], pois: [], labels };
}
