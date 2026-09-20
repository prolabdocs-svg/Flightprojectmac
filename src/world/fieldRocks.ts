import { createSeededRandom } from '../core/seededRandom';
import { getRegionAirfields } from './airfields';
import { SEA_LEVEL_M } from './fieldGeography';
import type { TerrainQueryService } from './terrainQuery';

export interface RockPlacement { x: number; z: number; groundY: number; scale: number; rotationY: number }

const CELL_M = 150;
const MIN_SLOPE_DEG = 24;
const MAX_SLOPE_DEG = 55;
const HIGH_ELEVATION_M = 320;
const AIRFIELD_CLEAR_M = 450;
const MAX_ROCKS = 1400;

/** Deterministic boulder placement for The Field: one jittered candidate per 150 m cell, kept
 * on steep-ish (24-55 deg) or high ground with a probability that rises with steepness and
 * altitude. Never on/near the strips, in water, or on near-vertical faces. Low density: the
 * terrain shape stays the visual feature. */
export function scatterFieldRocks(terrain: TerrainQueryService, halfExtentM = 7200): RockPlacement[] {
  const rng = createSeededRandom('field-rocks', 'the_field');
  const strips = getRegionAirfields('the_field');
  const out: RockPlacement[] = [];
  for (let cx = -halfExtentM; cx < halfExtentM && out.length < MAX_ROCKS; cx += CELL_M) {
    for (let cz = -halfExtentM; cz < halfExtentM && out.length < MAX_ROCKS; cz += CELL_M) {
      const x = cx + rng.next() * CELL_M, z = cz + rng.next() * CELL_M;
      const roll = rng.next(), scale = 2 + rng.next() * 3.5, rotationY = rng.next() * Math.PI * 2;
      const groundY = terrain.getElevation(x, z);
      if (groundY < SEA_LEVEL_M + 6 || terrain.getWaterDepth(x, z) > 0 || terrain.isOnGradedRunway(x, z)) continue;
      if (strips.some((a) => Math.hypot(x - a.position[0], z - a.position[2]) < AIRFIELD_CLEAR_M)) continue;
      const slope = terrain.getSlopeDeg(x, z);
      if (slope > MAX_SLOPE_DEG) continue;
      const steep = Math.min(1, Math.max(0, (slope - MIN_SLOPE_DEG) / 16));
      const high = Math.min(1, Math.max(0, (groundY - HIGH_ELEVATION_M) / 150));
      if (roll < Math.max(steep, high) * 0.35) out.push({ x, z, groundY, scale, rotationY });
    }
  }
  return out;
}
