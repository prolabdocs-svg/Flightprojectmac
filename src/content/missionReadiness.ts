// Aircraft capability gate (spec 12.1: "destinos limitados por capacidad"). Pure and kept
// separate from campaign/region unlock ordering (missions.ts#isMissionAvailableToProfile)
// so callers can tell "not yet unlocked" apart from "unlocked but this build can't finish it".

import type { AircraftBuild, MissionDefinition } from '../core/types';
import { resolveAircraft } from './assembly';
import { estimatePerformance } from '../sim/performance';

export interface MissionReadiness {
  ready: boolean;
  /** Empty when ready. Human-readable current-vs-required lines for the briefing/map. */
  shortfalls: string[];
}

const READY: MissionReadiness = { ready: true, shortfalls: [] };

/** Evaluates `build` against `mission.aircraftRequirement` using the same analytic
 * performance model the Builder/Briefing readouts use, so the gate never disagrees with
 * what the player sees elsewhere. Missions without a requirement are always ready. */
export function evaluateMissionReadiness(mission: MissionDefinition, build: AircraftBuild): MissionReadiness {
  const requirement = mission.aircraftRequirement;
  if (!requirement) return READY;
  const perf = estimatePerformance(resolveAircraft(build));
  const shortfalls: string[] = [];
  if (requirement.minRangeKm !== undefined && perf.rangeKm < requirement.minRangeKm) {
    shortfalls.push(`Autonomía ${perf.rangeKm.toFixed(1)} km · necesitas ${requirement.minRangeKm} km`);
  }
  if (requirement.maxTakeoffRollM !== undefined && perf.takeoffRollM > requirement.maxTakeoffRollM) {
    shortfalls.push(`Despegue ${perf.takeoffRollM.toFixed(0)} m · necesitas ${requirement.maxTakeoffRollM} m o menos`);
  }
  if (requirement.minGearToleranceMs !== undefined && perf.gearToleranceMs < requirement.minGearToleranceMs) {
    shortfalls.push(`Tren tolera ${perf.gearToleranceMs.toFixed(1)} m/s · necesitas ${requirement.minGearToleranceMs} m/s`);
  }
  return { ready: shortfalls.length === 0, shortfalls };
}
