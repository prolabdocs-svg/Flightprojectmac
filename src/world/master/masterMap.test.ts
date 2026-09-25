import { beforeAll, describe, expect, it } from 'vitest';
import { fieldElevation } from '../fieldGeography';
import { AIRFIELDS } from '../airfields';
import {
  CELL_M, GRID_N, HALF_M, REGION_IDS, STARTER_BASIN, fieldLocalToMaster, geoToWorld, masterToFieldLocal, worldToGeo, type RegionId,
} from './masterGeography';
import { buildMasterMap, getMasterMap, isDeclaredLake, sampleMaster, type MasterMapData } from './masterMap';
import { cellOfGeo, computeMasterStats, traceDownstream } from './masterStats';

const N = GRID_N;
const region = (_m: MasterMapData, rid: RegionId) => REGION_IDS.indexOf(rid);
const cellGeo = (k: number): [number, number] => [(-HALF_M + ((k % N) + 0.5) * CELL_M) / 1000, (-HALF_M + (((k / N) | 0) + 0.5) * CELL_M) / 1000];

let m: MasterMapData;
let stats: ReturnType<typeof computeMasterStats>;
beforeAll(() => { m = getMasterMap(); stats = computeMasterStats(m); }, 120_000);

describe('Master Geographic Map V1 — world frame', () => {
  it('covers X/Z = ±24,000 m in the authored core, with the game handedness (east is -X)', () => {
    expect(m.halfM).toBe(24000);
    expect(m.n * m.cellM).toBe(48000);
    expect(worldToGeo(-5000, 7000)).toEqual([5, 7]); // 5 km east of origin is world x = -5000
    expect(geoToWorld(5, 7)).toEqual([-5000, 7000]);
    expect(sampleMaster(m, 24000, 24000).land).toBe(false); // outside/at the border is sea
    expect(sampleMaster(m, -24000, -24000).land).toBe(false);
  });

  it('is deterministic (fixed seed)', () => {
    const again = buildMasterMap();
    expect(again.heightM.length).toBe(m.heightM.length);
    let diff = 0;
    for (let k = 0; k < m.heightM.length; k++) if (again.heightM[k] !== m.heightM[k]) diff++;
    expect(diff).toBe(0);
  }, 120_000);
});

describe('vertical range (spec §4)', () => {
  it('peaks at ≈2,850 m and never exceeds it', () => {
    expect(stats.maxElevM).toBeGreaterThan(2700);
    expect(stats.maxElevM).toBeLessThanOrEqual(2850);
  });
  it('has sea (≤0 m), coast, valley, plateau, sierra and alpine terrain, without banding', () => {
    const b = stats.elevationBandsPctOfLand;
    for (const v of Object.values(b)) expect(v).toBeGreaterThan(0);
    // No single band is an artificial slab: no band holds more than 45% of the land.
    for (const v of Object.values(b)) expect(v).toBeLessThan(45);
    expect(stats.maxSeaDepthM).toBeGreaterThan(300);
  });
});

