// Reward calculation (spec 14.2). Conceptually:
// Reward = missionBase + distanceComponent + landingComponent + objectiveBonuses
//        + skillBonus - catastrophicRepairPenaltyCap
// A bad flight never wipes out all progress: the penalty is capped.

import type { FlightResult, MissionDefinition } from '../core/types';
import type { FlightTelemetry } from '../sim/flightController';

const CRASH_PENALTY_CAP_CASH = 30;

export function computeFlightResult(mission: MissionDefinition | null, telemetry: FlightTelemetry): FlightResult {
  let rewardCash = mission?.rewardBaseCash ?? 20;
  let rewardRp = mission?.rewardBaseRp ?? 3;
  const bonusesAchieved: string[] = [];

  const distanceComponent = Math.min(200, telemetry.distanceM * 0.15);
  rewardCash += distanceComponent;

  if (telemetry.landed) {
    rewardCash += telemetry.landingQuality * 40;
    rewardRp += Math.round(telemetry.landingQuality * 5);
  }

  if (mission) {
    for (const bonus of mission.bonuses) {
      let achieved = false;
      switch (bonus.check) {
        case 'noDamage':
          achieved = !telemetry.crashed;
          break;
        case 'fuelRemaining':
          achieved = telemetry.fuelFraction >= (bonus.value ?? 0.5);
          break;
        case 'landingQuality':
          achieved = telemetry.landed && telemetry.landingQuality >= (bonus.value ?? 0.6);
          break;
        case 'timeUnder':
          achieved = false; // not tracked in this slice
          break;
      }
      if (achieved) {
        rewardCash += bonus.rewardCash;
        rewardRp += bonus.rewardRp;
        bonusesAchieved.push(bonus.id);
      }
    }
  }

  if (telemetry.crashed) {
    rewardCash = Math.max(10, rewardCash * 0.4);
    rewardCash = Math.max(10, rewardCash - CRASH_PENALTY_CAP_CASH * 0);
  }

  return {
    missionId: mission?.id ?? null,
    distanceM: telemetry.distanceM,
    maxAltitudeM: telemetry.maxAltitudeM,
    maxSpeedMs: telemetry.maxSpeedMs,
    crashed: telemetry.crashed,
    landed: telemetry.landed,
    landingQuality: telemetry.landingQuality,
    timeS: 0,
    fuelRemaining: telemetry.fuelFraction,
    rewardCash: Math.round(rewardCash),
    rewardRp: Math.round(rewardRp),
    bonusesAchieved,
  };
}
