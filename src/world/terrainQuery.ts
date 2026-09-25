import type { RegionDefinition } from '../core/types';
import { buildAirportOverrides, findAirportOverrideAt } from './airfieldTerrain';
import { fieldElevation } from './fieldGeography';
import { canyonElevation } from './canyonGeography';
import { computeBiomeWeights, type BiomeWeights } from './biomeWeights';
import { GROUND_SURFACES, type GroundSurfaceId } from './surfaces';
import { buildWaterBodies, findWaterBodyAt, REGION_SEA_LEVEL_M, riverDepthAt, type WaterBody } from './waterBodies';

/**
 * Single source of truth for ground elevation.
 *
 * Historically `src/render/WorldEnvironment.ts` generated the visual terrain mesh with its
 * own inline height formula while `src/ui/screens/FlightScreen.tsx` set up a perfectly flat
 * physics ground collider. That meant a hill the player could SEE had no matching collision
 * geometry underneath it. This module extracts the exact elevation math that
 * `WorldEnvironment` used to draw its terrain so both the renderer and the physics collider
 * setup sample the same function and can never drift apart.
 */

/** A full ground sample at one world x/z (world spec section 166 `TerrainSample`). Bundles
 * every per-point terrain fact a future consumer (route analyzer, mission difficulty,
 * emergency-landing UI) needs, so callers don't reassemble it from four separate calls. */
export interface TerrainSample {
  elevationM: number;
  slopeDeg: number;
  surfaceId: GroundSurfaceId;
  /** 0 = dry ground, >0 = underwater (world spec phase WLD-03: `src/world/waterBodies.ts`). */
  waterDepthM: number;
  dominantBiomeId: string;
  /** Biome blend weights at this point (world spec section 36-38 WLD-04), summing to ~1. */
  biomeWeights: BiomeWeights;
  /** 0 (unsurvivable) .. 1 (excellent) — how landable this point looks for an off-field
   * emergency landing, derived from slope and surface roughness (world spec section 77). */
  emergencyLandingSuitability: number;
}

export interface TerrainQueryService {
  /** World-space ground elevation (metres) at the given world x/z. */
  getElevation(x: number, z: number): number;
  /** Local terrain slope in degrees, derived from a small finite-difference sample. */
  getSlopeDeg(x: number, z: number): number;
  /** Ground surface id at this point (world spec section 65/169 surface registry). */
  getSurfaceId(x: number, z: number): GroundSurfaceId;
  /** Water depth in metres at this point; 0 on dry land. */
  getWaterDepth(x: number, z: number): number;
  /** True inside any airfield's graded pad (world spec section 72). Vegetation/prop
   * scatter must exclude these points (world spec section 227 QA: no tree on runway). */
  isOnGradedRunway(x: number, z: number): boolean;
  /** Biome blend weights at this point (world spec section 36-38 WLD-04). */
  getBiomeWeights(x: number, z: number): BiomeWeights;
  /** Every terrain fact at one point, bundled (world spec section 166). */
  sample(x: number, z: number): TerrainSample;
}

/** Region terrain type -> off-runway ground surface + dominant biome id (world spec section
 * 36/38 biome catalog, trimmed to one dominant biome per region — blending across multiple
 * biome weights is WLD-04, not needed until land-use/vegetation placement consumes it). */
const TERRAIN_SURFACE_AND_BIOME: Record<RegionDefinition['environment']['terrain'], { surfaceId: GroundSurfaceId; biomeId: string }> = {
  meadow: { surfaceId: 'grass', biomeId: 'temperate_grassland' },
  quarry: { surfaceId: 'rock', biomeId: 'rocky_mountain' },
  canyon: { surfaceId: 'rock', biomeId: 'badlands' },
  forest: { surfaceId: 'forest_floor', biomeId: 'temperate_woodland' },
  coast: { surfaceId: 'sand', biomeId: 'coastal_dune' },
  industrial: { surfaceId: 'tarmac', biomeId: 'urban_periurban' },
  desert: { surfaceId: 'sand', biomeId: 'xeric_plain' },
  range: { surfaceId: 'scrub', biomeId: 'highland_scrub' },
};

/** Width (metres) of the blend from a graded pad back into natural terrain. */
const AIRFIELD_SHOULDER_M = 150;

/** Half-width of the finite-difference step (metres) used to estimate slope. */
const SLOPE_SAMPLE_STEP_M = 1;

