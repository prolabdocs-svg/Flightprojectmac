import { AIRFIELDS, type AirfieldDefinition } from '../airfields';
import { fieldElevation } from '../fieldGeography';
import { GROUND_SURFACES, type GroundSurfaceId } from '../surfaces';
import { createTerrainQueryService, type TerrainQueryService, type TerrainSample } from '../terrainQuery';
import type { RegionDefinition } from '../../core/types';
import {
  NAMED_AREA_ANCHORS, CELL_M, GRID_N, HALF_M, NATURAL_LANDMARKS, REGION_IDS, SITE_GRADING, STARTER_BASIN, worldToGeo,
  type RegionId,
} from './masterGeography';
import { RIVER_ACCUM_CELLS, getMasterMap, sampleMaster, type MasterMapData, type MasterSample } from './masterMap';
import { outerlandElevation } from '../../map/masterMapGeography';

/**
 * MASTER WORLD RUNTIME AUTHORITY (Phase 2).
 *
 * The single place gameplay asks "what is the ground / water / region / airfield / landmark at world x,z". Everything is derived
 * from masterGeography + masterMap; nothing here duplicates geography. Coordinates are WORLD metres (+Z north, east = -X).
 *
 * Ground elevation model (one function, so render mesh, physics colliders and gameplay queries can never drift apart):
 *   bicubic (Catmull-Rom) resample of the 48 m master grid, blended into The Field's own analytic terrain (exact, not resampled)
 *   inside the Starter Basin core, so the preserved core is verbatim between grid nodes too.
 * No procedural detail is synthesised in Phase 2: that keeps LOD tiles watertight (see masterStreaming.ts) and is a deliberate,
 * documented debt (docs/world/PHASE2_RUNTIME_INTEGRATION.md).
 */

const N = GRID_N;
const KM = 1000;
const clamp = (v: number, a: number, b: number): number => (v < a ? a : v > b ? b : v);
const smooth = (e0: number, e1: number, x: number): number => { const t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };
const MASTER_AIRPORTS = AIRFIELDS.map((definition) => ({ definition }));

/** World metres -> continuous grid coordinates (cell centres at integers). */
const gx = (x: number): number => (-x + HALF_M) / CELL_M - 0.5; // east = -x  =>  E = -x/1000
const gz = (z: number): number => (z + HALF_M) / CELL_M - 0.5;

/** Catmull-Rom weights. */
function cr(t: number): [number, number, number, number] {
  const t2 = t * t, t3 = t2 * t;
  return [-0.5 * t3 + t2 - 0.5 * t, 1.5 * t3 - 2.5 * t2 + 1, -1.5 * t3 + 2 * t2 + 0.5 * t, 0.5 * t3 - 0.5 * t2];
}

/** Bicubic sample of a master float grid at world x/z (edge-clamped). */
export function bicubicWorld(grid: Float32Array, x: number, z: number): number {
  const fx = clamp(gx(x), 0, N - 1.0001), fz = clamp(gz(z), 0, N - 1.0001);
  const i = Math.floor(fx), j = Math.floor(fz), wx = cr(fx - i), wz = cr(fz - j);
  let out = 0;
  for (let b = 0; b < 4; b++) {
    const jj = clamp(j + b - 1, 0, N - 1);
    let row = 0;
    for (let a = 0; a < 4; a++) row += wx[a] * grid[jj * N + clamp(i + a - 1, 0, N - 1)];
    out += wz[b] * row;
  }
  return out;
}

export type WaterKind = 'sea' | 'lake' | 'lagoon' | 'river';
export interface WaterInfo { kind: WaterKind; /** Water surface elevation (m, absolute). */ surfaceM: number; /** Depth above the bed (m). */ depthM: number }

export interface NamedAreaFrame {
  namedAreaId: string;
  macro: RegionId;
  /** World x/z of the region-local origin (0,0). */
  originWorld: readonly [number, number];
  /** local y = master elevation − datumM. */
  datumM: number;
  /** Add to local y for the ISA atmosphere so mission tuning made in local frames is preserved (0 by default). */
  pressureAltitudeBaseM: number;
}

export interface MasterAirfield {
  id: string;
  namedAreaId: string;
  macro: RegionId;
  /** Region-local position (unchanged from src/world/airfields.ts). */
  localPosition: readonly [number, number, number];
  /** World x/z (metres) and absolute elevation (m). */
  worldPosition: readonly [number, number];
  elevationM: number;
  runwayLengthM: number;
  runwayWidthM: number;
  surface: AirfieldDefinition['surface'];
  discoveryState: AirfieldDefinition['discoveryState'];
}

export interface MasterLandmark { id: string; name: string; kind: string; worldPosition: readonly [number, number]; elevationM: number }

