// Touchdown severity from physical quantities (spec section 22), not "collision = crash".

export type TouchdownClass = 'normal' | 'firm' | 'hard' | 'gearOverstress' | 'structuralImpact' | 'catastrophic';

export interface TouchdownInput {
  /** Descent rate at first wheel contact, m/s (> 0 = sinking). */
  sinkMs: number;
  /** Sink rate the gear is rated to absorb, m/s. */
  toleranceMs: number;
  /** Airframe (not wheels) touched the ground at speed. */
  structuralStrike: boolean;
  bankDeg: number;
  pitchDeg: number;
  groundSpeedMs: number;
}

export function classifyTouchdown(t: TouchdownInput): TouchdownClass {
  const r = t.sinkMs / Math.max(0.1, t.toleranceMs);
  if (r >= 3.2 || (t.structuralStrike && t.groundSpeedMs > 14)) return 'catastrophic';
  if (t.structuralStrike || Math.abs(t.bankDeg) > 30 || t.pitchDeg < -12) return 'structuralImpact';
  if (r >= 1.8) return 'gearOverstress';
  if (r >= 1) return 'hard';
  if (r >= 0.6) return 'firm';
  return 'normal';
}
