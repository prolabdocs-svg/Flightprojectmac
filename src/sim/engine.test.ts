import { describe, expect, it } from 'vitest';
import type { EngineSpec } from '../core/types';
import { computeEngineRpm } from './engine';

const engine: EngineSpec = {
  id: 'test', name: 'Test', type: 'twoStroke', maxPowerKw: 10, idleRpm: 1200,
  redlineRpm: 6000, responseTime: .2, thermalLimit: 1, reliabilityClass: 1,
  propEfficiency: .7, propDiameterM: 1,
};

describe('computeEngineRpm', () => {
  it('shows zero when the engine is off or fuel is exhausted', () => {
    expect(computeEngineRpm(engine, false, 8, .6)).toBe(0);
    expect(computeEngineRpm(engine, true, 0, .6)).toBe(0);
  });

  it('uses idle and redline as the live operating range', () => {
    expect(computeEngineRpm(engine, true, 8, 0)).toBe(1200);
    expect(computeEngineRpm(engine, true, 8, 1)).toBe(6000);
    expect(computeEngineRpm(engine, true, 8, .5)).toBe(3600);
  });
});
