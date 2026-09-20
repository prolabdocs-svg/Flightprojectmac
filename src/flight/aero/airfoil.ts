// Sampled airfoil coefficient tables (spec sections 9-12): alpha -> CL, CD, CM and a separation
// state, over the full +-180 deg range so post-stall and reversed flow are always defined.
//
// Attached flow is linear in alpha. Trailing-edge separation is a Kirchhoff-style logistic
// separation-point function f(alpha) (1 = attached, 0 = fully separated) which gives a rounded
// CLmax, a progressive lift loss and an aft centre-of-pressure shift (nose-down break). Deep
// post-stall blends smoothly into the flat-plate normal-force regime (Viterna-style), so CL returns
// to 0 and CD to its maximum at 90 deg. Induced drag is NOT in the table: it depends on the
// element's aspect ratio and on ground effect, so the element adds k*CL^2 itself.

export interface AirfoilSpec {
  /** Attached lift-curve slope, 1/rad (finite-wing corrected by the caller). */
  clAlpha: number;
  /** Zero-lift angle of attack, rad (negative for a cambered section). */
  alphaZeroRad: number;
  /** Positive-side separation centre (f = 0.5), rad. CLmax occurs a few degrees before it. */
  stallPosRad: number;
  /** Negative-side separation centre, rad (< 0). */
  stallNegRad: number;
  /** Logistic width of the separation transition, rad. Small = abrupt stall, large = docile. */
  sepWidthRad: number;
  /** Profile (zero-lift) drag coefficient. */
  cd0: number;
  /** Pitching-moment coefficient about the aerodynamic centre (quarter chord), attached. */
  cmAc: number;
}

/** Hoerner: normal-force coefficient of a flat plate normal to the flow. */
const CN_FLAT_PLATE = 1.98;
const STEP_RAD = (0.5 * Math.PI) / 180;
const N = Math.round((2 * Math.PI) / STEP_RAD) + 1;

const smoothstep = (t: number) => {
  const c = Math.min(1, Math.max(0, t));
  return c * c * (3 - 2 * c);
};
const logistic = (x: number) => 1 / (1 + Math.exp(-Math.max(-30, Math.min(30, x))));

export interface AirfoilSample {
  cl: number;
  cd: number;
  cm: number;
  /** 0 = fully attached, 1 = fully separated. */
  sep: number;
}

export class AirfoilTable {
  private readonly cl = new Float32Array(N);
  private readonly cd = new Float32Array(N);
  private readonly cm = new Float32Array(N);
  private readonly sepArr = new Float32Array(N);
  readonly clMax: number;
  readonly alphaClMaxRad: number;
  readonly clMin: number;

  readonly spec: AirfoilSpec;

  constructor(spec: AirfoilSpec) {
    this.spec = spec;
    let clMax = -Infinity;
    let clMin = Infinity;
    let aMax = 0;
    for (let i = 0; i < N; i++) {
      const a = -Math.PI + i * STEP_RAD;
      const s = AirfoilTable.evaluate(spec, a);
      this.cl[i] = s.cl;
      this.cd[i] = s.cd;
      this.cm[i] = s.cm;
      this.sepArr[i] = s.sep;
      if (Math.abs(a) < 0.6 && s.cl > clMax) {
        clMax = s.cl;
        aMax = a;
      }
      if (Math.abs(a) < 0.6 && s.cl < clMin) clMin = s.cl;
    }
    this.clMax = clMax;
    this.clMin = clMin;
    this.alphaClMaxRad = aMax;
  }

  /** Analytic evaluation used to fill the table (exposed for tests). */
  static evaluate(s: AirfoilSpec, alpha: number): AirfoilSample {
    const w = s.sepWidthRad;
    const fPos = 1 - logistic((alpha - s.stallPosRad) / w);
    const fNeg = 1 - logistic((s.stallNegRad - alpha) / w);
    const f = fPos * fNeg;
    const sep = 1 - f;
    const clAttached = s.clAlpha * (alpha - s.alphaZeroRad);
    const clKirchhoff = clAttached * ((1 + Math.sqrt(f)) / 2) ** 2;
    const edge = alpha >= 0 ? s.stallPosRad : -s.stallNegRad;
    const sigma = smoothstep((Math.abs(alpha) - edge - 0.15) / 0.7);
    const sinA = Math.sin(alpha);
    const clPlate = CN_FLAT_PLATE * sinA * Math.cos(alpha);
    const cl = clKirchhoff * (1 - sigma) + clPlate * sigma;
    const cd = s.cd0 + sep * CN_FLAT_PLATE * sinA * sinA;
    const cm = s.cmAc * (1 - sigma) - 0.2 * sep * cl;
    return { cl, cd, cm, sep };
  }

  /** Linear interpolation of the table. `out` is overwritten (no allocation). */
  sample(alphaRad: number, out: AirfoilSample): AirfoilSample {
    let a = alphaRad;
    if (a > Math.PI || a < -Math.PI) a = a - 2 * Math.PI * Math.floor((a + Math.PI) / (2 * Math.PI));
    const x = (a + Math.PI) / STEP_RAD;
    const i = Math.min(N - 2, Math.max(0, Math.floor(x)));
    const t = x - i;
    out.cl = this.cl[i] + (this.cl[i + 1] - this.cl[i]) * t;
    out.cd = this.cd[i] + (this.cd[i + 1] - this.cd[i]) * t;
    out.cm = this.cm[i] + (this.cm[i + 1] - this.cm[i]) * t;
    out.sep = this.sepArr[i] + (this.sepArr[i + 1] - this.sepArr[i]) * t;
    return out;
  }
}

const cache = new Map<string, AirfoilTable>();
export function getAirfoilTable(spec: AirfoilSpec): AirfoilTable {
  const key = JSON.stringify(spec);
  let t = cache.get(key);
  if (!t) {
    t = new AirfoilTable(spec);
    cache.set(key, t);
  }
  return t;
}

/**
 * Prandtl finite-wing lift slope: a = a0 / (1 + a0 / (pi * AR * e)).
 * a0 is the 2D section slope (thin airfoil 2*pi; real sections ~5.7-6.0/rad).
 */
export function finiteWingSlope(aspectRatio: number, a0 = 5.9, oswald = 0.8): number {
  const ar = Math.max(0.5, aspectRatio);
  return a0 / (1 + a0 / (Math.PI * ar * oswald));
}

/** Plain-flap effectiveness tau(cf/c) from thin-airfoil theory (Glauert): 1 - (theta - sin theta)/pi. */
export function flapEffectiveness(chordFraction: number): number {
  const cf = Math.min(0.9, Math.max(0.02, chordFraction));
  const theta = Math.acos(2 * cf - 1);
  return 1 - (theta - Math.sin(theta)) / Math.PI;
}
