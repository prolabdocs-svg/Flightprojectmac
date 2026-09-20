import { describe, expect, it } from 'vitest';
import { getResultsHeadline } from './resultsHeadline';
import type { FlightResult } from '../../core/types';

function baseResult(overrides: Partial<FlightResult> = {}): FlightResult {
  return {
    missionId: 'm1',
    distanceM: 0,
    maxAltitudeM: 0,
    maxSpeedMs: 0,
    crashed: false,
    landed: true,
    landingQuality: 0.5,
    timeS: 0,
    fuelRemaining: 1,
    rewardCash: 0,
    rewardRp: 0,
    bonusesAchieved: [],
    ...overrides,
  };
}

describe('getResultsHeadline', () => {
  it('keeps success primary with a hard-landing caution when the contract completed', () => {
    const result = baseResult({ crashOutcome: 'hardLanding', missionCompleted: true });
    expect(getResultsHeadline(result)).toEqual({
      title: 'Contrato completado',
      caution: 'Aterrizaje forzoso: la nave sufrió daños',
    });
  });

  it('reports a clean success with no caution', () => {
    const result = baseResult({ crashOutcome: 'none', missionCompleted: true });
    expect(getResultsHeadline(result)).toEqual({ title: 'Contrato completado' });
  });

  it('reports a hard landing on a missed contract as failure, not success', () => {
    const result = baseResult({ crashOutcome: 'hardLanding', missionCompleted: false });
    expect(getResultsHeadline(result)).toEqual({ title: 'Aterrizaje forzoso' });
  });

  it('keeps crashes as total loss regardless of mission state', () => {
    const result = baseResult({ crashed: true, missionCompleted: true });
    expect(getResultsHeadline(result)).toEqual({ title: 'Pérdida total' });
  });

  it('reports a missed contract with a clean landing as out-of-target', () => {
    const result = baseResult({ crashOutcome: 'none', missionCompleted: false });
    expect(getResultsHeadline(result)).toEqual({ title: 'Aterrizaje fuera de objetivo' });
  });

  it('reports an interrupted flight when not landed and not crashed', () => {
    const result = baseResult({ landed: false, missionCompleted: false });
    expect(getResultsHeadline(result)).toEqual({ title: 'Vuelo interrumpido' });
  });

  it('reports free flight coherently regardless of crashOutcome', () => {
    const result = baseResult({ missionId: null, landed: true, crashOutcome: 'hardLanding' });
    expect(getResultsHeadline(result)).toEqual({ title: 'Vuelo libre finalizado' });
  });
});
