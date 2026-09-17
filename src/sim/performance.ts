// Analytic performance estimate for a resolved aircraft (Builder/Briefing readouts and
// mission readiness). Uses the same flight-model spec as FlightController so the numbers
// shown in the workshop match what the player feels in the air.

import type { ResolvedAircraft } from '../content/assembly';

export interface AircraftPerformance {
  stallSpeedKmh: number;
  cruiseSpeedKmh: number;
  topSpeedKmh: number;
  /** Ground roll to liftoff on grass at full throttle, meters. */
  takeoffRollM: number;
  /** Best climb rate at full throttle, m/s. */
  climbRateMs: number;
  /** Still-air range at cruise throttle with a full tank, km. */
  rangeKm: number;
  /** Endurance at cruise throttle with a full tank, minutes. */
  enduranceMin: number;
  /** Max survivable touchdown sink rate, m/s. */
  gearToleranceMs: number;
}

export function estimatePerformance(aircraft: ResolvedAircraft): AircraftPerformance {
  // ponytail: placeholder until the flight model v2 lands; replaced by real derivation.
  const power = aircraft.engine?.maxPowerKw ?? 0;
  return {
    stallSpeedKmh: 43,
    cruiseSpeedKmh: 85,
    topSpeedKmh: 100 + power,
    takeoffRollM: 60,
    climbRateMs: 3,
    rangeKm: aircraft.fuelCapacityL * 0.5,
    enduranceMin: aircraft.fuelCapacityL * 0.4,
    gearToleranceMs: 3.5,
  };
}
