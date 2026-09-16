// Content lookup / data-integrity tests: parts, paint, and missions by id.
import { describe, expect, it } from 'vitest';
import { PARTS, getPart } from './parts';
import { PAINT_PRESETS, getPaint } from './paint';
import { MISSIONS, getMission } from './missions';
import { REGIONS } from './regions';

describe('getPart', () => {
  it('finds a known part by id', () => {
    expect(getPart('engine_small')?.category).toBe('engine');
  });

  it('returns undefined for an unknown id', () => {
    expect(getPart('nonexistent_part')).toBeUndefined();
  });

  it('every part has a unique id', () => {
    const ids = PARTS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('getPaint', () => {
  it('finds a known paint preset by id', () => {
    expect(getPaint('paint_default')?.name).toBe('Lona cruda');
  });

  it('returns undefined for an unknown id', () => {
    expect(getPaint('nonexistent_paint')).toBeUndefined();
  });

  it('every paint preset has a unique id', () => {
    const ids = PAINT_PRESETS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('the default paint is free', () => {
    expect(getPaint('paint_default')?.priceCash).toBe(0);
  });
});

describe('getMission', () => {
  it('finds a known mission by id', () => {
    expect(getMission('field_distance_01')).toBeDefined();
  });

  it('returns undefined for an unknown id', () => {
    expect(getMission('nonexistent_mission')).toBeUndefined();
  });

  it('every mission has a unique id and references a real region', () => {
    const ids = MISSIONS.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
    const regionIds = new Set(REGIONS.map((r) => r.id));
    for (const mission of MISSIONS) {
      expect(regionIds.has(mission.regionId), `mission "${mission.id}" references unknown region "${mission.regionId}"`).toBe(true);
    }
  });
});
