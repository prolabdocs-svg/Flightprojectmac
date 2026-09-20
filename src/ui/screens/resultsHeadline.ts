import type { FlightResult } from '../../core/types';

// A completed contract must read as success even with a rough landing; the hard-landing
// consequence (damage/cost) is a secondary caution line, not the headline.
export function getResultsHeadline(result: FlightResult): { title: string; caution?: string } {
  if (!result.missionId && result.landed) {
    return { title: 'Vuelo libre finalizado' };
  }
  if (result.crashed) {
    return { title: 'Pérdida total' };
  }
  if (result.landed && result.missionCompleted !== false) {
    return result.crashOutcome === 'hardLanding'
      ? { title: 'Contrato completado', caution: 'Aterrizaje forzoso: la nave sufrió daños' }
      : { title: 'Contrato completado' };
  }
  if (result.crashOutcome === 'hardLanding') {
    return { title: 'Aterrizaje forzoso' };
  }
  if (result.landed) {
    return { title: 'Aterrizaje fuera de objetivo' };
  }
  return { title: 'Vuelo interrumpido' };
}
