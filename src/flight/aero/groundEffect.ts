// Ground effect (spec section 20): continuous in height, never a boolean.
// Induced-drag factor from Wieselsberger/McCormick: phi = (16h/b)^2 / (1 + (16h/b)^2)
// (phi -> 1 far from the ground, -> 0 at the surface). Lift gains up to `LIFT_GAIN_MAX` at zero
// height (the "ground cushion"), fading exponentially with h/b. Wing downwash on the tail is scaled
// by phi too, which is what produces the real nose-down change in the flare.

const LIFT_GAIN_MAX = 0.16; // lift gain at zero height (ESTIMATED; real wings: ~10-20% within h/b < 0.1)
const LIFT_GAIN_SCALE = 0.12; // h/b e-folding of the lift gain

export function groundInducedFactor(wingHeightM: number, wingspanM: number): number {
  if (wingspanM <= 0) return 1;
  const r = (16 * Math.max(0, wingHeightM)) / wingspanM;
  const r2 = r * r;
  return r2 / (1 + r2);
}

/** Fractional CL gain, continuous in h/b: LIFT_GAIN_MAX * exp(-(h/b)/LIFT_GAIN_SCALE). */
export function groundLiftGain(wingHeightM: number, wingspanM: number): number {
  if (wingspanM <= 0) return 0;
  return LIFT_GAIN_MAX * Math.exp(-Math.max(0, wingHeightM) / wingspanM / LIFT_GAIN_SCALE);
}