export class MasterTerrain {
  readonly map: MasterMapData;
  private readonly frames = new Map<string, NamedAreaFrame>();
  private airfieldsCache: MasterAirfield[] | null = null;
  private airportGradingCache: Array<{ center: readonly [number, number]; radiusM: number }> | null = null;

  constructor(map: MasterMapData = getMasterMap()) {
    this.map = map;
    const [ox, oz] = STARTER_BASIN.worldOffsetM;
    this.frames.set('the_field', { namedAreaId: 'the_field', macro: 'R01_starter_basin', originWorld: [ox, oz], datumM: STARTER_BASIN.elevationOffsetM, pressureAltitudeBaseM: 0 });
    for (const S of NAMED_AREA_ANCHORS) {
      const info = map.sites.find((s) => s.namedAreaId === S.id);
      if (!info) throw new Error(`master map has no graded anchor for ${S.id}`);
      this.frames.set(S.id, {
        namedAreaId: S.id, macro: S.macro, originWorld: [-S.anchorGeoKm[0] * KM, S.anchorGeoKm[1] * KM],
        datumM: info.datumM, pressureAltitudeBaseM: S.pressureAltitudeBaseM,
      });
    }
  }

  /* ---------------- terrain ---------------- */

  /** Ground BED elevation (m): what the terrain mesh draws. */
  elevationAt(x: number, z: number): number {
    if (Math.abs(x) > HALF_M || Math.abs(z) > HALF_M) return outerlandElevation(x, z);
    let base = bicubicWorld(this.map.heightM, x, z);
    const overrides = this.airportsWorld();
    for (const o of overrides) {
      const d = Math.hypot(x - o.center[0], z - o.center[1]) - o.radiusM;
      const graded = bicubicWorld(this.map.heightM, o.center[0], o.center[1]);
      if (d <= 0) { base = graded; break; }
      if (d < 150) { const t = d / 150, w = t * t * (3 - 2 * t); base = graded + (base - graded) * w; break; }
    }
    const [ox, oz] = STARTER_BASIN.worldOffsetM;
    const lx = x - ox, lz = z - oz, cheb = Math.max(Math.abs(lx), Math.abs(lz));
    if (cheb >= 5400) return base;
    const w = 1 - smooth(STARTER_BASIN.coreRadiusM, 5400, cheb);
    return base + w * (fieldElevation(lx, lz) + STARTER_BASIN.elevationOffsetM - base);
  }

  /** Water at this point, or null on dry land. Lakes/lagoons/sea report their surface; rivers are 1 m deep ribbons. */
  waterAt(x: number, z: number): WaterInfo | null {
    const bed = this.elevationAt(x, z);
    if (Math.abs(x) > HALF_M || Math.abs(z) > HALF_M) return bed <= 0 ? { kind: 'sea', surfaceM: 0, depthM: -bed } : null;
    const s = sampleMaster(this.map, x, z);
    if (s.water === 'sea') return { kind: 'sea', surfaceM: 0, depthM: Math.max(0, -bed) };
    if (s.water === 'lagoon') return { kind: 'lagoon', surfaceM: 0.4, depthM: Math.max(0.3, 0.4 - bed) };
    if (s.water === 'lake') {
      const k = this.cellOf(x, z);
      const surface = this.map.hydro.filled[k];
      return { kind: 'lake', surfaceM: surface, depthM: Math.max(0.3, surface - bed) };
    }
    if (s.water === 'river') return { kind: 'river', surfaceM: bed + 1, depthM: 1 };
    return null;
  }

  /** COLLIDABLE ground (m): the bed on land, the water surface over lakes/sea. This is what physics and off-airfield ground
   * contact use, so ditching is measured against the surface the aircraft would actually hit. */
  groundAt(x: number, z: number): number {
    const bed = this.elevationAt(x, z);
    const w = this.waterAt(x, z);
    return w && w.kind !== 'river' ? Math.max(bed, w.surfaceM) : bed;
  }

  slopeDegAt(x: number, z: number, stepM = 8): number {
    const dx = (this.elevationAt(x + stepM, z) - this.elevationAt(x - stepM, z)) / (2 * stepM);
    const dz = (this.elevationAt(x, z + stepM) - this.elevationAt(x, z - stepM)) / (2 * stepM);
    return (Math.atan(Math.hypot(dx, dz)) * 180) / Math.PI;
  }

  sampleGeo(x: number, z: number): MasterSample {
    if (Math.abs(x) <= HALF_M && Math.abs(z) <= HALF_M) return sampleMaster(this.map, x, z);
    const e = -x / 1000, n = z / 1000;
    const region: RegionId = n > 0 ? 'R03_northern_mountains' : n < -19 ? 'R08_southern_archipelago' : e < 0 ? 'R04_western_badlands' : 'R09_eastern_highlands';
    const elevationM = this.elevationAt(x, z);
    const water = elevationM <= 0 ? 'sea' : 'land';
    return { elevationM, region, water, coastDistM: Math.abs(elevationM) < 80 ? 0 : 1000 } as MasterSample;
  }
  regionAt(x: number, z: number): RegionId | null { return this.sampleGeo(x, z).region; }

