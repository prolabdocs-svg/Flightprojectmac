import { describe, expect, it } from 'vitest';
import { evaluateMissionReadiness } from './missionReadiness';
import { defaultBuild, installPart } from './assembly';
import { getMission } from './missions';

describe('evaluateMissionReadiness', () => {
  it('is always ready for a mission with no aircraftRequirement', () => {
    const mission = getMission('field_distance_01')!;
    expect(mission.aircraftRequirement).toBeUndefined();
    expect(evaluateMissionReadiness(mission, defaultBuild())).toEqual({ ready: true, shortfalls: [] });
  });

  it('fails the starter build on a later capability-gated contract and reports the shortfall', () => {
    const mission = getMission('backcountry_lake_01')!;
    expect(mission.aircraftRequirement?.minGearToleranceMs).toBe(4.5);
    const readiness = evaluateMissionReadiness(mission, defaultBuild());
    expect(readiness.ready).toBe(false);
    expect(readiness.shortfalls).toHaveLength(1);
    expect(readiness.shortfalls[0]).toMatch(/Tren tolera/);
  });

  it('passes the same gate once a cheap, tech-free part swap crosses the threshold', () => {
    const mission = getMission('backcountry_lake_01')!;
    const upgraded = installPart(defaultBuild(), 'landingGear', 'gear_field');
    expect(evaluateMissionReadiness(mission, upgraded)).toEqual({ ready: true, shortfalls: [] });
  });

  it('gates takeoff-roll contracts and clears them with an engine upgrade', () => {
    const mission = getMission('red_canyon_sprint_01')!;
    expect(evaluateMissionReadiness(mission, defaultBuild()).ready).toBe(false);
    const upgraded = installPart(defaultBuild(), 'engine', 'engine_medium');
    expect(evaluateMissionReadiness(mission, upgraded).ready).toBe(true);
  });

  it('gates range contracts and clears them at the fuel-capacity boundary', () => {
    const mission = getMission('industrial_bridge_01')!;
    expect(mission.aircraftRequirement?.minRangeKm).toBe(5.5);
    expect(evaluateMissionReadiness(mission, defaultBuild()).ready).toBe(false);
    const upgraded = installPart(defaultBuild(), 'fuelTank', 'tank_12');
    expect(evaluateMissionReadiness(mission, upgraded).ready).toBe(true);
  });

  it('requires both range and gear tolerance for the campaign capstone, and a combined upgrade clears both', () => {
    const mission = getMission('range_finale_01')!;
    const starterReadiness = evaluateMissionReadiness(mission, defaultBuild());
    expect(starterReadiness.ready).toBe(false);
    expect(starterReadiness.shortfalls).toHaveLength(2);
    const rangeOnly = installPart(defaultBuild(), 'fuelTank', 'tank_12');
    expect(evaluateMissionReadiness(mission, rangeOnly).ready).toBe(false);
    const both = installPart(rangeOnly, 'landingGear', 'gear_field');
    expect(evaluateMissionReadiness(mission, both).ready).toBe(true);
  });
});
