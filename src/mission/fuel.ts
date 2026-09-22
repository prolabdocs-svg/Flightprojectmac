// One consistent fuel representation: litres are the truth (capacity, loaded, burned); mass, cost and
// the legacy 0..1 `fuelRemaining` fraction (FlightTelemetry, FlightResult) are all derived here.

import type { AircraftBuild } from '../core/types';
import { resolveAircraft } from '../content/assembly';
import { FUEL_COST_PER_LITER_CASH } from '../content/economy';
import { FUEL_DENSITY_KG_L } from '../flight/aircraft/quicksilver';

export const fuelMassKg = (litres: number): number => Math.max(0, litres) * FUEL_DENSITY_KG_L;
export const fuelCostCash = (litres: number): number => Math.max(0, litres) * FUEL_COST_PER_LITER_CASH;

export const tankCapacityL = (build: AircraftBuild): number => resolveAircraft(build).fuelCapacityL;

export const clampFuelL = (litres: number, capacityL: number): number => Math.min(capacityL, Math.max(0, litres));

/** Litres -> legacy fraction (what FlightTelemetry.fuelFraction / FlightResult.fuelRemaining carry). */
export const fuelFraction = (litres: number, capacityL: number): number => (capacityL > 0 ? clampFuelL(litres, capacityL) / capacityL : 0);
/** Legacy fraction -> litres. */
export const fuelLitres = (fraction: number, capacityL: number): number => Math.min(1, Math.max(0, fraction)) * capacityL;
