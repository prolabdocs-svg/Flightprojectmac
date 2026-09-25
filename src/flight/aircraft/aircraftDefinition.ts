// Data-driven aircraft description (spec section 27). Everything the physics reads about an
// aircraft lives here; nothing about a specific model is hard-coded in the solver.
//
// Every numeric parameter must be listed in `provenance` (dotted path, arrays as `name[]`) with one
// of MEASURED | DOCUMENTED | ESTIMATED | CALIBRATED | PLACEHOLDER. A unit test enforces it, so an
// undocumented magic number cannot enter a definition.

import type { AeroElementSpec, BluffBodySpec } from '../aero/aeroElement';
import type { AirfoilSpec } from '../aero/airfoil';
import type { Vec3 } from '../core/coordinates';
import type { DamageStructure } from '../../sim/damageSystem';

export type Provenance = 'MEASURED' | 'DOCUMENTED' | 'ESTIMATED' | 'CALIBRATED' | 'PLACEHOLDER';

export interface MassItem {
  id: string;
  massKg: number;
  /** Centre of the item in BODY axes relative to the model datum, m. */
  position: Vec3;
  /** Bounding-box size (x lateral, y vertical, z longitudinal) used for the item's own inertia. */
  size: Vec3;
}

export interface EngineDefinition {
  maxPowerKw: number;
  /** RPM at which rated power is delivered. */
  ratedRpm: number;
  idleRpm: number;
  redlineRpm: number;
  /** Combined engine + propeller rotating inertia, kg m^2. */
  inertiaKgM2: number;
  /** Friction/pumping torque at rated RPM as a fraction of rated torque. */
  frictionFraction: number;
  /** Crank-to-propeller reduction ratio (crank rpm / prop rpm). */
  gearRatio: number;
  /** Fraction of full-throttle power at throttle 0 (idle setting that holds idleRpm against prop drag). */
  idleThrottle: number;
  /** Starter motor torque at the crank, N m. */
  starterTorqueNm: number;
  /** Power lapse with density (1 = Gagg-Farrar, 0 = none). */
  altitudeLapse: number;
  /** Shaft position in BODY axes (thrust application point) and thrust-line tilt (deg, nose-up +). */
  position: Vec3;
  thrustLineDeg: number;
  /** Fuel consumption at rated power, L/h. */
  fuelBurnLph: number;
  /** Turbojet core: thrust straight from N1, no propeller torque/slipstream. rpm reads N1 x redlineRpm. */
  jet?: { maxThrustN: number; spoolTimeS: number; idleFraction: number };
  /** Head-temperature model, as a fraction of the thermal limit (1 = limit; above it the engine derates). */
  thermal?: { heatAtFull: number; airflowRelief: number; timeConstantS: number };
}

export interface PropellerDefinition {
  diameterM: number;
  /** Advance ratio J = V/(nD) at zero thrust (fixed pitch; sets how fast thrust lapses with airspeed). */
  j0: number;
  /** Static thrust and power coefficients at J = 0 (Ct = T/(rho n^2 D^4), Cp = P/(rho n^3 D^5)). */
  ct0: number;
  cp0: number;
  /** +1 = clockwise seen from the cockpit (torque reaction rolls the airframe left). */
  rotation: 1 | -1;
  /** Blade + hub moment of inertia, for gyroscopic effects, kg m^2. */
  inertiaKgM2: number;
  /** Slipstream swirl as a fraction of the axial slipstream speed. */
  swirlGain: number;
  /** P-factor: lateral thrust-centre shift per unit disc angle, in propeller radii. */
  pFactor: number;
  /** Fraction of the ideal far-wake speed felt at the tail (wake decay and contraction). */
  wakeFactor: number;
}

export interface WheelDefinition {
  id: string;
  /** Contact point at full extension, BODY axes. */
  position: Vec3;
  radiusM: number;
  /** Fraction of static load this wheel carries (informational; springs are sized from geometry). */
  steerable: boolean;
  braked: boolean;
}

