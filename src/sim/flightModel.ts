// Flight model spec: every number FlightController and the performance estimator use,
// derived once from the installed parts (data-driven, no per-aircraft code paths).
//
// Axes (body/local): +Z forward (nose), +Y up, +X LEFT wing (Three.js right-handed).

import type { ResolvedAircraft } from '../content/assembly';
import { getPart } from '../content/parts';

export type Vec3 = [number, number, number];

export interface HandlingSpec {
  /** Angular acceleration (rad/s^2) at full stick and reference dynamic pressure. */
  pitchAuthority: number;
  rollAuthority: number;
  yawAuthority: number;
  /** Rate damping (1/s). Steady rate at full stick ~= authority / damping. */
  pitchDamping: number;
  rollDamping: number;
  yawDamping: number;
  /** Weathervane stiffness (rad/s^2 per rad of AoA / sideslip at reference q). */
  pitchStability: number;
  yawStability: number;
  /** Dihedral effect: roll acceleration per rad of sideslip at reference q. */
  dihedral: number;
}

export interface GearSpec {
  /** Tyre contact points at full extension, local metres. [nose, mainLeft, mainRight]. */
  wheels: [Vec3, Vec3, Vec3];
  /** Suspension travel before the bump stop, metres. */
  travelM: number;
  /** Static compression target used to size the springs, metres. */
  staticCompressionM: number;
  /** Sink rate the gear absorbs without damage, m/s. */
  toleranceMs: number;
  rollingResistanceMul: number;
  /** Max nose-wheel steering angle, rad. */
  maxSteerRad: number;
}

export interface FlightModelSpec {
  massKg: number;
  /** Principal inertia in local axes: [pitch (X), yaw (Y), roll (Z)], kg m^2. */
  inertia: Vec3;
  wingAreaM2: number;
  wingSpanM: number;
  /** Lift-curve slope, 1/rad. */
  clAlpha: number;
  /** CL at zero body angle of attack (includes wing incidence). */
  cl0: number;
  clMax: number;
  clMin: number;
  flapsClDelta: number;
  flapsCdDelta: number;
  /** Zero-lift drag coefficient referenced to wing area (airframe + wing). */
  cd0: number;
  /** Induced drag factor K = 1 / (pi e AR). */
  inducedK: number;
  /** Side-force area for sideslip, m^2. */
  sideAreaM2: number;
  /** Body AoA the airframe settles at hands-off (sets the trim speed). */
  trimAlphaRad: number;
  staticThrustN: number;
  /** Disk induced velocity at static full power, m/s (thrust lapse scale). */
  thrustInducedVelMs: number;
  engineResponseS: number;
  fuelCapacityL: number;
  /** Fuel flow at full throttle, L/min. */
  fuelBurnLpm: number;
  hasEngine: boolean;
  handling: HandlingSpec;
  gear: GearSpec;
  /** Structural contact points (tips, nose, tail, canopy, belly) in local metres. */
  hardPoints: Array<{ id: 'wingtipL' | 'wingtipR' | 'nose' | 'tail' | 'canopy' | 'bellyFront' | 'bellyRear'; p: Vec3 }>;
}

export const GRAVITY = 9.81;
export const SEA_LEVEL_RHO = 1.225;
/** Dynamic pressure at which handling authority is nominal (~22 m/s). */
export const Q_REF = 0.5 * SEA_LEVEL_RHO * 22 * 22;

// Gameplay calibration (not real aeronautical data). The part catalogue's power figures
// are abstract; these map them onto the target feel of a Quicksilver-class ultralight:
// ~45 km/h stall, ~85 km/h cruise, ~100 km/h top, 3 m/s climb, 60-90 m takeoff roll.
const THRUST_SCALE = 1.6;
const AIRFRAME_DRAG_SCALE = 0.5;
const OSWALD_E = 0.78;
const FUEL_BURN_LPM_PER_KW = 0.44;

const STARTER_HANDLING: HandlingSpec = {
  pitchAuthority: 4.4,
  rollAuthority: 5.4,
  yawAuthority: 1.6,
  pitchDamping: 4.2,
  rollDamping: 4.0,
  yawDamping: 3.0,
  pitchStability: 17,
  yawStability: 6,
  dihedral: 3.2,
};