/** Moisture falloff radius (metres) beyond a water body's edge: a proxy, not real
 * hydrology, so a few hundred metres past the shoreline feels right next to water body
 * radii of ~90-130m (see waterBodies.ts seeds). */
const MOISTURE_FALLOFF_M = 300;
/** Baseline moisture for regions with no water body at all, so dry regions aren't 0. */
const BASELINE_MOISTURE01 = 0.15;
/** Disturbance falloff radius (metres) beyond a graded runway pad's edge. */
const DISTURBANCE_FALLOFF_M = 150;

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}

/**
 * Per-terrain-type elevation profiles (pure functions of local x/y, no RNG). Each region's
 * `environment.terrain` gets its own distinct relief shape instead of one shared sine/cosine
 * blend, so meadow/quarry/canyon/etc. actually feel different underfoot instead of only
 * differing by an amplitude scalar. Exported for direct unit testing of each profile's shape.
 *
 * `WorldEnvironment`'s plane is authored in local plane space (x, y) and then rotated -90deg
 * about X to become the world XZ ground plane, which maps local y -> world -z. Working
 * directly in world space here, that means local x = worldX and local y = -worldZ.
 */
export const NATURAL_ELEVATION_PROFILES: Record<RegionDefinition['environment']['terrain'], (x: number, y: number) => number> = {
  // Gentle agricultural basin + low rolling hills: small amplitude, bounded radial dip.
  // The Field: authored geography (mountains, pass, river valley, lake basin) — see fieldGeography.ts.
  meadow: (x, y) => fieldElevation(x, -y),
  // Terraced quarry benches (repeating stepped plateaus) layered over rocky base hills, so
  // there is always at least one hard bank/step outside the graded pad.
  quarry: (x, y) => {
    const base = Math.sin(x * 0.006) * 10 + Math.cos(y * 0.007) * 9;
    const benchAxis = x * 0.6 + y * 0.4;
    const benchCyclePos = ((benchAxis % 220) + 220) % 220;
    const bench = Math.floor(benchCyclePos / 55) * 9;
    return base + bench;
  },
  // Red Canyon: authored geography (layered mesas, sheer dry wash, side canyons) — see
  // canyonGeography.ts. Same wiring as `meadow`/fieldElevation above.
  canyon: (x, y) => canyonElevation(x, -y),
  // Glacial rolling hills (higher frequency/amplitude than meadow) with lake-basin lows.
  forest: (x, y) => Math.sin(x * 0.006) * 14 + Math.cos(y * 0.007) * 12 + Math.sin((x - y) * 0.003) * 8,
  // Coastal plain that drops via a smooth bluff/cliff into the sea as world +z advances
  // (local y becomes increasingly negative) — a directional gradient, not symmetric noise.
  coast: (x, y) => {
    const plain = Math.sin(x * 0.004) * 5 + Math.cos(y * 0.005) * 4;
    const distToSea = -y - 650;
    const cliffDrop = -38 * (0.5 + 0.5 * Math.tanh(distToSea / 120));
    return plain + cliffDrop;
  },
  // Flat industrial platform with a shallow river-valley dip; the flattest profile.
  industrial: (x, y) => {
    const plain = Math.sin(x * 0.003) * 3 + Math.cos(y * 0.0035) * 3;
    const riverValley = -8 * Math.exp(-((x - 50) ** 2) / (2 * 300 * 300));
    return plain + riverValley;
  },
  // Broad, wide-wavelength dunes: low spatial frequency so nearby points barely change.
  desert: (x, y) => Math.sin(x * 0.0009) * 16 + Math.cos(y * 0.0011) * 13 + Math.sin((x + y) * 0.0006) * 8,
  // Access valley/pass cut through a tall mountain range: tallest, roughest profile.
  range: (x, y) => 130 * Math.tanh(Math.abs(x) / 180) + Math.sin(y * 0.003) * 20 - 15,
};

/**
 * Builds the natural (ungraded) elevation function for a region's terrain type. Runway
 * grading is layered on top by `createTerrainQueryService`, not here — this is the raw
 * terrain a runway gets carved flat out of.
 */
function createNaturalElevationFn(region: RegionDefinition): (x: number, z: number) => number {
  const profile = NATURAL_ELEVATION_PROFILES[region.environment.terrain];
  return (worldX: number, worldZ: number): number => profile(worldX, -worldZ);
}

