// Structural damage / detachment system (spec sections 10, 142: "Damage System").
// Deliberately kept as a small, pure, standalone module so it can be dropped into
// FlightController without touching its core integration loop: FlightController just
// calls createDamageState()/applyGroundImpact()/getAeroEffectivenessMultiplier() and
// stores the returned state, exactly like it already treats aero.ts as a pure helper.
//
// Simplified vs the full spec: real DamageableModule tracks structural01/functional01/
// thermal01/attachment01/failureFlags per module and a Rapier contact-impulse pipeline
// (spec 142.1/142.2). Here a single scalar "integrity" per aero surface + one for the
// landing gear stands in for structural01, driven directly by touchdown/impact vertical
// speed (a proxy for impact energy) rather than per-contact impulses. Good enough for the
// vertical slice's "wing/gear/tail take damage and can detach" requirement without a full
// contact-classification pipeline.

/** Spec 10.3 thresholds, expressed as integrity (1 = nominal .. 0 = destroyed). */
export const INTEGRITY_DAMAGED = 0.7; // 69-40% band starts here (below "nominal")
export const INTEGRITY_CRITICAL = 0.4; // 39-15% band starts here
export const INTEGRITY_FAILED = 0.15; // <15% -> failed/detachable

/** Impact-velocity (m/s, vertical) tuning. Mirrors FlightController's existing hard-crash
 * threshold (-8 m/s) so "totalLoss" lines up with the pre-existing `crashed` flag instead
 * of introducing a second, conflicting notion of what counts as a crash. */
export const IMPACT_SAFE_MS = 3; // below this: normal touchdown, no stress at all
export const IMPACT_HARD_MS = 8; // matches FlightController's existing crash threshold
export const IMPACT_CATASTROPHIC_MS = 14; // well past a survivable hard landing

export type PartRole = 'wing' | 'tail' | 'gear';

export interface PartDamageState {
  role: PartRole;
  integrity: number; // 1 = nominal .. 0 = destroyed
  detached: boolean;
}

export type CrashOutcome = 'none' | 'hardLanding' | 'totalLoss';

export interface DamageState {
  parts: Record<string, PartDamageState>;
  /** Worst outcome recorded so far this flight (edge-triggered highest-severity impact). */
  outcome: CrashOutcome;
}

/** Exported so other pure modules (e.g. economy.ts's repair-cost calculation) can map a
 * damaged/detached telemetry id back to the same wing/tail/gear role this module uses,
 * without duplicating the classification rule. */
export function roleForSurfaceId(surfaceId: string): PartRole {
  if (surfaceId === 'elevator' || surfaceId === 'rudder' || surfaceId.startsWith('tail')) return 'tail';
  return 'wing'; // wing_root_main, aileron_l/r, and any installed wing surface id
}

const GEAR_ID = '__gear__';

/** Builds a fresh, fully-nominal damage state for the given aircraft aero surface ids. */
export function createDamageState(aeroSurfaceIds: string[]): DamageState {
  const parts: Record<string, PartDamageState> = {};
  for (const id of aeroSurfaceIds) {
    parts[id] = { role: roleForSurfaceId(id), integrity: 1, detached: false };
  }
  parts[GEAR_ID] = { role: 'gear', integrity: 1, detached: false };
  return { parts, outcome: 'none' };
}

export function gearPartId(): string {
  return GEAR_ID;
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

/** Fraction of the impact-severity range covered by a given vertical impact speed. */
export function impactStressFraction(impactSpeedMs: number): number {
  const speed = Math.abs(impactSpeedMs);
  if (speed <= IMPACT_SAFE_MS) return 0;
  return clamp01((speed - IMPACT_SAFE_MS) / (IMPACT_CATASTROPHIC_MS - IMPACT_SAFE_MS));
}

function outcomeForImpact(impactSpeedMs: number): CrashOutcome {
  const speed = Math.abs(impactSpeedMs);
  if (speed >= IMPACT_HARD_MS) return 'totalLoss';
  if (speed > IMPACT_SAFE_MS) return 'hardLanding';
  return 'none';
}

const OUTCOME_SEVERITY: Record<CrashOutcome, number> = { none: 0, hardLanding: 1, totalLoss: 2 };

/**
 * Applies one ground-contact/impact event (pure — returns a new state). `impactSpeedMs`
 * is the vertical speed at the moment of contact (proxy for impact energy, spec 142.2's
 * "estimate severity from impulse proxy"). Gear absorbs more of a hard touchdown than the
 * airframe; a genuinely catastrophic impact stresses everything roughly evenly.
 */
export function applyGroundImpact(state: DamageState, impactSpeedMs: number): DamageState {
  const stress = impactStressFraction(impactSpeedMs);
  const impactOutcome = outcomeForImpact(impactSpeedMs);
  const outcome =
    OUTCOME_SEVERITY[impactOutcome] > OUTCOME_SEVERITY[state.outcome] ? impactOutcome : state.outcome;
  if (stress <= 0) {
    return outcome === state.outcome ? state : { ...state, outcome };
  }

  const parts: Record<string, PartDamageState> = {};
  for (const [id, part] of Object.entries(state.parts)) {
    if (part.detached) {
      parts[id] = part;
      continue;
    }
    const roleFactor = part.role === 'gear' ? 0.9 : part.role === 'tail' ? 0.35 : 0.5;
    const nextIntegrity = clamp01(part.integrity - stress * roleFactor);
    const detached = part.role !== 'tail' && nextIntegrity <= INTEGRITY_FAILED && stress > 0.4;
    parts[id] = { ...part, integrity: nextIntegrity, detached };
  }

  return { parts, outcome };
}

export type DamageBand = 'nominal' | 'damaged' | 'critical' | 'failed';

export function bandForIntegrity(integrity: number): DamageBand {
  if (integrity >= INTEGRITY_DAMAGED) return 'nominal';
  if (integrity >= INTEGRITY_CRITICAL) return 'damaged';
  if (integrity >= INTEGRITY_FAILED) return 'critical';
  return 'failed';
}

/**
 * Aerodynamic-contribution multiplier for a surface (spec 142.2 "damaged aero" / "wing
 * damage altera fuerzas"): a detached part contributes nothing; a merely damaged one
 * produces degraded lift/drag rather than a binary on/off.
 */
export function getAeroEffectivenessMultiplier(state: DamageState, surfaceId: string): number {
  const part = state.parts[surfaceId];
  if (!part) return 1;
  if (part.detached) return 0;
  switch (bandForIntegrity(part.integrity)) {
    case 'nominal':
      return 1;
    case 'damaged':
      return 0.75;
    case 'critical':
      return 0.45;
    default:
      return 0.15;
  }
}

/** Ground friction/rolling-resistance multiplier driven by gear condition (>1 = worse). */
export function getGroundHandlingPenalty(state: DamageState): number {
  const gear = state.parts[GEAR_ID];
  if (!gear) return 1;
  if (gear.detached) return 3.5; // belly-landing-ish: much higher resistance
  switch (bandForIntegrity(gear.integrity)) {
    case 'nominal':
      return 1;
    case 'damaged':
      return 1.4;
    case 'critical':
      return 2.1;
    default:
      return 3;
  }
}

export function listDamagedPartIds(state: DamageState): string[] {
  return Object.entries(state.parts)
    .filter(([, p]) => !p.detached && bandForIntegrity(p.integrity) !== 'nominal')
    .map(([id]) => id);
}

export function listDetachedPartIds(state: DamageState): string[] {
  return Object.entries(state.parts)
    .filter(([, p]) => p.detached)
    .map(([id]) => id);
}