/** Reference roll lever (aileron area x arm) of the starter wing, used to scale authority. */
const STARTER_AILERON_MOMENT = 2 * 0.9 * 4.2;
const STARTER_ROLL_INERTIA = 420;

export function deriveFlightModel(aircraft: ResolvedAircraft): FlightModelSpec {
  const mass = aircraft.totalMassKg;
  const wing = aircraft.aeroSurfaces.find((s) => s.id === 'wing_root_main');
  const ailerons = aircraft.aeroSurfaces.filter((s) => s.controlAxis === 'roll');
  const wingArea = wing?.areaM2 ?? 12;
  const span = wing?.spanM ?? 9;
  const ar = (span * span) / wingArea;
  const clAlpha = (2 * Math.PI) / (1 + 2 / (ar * OSWALD_E));
  // Stall angle authored per wing drives CLmax; the high-lift wing genuinely stalls later.
  const stallDeg = wing?.stallPositiveDeg ?? 15;
  const cl0 = 0.32;
  const clMax = cl0 + clAlpha * ((stallDeg - 2.5) * Math.PI / 180);

  const airframeCdA = aircraft.totalDragArea * AIRFRAME_DRAG_SCALE;
  const wingProfileCd = wing?.parasiticCd ?? 0.03;
  const cd0 = wingProfileCd + airframeCdA / wingArea;

  // Inertia: simple mass distribution (engine/pilot near the CG, wings spread laterally,
  // tail boom longitudinally). Enough for relative feel between builds.
  const rollInertia = mass * (span * span) / 36;
  const pitchInertia = mass * 1.35;
  const yawInertia = pitchInertia + rollInertia * 0.8;

  const aileronMoment = ailerons.reduce((sum, s) => sum + s.areaM2 * Math.abs(s.localPosition[0]), 0) || STARTER_AILERON_MOMENT;
  const rollScale = (aileronMoment / STARTER_AILERON_MOMENT) * (STARTER_ROLL_INERTIA / rollInertia);
  const handling: HandlingSpec = {
    ...STARTER_HANDLING,
    rollAuthority: STARTER_HANDLING.rollAuthority * Math.min(1.6, Math.max(0.6, rollScale)),
    ...aircraft.frame.handling,
  };

  const engine = aircraft.engine;
  let staticThrustN = 0;
  let inducedVel = 1;
  if (engine) {
    const diskArea = Math.PI * (engine.propDiameterM / 2) ** 2;
    const powerW = engine.maxPowerKw * 1000 * engine.propEfficiency;
    staticThrustN = THRUST_SCALE * Math.cbrt(2 * SEA_LEVEL_RHO * diskArea * powerW * powerW);
    inducedVel = Math.sqrt(staticThrustN / THRUST_SCALE / (2 * SEA_LEVEL_RHO * diskArea));
  }

  const gearPart = aircraft.gearPartId ? getPart(aircraft.gearPartId) : undefined;
  const impactTolerance = gearPart?.physics.impactTolerance ?? 35;

  return {
    massKg: mass,
    inertia: [pitchInertia, yawInertia, rollInertia],
    wingAreaM2: wingArea,
    wingSpanM: span,
    clAlpha,
    cl0,
    clMax,
    clMin: -0.9,
    flapsClDelta: 0.38,
    flapsCdDelta: 0.03,
    cd0,
    inducedK: 1 / (Math.PI * OSWALD_E * ar),
    sideAreaM2: 2.2,
    trimAlphaRad: (0.62 - cl0) / clAlpha,
    staticThrustN,
    thrustInducedVelMs: inducedVel,
    engineResponseS: engine?.responseTime ?? 0.3,
    fuelCapacityL: aircraft.fuelCapacityL,
    fuelBurnLpm: engine ? (engine.fuelBurnLpm ?? engine.maxPowerKw * FUEL_BURN_LPM_PER_KW) : 0,
    hasEngine: Boolean(engine),
    handling,
    gear: {
      // Nose leg slightly longer: ~1.5 deg nose-up ground attitude helps rotation.
      wheels: [[0, -1.13, 1.9], [1.15, -1.08, -0.32], [-1.15, -1.08, -0.32]],
      travelM: 0.22,
      staticCompressionM: 0.07,
      toleranceMs: 1.5 + impactTolerance / 17.5,
      rollingResistanceMul: aircraft.groundFrictionMul,
      maxSteerRad: 0.5,
    },
    hardPoints: [
      { id: 'wingtipL', p: [span / 2 + 0.3, 0.42, -0.25] },
      { id: 'wingtipR', p: [-(span / 2 + 0.3), 0.42, -0.25] },
      { id: 'nose', p: [0, 0, 2.75] },
      { id: 'tail', p: [0, 0.3, -4.9] },
      { id: 'canopy', p: [0, 1.35, -0.3] },
      { id: 'bellyFront', p: [0, -0.4, 0.9] },
      { id: 'bellyRear', p: [0, -0.25, -1.6] },
    ],
  };
}

