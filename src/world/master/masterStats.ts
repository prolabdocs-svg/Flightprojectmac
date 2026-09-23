import { CELL_M, GRID_N, HALF_M, REGION_IDS, REGION_NAMES, type RegionId } from './masterGeography';
import { RIVER_ACCUM_CELLS, isDeclaredLake, type MasterMapData } from './masterMap';

const N = GRID_N;
const KM2 = (CELL_M / 1000) ** 2;
const DI = [-1, 0, 1, -1, 1, -1, 0, 1], DJ = [-1, -1, -1, 0, 0, 1, 1, 1];

export const ELEVATION_BANDS: ReadonlyArray<{ id: string; label: string; lo: number; hi: number }> = [
  { id: 'beach', label: 'Playa 0–8 m', lo: 0, hi: 8 },
  { id: 'coastal', label: 'Llanura costera 8–80 m', lo: 8, hi: 80 },
  { id: 'valley', label: 'Valle 80–350 m', lo: 80, hi: 350 },
  { id: 'plateau', label: 'Meseta 350–900 m', lo: 350, hi: 900 },
  { id: 'sierra', label: 'Sierra 900–1,800 m', lo: 900, hi: 1800 },
  { id: 'alpine', label: 'Alta montaña 1,800–2,700 m', lo: 1800, hi: 2700 },
  { id: 'summit', label: 'Cumbres >2,700 m', lo: 2700, hi: 1e9 },
];

export const cellOfGeo = (e: number, n: number): number =>
  Math.min(N - 1, Math.max(0, Math.round((n * 1000 + HALF_M) / CELL_M - 0.5))) * N + Math.min(N - 1, Math.max(0, Math.round((e * 1000 + HALF_M) / CELL_M - 0.5)));

/** Follow D8 receivers from a cell to the ocean. `rise` sums uphill steps of the REAL terrain outside filled lakes. */
export function traceDownstream(m: MasterMapData, start: number): { reachesSea: boolean; steps: number; rise: number; maxStepRise: number; mouth: number; lastLand: number } {
  let c = start, steps = 0, rise = 0, maxStepRise = 0, lastLand = start;
  while (m.heightM[c] > 0 && steps < 200000) {
    const r = m.hydro.recv[c];
    if (r < 0) break;
    const inLake = m.hydro.filled[c] - m.heightM[c] > 0.4 || m.hydro.filled[r] - m.heightM[r] > 0.4;
    if (!inLake && m.heightM[r] > m.heightM[c]) { rise += m.heightM[r] - m.heightM[c]; maxStepRise = Math.max(maxStepRise, m.heightM[r] - m.heightM[c]); }
    if (m.heightM[c] > 0) lastLand = c;
    c = r; steps++;
  }
  return { reachesSea: m.heightM[c] <= 0, steps, rise, maxStepRise, mouth: c, lastLand };
}

