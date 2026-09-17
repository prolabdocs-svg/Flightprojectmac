import { describe, expect, it } from 'vitest';
import { THE_FIELD, getRegion } from '../content/regions';
import { createTerrainQueryService } from './terrainQuery';

describe('createTerrainQueryService', () => {
  it('is flat near the runway pad (radius < 190m)', () => {
    const terrain = createTerrainQueryService(THE_FIELD);
    expect(terrain.getElevation(0, -150)).toBe(0);
    expect(terrain.getElevation(50, -100)).toBe(0);
  });

  it('produces non-trivial relief away from the runway pad', () => {
    const terrain = createTerrainQueryService(THE_FIELD);
    const elevation = terrain.getElevation(1200, 900);
    expect(elevation).not.toBe(0);
    expect(Number.isFinite(elevation)).toBe(true);
  });

  it('is deterministic: same inputs always produce the same outputs', () => {
    const terrainA = createTerrainQueryService(THE_FIELD);
    const terrainB = createTerrainQueryService(THE_FIELD);
    for (const [x, z] of [[100, 200], [-450, 30], [1800, -900]] as const) {
      expect(terrainA.getElevation(x, z)).toBe(terrainB.getElevation(x, z));
      expect(terrainA.getSlopeDeg(x, z)).toBe(terrainB.getSlopeDeg(x, z));
    }
  });

  it('scales relief by terrain roughness (quarry rougher than open terrain)', () => {
    const quarryRegion = getRegion('scrap_valley');
    const terrain = createTerrainQueryService(THE_FIELD);
    const quarryTerrain = createTerrainQueryService(quarryRegion);
    expect(quarryRegion.environment.terrain).toBe('quarry');
    const flatElevation = Math.abs(terrain.getElevation(1200, 900));
    const quarryElevation = Math.abs(quarryTerrain.getElevation(1200, 900));
    expect(quarryElevation).toBeGreaterThan(flatElevation);
  });

  it('reports ~0 degrees slope on the flat runway pad', () => {
    const terrain = createTerrainQueryService(THE_FIELD);
    expect(terrain.getSlopeDeg(0, -150)).toBeCloseTo(0, 5);
  });

  it('reports a positive, finite slope on sloped terrain', () => {
    const terrain = createTerrainQueryService(THE_FIELD);
    const slope = terrain.getSlopeDeg(1200, 900);
    expect(slope).toBeGreaterThan(0);
    expect(Number.isFinite(slope)).toBe(true);
  });

  it('is repeatable across many calls with the same coordinates (no hidden randomness)', () => {
    const terrain = createTerrainQueryService(THE_FIELD);
    const first = terrain.getElevation(777, -333);
    for (let i = 0; i < 25; i++) {
      expect(terrain.getElevation(777, -333)).toBe(first);
    }
  });
});
