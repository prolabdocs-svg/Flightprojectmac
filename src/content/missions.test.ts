import { describe, expect, it } from 'vitest';
import { createDefaultProfile } from '../save/save';
import { getNextAvailableMission, getMission, isMissionAvailableToProfile, MISSIONS } from './missions';
import { evaluateMissionReadiness } from './missionReadiness';
import { defaultBuild } from './assembly';
import { FRAMES, PARTS } from './parts';
import { REGIONS } from './regions';

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

describe('aircraft capability gates', () => {
  const starter = defaultBuild();

  it('never gates the first three Field missions or the starter aircraft', () => {
    const field = ['field_distance_01', 'field_precision_01', 'field_stol_01'];
    for (const id of field) {
      expect(getMission(id)!.aircraftRequirement).toBeUndefined();
    }
  });

  it('never gates the mandatory campaign path (the mission each region requires to unlock the next)', () => {
    const mandatoryIds = REGIONS.map((r) => r.unlockRequirement?.requiredMissionId).filter(Boolean) as string[];
    // Sequential in-region ordering means every contract at or before a mandatory gate
    // within its own region is itself mandatory (it must be completed first).
    for (const requiredId of mandatoryIds) {
      const required = getMission(requiredId)!;
      const regionMissions = MISSIONS.filter((m) => m.regionId === required.regionId);
      const gateIndex = regionMissions.findIndex((m) => m.id === requiredId);
      for (const m of regionMissions.slice(0, gateIndex + 1)) {
        expect(m.aircraftRequirement, `${m.id} is on the mandatory path and must stay starter-completable`).toBeUndefined();
      }
    }
  });

  it('every authored capability requirement is unreachable by the bare starter build', () => {
    const gated = MISSIONS.filter((m) => m.aircraftRequirement);
    expect(gated.length).toBeGreaterThan(0);
    for (const mission of gated) {
      expect(evaluateMissionReadiness(mission, starter).ready, `${mission.id} should not be starter-completable`).toBe(false);
    }
  });

  it('every authored capability requirement has a demonstrably attainable build somewhere in the authored content graph', () => {
    const gated = MISSIONS.filter((m) => m.aircraftRequirement);
    for (const mission of gated) {
      const satisfiable = FRAMES.some((frame) => {
        // Exhaustively try every part this frame's hardpoints accept, per category —
        // small search space, and it directly checks the authored parts/frames graph
        // rather than asserting a specific hand-picked combination stays valid forever.
        const categories = frame.hardpoints.map((h) => h.category);
        let builds = [{ frameId: frame.id, installed: { ...frame.defaultLoadout } }];
        for (const category of categories) {
          const options = PARTS.filter((p) => p.category === category && frame.hardpoints.find((h) => h.category === category)?.accepts.includes(p.id));
          builds = builds.flatMap((b) => options.map((opt) => ({ ...b, installed: { ...b.installed, [category]: opt.id } })));
        }
        return builds.some((b) => evaluateMissionReadiness(mission, b).ready);
      });
      expect(satisfiable, `${mission.id}'s aircraftRequirement has no attainable build`).toBe(true);
    }
  });
});
