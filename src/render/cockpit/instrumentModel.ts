// Instrument model for the Aerofox Kestrel 2 panel: FlightTelemetry -> what each gauge shows.
// Pure data, no three.js meshes. Smoothing here is presentation-only (needle inertia); the
// simulation never sees it.

import type { FlightTelemetry } from '../../flight/flightTypes';

export const KMH = 3.6, FT = 3.281, FPM = 196.85;

export interface EngineLimits { idleRpm: number; redlineRpm: number }

/** Raw targets, in instrument units. */
export interface InstrumentReadings {
  asiKmh: number;
  stallKmh: number;
  altFt: number;
  rpm: number;
  vsiFpm: number;
  fuel: number;      // 0..1
  cht: number;       // fraction of limit, 1 = limit
  slip: number;      // -1..1 ball offset, + = ball right
  headingDeg: number;
  runLamp: boolean;
  stallLamp: boolean;
  fuelLamp: boolean;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const fin = (v: number | undefined, d = 0) => (v !== undefined && Number.isFinite(v) ? v : d);

export function readInstruments(t: FlightTelemetry): InstrumentReadings {
  // Ball = lateral specific force. Airborne that is carried by sideslip (sideforce ~ beta);
  // on the ground at rest it is gravity across a banked airframe.
  const airborne = !t.onGround && t.airspeedMs > 5;
  const slip = airborne ? fin(t.sideslipDeg) / 12 : Math.sin(fin(t.rollDeg) * Math.PI / 180) * 1.5;
  return {
    asiKmh: Math.max(0, fin(t.airspeedMs) * KMH),
    stallKmh: fin(t.stallSpeedMs) * KMH,
    // Altimeter set to field elevation (QFE): reads height above the ground under the aircraft,
    // the same altitude the HUD and the mission rules use.
    altFt: Math.max(0, fin(t.altitudeM) * FT),
    rpm: Math.max(0, fin(t.rpm)),
    vsiFpm: fin(t.verticalSpeedMs) * FPM,
    fuel: clamp(fin(t.fuelFraction), 0, 1),
    cht: Math.max(0, fin(t.engineTempFrac)),
    slip: clamp(slip, -1, 1),
    headingDeg: fin(t.headingDeg),
    runLamp: t.engineOn,
    stallLamp: t.stallWarning || t.stalled,
    fuelLamp: fin(t.fuelFraction) < 0.15,
  };
}

/** Second-order needle: spring toward the target with damping ratio `zeta`. */
export class Needle {
  value: number;
  private vel = 0;
  private readonly omega: number;
  private readonly zeta: number;
  constructor(omega: number, zeta = 1, initial = 0) { this.omega = omega; this.zeta = zeta; this.value = initial; }
  update(target: number, dtS: number) {
    // Sub-step so a 100 ms frame hitch can't make a stiff needle overshoot or diverge.
    const steps = Math.max(1, Math.ceil(dtS * this.omega / 0.5));
    const h = dtS / steps;
    for (let i = 0; i < steps; i++) {
      const acc = this.omega * this.omega * (target - this.value) - 2 * this.zeta * this.omega * this.vel;
      this.vel += acc * h;
      this.value += this.vel * h;
    }
    return this.value;
  }
  snap(v: number) { this.value = v; this.vel = 0; }
}

/** Unwraps a 0..360 heading into a continuous angle so the compass card never spins the long way. */
export function unwrapDeg(prev: number, next: number) {
  return prev + ((((next - prev) % 360) + 540) % 360) - 180;
}

/** Linear dial mapping: value -> needle angle (radians, clockwise from 12 o'clock). */
export function dialAngle(v: number, min: number, max: number, fromDeg: number, toDeg: number) {
  const k = clamp((v - min) / (max - min), 0, 1);
  return (fromDeg + (toDeg - fromDeg) * k) * Math.PI / 180;
}
