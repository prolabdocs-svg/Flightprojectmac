import { describe, expect, it } from 'vitest';
import { defaultBuild } from '../content/assembly';
import { getAirfield } from '../world/airfields';
import { campaignLocalToMaster, masterToCampaignLocal } from '../world/master/masterGeography';
import { createOperations } from './operationsState';
import { generateContracts } from './contracts';
import { routeContext } from './route';
import { createSession, applyEvent } from './stateMachine';
import { observe } from './telemetryEvents';
import { nominalTelemetry } from './settlement';
import type { FlightTelemetry } from '../flight/flightTypes';

const telemetryAt = (position: [number, number, number], patch: Partial<FlightTelemetry> = {}): FlightTelemetry => ({
  ...nominalTelemetry({ distanceM: 0, elapsedS: 0, fuelFraction: 0.8, endPosition: position }),
  state: 'airborne', landed: false, onGround: false, wheelsOnGround: 0, engineOn: true, rpm: 2400,
  altitudeM: 20, throttle: 0.8, groundSpeedMs: 30, ...patch, position,
});

describe('cross-region contract routing', () => {
  it('plans an adjacent cross-region leg in the origin frame over master-world terrain', () => {
    const origin = getAirfield('field_north_strip')!;
    const destination = getAirfield('scrap_yard_strip')!;
    const route = routeContext(origin.id, destination.id);
    const [originX, originZ] = campaignLocalToMaster(origin.regionId, origin.position[0], origin.position[2]);
    const [destX, destZ] = campaignLocalToMaster(destination.regionId, destination.position[0], destination.position[2]);
    const expectedDestinationLocal = masterToCampaignLocal(origin.regionId, destX, destZ);

    expect(destination.regionId).not.toBe(origin.regionId);
    expect(route.distanceM).toBeCloseTo(Math.hypot(destX - originX, destZ - originZ), 6);
    expect(route.destinationPoint[0]).toBeCloseTo(expectedDestinationLocal[0], 6);
    expect(route.destinationPoint[2]).toBeCloseTo(expectedDestinationLocal[1], 6);
    expect(route.destinationPoint[1]).toBe(0);

    const ops = createOperations();
    const offers = generateContracts({
      build: defaultBuild(), reputation: 0, originId: origin.id,
      knownAirfieldIds: ops.knownAirfieldIds,
      visitedAirfieldIds: [origin.id], onboardFuelL: 8, seed: 7,
    });
    const offer = offers.find((candidate) => candidate.contract.destinationId === destination.id);
    expect(offer).toBeDefined();
    expect(offer!.contract.mission.regionId).toBe(origin.regionId);
    expect(offer!.contract.mission.targetPoint).toEqual([...route.destinationPoint]);
    expect(offer!.contract.distanceM).toBeCloseTo(route.distanceM, 6);
    expect(offer!.contract.archetype).toBe('exploration');
    // The current starter setup is expected to be range-limited on this leg; the contract
    // exists for discovery/progression but cannot be accepted until the aircraft is upgraded.
    expect(offer!.available).toBe(false);
    expect(offer!.assessment.plan.blockers).toContain('INSUFFICIENT_RANGE');

    let session = createSession(offer!.contract.id);
    const accept = applyEvent(session, { type: 'ACCEPT', difficulty: 'COMFORTABLE' });
    expect(accept.ok).toBe(true);
    if (!accept.ok) return;
    const prepare = applyEvent(accept.session, { type: 'PREPARE', feasible: true, blockers: [] });
    expect(prepare.ok).toBe(true);
    if (!prepare.ok) return;
    session = prepare.session;
    const step = (t: FlightTelemetry) => {
      const result = observe(session, t, offer!.contract);
      session = result.session;
      return result.events.map((event) => event.type);
    };

    expect(step(telemetryAt([...origin.position], { state: 'taxi', onGround: true, wheelsOnGround: 3, altitudeM: 0, groundSpeedMs: 0, throttle: 0.2 }))).toContain('ENGINE_STARTED');
    expect(step(telemetryAt([origin.position[0], origin.position[1], origin.position[2] + 320], { altitudeM: 15, distanceM: 320 }))).toEqual(['TAKEOFF_ROLL', 'AIRBORNE', 'DEPARTURE_EXITED']);
    expect(step(telemetryAt([...route.destinationPoint], { distanceM: route.distanceM, altitudeM: 35 }))).toEqual(['DESTINATION_PROXIMITY']);
    expect(step(telemetryAt([...route.destinationPoint], { state: 'groundRoll', onGround: true, wheelsOnGround: 3, altitudeM: 0, groundSpeedMs: 12, distanceM: route.distanceM }))).toEqual(['GROUND_CONTACT']);
    expect(step(telemetryAt([...route.destinationPoint], { state: 'stopped', landed: true, onGround: true, wheelsOnGround: 3, altitudeM: 0, groundSpeedMs: 0, engineOn: false, rpm: 0, distanceM: route.distanceM }))).toEqual(['AIRCRAFT_STOPPED']);
    expect(session.state).toBe('OBJECTIVE_MET');
  });
});
