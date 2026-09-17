export interface FixedStepFrame {
  readonly steps: number;
  readonly alpha: number;
  readonly frameDtS: number;
  readonly droppedTimeS: number;
}

/**
 * Fixed-rate simulation scheduler decoupled from display refresh rate.
 *
 * The simulation consumes `steps * fixedDtS`; rendering can interpolate with `alpha`.
 * Pathological catch-up is bounded and excess whole-step time is dropped so a mobile
 * browser returning from a stall/background cannot enter a spiral of death.
 */
export class FixedStepClock {
  private accumulatorS = 0;
  readonly fixedDtS: number;
  readonly maxFrameDtS: number;
  readonly maxStepsPerFrame: number;

  constructor(fixedDtS = 1 / 60, maxFrameDtS = 0.1, maxStepsPerFrame = 8) {
    if (!(fixedDtS > 0)) throw new Error('fixedDtS must be > 0');
    if (!(maxFrameDtS > 0)) throw new Error('maxFrameDtS must be > 0');
    if (!Number.isInteger(maxStepsPerFrame) || maxStepsPerFrame < 1) {
      throw new Error('maxStepsPerFrame must be a positive integer');
    }
    this.fixedDtS = fixedDtS;
    this.maxFrameDtS = maxFrameDtS;
    this.maxStepsPerFrame = maxStepsPerFrame;
  }

  reset(): void {
    this.accumulatorS = 0;
  }

  advance(rawFrameDtS: number): FixedStepFrame {
    const finiteDt = Number.isFinite(rawFrameDtS) ? rawFrameDtS : 0;
    const frameDtS = Math.min(this.maxFrameDtS, Math.max(0, finiteDt));
    this.accumulatorS += frameDtS;

    const availableSteps = Math.floor((this.accumulatorS + Number.EPSILON) / this.fixedDtS);
    const steps = Math.min(availableSteps, this.maxStepsPerFrame);
    this.accumulatorS -= steps * this.fixedDtS;

    let droppedTimeS = 0;
    if (availableSteps > this.maxStepsPerFrame) {
      const fractional = ((this.accumulatorS % this.fixedDtS) + this.fixedDtS) % this.fixedDtS;
      droppedTimeS = Math.max(0, this.accumulatorS - fractional);
      this.accumulatorS = fractional;
    }

    return {
      steps,
      alpha: Math.max(0, Math.min(1, this.accumulatorS / this.fixedDtS)),
      frameDtS,
      droppedTimeS,
    };
  }
}
