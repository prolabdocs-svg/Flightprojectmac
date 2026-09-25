// Save schema v4 (contract operations): migration of old saves and real reload through IndexedDB.
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import type { PlayerProfile } from '../core/types';
import { createDefaultProfile, migrateProfile, SAVE_SCHEMA_VERSION } from '../save/save';
import { installPart } from '../content/assembly';
import { acceptContract, getOffers, prepareMission, suggestedLoadout } from './operations';

const reload = async (tag: string) => {
  const mod = await import(/* @vite-ignore */ `../save/save?t=${Date.now()}-${tag}`);
  await mod.whenSaveRepositoryReady();
  return mod as typeof import('../save/save');
};
const settle = () => new Promise((r) => setTimeout(r, 60));

describe('migration to schema v4', () => {
  it('lifts a v3 save without losing anything and parks the aircraft at home with its own tank full', () => {
    const v3 = createDefaultProfile() as unknown as PlayerProfile & { operations?: unknown };
    v3.cash = 777;
    v3.reputation = 14;
    v3.ownedParts = [...v3.ownedParts, 'tank_12'];
    v3.currentBuild = installPart(v3.currentBuild, 'fuelTank', 'tank_12');
    v3.completedMissions = { field_distance_01: { bestScore: 321, attempts: 2 } };
    v3.schemaVersion = 3;
    delete (v3 as { operations?: unknown }).operations;

    const m = migrateProfile(v3 as PlayerProfile);
    expect(m.schemaVersion).toBe(SAVE_SCHEMA_VERSION);
    expect(m.cash).toBe(777);
    expect(m.reputation).toBe(14);
    expect(m.ownedParts).toContain('tank_12');
    expect(m.completedMissions.field_distance_01).toEqual({ bestScore: 321, attempts: 2 });
    expect(m.currentBuild.installed.fuelTank).toBe('tank_12');
    expect(m.operations.locationId).toBe('field_home');
    expect(m.operations.fuelL).toBe(12);
    expect(m.operations.active).toBeNull();
    expect(m.operations.settledContractIds).toEqual([]);
    expect(m.operations.knownAirfieldIds).toEqual(expect.arrayContaining(['field_home', 'field_north_strip', 'field_east_meadow', 'field_far_ridge']));
  });

  it('migrates v1 and v2 saves all the way (settings, homeBase, frames, operations)', () => {
    const old = createDefaultProfile() as unknown as Record<string, unknown>;
    delete old.operations;
    delete old.homeBase;
    delete old.ownedFrameIds;
    old.schemaVersion = 1;
    old.settings = { controlPreset: 'normal', assistMode: 'assisted', invertPitch: false, stickSize: 1, musicVolume: 0.7, sfxVolume: 0.8 };
    const m = migrateProfile(old as unknown as PlayerProfile);
    expect(m.schemaVersion).toBe(SAVE_SCHEMA_VERSION);
    expect(m.homeBase).toEqual({ runwayLevel: 0, hangarLevel: 0 });
    expect(m.ownedFrameIds).toEqual(['frame_zero']);
    expect(m.settings.textSize).toBe('normal');
    expect(m.settings.engineVolume).toBe(0.8);
    expect(m.operations.locationId).toBe('field_home');
  });

  it('backfills operations fields added later without touching what is there', () => {
    const p = createDefaultProfile();
    const partial = { ...p, operations: { ...p.operations, locationId: 'field_north_strip', debtCash: 40, condition: undefined as never } };
    delete (partial.operations as Record<string, unknown>).log;
    const m = migrateProfile(partial);
    expect(m.operations.locationId).toBe('field_north_strip');
    expect(m.operations.debtCash).toBe(40);
    expect(m.operations.log).toEqual([]);
  });

  it('is idempotent', () => {
    const p = createDefaultProfile();
    expect(migrateProfile(migrateProfile(p))).toEqual(migrateProfile(p));
  });
});

describe('save / load through IndexedDB', () => {
  beforeEach(() => {
    (globalThis as { indexedDB: IDBFactory }).indexedDB = new IDBFactory();
  });

  it('operations, discoveries, wallet and an in-flight contract survive a real reload', async () => {
    const first = await reload('a');
    let p = first.createDefaultProfile();
    p = { ...p, cash: 512, operations: { ...p.operations, visitedAirfieldIds: [...p.operations.visitedAirfieldIds, 'field_north_strip'], debtCash: 25 } };
    const offer = getOffers(p).find((o) => o.available && o.contract.destinationId === 'field_east_meadow')!;
    const acc = acceptContract(p, offer.contract.id);
    if (!acc.ok) throw new Error(acc.error);
    const prep = prepareMission(acc.profile, suggestedLoadout(acc.profile)!);
    if (!prep.ok) throw new Error(prep.error);
    first.saveRepository.save(prep.profile);
    await settle();

    const second = await reload('b');
    const loaded = second.saveRepository.load()!;
    expect(loaded).toEqual(prep.profile);
    expect(loaded.operations.active!.session.state).toBe('PREPARED');
    expect(loaded.operations.active!.loadout).toEqual(prep.profile.operations.active!.loadout);
    expect(loaded.operations.visitedAirfieldIds).toContain('field_north_strip');
    expect(loaded.cash).toBe(512);
    expect(loaded.operations.debtCash).toBe(25);
    // The board regenerates identically after reload (deterministic seed), so an active contract is still resolvable.
    expect(getOffers(loaded).map((o) => o.contract.id)).toEqual(getOffers(prep.profile).map((o) => o.contract.id));
  });

  it('a pre-operations save stored in IndexedDB loads as v4 after an update', async () => {
    const first = await reload('c');
    const old = first.createDefaultProfile() as unknown as Record<string, unknown>;
    delete old.operations;
    old.schemaVersion = 3;
    first.saveRepository.save(old as unknown as PlayerProfile);
    await settle();
    const second = await reload('d');
    const loaded = second.saveRepository.load()!;
    expect(loaded.schemaVersion).toBe(SAVE_SCHEMA_VERSION);
    expect(loaded.operations.locationId).toBe('field_home');
  });
});
