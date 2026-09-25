// Fixed-pitch propeller + engine matching shared by every aircraft builder: the propeller is pitched so it
// absorbs the engine's rated power at rated rpm at the design advance ratio, and the idle throttle is the
// setting that holds idle rpm against the propeller + friction load (throttle 0 must idle, not stall or race).

import { cpShape, ctShape } from '../propulsion/propeller';
import { powerCurve } from '../propulsion/engine';

const RHO0 = 1.225;

export interface PropMatchInput {
  powerKw: number;
  ratedRpm: number;
  idleRpm: number;
  gearRatio: number;
  diameterM: number;
  /** Propeller efficiency at the design advance ratio. */
  efficiency: number;
  frictionFraction: number;
  /** Advance ratio of best match (rated power absorbed) and of zero thrust. */
  designJ?: number;
  j0?: number;
}

export interface PropMatch {
  j0: number;
  cp0: number;
  ct0: number;
  idleThrottle: number;
  ratedOmega: number;
  ratedTorqueNm: number;
}

export function matchFixedPitchPropeller(p: PropMatchInput): PropMatch {
  const designJ = p.designJ ?? 0.43;
  const j0 = p.j0 ?? 0.65;
  const xd = designJ / j0;
  const rps = p.ratedRpm / p.gearRatio / 60;
  const cp0 = (p.powerKw * 1000) / (cpShape(xd) * RHO0 * rps ** 3 * p.diameterM ** 5);
  const ct0 = (cp0 * p.efficiency * cpShape(xd)) / (designJ * ctShape(xd));
  const idleRps = p.idleRpm / p.gearRatio / 60;
  const idleX = p.idleRpm / p.ratedRpm;
  const idlePowerNeed = cp0 * RHO0 * idleRps ** 3 * p.diameterM ** 5 + p.frictionFraction * p.powerKw * 1000 * (0.4 + 0.6 * idleX) * idleX;
  const idleThrottle = Math.min(0.35, idlePowerNeed / (p.powerKw * 1000 * powerCurve(idleX)));
  const ratedOmega = (p.ratedRpm * 2 * Math.PI) / 60;
  return { j0, cp0, ct0, idleThrottle, ratedOmega, ratedTorqueNm: (p.powerKw * 1000) / ratedOmega };
}

/** Rated (continuous) rpm of a catalogue engine: just under redline. */
export const ratedRpmFor = (redlineRpm: number) => Math.min(redlineRpm * 0.94, redlineRpm - 200);
