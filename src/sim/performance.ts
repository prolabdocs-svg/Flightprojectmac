// Analytic performance estimate for a resolved aircraft (Builder/Briefing readouts and
// mission readiness). Uses the same flight-model spec and force functions as
// FlightController so the workshop numbers match what the player feels in the air.

import type { ResolvedAircraft } from '../content/assembly';
import { GRAVITY, SEA_LEVEL_RHO, deriveFlightModel, dragCoefficient, liftCoefficient, stallSpeed, thrustAt, type FlightModelSpec } from './flightModel';
import { GROUND_SURFACES } from '../world/surfaces';

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

export const CRUISE_THROTTLE = 0.65;

/** Net level-flight force (thrust - drag, N) at airspeed v, or null below stall. */
function levelExcess(spec: FlightModelSpec, v: number, throttle: number): number | null {
  const q = 0.5 * SEA_LEVEL_RHO * v * v;
  const weight = spec.massKg * GRAVITY;
  const cl = weight / (q * spec.wingAreaM2);
  if (cl > spec.clMax) return null;
  // Invert the linear lift curve to get the AoA this CL needs (for the drag model).
  const alpha = (cl - spec.cl0) / spec.clAlpha;
  const drag = q * spec.wingAreaM2 * dragCoefficient(spec, alpha, cl, false);
  return thrustAt(spec, throttle, v, 1) - drag;
}

export function estimatePerformance(aircraft: ResolvedAircraft): AircraftPerformance {
  const spec = deriveFlightModel(aircraft);
  const vs = stallSpeed(spec, false);
  const weight = spec.massKg * GRAVITY;

  let top = vs;
  let bestClimb = 0;
  let cruise = vs * 1.3;
  for (let v = vs * 1.05; v < 70; v += 0.25) {
    const full = levelExcess(spec, v, 1);
    if (full === null) continue;
    if (full > 0) top = v;
    bestClimb = Math.max(bestClimb, (full * v) / weight);
    const part = levelExcess(spec, v, CRUISE_THROTTLE);
    if (part !== null && part > 0) cruise = v;
  }

  // Takeoff roll: integrate the ground run on grass until 1.1 Vs.
  const mu = GROUND_SURFACES.grass.rollingResistance * 0.45 * spec.gear.rollingResistanceMul;
  const groundCl = liftCoefficient(spec, 0.026, false);
  let v = 0;
  let x = 0;
  const dt = 0.05;
  while (v < vs * 1.1 && x < 2000) {
    const q = 0.5 * SEA_LEVEL_RHO * v * v;
    const lift = q * spec.wingAreaM2 * groundCl;
    const drag = q * spec.wingAreaM2 * dragCoefficient(spec, 0.026, groundCl, false, 0.5);
    const a = (thrustAt(spec, 1, v, 1) - drag - mu * Math.max(0, weight - lift)) / spec.massKg;
    if (a <= 0) break;
    v += a * dt;
    x += v * dt;
  }

  const burnLpm = spec.fuelBurnLpm * (0.12 + 0.88 * CRUISE_THROTTLE);
  const enduranceMin = burnLpm > 0 ? spec.fuelCapacityL / burnLpm : 0;
  return {
    stallSpeedKmh: vs * 3.6,
    cruiseSpeedKmh: cruise * 3.6,
    topSpeedKmh: top * 3.6,
    // +25% covers rotation and the climb out of ground effect seen in the sim.
    takeoffRollM: v >= vs * 1.1 ? x * 1.25 : Infinity,
    climbRateMs: bestClimb,
    rangeKm: (cruise * enduranceMin * 60) / 1000,
    enduranceMin,
    gearToleranceMs: spec.gear.toleranceMs,
  };
}
