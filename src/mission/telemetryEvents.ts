// Turns the simulation's FlightTelemetry into mission events (master spec 50: "la simulación produce
// los eventos"). The state machine never reads telemetry itself: this adapter decides which event the
// current tick justifies, one at a time, and applyEvent() accepts or rejects it.

import type { FlightTelemetry } from '../flight/flightTypes';
import { isMissionCompleted } from '../content/missionProgress';
import { getAirfield, AIRFIELDS } from '../world/airfields';
import { getMasterTerrain } from '../world/master/masterRuntime';
import { applyEvent } from './stateMachine';
import type { Contract, MissionEvent, MissionSession } from './types';

/** Once this close to the destination the leg becomes an approach. */
export const APPROACH_RADIUS_M = 600;
/** Beyond this (plus half the departure runway) the aircraft has left the departure area. */
const DEPARTURE_MARGIN_M = 150;
const MIN_ENGINE_RPM = 300;
const DIVERT_SNAP_M = 250;

const flat = (t: FlightTelemetry, p: readonly number[]) => Math.hypot(t.position[0] - p[0], t.position[2] - p[2]);

export function nextEvent(session: MissionSession, t: FlightTelemetry, c: Contract): MissionEvent | null {
  const active = session.state === 'ACTIVE';
  if (session.state === 'PREPARED') return t.engineOn && t.rpm > MIN_ENGINE_RPM ? { type: 'ENGINE_STARTED' } : null;
  if (!active) return null;

  if (t.outOfFuel && !session.fuelExhausted) return { type: 'FUEL_EXHAUSTED' };
  if (t.crashed) return { type: 'CRASH', reason: t.crashReason ?? 'unknown' };

  const origin = getAirfield(c.originId)!;
  const destinationPoint = c.mission.targetPoint ?? getAirfield(c.destinationId)!.position;
  const airborneNow = t.wheelsOnGround === 0 && t.altitudeM > 0.3;
  switch (session.phase) {
    case 'TAXI':
      if (airborneNow || (t.throttle >= 0.8 && t.groundSpeedMs > 2)) return { type: 'TAKEOFF_ROLL' };
      return !session.taxiObserved && t.groundSpeedMs > 0.5 ? { type: 'TAXI_DETECTED' } : null;
    case 'TAKEOFF':
      if (!session.airborne) return airborneNow ? { type: 'AIRBORNE' } : null;
      return t.altitudeM > 5 && flat(t, origin.position) > origin.runwayLengthM / 2 + DEPARTURE_MARGIN_M ? { type: 'DEPARTURE_EXITED' } : null;
    case 'ENROUTE':
      if (t.wheelsOnGround > 0) return { type: 'GROUND_CONTACT', atDestination: flat(t, destinationPoint) <= (c.mission.targetRadiusM ?? 0) };
      return flat(t, destinationPoint) <= APPROACH_RADIUS_M ? { type: 'DESTINATION_PROXIMITY' } : null;
    case 'APPROACH':
      return t.wheelsOnGround > 0 ? { type: 'GROUND_CONTACT', atDestination: flat(t, destinationPoint) <= (c.mission.targetRadiusM ?? 0) } : null;
    case 'LANDED': {
      if (!(t.state === 'stopped' || t.landed)) return null;
      const atDestination = isMissionCompleted(c.mission, t);
      const world = getMasterTerrain();
      const [wx, wz] = world.localToWorld(c.mission.regionId, t.position[0], t.position[2]);
      const near = AIRFIELDS.find((a) => {
        const field = world.airfield(a.id);
        return field && Math.hypot(wx - field.worldPosition[0], wz - field.worldPosition[1]) <= DIVERT_SNAP_M;
      });
      return { type: 'AIRCRAFT_STOPPED', atDestination, divertedTo: atDestination ? undefined : near?.id };
    }
    default:
      return null;
  }
}

/** Feeds one telemetry sample: applies every event it justifies, in order. */
export function observe(session: MissionSession, t: FlightTelemetry, c: Contract): { session: MissionSession; events: MissionEvent[] } {
  let s = session;
  const events: MissionEvent[] = [];
  for (let i = 0; i < 8; i++) {
    const e = nextEvent(s, t, c);
    if (!e) break;
    const r = applyEvent(s, e);
    if (!r.ok || !r.changed) break;
    s = r.session;
    events.push(e);
  }
  return { session: s, events };
}