/** Optional overrides for `createTerrainQueryService`. */
export interface TerrainQueryOptions {
  /** Replaces the region's analytic relief with another RAW (ungraded) elevation function in the same region-local frame
   * (used by the master-world adapter: master elevation translated into the region frame). Graded pads, water bodies,
   * surfaces and biomes are layered on top exactly as before. */
  natural?: (x: number, z: number) => number;
  /** Replaces the region's authored water. The master-world adapter passes `false`: master relief carries its own
   * sea/lakes/rivers, and the legacy seeds (authored against the analytic relief) would land on dry slopes there. */
  legacyWater?: boolean;
  /** Disable region-local airport pads when the caller supplies a canonical world terrain. */
  includeAirportGrading?: boolean;
}

/** Creates the shared terrain query service for a given region. Deterministic, no RNG. */
export function createTerrainQueryService(region: RegionDefinition, options: TerrainQueryOptions = {}): TerrainQueryService {
  const natural = options.natural ?? createNaturalElevationFn(region);
  const { surfaceId, biomeId } = TERRAIN_SURFACE_AND_BIOME[region.environment.terrain];

  // WLD-02 airport terrain override (world spec section 72): every airfield in this region
  // gets a flat, graded pad instead of sitting on raw noise. The graded elevation is the
  // natural terrain height sampled once at the runway center, so the pad blends into its
  // surroundings instead of snapping to an arbitrary fixed height like sea level.
  const overrides = options.includeAirportGrading === false ? [] : buildAirportOverrides(region.id);
  const gradedElevationByAirfieldId = new Map(
    overrides.map((o) => [o.airfieldId, natural(o.center[0], o.center[1])]),
  );

  // WLD-03 hydrology (world spec section 19-24/217/249): water bodies sample the natural
  // terrain once per body, the same "flat footprint over rough terrain" trick as airfield
  // grading above, so a lake surface never has multiple elevations (spec section 222 QA).
  // Water bodies are never placed inside an airfield's graded radius (see waterBodies.ts
  // QA test), so override precedence between the two doesn't matter in practice.
  const legacyWater = options.legacyWater ?? true;
  const waterBodies: WaterBody[] = legacyWater ? buildWaterBodies(region.id, natural) : [];
  const seaLevelM = legacyWater ? REGION_SEA_LEVEL_M[region.id] ?? -Infinity : -Infinity;
  /** Standing water (lake or sea) surface over a point whose natural ground is `bed`, or null on land. */
  const standingWaterSurface = (x: number, z: number, bed: number): number | null => {
    const body = findWaterBodyAt(waterBodies, x, z);
    if (body && !(body.shoreFromBed && bed >= body.surfaceElevationM)) return body.surfaceElevationM;
    return bed < seaLevelM ? seaLevelM : null;
  };
  const waterDepthAt = (x: number, z: number): number => {
    const bed = natural(x, z), surface = standingWaterSurface(x, z, bed);
    if (surface !== null) return Math.max(0, surface - bed);
    return legacyWater ? riverDepthAt(region.id, x, z) : 0;
  };

  // getElevation returns the WATER SURFACE height inside a water body's footprint, not the
  // lakebed: an aircraft's altitude-above-ground (ditching/near-ground logic) needs to be
  // measured against the surface it would actually hit. The renderer's terrain mesh and
  // FlightScreen's spawn-ground sample both consume this same function, and neither breaks:
  // the visual mesh simply goes flat over the lake (the desired look), and no airfield sits
  // inside a water footprint.
  const elevation = (x: number, z: number): number => {
    const override = findAirportOverrideAt(overrides, x, z);
    if (override) return gradedElevationByAirfieldId.get(override.airfieldId)!;
    const bed = natural(x, z);
    const ground = standingWaterSurface(x, z, bed) ?? bed;
    // Shoulder: ease from the graded pad into the natural terrain instead of a hard step.
    for (const o of overrides) {
      const d = Math.hypot(x - o.center[0], z - o.center[1]) - o.radiusM;
      if (d < AIRFIELD_SHOULDER_M) {
        const t = d / AIRFIELD_SHOULDER_M;
        const graded = gradedElevationByAirfieldId.get(o.airfieldId)!;
        return graded + (ground - graded) * (t * t * (3 - 2 * t));
      }
    }
    return ground;
  };

  // Shared finite-difference gradient so slope and aspect reuse the same 4 extra elevation
  // samples instead of computing them twice per query.
  const getGradient = (x: number, z: number): { dhdx: number; dhdz: number } => {
    const step = SLOPE_SAMPLE_STEP_M;
    const hL = elevation(x - step, z);
    const hR = elevation(x + step, z);
    const hD = elevation(x, z - step);
    const hU = elevation(x, z + step);
    return { dhdx: (hR - hL) / (2 * step), dhdz: (hU - hD) / (2 * step) };
  };

  const getSlopeDeg = (x: number, z: number): number => {
    const { dhdx, dhdz } = getGradient(x, z);
    const gradientMagnitude = Math.hypot(dhdx, dhdz);
    return (Math.atan(gradientMagnitude) * 180) / Math.PI;
  };

  // Standard aspect formula: compass bearing the slope faces downhill toward, 0 = north.
  const getAspectDeg = (x: number, z: number): number => {
    const { dhdx, dhdz } = getGradient(x, z);
    return ((Math.atan2(dhdx, dhdz) * 180) / Math.PI + 360) % 360;
  };

  const getSurfaceId = (x: number, z: number): GroundSurfaceId => {
    const override = findAirportOverrideAt(overrides, x, z);
    return override ? override.surface : surfaceId;
  };

  // Moisture proxy: distance to the nearest water body's edge, falling off over
  // MOISTURE_FALLOFF_M. Regions with no water at all get a small constant baseline instead
  // of always reading bone dry.
  const getMoisture01 = (x: number, z: number): number => {
    if (waterBodies.length === 0) return BASELINE_MOISTURE01;
    let nearestEdgeDist = Infinity;
    for (const body of waterBodies) {
      const edgeDist = Math.hypot(x - body.center[0], z - body.center[1]) - body.radiusM;
      if (edgeDist < nearestEdgeDist) nearestEdgeDist = edgeDist;
    }
    return Math.max(BASELINE_MOISTURE01, clamp01(1 - nearestEdgeDist / MOISTURE_FALLOFF_M));
  };

  // Disturbance proxy: distance to the nearest graded-runway pad's edge, falling off over
  // DISTURBANCE_FALLOFF_M. Feeds the surrounding terrain's blend; a point already inside a
  // graded pad is handled separately by getSurfaceId/isOnGradedRunway.
  const getDisturbance01 = (x: number, z: number): number => {
    if (overrides.length === 0) return 0;
    let nearestEdgeDist = Infinity;
    for (const override of overrides) {
      const edgeDist = Math.hypot(x - override.center[0], z - override.center[1]) - override.radiusM;
      if (edgeDist < nearestEdgeDist) nearestEdgeDist = edgeDist;
    }
    return clamp01(1 - nearestEdgeDist / DISTURBANCE_FALLOFF_M);
  };

  const getBiomeWeights = (x: number, z: number): BiomeWeights =>
    computeBiomeWeights({
      regionBiomeId: biomeId,
      elevationM: elevation(x, z),
      slopeDeg: getSlopeDeg(x, z),
      aspectDeg: getAspectDeg(x, z),
      moisture01: getMoisture01(x, z),
      surfaceId: getSurfaceId(x, z),
      disturbance01: getDisturbance01(x, z),
    });

  return {
    getElevation: elevation,
    getSlopeDeg,
    getSurfaceId,
    getWaterDepth: waterDepthAt,
    isOnGradedRunway: (x: number, z: number) => findAirportOverrideAt(overrides, x, z) !== undefined,
    getBiomeWeights,
    sample(x: number, z: number): TerrainSample {
      const slopeDeg = getSlopeDeg(x, z);
      const pointSurfaceId = getSurfaceId(x, z);
      const waterDepthM = waterDepthAt(x, z);
      const biomeWeights = getBiomeWeights(x, z);
      const dominantBiomeId = Object.entries(biomeWeights).sort((a, b) => b[1] - a[1])[0][0];
      // Flatness falls off to 0 by 45 degrees slope; combined with surface roughness (a
      // rock field is a worse forced-landing site than grass at the same slope). Any
      // standing water makes an emergency landing effectively unsurvivable here.
      const flatness = Math.max(0, 1 - slopeDeg / 45);
      const surface = GROUND_SURFACES[pointSurfaceId];
      const emergencyLandingSuitability =
        waterDepthM > 0 ? 0 : Math.max(0, Math.min(1, flatness * (1 - surface.bumpiness * 0.5)));
      return {
        elevationM: elevation(x, z),
        slopeDeg,
        surfaceId: pointSurfaceId,
        waterDepthM,
        dominantBiomeId,
        biomeWeights,
        emergencyLandingSuitability,
      };
    },
  };
}
