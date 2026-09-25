// Mission domain vocabulary (master gameplay loop spec, sections 50-51). Pure data: nothing here
// imports UI, the store or the renderer, so the whole loop can be exercised headless.

import type { MissionDefinition, Vec3 } from '../core/types';
import type { FlightTelemetry } from '../flight/flightTypes';
import type { Settlement } from './settlement';
import type { MissionAirfieldLinks } from '../content/missions';
import type { AircraftCondition, ComponentId } from './aircraftCondition';
import type { RepairOrder } from './maintenance';

export type ArchetypeId =
  | 'cargo' | 'passenger' | 'urgent' | 'ferry' | 'exploration'
  | 'navigation' | 'precisionLanding' | 'weather' | 'rescue' | 'heavyLift';

/** Contractual lifecycle. The operational phases below only exist while a contract is ACTIVE. */
export type ContractState =
  | 'AVAILABLE' | 'ACCEPTED' | 'PREPARED' | 'ACTIVE' | 'OBJECTIVE_MET' | 'COMPLETED'
  | 'FAILED' | 'ABORTED' | 'RECOVERED';

export type FlightPhase = 'TAXI' | 'TAKEOFF' | 'ENROUTE' | 'APPROACH' | 'LANDED';

export type Difficulty = 'TRIVIAL' | 'COMFORTABLE' | 'CHALLENGING' | 'MARGINAL' | 'IMPOSSIBLE';
/** Map-facing tri-state (spec 5): what the pin on the map says about this destination. */
export type Reachability = 'REACHABLE' | 'MARGINAL' | 'OUT_OF_RANGE';

export type FailureCode = 'CRASH' | 'FUEL_EXHAUSTED';
export interface FailureReason {
  code: FailureCode;
  /** Simulation crash reason (terrain, hardLanding, ...) when code is CRASH. */
  detail?: string;
}
export type AbortReason = 'PLAYER_ABANDONED' | 'DIVERTED';

export interface MissionWeather {
  /** Mean air-mass velocity, world axes (m/s). Same convention as RegionDefinition.windBaseMs. */
  windMs: Vec3;
  gustMs: number;
}

export interface Contract {
  id: string;
  archetype: ArchetypeId;
  title: string;
  originId: string;
  destinationId: string;
  regionId: string;
  distanceM: number;
  /** Compass bearing origin -> destination, 0 = +Z, clockwise. */
  bearingDeg: number;
  /** Payload offered (full load). The player may carry between minPayloadKg and this. */
  payloadKg: number;
  minPayloadKg: number;
  passengers: number;
  weather: MissionWeather;
  /** Gross contract revenue before bonuses, cash. */
  revenueCash: number;
  timeLimitS?: number;
  reputationRequired: number;
  /** Playable as-is by the existing flight/economy layer (spawn, target, radius, bonuses). */
  mission: MissionDefinition & MissionAirfieldLinks;
}

// --- Events & session ----------------------------------------------------------------------------

export type MissionEvent =
  | { type: 'ACCEPT'; difficulty: Difficulty }
  | { type: 'PREPARE'; feasible: boolean; blockers: string[] }
  | { type: 'ENGINE_STARTED' }
  | { type: 'TAXI_DETECTED' }
  | { type: 'TAKEOFF_ROLL' }
  | { type: 'AIRBORNE' }
  | { type: 'DEPARTURE_EXITED' }
  | { type: 'DESTINATION_PROXIMITY' }
  | { type: 'GROUND_CONTACT'; atDestination: boolean }
  | { type: 'AIRCRAFT_STOPPED'; atDestination: boolean; divertedTo?: string }
  | { type: 'FUEL_EXHAUSTED' }
  | { type: 'CRASH'; reason: string }
  | { type: 'ABANDON' }
  | { type: 'RECOVER' }
  | { type: 'COMPLETE' };

export type MissionEventType = MissionEvent['type'];

export interface TransitionRecord {
  event: MissionEventType;
  from: { state: ContractState; phase: FlightPhase | null };
  to: { state: ContractState; phase: FlightPhase | null };
}

export interface MissionSession {
  contractId: string;
  state: ContractState;
  phase: FlightPhase | null;
  /** Wheels have left the ground at least once. */
  airborne: boolean;
  taxiObserved: boolean;
  fuelExhausted: boolean;
  atDestination: boolean;
  failure?: FailureReason;
  abortReason?: AbortReason;
  divertedTo?: string;
  lastEvent?: MissionEventType;
  history: TransitionRecord[];
}

