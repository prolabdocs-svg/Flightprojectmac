// Local-first save system (spec section 44). Uses localStorage behind a small repository
// interface so it can be swapped for IndexedDB / cloud sync later without touching callers.

import type { PlayerProfile } from '../core/types';
import { defaultBuild } from '../content/assembly';

export const SAVE_SCHEMA_VERSION = 1;
const STORAGE_KEY = 'project-flight/save';

export interface SaveRepository {
  load(): PlayerProfile | null;
  save(profile: PlayerProfile): void;
  clear(): void;
}

export function createDefaultProfile(): PlayerProfile {
  return {
    schemaVersion: SAVE_SCHEMA_VERSION,
    createdAt: Date.now(),
    cash: 200,
    researchPoints: 0,
    salvage: 0,
    reputation: 0,
    ownedParts: ['engine_small', 'wing_a_basic', 'tank_8', 'gear_light'],
    unlockedMissions: ['field_distance_01'],
    completedMissions: {},
    currentBuild: defaultBuild(),
    settings: {
      controlPreset: 'normal',
      assistMode: 'assisted',
      invertPitch: false,
      stickSize: 1,
      musicVolume: 0.7,
      sfxVolume: 0.8,
    },
  };
}

/** Migrates an older save forward. Add cases as schemaVersion increases. */
function migrate(raw: PlayerProfile): PlayerProfile {
  let profile = raw;
  if (profile.schemaVersion < 1) {
    profile = { ...profile, schemaVersion: 1 };
  }
  return profile;
}

class LocalStorageSaveRepository implements SaveRepository {
  load(): PlayerProfile | null {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as PlayerProfile;
      return migrate(parsed);
    } catch (err) {
      console.warn('[save] failed to load, starting fresh profile', err);
      return null;
    }
  }

  save(profile: PlayerProfile): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(profile));
    } catch (err) {
      console.warn('[save] failed to persist profile', err);
    }
  }

  clear(): void {
    localStorage.removeItem(STORAGE_KEY);
  }
}

export const saveRepository: SaveRepository = new LocalStorageSaveRepository();
