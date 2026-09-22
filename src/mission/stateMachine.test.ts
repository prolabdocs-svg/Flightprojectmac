import { describe, expect, it } from 'vitest';
import { applyEvent, createSession } from './stateMachine';
import type { ContractState, FlightPhase, MissionEvent, MissionSession } from './types';

const EVENTS: MissionEvent[] = [
  { type: 'ACCEPT', difficulty: 'MARGINAL' },
  { type: 'PREPARE', feasible: true, blockers: [] },
  { type: 'ENGINE_STARTED' },
  { type: 'TAXI_DETECTED' },
  { type: 'TAKEOFF_ROLL' },
  { type: 'AIRBORNE' },
  { type: 'DEPARTURE_EXITED' },
  { type: 'DESTINATION_PROXIMITY' },
  { type: 'GROUND_CONTACT', atDestination: true },
  { type: 'AIRCRAFT_STOPPED', atDestination: true },
  { type: 'FUEL_EXHAUSTED' },
  { type: 'CRASH', reason: 'terrain' },
  { type: 'ABANDON' },
  { type: 'RECOVER' },
  { type: 'COMPLETE' },
];

const PHASES: FlightPhase[] = ['TAXI', 'TAKEOFF', 'ENROUTE', 'APPROACH', 'LANDED'];
const NO_PHASE: ContractState[] = ['AVAILABLE', 'ACCEPTED', 'PREPARED', 'OBJECTIVE_MET', 'COMPLETED', 'FAILED', 'ABORTED', 'RECOVERED'];

/** Independent statement of the legal (event -> state/phase) pairs, written from the spec, not from the rule table. */
const LEGAL: Record<string, string[]> = {
  ACCEPT: ['AVAILABLE'],
  PREPARE: ['ACCEPTED', 'PREPARED'],
  ENGINE_STARTED: ['PREPARED'],
  TAXI_DETECTED: ['ACTIVE/TAXI'],
  TAKEOFF_ROLL: ['ACTIVE/TAXI'],
  AIRBORNE: ['ACTIVE/TAKEOFF'],
  DEPARTURE_EXITED: ['ACTIVE/TAKEOFF'],
  DESTINATION_PROXIMITY: ['ACTIVE/ENROUTE'],
  GROUND_CONTACT: ['ACTIVE/ENROUTE', 'ACTIVE/APPROACH'],
  AIRCRAFT_STOPPED: ['ACTIVE/LANDED'],
  FUEL_EXHAUSTED: PHASES.map((p) => `ACTIVE/${p}`),
  CRASH: PHASES.map((p) => `ACTIVE/${p}`),
  ABANDON: ['ACCEPTED', 'PREPARED', 'ACTIVE/TAXI', 'ACTIVE/TAKEOFF', 'ACTIVE/ENROUTE', 'ACTIVE/APPROACH'],
  RECOVER: ['FAILED', 'ABORTED'],
  COMPLETE: ['OBJECTIVE_MET'],
};

function sessionAt(state: ContractState, phase: FlightPhase | null): MissionSession {
  return {
    ...createSession('c1'), state, phase, airborne: true,
    history: [{ event: 'ENGINE_STARTED', from: { state: 'PREPARED', phase: null }, to: { state: 'ACTIVE', phase: 'TAXI' } }],
  };
}

const feed = (s: MissionSession, ...events: MissionEvent[]): MissionSession => {
  let cur = s;
  for (const e of events) {
    const r = applyEvent(cur, e);
    if (!r.ok) throw new Error(`${e.type} rejected: ${r.error.message}`);
    cur = r.session;
  }
  return cur;
};

const HAPPY: MissionEvent[] = [
  { type: 'ACCEPT', difficulty: 'MARGINAL' }, { type: 'PREPARE', feasible: true, blockers: [] }, { type: 'ENGINE_STARTED' },
  { type: 'TAXI_DETECTED' }, { type: 'TAKEOFF_ROLL' }, { type: 'AIRBORNE' }, { type: 'DEPARTURE_EXITED' },
  { type: 'DESTINATION_PROXIMITY' }, { type: 'GROUND_CONTACT', atDestination: true }, { type: 'AIRCRAFT_STOPPED', atDestination: true }, { type: 'COMPLETE' },
];

describe('mission state machine: valid transitions', () => {
  it('walks AVAILABLE -> ... -> COMPLETED through every phase', () => {
    let s = createSession('c1');
    const seen: string[] = [];
    for (const e of HAPPY) {
      s = feed(s, e);
      seen.push(`${s.state}${s.phase ? '/' + s.phase : ''}`);
    }
    expect(seen).toEqual([
      'ACCEPTED', 'PREPARED', 'ACTIVE/TAXI', 'ACTIVE/TAXI', 'ACTIVE/TAKEOFF', 'ACTIVE/TAKEOFF', 'ACTIVE/ENROUTE',
      'ACTIVE/APPROACH', 'ACTIVE/LANDED', 'OBJECTIVE_MET/LANDED', 'COMPLETED/LANDED',
    ]);
    expect(s.history.map((h) => h.event)).toEqual(HAPPY.map((e) => e.type));
  });

  it('is pure: the input session is never mutated', () => {
    const s = createSession('c1');
    const before = JSON.stringify(s);
    feed(s, HAPPY[0]);
    expect(JSON.stringify(s)).toBe(before);
  });
});

