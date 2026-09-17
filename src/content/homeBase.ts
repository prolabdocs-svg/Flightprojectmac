import type { HomeBaseState } from '../core/types';

export const MAX_HOME_BASE_LEVEL = 3;

export interface HomeBaseBenefits {
  /** Reduction applied to damage repair, not fuel, in the results economy. */
  repairDiscount: number;
  /** Reduction to home-strip roughness for launch/return contracts. */
  runwayRoughnessReduction: number;
}

export function getHomeBaseBenefits(homeBase: HomeBaseState | undefined): HomeBaseBenefits {
  const runwayLevel = Math.min(MAX_HOME_BASE_LEVEL, Math.max(0, homeBase?.runwayLevel ?? 0));
  const hangarLevel = Math.min(MAX_HOME_BASE_LEVEL, Math.max(0, homeBase?.hangarLevel ?? 0));
  return {
    repairDiscount: hangarLevel * 0.12,
    runwayRoughnessReduction: runwayLevel * 0.08,
  };
}
