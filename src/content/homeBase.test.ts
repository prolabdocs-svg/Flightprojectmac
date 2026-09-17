import { describe, expect, it } from 'vitest';
import { getHomeBaseBenefits, MAX_HOME_BASE_LEVEL } from './homeBase';

describe('home base benefits', () => {
  it('has no bonus at level zero', () => {
    expect(getHomeBaseBenefits({ runwayLevel: 0, hangarLevel: 0 })).toEqual({ repairDiscount: 0, runwayRoughnessReduction: 0 });
  });

  it('scales runway and hangar benefits independently', () => {
    expect(getHomeBaseBenefits({ runwayLevel: 2, hangarLevel: 1 })).toEqual({ repairDiscount: .12, runwayRoughnessReduction: .16 });
  });

  it('caps malformed or over-level saves to the supported maximum', () => {
    const benefits = getHomeBaseBenefits({ runwayLevel: 99, hangarLevel: -2 });
    expect(benefits.runwayRoughnessReduction).toBe(MAX_HOME_BASE_LEVEL * .08);
    expect(benefits.repairDiscount).toBe(0);
  });
});
