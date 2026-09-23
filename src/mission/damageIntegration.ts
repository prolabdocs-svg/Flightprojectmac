// Sim -> persistence bridge (spec item 2). sim/damageSystem.ts stays the sole authority for what
// happened physically during a flight; this module's only job is mapping its per-surface output
// (aero surface ids + one gear scalar) onto the persistent per-component model, and adding the
// small amount of wear/engine/propeller/fuselage degradation the sim doesn't itself track.

import type { FlightTelemetry } from '../flight/flightTypes';
import { gearPartId } from '../sim/damageSystem';
import { severityForIntegrity, type AircraftCondition, type ComponentId } from './aircraftCondition';

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

/** aileron_l/aileron_r/tail_l/tail_r etc -> left/right; anything else (wing_root_main, elevator,
 * rudder) is shared structure and affects both sides. */
function side(surfaceId: string): 'left' | 'right' | 'both' {
  if (surfaceId.endsWith('_l')) return 'left';
  if (surfaceId.endsWith('_r')) return 'right';
  return 'both';
}

function isTailSurface(surfaceId: string): boolean {
  return surfaceId === 'elevator' || surfaceId === 'rudder' || surfaceId.startsWith('tail');
}

/**
 * Folds one flight's telemetry into the persistent condition that was carried into it.
 * `telemetry.partIntegrity` (seeded from that same persistent condition, see
 * flightModel.ts#seededDamageState) is the sim's own final integrity per surface, so wing/tail/
 * gear components are a direct assignment, not an additive stack — the sim already includes
 * whatever came in. Engine/propeller/fuselage aren't modeled per-surface by the sim at all
 * (ponytail: no contact-classification pipeline for the powertrain yet), so they take a small
 * proxy hit from crash severity instead — upgrade path: give Propulsion/the airframe their own
 * DamageableModule entries once the sim grows one.
 */
export function applyFlightDamage(prev: AircraftCondition, telemetry: FlightTelemetry): AircraftCondition {
  const next: AircraftCondition = { ...prev };
  const integrity = telemetry.partIntegrity;
  if (integrity) {
    const wingMins: Record<'left' | 'right', number> = { left: 1, right: 1 };
    let stabH = 1;
    let stabV = 1;
    for (const [id, value] of Object.entries(integrity)) {
      if (id === gearPartId()) continue;
      if (id === 'elevator') { stabH = Math.min(stabH, value); continue; }
      if (id === 'rudder') { stabV = Math.min(stabV, value); continue; }
      if (isTailSurface(id)) continue; // unknown tail id: no side info, skip rather than guess
      const s = side(id);
      if (s === 'both') { wingMins.left = Math.min(wingMins.left, value); wingMins.right = Math.min(wingMins.right, value); }
      else wingMins[s] = Math.min(wingMins[s], value);
    }
    next.wingLeft = { integrity: wingMins.left };
    next.wingRight = { integrity: wingMins.right };
    next.stabHorizontal = { integrity: stabH };
    next.stabVertical = { integrity: stabV };
    const gear = integrity[gearPartId()] ?? 1;
    next.gearLeft = { integrity: gear };
    next.gearRight = { integrity: gear };
    next.gearNose = { integrity: gear };
  }

  // Powertrain/airframe proxy: a hard landing stresses the engine/prop (possible prop strike);
  // a total loss wrecks them along with the fuselage. Flat, not stacked with existing damage
  // beyond taking the worse of the two — repeated hard landings still erode it via normal wear.
  const impactHit: Partial<Record<ComponentId, number>> =
    telemetry.crashOutcome === 'totalLoss' ? { engine: 0.92, propeller: 0.95, fuselage: 0.85 }
    : telemetry.crashOutcome === 'hardLanding' ? { engine: 0.12, propeller: 0.18, fuselage: 0.08 }
    : {};
  for (const [id, drop] of Object.entries(impactHit) as [ComponentId, number][]) {
    next[id] = { integrity: clamp01(Math.min(next[id].integrity, prev[id].integrity - drop)) };
  }

  return next;
}

/** The inverse of applyFlightDamage's mapping: seeds a new flight's sim DamageState from what
 * persisted (spec item 3 — "the aircraft stops silently resetting to perfect condition"). */
export function conditionToPartIntegrity(condition: AircraftCondition, aeroSurfaceIds: string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const id of aeroSurfaceIds) {
    if (id === 'elevator') { out[id] = condition.stabHorizontal.integrity; continue; }
    if (id === 'rudder') { out[id] = condition.stabVertical.integrity; continue; }
    if (isTailSurface(id)) { out[id] = Math.min(condition.stabHorizontal.integrity, condition.stabVertical.integrity); continue; }
    const s = side(id);
    out[id] = s === 'left' ? condition.wingLeft.integrity : s === 'right' ? condition.wingRight.integrity : Math.min(condition.wingLeft.integrity, condition.wingRight.integrity);
  }
  out[gearPartId()] = Math.min(condition.gearLeft.integrity, condition.gearRight.integrity, condition.gearNose.integrity);
  return out;
}

/** Combined engine+propeller output multiplier (see AircraftSimulation#powerMultiplier / the
 * ponytail note on Propulsion.step for why this is one multiplier rather than two physical
 * quantities). Same band steps as sim/damageSystem.ts#getAeroEffectivenessMultiplier, plus a
 * gentle WORN step so ordinary wear is felt before it crosses into DAMAGED. */
function bandMultiplier(integrity: number): number {
  switch (severityForIntegrity(integrity)) {
    case 'HEALTHY': return 1;
    case 'WORN': return 0.92;
    case 'DAMAGED': return 0.7;
    case 'CRITICAL': return 0.4;
    default: return 0.15;
  }
}

export function conditionToPowerMultiplier(condition: AircraftCondition): number {
  return bandMultiplier(condition.engine.integrity) * bandMultiplier(condition.propeller.integrity);
}
