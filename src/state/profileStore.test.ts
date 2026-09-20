// Tests the profileStore's pure state-transition logic (buy/unlock/apply-result actions).
// Uses fake-indexeddb so the underlying saveRepository has a working IndexedDB to write to;
// persistence itself is covered separately in src/save/save.test.ts.
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { useProfileStore } from './profileStore';
import { MAX_HOME_BASE_LEVEL } from '../content/homeBase';
import { createDefaultProfile } from '../save/save';

beforeEach(() => {
  useProfileStore.setState({ profile: createDefaultProfile() });
});

describe('buyPart', () => {
  it('fails when cash is insufficient and does not mutate state', () => {
    const before = useProfileStore.getState().profile;
    const ok = useProfileStore.getState().buyPart('wing_c_efficient', 100000);
    expect(ok).toBe(false);
    expect(useProfileStore.getState().profile.cash).toBe(before.cash);
    expect(useProfileStore.getState().profile.ownedParts).not.toContain('wing_c_efficient');
  });

  it('deducts cash and adds the part on success', () => {
    const ok = useProfileStore.getState().buyPart('some_part', 50);
    expect(ok).toBe(true);
    const profile = useProfileStore.getState().profile;
    expect(profile.cash).toBe(200 - 50);
    expect(profile.ownedParts).toContain('some_part');
  });

  it('is idempotent: buying an already-owned part succeeds without charging again', () => {
    useProfileStore.getState().buyPart('engine_small', 50);
    const cashAfterFirst = useProfileStore.getState().profile.cash;
    const ok = useProfileStore.getState().buyPart('engine_small', 50);
    expect(ok).toBe(true);
    expect(useProfileStore.getState().profile.cash).toBe(cashAfterFirst);
  });
});

describe('selectFrame', () => {
  it('refuses an unowned frame and does not mutate currentBuild', () => {
    const before = useProfileStore.getState().profile.currentBuild;
    const ok = useProfileStore.getState().selectFrame('frame_trailblazer');
    expect(ok).toBe(false);
    expect(useProfileStore.getState().profile.currentBuild).toEqual(before);
  });

  it('refuses an unknown frame id', () => {
    useProfileStore.setState((s) => ({ profile: { ...s.profile, ownedFrameIds: [...s.profile.ownedFrameIds, 'not_a_real_frame'] } }));
    const ok = useProfileStore.getState().selectFrame('not_a_real_frame');
    expect(ok).toBe(false);
  });

  it('switches to an owned frame and repairs the loadout to its hardpoints', () => {
    useProfileStore.setState((s) => ({ profile: { ...s.profile, ownedFrameIds: [...s.profile.ownedFrameIds, 'frame_trailblazer'] } }));
    const ok = useProfileStore.getState().selectFrame('frame_trailblazer');
    expect(ok).toBe(true);
    const build = useProfileStore.getState().profile.currentBuild;
    expect(build.frameId).toBe('frame_trailblazer');
    expect(build.installed.engine).toBe('engine_small');
  });
});

describe('unlockTech', () => {
  it('fails when prerequisites are not met', () => {
    const ok = useProfileStore.getState().unlockTech('aero_efficient_wing', 30);
    expect(ok).toBe(false);
    expect(useProfileStore.getState().profile.unlockedTech).not.toContain('aero_efficient_wing');
  });

  it('fails when research points are insufficient', () => {
    const ok = useProfileStore.getState().unlockTech('airframe_bracing', 100);
    expect(ok).toBe(false);
  });

  it('succeeds and deducts research points when eligible', () => {
    useProfileStore.setState((s) => ({ profile: { ...s.profile, researchPoints: 50 } }));
    const ok = useProfileStore.getState().unlockTech('airframe_bracing', 15);
    expect(ok).toBe(true);
    const profile = useProfileStore.getState().profile;
    expect(profile.researchPoints).toBe(35);
    expect(profile.unlockedTech).toContain('airframe_bracing');
  });

  it('unlocks a chained node once its prerequisite is unlocked', () => {
    useProfileStore.setState((s) => ({ profile: { ...s.profile, researchPoints: 100 } }));
    useProfileStore.getState().unlockTech('airframe_bracing', 15);
    const ok = useProfileStore.getState().unlockTech('aero_efficient_wing', 30);
    expect(ok).toBe(true);
    expect(useProfileStore.getState().profile.unlockedTech).toEqual(
      expect.arrayContaining(['airframe_bracing', 'aero_efficient_wing']),
    );
  });
});

describe('buyPaint', () => {
  it('fails when cash is insufficient', () => {
    const ok = useProfileStore.getState().buyPaint('paint_night_ops', 400);
    expect(ok).toBe(false);
  });

  it('succeeds and adds the paint id when affordable', () => {
    useProfileStore.setState((s) => ({ profile: { ...s.profile, cash: 500 } }));
    const ok = useProfileStore.getState().buyPaint('paint_night_ops', 400);
    expect(ok).toBe(true);
    const profile = useProfileStore.getState().profile;
    expect(profile.cash).toBe(100);
    expect(profile.ownedPaintIds).toContain('paint_night_ops');
  });
});

describe('selectPaint', () => {
  it('updates the selected paint id', () => {
    useProfileStore.getState().selectPaint('paint_barnstormer');
    expect(useProfileStore.getState().profile.selectedPaintId).toBe('paint_barnstormer');
  });
});

