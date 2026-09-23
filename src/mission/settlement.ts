// Contract settlement (master spec 27):
//   Net = Revenue + Bonuses - Fuel - Damage - Recovery - Fees - Penalties
// Reuses content/economy.ts (computeFlightResult for landing/objective bonuses, computeOperatingCosts
// for fuel burned + repairs) instead of a parallel formula. Pure: applying a Settlement to the wallet
// is operations.ts's job, guarded by the settled-contract ledger so it can never be paid twice.

import type { AircraftBuild, FlightResult, HomeBaseState } from '../core/types';
import type { FlightTelemetry } from '../flight/flightTypes';
import { resolveAircraft } from '../content/assembly';
import { computeFlightResult, computeOperatingCosts } from '../content/economy';
import { getAirfield, type RunwaySurface } from '../world/airfields';
import { getArchetype, contractRevenueCash } from './archetypes';
import type { Contract, Loadout, MissionSession } from './types';

export const LANDING_FEE_CASH: Record<RunwaySurface, number> = { grass: 3, dirt: 3, gravel: 4, salt: 6, tarmac: 12 };
const DISCOVERY_BASE_CASH = 25;
const RECOVERY_BASE_CASH = 40;
const RECOVERY_CASH_PER_KM = 12;
const RECOVERY_MAX_CASH = 160;
const ABANDON_PENALTY_SHARE = 0.15;
const CARGO_LOSS_SHARE = 0.25;

export interface Settlement {
  contractId: string;
  outcome: 'COMPLETED' | 'FAILED' | 'ABORTED';
  revenue: { base: number; bonuses: number; discovery: number; total: number };
  /** `damage` is an ESTIMATE only (spec item 6) — what repairing the flagged parts would cost
   * right now — and is deliberately excluded from `total`/net. Persistent damage (see
   * mission/aircraftCondition.ts) is billed only when the player actually buys a repair in the
   * Hangar (mission/operations.ts#startRepair), never automatically at settlement. */
  costs: { fuel: number; damage: number; recovery: number; fees: number; total: number };
  penalties: { late: number; abandonment: number; cargoLoss: number; hardLanding: number; total: number };
  net: number;
  reputationDelta: number;
  researchPoints: number;
  flight: FlightResult | null;
}

export interface SettlementInput {
  contract: Contract;
  session: MissionSession;
  /** Final telemetry of the flight; null when the contract never left the ground. */
  telemetry: FlightTelemetry | null;
  loadout: Loadout | null;
  startFuelFraction: number | null;
  build: AircraftBuild;
  homeBase?: HomeBaseState;
  firstVisitToDestination: boolean;
}

const sum = (o: Record<string, number>, skip: string) => Object.entries(o).reduce((t, [k, v]) => (k === skip ? t : t + v), 0);

export function settleContract(i: SettlementInput): Settlement {
  const { contract, session, telemetry, loadout } = i;
  const arch = getArchetype(contract.archetype);
  const payloadKg = loadout?.payloadKg ?? 0;
  const baseCash = contractRevenueCash(arch, contract.distanceM, payloadKg);
  const completed = session.state === 'COMPLETED' || session.state === 'OBJECTIVE_MET';
  const flew = telemetry !== null && i.startFuelFraction !== null;
  const started = session.history.some((h) => h.event === 'ENGINE_STARTED');

  const aircraft = resolveAircraft(i.build);
  const flight = flew ? computeFlightResult({ ...contract.mission, rewardBaseCash: baseCash }, telemetry, aircraft, i.build, i.homeBase, i.startFuelFraction!) : null;
  const operating = flew ? computeOperatingCosts(telemetry, aircraft, i.build, i.homeBase, i.startFuelFraction!) : { fuelCost: 0, repairCost: 0 };

  const revenue = { base: 0, bonuses: 0, discovery: 0, total: 0 };
  const costs = { fuel: operating.fuelCost, damage: operating.repairCost, recovery: 0, fees: 0, total: 0 };
  const penalties = { late: 0, abandonment: 0, cargoLoss: 0, hardLanding: 0, total: 0 };
  let reputationDelta = 0;
  let researchPoints = 0;
  let outcome: Settlement['outcome'] = 'ABORTED';

  if (completed && flight) {
    outcome = 'COMPLETED';
    revenue.base = baseCash;
    revenue.bonuses = Math.max(0, flight.rewardCash - baseCash);
    penalties.hardLanding = Math.max(0, baseCash - flight.rewardCash);
    if (i.firstVisitToDestination) revenue.discovery = DISCOVERY_BASE_CASH + arch.discoveryBonusCash;
    costs.fees = LANDING_FEE_CASH[destinationSurface(contract)];
    if (contract.timeLimitS && arch.timeLimit && telemetry!.elapsedS > contract.timeLimitS) penalties.late = Math.round(baseCash * arch.timeLimit.latePenaltyShare);
    reputationDelta = (flight.reputationGain ?? 0) - (penalties.late > 0 ? 1.5 : 0);
    researchPoints = flight.rewardRp;
  } else if (session.state === 'FAILED') {
    outcome = 'FAILED';
    costs.recovery = Math.min(RECOVERY_MAX_CASH, Math.round(RECOVERY_BASE_CASH + RECOVERY_CASH_PER_KM * ((telemetry?.distanceM ?? 0) / 1000)));
    if (payloadKg > 0) penalties.cargoLoss = Math.round(baseCash * CARGO_LOSS_SHARE);
    reputationDelta = -2;
  } else {
    outcome = 'ABORTED';
    if (started) penalties.abandonment = Math.round(baseCash * ABANDON_PENALTY_SHARE);
    reputationDelta = started ? -1 : 0;
  }

  revenue.total = revenue.base + revenue.bonuses + revenue.discovery;
  // 'damage' is excluded here on purpose (see the Settlement.costs doc comment above).
  costs.total = sum(costs, 'total') - costs.damage;
  penalties.total = sum(penalties, 'total');
  return {
    contractId: contract.id, outcome, revenue, costs, penalties,
    net: revenue.total - costs.total - penalties.total,
    reputationDelta, researchPoints, flight,
  };
}

function destinationSurface(c: Contract): RunwaySurface {
  return getAirfield(c.destinationId)?.surface ?? 'grass';
}

/** A complete FlightTelemetry for a nominal, clean flight; used for expected-value planning and fixtures. */
export function nominalTelemetry(p: { distanceM: number; elapsedS: number; fuelFraction: number; landingQuality?: number; endPosition: [number, number, number] }): FlightTelemetry {
  return {
    state: 'stopped', speedMs: 0, altitudeM: 0, aoaDeg: 0, distanceM: p.distanceM, maxAltitudeM: 30, maxSpeedMs: 30,
    fuelFraction: p.fuelFraction, crashed: false, landed: true, landingQuality: p.landingQuality ?? 0.7, rpm: 0, onGround: true,
    crashOutcome: 'none', damagedPartIds: [], detachedPartIds: [], landingFailures: [], elapsedS: p.elapsedS, position: p.endPosition,
    headingDeg: 0, airspeedMs: 0, groundSpeedMs: 0, verticalSpeedMs: 0, pitchDeg: 0, rollDeg: 0, throttle: 0, engineOn: false,
    outOfFuel: false, stallWarning: false, stalled: false, stallSpeedMs: 0, wheelsOnGround: 3, gForce: 1, lastTouchdownVsMs: -0.8, crashReason: null,
  };
}
