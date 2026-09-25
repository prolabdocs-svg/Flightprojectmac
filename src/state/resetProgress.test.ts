// End-to-end Reset Progress: build progress through the real store actions, reset, then
// "reload" (fresh module graph over the same fake IndexedDB) and check nothing old comes back.
import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { useProfileStore } from './profileStore';
import { useGameStore } from './gameStore';
import { createDefaultProfile, migrateProfile, whenSaveRepositoryReady } from '../save/save';
import { TECH_NODES } from '../content/techtree';
import type { PlayerProfile } from '../core/types';

const flush = () => new Promise((r) => setTimeout(r, 20));

/** What a page reload sees: the raw IndexedDB record, migrated exactly as save.ts does at boot. */
function readDisk(): Promise<PlayerProfile | null> {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open('project-flight', 1);
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const req = open.result.transaction('profile', 'readonly').objectStore('profile').get('main');
      req.onsuccess = () => { open.result.close(); resolve(req.result ? migrateProfile(req.result.payload) : null); };
      req.onerror = () => reject(req.error);
    };
  });
}

describe('Reset Progress', () => {
  it('wipes all progress across a full reload and keeps user settings', async () => {
    await whenSaveRepositoryReady();
    const ps = useProfileStore, gs = useGameStore;
    const s = () => ps.getState();
    const fog0 = s().profile.operations.exploration.fog;

    s().applyFlightResult({ rewardCash: 5000, rewardRp: 500, distanceM: 900, crashed: false, missionId: 'field_distance_01', missionCompleted: true } as never);
    expect(s().buyFrame('frame_nightjar', 100)).toBe(true);
    const root = TECH_NODES.find((n) => n.requires.length === 0)!;
    expect(s().unlockTech(root.id, 1)).toBe(true);
    s().recordExploration({ x: 4000, z: 4000, aglM: 900, onGround: false });
    expect(s().profile.operations.exploration.fog).not.toEqual(fog0);
    s().buyPart('engine_rotax', 10);
    s().setBuild({ ...s().profile.currentBuild, installed: { ...s().profile.currentBuild.installed, engine: 'engine_rotax' } });
    s().buyPaint('paint_x', 10);
    s().selectPaint('paint_x'); // ponytail: avatar isn't in PlayerProfile yet; paint is the persisted customisation
    s().updateSettings({ musicVolume: 0.2, invertPitch: true, textSize: 'large', hasSeenOnboarding: true });
    gs.getState().selectMission('field_distance_01');
    gs.getState().setMapSelection('x');
    await flush();
    expect((await readDisk())!.cash).toBeGreaterThan(1000); // progress really hit disk

    s().resetProfile();
    expect(gs.getState().selectedMissionId).toBeNull();
    expect(gs.getState().mapSelectionId).toBeNull();
    await flush();

    const after = (await readDisk())!;
    expect(s().profile).toEqual(after); // in-memory store matches disk
    const fresh = createDefaultProfile();
    const { createdAt: _a, settings: _s, ...progress } = after;
    const { createdAt: _b, settings: _t, ...freshProgress } = fresh;
    expect(progress).toEqual(freshProgress);
    expect(after.settings).toMatchObject({ musicVolume: 0.2, invertPitch: true, textSize: 'large', hasSeenOnboarding: true });
  }, 180_000); // fog + world-site generation is slow under jsdom
});
