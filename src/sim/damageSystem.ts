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

export type PartRole = 'wing' | 'tail' | 'gear' | 'powertrain' | 'airframe';

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
  /** Airframe-specific structure (AircraftDefinition.damage); absent = generic ultralight tuning. */
  structure?: DamageStructure;
}

/** How one airframe takes damage, on top of the generic component tuning below. `strengthScale`
 * multiplies a component's elastic limit and strength (a strut-braced tube wing outlasts a cantilever
 * fabric one); `zoneLoad` replaces a contact zone's load shares (on an above-wing pusher a nose strike
 * cannot reach the propeller, but flipping over lands on it). */
export interface DamageStructure {
  strengthScale?: Partial<Record<string, number>>;
  zoneLoad?: Partial<Record<string, Record<string, number>>>;
}

/** Exported so other pure modules (e.g. economy.ts's repair-cost calculation) can map a
 * damaged/detached telemetry id back to the same wing/tail/gear role this module uses,
 * without duplicating the classification rule. */
export function roleForSurfaceId(surfaceId: string): PartRole {
  if (surfaceId === GEAR_ID) return 'gear';
  if (surfaceId === 'engine' || surfaceId === 'propeller') return 'powertrain';
  if (surfaceId === 'fuselage' || surfaceId === 'nose') return 'airframe';
  if (surfaceId === 'elevator' || surfaceId === 'rudder' || surfaceId.startsWith('tail')) return 'tail';
  return 'wing'; // wing_root_main, aileron_l/r, and any installed wing surface id
}

const GEAR_ID = '__gear__';

// --- V2: energy-based, per-component impact model ------------------------------------------

/** Every airframe always carries these, independent of which aero surfaces content installs.
 * wing_l/wing_r are the per-side main wing panels (aero elements' damageId), so a wingtip
 * strike produces asymmetric lift instead of degrading one shared wing scalar. */
export const COMPONENT_IDS = [
  'wing_l', 'wing_r', 'aileron_l', 'aileron_r', 'elevator', 'rudder', 'tail',
  GEAR_ID, 'nose', 'engine', 'propeller', 'fuselage',
] as const;

/** Per component: e0 = energy (J) absorbed elastically with no damage; strength = further J
 * to go from intact to destroyed. Tuned for ~250-450 kg ultralights. */
const STRENGTH: Record<string, { e0: number; strength: number; detachable: boolean }> = {
  wing_l: { e0: 300, strength: 5000, detachable: true },
  wing_r: { e0: 300, strength: 5000, detachable: true },
  aileron_l: { e0: 150, strength: 1500, detachable: true },
  aileron_r: { e0: 150, strength: 1500, detachable: true },
  elevator: { e0: 200, strength: 2000, detachable: true },
  rudder: { e0: 200, strength: 2000, detachable: true },
  tail: { e0: 400, strength: 4000, detachable: true },
  [GEAR_ID]: { e0: 1800, strength: 6000, detachable: true },
  nose: { e0: 800, strength: 6000, detachable: false },
  engine: { e0: 1500, strength: 12000, detachable: false },
  propeller: { e0: 200, strength: 3500, detachable: true },
  fuselage: { e0: 2500, strength: 9000, detachable: false },
};
const DEFAULT_STRENGTH = { e0: 300, strength: 4000, detachable: true };

/** Contact zone (structural hard point / 'gear') -> share of impact energy each component
 * absorbs. Shares are concentration factors, not a partition (a nose strike loads the prop,
 * the engine mount and the nose structure at once). */
const ZONE_LOAD: Record<string, Record<string, number>> = {
  gear: { [GEAR_ID]: 0.8, fuselage: 0.1, wing_l: 0.04, wing_r: 0.04 },
  wingtipL: { wing_l: 0.7, aileron_l: 0.5, fuselage: 0.08 },
  wingtipR: { wing_r: 0.7, aileron_r: 0.5, fuselage: 0.08 },
  nose: { nose: 0.6, propeller: 1, engine: 0.4, fuselage: 0.35, [GEAR_ID]: 0.3 },
  bellyFront: { fuselage: 0.4, [GEAR_ID]: 0.5, propeller: 0.6, nose: 0.3 },
  bellyRear: { fuselage: 0.4, tail: 0.3 },
  tail: { tail: 0.6, elevator: 0.6, rudder: 0.5, fuselage: 0.1 },
  canopy: { fuselage: 0.8, rudder: 0.6, wing_l: 0.3, wing_r: 0.3 },
};