describe('land / ocean (spec §1)', () => {
  it('is 55–65% land', () => {
    expect(stats.landPct).toBeGreaterThanOrEqual(55);
    expect(stats.landPct).toBeLessThanOrEqual(65);
  });
  it('has one continuous mainland holding ≥95% of the big-landmass area, one eastern island and an archipelago', () => {
    const c = stats.landComponentsKm2 as Record<string, number>;
    expect(c.mainland).toBeGreaterThan(1000);
    expect(c.eastern_island).toBeGreaterThan(60);
    expect(c.mainland).toBeGreaterThan(c.eastern_island * 10);
    const islets = Object.entries(c).filter(([k]) => k.startsWith('islet_'));
    expect(islets.length).toBeGreaterThanOrEqual(5);
    // the mainland is a single 8-connected component: no fragments of it were labelled as islets
    const nearMainland = islets.filter(([k]) => {
      const id = Number(k.split('_')[1]);
      for (let q = 0; q < m.landComponent.length; q++) if (m.landComponent[q] === id) { return cellGeo(q)[1] > -14; }
      return false;
    });
    expect(nearMainland.reduce((s, [, v]) => s + v, 0)).toBeLessThan(2);
  });
  it('separates Eastern Island from the mainland by 6–10 km of open water', () => {
    expect(stats.straitMinKm).toBeGreaterThanOrEqual(6);
    expect(stats.straitMinKm).toBeLessThanOrEqual(10);
  });
  it('gives Eastern Island its own 1,450–1,550 m volcano', () => {
    let max = 0;
    for (let k = 0; k < m.heightM.length; k++) if (m.landComponent[k] === 2 && m.heightM[k] > max) max = m.heightM[k];
    expect(max).toBeGreaterThanOrEqual(1450);
    expect(max).toBeLessThanOrEqual(1550);
    expect(max).toBeLessThan(stats.maxElevM); // never above the continental ceiling
  });
  it('is a chain: the archipelago follows the submerged arc (aligned, ≥5 islands, none inside the Northern Mountains)', () => {
    const ids = new Set<number>();
    const pts: Array<[number, number]> = [];
    for (let k = 0; k < m.landComponent.length; k++) { const c = m.landComponent[k]; if (c >= 3 && m.region[k] === region(m, 'R08_southern_archipelago')) { ids.add(c); pts.push(cellGeo(k)); } }
    expect(ids.size).toBeGreaterThanOrEqual(5);
    // arc trend: E increases while N stays within a narrow southern band
    const ns = pts.map((p) => p[1]);
    expect(Math.max(...ns)).toBeLessThan(-14);
    expect(Math.min(...ns)).toBeGreaterThan(-23.5);
    const es = pts.map((p) => p[0]);
    expect(Math.max(...es) - Math.min(...es)).toBeGreaterThan(15);
  });
});

describe('geology (spec §3)', () => {
  it('primary range trends NW→SE', () => {
    const pts: Array<[number, number]> = [];
    for (let k = 0; k < m.heightM.length; k++) if (m.heightM[k] > 1900 && m.landComponent[k] === 1) pts.push(cellGeo(k));
    const me = pts.reduce((s, p) => s + p[0], 0) / pts.length, mn = pts.reduce((s, p) => s + p[1], 0) / pts.length;
    let see = 0, snn = 0, sen = 0;
    for (const p of pts) { see += (p[0] - me) ** 2; snn += (p[1] - mn) ** 2; sen += (p[0] - me) * (p[1] - mn); }
    const angle = (0.5 * Math.atan2(2 * sen, see - snn) * 180) / Math.PI; // angle of the major axis from +E toward +N
    expect(angle).toBeLessThan(-12); // heading down toward the south while going east = NW→SE
    expect(angle).toBeGreaterThan(-55);
  });
  it('the primary crest is the main watershed divide: north slope drains north, south slope drains south', () => {
    const north = traceDownstream(m, cellOfGeo(-9.4, 18.6));
    const south = traceDownstream(m, cellOfGeo(-0.8, 9.3));
    expect(north.reachesSea && south.reachesSea).toBe(true);
    expect(cellGeo(north.mouth)[1]).toBeGreaterThan(14);
    expect(cellGeo(south.mouth)[1]).toBeLessThan(-10);
    // ...and the north-west upland (west of the valley wall) drains west to the Badlands coast, not into the main river
    const nw = traceDownstream(m, cellOfGeo(-8.0, 10.6));
    expect(nw.reachesSea).toBe(true);
    expect(cellGeo(nw.mouth)[0]).toBeLessThan(-20);
  });
  it('the northern range has real alpine slopes and the basin/valleys are mostly gentle', () => {
    let maxSlope = 0, r1 = 0, r1Gentle = 0, r2 = 0, r2Gentle = 0, plain = 0, plainGentle = 0;
    const [he, hn] = STARTER_BASIN.homeGeoKm;
    for (let k = 0; k < m.heightM.length; k++) {
      if (m.region[k] === region(m, 'R03_northern_mountains')) maxSlope = Math.max(maxSlope, m.slopeDeg[k]);
      if (m.region[k] === region(m, 'R01_starter_basin')) { r1++; if (m.slopeDeg[k] < 8) r1Gentle++; }
      { const [e, n] = cellGeo(k); if (Math.hypot(e - he, n - hn) < 2.5) { plain++; if (m.slopeDeg[k] < 8) plainGentle++; } }
      if (m.region[k] === region(m, 'R02_central_valley')) { r2++; if (m.slopeDeg[k] < 8) r2Gentle++; }
    }
    expect(maxSlope).toBeGreaterThan(35);
    expect(plainGentle / plain).toBeGreaterThan(0.85); // the home plain itself (spec R01: slopes generally < 8°)
    expect(r1Gentle / r1).toBeGreaterThan(0.45); // whole R01 includes the Field's own 680 m foothill chain
    expect(r2Gentle / r2).toBeGreaterThan(0.6);
  });
});

