import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { DEFAULT_APPEARANCE, sanitizeAppearance } from './appearance';
import { migrateProfile, createDefaultProfile } from '../save/save';
import { PilotAvatar, solveTwoBone, EYE_LOCAL, findSeat } from '../render/pilotAvatar';
import type { PlayerProfile } from '../core/types';

describe('avatar appearance', () => {
  it('keeps valid slots and repairs bad ones individually', () => {
    const a = sanitizeAppearance({ ...DEFAULT_APPEARANCE, hair: 'curly', hairColor: '#B8452C', top: 'spacesuit', skinTone: 'red' });
    expect(a.hair).toBe('curly');
    expect(a.hairColor).toBe('#b8452c');
    expect(a.top).toBe(DEFAULT_APPEARANCE.top);
    expect(a.skinTone).toBe(DEFAULT_APPEARANCE.skinTone);
    expect(sanitizeAppearance(null)).toEqual(DEFAULT_APPEARANCE);
  });

  it('survives a save round-trip and backfills pre-avatar saves', () => {
    const p = createDefaultProfile();
    p.avatar = { ...p.avatar, face: 'beard', headwear: 'cap' };
    const round = migrateProfile(JSON.parse(JSON.stringify(p)));
    expect(round.avatar.face).toBe('beard');
    expect(round.avatar.headwear).toBe('cap');
    const old = { ...p, schemaVersion: 5 } as Partial<PlayerProfile>;
    delete old.avatar;
    expect(migrateProfile(old as PlayerProfile).avatar).toEqual(DEFAULT_APPEARANCE);
  });
});

describe('pilot rig', () => {
  it('two-bone IK keeps bone lengths and reaches reachable targets', () => {
    const root = new THREE.Vector3(), target = new THREE.Vector3(0.1, -0.3, 0.3), joint = new THREE.Vector3(), end = new THREE.Vector3();
    solveTwoBone(root, target, 0.28, 0.26, new THREE.Vector3(0, -1, -1), joint, end);
    expect(joint.distanceTo(root)).toBeCloseTo(0.28, 5);
    expect(end.distanceTo(joint)).toBeCloseTo(0.26, 5);
    expect(end.distanceTo(target)).toBeLessThan(1e-5);
    // Out of reach: arm straightens toward the target instead of stretching.
    solveTwoBone(root, new THREE.Vector3(0, 0, 2), 0.28, 0.26, new THREE.Vector3(0, 1, 0), joint, end);
    expect(end.length()).toBeLessThan(0.54);
  });

  it('builds every option combination without throwing and animates finitely', () => {
    for (const hair of ['short', 'buzz', 'long', 'ponytail', 'curly', 'bald'] as const)
      for (const headwear of ['none', 'cap', 'leather_helmet', 'beanie'] as const) {
        const av = new PilotAvatar({ ...DEFAULT_APPEARANCE, hair, headwear, accessory: 'glasses', face: 'smile' });
        av.jolt(0.5);
        for (let i = 0; i < 30; i++) av.update({ pitch: 1, roll: -1, yaw: 1, throttle: 1, gForce: i % 2 ? 2.5 : 0.2 }, 1 / 60);
        av.root.updateMatrixWorld(true);
        const box = new THREE.Box3().setFromObject(av.root);
        expect(Number.isFinite(box.max.y)).toBe(true);
        expect(box.max.y).toBeLessThan(1.05); // seated head stays under the cage
        av.dispose();
      }
  }, 60_000);

  it('seats from a baked pilot node and hides it', () => {
    const container = new THREE.Group(), aircraft = new THREE.Group(), baked = new THREE.Object3D();
    baked.name = 'pilot'; aircraft.add(baked); aircraft.scale.setScalar(5.24); container.add(aircraft);
    const seat = findSeat(container, aircraft, 'quicksilver_mxii_sprint', new THREE.Vector3());
    expect(seat.hip.y).toBeCloseTo(0.14 * 5.24, 4);
    expect(seat.scale).toBeGreaterThanOrEqual(0.72);
    expect(EYE_LOCAL.y).toBeGreaterThan(0.6);
  });
});
