import { describe, expect, it } from 'vitest';
import { validateLanding } from './landingValidator';

const smoothTarmac = { surface: 'tarmac' as const, roughness: 0.1 };
const roughGrass = { surface: 'grass' as const, roughness: 0.6 };

describe('validateLanding', () => {
  it('passes a gentle, centered touchdown with a high quality score', () => {
    const result = validateLanding(
      { verticalSpeedMs: -0.5, groundSpeedMs: 20, rollDeg: 1, pitchDeg: 5, crosswindMs: 1 },
      smoothTarmac,
    );
    expect(result.pass).toBe(true);
    expect(result.failures).toEqual([]);
    expect(result.qualityScore).toBeGreaterThan(0.7);
  });

  it('fails on excessive vertical speed', () => {
    const result = validateLanding(
      { verticalSpeedMs: -8, groundSpeedMs: 20, rollDeg: 0, pitchDeg: 5, crosswindMs: 0 },
      smoothTarmac,
    );
    expect(result.pass).toBe(false);
    expect(result.failures).toContain('verticalSpeed');
  });

  it('fails on excessive roll', () => {
    const result = validateLanding(
      { verticalSpeedMs: -0.5, groundSpeedMs: 20, rollDeg: 30, pitchDeg: 5, crosswindMs: 0 },
      smoothTarmac,
    );
    expect(result.pass).toBe(false);
    expect(result.failures).toContain('roll');
  });

  it('fails on pitch outside the acceptable band', () => {
    const nosedive = validateLanding(
      { verticalSpeedMs: -0.5, groundSpeedMs: 20, rollDeg: 0, pitchDeg: -20, crosswindMs: 0 },
      smoothTarmac,
    );
    expect(nosedive.pass).toBe(false);
    expect(nosedive.failures).toContain('pitch');

    const tailstrike = validateLanding(
      { verticalSpeedMs: -0.5, groundSpeedMs: 20, rollDeg: 0, pitchDeg: 25, crosswindMs: 0 },
      smoothTarmac,
    );
    expect(tailstrike.pass).toBe(false);
    expect(tailstrike.failures).toContain('pitch');
  });

  it('fails on excessive crosswind', () => {
    const result = validateLanding(
      { verticalSpeedMs: -0.5, groundSpeedMs: 20, rollDeg: 0, pitchDeg: 5, crosswindMs: 20 },
      smoothTarmac,
    );
    expect(result.pass).toBe(false);
    expect(result.failures).toContain('crosswind');
  });

  it('a rougher, less tolerant runway lowers the quality score for the same telemetry', () => {
    const telemetry = { verticalSpeedMs: -1.5, groundSpeedMs: 20, rollDeg: 4, pitchDeg: 5, crosswindMs: 3 };
    const onTarmac = validateLanding(telemetry, smoothTarmac);
    const onRoughGrass = validateLanding(telemetry, roughGrass);
    expect(onRoughGrass.qualityScore).toBeLessThan(onTarmac.qualityScore);
  });

  it('a failed landing never scores as a good one', () => {
    const result = validateLanding(
      { verticalSpeedMs: -10, groundSpeedMs: 20, rollDeg: 40, pitchDeg: 5, crosswindMs: 0 },
      smoothTarmac,
    );
    expect(result.pass).toBe(false);
    expect(result.qualityScore).toBeLessThan(0.3);
  });

  it('derives surface tolerance from GROUND_SURFACES, keeping tarmac strictest', () => {
    // Tolerance is now computed from GROUND_SURFACES' brakingGripDry/bumpiness (surfaces.ts)
    // rather than hand-picked literals, so a rough/low-grip surface should score a marginal
    // touchdown better than tarmac (more forgiving), and rougher surfaces should be at least
    // as forgiving as less-rough ones.
    const marginal = { verticalSpeedMs: -3.2, groundSpeedMs: 20, rollDeg: 10, pitchDeg: 5, crosswindMs: 8 };
    const tarmacResult = validateLanding(marginal, { surface: 'tarmac', roughness: 0.1 });
    const grassResult = validateLanding(marginal, { surface: 'grass', roughness: 0.1 });
    const gravelResult = validateLanding(marginal, { surface: 'gravel', roughness: 0.1 });

    expect(grassResult.qualityScore).toBeGreaterThan(tarmacResult.qualityScore);
    expect(gravelResult.qualityScore).toBeGreaterThanOrEqual(grassResult.qualityScore);
  });

  it('flags a negative ground speed as invalid telemetry', () => {
    const result = validateLanding(
      { verticalSpeedMs: -0.5, groundSpeedMs: -5, rollDeg: 0, pitchDeg: 5, crosswindMs: 0 },
      smoothTarmac,
    );
    expect(result.failures).toContain('groundSpeed');
  });
});
