import { describe, expect, it } from 'vitest';
import { getDensityLevel, getDensityBudget, DENSITY_BUDGETS, type DensityAnchor } from './densitySystem';

const anchor: DensityAnchor = { x: 0, z: 0, coreRadiusM: 100, falloffM: 200, level: 5 };

describe('densitySystem', () => {
  it('is deterministic for the same region/point', () => {
    const input = { regionId: 'the_field', terrain: 'meadow' as const, x: 340, z: -120, anchors: [anchor] };
    expect(getDensityLevel(input)).toBe(getDensityLevel(input));
  });

  it('returns the anchor level inside its core radius', () => {
    const level = getDensityLevel({ regionId: 'r', terrain: 'industrial', x: 10, z: 0, anchors: [anchor] });
    expect(level).toBe(5);
  });

  it('decays toward the regional baseline beyond core+falloff', () => {
    const near = getDensityLevel({ regionId: 'r', terrain: 'desert', x: 90, z: 0, anchors: [anchor] });
    const far = getDensityLevel({ regionId: 'r', terrain: 'desert', x: 5000, z: 5000, anchors: [anchor] });
    expect(near).toBeGreaterThan(far);
    expect(far).toBeLessThanOrEqual(1); // desert baseline is D0
  });

  it('clamps to D0-D5 regardless of anchor level input', () => {
    const hot: DensityAnchor = { x: 0, z: 0, coreRadiusM: 50, falloffM: 50, level: 5 };
    const level = getDensityLevel({ regionId: 'r', terrain: 'industrial', x: 0, z: 0, anchors: [hot] });
    expect(level).toBeGreaterThanOrEqual(0);
    expect(level).toBeLessThanOrEqual(5);
  });

  it('never returns a negative level far from anchors in a wilderness terrain', () => {
    const level = getDensityLevel({ regionId: 'r', terrain: 'canyon', x: 1e6, z: 1e6, anchors: [] });
    expect(level).toBeGreaterThanOrEqual(0);
  });

  it('every density level has a defined budget with non-negative fields', () => {
    for (let l = 0; l <= 5; l++) {
      const budget = getDensityBudget(l as 0 | 1 | 2 | 3 | 4 | 5);
      expect(DENSITY_BUDGETS[l as 0 | 1 | 2 | 3 | 4 | 5]).toBe(budget);
      expect(budget.vegetationInstances).toBeGreaterThanOrEqual(0);
      expect(budget.buildingLots).toBeGreaterThanOrEqual(0);
      expect(budget.props).toBeGreaterThanOrEqual(0);
      expect(budget.ambientTrafficSlots).toBeGreaterThanOrEqual(0);
    }
  });

  it('vegetation budget generally decreases as settlement density increases', () => {
    expect(DENSITY_BUDGETS[0].vegetationInstances).toBeGreaterThan(DENSITY_BUDGETS[5].vegetationInstances);
  });
});
