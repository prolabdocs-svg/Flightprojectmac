import { describe, expect, it } from 'vitest';
import { createAircraftCondition } from './aircraftCondition';
import { applyNormalWear, estimateRepair, isRepairReady, type RepairOrder } from './maintenance';

describe('applyNormalWear', () => {
  it('a short, clean flight produces negligible wear', () => {
    const c = createAircraftCondition();
    const next = applyNormalWear(c, { distanceM: 5000, elapsedS: 120, landed: true });
    for (const id of Object.keys(next) as (keyof typeof next)[]) {
      expect(next[id].integrity).toBeGreaterThan(0.99);
    }
  });
  it('wear only ever reduces integrity, never repairs it', () => {
    const c = createAircraftCondition();
    const next = applyNormalWear(c, { distanceM: 500_000, elapsedS: 7200, landed: true });
    for (const id of Object.keys(next) as (keyof typeof next)[]) {
      expect(next[id].integrity).toBeLessThanOrEqual(c[id].integrity);
    }
  });
});

describe('estimateRepair', () => {
  it('a healthy aircraft needs nothing', () => {
    const e = estimateRepair(createAircraftCondition());
    expect(e.componentIds).toEqual([]);
    expect(e.costCash).toBe(0);
    expect(e.durationMs).toBe(0);
  });
  it('cost scales with how much integrity is missing', () => {
    const light = createAircraftCondition();
    light.wingLeft = { integrity: 0.9 };
    const heavy = createAircraftCondition();
    heavy.wingLeft = { integrity: 0.1 };
    expect(estimateRepair(heavy).costCash).toBeGreaterThan(estimateRepair(light).costCash);
  });
  it('a component id filter prices only what was asked for', () => {
    const c = createAircraftCondition();
    c.wingLeft = { integrity: 0.5 };
    c.engine = { integrity: 0.5 };
    const wingOnly = estimateRepair(c, ['wingLeft']);
    expect(wingOnly.componentIds).toEqual(['wingLeft']);
    expect(wingOnly.costCash).toBeLessThan(estimateRepair(c).costCash);
  });
});

describe('isRepairReady', () => {
  it('is false before readyAtMs and true at/after it', () => {
    const order: RepairOrder = { componentIds: ['engine'], costCash: 10, startedAtMs: 0, readyAtMs: 1000 };
    expect(isRepairReady(order, 999)).toBe(false);
    expect(isRepairReady(order, 1000)).toBe(true);
    expect(isRepairReady(order, 5000)).toBe(true);
  });
});
