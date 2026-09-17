import { describe, expect, it } from 'vitest';
import { getRegion } from '../content/regions';
import {
  discoverLandmarks,
  getMapLandmarks,
  getRegionLandmarks,
  isLandmarkRecognized,
  landmarksHaveCausalAnchor,
} from './landmarks';
import { createTerrainQueryService } from './terrainQuery';

describe('landmark discovery §120', () => {
  it('recognizes a landmark once close enough with line of sight', () => {
    const terrain = createTerrainQueryService(getRegion('the_field'));
    const landmark = getRegionLandmarks('the_field').find((l) => l.id === 'the_field_water_tank')!;
    const [x, , z] = landmark.worldPosition;
    const observer = { x, z: z - 10, elevationM: terrain.getElevation(x, z - 10) };
    expect(isLandmarkRecognized(landmark, terrain, observer)).toBe(true);
  });

  it('does not recognize a landmark far outside its recognition radius', () => {
    const terrain = createTerrainQueryService(getRegion('the_field'));
    const landmark = getRegionLandmarks('the_field').find((l) => l.id === 'the_field_water_tank')!;
    const observer = { x: 5000, z: 5000, elevationM: terrain.getElevation(5000, 5000) };
    expect(isLandmarkRecognized(landmark, terrain, observer)).toBe(false);
  });

  it('discovering near a hidden landmark adds it, and discovery persists across calls', () => {
    const terrain = createTerrainQueryService(getRegion('the_field'));
    const landmark = getRegionLandmarks('the_field').find((l) => l.id === 'the_field_town')!;
    const [x, , z] = landmark.worldPosition;
    const observer = { x, z, elevationM: terrain.getElevation(x, z) };

    const discovered = discoverLandmarks('the_field', terrain, observer, new Set());
    expect(discovered.has('the_field_town')).toBe(true);

    const stillDiscovered = discoverLandmarks('the_field', terrain, { x: 0, z: 0, elevationM: 0 }, discovered);
    expect(stillDiscovered.has('the_field_town')).toBe(true);
  });

  it('map only shows known landmarks plus discovered ones', () => {
    const idsWithNoneDiscovered = getMapLandmarks('the_field', new Set()).map((l) => l.id);
    expect(idsWithNoneDiscovered).toContain('the_field_water_tank'); // known
    expect(idsWithNoneDiscovered).not.toContain('the_field_town'); // hidden, undiscovered

    const idsWithTownDiscovered = getMapLandmarks('the_field', new Set(['the_field_town'])).map((l) => l.id);
    expect(idsWithTownDiscovered).toContain('the_field_town');
  });
});

describe('landmark registry', () => {
  it('every landmark is anchored to a real land-use feature', () => {
    expect(landmarksHaveCausalAnchor()).toBe(true);
  });

  it('regions with no settlement flavor get no landmarks', () => {
    expect(getRegionLandmarks('scrap_valley')).toHaveLength(0);
  });
});