export type TransitionErrorCode = 'INVALID_TRANSITION' | 'GUARD_FAILED';
export interface TransitionError {
  code: TransitionErrorCode;
  event: MissionEventType;
  state: ContractState;
  phase: FlightPhase | null;
  message: string;
}

export type TransitionResult =
  | { ok: true; session: MissionSession; /** false when the event repeated the one that produced this state (idempotent). */ changed: boolean }
  | { ok: false; error: TransitionError };

// --- Persisted operations state (PlayerProfile.operations) ---------------------------------------

export interface Loadout {
  fuelL: number;
  payloadKg: number;
}

export interface ActiveContract {
  contract: Contract;
  session: MissionSession;
  /** Set by PREPARE: what actually goes on board. */
  loadout: Loadout | null;
  /** Fuel on board when the engine started (fraction of tank), for fuel-burn accounting. */
  startFuelFraction: number | null;
  /** Last telemetry sample, captured when the session reached OBJECTIVE_MET / FAILED / ABORTED, so an
   * unsettled flight can still be paid exactly once after a reload or a screen change. */
  finalTelemetry: FlightTelemetry | null;
  /** Periodic in-flight checkpoint (spec item 11), refreshed on an interval + key events, never
   * every physics tick. Lets a reload mid-ACTIVE-flight settle against real fuel burned instead of
   * silently refunding it (see operations.ts#reconcileAfterLoad). */
  checkpoint: FlightCheckpoint | null;
}

export interface FlightCheckpoint {
  fuelFraction: number;
  elapsedS: number;
}

/** A settlement as it hit the wallet: what the Results screen shows, and what survives a reload. */
export interface AppliedSettlement extends Settlement {
  title: string;
  originId: string;
  destinationId: string;
  failure?: FailureReason;
  abortReason?: AbortReason;
  cashChange: number;
  /** + created, - repaid. */
  debtChange: number;
  cashAfter: number;
  debtAfter: number;
  discoveredAirfieldId: string | null;
  revealedAirfieldIds: string[];
  fuelRemainingL: number;
  conditionAfter: OperationsState['condition'];
  /** Components that took damage (or worse) THIS flight, for Results — never implies they were
   * repaired; see mission/aircraftCondition.ts for what "damaged" means. */
  damagedComponentIds: ComponentId[];
}

export type LogKind =
  | 'mission_start' | 'takeoff' | 'landing' | 'crash' | 'mission_complete' | 'mission_abandon'
  | 'fuel_used' | 'damage' | 'upgrade_purchased' | 'destination_discovered'
  | 'repair_started' | 'repair_completed';

export interface OperationsLogEntry {
  kind: LogKind;
  contractId?: string;
  value?: number;
  note?: string;
}

export interface OperationsState {
  version: number;
  /** Persistent per-component aircraft condition (mission/aircraftCondition.ts, spec item 1). */
  aircraftCondition: AircraftCondition;
  /** A repair currently being worked on, if any (mission/maintenance.ts, spec item 6). */
  pendingRepair: RepairOrder | null;
  /** Airfield where the aircraft is parked. New contracts depart from here. */
  locationId: string;
  /** Fuel in the tank right now, litres. Persisted between flights. */
  fuelL: number;
  /** Airfields visible on the map (destinations can be inspected). */
  knownAirfieldIds: string[];
  /** Airfields the player has landed at at least once. */
  visitedAirfieldIds: string[];
  /** Fog of Discovery: flown territory, sighted airfields, landmarks, identified regions (world/exploration.ts). */
  exploration: import('../world/exploration').ExplorationState;
  active: ActiveContract | null;
  /** Contracts already paid out: the idempotency ledger against double settlement. */
  settledContractIds: string[];
  /** Monotonic counter feeding the deterministic contract generator. */
  contractSeed: number;
  /** Unpaid balance from a bad flight; taken from future revenue, never blocks flying. */
  debtCash: number;
  condition: { flights: number; landings: number; hardLandings: number };
  log: OperationsLogEntry[];
  /** The most recent settlement, kept so Results can render it without ever re-applying it. */
  lastSettlement: AppliedSettlement | null;
}
