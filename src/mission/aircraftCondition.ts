// Persistent, per-component aircraft condition (master spec, Slice 4A: damage/maintenance/repair).
// Replaces the old aggregate operations.condition (flights/landings/hardLandings counters, kept
// as-is for its own stats) with a real per-system model. Everything here is pure data + pure
// functions: React only ever renders what this module computes.

export type ComponentId =
  | 'wingLeft' | 'wingRight' | 'stabHorizontal' | 'stabVertical'
  | 'gearLeft' | 'gearRight' | 'gearNose'
  | 'engine' | 'propeller' | 'fuselage';

/** Fixed for the one aircraft this game currently has (frame_zero). Exposed as a function of
 * nothing in particular today, but keyed so a future multi-airframe AircraftDefinition can
 * return a different topology (e.g. no tailwheel, twin engines) without touching every caller
 * that just wants "the components of the aircraft I'm flying". */
export function componentTopology(): ComponentId[] {
  return ['wingLeft', 'wingRight', 'stabHorizontal', 'stabVertical', 'gearLeft', 'gearRight', 'gearNose', 'engine', 'propeller', 'fuselage'];
}

export const COMPONENT_LABEL: Record<ComponentId, string> = {
  wingLeft: 'Ala izquierda', wingRight: 'Ala derecha',
  stabHorizontal: 'Estabilizador horizontal', stabVertical: 'Estabilizador vertical',
  gearLeft: 'Tren izquierdo', gearRight: 'Tren derecho', gearNose: 'Tren de morro',
  engine: 'Motor', propeller: 'Hélice', fuselage: 'Fuselaje',
};

export interface ComponentCondition {
  /** 1 = nominal .. 0 = destroyed. The single source of truth: severity, damage-accumulated
   * and repair-required are all derived from this, so they can never drift out of sync. */
  integrity: number;
}

export type AircraftCondition = Record<ComponentId, ComponentCondition>;

export function createAircraftCondition(): AircraftCondition {
  const out = {} as AircraftCondition;
  for (const id of componentTopology()) out[id] = { integrity: 1 };
  return out;
}

// --- Severity (spec item 4: comprehensible states derived from continuous integrity) -------------

export type Severity = 'HEALTHY' | 'WORN' | 'DAMAGED' | 'CRITICAL' | 'INOPERATIVE';

/** Centralized thresholds — the only place band boundaries are defined. Mirrors the shape of
 * sim/damageSystem.ts's INTEGRITY_* constants (one extra band: WORN, for slow normal wear
 * that doesn't yet count as "damaged"). */
export const INTEGRITY_WORN = 0.85;
export const INTEGRITY_DAMAGED = 0.6;
export const INTEGRITY_CRITICAL = 0.3;
export const INTEGRITY_INOPERATIVE = 0.1;

export function severityForIntegrity(integrity: number): Severity {
  if (integrity >= INTEGRITY_WORN) return 'HEALTHY';
  if (integrity >= INTEGRITY_DAMAGED) return 'WORN';
  if (integrity >= INTEGRITY_CRITICAL) return 'DAMAGED';
  if (integrity >= INTEGRITY_INOPERATIVE) return 'CRITICAL';
  return 'INOPERATIVE';
}

export function componentSeverity(c: ComponentCondition): Severity {
  return severityForIntegrity(c.integrity);
}

/** "Daño acumulado" (spec item 1): how much integrity has been lost, 0..1. */
export function damageAccumulated(c: ComponentCondition): number {
  return 1 - c.integrity;
}

export function isCriticalDamage(c: ComponentCondition): boolean {
  const s = componentSeverity(c);
  return s === 'CRITICAL' || s === 'INOPERATIVE';
}

/** A WORN component is still airworthy and not worth bothering the player about; DAMAGED and
 * worse should be flagged for maintenance. */
export function repairRequired(c: ComponentCondition): boolean {
  const s = componentSeverity(c);
  return s === 'DAMAGED' || s === 'CRITICAL' || s === 'INOPERATIVE';
}

// --- Airworthiness (spec item 7) ------------------------------------------------------------------

export type AirworthinessStatus = 'AIRWORTHY' | 'RESTRICTED' | 'GROUNDED';

export interface AirworthinessReason {
  componentId: ComponentId;
  severity: Severity;
}

export interface Airworthiness {
  status: AirworthinessStatus;
  reasons: AirworthinessReason[];
}

/** Every component here is flight-critical enough that INOPERATIVE grounds the aircraft.
 * (fuselage stands in for the structure-wide "operational limits" the spec asks for: a badly
 * cracked airframe is not safe to fly regardless of what else works.) */
export function evaluateAirworthiness(condition: AircraftCondition): Airworthiness {
  const reasons: AirworthinessReason[] = [];
  let worst: AirworthinessStatus = 'AIRWORTHY';
  for (const id of componentTopology()) {
    const severity = componentSeverity(condition[id]);
    if (severity === 'INOPERATIVE') {
      reasons.push({ componentId: id, severity });
      worst = 'GROUNDED';
    } else if (severity === 'CRITICAL' && worst !== 'GROUNDED') {
      reasons.push({ componentId: id, severity });
      worst = 'RESTRICTED';
    }
  }
  return { status: worst, reasons };
}
