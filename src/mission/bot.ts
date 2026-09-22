// Scripted test pilot (master spec 72): flies a contract's route on the REAL flight model — takeoff,
// climb, navigate to the destination, glide-path approach, flare, brake — so the headless loop test
// exercises physics, fuel burn and mission events end to end. Not shipped in the game bundle: only
// tests import it. It does not need to fly well, only consistently.

import { compassBearingDeg, bearingDeltaDeg } from '../world/compass';
import type { ResolvedControls } from '../flight/flightTypes';
import type { Sample } from '../sim/flightHarness';

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export interface BotOptions {
  /** Cruise height above ground, m. */
  cruiseAglM?: number;
  cruiseSpeedMs?: number;
  /** Glide slope tangent and aim point short of the target centre (m), for the final approach. */
  glideSlope?: number;
  aimShortM?: number;
}

export class BotPilot {
  private readonly o: Required<BotOptions>;
  private readonly target: { x: number; z: number };
  private climbedOut = false;
  constructor(target: { x: number; z: number }, options: BotOptions = {}) {
    this.target = target;
    this.o = { cruiseAglM: 40, cruiseSpeedMs: 26, glideSlope: 0.075, aimShortM: 30, ...options };
  }

  distanceToTarget(s: Sample): number {
    return Math.hypot(s.position[0] - this.target.x, s.position[2] - this.target.z);
  }

  control(s: Sample | undefined): Partial<ResolvedControls> {
    if (!s) return { throttle: 1 };
    if (s.wheelsOnGround > 0 && (s.landed || s.state === 'groundRoll' || s.state === 'stopped')) return { throttle: 0, brake: true };

    const dist = this.distanceToTarget(s);
    const bearing = compassBearingDeg(this.target.x - s.position[0], this.target.z - s.position[2]);
    const turn = bearingDeltaDeg(bearing, s.headingDeg);
    const rollTarget = clamp(turn * 0.6, -18, 18);
    const rollCmd = clamp((rollTarget - s.rollDeg) * 0.08, -1, 1);
    const att = (pitchDeg: number, gain = 0.08) => clamp((pitchDeg - s.pitchDeg) * gain, -1, 1);

    // Takeoff roll: full power, rotate once flying speed is there, then climb out straight.
    if (s.altitudeM >= 15) this.climbedOut = true;
    if (!this.climbedOut) {
      const rotate = s.airspeedMs > s.stallSpeedMs * 1.05;
      return s.wheelsOnGround > 0 ? { throttle: 1, pitch: rotate ? 0.6 : 0 } : { throttle: 1, pitch: att(8), roll: 0 };
    }

    // Final approach: track a glide path that meets the ground a little short of the target centre.
    if (dist < 1100) {
      const pathAgl = Math.max(0, (dist - this.o.aimShortM) * this.o.glideSlope);
      if (s.altitudeM < 4) return { throttle: 0, pitch: att(6, 0.1), roll: rollCmd * 0.5 };
      const err = s.altitudeM - pathAgl;
      const pitchCmd = clamp(-3 - err * 0.25, -9, 8);
      const speedErr = 21 - s.airspeedMs;
      return { throttle: clamp(0.15 + speedErr * 0.1 + Math.max(0, -err) * 0.04, 0, 1), pitch: att(pitchCmd), roll: rollCmd };
    }

    // Cruise: hold height and speed, steer at the destination.
    const altErr = this.o.cruiseAglM - s.altitudeM;
    const throttle = clamp(0.65 + (this.o.cruiseSpeedMs - s.airspeedMs) * 0.08, 0.3, 1);
    return { throttle, pitch: att(clamp(altErr * 0.12, -4, 8)), roll: rollCmd };
  }
}