  /** Natural (off-runway) ground surface derived from region, altitude, slope, water and coast distance. */
  surfaceAt(x: number, z: number): GroundSurfaceId {
    const s = this.sampleGeo(x, z);
    const w = this.waterAt(x, z);
    if (w && w.kind !== 'river') return 'sand';
    const elev = this.elevationAt(x, z), slope = this.slopeDegAt(x, z);
    // desert salt flat: the graded high-desert platform and its blend are a playa
    const desert = this.frames.get('high_desert_test_range');
    if (desert) {
      const [ox, oz] = desert.originWorld;
      if (Math.abs(x - ox) < 400 && z - oz > -300 && z - oz < 1100) return 'salt';
    }
    if (slope > 36 || elev > 1900) return 'rock';
    if (s.coastDistM >= 0 && s.coastDistM < 250 && elev < 8) return 'sand';
    switch (s.region) {
      case 'R01_starter_basin': case 'R02_central_valley': return slope > 22 ? 'rock' : 'grass';
      case 'R03_northern_mountains': return elev > 1300 || slope > 25 ? 'rock' : 'forest_floor';
      case 'R04_western_badlands': return slope > 20 ? 'rock' : 'scrub';
      case 'R05_southern_greenbelt': return 'forest_floor';
      case 'R06_south_coast': return s.coastDistM < 500 ? 'sand' : 'grass';
      case 'R07_eastern_island': return elev > 700 || slope > 22 ? 'rock' : 'forest_floor';
      case 'R08_southern_archipelago': return s.coastDistM < 200 ? 'sand' : 'scrub';
      case 'R09_eastern_highlands': return slope > 25 ? 'rock' : 'scrub';
      default: return 'scrub';
    }
  }

  private cellOf(x: number, z: number): number {
    return clamp(Math.round(gz(z)), 0, N - 1) * N + clamp(Math.round(gx(x)), 0, N - 1);
  }

  /* ---------------- campaign frames ---------------- */

  frame(namedAreaId: string): NamedAreaFrame {
    const f = this.frames.get(namedAreaId);
    if (!f) throw new Error(`unknown named area ${namedAreaId}`);
    return f;
  }
  hasFrame(namedAreaId: string): boolean { return this.frames.has(namedAreaId); }
  localToWorld(namedAreaId: string, x: number, z: number): [number, number] {
    const f = this.frame(namedAreaId);
    return [x + f.originWorld[0], z + f.originWorld[1]];
  }
  worldToLocal(namedAreaId: string, x: number, z: number): [number, number] {
    const f = this.frame(namedAreaId);
    return [x - f.originWorld[0], z - f.originWorld[1]];
  }
  /** Region-local RAW natural relief (local y): master collidable ground minus the region datum. */
  localNaturalElevation(namedAreaId: string): (x: number, z: number) => number {
    const f = this.frame(namedAreaId);
    return (x, z) => this.groundAt(x + f.originWorld[0], z + f.originWorld[1]) - f.datumM;
  }

  /* ---------------- airfields ---------------- */

  airfields(): MasterAirfield[] {
    if (this.airfieldsCache) return this.airfieldsCache;
    this.airfieldsCache = MASTER_AIRPORTS.filter(({ definition: a }) => this.frames.has(a.regionId)).map(({ definition: a }) => {
      const f = this.frame(a.regionId);
      const [wx, wz] = this.localToWorld(a.regionId, a.position[0], a.position[2]);
      return {
        id: a.id, namedAreaId: a.regionId, macro: f.macro, localPosition: a.position, worldPosition: [wx, wz], elevationM: bicubicWorld(this.map.heightM, wx, wz),
        runwayLengthM: a.runwayLengthM, runwayWidthM: a.runwayWidthM, surface: a.surface, discoveryState: a.discoveryState,
      };
    });
    return this.airfieldsCache;
  }
  private airportsWorld() {
    if (this.airportGradingCache) return this.airportGradingCache;
    return (this.airportGradingCache = MASTER_AIRPORTS.filter(({ definition: a }) => this.frames.has(a.regionId)).map(({ definition: a }) => {
      const [x, z] = this.localToWorld(a.regionId, a.position[0], a.position[2]);
      return { center: [x, z] as const, radiusM: a.runwayLengthM / 2 + 40 };
    }));
  }
  airfield(id: string): MasterAirfield | undefined { return this.airfields().find((a) => a.id === id); }

