import type { RunwaySurface } from './airfields';

export interface LandingTelemetry {
  verticalSpeedMs: number;
  groundSpeedMs: number;
  rollDeg: number;
  pitchDeg: number;
  crosswindMs: number;
}

export interface RunwayConditions {
  surface: RunwaySurface;
  /** 0 (billiard-smooth tarmac) to 1 (very rough). */
  roughness: number;
}

export interface LandingResult {
  pass: boolean;
  /** 0 (crash-tier) to 1 (greaser). */
  qualityScore: number;
  failures: string[];
}

/** Per-surface tolerance multipliers: rougher/looser surfaces forgive a bit more
 * vertical speed and roll than tarmac, but never make an outright dangerous
 * touchdown pass. */
const SURFACE_TOLERANCE: Record<RunwaySurface, number> = {
  tarmac: 1,
  grass: 1.1,
  dirt: 1.15,
  gravel: 1.05,
  salt: 0.95,
};

const MAX_VERTICAL_SPEED_MS = 3.5;
const MAX_ROLL_DEG = 12;
const MAX_PITCH_DEG = 15;
const MIN_PITCH_DEG = -5;
const MAX_CROSSWIND_MS = 9;

/** Pure landing-quality evaluator (GDD world-graph foundation). Intentionally has no
 * dependency on physics/rendering — callers pass in already-sampled touchdown
 * telemetry and get back a pass/fail plus a 0..1 quality score. */
export function validateLanding(telemetry: LandingTelemetry, runway: RunwayConditions): LandingResult {
  const tolerance = SURFACE_TOLERANCE[runway.surface];
  const roughnessPenalty = 1 + runway.roughness * 0.4;

  const maxVerticalSpeed = MAX_VERTICAL_SPEED_MS * tolerance;
  const maxRoll = MAX_ROLL_DEG * tolerance;
  const maxCrosswind = MAX_CROSSWIND_MS * tolerance;

  const failures: string[] = [];

  const absVerticalSpeed = Math.abs(telemetry.verticalSpeedMs);
  if (absVerticalSpeed > maxVerticalSpeed) failures.push('verticalSpeed');

  const absRoll = Math.abs(telemetry.rollDeg);
  if (absRoll > maxRoll) failures.push('roll');

  if (telemetry.pitchDeg > MAX_PITCH_DEG || telemetry.pitchDeg < MIN_PITCH_DEG) failures.push('pitch');

  const absCrosswind = Math.abs(telemetry.crosswindMs);
  if (absCrosswind > maxCrosswind) failures.push('crosswind');

  if (telemetry.groundSpeedMs < 0) failures.push('groundSpeed');

  // Quality: 1 at a gentle, centered touchdown, decaying toward 0 as each factor
  // approaches (or exceeds) its limit. Clamped so an outright failure never reads
  // as a good landing even if one factor happens to be mild.
  const verticalSpeedScore = clamp01(1 - absVerticalSpeed / maxVerticalSpeed);
  const rollScore = clamp01(1 - absRoll / maxRoll);
  const pitchCenter = (MAX_PITCH_DEG + MIN_PITCH_DEG) / 2;
  const pitchRange = (MAX_PITCH_DEG - MIN_PITCH_DEG) / 2;
  const pitchScore = clamp01(1 - Math.abs(telemetry.pitchDeg - pitchCenter) / pitchRange);
  const crosswindScore = clamp01(1 - absCrosswind / maxCrosswind);

  const rawScore =
    (verticalSpeedScore * 0.4 + rollScore * 0.25 + pitchScore * 0.15 + crosswindScore * 0.2) / roughnessPenalty;

  const pass = failures.length === 0;
  const qualityScore = clamp01(pass ? rawScore : rawScore * 0.3);

  return { pass, qualityScore, failures };
}

function clamp01(value: number): number {
  if (Number.isNaN(value)) return 0;
  return Math.min(1, Math.max(0, value));
}
