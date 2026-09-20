// Flight assistance layer (spec section 24). It sits BETWEEN the pilot and the control mixer: it
// only edits the normalised PilotCommand (pitch/roll/yaw). Whatever it asks for still has to be
// achieved by the physical surfaces, so authority limits, stalls and airflow apply exactly as they
// do in the Simulation mode. This file must never touch the rigid body (enforced by a test).
//
//   simulation : pilot command passes through unchanged.
//   assisted   : input shaping/rate limit, partial auto-coordination, rate dampers, soft bank
//                limit, turn back-pressure, stall WARNING.
//   arcade     : all of the above stronger, plus wings-level, pitch-attitude hold, pitch/bank
//                limits and stall PROTECTION (AoA limiter).

import type { PilotCommand } from './flightControls';

export type AssistLevel = 'simulation' | 'assisted' | 'arcade';

/** Existing UI/save enum -> physics assistance level (see FLIGHT_SYSTEM_AUDIT.md section 7). */
export function assistLevelFromMode(mode: 'assisted' | 'standard' | 'acro'): AssistLevel {
  return mode === 'assisted' ? 'arcade' : mode === 'standard' ? 'assisted' : 'simulation';
}

export interface AssistState {
  /** Right wing down positive, rad. */
  bankRad: number;
  /** Nose up positive, rad. */
  pitchRad: number;
  /** Body rates (aeronautical): p roll, q pitch, r yaw, rad/s. */
  p: number;
  q: number;
  r: number;
  betaRad: number;
  airspeedMs: number;
  /** Margin to the AoA of CLmax (rad). */
  stallMarginRad: number;
  onGround: boolean;
}

interface Tuning {
  /** Max stick change per second (input shaping / anti over-control). Infinity = off. */
  commandRate: number;
  coordination: number;
  damperP: number;
  damperQ: number;
  damperR: number;
  /** Wings-level gain (aileron per rad of bank) when the roll stick is released. */
  levelGain: number;
  bankLimitRad: number;
  /** Pitch-attitude hold gain (elevator per rad) and rate damping, active when the pitch stick is released. */
  pitchHold: number;
  pitchLimitUpRad: number;
  pitchLimitDownRad: number;
  /** Fraction of the level-turn back pressure applied automatically. */
  turnComp: number;
  /** Stall protection strength (0 = warning only) and the margin at which it starts (rad). */
  stallProtect: number;
  stallWarnMarginRad: number;
}

const D = Math.PI / 180;
const TUNING: Record<AssistLevel, Tuning> = {
  simulation: { commandRate: Infinity, coordination: 0, damperP: 0, damperQ: 0, damperR: 0, levelGain: 0, bankLimitRad: 0, pitchHold: 0, pitchLimitUpRad: 0, pitchLimitDownRad: 0, turnComp: 0, stallProtect: 0, stallWarnMarginRad: 0 },
  assisted: { commandRate: 6, coordination: 2.5, damperP: 0.12, damperQ: 0.12, damperR: 0.25, levelGain: 0, bankLimitRad: 80 * D, pitchHold: 0, pitchLimitUpRad: 0, pitchLimitDownRad: 0, turnComp: 0.6, stallProtect: 0, stallWarnMarginRad: 4 * D },
  arcade: { commandRate: 4, coordination: 4, damperP: 0.2, damperQ: 0.2, damperR: 0.4, levelGain: 1.4, bankLimitRad: 60 * D, pitchHold: 2.2, pitchLimitUpRad: 30 * D, pitchLimitDownRad: 25 * D, turnComp: 1, stallProtect: 1, stallWarnMarginRad: 5 * D },
};

const clamp = (v: number, lo = -1, hi = 1) => Math.max(lo, Math.min(hi, v));
const DEAD = 0.06;

export class FlightAssistance {
  level: AssistLevel = 'simulation';
  /** True when the AoA is inside the warning margin (drives HUD/audio). */
  stallWarning = false;
  /** True while protection is actively limiting pitch. */
  protecting = false;
  private pitchRef = 0;
  private lastPitch = 0;
  private lastRoll = 0;
  private lastYaw = 0;

  reset(): void {
    this.pitchRef = 0;
    this.lastPitch = this.lastRoll = this.lastYaw = 0;
    this.stallWarning = this.protecting = false;
  }

