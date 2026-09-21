import { describe, expect, it } from 'vitest';
import { estimatePerformance } from './performance';
import { defaultBuild, installPart } from '../content/assembly';

const perf = (build = defaultBuild()) => estimatePerformance(build);

describe('estimatePerformance', () => {
  it('puts the starter ultralight in its target envelope', () => {
    const p = perf();
    // The estimate now comes from the flown physics (heavier reference aircraft: it carries a pilot).
    expect(p.stallSpeedKmh).toBeGreaterThan(50);
    expect(p.stallSpeedKmh).toBeLessThan(62);
    expect(p.cruiseSpeedKmh).toBeGreaterThan(80);
    expect(p.cruiseSpeedKmh).toBeLessThan(100);
    expect(p.topSpeedKmh).toBeGreaterThan(p.cruiseSpeedKmh);
    expect(p.topSpeedKmh).toBeLessThan(125);
    expect(p.takeoffRollM).toBeGreaterThan(40);
    expect(p.takeoffRollM).toBeLessThan(110);
    expect(p.climbRateMs).toBeGreaterThan(2);
    expect(p.rangeKm).toBeGreaterThan(3);
    expect(p.rangeKm).toBeLessThan(5.5);
  });

  it('shows upgrades as measurable deltas', () => {
    const base = perf();
    expect(perf(installPart(defaultBuild(), 'fuelTank', 'tank_12')).rangeKm).toBeGreaterThan(base.rangeKm * 1.35);
    const engine = perf(installPart(defaultBuild(), 'engine', 'engine_medium'));
    expect(engine.climbRateMs).toBeGreaterThan(base.climbRateMs);
    expect(engine.takeoffRollM).toBeLessThan(base.takeoffRollM);
    expect(perf(installPart(defaultBuild(), 'wingSet', 'wing_b_highlift')).stallSpeedKmh).toBeLessThan(base.stallSpeedKmh);
    expect(perf(installPart(defaultBuild(), 'landingGear', 'gear_reinforced')).gearToleranceMs).toBeGreaterThan(base.gearToleranceMs);
  });
});
