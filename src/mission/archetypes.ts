// Contract archetypes as data (master spec 6-7). Adding an archetype = adding a row; the generator,
// planner and settlement contain no archetype-specific branches.

import type { ArchetypeId } from './types';

export interface ArchetypeDef {
  id: ArchetypeId;
  title: string;
  payload: { kind: 'none' } | { kind: 'cargo'; usefulLoadFraction: [number, number]; minShare: number } | { kind: 'passengers'; count: number; kgEach: number };
  flatCash: number;
  ratePerKm: number;
  /** Cash per kg of payload per km flown. */
  ratePerKgKm: number;
  revenueMultiplier: number;
  /** Time limit = slack x (route / cruise speed) + grace. */
  timeLimit?: { slack: number; graceS: number; latePenaltyShare: number };
  reputationRequired: number;
  onlyUnvisitedDestination?: boolean;
  discoveryBonusCash: number;
}

export const ARCHETYPES: ArchetypeDef[] = [
  { id: 'ferry', title: 'Traslado', payload: { kind: 'none' }, flatCash: 20, ratePerKm: 30, ratePerKgKm: 0, revenueMultiplier: 1, reputationRequired: 0, discoveryBonusCash: 0 },
  { id: 'cargo', title: 'Carga', payload: { kind: 'cargo', usefulLoadFraction: [0.4, 0.8], minShare: 0.5 }, flatCash: 25, ratePerKm: 35, ratePerKgKm: 1.2, revenueMultiplier: 1, reputationRequired: 0, discoveryBonusCash: 0 },
  { id: 'passenger', title: 'Pasajero', payload: { kind: 'passengers', count: 1, kgEach: 75 }, flatCash: 30, ratePerKm: 45, ratePerKgKm: 0.6, revenueMultiplier: 1, reputationRequired: 0, discoveryBonusCash: 0 },
  { id: 'urgent', title: 'Urgente', payload: { kind: 'cargo', usefulLoadFraction: [0.25, 0.45], minShare: 1 }, flatCash: 25, ratePerKm: 35, ratePerKgKm: 1.2, revenueMultiplier: 1.6, timeLimit: { slack: 1.5, graceS: 90, latePenaltyShare: 0.3 }, reputationRequired: 0, discoveryBonusCash: 0 },
  { id: 'exploration', title: 'Exploración', payload: { kind: 'none' }, flatCash: 15, ratePerKm: 25, ratePerKgKm: 0, revenueMultiplier: 1, reputationRequired: 0, onlyUnvisitedDestination: true, discoveryBonusCash: 40 },
];

export const getArchetype = (id: ArchetypeId): ArchetypeDef => {
  const a = ARCHETYPES.find((x) => x.id === id);
  if (!a) throw new Error(`unknown archetype ${id}`);
  return a;
};

/** Gross contract revenue for a given payload actually loaded (partial cargo pays proportionally). */
export function contractRevenueCash(a: ArchetypeDef, distanceM: number, payloadKg: number): number {
  const km = distanceM / 1000;
  return Math.round((a.flatCash + a.ratePerKm * km + a.ratePerKgKm * payloadKg * km) * a.revenueMultiplier);
}
