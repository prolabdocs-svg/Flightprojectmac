// Local-first save system (spec sections 44 / 154). IndexedDB-backed repository behind a
// small interface so callers (profileStore) never touch storage details directly.
//
// Storage layout: a single `profile` object store in the `project-flight` database holds
// one envelope-wrapped PlayerProfile under a fixed key. The envelope (spec 44.2) carries
// schemaVersion/gameVersion/revision/updatedAt so future migrations and cloud sync have
// something to key off. A one-time migration lifts any pre-existing localStorage save
// (the previous implementation) into IndexedDB and then clears the legacy key.

import type { HomeBaseState, PlayerProfile } from '../core/types';
import { defaultBuild, resolveAircraft } from '../content/assembly';
import { createOperations, OPERATIONS_VERSION } from '../mission/operationsState';
import { GAME_VERSION } from '../buildInfo';

export const SAVE_SCHEMA_VERSION = 5;
const DB_NAME = 'project-flight';
const DB_VERSION = 1;
const STORE_NAME = 'profile';
const RECORD_KEY = 'main';

const LEGACY_STORAGE_KEY = 'project-flight/save';

export interface SaveRepository {
  load(): PlayerProfile | null;
  save(profile: PlayerProfile): void;
  clear(): void;
}

export interface SaveEnvelope<T> {
  schemaVersion: number;
  gameVersion: string;
  revision: number;
  updatedAt: number;
  payload: T;
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
    ownedFrameIds: ['frame_zero'],
    unlockedMissions: ['field_distance_01'],
    unlockedTech: [],
    ownedPaintIds: ['paint_default'],
    selectedPaintId: 'paint_default',
    completedMissions: {},
    currentBuild: defaultBuild(),
    homeBase: { runwayLevel: 0, hangarLevel: 0 },
    operations: createOperations(),
    settings: {
      controlPreset: 'normal',
      assistMode: 'assisted',
      invertPitch: false,
      stickSize: 1,
      musicVolume: 0.7,
      sfxVolume: 0.8,
      colorblindMode: false,
      reduceMotion: false,
      textSize: 'normal',
      handedness: 'right',
      hasSeenOnboarding: false,
    },
  };
}

const DEFAULT_ACCESSIBILITY_SETTINGS = {
  colorblindMode: false,
  reduceMotion: false,
  textSize: 'normal' as const,
  handedness: 'right' as const,
  hasSeenOnboarding: false,
};

const DEFAULT_HOME_BASE: HomeBaseState = { runwayLevel: 0, hangarLevel: 0 };

/** Migrates an older save forward. Add cases as schemaVersion increases. Exported for tests. */
export function migrateProfile(raw: PlayerProfile): PlayerProfile {
  return migrate(raw);
}

function sanitizeBuildSafe(p: PlayerProfile) {
  return p.currentBuild ?? defaultBuild();
}

function migrate(raw: PlayerProfile): PlayerProfile {
  let profile = raw;
  if (profile.schemaVersion < 1) {
    profile = { ...profile, schemaVersion: 1 };
  }
  // Backfill accessibility settings added after the first save-format saves were written,
  // so older profiles loaded from IndexedDB/localStorage don't crash on missing fields.
  profile = { ...profile, settings: { ...DEFAULT_ACCESSIBILITY_SETTINGS, ...profile.settings } };
  if (profile.schemaVersion < 2) {
    // Backfill home base progression (runway/hangar levels) added in schema v2, so older
    // saves that predate it don't crash on missing fields.
    profile = { ...profile, schemaVersion: 2, homeBase: { ...DEFAULT_HOME_BASE, ...profile.homeBase } };
  }
  if (profile.schemaVersion < 3) {
    profile = { ...profile, schemaVersion: 3, ownedFrameIds: profile.ownedFrameIds?.length ? profile.ownedFrameIds : ['frame_zero'] };
  }
  if (profile.schemaVersion < 4) {
    // v4: contract operations (location, fuel on board, discoveries, active contract, settlement ledger).
    profile = { ...profile, schemaVersion: 4 };
  }
  if (profile.schemaVersion < 5) {
    // v5 (Slice 4A): per-component aircraftCondition + pendingRepair replace the old aggregate
    // operations.condition counters (which stay, for their own stats). A profile that predates
    // this has no data to infer real component wear from, so it comes back healthy rather than
    // guessing — the spread below (createOperations() first, saved fields second) already does
    // this for any field the old save simply doesn't have, so this bump only documents the change.
    profile = { ...profile, schemaVersion: 5 };
  }
  profile = { ...profile, ownedFrameIds: profile.ownedFrameIds?.length ? profile.ownedFrameIds : ['frame_zero'] };
  if (!profile.operations || profile.operations.version === undefined) {
    const fresh = createOperations();
    const build = sanitizeBuildSafe(profile);
    profile = { ...profile, operations: { ...fresh, fuelL: resolveAircraft(build).fuelCapacityL } };
  } else {
    // Forward-compatible backfill for fields added after OPERATIONS_VERSION 1, including
    // aircraftCondition/pendingRepair (v5): a save missing those keys gets createOperations()'s
    // healthy defaults since spreading `profile.operations` after it can't overwrite a key it
    // doesn't own.
    profile = { ...profile, operations: { ...createOperations(), ...profile.operations, version: OPERATIONS_VERSION } };
  }
  profile = { ...profile, homeBase: { ...DEFAULT_HOME_BASE, ...profile.homeBase } };
  return profile;
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function idbGet<T>(db: IDBDatabase, key: string): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const req = tx.objectStore(STORE_NAME).get(key);
    req.onsuccess = () => resolve(req.result as T | undefined);
    req.onerror = () => reject(req.error);
  });
}

