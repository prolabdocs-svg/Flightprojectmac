// Aerodynamic model (spec section 8). CL(alpha) rises linearly (thin-airfoil theory,
// finite-wing corrected), peaks at stall, then blends into the fully-separated flat-plate
// regime instead of a binary switch or an arbitrary plateau.

const AIR_DENSITY_SEA_LEVEL = 1.225; // kg/m^3

export function airDensityAtAltitude(altitudeM: number): number {
  // Isothermal-atmosphere approximation rho = rho0 * exp(-h/H). The standard scale height
  // for this model (H = R*T / (M*g) at ~288K) is ~8430m; 9000 is close enough for the
  // altitudes this arcade model ever reaches and keeps the constant simple.
  return AIR_DENSITY_SEA_LEVEL * Math.exp(-Math.max(0, altitudeM) / 9000);
}

export interface LiftDragSample {
  cl: number;
  cd: number;
}

// Thin-airfoil-theory 2D lift-curve slope (per radian): dCl/dalpha = 2*pi. This is the
// theoretical upper bound for an infinite (2D) wing section; every real, finite surface
// falls short of it by an amount that depends on how "slender" it is (its aspect ratio).
const THIN_AIRFOIL_SLOPE_PER_RAD = 2 * Math.PI;
// Oswald efficiency factor: how close a real finite wing's induced-drag/lift-slope
// behavior gets to the ideal (elliptical-loading) case. 0.8 is a typical value for a
// simple, unswept, moderate-taper light-aircraft wing or control surface (Raymer,
// "Aircraft Design: A Conceptual Approach", ch.12) - used here for every surface since
// none of them have distinct planform data beyond span/area.
const OSWALD_EFFICIENCY = 0.8;
// Fallback aspect ratio used only if a caller doesn't supply span/area (keeps the function
// usable standalone); chosen so the resulting slope matches this model's original
// hand-tuned constant (~4.2/rad) rather than silently changing behavior for callers that
// don't pass real geometry.
const DEFAULT_ASPECT_RATIO = 5;

/**
 * Finite-wing (Prandtl lifting-line) correction of the 2D lift-curve slope:
 *   a = a0 / (1 + a0 / (pi * AR * e))
 * A low-aspect-ratio panel (e.g. a rudder or a discrete aileron panel) genuinely produces
 * less lift per degree of angle of attack than a high-aspect-ratio wing of the same area -
 * this was previously not modeled at all (every surface shared one constant slope
 * regardless of shape).
 */
export function finiteWingLiftSlope(aspectRatio: number): number {
  const ar = Math.max(0.5, aspectRatio);
  return THIN_AIRFOIL_SLOPE_PER_RAD / (1 + THIN_AIRFOIL_SLOPE_PER_RAD / (Math.PI * ar * OSWALD_EFFICIENCY));
}

// Hoerner's measured flat-plate normal-force coefficient at 90 degrees incidence ("Fluid-
// Dynamic Lift", ch.3) - the physical ceiling fully-separated flow can push against a
// surface. Used as the deep-stall asymptote so CL correctly returns to 0 at 90 degrees
// (a flat plate broadside to the flow produces zero *lift*, only drag) instead of the
// previous model's incorrect plateau at ~35% of peak CL for any AoA up to 90 degrees.
const FLAT_PLATE_CN_MAX = 1.98;
// Width (degrees past stall) over which the model blends from the attached-flow curve
// into the fully-separated flat-plate curve - a smooth Viterna-style extrapolation
// (Viterna & Corrigan 1981; the same blend used for wind-turbine/propeller blade-element
// post-stall data) rather than a hard corner at the stall angle.
const POST_STALL_BLEND_RAD = (35 * Math.PI) / 180;

function smoothstep(t: number): number {
  const c = Math.max(0, Math.min(1, t));
  return c * c * (3 - 2 * c);
}

/**
 * Returns CL/CD for a given angle of attack (degrees), accounting for a soft stall that
 * blends into the fully-separated flat-plate regime.
 *
 * `aspectRatio` (span^2 / area) lets each named surface (wing, aileron panel, elevator,
 * rudder) get its own, geometry-derived lift-curve slope instead of one constant shared by
 * every surface regardless of shape - a rudder's low-aspect-ratio fin is genuinely less
 * lift-efficient per degree than the main wing, and this now falls out of its real span/
 * area data (parts.ts) rather than being hand-waved.
 */