/** Thrust (N) for a smoothed throttle at a given forward airspeed and density ratio. */
export function thrustAt(spec: FlightModelSpec, throttle: number, forwardSpeedMs: number, rhoRatio: number): number {
  if (!spec.hasEngine || throttle <= 0) return 0;
  // Actuator-disk lapse: thrust falls as the free stream approaches the slipstream speed.
  const t = spec.staticThrustN * Math.pow(throttle, 1.15) * Math.pow(rhoRatio, 1 / 3);
  return t / (1 + Math.max(0, forwardSpeedMs) / (3 * spec.thrustInducedVelMs));
}

/** Lift coefficient with a soft, recoverable stall. alpha in rad (body AoA). */
export function liftCoefficient(spec: FlightModelSpec, alpha: number, flaps: boolean): number {
  const cl0 = spec.cl0 + (flaps ? spec.flapsClDelta : 0);
  const clMax = spec.clMax + (flaps ? spec.flapsClDelta * 0.8 : 0);
  const aStall = (clMax - cl0) / spec.clAlpha;
  const aNeg = (spec.clMin - cl0) / spec.clAlpha;
  const plate = 1.9 * Math.sin(alpha) * Math.cos(alpha);
  if (alpha >= aNeg && alpha <= aStall) return cl0 + spec.clAlpha * alpha;
  if (alpha > aStall) {
    const over = alpha - aStall;
    // Past the break: lift sags to ~60% within a few degrees, then blends to flat plate.
    const sag = clMax * (0.6 + 0.4 * Math.exp(-over * 14));
    const t = smoothstep(over / 0.5);
    return sag * (1 - t) + plate * t;
  }
  const over = aNeg - alpha;
  const sag = spec.clMin * (0.6 + 0.4 * Math.exp(-over * 14));
  const t = smoothstep(over / 0.5);
  return sag * (1 - t) + plate * t;
}

export function stallAlpha(spec: FlightModelSpec, flaps: boolean): number {
  const cl0 = spec.cl0 + (flaps ? spec.flapsClDelta : 0);
  const clMax = spec.clMax + (flaps ? spec.flapsClDelta * 0.8 : 0);
  return (clMax - cl0) / spec.clAlpha;
}

export function dragCoefficient(spec: FlightModelSpec, alpha: number, cl: number, flaps: boolean, inducedMul = 1): number {
  const aStall = stallAlpha(spec, flaps);
  const separated = smoothstep((Math.abs(alpha) - aStall) / 0.35) * 1.2 * Math.sin(alpha) ** 2;
  return spec.cd0 + (flaps ? spec.flapsCdDelta : 0) + spec.inducedK * inducedMul * cl * cl + separated;
}

export function stallSpeed(spec: FlightModelSpec, flaps: boolean, rho = SEA_LEVEL_RHO): number {
  const clMax = spec.clMax + (flaps ? spec.flapsClDelta * 0.8 : 0);
  return Math.sqrt((2 * spec.massKg * GRAVITY) / (rho * spec.wingAreaM2 * clMax));
}

function smoothstep(t: number): number {
  const c = Math.max(0, Math.min(1, t));
  return c * c * (3 - 2 * c);
}
