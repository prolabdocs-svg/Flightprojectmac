// Pilot intent -> physical surface deflections (spec sections 13-14).
// PilotCommand is normalised intent; the mixer turns it into per-surface targets in the
// lift-positive sense (see core/coordinates.ts); the actuators slew toward the targets at a
// finite rate and stop at the structural travel limits. Nothing here touches the rigid body: the
// deflections only change aerodynamic coefficients of the elements they belong to.

import { DEG } from '../core/constants';
import type { ControlDefinition } from '../aircraft/aircraftDefinition';
import type { SurfaceDeflections } from '../core/aircraftPhysics';

/** Normalised pilot intent. pitch > 0 nose up, roll > 0 right wing down, yaw > 0 nose right. */
export interface PilotCommand {
  pitch: number;
  roll: number;
  yaw: number;
  throttle: number;
  brake: number;
  flaps?: boolean;
}

export const NEUTRAL_COMMAND: PilotCommand = { pitch: 0, roll: 0, yaw: 0, throttle: 0, brake: 0, flaps: false };

const clamp1 = (v: number) => Math.max(-1, Math.min(1, v));

/** Pure mixer: target deflections in radians, lift-positive sense. Differential ailerons. */
export function mixSurfaces(cmd: PilotCommand, c: ControlDefinition, out: SurfaceDeflections): SurfaceDeflections {
  const p = clamp1(cmd.pitch);
  const r = clamp1(cmd.roll);
  const y = clamp1(cmd.yaw);
  const up = c.aileronUpMaxDeg * DEG;
  const down = up * c.aileronDownRatio;
  // Pitch up = trailing edge UP on the tail = lift-negative deflection.
  out.elevator = -p * c.elevatorMaxDeg * DEG;
  // Right wing down (r > 0): right aileron trailing edge up (lift-negative, full travel), left down (reduced).
  out.aileronRight = r > 0 ? -r * up : -r * down;
  out.aileronLeft = r > 0 ? r * down : r * up;
  out.rudder = y * c.rudderMaxDeg * DEG;
  out.flaps = cmd.flaps ? (c.flapMaxDeg ?? 25) * DEG : 0;
  return out;
}

export class SurfaceActuators {
  readonly position: SurfaceDeflections = { elevator: 0, aileronLeft: 0, aileronRight: 0, rudder: 0, flaps: 0 };
  private readonly limits: { elevator: number; aileronLeft: number; aileronRight: number; rudder: number; flaps: number };
  private readonly rateRad: number;

  constructor(defn: ControlDefinition) {
    const up = defn.aileronUpMaxDeg * DEG;
    this.limits = { elevator: defn.elevatorMaxDeg * DEG, aileronLeft: up, aileronRight: up, rudder: defn.rudderMaxDeg * DEG, flaps: (defn.flapMaxDeg ?? 25) * DEG };
    this.rateRad = defn.surfaceRateDegS * DEG;
  }

  reset(): void {
    this.position.elevator = this.position.aileronLeft = this.position.aileronRight = this.position.rudder = this.position.flaps = 0;
  }

  /** Slews every surface toward `target` by at most rate*dt and enforces travel limits. */
  step(target: SurfaceDeflections, dt: number): SurfaceDeflections {
    const maxStep = this.rateRad * dt;
    const p = this.position;
    const l = this.limits;
    p.elevator = slew(p.elevator, target.elevator, maxStep, l.elevator);
    p.aileronLeft = slew(p.aileronLeft, target.aileronLeft, maxStep, l.aileronLeft);
    p.aileronRight = slew(p.aileronRight, target.aileronRight, maxStep, l.aileronRight);
    p.rudder = slew(p.rudder, target.rudder, maxStep, l.rudder);
    p.flaps = slew(p.flaps ?? 0, target.flaps ?? 0, maxStep, l.flaps);
    return p;
  }
}

function slew(current: number, target: number, maxStep: number, limit: number): number {
  const t = Math.max(-limit, Math.min(limit, target));
  const d = t - current;
  return Math.abs(d) <= maxStep ? t : current + Math.sign(d) * maxStep;
}

/** Mixer + actuators as one unit. */
export class FlightControls {
  readonly actuators: SurfaceActuators;
  readonly target: SurfaceDeflections = { elevator: 0, aileronLeft: 0, aileronRight: 0, rudder: 0, flaps: 0 };
  private readonly defn: ControlDefinition;

  constructor(defn: ControlDefinition) {
    this.defn = defn;
    this.actuators = new SurfaceActuators(defn);
  }

  step(cmd: PilotCommand, dt: number): SurfaceDeflections {
    mixSurfaces(cmd, this.defn, this.target);
    return this.actuators.step(this.target, dt);
  }

  reset(): void {
    this.actuators.reset();
  }
}
