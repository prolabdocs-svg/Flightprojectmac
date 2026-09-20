import { describe, expect, it } from 'vitest';
import { getRegion } from '../content/regions';
import { getRegionAirfields } from './airfields';
import { scatterFieldRocks } from './fieldRocks';
import { createTerrainQueryService } from './terrainQuery';

const terrain = createTerrainQueryService(getRegion('the_field'));
const rocks = scatterFieldRocks(terrain);

describe('Field rock scatter', () => {
  it('is deterministic, sparse but present', () => {
    expect(scatterFieldRocks(terrain)).toEqual(rocks);
    expect(rocks.length).toBeGreaterThan(150);
    expect(rocks.length).toBeLessThanOrEqual(1400);
  });
  it('avoids strips, water and near-vertical faces, and favours slopes/altitude', () => {
    const strips = getRegionAirfields('the_field');
    let steepOrHigh = 0;
    for (const r of rocks) {
      for (const a of strips) expect(Math.hypot(r.x - a.position[0], r.z - a.position[2])).toBeGreaterThan(400);
      expect(terrain.getWaterDepth(r.x, r.z)).toBe(0);
      const slope = terrain.getSlopeDeg(r.x, r.z);
      expect(slope).toBeLessThanOrEqual(55);
      if (slope >= 24 || r.groundY >= 320) steepOrHigh++;
    }
    expect(steepOrHigh).toBe(rocks.length);
  });
});
