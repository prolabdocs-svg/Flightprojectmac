// Pure numeric mappings from flight-sim state -> audio parameters (spec 150).
// No Web Audio types on purpose: audioService wires these into AudioParams
// with setTargetAtTime, but the mapping math itself is unit-tested here
// without needing a real AudioContext (unavailable in jsdom).

const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));

/** 0..1 position between idle and redline rpm (clamped both ends). */
export function rpmFraction(rpm: number, idleRpm: number, redlineRpm: number): number {
  if (redlineRpm <= idleRpm) return 0;
  return clamp01((rpm - idleRpm) / (redlineRpm - idleRpm));
}

/** A single-cylinder 2-stroke fires once per revolution, so its buzzy
 * fundamental tone is literally rpm/60 Hz — no artistic fudge needed. */
export function engineFundamentalHz(rpm: number): number {
  return Math.max(0, rpm) / 60;
}

/** Timbre brightens (more high-harmonic content) as rpm climbs toward redline. */
export function engineFilterCutoffHz(rpmFrac: number): number {
  return 300 + clamp01(rpmFrac) * 3200;
}

/** Loudness follows applied throttle (load), not just rpm — a lugging engine
 * under load reads louder than one idling at the same rpm. Silent when off. */
export function engineGain(throttle: number, engineOn: boolean): number {
  if (!engineOn) return 0;
  return 0.05 + clamp01(throttle) * 0.22;
}

/** Two-blade propeller blade-pass whoosh center frequency, scaled into an
 * audible sweep across the rpm range. */
export function propWhooshHz(rpm: number): number {
  const bladePassHz = (Math.max(0, rpm) / 60) * 2;
  return 150 + bladePassHz * 4;
}

export function propWhooshGain(rpmFrac: number, engineOn: boolean): number {
  if (!engineOn) return 0;
  return clamp01(rpmFrac) * 0.12;
}

/** Wind noise rises with airspeed, roughly quadratic like real aero hiss. */
export function windGain(airspeedMs: number, maxAirspeedMs = 45): number {
  const frac = clamp01(airspeedMs / maxAirspeedMs);
  return frac * frac * 0.35;
}

export function windFilterCutoffHz(airspeedMs: number, maxAirspeedMs = 45): number {
  return 500 + clamp01(airspeedMs / maxAirspeedMs) * 4500;
}

/** Rolling ground rumble: silent airborne, scales with ground speed while rolling. */
export function rumbleGain(onGround: boolean, groundSpeedMs: number, maxGroundSpeedMs = 30): number {
  if (!onGround) return 0;
  return clamp01(groundSpeedMs / maxGroundSpeedMs) * 0.25;
}

/** Intermittent stall horn: a clear on/off pulse while warning, silent otherwise. */
export function stallHornGain(stallWarning: boolean, timeSeconds: number, pulseHz = 3): number {
  if (!stallWarning) return 0;
  return Math.sin(timeSeconds * Math.PI * 2 * pulseHz) > 0 ? 0.3 : 0;
}

/** Maps touchdown vertical sink rate to a 0..1 event intensity for
 * playEvent('touchdown' | 'hardLanding', intensity) — a ~0.5 m/s greaser vs.
 * a multi-m/s damaging arrival. */
export function sinkRateToIntensity(sinkRateMs: number, maxSinkRateMs = 5): number {
  return clamp01(Math.abs(sinkRateMs) / maxSinkRateMs);
}
