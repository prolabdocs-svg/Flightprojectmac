// The seam between the running flight and the contract domain. FlightScreen (and the headless UI tests)
// call exactly these two functions: nothing about phases, terminal states or payment lives in the screen.

import type { FlightTelemetry } from '../flight/flightTypes';
import { useGameStore } from './gameStore';
import { useProfileStore } from './profileStore';

const TERMINAL = ['OBJECTIVE_MET', 'FAILED', 'ABORTED'];

export const activeContractState = () => useProfileStore.getState().profile.operations.active?.session.state ?? null;

/** Feeds one simulation sample to the mission state machine. True once the contract has ended. */
export function tickContractFlight(telemetry: FlightTelemetry): boolean {
  useProfileStore.getState().advanceMission(telemetry);
  const state = activeContractState();
  return state !== null && TERMINAL.includes(state);
}

/** Pays / charges the ended contract exactly once (domain ledger). Safe to call repeatedly. */
export function finishContractFlight(final: FlightTelemetry | null): boolean {
  const r = useProfileStore.getState().settleMission(final);
  return r.ok;
}

/** End of a contract flight, exactly as FlightScreen does it: settle once, then show Results. */
export function concludeContractFlight(final: FlightTelemetry | null): void {
  finishContractFlight(final);
  useGameStore.getState().setLastOutcome('contract');
  useGameStore.getState().goTo('results');
}
