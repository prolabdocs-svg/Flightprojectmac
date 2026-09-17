import { describe, expect, it } from 'vitest';
import { createDefaultProfile } from '../save/save';
import { getNextAvailableMission, getMission, isMissionAvailableToProfile } from './missions';

describe('campaign mission availability', () => {
  it('starts at the first field contract and does not expose later field contracts early', () => {
    const profile = createDefaultProfile();
    expect(getNextAvailableMission(profile)?.id).toBe('field_distance_01');
    expect(isMissionAvailableToProfile(getMission('field_precision_01')!, profile)).toBe(false);
  });

  it('moves Fly Now to the next unfinished contract after completion', () => {
    const profile = createDefaultProfile();
    profile.completedMissions.field_distance_01 = { bestScore: 300, attempts: 1 };
    expect(getNextAvailableMission(profile)?.id).toBe('field_precision_01');
  });

  it('requires the prior regional contract even when the region itself is unlocked', () => {
    const profile = createDefaultProfile();
    profile.completedMissions.field_distance_01 = { bestScore: 300, attempts: 1 };
    expect(isMissionAvailableToProfile(getMission('scrap_delivery_01')!, profile)).toBe(true);
    expect(isMissionAvailableToProfile(getMission('scrap_precision_01')!, profile)).toBe(false);
  });
});
