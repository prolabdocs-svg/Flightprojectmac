import { AIRFIELDS } from '../world/airfields';
import { createAircraftCondition } from './aircraftCondition';
import type { OperationsState } from './types';
import { createExploration } from '../world/exploration';

export const OPERATIONS_VERSION = 1;
export const HOME_AIRFIELD_ID = 'field_home';
const STARTER_REGION = 'the_field';

/** Fresh operations: parked at home with a full starter tank, seeing every airfield of the starting region marked 'known'. */
export function createOperations(): OperationsState {
  const known = AIRFIELDS.filter((a) => a.regionId === STARTER_REGION && a.discoveryState === 'known').map((a) => a.id);
  return {
    version: OPERATIONS_VERSION,
    locationId: HOME_AIRFIELD_ID,
    fuelL: 8,
    knownAirfieldIds: known,
    visitedAirfieldIds: [HOME_AIRFIELD_ID],
    exploration: createExploration(),
    active: null,
    settledContractIds: [],
    contractSeed: 1,
    debtCash: 0,
    condition: { flights: 0, landings: 0, hardLandings: 0 },
    aircraftCondition: createAircraftCondition(),
    pendingRepair: null,
    log: [],
    lastSettlement: null,
  };
}
