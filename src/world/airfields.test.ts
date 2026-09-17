import { describe, expect, it } from 'vitest';
import { AIRFIELDS, airfieldsHaveValidRegions, getAirfield, getFreeFlightAirfield, getRegionAirfields } from './airfields';
import { REGIONS } from '../content/regions';

describe('AIRFIELDS', () => {
  it('gives every campaign region at least one navigable airfield', () => {
    for (const region of REGIONS) {
      expect(getRegionAirfields(region.id), `missing airfield for ${region.id}`).not.toEqual([]);
    }
  });

  it('every airfield has a unique id', () => {
    const ids = AIRFIELDS.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('every airfield references a region that actually exists', () => {
    expect(airfieldsHaveValidRegions()).toBe(true);
    const regionIds = new Set(REGIONS.map((r) => r.id));
    for (const airfield of AIRFIELDS) {
      expect(regionIds.has(airfield.regionId)).toBe(true);
    }
  });

  it('has a home airfield at/near the origin, known from the start', () => {
    const home = getAirfield('field_home');
    expect(home).toBeDefined();
    expect(home?.discoveryState).toBe('known');
    expect(Math.hypot(...(home!.position as [number, number, number]))).toBeLessThan(50);
  });
});

describe('getAirfield', () => {
  it('finds a known airfield by id', () => {
    expect(getAirfield('field_home')?.name).toBeTruthy();
  });

  it('returns undefined for an unknown id', () => {
    expect(getAirfield('nonexistent_airfield')).toBeUndefined();
  });
});

describe('getRegionAirfields', () => {
  it('returns only airfields for the given region', () => {
    const fieldAirfields = getRegionAirfields('the_field');
    expect(fieldAirfields.length).toBeGreaterThan(0);
    expect(fieldAirfields.every((a) => a.regionId === 'the_field')).toBe(true);
  });

  it('returns an empty array for a region with no airfields', () => {
    expect(getRegionAirfields('nonexistent_region')).toEqual([]);
  });
});

describe('getFreeFlightAirfield', () => {
  it('returns a deterministic launch strip for every campaign region', () => {
    for (const region of REGIONS) {
      expect(getFreeFlightAirfield(region.id)?.regionId).toBe(region.id);
    }
  });

  it('prefers a known airfield when a region has one', () => {
    expect(getFreeFlightAirfield('the_field')?.id).toBe('field_home');
  });
});
