// International Standard Atmosphere, troposphere only (0-11 km), spec section 5.
// Altitude is MSL height in metres (world Y). Pure functions, no allocation.

import { GAS_CONSTANT_AIR, GRAVITY, SEA_LEVEL_PRESSURE, SEA_LEVEL_TEMPERATURE } from '../core/constants';

const LAPSE_RATE = 0.0065; // K/m
const TROPOPAUSE_M = 11000;

export interface AtmosphereSample {
  temperatureK: number;
  pressurePa: number;
  densityKgM3: number;
}

export function sampleAtmosphere(altitudeM: number, out: AtmosphereSample): AtmosphereSample {
  const h = Math.min(TROPOPAUSE_M, altitudeM);
  const temperatureK = SEA_LEVEL_TEMPERATURE - LAPSE_RATE * h;
  const pressurePa = SEA_LEVEL_PRESSURE * Math.pow(temperatureK / SEA_LEVEL_TEMPERATURE, GRAVITY / (GAS_CONSTANT_AIR * LAPSE_RATE));
  out.temperatureK = temperatureK;
  out.pressurePa = pressurePa;
  out.densityKgM3 = pressurePa / (GAS_CONSTANT_AIR * temperatureK);
  return out;
}

export function airDensity(altitudeM: number): number {
  return sampleAtmosphere(altitudeM, { temperatureK: 0, pressurePa: 0, densityKgM3: 0 }).densityKgM3;
}

/** q = 1/2 rho V^2 */
export const dynamicPressure = (rho: number, speedMs: number) => 0.5 * rho * speedMs * speedMs;

/** Indicated airspeed from true airspeed: IAS = TAS * sqrt(rho / rho0). */
export const indicatedAirspeed = (tasMs: number, rho: number, rho0 = 1.225) => tasMs * Math.sqrt(rho / rho0);
