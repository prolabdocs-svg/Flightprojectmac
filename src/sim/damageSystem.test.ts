import { describe, expect, it } from 'vitest';
import {
  applyGroundImpact,
  bandForIntegrity,
  createDamageState,
  gearPartId,
  getAeroEffectivenessMultiplier,
  getGroundHandlingPenalty,
  impactStressFraction,
  listDamagedPartIds,
  listDetachedPartIds,
} from './damageSystem';

const SURFACE_IDS = ['wing_root_main', 'aileron_l', 'aileron_r', 'elevator', 'rudder'];

describe('createDamageState', () => {
  it('starts every part nominal and not detached', () => {
    const state = createDamageState(SURFACE_IDS);
    for (const id of SURFACE_IDS) {
      expect(state.parts[id].integrity).toBe(1);
      expect(state.parts[id].detached).toBe(false);
    }
    expect(state.parts[gearPartId()].integrity).toBe(1);
    expect(state.outcome).toBe('none');
  });
});

describe('impactStressFraction', () => {
  it('is zero at/under the safe threshold', () => {
    expect(impactStressFraction(0)).toBe(0);
    expect(impactStressFraction(3)).toBe(0);
  });

  it('increases with impact speed and clamps at 1', () => {
    const mild = impactStressFraction(5);
    const severe = impactStressFraction(12);
    expect(severe).toBeGreaterThan(mild);
    expect(impactStressFraction(100)).toBe(1);
  });
});

describe('applyGroundImpact', () => {
  it('a gentle touchdown below the safe threshold causes no damage', () => {
    const state = createDamageState(SURFACE_IDS);
    const next = applyGroundImpact(state, 1.5);
    for (const id of SURFACE_IDS) {
      expect(next.parts[id].integrity).toBe(1);
    }
    expect(next.outcome).toBe('none');
  });

  it('a moderate impact damages gear more than wings/tail but stays below hard-landing', () => {
    const state = createDamageState(SURFACE_IDS);
    const next = applyGroundImpact(state, 6);
    expect(next.parts[gearPartId()].integrity).toBeLessThan(1);
    expect(next.parts[gearPartId()].integrity).toBeLessThan(next.parts.elevator.integrity);
    expect(next.outcome).toBe('hardLanding');
  });

  it('a hard impact (>= 8 m/s) is flagged as totalLoss, matching the existing crash threshold', () => {
    const state = createDamageState(SURFACE_IDS);
    const next = applyGroundImpact(state, 9);
    expect(next.outcome).toBe('totalLoss');
  });

  it('a severe repeated impact can detach a wing part but never the tail', () => {
    let state = createDamageState(SURFACE_IDS);
    for (let i = 0; i < 5; i++) {
      state = applyGroundImpact(state, 14);
    }
    expect(state.parts.aileron_l.detached).toBe(true);
    expect(state.parts.elevator.detached).toBe(false);
    expect(bandForIntegrity(state.parts.elevator.integrity)).toBe('failed');
  });

  it('never damages an already-detached part further and outcome only escalates', () => {
    let state = createDamageState(SURFACE_IDS);
    state = applyGroundImpact(state, 14);
    state = applyGroundImpact(state, 14);
    const detachedIntegrity = state.parts.aileron_l.integrity;
    state = applyGroundImpact(state, 2); // gentle now; outcome must not downgrade
    expect(state.parts.aileron_l.integrity).toBe(detachedIntegrity);
    expect(state.outcome).toBe('totalLoss');
  });
});

describe('getAeroEffectivenessMultiplier', () => {
  it('returns 1 for a nominal, unknown-state-untouched part', () => {
    const state = createDamageState(SURFACE_IDS);
    expect(getAeroEffectivenessMultiplier(state, 'wing_root_main')).toBe(1);
  });

  it('returns 0 for a detached part', () => {
    let state = createDamageState(SURFACE_IDS);
    for (let i = 0; i < 5; i++) state = applyGroundImpact(state, 14);
    expect(getAeroEffectivenessMultiplier(state, 'aileron_l')).toBe(0);
  });

  it('degrades progressively through damaged/critical bands', () => {
    const state = createDamageState(SURFACE_IDS);
    state.parts.aileron_l.integrity = 0.6; // damaged band
    expect(getAeroEffectivenessMultiplier(state, 'aileron_l')).toBeLessThan(1);
    state.parts.aileron_l.integrity = 0.3; // critical band
    expect(getAeroEffectivenessMultiplier(state, 'aileron_l')).toBeLessThan(0.75);
  });
});

describe('getGroundHandlingPenalty', () => {
  it('is 1 for nominal gear and increases as gear degrades', () => {
    const state = createDamageState(SURFACE_IDS);
    expect(getGroundHandlingPenalty(state)).toBe(1);
    const damaged = applyGroundImpact(state, 7);
    expect(getGroundHandlingPenalty(damaged)).toBeGreaterThan(1);
  });
});

describe('listDamagedPartIds / listDetachedPartIds', () => {
  it('reports damaged and detached parts separately', () => {
    let state = createDamageState(SURFACE_IDS);
    state = applyGroundImpact(state, 7.9);
    expect(listDamagedPartIds(state).length).toBeGreaterThan(0);
    expect(listDetachedPartIds(state)).toEqual([]);

    for (let i = 0; i < 5; i++) state = applyGroundImpact(state, 14);
    expect(listDetachedPartIds(state).length).toBeGreaterThan(0);
  });
});