export interface GearDefinition {
  wheels: WheelDefinition[];
  travelM: number;
  staticCompressionM: number;
  dampingRatio: number;
  /** Peak tyre friction coefficient (dry, hard surface) before surface scaling. */
  tyreMu: number;
  rollingResistance: number;
  maxSteerRad: number;
  /** Sink rate the gear absorbs without damage, m/s. */
  toleranceMs: number;
}

export interface ControlDefinition {
  elevatorMaxDeg: number;
  aileronUpMaxDeg: number;
  /** Down-going aileron travel as a fraction of the up-going one (differential ailerons). */
  aileronDownRatio: number;
  rudderMaxDeg: number;
  /** Actuator slew rate of every surface, deg/s. */
  surfaceRateDegS: number;
  /** Full flap travel, deg. Only meaningful when the wing has 'flap' elements (see hasFlaps). */
  flapMaxDeg?: number;
}

export interface AircraftDefinition {
  id: string;
  name: string;
  mass: {
    /** Empty aircraft + pilot + fixed payload. Fuel is separate so it can burn off. */
    items: MassItem[];
    fuelPosition: Vec3;
    fuelSize: Vec3;
    fuelCapacityL: number;
    fuelDensityKgL: number;
    /** Where cargo/passenger payload sits (a passenger seat, a cargo bay). Defaults to payload.ts's bay. */
    payloadPosition?: Vec3;
  };
  geometry: { wingAreaM2: number; wingspanM: number; meanChordM: number; wingAcPosition: Vec3 };
  aero: {
    airfoils: { wing: AirfoilSpec; tail: AirfoilSpec; fin: AirfoilSpec };
    elements: AeroElementSpec[];
    bluffBodies: BluffBodySpec[];
  };
  controls: ControlDefinition;
  engine: EngineDefinition | null;
  propeller: PropellerDefinition | null;
  gear: GearDefinition;
  /** Structural contact points (tips, nose, tail, canopy, belly) in BODY axes. */
  hardPoints: Array<{ id: 'wingtipL' | 'wingtipR' | 'nose' | 'tail' | 'canopy' | 'bellyFront' | 'bellyRear' | 'pilot' | 'passenger'; position: Vec3 }>;
  /** Airframe-specific structure for the damage system (strength scaling, contact-zone loads).
   * Absent = the generic ultralight tuning in sim/damageSystem.ts. */
  damage?: DamageStructure;
  /** Dotted-path -> provenance for every numeric parameter above. */
  provenance: Record<string, Provenance>;
}

/** Whether the definition has a flap system the pilot can deploy. */
export const hasFlaps = (def: AircraftDefinition) => def.aero.elements.some((e) => e.control?.kind === 'flap');

/** Lists the dotted path of every numeric leaf (arrays collapse to `name[]`). */
export function numericPaths(value: unknown, prefix = '', out: string[] = []): string[] {
  if (typeof value === 'number') {
    out.push(prefix);
  } else if (Array.isArray(value)) {
    const child = `${prefix}[]`;
    for (const v of value) numericPaths(v, child, out);
  } else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      if (k === 'provenance') continue;
      numericPaths(v, prefix ? `${prefix}.${k}` : k, out);
    }
  }
  return out;
}

/** Returns numeric parameters that have no provenance entry (matched by exact path or by ancestor). */
export function missingProvenance(def: AircraftDefinition): string[] {
  const missing = new Set<string>();
  for (const path of numericPaths(def)) {
    const parts = path.split('.');
    let covered = false;
    for (let i = parts.length; i > 0 && !covered; i--) {
      const key = parts.slice(0, i).join('.');
      covered = key in def.provenance || key.replace(/\[\]$/, '') in def.provenance;
    }
    if (!covered) missing.add(path);
  }
  return [...missing];
}
