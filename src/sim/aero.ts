// Simplified aerodynamic model (spec section 8). CL(alpha) rises ~linearly, peaks, then
// falls off progressively past stall instead of a binary switch.

const AIR_DENSITY_SEA_LEVEL = 1.225; // kg/m^3

export function airDensityAtAltitude(altitudeM: number): number {
  // Simple exponential falloff, gameplay abstraction (spec 8.10).
  return AIR_DENSITY_SEA_LEVEL * Math.exp(-Math.max(0, altitudeM) / 9000);
}

export interface LiftDragSample {
  cl: number;
  cd: number;
}

/**
 * Returns CL/CD for a given angle of attack (degrees), accounting for a soft stall.
 * clSlopePerRad ~ 2*PI theoretical thin airfoil; we scale down for arcade feel.
 */
export function liftDragCurve(
  aoaDeg: number,
  stallPositiveDeg: number,
  stallNegativeDeg: number,
  parasiticCd: number,
  inducedDragFactor: number,
): LiftDragSample {
  const aoaRad = (aoaDeg * Math.PI) / 180;
  const clSlope = 4.2; // per radian, tuned for arcade responsiveness
  const stallPosRad = (stallPositiveDeg * Math.PI) / 180;
  const stallNegRad = (stallNegativeDeg * Math.PI) / 180;

  let cl: number;
  const clMaxPos = clSlope * stallPosRad;
  const clMaxNeg = clSlope * stallNegRad;

  if (aoaRad >= 0) {
    if (aoaRad <= stallPosRad) {
      cl = clSlope * aoaRad;
    } else {
      // Post-stall progressive falloff toward ~40% of peak.
      const over = aoaRad - stallPosRad;
      const falloff = Math.exp(-over * 2.2);
      cl = clMaxPos * (0.35 + 0.65 * falloff);
    }
  } else {
    if (aoaRad >= stallNegRad) {
      cl = clSlope * aoaRad;
    } else {
      const over = stallNegRad - aoaRad;
      const falloff = Math.exp(-over * 2.2);
      cl = clMaxNeg * (0.35 + 0.65 * falloff);
    }
  }

  const cd = parasiticCd + inducedDragFactor * cl * cl;
  return { cl, cd };
}

export function dynamicPressure(rho: number, speedMs: number): number {
  return 0.5 * rho * speedMs * speedMs;
}
