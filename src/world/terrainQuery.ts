import type { RegionDefinition } from '../core/types';
import { buildAirportOverrides, findAirportOverrideAt } from './airfieldTerrain';
import { GROUND_SURFACES, type GroundSurfaceId } from './surfaces';
import { buildWaterBodies, findWaterBodyAt } from './waterBodies';

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

/** Half-width of the finite-difference step (metres) used to estimate slope. */
const SLOPE_SAMPLE_STEP_M = 1;

/**
 * Builds the natural (ungraded) elevation function: low-frequency sine/cosine hills scaled
 * by a per-terrain "roughness" factor (quarries are rockier than open meadows). Runway
 * grading is layered on top by `createTerrainQueryService`, not here — this is the raw
 * terrain a runway gets carved flat out of.
 *
 * `WorldEnvironment`'s plane is authored in local plane space (x, y) and then rotated -90deg
 * about X to become the world XZ ground plane, which maps local y -> world -z. Working
 * directly in world space here, that means local x = worldX and local y = -worldZ.
 */
function createNaturalElevationFn(region: RegionDefinition): (x: number, z: number) => number {
  const roughness = region.environment.terrain === 'quarry' ? 1.9 : 0.75;
  return (worldX: number, worldZ: number): number => {
    const localX = worldX;
    const localY = -worldZ;
    return (
      (Math.sin(localX * 0.004) * 18 + Math.cos(localY * 0.005) * 14 + Math.sin((localX + localY) * 0.008) * 9) *
      roughness
    );
  };
}

/** Creates the shared terrain query service for a given region. Deterministic, no RNG. */
export function createTerrainQueryService(region: RegionDefinition): TerrainQueryService {
  const natural = createNaturalElevationFn(region);
  const { surfaceId, biomeId } = TERRAIN_SURFACE_AND_BIOME[region.environment.terrain];

  // WLD-02 airport terrain override (world spec section 72): every airfield in this region
  // gets a flat, graded pad instead of sitting on raw noise. The graded elevation is the
  // natural terrain height sampled once at the runway center, so the pad blends into its
  // surroundings instead of snapping to an arbitrary fixed height like sea level.
  const overrides = buildAirportOverrides(region.id);
  const gradedElevationByAirfieldId = new Map(
    overrides.map((o) => [o.airfieldId, natural(o.center[0], o.center[1])]),
  );

  // WLD-03 hydrology (world spec section 19-24/217/249): water bodies sample the natural
  // terrain once per body, the same "flat footprint over rough terrain" trick as airfield
  // grading above, so a lake surface never has multiple elevations (spec section 222 QA).
  // Water bodies are never placed inside an airfield's graded radius (see waterBodies.ts
  // QA test), so override precedence between the two doesn't matter in practice.
  const waterBodies = buildWaterBodies(region.id, natural);

  // getElevation returns the WATER SURFACE height inside a water body's footprint, not the
  // lakebed: an aircraft's altitude-above-ground (ditching/near-ground logic) needs to be
  // measured against the surface it would actually hit. The renderer's terrain mesh and
  // FlightScreen's spawn-ground sample both consume this same function, and neither breaks:
  // the visual mesh simply goes flat over the lake (the desired look), and no airfield sits
  // inside a water footprint.
  const elevation = (x: number, z: number): number => {
    const override = findAirportOverrideAt(overrides, x, z);
    if (override) return gradedElevationByAirfieldId.get(override.airfieldId)!;
    const water = findWaterBodyAt(waterBodies, x, z);
    if (water) return water.surfaceElevationM;
    return natural(x, z);
  };

  const getSlopeDeg = (x: number, z: number): number => {
    const step = SLOPE_SAMPLE_STEP_M;
    const hL = elevation(x - step, z);
    const hR = elevation(x + step, z);
    const hD = elevation(x, z - step);
    const hU = elevation(x, z + step);
    const dhdx = (hR - hL) / (2 * step);
    const dhdz = (hU - hD) / (2 * step);
    const gradientMagnitude = Math.hypot(dhdx, dhdz);
    return (Math.atan(gradientMagnitude) * 180) / Math.PI;
  };

  const getSurfaceId = (x: number, z: number): GroundSurfaceId => {
    const override = findAirportOverrideAt(overrides, x, z);
    return override ? override.surface : surfaceId;
  };

  return {
    getElevation: elevation,
    getSlopeDeg,
    getSurfaceId,
    getWaterDepth(x: number, z: number): number {
      const water = findWaterBodyAt(waterBodies, x, z);
      if (!water) return 0;
      return Math.max(0, water.surfaceElevationM - natural(x, z));
    },
    isOnGradedRunway: (x: number, z: number) => findAirportOverrideAt(overrides, x, z) !== undefined,
    sample(x: number, z: number): TerrainSample {
      const slopeDeg = getSlopeDeg(x, z);
      const pointSurfaceId = getSurfaceId(x, z);
      const water = findWaterBodyAt(waterBodies, x, z);
      const waterDepthM = water ? Math.max(0, water.surfaceElevationM - natural(x, z)) : 0;
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
        dominantBiomeId: biomeId,
        emergencyLandingSuitability,
      };
    },
  };
}
