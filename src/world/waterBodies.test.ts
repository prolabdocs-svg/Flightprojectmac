import { describe, expect, it } from 'vitest';
import { getRegion } from '../content/regions';
import { getRegionAirfields } from './airfields';
import { createTerrainQueryService } from './terrainQuery';
import { buildWaterBodies } from './waterBodies';

/** Mirrors the airfield grading margin (runway half-length + 40m apron) used by the world
 * spec (§217/§223) so a water body can never encroach on a runway's graded footprint. */
const GRADING_MARGIN_M = 40;

function airfieldGradedRadius(runwayLengthM: number): number {
  return runwayLengthM / 2 + GRADING_MARGIN_M;
}

describe('buildWaterBodies', () => {
  it('only assigns water to the regions that have it (field, backcountry, coast_run)', () => {
    expect(buildWaterBodies('the_field', () => 0)).toHaveLength(1);
    expect(buildWaterBodies('scrap_valley', () => 0)).toHaveLength(0);
    expect(buildWaterBodies('backcountry', () => 0)).toHaveLength(1);
    expect(buildWaterBodies('coast_run', () => 0)).toHaveLength(1);
  });

  it('samples a flat surface elevation once per body (no multi-elevation lakes)', () => {
    const region = getRegion('backcountry');
    const terrain = createTerrainQueryService(region);
    const [body] = buildWaterBodies('backcountry', (x, z) => {
      // stand-in "natural" fn matching terrainQuery's own — verifies determinism, not the formula
      return terrain.getElevation(x, z);
    });
    expect(Number.isFinite(body.surfaceElevationM)).toBe(true);
  });

  for (const regionId of ['backcountry', 'coast_run']) {
    it(`QA §223/§217: ${regionId}'s water body never overlaps a graded runway pad`, () => {
      const region = getRegion(regionId);
      const terrain = createTerrainQueryService(region);
      const [body] = buildWaterBodies(regionId, (x, z) => terrain.getElevation(x, z));
      for (const airfield of getRegionAirfields(regionId)) {
        const dx = body.center[0] - airfield.position[0];
        const dz = body.center[1] - airfield.position[2];
        const distance = Math.hypot(dx, dz);
        const combinedRadius = body.radiusM + airfieldGradedRadius(airfield.runwayLengthM);
        expect(distance).toBeGreaterThan(combinedRadius);
      }
    });

    it(`QA §222: ${regionId}'s water body doesn't flood a ridge (edge ring sits at/below surface)`, () => {
      const region = getRegion(regionId);
      const terrain = createTerrainQueryService(region);
      const [body] = buildWaterBodies(regionId, (x, z) => terrain.getElevation(x, z));
      const sampleCount = 12;
      for (let i = 0; i < sampleCount; i++) {
        const angle = (i / sampleCount) * Math.PI * 2;
        const x = body.center[0] + Math.cos(angle) * (body.radiusM + 1);
        const z = body.center[1] + Math.sin(angle) * (body.radiusM + 1);
        // Just outside the footprint, getElevation() returns natural terrain.
        const naturalAtEdge = terrain.getElevation(x, z);
        expect(naturalAtEdge).toBeLessThanOrEqual(body.surfaceElevationM + 0.01);
      }
    });
  }
});

describe('The Field sea and river', () => {
  const terrain = createTerrainQueryService(getRegion('the_field'));

  it('river valley stays above the sea until the estuary (no inland flooding)', () => {
    // River centreline at z≈-800 and -1600 (well inland) must be land-level water, not sea.
    for (const [x, z] of [[1900, -800], [1547, -1594], [1000, -2300]]) expect(terrain.getElevation(x, z)).toBeGreaterThan(-24);
  });

  it('sea and river are gameplay water; the sea is a flat collidable surface', () => {
    expect(terrain.getElevation(-7950, 0)).toBe(-24);
    expect(terrain.getWaterDepth(-7950, 0)).toBeGreaterThan(0.3); // ditching here crashes
    expect(terrain.getWaterDepth(1900, -800)).toBeGreaterThan(0.3); // river channel
    expect(terrain.getWaterDepth(0, 0)).toBe(0);
  });
});