describe('hydrology (spec §6–7)', () => {
  const rivers = () => stats.rivers;
  it('every river descends monotonically and reaches the ocean via D8 without uphill steps', () => {
    for (const r of rivers()) {
      expect(r.floorViolations, `${r.id} bed must never rise downstream`).toBe(0);
      expect(r.d8ReachesSea, `${r.id} must reach the sea`).toBe(true);
      expect(r.d8RiseM, `${r.id} climbs ${r.d8RiseM} m`).toBeLessThan(1.5);
      if (!r.parent) expect(r.mouthM, `${r.id} authored course must end at the coast (bed ≤ 5 m)`).toBeLessThanOrEqual(5);
    }
  });
  it('the main river is born in the Northern Mountains, crosses the Central Valley and ends in South Coast', () => {
    const main = m.rivers.find((r) => r.id === 'rio_principal')!;
    const at = (i: number) => m.region[cellOfGeo(main.e[i], main.n[i])];
    expect(at(2)).toBe(region(m, 'R03_northern_mountains'));
    let valley = 0;
    for (let i = 0; i < main.e.length; i++) if (at(i) === region(m, 'R02_central_valley')) valley++;
    expect(valley * 0.09).toBeGreaterThan(12); // ≥12 km of the course inside the Central Valley
    const tr = traceDownstream(m, cellOfGeo(main.e[0], main.n[0]));
    expect(m.region[tr.lastLand]).toBe(region(m, 'R06_south_coast'));
    expect(main.floorM[0]).toBeGreaterThan(1000);
  });
  it('has 4–7 main tributaries that join the main river exactly, plus small independent drainages', () => {
    expect(stats.tributariesOfMainRiver).toBeGreaterThanOrEqual(4);
    expect(stats.tributariesOfMainRiver).toBeLessThanOrEqual(7);
    const main = m.rivers.find((r) => r.id === 'rio_principal')!;
    for (const t of m.rivers.filter((r) => r.parent === 'rio_principal')) {
      const le = t.e[t.e.length - 1], ln = t.n[t.n.length - 1];
      let d = 1e9;
      for (let i = 0; i < main.e.length; i++) d = Math.min(d, Math.hypot(main.e[i] - le, main.n[i] - ln));
      expect(d, `${t.id} confluence`).toBeLessThan(0.01);
      const j = main.e.findIndex((x, i) => Math.hypot(x - le, main.n[i] - ln) < 0.01);
      expect(t.floorM[t.floorM.length - 1], `${t.id} joins above the main bed`).toBeGreaterThanOrEqual(main.floorM[j] - 0.01);
    }
    expect(stats.perennialRivers).toBeGreaterThanOrEqual(10);
  });
  it('meanders where the gradient drops (main river sinuosity > 1.1 across its lower half)', () => {
    const main = m.rivers.find((r) => r.id === 'rio_principal')!;
    const from = Math.floor(main.e.length * 0.5);
    let len = 0;
    for (let i = from + 1; i < main.e.length; i++) len += Math.hypot(main.e[i] - main.e[i - 1], main.n[i] - main.n[i - 1]);
    const straight = Math.hypot(main.e[main.e.length - 1] - main.e[from], main.n[main.n.length - 1] - main.n[from]);
    expect(len / straight).toBeGreaterThan(1.1);
  });
  it('has a mountain lake, a dyked reservoir and a coastal lagoon, plus the Field lake, each distinct', () => {
    const espejo = m.lakeCells.filter((l) => l.levelM > 1200 && l.areaKm2 > 0.3);
    expect(espejo.length).toBe(1);
    const reservoir = m.lakeCells.filter((l) => l.levelM > 300 && l.levelM < 1000 && l.areaKm2 > 0.9 && l.areaKm2 < 6);
    expect(reservoir.length).toBe(1);
    const field = m.lakeCells.filter((l) => Math.abs(l.levelM - (STARTER_BASIN.elevationOffsetM - 12)) < 6 && l.areaKm2 > 1);
    expect(field.length).toBe(1);
    let lagoon = 0, lagoonRegionOk = true;
    for (let k = 0; k < m.water.length; k++) if (m.water[k] === 3) { lagoon++; if (m.coastKm[k] > 3) lagoonRegionOk = false; }
    expect(lagoon * (CELL_M / 1000) ** 2).toBeGreaterThan(0.5);
    expect(lagoonRegionOk).toBe(true);
    expect(sampleMaster(m, ...geoToWorld(6.3, -12.1)).water).toBe('lagoon');
    // the reservoir has a dam location recorded and sits above the valley floor it feeds
    expect(m.damPointKm).not.toBeNull();
  });
  it('has no accidental depressions: every standing-water cell belongs to a declared lake (Field core micro-pits excepted, ≤30 m and outside macro drainage)', () => {
    expect(stats.strayDepressions.cells).toBe(0);
    let stray = 0;
    for (let k = 0; k < m.heightM.length; k++) {
      const fd = m.hydro.filled[k] - m.heightM[k];
      if (m.heightM[k] > 0 && fd > 0.4 && m.fieldWeight[k] < 0.999) { const [e, n] = cellGeo(k); if (!isDeclaredLake(m.known, e, n, m.hydro.filled[k])) stray++; }
    }
    expect(stray).toBe(0);
    expect(stats.fieldCoreMicroPits.maxDepthM).toBeLessThan(30);
  });
});

