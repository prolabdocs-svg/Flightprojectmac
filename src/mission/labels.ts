// Player-facing wording for domain enums (Spanish, like the rest of the UI). Kept next to the domain so
// every screen says the same thing about the same state; screens never re-derive these.

import { getArchetype } from './archetypes';
import type { Blocker, MissionPlan, UtilizationKey } from './planning';
import type { ArchetypeId, ContractState, Difficulty, FlightPhase, Reachability } from './types';

export const DIFFICULTY_LABEL: Record<Difficulty, string> = {
  TRIVIAL: 'Trivial', COMFORTABLE: 'Cómodo', CHALLENGING: 'Exigente', MARGINAL: 'Justo', IMPOSSIBLE: 'Imposible',
};
export const REACH_LABEL: Record<Reachability, string> = { REACHABLE: 'ALCANZABLE', MARGINAL: 'JUSTO', OUT_OF_RANGE: 'FUERA DE ALCANCE' };
export const LIMITING_LABEL: Record<UtilizationKey, string> = {
  range: 'Autonomía', takeoff: 'Pista de salida', landing: 'Pista de llegada', mass: 'Carga útil (MTOW)', crosswind: 'Viento cruzado',
};
export const PHASE_LABEL: Record<FlightPhase, string> = { TAXI: 'RODAJE', TAKEOFF: 'DESPEGUE', ENROUTE: 'EN RUTA', APPROACH: 'APROXIMACIÓN', LANDED: 'EN TIERRA' };
export const STATE_LABEL: Record<ContractState, string> = {
  AVAILABLE: 'Disponible', ACCEPTED: 'Aceptado', PREPARED: 'Preparado', ACTIVE: 'En vuelo', OBJECTIVE_MET: 'Objetivo cumplido',
  COMPLETED: 'Completado', FAILED: 'Fallido', ABORTED: 'Abortado', RECOVERED: 'Recuperado',
};
export const archetypeLabel = (id: ArchetypeId): string => getArchetype(id).title;

/** Why a configuration is blocked, with the numbers that make it so. */
export function blockerText(b: Blocker, p: MissionPlan): string {
  switch (b) {
    case 'INSUFFICIENT_RANGE': return `Autonomía insuficiente: necesitas ${p.range.requiredKm.toFixed(2)} km y con esta carga rindes ${p.range.usableKm.toFixed(2)} km útiles (reserva incluida).`;
    case 'OVERWEIGHT': return `Sobrepeso: ${p.mass.totalKg.toFixed(0)} kg superan el MTOW de ${p.mass.mtowKg.toFixed(0)} kg.`;
    case 'TAKEOFF_RUNWAY_TOO_SHORT': return `Pista de salida corta: el despegue pide ${(p.takeoff.rollM * 1.15).toFixed(0)} m y hay ${p.takeoff.runwayM} m.`;
    case 'LANDING_RUNWAY_TOO_SHORT': return `Pista de llegada corta: el aterrizaje pide ${(p.landing.rollM * 1.15).toFixed(0)} m y hay ${p.landing.runwayM} m.`;
    case 'CANNOT_CLIMB': return `Con esta masa el avión sube solo ${p.takeoff.climbMs.toFixed(1)} m/s: no puede ganar altura con seguridad.`;
    case 'CRUISE_NOT_HOLDABLE': return 'Con esta masa el motor no sostiene el vuelo nivelado.';
    case 'CROSSWIND_LIMIT': return `Viento cruzado de ${p.wind.crosswindMs.toFixed(1)} m/s por encima del límite del avión.`;
    case 'FUEL_OVER_CAPACITY': return `El tanque solo admite ${p.fuel.capacityL} L.`;
    case 'FUEL_NOT_AVAILABLE': return 'La pista de salida no vende combustible: solo puedes llevar lo que ya tienes a bordo.';
    case 'PAYLOAD_OUT_OF_BOUNDS': return 'La carga está fuera de lo que admite el contrato.';
    case 'AIRCRAFT_GROUNDED': return 'El avión está en tierra: hay un componente inoperativo que necesita reparación antes de volar.';
  }
}

export const CRASH_REASON_LABEL: Record<string, string> = {
  terrain: 'impacto con el terreno', obstacle: 'obstáculo', hardLanding: 'aterrizaje demasiado duro', flipped: 'vuelco', water: 'agua', wingStrike: 'ala contra el suelo',
};
