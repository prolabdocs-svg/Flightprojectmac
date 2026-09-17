import { describe, expect, it } from 'vitest';
import { THE_FIELD, getRegion } from '../content/regions';
import { getAirfield } from './airfields';
import { createTerrainQueryService } from './terrainQuery';
import {
  VEGETATION_SPECIES,
  getVegetationLodTier,
  groupInstancesBySpecies,
  scatterVegetation,
} from './vegetation';

describe('scatterVegetation', () => {
  it('never places an instance on a graded runway pad (spec §227 QA)', () => {
    const terrain = createTerrainQueryService(THE_FIELD);
    const airfield = getAirfield('field_home')!;
    const [x, , z] = airfield.position;
    const instances = scatterVegetation(terrain, 'the_field', { minX: x - 200, maxX: x + 200, minZ: z - 200, maxZ: z + 200 });
    for (const instance of instances) {
      expect(terrain.isOnGradedRunway(instance.position[0], instance.position[2])).toBe(false);
    }
  });

  it('never places an instance underwater / floating on water (spec §227 QA)', () => {
    const region = getRegion('backcountry');
    const terrain = createTerrainQueryService(region);
    const instances = scatterVegetation(terrain, 'backcountry', { minX: 100, maxX: 500, minZ: -100, maxZ: 250 });
    for (const instance of instances) {
      expect(terrain.getWaterDepth(instance.position[0], instance.position[2])).toBe(0);
    }
  });

  it('places each instance at the sampled ground elevation, not a fixed height', () => {
    const terrain = createTerrainQueryService(THE_FIELD);
    const instances = scatterVegetation(terrain, 'the_field', { minX: 800, maxX: 1200, minZ: 700, maxZ: 1100 });
    expect(instances.length).toBeGreaterThan(0);
    for (const instance of instances) {
      expect(instance.position[1]).toBeCloseTo(terrain.getElevation(instance.position[0], instance.position[2]), 5);
    }
  });

  it('is deterministic: same bounds always produce the same scatter', () => {
    const terrain = createTerrainQueryService(THE_FIELD);
    const bounds = { minX: 800, maxX: 1200, minZ: 700, maxZ: 1100 };
    expect(scatterVegetation(terrain, 'the_field', bounds)).toEqual(scatterVegetation(terrain, 'the_field', bounds));
  });

  it('never uses identical scale or yaw across instances (spec §61: avoid identical rotation/scale)', () => {
    const terrain = createTerrainQueryService(THE_FIELD);
    const instances = scatterVegetation(terrain, 'the_field', { minX: 800, maxX: 1400, minZ: 700, maxZ: 1300 });
    const scales = new Set(instances.map((i) => i.scale));
    const yaws = new Set(instances.map((i) => i.yawRad));
    expect(scales.size).toBeGreaterThan(1);
    expect(yaws.size).toBeGreaterThan(1);
  });

  it('only ever emits species from the registry', () => {
    const terrain = createTerrainQueryService(THE_FIELD);
    const instances = scatterVegetation(terrain, 'the_field', { minX: 800, maxX: 1200, minZ: 700, maxZ: 1100 });
    const knownIds = new Set(VEGETATION_SPECIES.map((s) => s.id));
    for (const instance of instances) expect(knownIds.has(instance.speciesId)).toBe(true);
  });
});

describe('groupInstancesBySpecies', () => {
  it('groups every instance under its species id with none lost or duplicated', () => {
    const terrain = createTerrainQueryService(THE_FIELD);
    const instances = scatterVegetation(terrain, 'the_field', { minX: 800, maxX: 1200, minZ: 700, maxZ: 1100 });
    const groups = groupInstancesBySpecies(instances);
    const total = [...groups.values()].reduce((sum, group) => sum + group.length, 0);
    expect(total).toBe(instances.length);
    for (const [speciesId, group] of groups) {
      for (const instance of group) expect(instance.speciesId).toBe(speciesId);
    }
  });
});

describe('getVegetationLodTier', () => {
  it('stays full close up and culls far away, for every class', () => {
    for (const species of VEGETATION_SPECIES) {
      expect(getVegetationLodTier(species.class, 1)).toBe('full');
      expect(getVegetationLodTier(species.class, 100000)).toBe('culled');
    }
  });

  it('keeps obstacle-height classes visible further than grass (spec §148: obstacle culling)', () => {
    expect(getVegetationLodTier('medium', 300)).not.toBe('culled');
    expect(getVegetationLodTier('grass', 300)).toBe('culled');
  });
});