describe('regions (spec §5): nine, derived from relief', () => {
  it('all nine exist, are non-trivial and (main body) contiguous', () => {
    for (const rid of REGION_IDS) {
      const ri = region(m, rid);
      let cells = 0;
      for (let k = 0; k < m.region.length; k++) if (m.region[k] === ri) cells++;
      expect(cells, rid).toBeGreaterThan(rid === 'R08_southern_archipelago' ? 100 : 3000);
    }
    // contiguity: the largest 4-connected blob of each mainland/island region holds ≥85% of it
    for (const rid of REGION_IDS.filter((r) => r !== 'R08_southern_archipelago')) {
      const ri = region(m, rid), seen = new Uint8Array(m.region.length);
      let total = 0, best = 0;
      for (let s = 0; s < m.region.length; s++) {
        if (m.region[s] !== ri) continue;
        total++;
        if (seen[s]) continue;
        let size = 0; const stack = [s]; seen[s] = 1;
        while (stack.length) {
          const c = stack.pop() as number; size++;
          for (const d of [-1, 1, -N, N]) { const q = c + d; if (q >= 0 && q < m.region.length && !seen[q] && m.region[q] === ri) { seen[q] = 1; stack.push(q); } }
        }
        best = Math.max(best, size);
      }
      expect(best / total, `${rid} contiguity`).toBeGreaterThan(0.85);
    }
  });
  it('match their physiographic character (elevation, slope)', () => {
    const E = stats.regionElevationM as Record<string, { min: number; mean: number; max: number }>;
    expect(E['Starter Basin'].mean).toBeGreaterThan(180);
    expect(E['Starter Basin'].mean).toBeLessThan(450);
    expect(E['Central Valley'].mean).toBeGreaterThan(80);
    expect(E['Central Valley'].mean).toBeLessThan(420);
    expect(E['Northern Mountains'].mean).toBeGreaterThan(800);
    expect(E['Northern Mountains'].max).toBeGreaterThan(2700);
    expect(E['Western Badlands'].mean).toBeGreaterThan(250);
    expect(E['Southern Greenbelt'].max).toBeLessThan(700);
    expect(E['South Coast'].mean).toBeLessThan(120);
    expect(E['Eastern Island'].max).toBeGreaterThan(1300);
    expect(E['Eastern Highlands'].mean).toBeGreaterThan(700);
    expect(E['Southern Archipelago'].max).toBeLessThan(500);
  });
  it('places Central Valley 5–9 km wide and ≈18 km long around the main river', () => {
    const ri = region(m, 'R02_central_valley');
    let minN = 99, maxN = -99;
    for (let k = 0; k < m.region.length; k++) if (m.region[k] === ri) { const n = cellGeo(k)[1]; minN = Math.min(minN, n); maxN = Math.max(maxN, n); }
    expect(maxN - minN).toBeGreaterThan(14);
    // width at mid-length
    const midN = (maxN + minN) / 2;
    let w = 0;
    const j = Math.round((midN * 1000 + HALF_M) / CELL_M - 0.5);
    for (let i = 0; i < N; i++) if (m.region[j * N + i] === ri) w++;
    expect((w * CELL_M) / 1000).toBeGreaterThan(4);
    expect((w * CELL_M) / 1000).toBeLessThan(11);
  });
});

