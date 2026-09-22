import { describe, expect, it } from 'vitest';
import { getAirfield } from '../world/airfields';
import { createDefaultProfile } from '../save/save';
import { acceptContract, getOffers, prepareMission, suggestedLoadout } from './operations';
import { nominalTelemetry } from './settlement';
import { observe } from './telemetryEvents';
import type { FlightTelemetry } from '../flight/flightTypes';
import type { ActiveContract } from './types';

function setup(): ActiveContract {
  const p = createDefaultProfile();
  const o = getOffers(p).find((x) => x.available && x.contract.destinationId === 'field_north_strip')!;
  const a = acceptContract(p, o.contract.id);
  if (!a.ok) throw new Error(a.error);
  const r = prepareMission(a.profile, suggestedLoadout(a.profile)!);
  if (!r.ok) throw new Error(r.error);
  return r.profile.operations.active!;
}

const at = (x: number, z: number, over: Partial<FlightTelemetry> = {}): FlightTelemetry => ({
  ...nominalTelemetry({ distanceM: 0, elapsedS: 0, fuelFraction: 0.5, endPosition: [x, 0, z] }),
  landed: false, wheelsOnGround: 3, onGround: true, state: 'taxi', engineOn: true, rpm: 2500, altitudeM: 0, throttle: 0, groundSpeedMs: 0, ...over,
});

describe('simulation telemetry -> mission events', () => {
  it('waits for the engine, then follows the flight through every phase', () => {
    const a = setup();
    const c = a.contract;
    const dest = getAirfield(c.destinationId)!;
    let s = a.session;
    const step = (t: FlightTelemetry) => { const r = observe(s, t, c); s = r.session; return r.events.map((e) => e.type); };

    expect(step(at(0, 0, { engineOn: false, rpm: 0 }))).toEqual([]);
    expect(step(at(0, 0))).toEqual(['ENGINE_STARTED']);
    expect(step(at(0, 0))).toEqual([]); // nothing new, nothing emitted
    expect(step(at(0, 5, { groundSpeedMs: 3, throttle: 0.2 }))).toEqual(['TAXI_DETECTED']);
    expect(step(at(0, 30, { groundSpeedMs: 10, throttle: 1 }))).toEqual(['TAKEOFF_ROLL']);
    expect(step(at(0, 80, { wheelsOnGround: 0, onGround: false, altitudeM: 2, state: 'airborne' }))).toEqual(['AIRBORNE']);
    expect(step(at(0, 100, { wheelsOnGround: 0, altitudeM: 10 }))).toEqual([]); // still inside the departure area
    // This hop is shorter than the approach radius (600 m): leaving the departure area already puts the strip inside it.
    expect(step(at(0, 300, { wheelsOnGround: 0, altitudeM: 30 }))).toEqual(['DEPARTURE_EXITED', 'DESTINATION_PROXIMITY']);
    expect(s.phase).toBe('APPROACH');
    expect(step(at(0, dest.position[2] - 40, { wheelsOnGround: 3, onGround: true, state: 'groundRoll', groundSpeedMs: 15 }))).toEqual(['GROUND_CONTACT']);
    expect(s.phase).toBe('LANDED');
    const stopped = at(0, dest.position[2] + 10, { state: 'stopped', landed: true, distanceM: c.distanceM });
    expect(step(stopped)).toEqual(['AIRCRAFT_STOPPED']);
    expect(s.state).toBe('OBJECTIVE_MET');
    expect(step(stopped)).toEqual([]);
  });

  it('a crash ends the contract with the simulation reason; fuel exhaustion is reported first', () => {
    const a = setup();
    let r1 = observe(a.session, at(0, 0), a.contract).session;
    r1 = observe(r1, at(0, 40, { wheelsOnGround: 0, altitudeM: 3, throttle: 1 }), a.contract).session;
    const r2 = observe(r1, at(0, 60, { wheelsOnGround: 0, altitudeM: 4, crashed: true, crashReason: 'terrain', outOfFuel: true }), a.contract);
    expect(r2.events.map((e) => e.type)).toEqual(['FUEL_EXHAUSTED', 'CRASH']);
    expect(r2.session.state).toBe('FAILED');
    expect(r2.session.failure?.code).toBe('FUEL_EXHAUSTED'); // blamed on the fuel, detail keeps the impact
  });

  it('stopping away from the destination diverts to the strip it stopped on', () => {
    const a = setup();
    let s = observe(a.session, at(0, 0), a.contract).session;
    s = observe(s, at(0, 5, { groundSpeedMs: 3, throttle: 1 }), a.contract).session;
    s = observe(s, at(0, 40, { wheelsOnGround: 0, altitudeM: 3, throttle: 1 }), a.contract).session;
    s = observe(s, at(300, 300, { wheelsOnGround: 0, altitudeM: 30 }), a.contract).session;
    const home = getAirfield('field_home')!;
    const r = observe(s, at(home.position[0] + 10, home.position[2] + 10, { state: 'stopped', landed: true }), a.contract);
    // Landed back on the departure strip: contact is off-target, the stop is a diversion to where it stopped.
    expect(r.events.map((e) => e.type)).toEqual(['GROUND_CONTACT', 'AIRCRAFT_STOPPED']);
    expect(r.session.state).toBe('ABORTED');
    expect(r.session.abortReason).toBe('DIVERTED');
    expect(r.session.divertedTo).toBe('field_home');
  });
});