describe('mission state machine: exhaustive legality', () => {
  const combos: Array<[ContractState, FlightPhase | null]> = [...NO_PHASE.map((s) => [s, null] as [ContractState, null]), ...PHASES.map((p) => ['ACTIVE', p] as [ContractState, FlightPhase])];
  for (const event of EVENTS) {
    it(`${event.type} is accepted exactly where the spec allows it`, () => {
      for (const [state, phase] of combos) {
        const key = phase ? `${state}/${phase}` : state;
        const r = applyEvent(sessionAt(state, phase), event);
        const legal = LEGAL[event.type].includes(key);
        expect(r.ok, `${event.type} in ${key}`).toBe(legal);
        if (!r.ok) expect(r.error.code).toBe('INVALID_TRANSITION');
      }
    });
  }
});

describe('mission state machine: guards', () => {
  it('rejects accepting an IMPOSSIBLE contract', () => {
    const r = applyEvent(createSession('c1'), { type: 'ACCEPT', difficulty: 'IMPOSSIBLE' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('GUARD_FAILED');
  });
  it('rejects an infeasible plan and names why', () => {
    const s = feed(createSession('c1'), { type: 'ACCEPT', difficulty: 'MARGINAL' });
    const r = applyEvent(s, { type: 'PREPARE', feasible: false, blockers: ['INSUFFICIENT_RANGE'] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.message).toContain('INSUFFICIENT_RANGE');
  });
  it('cannot leave the departure area without having been airborne', () => {
    const s: MissionSession = { ...sessionAt('ACTIVE', 'TAKEOFF'), airborne: false };
    const r = applyEvent(s, { type: 'DEPARTURE_EXITED' });
    expect(r.ok).toBe(false);
  });
  it('nothing to recover if the aircraft never started', () => {
    const s = feed(createSession('c1'), { type: 'ACCEPT', difficulty: 'COMFORTABLE' }, { type: 'ABANDON' });
    expect(s.state).toBe('ABORTED');
    expect(applyEvent(s, { type: 'RECOVER' }).ok).toBe(false);
  });
});

describe('mission state machine: idempotency', () => {
  it('repeating the event that produced the state is a no-op, not an error', () => {
    const s = feed(createSession('c1'), ...HAPPY);
    const again = applyEvent(s, { type: 'COMPLETE' });
    expect(again.ok && again.changed).toBe(false);
    expect(again.ok && again.session.history.length).toBe(s.history.length);
    expect(again.ok && again.session.state).toBe('COMPLETED');
  });
  it('a repeated self-transition (AIRBORNE every tick) does not grow history', () => {
    const s = feed(createSession('c1'), ...HAPPY.slice(0, 6));
    const n = s.history.length;
    const r = applyEvent(s, { type: 'AIRBORNE' });
    expect(r.ok && r.changed).toBe(false);
    expect(r.ok && r.session.history.length).toBe(n);
  });
  it('an unrelated event out of order is still rejected', () => {
    const s = feed(createSession('c1'), ...HAPPY);
    expect(applyEvent(s, { type: 'ENGINE_STARTED' }).ok).toBe(false);
  });
});

describe('mission state machine: failure, abort, recovery', () => {
  const airborne = () => feed(createSession('c1'), ...HAPPY.slice(0, 7));
  it('a crash anywhere in ACTIVE fails the contract with its reason', () => {
    const s = feed(airborne(), { type: 'CRASH', reason: 'hardLanding' });
    expect(s.state).toBe('FAILED');
    expect(s.failure).toEqual({ code: 'CRASH', detail: 'hardLanding' });
  });
  it('running dry on the ground fails immediately', () => {
    const s = feed(createSession('c1'), ...HAPPY.slice(0, 4), { type: 'FUEL_EXHAUSTED' });
    expect(s.state).toBe('FAILED');
    expect(s.failure?.code).toBe('FUEL_EXHAUSTED');
  });
  it('running dry in the air only flags it; a crash afterwards is blamed on the fuel', () => {
    const dry = feed(airborne(), { type: 'FUEL_EXHAUSTED' });
    expect(dry.state).toBe('ACTIVE');
    expect(dry.fuelExhausted).toBe(true);
    const crashed = feed(dry, { type: 'CRASH', reason: 'terrain' });
    expect(crashed.failure).toEqual({ code: 'FUEL_EXHAUSTED', detail: 'terrain' });
  });
  it('a dead-stick landing at the destination still completes the contract', () => {
    const s = feed(airborne(), { type: 'FUEL_EXHAUSTED' }, { type: 'DESTINATION_PROXIMITY' }, { type: 'GROUND_CONTACT', atDestination: true }, { type: 'AIRCRAFT_STOPPED', atDestination: true });
    expect(s.state).toBe('OBJECTIVE_MET');
  });
  it('stopping away from the destination diverts (ABORTED) and remembers where', () => {
    const s = feed(airborne(), { type: 'GROUND_CONTACT', atDestination: false }, { type: 'AIRCRAFT_STOPPED', atDestination: false, divertedTo: 'field_north_strip' });
    expect(s.state).toBe('ABORTED');
    expect(s.abortReason).toBe('DIVERTED');
    expect(s.divertedTo).toBe('field_north_strip');
  });
  it('abandoning in the air aborts; FAILED and ABORTED both recover to RECOVERED', () => {
    const a = feed(airborne(), { type: 'ABANDON' });
    expect(a.abortReason).toBe('PLAYER_ABANDONED');
    expect(feed(a, { type: 'RECOVER' }).state).toBe('RECOVERED');
    expect(feed(airborne(), { type: 'CRASH', reason: 'x' }, { type: 'RECOVER' }).state).toBe('RECOVERED');
  });
  it('cannot abandon once the objective is met', () => {
    const s = feed(createSession('c1'), ...HAPPY.slice(0, 10));
    expect(applyEvent(s, { type: 'ABANDON' }).ok).toBe(false);
  });
});
