// Ground effect (spec section 20): continuous in height, never a boolean.
// Induced-drag factor from Wieselsberger/McCormick: phi = (16h/b)^2 / (1 + (16h/b)^2)
// (phi -> 1 far from the ground, -> 0 at the surface). Lift gains up to `LIFT_GAIN_MAX` at zero
// height (the "ground cushion"), fading with the same phi. Wing downwash on the tail is scaled
// by phi too, which is what produces the real nose-down change in the flare.

const LIFT_GAIN_MAX = 0.1; // ESTIMATED

export function groundInducedFactor(wingHeightM: number, wingspanM: number): number {
  if (wingspanM <= 0) return 1;
  const r = (16 * Math.max(0, wingHeightM)) / wingspanM;
  const r2 = r * r;
  return r2 / (1 + r2);
}

export function groundLiftGain(phi: number): number {
  return LIFT_GAIN_MAX * (1 - phi);
}