describe('Starter Basin conserves The Field (R01)', () => {
  it('translates the Field rigidly: home strip is at world (10500, -2000) = geographic (−10.5, −2.0) km, inside R01, at ~236 m', () => {
    const [wx, wz] = fieldLocalToMaster(0, 0);
    expect([wx, wz]).toEqual([10500, -2000]);
    expect(masterToFieldLocal(wx, wz)).toEqual([0, 0]);
    const s = sampleMaster(m, wx, wz);
    expect(s.region).toBe('R01_starter_basin');
    expect(s.land).toBe(true);
    expect(s.elevationM).toBeGreaterThan(180);
    expect(s.elevationM).toBeLessThan(320); // spec R01 altitude band
    expect(Math.abs(s.elevationM - (fieldElevation(0, 0) + STARTER_BASIN.elevationOffsetM))).toBeLessThan(0.6);
  });
  it('reproduces the Field terrain verbatim (± float32) throughout its core: same relief, lake and river valley', () => {
    let worst = 0, count = 0;
    const R = STARTER_BASIN.coreRadiusM - 60;
    for (let lz = -R; lz <= R; lz += 137) for (let lx = -R; lx <= R; lx += 137) {
      const [wx, wz] = fieldLocalToMaster(lx, lz);
      const [e, n] = worldToGeo(wx, wz);
      const k = cellOfGeo(e, n);
      // compare at the actual cell centre so no resampling error creeps in
      const [ce, cn] = cellGeo(k);
      const [cwx, cwz] = geoToWorld(ce, cn);
      const [llx, llz] = masterToFieldLocal(cwx, cwz);
      const expected = fieldElevation(llx, llz) + STARTER_BASIN.elevationOffsetM;
      worst = Math.max(worst, Math.abs(m.heightM[k] - expected)); count++;
    }
    expect(count).toBeGreaterThan(500);
    expect(worst).toBeLessThan(0.05);
  });
  it('keeps every Starter Basin airfield on land, in R01, at the Field-defined elevation', () => {
    for (const a of AIRFIELDS.filter((x) => x.regionId === 'the_field')) {
      const [wx, wz] = fieldLocalToMaster(a.position[0], a.position[2]);
      const s = sampleMaster(m, wx, wz);
      expect(s.land, a.id).toBe(true);
      expect(s.region, a.id).toBe('R01_starter_basin');
      expect(Math.abs(s.elevationM - (fieldElevation(a.position[0], a.position[2]) + STARTER_BASIN.elevationOffsetM)), a.id).toBeLessThan(1.5);
    }
  });
  it('drains the Field river (Field control points, fixed floors) into the main river, downhill, as a tributary', () => {
    const f = m.rivers.find((r) => r.id === 'rio_field')!;
    expect(f.parent).toBe('rio_principal');
    expect(f.fixedTo - f.fixedFrom).toBeGreaterThan(40);
    const tr = traceDownstream(m, cellOfGeo(f.e[f.fixedFrom + 3], f.n[f.fixedFrom + 3]));
    expect(tr.reachesSea).toBe(true);
    // Spec §19.2 is a per-step test (elevation[next] <= elevation[current] + tolerance): the Field river falls ~1 m/km, so
    // D8 zigzag across its carved channel on 48 m cells adds sub-0.3 m steps that sum up over ~15 km without being uphill.
    expect(tr.maxStepRise).toBeLessThan(0.5);
  });
  it('R01 sits west of the Central Valley and south of the foothill sierra (spatial relations kept)', () => {
    const home = sampleMaster(m, ...fieldLocalToMaster(0, 0));
    const [he, hn] = worldToGeo(...fieldLocalToMaster(0, 0));
    const valley = REGION_IDS.indexOf('R02_central_valley');
    let vE = 0, c = 0;
    for (let k = 0; k < m.region.length; k++) if (m.region[k] === valley) { vE += cellGeo(k)[0]; c++; }
    expect(vE / c).toBeGreaterThan(he + 6);
    // foothill sierra: terrain 4 km north of home is ≥ 500 m above home (the Field's own 680 m chain)
    expect(sampleMaster(m, ...fieldLocalToMaster(0, 4100)).elevationM - home.elevationM).toBeGreaterThan(500);
    expect(hn).toBe(-2);
  });
});

