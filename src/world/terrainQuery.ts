import type { RegionDefinition } from '../core/types';

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
export interface TerrainQueryService {
  /** World-space ground elevation (metres) at the given world x/z. */
  getElevation(x: number, z: number): number;
  /** Local terrain slope in degrees, derived from a small finite-difference sample. */
  getSlopeDeg(x: number, z: number): number;
}

/** Half-width of the finite-difference step (metres) used to estimate slope. */
const SLOPE_SAMPLE_STEP_M = 1;

/**
 * Builds the elevation function. This mirrors, term for term, the height field that
 * `WorldEnvironment.addTerrain()` used to bake into its `PlaneGeometry` before this change:
 * a flat pad near the runway (radius < 190m) surrounded by low-frequency sine/cosine hills,
 * scaled by a per-terrain "roughness" factor (quarries are rockier than open meadows).
 *
 * `WorldEnvironment`'s plane was authored in local plane space (x, y) and then rotated -90deg
 * about X to become the world XZ ground plane, which maps local y -> world -z. Working
 * directly in world space here, that means local x = worldX and local y = -worldZ.
 */
function createElevationFn(region: RegionDefinition): (x: number, z: number) => number {
  const roughness = region.environment.terrain === 'quarry' ? 1.9 : 0.75;
  return (worldX: number, worldZ: number): number => {
    const localX = worldX;
    const localY = -worldZ;
    const radius = Math.hypot(localX, localY - 150);
    if (radius < 190) return 0;
    return (
      (Math.sin(localX * 0.004) * 18 + Math.cos(localY * 0.005) * 14 + Math.sin((localX + localY) * 0.008) * 9) *
      roughness
    );
  };
}

/** Creates the shared terrain query service for a given region. Deterministic, no RNG. */
export function createTerrainQueryService(region: RegionDefinition): TerrainQueryService {
  const elevation = createElevationFn(region);

  return {
    getElevation: elevation,
    getSlopeDeg(x: number, z: number): number {
      const step = SLOPE_SAMPLE_STEP_M;
      const hL = elevation(x - step, z);
      const hR = elevation(x + step, z);
      const hD = elevation(x, z - step);
      const hU = elevation(x, z + step);
      const dhdx = (hR - hL) / (2 * step);
      const dhdz = (hU - hD) / (2 * step);
      const gradientMagnitude = Math.hypot(dhdx, dhdz);
      return (Math.atan(gradientMagnitude) * 180) / Math.PI;
    },
  };
}