export function computeMasterStats(m: MasterMapData) {
  const h = m.heightM;
  let land = 0, max = -1e9, maxK = 0, minSea = 0;
  const bandCells = ELEVATION_BANDS.map(() => 0);
  for (let k = 0; k < h.length; k++) {
    if (h[k] > 0) {
      land++;
      if (h[k] > max) { max = h[k]; maxK = k; }
      const b = ELEVATION_BANDS.findIndex((x) => h[k] >= x.lo && h[k] < x.hi);
      if (b >= 0) bandCells[b]++;
    } else if (h[k] < minSea) minSea = h[k];
  }
  const total = h.length;
  const landPct = (100 * land) / total;

  // Component areas + strait (min distance mainland <-> eastern island), via brute force over coast cells.
  const compArea = new Map<number, number>();
  for (const c of m.landComponent) if (c) compArea.set(c, (compArea.get(c) ?? 0) + KM2);
  const coastCells = (comp: number): Array<[number, number]> => {
    const out: Array<[number, number]> = [];
    for (let j = 1; j < N - 1; j++) for (let i = 1; i < N - 1; i++) {
      if (m.landComponent[j * N + i] !== comp) continue;
      for (let d = 0; d < 8; d++) if (m.landComponent[(j + DJ[d]) * N + i + DI[d]] === 0) { out.push([i, j]); break; }
    }
    return out;
  };
  const a = coastCells(1), b = coastCells(2);
  let strait = 1e9;
  for (const p of b) for (const q of a) { const d = (p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2; if (d < strait) strait = d; }
  const straitKm = (Math.sqrt(strait) * CELL_M) / 1000;

  // Regions.
  const regionArea: Record<string, number> = {};
  const regionElev: Record<string, { min: number; mean: number; max: number }> = {};
  REGION_IDS.forEach((rid, ri) => {
    let c = 0, s = 0, mn = 1e9, mx = -1e9;
    for (let k = 0; k < total; k++) if (m.region[k] === ri) { c++; s += h[k]; mn = Math.min(mn, h[k]); mx = Math.max(mx, h[k]); }
    regionArea[rid] = c * KM2;
    regionElev[rid] = { min: c ? mn : 0, mean: c ? s / c : 0, max: c ? mx : 0 };
  });

  // Rivers via D8 from each authored source.
  const rivers = m.rivers.map((r) => {
    let viol = 0;
    for (let i = 1; i < r.floorM.length; i++) if (r.floorM[i] > r.floorM[i - 1] + 1e-6) viol++;
    const tr = traceDownstream(m, cellOfGeo(r.e[0], r.n[0]));
    return {
      id: r.id, name: r.name, kind: r.kind, parent: r.parent ?? null, lengthKm: r.lengthKm,
      sourceM: r.floorM[0], mouthM: r.floorM[r.floorM.length - 1], floorViolations: viol,
      d8ReachesSea: tr.reachesSea, d8RiseM: tr.rise,
    };
  });

  // Depressions: pits that are not a declared lake. Inside the Field core the terrain is kept verbatim
  // (its own sub-4 m micro-pits are reported separately and are not part of the macro-hydrology).
  let strayCells = 0, strayMaxDepth = 0, strayVolume = 0, lakeCells = 0, fieldPitCells = 0, fieldPitMax = 0;
  for (let k = 0; k < total; k++) {
    if (h[k] <= 0) continue;
    const fd = m.hydro.filled[k] - h[k];
    if (fd <= 0.4) continue;
    lakeCells++;
    const e = (-HALF_M + ((k % N) + 0.5) * CELL_M) / 1000, n = (-HALF_M + (((k / N) | 0) + 0.5) * CELL_M) / 1000;
    if (isDeclaredLake(m.known, e, n, m.hydro.filled[k])) continue;
    if (m.fieldWeight[k] >= 0.999) { fieldPitCells++; fieldPitMax = Math.max(fieldPitMax, fd); continue; }
    strayCells++; strayMaxDepth = Math.max(strayMaxDepth, fd); strayVolume += fd * KM2 * 1e6;
  }

  // Starter Basin conservation: Field terrain verbatim at the core.
  const mainBasin = (() => {
    const mainMouth = m.rivers.find((r) => r.id === 'rio_principal');
    if (!mainMouth) return 0;
    const tr = traceDownstream(m, cellOfGeo(mainMouth.e[0], mainMouth.n[0]));
    const id = m.basin[cellOfGeo(mainMouth.e[0], mainMouth.n[0])];
    let cells = 0;
    for (let k = 0; k < total; k++) if (m.basin[k] === id) cells++;
    void tr;
    return cells * KM2;
  })();

  let streamCells = 0;
  for (let k = 0; k < total; k++) if (h[k] > 0 && m.hydro.accum[k] >= RIVER_ACCUM_CELLS) streamCells++;

  let steep30 = 0, gentle8 = 0;
  for (let k = 0; k < total; k++) if (h[k] > 0) { if (m.slopeDeg[k] > 30) steep30++; if (m.slopeDeg[k] < 8) gentle8++; }

  return {
    seed: m.seed, gridN: N, cellM: CELL_M, extentKm: (2 * HALF_M) / 1000, totalKm2: total * KM2,
    landKm2: land * KM2, landPct, oceanPct: 100 - landPct,
    maxElevM: max, maxElevAtKm: [(-HALF_M + ((maxK % N) + 0.5) * CELL_M) / 1000, (-HALF_M + (((maxK / N) | 0) + 0.5) * CELL_M) / 1000],
    maxSeaDepthM: -minSea,
    elevationBandsPctOfLand: Object.fromEntries(ELEVATION_BANDS.map((x, i) => [x.label, +((100 * bandCells[i]) / land).toFixed(2)])),
    landComponentsKm2: Object.fromEntries([...compArea.entries()].map(([k, v]) => [k === 1 ? 'mainland' : k === 2 ? 'eastern_island' : `islet_${k}`, +v.toFixed(2)])),
    islandCount: compArea.size - 1,
    straitMinKm: +straitKm.toFixed(2),
    regionAreaKm2: Object.fromEntries(REGION_IDS.map((r) => [REGION_NAMES[r as RegionId], +regionArea[r].toFixed(1)])),
    regionElevationM: Object.fromEntries(REGION_IDS.map((r) => [REGION_NAMES[r as RegionId], { min: +regionElev[r].min.toFixed(0), mean: +regionElev[r].mean.toFixed(0), max: +regionElev[r].max.toFixed(0) }])),
    rivers,
    perennialRivers: rivers.filter((r) => r.kind === 'perennial').length,
    tributariesOfMainRiver: rivers.filter((r) => r.parent === 'rio_principal').length,
    mainBasinKm2: +mainBasin.toFixed(1),
    riverCellsKm2Catchment: +(streamCells * KM2).toFixed(1),
    lakes: m.lakeCells.filter((l) => l.areaKm2 >= 0.1).map((l) => ({ areaKm2: +l.areaKm2.toFixed(2), levelM: +l.levelM.toFixed(0) })).sort((p, q) => q.areaKm2 - p.areaKm2),
    fieldCoreMicroPits: { cells: fieldPitCells, maxDepthM: +fieldPitMax.toFixed(2) },
    strayDepressions: { cells: strayCells, areaKm2: +(strayCells * KM2).toFixed(3), maxDepthM: +strayMaxDepth.toFixed(2), volumeM3: Math.round(strayVolume) },
    standingWaterCells: lakeCells,
    slope: { landPctOver30deg: +((100 * steep30) / land).toFixed(2), landPctUnder8deg: +((100 * gentle8) / land).toFixed(2) },
  };
}