/** Impact energy for a contact: full normal kinetic energy plus a small share of the
 * tangential (a glancing scrape transfers far less than a head-on hit). */
export function impactEnergyJ(massKg: number, normalMs: number, tangentMs: number): number {
  return 0.5 * massKg * (normalMs * normalMs + 0.12 * tangentMs * tangentMs);
}

/**
 * V2 impact (pure). `elastic` = subtract each component's e0 first (discrete hits); pass false
 * for continuous scraping where energyJ is already a small per-tick friction work. A part only
 * detaches when this single hit took a large bite AND left it failed — small repeated knocks
 * wear a part down but never snap it off.
 */
export function applyImpact(state: DamageState, zone: string, energyJ: number, elastic = true): DamageState {
  const load = state.structure?.zoneLoad?.[zone] ?? ZONE_LOAD[zone] ?? ZONE_LOAD.bellyFront;
  let changed = false;
  let hurt = false;
  const parts = { ...state.parts };
  // Energy the gear can't absorb (a leg that bottoms out and collapses) is passed on
  // to the primary structure; a wing or prop that breaks off sheds its energy instead.
  let overflow = 0;
  const entries = Object.entries(load).sort(([a], [b]) => Number(a === 'fuselage') - Number(b === 'fuselage'));
  for (const [id, share] of entries) {
    const part = parts[id];
    if (!part || part.detached) continue;
    const k = scaledStrength(id, state.structure);
    const absorbed = energyJ * share;
    if (id === GEAR_ID && elastic) overflow += Math.max(0, absorbed - k.e0 - part.integrity * k.strength) * 0.5;
    const loss = Math.max(0, absorbed + (id === 'fuselage' ? overflow : 0) - (elastic ? k.e0 : 0)) / k.strength;
    if (loss <= 0) continue;
    const integrity = clamp01(part.integrity - loss);
    const detached = k.detachable && integrity <= INTEGRITY_FAILED && loss >= 0.3;
    parts[id] = { ...part, integrity, detached };
    changed = true;
    hurt ||= loss > 0.02;
  }
  if (!changed) return state;
  const outcome = hurt && state.outcome === 'none' ? 'hardLanding' : state.outcome;
  return { ...state, parts, outcome };
}

function scaledStrength(id: string, structure: DamageStructure | undefined) {
  const k = STRENGTH[id] ?? DEFAULT_STRENGTH;
  const scale = structure?.strengthScale?.[id] ?? 1;
  return scale === 1 ? k : { e0: k.e0 * scale, strength: k.strength * scale, detachable: k.detachable };
}

export type ComponentState = 'HEALTHY' | 'DAMAGED' | 'CRITICAL' | 'DETACHED';

export function componentState(state: DamageState, id: string): ComponentState {
  const part = state.parts[id];
  if (!part) return 'HEALTHY';
  if (part.detached) return 'DETACHED';
  const band = bandForIntegrity(part.integrity);
  return band === 'nominal' ? 'HEALTHY' : band === 'damaged' ? 'DAMAGED' : 'CRITICAL';
}

/** Structural failure of the cabin/primary structure = the aircraft is no longer flyable. */
export function isAirframeLost(state: DamageState): boolean {
  return (state.parts.fuselage?.integrity ?? 1) <= INTEGRITY_FAILED;
}

function bandFactor(state: DamageState, id: string): number {
  switch (componentState(state, id)) {
    case 'HEALTHY': return 1;
    case 'DAMAGED': return 0.75;
    case 'CRITICAL': return 0.45;
    default: return 0;
  }
}

