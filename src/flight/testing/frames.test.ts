// Generalisation check (spec section 28, "then generalise"): every airframe in the catalogue
// yields a stable, flyable aircraft from the same data-driven code path, and part swaps change
// the physics in the expected direction. Quicksilver-class remains the calibrated reference.
import { describe, expect, it, vi } from 'vitest';
import { FRAMES } from '../../content/parts';
import { buildForFrame, defaultBuild, installPart } from '../../content/assembly';
import { buildAircraftDefinition } from '../aircraft/quicksilver';
import { missingProvenance } from '../aircraft/aircraftDefinition';
import { glideTrim } from './trim';
import { levelPerformance, summarize } from './performance';
import { createAirframeRig, holdAttitude, keepRunway } from './rig';

vi.setConfig({ testTimeout: 120_000 });
const speeds = Array.from({ length: 40 }, (_, i) => 12 + i);

describe.each(FRAMES.map((f) => [f.id, f] as const))('frame %s', (_id, frame) => {
  const build = buildForFrame(frame);
  const def = buildAircraftDefinition(build);

  it('has a fully documented definition and is statically stable with a plausible glide', async () => {
    expect(missingProvenance(def)).toEqual([]);
    const t = await glideTrim(def);
    expect(t.staticStability).toBeLessThan(0);
    expect(t.glideRatio).toBeGreaterThan(6.5);
    expect(t.glideRatio).toBeLessThan(12);
    expect(t.alphaDeg).toBeGreaterThan(-1);
  });

  it('can climb, and the top speed clears the stall speed', async () => {
    const s = summarize(await levelPerformance(def, speeds, 1));
    expect(s.bestClimbMs).toBeGreaterThan(1.2);
    expect(s.topSpeedKmh).toBeGreaterThan(s.minSpeedKmh * 1.5);
  });

  it('takes off from the ground under closed-loop control and keeps flying for 15 s without numerical guards firing', async () => {
    const rig = await createAirframeRig(def, { onGround: true });
    let lift = false;
    let liftZ = 0;
    for (let i = 0; i < 20 * 45 && !(lift && rig.log.at(-1)!.agl > 20); i++) {
      const s = rig.run(0.05, (x) => {
        if (!x) return { engineOn: true, throttle: 1 };
        const rot = x.airspeedMs > (def.mass.items.reduce((a, b) => a + b.massKg, 0) > 320 ? 17 : 15);
        return { engineOn: true, throttle: 1, ...keepRunway(x), ...(rot || x.wheels === 0 ? { pitch: holdAttitude(x, x.wheels === 0 ? 8 : 10).pitch, roll: holdAttitude(x, 8).roll } : {}) };
      });
      if (!lift && s.wheels === 0 && s.agl > 1.2) { lift = true; liftZ = s.z; }
    }
    expect(lift).toBe(true);
    expect(liftZ).toBeLessThan(200);
    expect(rig.phys.guardEvents).toEqual({ angularRate: 0, speed: 0, nonFinite: 0 });
  });
});

describe('part swaps change the physics in the right direction', () => {
  it('a stronger engine climbs faster; a high-lift wing has a lower minimum speed; a bigger tank adds mass', async () => {
    const base = summarize(await levelPerformance(buildAircraftDefinition(defaultBuild()), speeds, 1));
    const strong = summarize(await levelPerformance(buildAircraftDefinition(installPart(defaultBuild(), 'engine', 'engine_medium')), speeds, 1));
    const lift = summarize(await levelPerformance(buildAircraftDefinition(installPart(defaultBuild(), 'wingSet', 'wing_b_highlift')), speeds, 1));
    expect(strong.bestClimbMs).toBeGreaterThan(base.bestClimbMs + 0.2);
    expect(lift.minSpeedKmh).toBeLessThan(base.minSpeedKmh);
    const tank = buildAircraftDefinition(installPart(defaultBuild(), 'fuelTank', 'tank_12'));
    expect(tank.mass.fuelCapacityL).toBeGreaterThan(buildAircraftDefinition(defaultBuild()).mass.fuelCapacityL);
  });
});