function idbPut(db: IDBDatabase, key: string, value: unknown): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

function idbDelete(db: IDBDatabase, key: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * IndexedDB-backed save repository (spec 44.1 / 154.1).
 *
 * IndexedDB access is async, but the rest of the app (Zustand store, screens) was written
 * against a synchronous `SaveRepository`. To keep that contract without a wider rewrite,
 * this implementation keeps an in-memory mirror of the latest envelope: `load()` returns
 * synchronously from the mirror (populated by `init()` at boot, or by a completed prior
 * `save()`), while all writes go to IndexedDB in the background. This preserves durability
 * (IndexedDB survives reloads) without forcing every call site to become async.
 */
class IndexedDbSaveRepository implements SaveRepository {
  private dbPromise: Promise<IDBDatabase> | null = null;
  private memory: PlayerProfile | null = null;
  private revision = 0;
  private ready: Promise<void>;

  constructor() {
    this.ready = this.init();
  }

  private getDb(): Promise<IDBDatabase> {
    if (!this.dbPromise) this.dbPromise = openDatabase();
    return this.dbPromise;
  }

  /** Loads from IndexedDB at startup, migrating a legacy localStorage save if present. */
  private async init(): Promise<void> {
    try {
      const db = await this.getDb();
      const envelope = await idbGet<SaveEnvelope<PlayerProfile>>(db, RECORD_KEY);
      if (envelope) {
        this.memory = migrate(envelope.payload);
        this.revision = envelope.revision;
        return;
      }

      // No IndexedDB record yet: check for a pre-existing localStorage save from the
      // previous storage backend and migrate it in, so nothing is silently lost.
      const legacy = this.readLegacyLocalStorage();
      if (legacy) {
        this.memory = legacy;
        await this.writeEnvelope(db, legacy);
        try {
          localStorage.removeItem(LEGACY_STORAGE_KEY);
        } catch {
          // ignore — best-effort cleanup only
        }
      }
    } catch (err) {
      console.warn('[save] IndexedDB init failed, falling back to in-memory profile', err);
    }
  }

  private readLegacyLocalStorage(): PlayerProfile | null {
    try {
      const raw = localStorage.getItem(LEGACY_STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as PlayerProfile;
      return migrate(parsed);
    } catch (err) {
      console.warn('[save] failed to read legacy localStorage save', err);
      return null;
    }
  }

  private async writeEnvelope(db: IDBDatabase, profile: PlayerProfile): Promise<void> {
    this.revision += 1;
    const envelope: SaveEnvelope<PlayerProfile> = {
      schemaVersion: SAVE_SCHEMA_VERSION,
      gameVersion: GAME_VERSION,
      revision: this.revision,
      updatedAt: Date.now(),
      payload: profile,
    };
    await idbPut(db, RECORD_KEY, envelope);
  }

  /** Resolves once the initial IndexedDB load (and any legacy migration) has completed. */
  whenReady(): Promise<void> {
    return this.ready;
  }

  load(): PlayerProfile | null {
    return this.memory;
  }

  save(profile: PlayerProfile): void {
    this.memory = profile;
    this.getDb()
      .then((db) => this.writeEnvelope(db, profile))
      .catch((err) => console.warn('[save] failed to persist profile to IndexedDB', err));
  }

  clear(): void {
    this.memory = null;
    this.getDb()
      .then((db) => idbDelete(db, RECORD_KEY))
      .catch((err) => console.warn('[save] failed to clear IndexedDB profile', err));
    try {
      localStorage.removeItem(LEGACY_STORAGE_KEY);
    } catch {
      // ignore
    }
  }
}

const indexedDbRepository = typeof indexedDB !== 'undefined' ? new IndexedDbSaveRepository() : null;

/**
 * Synchronous fallback used only when IndexedDB is unavailable (older browsers, privacy
 * modes that block it, non-browser test environments). Keeps the app functional.
 */
class LocalStorageSaveRepository implements SaveRepository {
  load(): PlayerProfile | null {
    try {
      const raw = localStorage.getItem(LEGACY_STORAGE_KEY);
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
      localStorage.setItem(LEGACY_STORAGE_KEY, JSON.stringify(profile));
    } catch (err) {
      console.warn('[save] failed to persist profile', err);
    }
  }

  clear(): void {
    localStorage.removeItem(LEGACY_STORAGE_KEY);
  }
}

export const saveRepository: SaveRepository = indexedDbRepository ?? new LocalStorageSaveRepository();

/**
 * Awaitable readiness hook for the IndexedDB path. The profile store's `load()` stays
 * synchronous for backward compatibility, but callers that can afford to await (e.g. the
 * boot screen) should call this first so `saveRepository.load()` reflects any existing save
 * instead of racing IndexedDB's async open.
 */
export function whenSaveRepositoryReady(): Promise<void> {
  return indexedDbRepository ? indexedDbRepository.whenReady() : Promise.resolve();
}