/** Thrust multiplier from engine + propeller condition. A damaged engine also runs rough:
 * `timeS` drives a deterministic misfire so output is irregular, not just lower. */
export function getPowerMultiplier(state: DamageState, timeS: number): number {
  const prop = bandFactor(state, 'propeller');
  const engineIntegrity = state.parts.engine?.integrity ?? 1;
  const engine = bandFactor(state, 'engine');
  const rough = clamp01((INTEGRITY_DAMAGED - engineIntegrity) / INTEGRITY_DAMAGED);
  const misfire = rough > 0 && Math.sin(timeS * 7.3) * Math.sin(timeS * 2.9) > 0.55 - rough ? 1 - rough * 0.8 : 1;
  return prop * engine * misfire;
}

/** 0..1 airframe vibration, dominated by an unbalanced (damaged, still spinning) prop. */
export function getVibration(state: DamageState): number {
  const prop = state.parts.propeller;
  const engine = state.parts.engine?.integrity ?? 1;
  const propV = !prop || prop.detached ? 0 : 1 - prop.integrity;
  return clamp01(propV * 1.2 + (1 - engine) * 0.4);
}

/** Parent structure a control surface hangs off: an aileron on a broken wing is only as
 * good as the wing. */
const PARENT: Record<string, string> = { aileron_l: 'wing_l', aileron_r: 'wing_r', elevator: 'tail', rudder: 'tail' };

/** Builds a fresh, fully-nominal damage state for the given aircraft aero surface ids. */
export function createDamageState(aeroSurfaceIds: string[], structure?: DamageStructure): DamageState {
  const parts: Record<string, PartDamageState> = {};
  for (const id of aeroSurfaceIds) {
    parts[id] = { role: roleForSurfaceId(id), integrity: 1, detached: false };
  }
  for (const id of COMPONENT_IDS) parts[id] ??= { role: roleForSurfaceId(id), integrity: 1, detached: false };
  return structure ? { parts, outcome: 'none', structure } : { parts, outcome: 'none' };
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

  return { ...state, parts, outcome };
}

/** Applies non-fatal strain near the point of contact, with small load transfer
 * to the rest of the airframe. */
export function applyContactStrain(state: DamageState, zone: string, impactSpeedMs: number): DamageState {
  const speed = Math.max(0, Math.abs(impactSpeedMs));
  if (speed < 1.1) return state;
  const targetRole: PartRole = zone === 'nose' || zone.startsWith('belly') || zone === 'gear'
    ? 'gear'
    : zone === 'tail' || zone === 'canopy' || zone === 'elevator' || zone === 'rudder'
      ? 'tail' : 'wing';
  const stress = clamp01((speed - 1.1) / 10) * 0.48;
  const parts: Record<string, PartDamageState> = {};
  for (const [id, part] of Object.entries(state.parts)) {
    if (part.detached) { parts[id] = part; continue; }
    const factor = part.role === targetRole ? (targetRole === 'gear' ? 0.85 : 0.68) : 0.035;
    const integrity = clamp01(part.integrity - stress * factor);
    const detached = part.role === targetRole && targetRole !== 'tail' && integrity <= INTEGRITY_FAILED && speed > 6;
    parts[id] = { ...part, integrity, detached };
  }
  const impactOutcome: CrashOutcome = speed >= IMPACT_HARD_MS ? 'totalLoss' : speed > IMPACT_SAFE_MS ? 'hardLanding' : 'none';
  return { ...state, parts, outcome: OUTCOME_SEVERITY[impactOutcome] > OUTCOME_SEVERITY[state.outcome] ? impactOutcome : state.outcome };
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
  const parent = PARENT[surfaceId];
  const parentMult = parent ? getAeroEffectivenessMultiplier(state, parent) : 1;
  const part = state.parts[surfaceId];
  if (!part) return parentMult;
  if (part.detached) return 0;
  return parentMult * ownMultiplier(part);
}

function ownMultiplier(part: PartDamageState): number {
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