  /** Nearest airfield to a world point (optionally restricted to a set of discovered ids). */
  nearestAirfield(x: number, z: number, opts: { only?: ReadonlySet<string> } = {}): { airfield: MasterAirfield; distanceM: number } | null {
    let best: { airfield: MasterAirfield; distanceM: number } | null = null;
    for (const a of this.airfields()) {
      if (opts.only && !opts.only.has(a.id)) continue;
      const d = Math.hypot(a.worldPosition[0] - x, a.worldPosition[1] - z);
      if (!best || d < best.distanceM) best = { airfield: a, distanceM: d };
    }
    return best;
  }

  /* ---------------- navigation ---------------- */

  landmarks(): MasterLandmark[] {
    const out: MasterLandmark[] = NATURAL_LANDMARKS.map((l) => {
      const x = -l.e * KM, z = l.n * KM;
      return { id: l.id, name: l.name, kind: l.kind, worldPosition: [x, z], elevationM: this.groundAt(x, z) };
    });
    if (this.map.damPointKm) {
      const x = -this.map.damPointKm[0] * KM, z = this.map.damPointKm[1] * KM;
      out.push({ id: 'presa', name: 'Presa del embalse', kind: 'dam', worldPosition: [x, z], elevationM: this.groundAt(x, z) });
    }
    return out;
  }

  /** Terrain elevations along a straight route (for range/clearance planning). */
  terrainProfile(from: readonly [number, number], to: readonly [number, number], samples = 64): { distanceM: number[]; groundM: number[]; maxM: number } {
    const total = Math.hypot(to[0] - from[0], to[1] - from[1]);
    const distanceM: number[] = [], groundM: number[] = [];
    let maxM = -Infinity;
    for (let i = 0; i < samples; i++) {
      const t = i / (samples - 1), x = from[0] + (to[0] - from[0]) * t, z = from[1] + (to[1] - from[1]) * t, g = this.groundAt(x, z);
      distanceM.push(t * total); groundM.push(g); maxM = Math.max(maxM, g);
    }
    return { distanceM, groundM, maxM };
  }
}

/** Deterministic peripheral geography joined at sea-level edges. The authored core remains bit-for-bit unchanged. */
export { outerlandElevation } from '../../map/masterMapGeography';

let cachedTerrain: MasterTerrain | null = null;
/** Process-wide master world (lazy; the generator is deterministic). */
export function getMasterTerrain(): MasterTerrain { return (cachedTerrain ??= new MasterTerrain()); }

/** `TerrainQueryService` over absolute master-world coordinates. Legacy mission/asset data must be translated at its boundary. */
export function createMasterWorldTerrain(region: RegionDefinition, world: MasterTerrain = getMasterTerrain()): TerrainQueryService {
  const natural = (x: number, z: number): number => world.elevationAt(x, z);
  const base = createTerrainQueryService(region, { natural, legacyWater: false, includeAirportGrading: false });
  const surface = (x: number, z: number): GroundSurfaceId => {
    const nearest = world.nearestAirfield(x, z);
    return nearest && nearest.distanceM < nearest.airfield.runwayLengthM / 2 + 40 ? nearest.airfield.surface : world.surfaceAt(x, z);
  };
  const waterDepth = (x: number, z: number): number => {
    const w = world.waterAt(x, z);
    return Math.max(base.getWaterDepth(x, z), w && w.kind !== 'river' ? w.depthM : 0);
  };
  return {
    ...base,
    getSurfaceId: surface,
    getWaterDepth: waterDepth,
    isOnGradedRunway: (x: number, z: number) => {
      const nearest = world.nearestAirfield(x, z);
      return !!nearest && nearest.distanceM < nearest.airfield.runwayLengthM / 2 + 40;
    },
    sample(x: number, z: number): TerrainSample {
      const s = base.sample(x, z);
      const surfaceId = surface(x, z), waterDepthM = waterDepth(x, z);
      const flatness = Math.max(0, 1 - s.slopeDeg / 45);
      return { ...s, surfaceId, waterDepthM, emergencyLandingSuitability: waterDepthM > 0 ? 0 : Math.max(0, Math.min(1, flatness * (1 - GROUND_SURFACES[surfaceId].bumpiness * 0.5))) };
    },
  };
}

/** Region-local compatibility for old mission tooling; active gameplay uses createMasterWorldTerrain. */
export function createMasterRegionTerrain(region: RegionDefinition, world: MasterTerrain = getMasterTerrain()): TerrainQueryService {
  return createTerrainQueryService(region, { natural: world.localNaturalElevation(region.id), legacyWater: false });
}

export { REGION_IDS, RIVER_ACCUM_CELLS, SITE_GRADING, worldToGeo };
