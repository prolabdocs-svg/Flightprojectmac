import { describe, expect, it } from 'vitest';
import { computeFlightResult } from './economy';
import type { FlightTelemetry } from '../sim/flightController';
import type { MissionDefinition } from '../core/types';

function telemetry(overrides: Partial<FlightTelemetry> = {}): FlightTelemetry {
  return {
    distanceM: 0,
    maxAltitudeM: 0,
    maxSpeedMs: 0,
    crashed: false,
    landed: false,
    landingQuality: 0,
    fuelFraction: 1,
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
});
