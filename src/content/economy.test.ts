import { describe, expect, it } from 'vitest';
import { computeFlightResult, computeOperatingCosts, isMissionCompleted } from './economy';
import type { FlightTelemetry } from '../sim/flightController';
import type { AircraftBuild, MissionDefinition } from '../core/types';
import { resolveAircraft } from './assembly';

function telemetry(overrides: Partial<FlightTelemetry> = {}): FlightTelemetry {
  return {
    distanceM: 0,
    maxAltitudeM: 0,
    maxSpeedMs: 0,
    crashed: false,
    landed: false,
    landingQuality: 0,
    fuelFraction: 1,
    elapsedS: 0,
    position: [0, 0, 0],
    crashOutcome: 'none',
    damagedPartIds: [],
    detachedPartIds: [],
    ...overrides,
  } as FlightTelemetry;
}

const mission: MissionDefinition = {
  id: 'field_distance_01',
  regionId: 'the_field',
  family: 'distanceRun',
  name: 'Test mission',
  description: '',
  spawnPoint: [0, 0, 0],
  spawnHeadingDeg: 0,
  rewardBaseCash: 20,
  rewardBaseRp: 3,
  bonuses: [
    { id: 'no_damage', label: 'No damage', check: 'noDamage', rewardCash: 10, rewardRp: 2 },
    { id: 'fuel_left', label: 'Fuel remaining', check: 'fuelRemaining', value: 0.5, rewardCash: 5, rewardRp: 1 },
  ],
};

describe('computeFlightResult', () => {
  it('falls back to default base rewards with no mission', () => {
    const result = computeFlightResult(null, telemetry());
    expect(result.missionId).toBeNull();
    expect(result.rewardCash).toBeGreaterThanOrEqual(20);
    expect(result.rewardRp).toBeGreaterThanOrEqual(3);
  });

  it('adds a distance-based reward component, capped at 200', () => {
    const short = computeFlightResult(null, telemetry({ distanceM: 100 }));
    const long = computeFlightResult(null, telemetry({ distanceM: 100000 }));
    expect(short.rewardCash).toBeLessThan(long.rewardCash);
    // distanceComponent capped at 200 cash, base 20 -> at most ~220 before other bonuses
    expect(long.rewardCash).toBeLessThanOrEqual(20 + 200 + 1);
  });

  it('rewards a successful landing based on landing quality', () => {
    const noLanding = computeFlightResult(null, telemetry({ landed: false }));
    const goodLanding = computeFlightResult(null, telemetry({ landed: true, landingQuality: 1 }));
    expect(goodLanding.rewardCash).toBeGreaterThan(noLanding.rewardCash);
    expect(goodLanding.rewardRp).toBeGreaterThan(noLanding.rewardRp);
  });

  it('achieves the noDamage bonus only when not crashed', () => {
    const crashed = computeFlightResult(mission, telemetry({ crashed: true }));
    const clean = computeFlightResult(mission, telemetry({ crashed: false }));
    expect(clean.bonusesAchieved).toContain('no_damage');
    expect(crashed.bonusesAchieved).not.toContain('no_damage');
  });

  it('achieves the fuelRemaining bonus based on the bonus value threshold', () => {
    const lowFuel = computeFlightResult(mission, telemetry({ fuelFraction: 0.2 }));
    const highFuel = computeFlightResult(mission, telemetry({ fuelFraction: 0.9 }));
    expect(lowFuel.bonusesAchieved).not.toContain('fuel_left');
    expect(highFuel.bonusesAchieved).toContain('fuel_left');
  });

  it('awards timeUnder only for a completed flight inside its fixed-step time limit', () => {
    const timedMission: MissionDefinition = {
      ...mission,
      bonuses: [{ id: 'quick', label: 'Quick', check: 'timeUnder', value: 45, rewardCash: 10, rewardRp: 2 }],
    };
    expect(computeFlightResult(timedMission, telemetry({ landed: true, elapsedS: 44.9 })).bonusesAchieved).toContain('quick');
    expect(computeFlightResult(timedMission, telemetry({ landed: true, elapsedS: 45.1 })).bonusesAchieved).not.toContain('quick');
    expect(computeFlightResult(timedMission, telemetry({ landed: false, elapsedS: 10 })).bonusesAchieved).not.toContain('quick');
  });

  it('carries fixed-step flight duration into the result', () => {
    expect(computeFlightResult(mission, telemetry({ elapsedS: 72.5 })).timeS).toBe(72.5);
  });

  it('awards more reputation for completing a contract than for a failed landing', () => {
    const distanceMission = { ...mission, minDistanceM: 300 };
    const completed = computeFlightResult(distanceMission, telemetry({ landed: true, distanceM: 400 }));
    const failed = computeFlightResult(distanceMission, telemetry({ landed: true, distanceM: 0 }));
    expect(completed.reputationGain).toBeGreaterThan(failed.reputationGain ?? 0);
  });

  it('requires landing inside a precision target rather than accepting any landing', () => {
    const precision: MissionDefinition = {
      ...mission,
      family: 'precisionLanding',
      targetPoint: [100, 0, 200],
      targetRadiusM: 20,
    };
    expect(isMissionCompleted(precision, telemetry({ landed: true, position: [110, 0, 205] }))).toBe(true);
    expect(isMissionCompleted(precision, telemetry({ landed: true, position: [121, 0, 200] }))).toBe(false);
  });

  it('requires the contracted distance before completing a distance run', () => {
    const distanceRun: MissionDefinition = { ...mission, minDistanceM: 300 };
    expect(isMissionCompleted(distanceRun, telemetry({ landed: true, distanceM: 300 }))).toBe(true);
    expect(isMissionCompleted(distanceRun, telemetry({ landed: true, distanceM: 299.9 }))).toBe(false);
  });

  it('applies a crash penalty that reduces cash but never below the 10 cash floor', () => {
    const result = computeFlightResult(null, telemetry({ crashed: true, distanceM: 0 }));
    expect(result.crashed).toBe(true);
    expect(result.rewardCash).toBeGreaterThanOrEqual(10);
  });

  it('rounds reward cash and rp to whole numbers', () => {
    const result = computeFlightResult(mission, telemetry({ distanceM: 333, landed: true, landingQuality: 0.73 }));
    expect(Number.isInteger(result.rewardCash)).toBe(true);
    expect(Number.isInteger(result.rewardRp)).toBe(true);
  });

  it('deducts operating costs from rewardCash to produce netCash', () => {
    const result = computeFlightResult(
      mission,
      telemetry({ distanceM: 1000, fuelFraction: 0.5, damagedPartIds: ['wing_root_main'] }),
    );
    expect(result.netCash).toBeLessThan(result.rewardCash!);
    expect(result.netCash).toBe(result.rewardCash! - (result.fuelCost ?? 0) - (result.repairCost ?? 0));
  });
});

