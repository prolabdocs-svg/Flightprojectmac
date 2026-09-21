import { describe, expect, it } from 'vitest';
import type { MissionDefinition } from '../core/types';
import type { FlightTelemetry } from '../flight/flightTypes';
import { getMissionProgress, isMissionCompleted } from './missionProgress';

const mission: MissionDefinition = {
  id: 'contract', regionId: 'the_field', family: 'precisionLanding', name: 'Contract', description: '',
  spawnPoint: [0, 0, 0], spawnHeadingDeg: 0, targetPoint: [100, 0, 200], targetRadiusM: 20,
  minDistanceM: 150, rewardBaseCash: 1, rewardBaseRp: 1, bonuses: [],
};
const telemetry = (overrides: Partial<FlightTelemetry> = {}): FlightTelemetry => ({
  crashed: false, landed: false, distanceM: 0, position: [0, 0, 0], headingDeg: 0,
  ...overrides,
} as FlightTelemetry);

describe('mission progress', () => {
  it('reports both distance and destination requirements while flying', () => {
    const progress = getMissionProgress(mission, telemetry({ distanceM: 40, position: [20, 0, 40] }));
    expect(progress).toMatchObject({ state: 'active', primaryLabel: 'Recorre 110 m más', secondaryLabel: 'Destino a 179 m' });
  });

  it('is ready to land only after all non-landing requirements are met', () => {
    expect(getMissionProgress(mission, telemetry({ distanceM: 160, position: [110, 0, 205] }))?.state).toBe('readyToLand');
    expect(getMissionProgress(mission, telemetry({ distanceM: 160, position: [130, 0, 200] }))?.state).toBe('active');
  });

  it('only completes after a safe landing in the objective zone', () => {
    expect(isMissionCompleted(mission, telemetry({ distanceM: 160, position: [110, 0, 205], landed: false }))).toBe(false);
    expect(isMissionCompleted(mission, telemetry({ distanceM: 160, position: [110, 0, 205], landed: true }))).toBe(true);
  });

  it('reports signed target bearing relative to the aircraft heading', () => {
    const eastTarget = { ...mission, targetPoint: [100, 0, 0] as [number, number, number] };
    expect(getMissionProgress(eastTarget, telemetry({ headingDeg: 0 }))?.bearingDeltaDeg).toBe(90);
    expect(getMissionProgress(eastTarget, telemetry({ headingDeg: 180 }))?.bearingDeltaDeg).toBe(-90);
  });
});
