// Fixed-pitch propeller (spec sections 16-17). Thrust and absorbed power come from the
// non-dimensional coefficients Ct(J), Cp(J) with J = V/(n D):
//     T = Ct rho n^2 D^4        P = Cp rho n^3 D^5        Q = P / (2 pi n)
// x = J / J0 (J0 = advance ratio at zero thrust). Ct falls to 0 at x = 1 and goes negative beyond
// (a windmilling prop is a brake); Cp falls more slowly and reverses past x ~ 1.1 (the air drives
// the prop). Thrust therefore lapses with airspeed and the engine unloads (rpm rises) as V grows.

import type { PropellerDefinition } from '../aircraft/aircraftDefinition';

export const ctShape = (x: number) => 1 - x * x;
export const cpShape = (x: number) => 1 - 0.3 * x - 0.55 * x * x;

export interface PropellerOutput {
  thrustN: number;
  /** Shaft torque absorbed from the engine (N m, > 0 = load; < 0 = windmilling drives the engine). */
  torqueNm: number;
  advanceRatio: number;
  /** Ideal momentum-theory induced speed at the disc, m/s. */
  inducedMs: number;
}

export class PropellerModel {
  readonly def: PropellerDefinition;
  readonly discArea: number;

  constructor(def: PropellerDefinition) {
    this.def = def;
    this.discArea = Math.PI * (def.diameterM / 2) ** 2;
  }

  /** @param rps propeller revolutions per second (>= 0), @param axialMs airspeed along the shaft (+ = flow from ahead) */
  evaluate(rps: number, axialMs: number, rho: number, out: PropellerOutput): PropellerOutput {
    const d = this.def;
    const D = d.diameterM;
    if (rps < 0.05) {
      out.thrustN = 0; out.torqueNm = 0; out.advanceRatio = 0; out.inducedMs = 0;
      return out;
    }
    const j = axialMs / (rps * D);
    const x = Math.max(0, Math.min(1.6, j / d.j0));
    const ct = d.ct0 * ctShape(x);
    const cp = d.cp0 * cpShape(x);
    const n2 = rps * rps;
    out.thrustN = ct * rho * n2 * D ** 4;
    out.torqueNm = (cp * rho * n2 * D ** 5) / (2 * Math.PI);
    out.advanceRatio = j;
    // v_i from T = 2 rho A v_i (V + v_i)
    const t = Math.max(0, out.thrustN);
    const v = Math.max(0, axialMs);
    out.inducedMs = -v / 2 + Math.sqrt((v * v) / 4 + t / (2 * rho * this.discArea));
    return out;
  }
}
