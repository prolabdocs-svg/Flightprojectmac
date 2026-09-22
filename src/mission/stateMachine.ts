// Mission state machine (master spec 50-51). Pure and table-driven: one rule per legal
// (event, state, phase) combination; anything else is rejected explicitly. The simulation feeds it
// events (see telemetryEvents.ts); the UI is never a source of truth.
//
//   AVAILABLE -> ACCEPTED -> PREPARED -> ACTIVE[TAXI -> TAKEOFF -> ENROUTE -> APPROACH -> LANDED]
//             -> OBJECTIVE_MET -> COMPLETED
//   branches: FAILED (crash, fuel out on the ground), ABORTED (abandoned, diverted), RECOVERED.

import type {
  ContractState, FlightPhase, MissionEvent, MissionEventType, MissionSession, TransitionResult,
} from './types';

type Patch = Partial<Omit<MissionSession, 'contractId' | 'history' | 'lastEvent'>>;
type EventOf<T extends MissionEventType> = Extract<MissionEvent, { type: T }>;

interface Rule<T extends MissionEventType = MissionEventType> {
  event: T;
  from: ContractState[];
  /** Only for ACTIVE: restrict to these phases. Omitted = any phase. */
  phases?: FlightPhase[];
  /** Returns a failure message, or null when the transition is allowed. */
  guard?: (s: MissionSession, e: EventOf<T>) => string | null;
  apply: (s: MissionSession, e: EventOf<T>) => Patch;
}

const rule = <T extends MissionEventType>(r: Rule<T>): Rule => r as unknown as Rule;

const AIR_PHASES: FlightPhase[] = ['TAKEOFF', 'ENROUTE', 'APPROACH'];
const hasStarted = (s: MissionSession) => s.history.some((h) => h.event === 'ENGINE_STARTED');

export const TRANSITION_RULES: Rule[] = [
  rule({ event: 'ACCEPT', from: ['AVAILABLE'], guard: (_s, e) => (e.difficulty === 'IMPOSSIBLE' ? 'contract is impossible for this aircraft' : null), apply: () => ({ state: 'ACCEPTED' }) }),
  rule({ event: 'PREPARE', from: ['ACCEPTED', 'PREPARED'], guard: (_s, e) => (e.feasible ? null : `plan not feasible: ${e.blockers.join(', ')}`), apply: () => ({ state: 'PREPARED' }) }),
  rule({ event: 'ENGINE_STARTED', from: ['PREPARED'], apply: () => ({ state: 'ACTIVE', phase: 'TAXI' }) }),
  rule({ event: 'TAXI_DETECTED', from: ['ACTIVE'], phases: ['TAXI'], apply: () => ({ taxiObserved: true }) }),
  rule({ event: 'TAKEOFF_ROLL', from: ['ACTIVE'], phases: ['TAXI'], apply: () => ({ phase: 'TAKEOFF' }) }),
  rule({ event: 'AIRBORNE', from: ['ACTIVE'], phases: ['TAKEOFF'], apply: () => ({ airborne: true }) }),
  rule({ event: 'DEPARTURE_EXITED', from: ['ACTIVE'], phases: ['TAKEOFF'], guard: (s) => (s.airborne ? null : 'aircraft never left the ground'), apply: () => ({ phase: 'ENROUTE' }) }),
  rule({ event: 'DESTINATION_PROXIMITY', from: ['ACTIVE'], phases: ['ENROUTE'], apply: () => ({ phase: 'APPROACH' }) }),
  rule({ event: 'GROUND_CONTACT', from: ['ACTIVE'], phases: ['ENROUTE', 'APPROACH'], apply: (_s, e) => ({ phase: 'LANDED', atDestination: e.atDestination }) }),
  rule({
    event: 'AIRCRAFT_STOPPED', from: ['ACTIVE'], phases: ['LANDED'],
    apply: (_s, e) => (e.atDestination ? { state: 'OBJECTIVE_MET' } : { state: 'ABORTED', abortReason: 'DIVERTED', divertedTo: e.divertedTo }),
  }),
  rule({
    event: 'FUEL_EXHAUSTED', from: ['ACTIVE'],
    // Dead-stick airborne is still a flight: it only becomes a failure if it ends in a crash.
    apply: (s) => (s.airborne ? { fuelExhausted: true } : { state: 'FAILED', fuelExhausted: true, failure: { code: 'FUEL_EXHAUSTED' } }),
  }),
  rule({ event: 'CRASH', from: ['ACTIVE'], apply: (s, e) => ({ state: 'FAILED', failure: s.fuelExhausted ? { code: 'FUEL_EXHAUSTED', detail: e.reason } : { code: 'CRASH', detail: e.reason } }) }),
  rule({ event: 'ABANDON', from: ['ACCEPTED', 'PREPARED'], apply: () => ({ state: 'ABORTED', abortReason: 'PLAYER_ABANDONED' }) }),
  rule({ event: 'ABANDON', from: ['ACTIVE'], phases: ['TAXI', ...AIR_PHASES], apply: () => ({ state: 'ABORTED', abortReason: 'PLAYER_ABANDONED' }) }),
  rule({ event: 'RECOVER', from: ['FAILED', 'ABORTED'], guard: (s) => (hasStarted(s) ? null : 'nothing to recover: the aircraft never left the hangar'), apply: () => ({ state: 'RECOVERED' }) }),
  rule({ event: 'COMPLETE', from: ['OBJECTIVE_MET'], apply: () => ({ state: 'COMPLETED' }) }),
];

export function createSession(contractId: string): MissionSession {
  return { contractId, state: 'AVAILABLE', phase: null, airborne: false, taxiObserved: false, fuelExhausted: false, atDestination: false, history: [] };
}

const SIGNATURE = (s: MissionSession) => `${s.state}|${s.phase}|${s.airborne}|${s.taxiObserved}|${s.fuelExhausted}|${s.atDestination}`;

/** Applies one event. Never mutates: returns a new session or an explicit rejection. A repeat of the
 * event that produced the current state is an idempotent no-op (`changed: false`), not an error. */
export function applyEvent(session: MissionSession, event: MissionEvent): TransitionResult {
  const reject = (code: 'INVALID_TRANSITION' | 'GUARD_FAILED', message: string): TransitionResult =>
    ({ ok: false, error: { code, event: event.type, state: session.state, phase: session.phase, message } });

  const candidates = TRANSITION_RULES.filter((r) => r.event === event.type && r.from.includes(session.state) && (!r.phases || (session.phase !== null && r.phases.includes(session.phase))));
  const match = candidates[0];
  if (!match) {
    if (session.lastEvent === event.type) return { ok: true, session, changed: false };
    return reject('INVALID_TRANSITION', `${event.type} is not allowed in ${session.state}${session.phase ? `/${session.phase}` : ''}`);
  }
  const blocked = match.guard?.(session, event as never);
  if (blocked) return reject('GUARD_FAILED', blocked);

  const patch = match.apply(session, event as never);
  const next: MissionSession = { ...session, ...patch, lastEvent: event.type };
  if (SIGNATURE(next) === SIGNATURE(session)) return { ok: true, session: { ...session, lastEvent: event.type }, changed: false };
  next.history = [...session.history, { event: event.type, from: { state: session.state, phase: session.phase }, to: { state: next.state, phase: next.phase } }];
  return { ok: true, session: next, changed: true };
}

export const isTerminal = (s: MissionSession): boolean => s.state === 'COMPLETED' || s.state === 'RECOVERED';
export const isOpen = (s: MissionSession): boolean => !isTerminal(s) && s.state !== 'AVAILABLE';
