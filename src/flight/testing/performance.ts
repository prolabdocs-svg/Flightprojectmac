// Kept as a thin async wrapper for the calibration tests written before the analysis became
// synchronous and Rapier-free (src/flight/analysis/performance.ts).
import type { AircraftDefinition } from '../aircraft/aircraftDefinition';
import { levelPerformance as levelSync, summarize, type LevelPoint } from '../analysis/performance';

export type { LevelPoint };
export { summarize };
export async function levelPerformance(def: AircraftDefinition, speeds: number[], throttle = 1, altM = 0): Promise<LevelPoint[]> {
  return levelSync(def, speeds, throttle, altM);
}
