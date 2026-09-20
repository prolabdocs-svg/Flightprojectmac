// Piston engine (spec section 16): RPM is a STATE integrated from torque balance, not a function
// of throttle.   I_e * dw/dt = Q_engine(rpm, throttle, density) - Q_friction(rpm) - Q_prop/gear (+ starter)
// Power follows a Gagg-Farrar-style curve g(x) = x + x^2 - x^3 (x = rpm / rated rpm), scaled by the
// throttle setting and by air density. Idle and redline are consequences of the balance plus a
// hard rev limiter, never a lookup of throttle.

import type { EngineDefinition } from '../aircraft/aircraftDefinition';

/** Normalised full-throttle power vs x = rpm / ratedRpm. Peaks a little above rated rpm. */
export const powerCurve = (x: number) => Math.max(0, x + x * x - x * x * x);

export type EngineState = 'off' | 'cranking' | 'running';

export class EngineModel {
  readonly def: EngineDefinition;
  rpm = 0;
  state: EngineState = 'off';
  powerW = 0;
  /** Torque the engine delivers at the crank after friction, N m. */
  netTorqueNm = 0;
  private readonly ratedOmega: number;

  constructor(def: EngineDefinition) {
    this.def = def;
    this.ratedOmega = (def.ratedRpm * 2 * Math.PI) / 60;
  }

  reset(): void {
    this.rpm = 0;
    this.state = 'off';
    this.powerW = 0;
    this.netTorqueNm = 0;
  }

  get omega(): number {
    return (this.rpm * 2 * Math.PI) / 60;
  }

  /**
   * @param loadTorqueNm prop load reflected to the crank (>0 = brakes the engine)
   * @param throttle 0..1, @param densityRatio rho/rho0, @param fuelAvailable > 0 to run
   * @returns rpm after the step
   */
  step(dt: number, throttle: number, densityRatio: number, loadTorqueNm: number, engineOn: boolean, fuelAvailable: boolean): number {
    const d = this.def;
    const canRun = engineOn && fuelAvailable;
    const omega = Math.max(this.omega, 0);
    let power = 0;
    let starter = 0;

    if (!canRun) {
      this.state = 'off';
    } else if (this.state === 'off') {
      this.state = 'cranking';
    }
    if (this.state === 'cranking') {
      starter = d.starterTorqueNm;
      if (this.rpm >= d.idleRpm * 0.85) this.state = 'running';
    }
    if (this.state === 'running') {
      const x = this.rpm / d.ratedRpm;
      const phi = d.idleThrottle + (1 - d.idleThrottle) * Math.max(0, Math.min(1, throttle));
      const sigma = Math.max(0.05, densityRatio);
      const lapse = 1 - d.altitudeLapse + d.altitudeLapse * Math.max(0, (sigma - 0.117) / 0.883);
      power = d.maxPowerKw * 1000 * powerCurve(x) * phi * lapse;
      // Hard rev limiter: fuel cut above redline (keeps the state bounded, feels like a real limiter).
      if (this.rpm > d.redlineRpm) power = 0;
    }
    this.powerW = power;
    const engineTorque = power / Math.max(omega, this.ratedOmega * 0.15);
    const xr = this.rpm / d.ratedRpm;
    const ratedTorque = (d.maxPowerKw * 1000) / this.ratedOmega;
    const friction = omega > 0.1 ? d.frictionFraction * ratedTorque * (0.4 + 0.6 * xr) : 0;
    this.netTorqueNm = engineTorque - friction;
    const inertia = Math.max(1e-3, d.inertiaKgM2);
    const domega = (this.netTorqueNm + starter - loadTorqueNm) / inertia;
    let omegaNew = omega + domega * dt;
    if (omegaNew < 0) omegaNew = 0;
    this.rpm = (omegaNew * 60) / (2 * Math.PI);
    if (this.state === 'running' && this.rpm < d.idleRpm * 0.4) this.state = 'off'; // stalled
    return this.rpm;
  }
}
