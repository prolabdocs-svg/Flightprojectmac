import { describe, expect, it } from 'vitest';
import { TECH_NODES, canUnlockTech, getTechNode, isTechUnlocked } from './techtree';

describe('getTechNode', () => {
  it('finds a node by id', () => {
    expect(getTechNode('airframe_bracing')?.name).toBe('Arriostrado mejorado');
  });

  it('returns undefined for an unknown id', () => {
    expect(getTechNode('does_not_exist')).toBeUndefined();
  });
});

describe('isTechUnlocked', () => {
  it('is true when the id is present in the unlocked list', () => {
    expect(isTechUnlocked(['airframe_bracing'], 'airframe_bracing')).toBe(true);
  });

  it('is false when absent', () => {
    expect(isTechUnlocked([], 'airframe_bracing')).toBe(false);
  });
});

describe('canUnlockTech', () => {
  it('allows unlocking a node with no prerequisites', () => {
    expect(canUnlockTech([], 'control_improved_ailerons')).toBe(true);
  });

  it('blocks unlocking a node whose prerequisite is missing', () => {
    expect(canUnlockTech([], 'aero_efficient_wing')).toBe(false);
  });

  it('allows unlocking once the prerequisite is satisfied', () => {
    expect(canUnlockTech(['airframe_bracing'], 'aero_efficient_wing')).toBe(true);
  });

  it('blocks re-unlocking an already unlocked node', () => {
    expect(canUnlockTech(['control_improved_ailerons'], 'control_improved_ailerons')).toBe(false);
  });

  it('blocks unlocking an unknown node id', () => {
    expect(canUnlockTech([], 'not_a_real_node')).toBe(false);
  });

  it('every declared prerequisite id refers to a real node (content integrity)', () => {
    for (const node of TECH_NODES) {
      for (const reqId of node.requires) {
        expect(getTechNode(reqId), `node "${node.id}" requires unknown node "${reqId}"`).toBeDefined();
      }
    }
  });
});