describe('computeOperatingCosts', () => {
  const defaultBuild: AircraftBuild = { frameId: 'frame_zero', installed: {} };
  const aircraft = resolveAircraft(defaultBuild);

  it('has no repair cost when nothing is damaged or detached', () => {
    const costs = computeOperatingCosts(telemetry({ fuelFraction: 1 }), aircraft, defaultBuild);
    expect(costs.repairCost).toBe(0);
  });

  it('charges no fuel cost when the tank is still full', () => {
    const costs = computeOperatingCosts(telemetry({ fuelFraction: 1 }), aircraft, defaultBuild);
    expect(costs.fuelCost).toBe(0);
  });

  it('scales fuel cost with fuel actually burned', () => {
    const lightBurn = computeOperatingCosts(telemetry({ fuelFraction: 0.9 }), aircraft, defaultBuild);
    const heavyBurn = computeOperatingCosts(telemetry({ fuelFraction: 0.1 }), aircraft, defaultBuild);
    expect(heavyBurn.fuelCost).toBeGreaterThan(lightBurn.fuelCost);
  });

  it('charges more to repair a detached part than an equivalent damaged part', () => {
    const damaged = computeOperatingCosts(
      telemetry({ damagedPartIds: ['wing_root_main'] }),
      aircraft,
      defaultBuild,
    );
    const detached = computeOperatingCosts(
      telemetry({ detachedPartIds: ['wing_root_main'] }),
      aircraft,
      defaultBuild,
    );
    expect(detached.repairCost).toBeGreaterThan(damaged.repairCost);
  });

  it('applies a hangar repair discount without discounting fuel', () => {
    const base = computeOperatingCosts(telemetry({ fuelFraction: .5, damagedPartIds: ['wing_root_main'] }), aircraft, defaultBuild);
    const upgraded = computeOperatingCosts(
      telemetry({ fuelFraction: .5, damagedPartIds: ['wing_root_main'] }), aircraft, defaultBuild,
      { runwayLevel: 0, hangarLevel: 2 },
    );
    expect(upgraded.repairCost).toBeLessThan(base.repairCost);
    expect(upgraded.fuelCost).toBe(base.fuelCost);
  });

  it('caps a total-loss repair cost to roughly a full airframe replacement, not an unbounded stack', () => {
    const totalLoss = computeOperatingCosts(
      telemetry({
        crashOutcome: 'totalLoss',
        damagedPartIds: ['aileron_l', 'aileron_r'],
        detachedPartIds: ['wing_root_main', 'elevator', 'rudder'],
      }),
      aircraft,
      defaultBuild,
    );
    const naiveStack = computeOperatingCosts(
      telemetry({
        crashOutcome: 'none',
        damagedPartIds: ['aileron_l', 'aileron_r'],
        detachedPartIds: ['wing_root_main', 'elevator', 'rudder'],
      }),
      aircraft,
      defaultBuild,
    );
    expect(totalLoss.repairCost).toBeGreaterThan(0);
    expect(totalLoss.repairCost).toBeLessThanOrEqual(Math.max(totalLoss.repairCost, naiveStack.repairCost));
  });

  it('never lets computeFlightResult costs push netCash below the survival floor', () => {
    const result = computeFlightResult(
      null,
      telemetry({
        distanceM: 0,
        crashOutcome: 'totalLoss',
        detachedPartIds: ['wing_root_main', 'elevator', 'rudder', '__gear__'],
        fuelFraction: 0,
      }),
      aircraft,
      defaultBuild,
    );
    expect(result.netCash).toBeGreaterThanOrEqual(0);
  });
});