export function liftDragCurve(
  aoaDeg: number,
  stallPositiveDeg: number,
  stallNegativeDeg: number,
  parasiticCd: number,
  inducedDragFactor: number,
  aspectRatio: number = DEFAULT_ASPECT_RATIO,
): LiftDragSample {
  const aoaRad = (aoaDeg * Math.PI) / 180;
  const clSlope = finiteWingLiftSlope(aspectRatio);
  const stallPosRad = (stallPositiveDeg * Math.PI) / 180;
  const stallNegRad = (stallNegativeDeg * Math.PI) / 180;

  const clMaxPos = clSlope * stallPosRad;
  const clMaxNeg = clSlope * stallNegRad;

  // Flat-plate cross-flow model (exact potential-flow result for a plate's normal-force
  // resolved into lift/drag axes): CN = CN_MAX * sin(a), CL = CN*cos(a), CD = CN*sin(a).
  // Correctly goes to CL=0 / CD=max at a=90 degrees, unlike a curve that only ever knows
  // about the attached-flow regime.
  const flatPlateCl = FLAT_PLATE_CN_MAX * Math.sin(aoaRad) * Math.cos(aoaRad);
  const flatPlateCd = FLAT_PLATE_CN_MAX * Math.sin(aoaRad) * Math.sin(aoaRad);

  let cl: number;
  let cd: number;

  if (aoaRad >= 0) {
    if (aoaRad <= stallPosRad) {
      cl = clSlope * aoaRad;
      cd = parasiticCd + inducedDragFactor * cl * cl;
    } else {
      const over = aoaRad - stallPosRad;
      // Immediate post-stall buffet: real airfoils don't instantly collapse to the deep-
      // stall asymptote, they retain a majority of CLmax right at stall onset and decay
      // from there as separation spreads (this exponential is the same shape the model
      // used before, just now feeding into a physically-bounded blend instead of standing
      // in as the final answer).
      const buffetFalloff = Math.exp(-over * 2.2);
      const attachedSideCl = clMaxPos * (0.6 + 0.4 * buffetFalloff);
      const t = smoothstep(over / POST_STALL_BLEND_RAD);
      cl = attachedSideCl * (1 - t) + flatPlateCl * t;
      // Drag can't be derived from CL in the separated regime (induced-drag theory assumes
      // attached flow); it must blend toward the flat-plate value directly, otherwise drag
      // would incorrectly fall toward ~0 alongside CL right when a stalled/spinning surface
      // should have its *highest* drag (separated flow, not lift, is what's dumping energy).
      const attachedSideCd = parasiticCd + inducedDragFactor * attachedSideCl * attachedSideCl;
      cd = attachedSideCd * (1 - t) + flatPlateCd * t;
    }
  } else {
    if (aoaRad >= stallNegRad) {
      cl = clSlope * aoaRad;
      cd = parasiticCd + inducedDragFactor * cl * cl;
    } else {
      const over = stallNegRad - aoaRad;
      const buffetFalloff = Math.exp(-over * 2.2);
      const attachedSideCl = clMaxNeg * (0.6 + 0.4 * buffetFalloff);
      const t = smoothstep(over / POST_STALL_BLEND_RAD);
      cl = attachedSideCl * (1 - t) + flatPlateCl * t;
      const attachedSideCd = parasiticCd + inducedDragFactor * attachedSideCl * attachedSideCl;
      cd = attachedSideCd * (1 - t) + flatPlateCd * t;
    }
  }

  return { cl, cd };
}

export function dynamicPressure(rho: number, speedMs: number): number {
  return 0.5 * rho * speedMs * speedMs;
}

// Ground-effect induced-drag reduction (Wieselsberger/McCormick formula, as given in
// McCormick's "Aerodynamics, Aeronautics and Flight Mechanics"):
//   k_ge(h/b) = (16*h/b)^2 / (1 + (16*h/b)^2)
// where h is height of the surface above the ground and b is its span. k_ge -> 1 far from
// the ground (no change) and -> 0 right at the surface (induced drag vanishes - the
// physical "ground cushion" effect real aircraft (and this game's arcade planes) feel
// during landing flare, letting the aircraft float just above the runway before touching
// down instead of sinking the instant speed bleeds off).
export function groundEffectInducedDragFactor(heightAboveGroundM: number, spanM: number): number {
  if (spanM <= 0) return 1;
  const ratio = (16 * Math.max(0, heightAboveGroundM)) / spanM;
  const ratioSq = ratio * ratio;
  return ratioSq / (1 + ratioSq);
}
