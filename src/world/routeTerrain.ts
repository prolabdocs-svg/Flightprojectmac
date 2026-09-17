import { getAirfield } from './airfields';
import { getRegion } from '../content/regions';
import type { RouteEdge } from './routePlanner';
import { createTerrainQueryService, type TerrainQueryService } from './terrainQuery';

/**
 * WLD-08 route terrain analysis (spec §254). Scope: the corridor sampler only works within
 * a single region's local coordinate space — each region streams its own local space
 * (airfields.ts), so a straight-line corridor between two airfields is only geometrically
 * meaningful when both sit in the same region (today: field_home <-> field_north_strip).
 * Cross-region edges fall back to averaging each endpoint's own single-point terrain sample,
 * which still gives a real (if coarser) preflight risk signal without inventing shared
 * geometry that doesn't exist (spec §266 non-goals).
 */

export interface CorridorMetrics {
  /** Total climb (sum of positive elevation deltas) along the sampled corridor, metres. */
  climbM: number;
  /** Fraction of samples sitting over water (0..1). */
  waterFraction: number;
  /** Mean emergency-landing suitability across the corridor (0 unsurvivable .. 1 excellent). */
  emergencyLandingMean: number;
}

const CORRIDOR_STEP_M = 25;

/** Samples straight-line ground truth from `from` to `to` in one region's terrain and
 * reduces it to the preflight metrics a route needs. Mirrors the walk-in-steps approach
 * landUse.ts already uses for road/water crossings, at corridor rather than road scale. */
export function sampleCorridor(
  terrain: TerrainQueryService,
  from: [number, number],
  to: [number, number],
  stepM = CORRIDOR_STEP_M,
): CorridorMetrics {
  const lengthM = Math.hypot(to[0] - from[0], to[1] - from[1]);
  const steps = Math.max(1, Math.ceil(lengthM / stepM));

  let climbM = 0;
  let wetCount = 0;
  let suitabilitySum = 0;
  let previousElevationM: number | undefined;

  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const x = from[0] + (to[0] - from[0]) * t;
    const z = from[1] + (to[1] - from[1]) * t;
    const sample = terrain.sample(x, z);

    if (previousElevationM !== undefined) climbM += Math.max(0, sample.elevationM - previousElevationM);
    previousElevationM = sample.elevationM;
    if (sample.waterDepthM > 0) wetCount++;
    suitabilitySum += sample.emergencyLandingSuitability;
  }

  const sampleCount = steps + 1;
  return {
    climbM,
    waterFraction: wetCount / sampleCount,
    emergencyLandingMean: suitabilitySum / sampleCount,
  };
}

/** 0 (benign) .. 1 (brutal) terrain penalty derived from corridor metrics, on the same scale
 * as RouteEdge.difficulty. Weights are a simple, tunable blend — not a physics model: climb
 * cost saturates around a 150m rise, water crossing is a flat risk add, and poor emergency
 * landing options raise the floor. */
export function deriveTerrainPenalty(metrics: CorridorMetrics): number {
  const climbPenalty = Math.min(1, metrics.climbM / 150);
  const waterPenalty = metrics.waterFraction;
  const emergencyPenalty = 1 - metrics.emergencyLandingMean;
  return Math.min(1, climbPenalty * 0.4 + waterPenalty * 0.3 + emergencyPenalty * 0.3);
}

/** Preflight terrain analysis for one route edge (world spec §254 DoD: preflight terrain
 * metrics available). Same-region edges get a real corridor sample; cross-region edges
 * average each endpoint's own local sample (see module comment). */
export function analyzeRouteEdgeTerrain(edge: RouteEdge): { metrics: CorridorMetrics; terrainPenalty: number } {
  const from = getAirfield(edge.fromId);
  const to = getAirfield(edge.toId);
  if (!from || !to) return { metrics: { climbM: 0, waterFraction: 0, emergencyLandingMean: 1 }, terrainPenalty: 0 };

  if (from.regionId === to.regionId) {
    const terrain = createTerrainQueryService(getRegion(from.regionId));
    const metrics = sampleCorridor(terrain, [from.position[0], from.position[2]], [to.position[0], to.position[2]]);
    return { metrics, terrainPenalty: deriveTerrainPenalty(metrics) };
  }

  const fromSample = createTerrainQueryService(getRegion(from.regionId)).sample(from.position[0], from.position[2]);
  const toSample = createTerrainQueryService(getRegion(to.regionId)).sample(to.position[0], to.position[2]);
  const metrics: CorridorMetrics = {
    climbM: Math.abs(toSample.elevationM - fromSample.elevationM),
    waterFraction: (Number(fromSample.waterDepthM > 0) + Number(toSample.waterDepthM > 0)) / 2,
    emergencyLandingMean: (fromSample.emergencyLandingSuitability + toSample.emergencyLandingSuitability) / 2,
  };
  return { metrics, terrainPenalty: deriveTerrainPenalty(metrics) };
}
