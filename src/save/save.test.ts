// Exercises createDefaultProfile plus the SaveRepository contract using an in-memory fake
// IndexedDB (jsdom's own IndexedDB support is absent, so we polyfill it here).
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { createDefaultProfile, SAVE_SCHEMA_VERSION } from './save';

describe('createDefaultProfile', () => {
  it('produces a fresh profile with starter resources and parts', () => {
    const profile = createDefaultProfile();
    expect(profile.schemaVersion).toBe(SAVE_SCHEMA_VERSION);
    expect(profile.cash).toBe(200);
    expect(profile.researchPoints).toBe(0);
    expect(profile.unlockedTech).toEqual([]);
    expect(profile.ownedParts).toEqual(expect.arrayContaining(['engine_small', 'wing_a_basic', 'tank_8', 'gear_light']));
    expect(profile.ownedPaintIds).toContain('paint_default');
    expect(profile.selectedPaintId).toBe('paint_default');
  });

  it('returns a distinct object each call (no shared mutable state)', () => {
    const a = createDefaultProfile();
    const b = createDefaultProfile();
    a.cash = 999;
    expect(b.cash).toBe(200);
  });
});

describe('SaveRepository (IndexedDB-backed)', () => {
  beforeEach(() => {
    // Fresh fake IndexedDB per test so saves in one test don't leak into the next, and so
    // each dynamic re-import of './save' constructs its repository against an empty DB.
    (globalThis as { indexedDB: IDBFactory }).indexedDB = new IDBFactory();
  });

  it('round-trips a saved profile through load() after save() settles', async () => {
    const mod = await import(/* @vite-ignore */ `./save?t=${Date.now()}-a`);
    await mod.whenSaveRepositoryReady();
    const profile = mod.createDefaultProfile();
    profile.cash = 1234;
    mod.saveRepository.save(profile);
    // save() writes to IndexedDB asynchronously in the background; give it a tick.
    await new Promise((r) => setTimeout(r, 50));
    expect(mod.saveRepository.load()?.cash).toBe(1234);
  });

  it('load() returns null before anything has been saved', async () => {
    const mod = await import(/* @vite-ignore */ `./save?t=${Date.now()}-b`);
    await mod.whenSaveRepositoryReady();
    expect(mod.saveRepository.load()).toBeNull();
  });

  it('clear() removes the in-memory profile', async () => {
    const mod = await import(/* @vite-ignore */ `./save?t=${Date.now()}-c`);
    await mod.whenSaveRepositoryReady();
    const profile = mod.createDefaultProfile();
    mod.saveRepository.save(profile);
    await new Promise((r) => setTimeout(r, 50));
    expect(mod.saveRepository.load()).not.toBeNull();
    mod.saveRepository.clear();
    expect(mod.saveRepository.load()).toBeNull();
  });

  it('backfills homeBase (schema v2) for a pre-existing save that predates it', async () => {
    const mod = await import(/* @vite-ignore */ `./save?t=${Date.now()}-d`);
    await mod.whenSaveRepositoryReady();
    // Simulate an old save written before homeBase/schemaVersion 2 existed.
    const legacyProfile = mod.createDefaultProfile();
    delete (legacyProfile as Record<string, unknown>).homeBase;
    legacyProfile.schemaVersion = 1;
    mod.saveRepository.save(legacyProfile);
    await new Promise((r) => setTimeout(r, 50));

    // Re-import to force a fresh repository that re-runs migrate() on init from IndexedDB.
    const reloaded = await import(/* @vite-ignore */ `./save?t=${Date.now()}-d2`);
    await reloaded.whenSaveRepositoryReady();
    const loaded = reloaded.saveRepository.load();
    expect(loaded?.homeBase).toEqual({ runwayLevel: 0, hangarLevel: 0 });
    expect(loaded?.schemaVersion).toBe(2);
  });
});