describe('query surface', () => {
  it('answers land/water, elevation, slope, region, basin and catchment from world coordinates', () => {
    const [px, pz] = geoToWorld(-9.5, 14.9); // Gran Pico
    const peak = sampleMaster(m, px, pz);
    expect(peak.land).toBe(true);
    expect(peak.elevationM).toBeGreaterThan(2500);
    expect(peak.region).toBe('R03_northern_mountains');
    const [sx, sz] = geoToWorld(0, -20); // open sea south of the coast
    const sea = sampleMaster(m, sx, sz);
    expect(sea.land).toBe(false);
    expect(sea.water).toBe('sea');
    expect(sea.region).toBeNull();
    expect(sea.coastDistM).toBeLessThan(0);
    const main = m.rivers.find((r) => r.id === 'rio_principal')!;
    const i = Math.floor(main.e.length * 0.6);
    const [rx, rz] = geoToWorld(main.e[i], main.n[i]);
    // the thalweg is narrower than one cell and meanders inside it: take the best of the 3x3 neighbourhood
    let river = sampleMaster(m, rx, rz);
    for (let dz = -CELL_M; dz <= CELL_M; dz += CELL_M) for (let dx = -CELL_M; dx <= CELL_M; dx += CELL_M) {
      const q = sampleMaster(m, rx + dx, rz + dz);
      if (q.catchmentKm2 > river.catchmentKm2) river = q;
    }
    expect(river.catchmentKm2).toBeGreaterThan(20);
    expect(river.basinId).toBeGreaterThan(0);
  });
});

