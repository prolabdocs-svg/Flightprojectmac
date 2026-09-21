// Game-facing flight contract (state, controls, telemetry) that HUD / economy / missions / audio
// depend on. Produced by flight/flightModel.ts.

import type { CrashOutcome } from '../sim/damageSystem';
import type { RunwayConditions } from '../world/landingValidator';

/** Used when a mission has no destination airfield — a mid-tolerance surface. */
export const DEFAULT_RUNWAY_CONDITIONS: RunwayConditions = { surface: 'grass', roughness: 0.4 };

export type FlightState =
  | 'prestart'
  | 'taxi'
  | 'airborne'
  | 'landingApproach'
  | 'groundRoll'
  | 'crashed'
  | 'stopped';

export interface ResolvedControls {
  /** 0..1 */
  throttle: number;
  /** > 0 = nose right */
  rudder: number;
  /** > 0 = nose up */
  pitch: number;
  /** > 0 = right wing down */
  roll: number;
  engineOn: boolean;
  brake: boolean;
  flapsDown: boolean;
  chuteDeployed: boolean;
  assistMode: 'assisted' | 'standard' | 'acro';
}

export type CrashReason = 'terrain' | 'obstacle' | 'hardLanding' | 'flipped' | 'water' | 'wingStrike';

export interface FlightTelemetry {
  state: FlightState;
  speedMs: number;
  altitudeM: number;
  aoaDeg: number;
  distanceM: number;
  maxAltitudeM: number;
  maxSpeedMs: number;
  fuelFraction: number;
  crashed: boolean;
  landed: boolean;
  landingQuality: number;
  rpm: number;
  onGround: boolean;
  /** 'none' / 'hardLanding' (damaging but survivable) / 'totalLoss'. */
  crashOutcome: CrashOutcome;
  damagedPartIds: string[];
  detachedPartIds: string[];
  /** validateLanding() failure reasons for the final touchdown. */
  landingFailures: string[];
  /** Fixed-step flight duration (excludes pauses). */
  elapsedS: number;
  /** World-space location at the current fixed simulation tick. */
  position: [number, number, number];
  /** Compass heading in degrees: 0 = world north/+Z, clockwise (see world/compass.ts). */
  headingDeg: number;
  /** True airspeed (relative to the air mass). `speedMs` stays total inertial speed. */
  airspeedMs: number;
  groundSpeedMs: number;
  /** World vertical speed, m/s, positive = climbing. */
  verticalSpeedMs: number;
  /** Nose-up positive. */
  pitchDeg: number;
  /** Right-wing-down positive. */
  rollDeg: number;
  /** Smoothed engine throttle actually applied, 0..1. */
  throttle: number;
  engineOn: boolean;
  outOfFuel: boolean;
  /** Approaching critical angle of attack or near stall speed while airborne. */
  stallWarning: boolean;
  /** Wing past critical angle of attack (lift collapsing). */
  stalled: boolean;
  /** 1g stall speed of the current configuration (flaps aware), m/s. */
  stallSpeedMs: number;
  /** Number of landing-gear wheels touching the ground (0..3). */
  wheelsOnGround: number;
  /** Load factor along the aircraft's up axis, g. */
  gForce: number;
  /** Vertical speed (m/s, negative = sinking) at the most recent touchdown, null before any. */
  lastTouchdownVsMs: number | null;
  /** Why the flight ended in a crash, null otherwise. */
  crashReason: CrashReason | null;
}