describe('applyFlightResult', () => {
  it('adds cash and research points, and boosts reputation more for a clean flight', () => {
    useProfileStore.getState().applyFlightResult({
      missionId: null,
      distanceM: 100,
      maxAltitudeM: 50,
      maxSpeedMs: 20,
      crashed: false,
      landed: true,
      landingQuality: 1,
      timeS: 30,
      fuelRemaining: 0.5,
      rewardCash: 40,
      rewardRp: 5,
      bonusesAchieved: [],
    });
    const profile = useProfileStore.getState().profile;
    expect(profile.cash).toBe(240);
    expect(profile.researchPoints).toBe(5);
    expect(profile.reputation).toBe(1.5);
  });

  it('grants a smaller reputation bump for a crashed flight', () => {
    useProfileStore.getState().applyFlightResult({
      missionId: null,
      distanceM: 10,
      maxAltitudeM: 5,
      maxSpeedMs: 5,
      crashed: true,
      landed: false,
      landingQuality: 0,
      timeS: 5,
      fuelRemaining: 0.9,
      rewardCash: 10,
      rewardRp: 1,
      bonusesAchieved: [],
    });
    expect(useProfileStore.getState().profile.reputation).toBe(0.5);
  });

  it('tracks best score and attempt count per mission', () => {
    const result = {
      missionId: 'field_distance_01',
      distanceM: 300,
      maxAltitudeM: 80,
      maxSpeedMs: 25,
      crashed: false,
      landed: true,
      landingQuality: 0.8,
      timeS: 40,
      fuelRemaining: 0.4,
      rewardCash: 50,
      rewardRp: 6,
      bonusesAchieved: [],
    };
    useProfileStore.getState().applyFlightResult(result);
    let mission = useProfileStore.getState().profile.completedMissions['field_distance_01'];
    expect(mission.attempts).toBe(1);
    expect(mission.bestScore).toBe(300);

    // A worse second attempt should not lower the best score, but should increment attempts.
    useProfileStore.getState().applyFlightResult({ ...result, distanceM: 100 });
    mission = useProfileStore.getState().profile.completedMissions['field_distance_01'];
    expect(mission.attempts).toBe(2);
    expect(mission.bestScore).toBe(300);

    // A better attempt raises the best score.
    useProfileStore.getState().applyFlightResult({ ...result, distanceM: 500 });
    mission = useProfileStore.getState().profile.completedMissions['field_distance_01'];
    expect(mission.attempts).toBe(3);
    expect(mission.bestScore).toBe(500);
  });

  it('does not advance campaign completion for a failed contract', () => {
    useProfileStore.getState().applyFlightResult({
      missionId: 'field_precision_01',
      distanceM: 800,
      maxAltitudeM: 90,
      maxSpeedMs: 30,
      crashed: false,
      landed: true,
      landingQuality: 0.9,
      timeS: 50,
      fuelRemaining: 0.8,
      rewardCash: 80,
      rewardRp: 8,
      bonusesAchieved: [],
      missionCompleted: false,
    });
    expect(useProfileStore.getState().profile.completedMissions.field_precision_01).toBeUndefined();
  });
});

describe('upgradeHomeBase', () => {
  it('fails when cash is insufficient and does not mutate state', () => {
    const before = useProfileStore.getState().profile;
    const ok = useProfileStore.getState().upgradeHomeBase('runway', 100000);
    expect(ok).toBe(false);
    const profile = useProfileStore.getState().profile;
    expect(profile.cash).toBe(before.cash);
    expect(profile.homeBase).toEqual(before.homeBase);
  });

  it('succeeds, deducts cash, and increments the runway level', () => {
    const ok = useProfileStore.getState().upgradeHomeBase('runway', 150);
    expect(ok).toBe(true);
    const profile = useProfileStore.getState().profile;
    expect(profile.cash).toBe(200 - 150);
    expect(profile.homeBase.runwayLevel).toBe(1);
    expect(profile.homeBase.hangarLevel).toBe(0);
  });

  it('succeeds, deducts cash, and increments the hangar level independently', () => {
    const ok = useProfileStore.getState().upgradeHomeBase('hangar', 150);
    expect(ok).toBe(true);
    const profile = useProfileStore.getState().profile;
    expect(profile.cash).toBe(200 - 150);
    expect(profile.homeBase.hangarLevel).toBe(1);
    expect(profile.homeBase.runwayLevel).toBe(0);
  });

  it('refuses upgrades beyond the supported base level cap', () => {
    useProfileStore.setState((state) => ({
      profile: { ...state.profile, cash: 10000, homeBase: { ...state.profile.homeBase, runwayLevel: MAX_HOME_BASE_LEVEL } },
    }));
    expect(useProfileStore.getState().upgradeHomeBase('runway', 100)).toBe(false);
    expect(useProfileStore.getState().profile.homeBase.runwayLevel).toBe(MAX_HOME_BASE_LEVEL);
  });
});

describe('updateSettings', () => {
  it('merges a partial patch into settings without clobbering other fields', () => {
    useProfileStore.getState().updateSettings({ invertPitch: true });
    const settings = useProfileStore.getState().profile.settings;
    expect(settings.invertPitch).toBe(true);
    expect(settings.controlPreset).toBe('normal'); // untouched
  });
});