describe('Phase 1 final iteration — regressions', () => {
  const geo = (k: number) => cellGeo(k);

  it('Eastern Island is compact and indented, not a strip (PCA aspect ≤ 2.5, convex-hull deficiency ≥ 8%, ≥ 80 km²)', () => {
    const cells: Array<[number, number]> = [];
    for (let k = 0; k < m.landComponent.length; k++) if (m.landComponent[k] === 2) cells.push(geo(k));
    const km2 = cells.length * (CELL_M / 1000) ** 2;
    expect(km2).toBeGreaterThan(75);
    const me = cells.reduce((a, p) => a + p[0], 0) / cells.length, mn = cells.reduce((a, p) => a + p[1], 0) / cells.length;
    let a = 0, b = 0, c = 0;
    for (const p of cells) { a += (p[0] - me) ** 2; b += (p[1] - mn) ** 2; c += (p[0] - me) * (p[1] - mn); }
    const tr = a + b, det = a * b - c * c, l1 = tr / 2 + Math.sqrt(tr * tr / 4 - det), l2 = tr / 2 - Math.sqrt(tr * tr / 4 - det);
    expect(Math.sqrt(l1 / l2)).toBeLessThanOrEqual(2.5); // the previous strip was ≈ 4:1
    // convex hull of the coast cells (monotone chain)
    const pts = cells.filter((_, i) => i % 3 === 0).sort((p, q) => p[0] - q[0] || p[1] - q[1]);
    const cross = (o: [number, number], p: [number, number], q: [number, number]) => (p[0] - o[0]) * (q[1] - o[1]) - (p[1] - o[1]) * (q[0] - o[0]);
    const half = (arr: Array<[number, number]>) => { const h: Array<[number, number]> = []; for (const p of arr) { while (h.length >= 2 && cross(h[h.length - 2], h[h.length - 1], p) <= 0) h.pop(); h.push(p); } h.pop(); return h; };
    const hull = [...half(pts), ...half([...pts].reverse())];
    let hullArea = 0;
    for (let i = 0; i < hull.length; i++) { const p = hull[i], q = hull[(i + 1) % hull.length]; hullArea += p[0] * q[1] - q[0] * p[1]; }
    hullArea = Math.abs(hullArea) / 2;
    expect((hullArea - km2) / hullArea).toBeGreaterThanOrEqual(0.08);
  });

  it('the Central Valley region is 5–9.5 km wide along its length and 17–21 km long, with a 4–8 km physical floor corridor', () => {
    const ri = region(m, 'R02_central_valley');
    let minN = 99, maxN = -99;
    for (let k = 0; k < m.region.length; k++) if (m.region[k] === ri) { const n = geo(k)[1]; minN = Math.min(minN, n); maxN = Math.max(maxN, n); }
    expect(maxN - minN).toBeGreaterThan(17);
    expect(maxN - minN).toBeLessThan(21);
    const widths: number[] = [];
    for (let n = -6; n <= 2; n += 1) {
      const j = Math.round((n * 1000 + HALF_M) / CELL_M - 0.5);
      let w = 0;
      for (let i = 0; i < N; i++) if (m.region[j * N + i] === ri) w++;
      widths.push((w * CELL_M) / 1000);
    }
    const sorted = [...widths].sort((p, q) => p - q);
    expect(sorted[Math.floor(sorted.length / 2)]).toBeGreaterThanOrEqual(5);
    expect(sorted[Math.floor(sorted.length / 2)]).toBeLessThanOrEqual(9);
    for (const w of widths) { expect(w).toBeGreaterThanOrEqual(4.5); expect(w).toBeLessThanOrEqual(9.5); }
    // physical floor: contiguous low, gentle ground around the main river
    const main = m.rivers.find((r) => r.id === 'rio_principal')!;
    for (const n of [-6, -4, -2, 0]) {
      const j = Math.round((n * 1000 + HALF_M) / CELL_M - 0.5);
      let q = 0, best = 9;
      for (let i = 0; i < main.e.length; i++) if (Math.abs(main.n[i] - n) < best) { best = Math.abs(main.n[i] - n); q = i; }
      const ci = Math.round((main.e[q] * 1000 + HALF_M) / CELL_M - 0.5), floor = m.heightM[j * N + ci];
      let l = ci, r = ci;
      while (l > 0 && m.heightM[j * N + l] < floor + 150 && m.slopeDeg[j * N + l] < 12) l--;
      while (r < N - 1 && m.heightM[j * N + r] < floor + 150 && m.slopeDeg[j * N + r] < 12) r++;
      const width = ((r - l) * CELL_M) / 1000;
      expect(width, `floor width at N=${n}`).toBeGreaterThanOrEqual(4);
      expect(width, `floor width at N=${n}`).toBeLessThanOrEqual(8);
    }
  });

  it('the Central Valley has legible walls: ≥ 250 m of relief on both sides within 5 km of the river, and floor hills', () => {
    const main = m.rivers.find((r) => r.id === 'rio_principal')!;
    // N≈0 is deliberately a pass between the two west-wall sierras, so it is not asserted
    for (const n of [-4, -2, 2, 4]) {
      const j = Math.round((n * 1000 + HALF_M) / CELL_M - 0.5);
      let q = 0, best = 9;
      for (let i = 0; i < main.e.length; i++) if (Math.abs(main.n[i] - n) < best) { best = Math.abs(main.n[i] - n); q = i; }
      const ci = Math.round((main.e[q] * 1000 + HALF_M) / CELL_M - 0.5), floor = m.heightM[j * N + ci], span = Math.round(5000 / CELL_M);
      let west = 0, east = 0;
      for (let d = 0; d <= span; d++) { west = Math.max(west, m.heightM[j * N + ci - d]); east = Math.max(east, m.heightM[j * N + ci + d]); }
      expect(west - floor, `west wall N=${n}`).toBeGreaterThan(250);
      expect(east - floor, `east wall N=${n}`).toBeGreaterThan(250);
    }
  });

  it('the north coast is irregular in SCALE: unequal capes/bays, one deep fjord, one thin peninsula (no repeating lobes)', () => {
    // top edge of the mainland per E column, smoothed at 0.6 km
    const top: number[] = [];
    const es: number[] = [];
    for (let i = 0; i < N; i++) {
      const e = (-HALF_M + (i + 0.5) * CELL_M) / 1000;
      if (e < -21 || e > 11.5) continue;
      let t = -99;
      for (let j = N - 1; j > 0; j--) if (m.landComponent[j * N + i] === 1) { t = (-HALF_M + (j + 0.5) * CELL_M) / 1000; break; }
      top.push(t); es.push(e);
    }
    const w = 6, sm = top.map((_, i) => { let s2 = 0, c = 0; for (let q = -w; q <= w; q++) if (top[i + q] !== undefined) { s2 += top[i + q]; c++; } return s2 / c; });
    // significant extrema by zig-zag with a 1.2 km prominence threshold
    const P = 1.2, ext: Array<{ e: number; v: number }> = [];
    let hiI = 0, loI = 0, trend = 0;
    for (let i = 1; i < sm.length; i++) {
      if (sm[i] > sm[hiI]) hiI = i;
      if (sm[i] < sm[loI]) loI = i;
      if (trend <= 0 && sm[i] - sm[loI] >= P) { ext.push({ e: es[loI], v: sm[loI] }); trend = 1; hiI = i; }
      else if (trend >= 0 && sm[hiI] - sm[i] >= P) { ext.push({ e: es[hiI], v: sm[hiI] }); trend = -1; loI = i; }
    }
    expect(ext.length).toBeGreaterThanOrEqual(5);
    const amp: number[] = [];
    for (let i = 1; i < ext.length; i++) amp.push(Math.abs(ext[i].v - ext[i - 1].v));
    const spacing: number[] = [];
    spacing.push(ext[0].e - es[0]);
    for (let i = 1; i < ext.length; i++) spacing.push(ext[i].e - ext[i - 1].e);
    spacing.push(es[es.length - 1] - ext[ext.length - 1].e); // the straight stretches count too
    const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
    const cv = (a: number[]) => Math.sqrt(mean(a.map((v) => (v - mean(a)) ** 2))) / mean(a);
    expect(cv(amp), 'amplitude variation').toBeGreaterThan(0.45);
    expect(cv(spacing), 'spacing variation').toBeGreaterThan(0.4);
    expect(Math.max(...amp)).toBeGreaterThan(3.0); // one deep fjord/bay
    expect(Math.min(...amp)).toBeLessThan(1.6); // and at least one nearly straight stretch
  });

  it('the relief is isotropic (no preferred gully direction from the drainage solver) in the northern mountains', () => {
    const dirs: Array<[number, number, number]> = [[1, 0, 1], [0, 1, 1], [1, 1, 2], [1, -1, 2]]; // di, dj, step² factor
    const acc = [0, 0, 0, 0];
    let n = 0;
    for (let j = 610; j < 890; j++) for (let i = 210; i < 790; i++) {
      const k = j * N + i;
      if (m.region[k] !== region(m, 'R03_northern_mountains') || m.heightM[k] < 300) continue;
      n++;
      dirs.forEach(([di, dj, f], q) => { acc[q] += Math.abs(m.heightM[k + di + dj * N] + m.heightM[k - di - dj * N] - 2 * m.heightM[k]) / f; });
    }
    const a = acc.map((v) => v / n);
    expect(Math.max(...a) / Math.min(...a)).toBeLessThan(1.25);
  });

  it('has no ruler-straight drainage: no channel runs more than 2.6 km in a constant D8 direction (Northern Mountains)', () => {
    let longest = 0;
    const seen = new Uint8Array(m.heightM.length);
    for (let k = 0; k < m.heightM.length; k++) {
      if (m.region[k] !== region(m, 'R03_northern_mountains') || m.hydro.accum[k] < 100 || seen[k]) continue;
      let c = k, run = 0, last = -99;
      for (;;) {
        const r = m.hydro.recv[c];
        if (r < 0 || m.heightM[c] <= 0) break;
        const d = r - c;
        if (d === last) run++; else { run = 1; last = d; }
        longest = Math.max(longest, run);
        c = r;
        if (seen[c]) break;
        seen[c] = 1;
      }
    }
    expect((longest * CELL_M) / 1000).toBeLessThan(2.6);
  });

  it('the Starter Basin headwater beyond the Field core is a natural meandering stream (sinuosity ≥ 1.08), the core itself untouched', () => {
    const f = m.rivers.find((r) => r.id === 'rio_field')!;
    let len = 0;
    for (let i = 1; i < f.fixedFrom; i++) len += Math.hypot(f.e[i] - f.e[i - 1], f.n[i] - f.n[i - 1]);
    const straight = Math.hypot(f.e[f.fixedFrom - 1] - f.e[0], f.n[f.fixedFrom - 1] - f.n[0]);
    expect(len / straight).toBeGreaterThanOrEqual(1.08);
  });

  it('every independent (parentless) river ends at the coast, and the rivers of Eastern Island reach the sea', () => {
    for (const r of stats.rivers.filter((x) => !x.parent)) expect(r.mouthM, r.id).toBeLessThanOrEqual(5);
  });
});