  setLevel(level: AssistLevel): void {
    this.level = level;
  }

  /** Writes the assisted command into `out` (may alias `cmd`). */
  apply(cmd: PilotCommand, s: AssistState, dt: number, out: PilotCommand): PilotCommand {
    const t = TUNING[this.level];
    out.throttle = cmd.throttle;
    out.brake = cmd.brake;
    this.stallWarning = false;
    this.protecting = false;
    if (this.level === 'simulation') {
      out.pitch = cmd.pitch; out.roll = cmd.roll; out.yaw = cmd.yaw;
      return out;
    }

    // --- input shaping: limit how fast the stick may move ---
    const step = t.commandRate * dt;
    const pitchIn = slew(this.lastPitch, cmd.pitch, step);
    const rollIn = slew(this.lastRoll, cmd.roll, step);
    const yawIn = slew(this.lastYaw, cmd.yaw, step);
    this.lastPitch = pitchIn; this.lastRoll = rollIn; this.lastYaw = yawIn;

    const airborne = !s.onGround;
    // Aerodynamic effectiveness fade: below ~15 m/s the dampers would just fight the mush.
    const q = clamp((s.airspeedMs - 8) / 12, 0, 1);

    // --- roll ---
    let roll = rollIn;
    if (airborne) {
      if (t.levelGain > 0 && Math.abs(rollIn) < DEAD) roll += clamp(-t.levelGain * s.bankRad) * q;
      if (t.bankLimitRad > 0 && Math.sign(roll) === Math.sign(s.bankRad) && Math.abs(s.bankRad) > t.bankLimitRad - 0.3) {
        roll *= clamp((t.bankLimitRad - Math.abs(s.bankRad)) / 0.3, 0, 1);
      }
      roll -= t.damperP * s.p * q;
    }

    // --- pitch ---
    let pitch = pitchIn;
    if (airborne) {
      const cosB = Math.max(0.5, Math.cos(s.bankRad));
      const turnPitch = 0.19 * (1 / cosB - 1) * t.turnComp;
      if (t.pitchHold > 0) {
        if (Math.abs(pitchIn) >= DEAD) this.pitchRef = s.pitchRad;
        else pitch += clamp(t.pitchHold * (this.pitchRef + turnPitch - s.pitchRad) - 0.6 * s.q) * q;
      } else if (turnPitch > 0) {
        pitch += clamp(turnPitch * 4) * q;
      }
      if (t.pitchLimitUpRad > 0) {
        if (pitch > 0 && s.pitchRad > t.pitchLimitUpRad - 0.15) pitch *= clamp((t.pitchLimitUpRad - s.pitchRad) / 0.15, 0, 1);
        if (pitch < 0 && s.pitchRad < -t.pitchLimitDownRad + 0.15) pitch *= clamp((s.pitchRad + t.pitchLimitDownRad) / 0.15, 0, 1);
      }
      pitch -= t.damperQ * s.q * q;

      // --- stall warning / protection (AoA margin from the wing itself) ---
      if (s.stallMarginRad < t.stallWarnMarginRad) this.stallWarning = true;
      if (t.stallProtect > 0 && s.stallMarginRad < t.stallWarnMarginRad) {
        this.protecting = true;
        const depth = clamp((t.stallWarnMarginRad - s.stallMarginRad) / t.stallWarnMarginRad, 0, 1.5);
        if (pitch > -0.6) pitch = Math.min(pitch, 0.5 - 1.6 * t.stallProtect * depth);
        this.pitchRef = Math.min(this.pitchRef, s.pitchRad - 0.02);
      }
    }

    // --- yaw: auto-coordination + damper (also active on the ground for the damper-free case: off) ---
    let yaw = yawIn;
    if (airborne) {
      yaw += clamp(t.coordination * s.betaRad) * q;
      yaw -= t.damperR * s.r * q;
    }

    out.pitch = clamp(pitch);
    out.roll = clamp(roll);
    out.yaw = clamp(yaw);
    return out;
  }
}

function slew(current: number, target: number, maxStep: number): number {
  const d = target - current;
  return Math.abs(d) <= maxStep ? target : current + Math.sign(d) * maxStep;
}
