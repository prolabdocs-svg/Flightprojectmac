import { beforeAll, describe, expect, it } from 'vitest';
import { createDefaultProfile, migrateProfile } from '../save/save';
import { airfieldKnowledge, applyExploration, chartedFog, createExploration, decodeFog, explore, isRevealed, worldSites, type ExploreInput } from './exploration';
import { FOG_N } from './exploration';
import { getMasterTerrain } from './master/masterRuntime';

const known = { knownAirfieldIds: ['field_home'], visitedAirfieldIds: ['field_home'] };

describe('Fog of Discovery', () => {
  beforeAll(() => { worldSites(); }, 600_000); // builds the master map once

  it('starts hidden and reveals progressively along the real flight path', () => {
    let s = createExploration();
    expect(decodeFog(s.fog).every((b) => b === 0)).toBe(true);
    const counts: number[] = [];
    for (let x = 0; x <= 6000; x += 1000) {
      const r = explore(s, known, { x, z: 0, aglM: 300, onGround: false });
      s = r.state; counts.push(r.newCells);
    }
    const bits = decodeFog(s.fog);
    expect(isRevealed(bits, 3000, 0)).toBe(true);
    expect(isRevealed(bits, 3000, 9000)).toBe(false); // off the track stays under cloud
    expect(counts.every((n) => n > 0)).toBe(true);
    expect(s.fog.length).toBeLessThan(4000); // a bitset, not a point cloud
  });

  it('expands legacy fog saves into the larger world without moving discovered cells', () => {
    const legacy = new Uint8Array(1152);
    const i = 37, j = 42, k = j * 96 + i;
    legacy[k >> 3] |= 1 << (k & 7);
    let binary = ''; for (const byte of legacy) binary += String.fromCharCode(byte);
    const migrated = decodeFog(btoa(binary));
    expect(FOG_N).toBe(144);
    expect(isRevealed(migrated, -24000 + (i + 0.5) * 500, -24000 + (j + 0.5) * 500)).toBe(true);
    expect(migrated.length).toBe(2592);
  });

  it('supports reveal cells throughout the expanded world bounds', () => {
    const s = createExploration();
    const r = explore(s, known, { x: 33000, z: -33000, aglM: 100, onGround: false }, { airfields: [], landmarks: [], regions: [] });
    expect(isRevealed(decodeFog(r.state.fog), 33000, -33000)).toBe(true);
  });

  it('walks an airfield UNKNOWN -> SIGHTED -> DISCOVERED -> VISITED as the aircraft closes in and lands', () => {
    const a = worldSites().airfields.find((f) => f.id !== 'field_home')!;
    let s = createExploration(), k = { knownAirfieldIds: [] as string[], visitedAirfieldIds: [] as string[] };
    const step = (p: ExploreInput) => { const r = explore(s, k, p); s = r.state; k = r.known; return airfieldKnowledge(a.id, s, k); };
    expect(airfieldKnowledge(a.id, s, k)).toBe('UNKNOWN');
    expect(step({ x: a.x + 3500, z: a.z, aglM: 450, onGround: false })).toBe('SIGHTED');
    expect(step({ x: a.x + 1000, z: a.z, aglM: 300, onGround: false })).toBe('DISCOVERED');
    expect(step({ x: a.x + 50, z: a.z, aglM: 0, onGround: true })).toBe('VISITED');
  });

  it('pays discoveries into the profile and survives a save/reload round trip', () => {
    const a = worldSites().airfields.find((f) => !createDefaultProfile().operations.knownAirfieldIds.includes(f.id))!;
    const p0 = createDefaultProfile();
    const { profile, events } = applyExploration(p0, { x: a.x, z: a.z, aglM: 200, onGround: false });
    expect(events.map((e) => e.kind)).toContain('airfield_discovered');
    expect(profile.operations.knownAirfieldIds).toContain(a.id);
    expect(profile.reputation).toBeGreaterThan(p0.reputation);
    const reloaded = migrateProfile(JSON.parse(JSON.stringify(profile)));
    expect(reloaded.operations.exploration).toEqual(profile.operations.exploration);
    expect(isRevealed(decodeFog(reloaded.operations.exploration.fog), a.x, a.z)).toBe(true);
  });

  it('identifies a neighbouring region by flying continuously into it from The Field', () => {
    const w = getMasterTerrain();
    const [x0, z0] = w.localToWorld('the_field', 0, 0), target = worldSites().regions.find((r) => r.id !== 'the_field')!;
    let p = createDefaultProfile();
    const found: string[] = [];
    for (let t = 0; t <= 1; t += 0.01) { // ≤ a few hundred metres per sample: no jumps
      const r = applyExploration(p, { x: x0 + (target.x - x0) * t, z: z0 + (target.z - z0) * t, aglM: 400, onGround: false });
      p = r.profile; found.push(...r.events.filter((e) => e.kind === 'region').map((e) => e.id));
    }
    expect(found).toContain(target.id);
    expect(chartedFog(p.operations.exploration, p.operations)).toBeInstanceOf(Uint8Array);
  });

  it('backfills exploration into saves that predate it', () => {
    const old = createDefaultProfile() as unknown as { operations: Record<string, unknown> };
    delete old.operations.exploration;
    expect(migrateProfile(old as never).operations.exploration).toEqual(createExploration());
  });
});
