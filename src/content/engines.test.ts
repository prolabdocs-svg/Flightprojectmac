// Engine line: every engine a frame accepts must fly on that frame, and each family must FEEL different in the
// flight model (not only on the spec sheet): turbine spool lag, air-cooled heat, turbo altitude power, 4-stroke economy.
import { describe, expect, it, vi } from 'vitest';
import { FRAMES, getPart } from './parts';
import { ENGINE_CHARACTER, ENGINE_PARTS, getEngineCharacter } from './engines';
import { TECH_NODES } from './techtree';
import { estimatePerformance } from '../sim/performance';
import { definitionFor } from '../flight/analysis/performance';
import { levelPerformance, summarize } from '../flight/analysis/performance';
import { createHarness, hold } from '../sim/flightHarness';
import type { AircraftBuild } from '../core/types';

vi.setConfig({ testTimeout: 120_000 });

const buildWith = (frameId: string, engine: string): AircraftBuild => {
  const f = FRAMES.find((x) => x.id === frameId)!;
  return { frameId, installed: { ...f.defaultLoadout, engine } };
};

describe('engine catalogue', () => {
  it('every engine part has a character, a tech unlock and at least one frame', () => {
    for (const p of ENGINE_PARTS) {
      expect(ENGINE_CHARACTER[p.id], p.id).toBeDefined();
      expect(TECH_NODES.some((n) => n.unlocksPartIds.includes(p.id) && n.id === p.requiresTechId), p.id).toBe(true);
      expect(FRAMES.some((f) => f.hardpoints.some((h) => h.accepts.includes(p.id))), p.id).toBe(true);
    }
    expect(getEngineCharacter('rotax_582').headColor).toBe('#1f5fd0'); // the Blue Head is blue
    expect(getEngineCharacter('unknown').layout).toBe('stock');
  });

  it('the Rotax ladder climbs 447 < 503 < 582 < 912 < 914 on the Trailblazer', () => {
    const climb = ['rotax_447', 'rotax_503', 'rotax_582', 'rotax_912', 'rotax_914'].map((e) => estimatePerformance(buildWith('frame_trailblazer', e)).climbRateMs);
    for (let i = 1; i < climb.length; i++) expect(climb[i]).toBeGreaterThan(climb[i - 1]);
  });

  it('the 912 four-stroke goes further on a tank than the equally powerful two-strokes', () => {
    const r912 = estimatePerformance(buildWith('frame_trailblazer', 'rotax_912')).enduranceMin;
    const r582 = estimatePerformance(buildWith('frame_trailblazer', 'rotax_582')).enduranceMin;
    const r3203 = estimatePerformance(buildWith('frame_trailblazer', 'hirth_3203')).enduranceMin;
    expect(r912).toBeGreaterThan(r582 * 1.15);
    expect(r912).toBeGreaterThan(r3203 * 1.15);
  });

  it('turbojets are the fastest and the thirstiest', () => {
    const tj = estimatePerformance(buildWith('frame_trailblazer', 'turbojet_tj100'));
    const r914 = estimatePerformance(buildWith('frame_trailblazer', 'rotax_914'));
    expect(tj.topSpeedKmh).toBeGreaterThan(r914.topSpeedKmh + 25);
    expect(tj.enduranceMin).toBeLessThan(r914.enduranceMin);
  });

  it('the 914 turbo keeps its climb at 3000 m where the 912 chokes', () => {
    const at = (e: string, alt: number) => summarize(levelPerformance(definitionFor(buildWith('frame_trailblazer', e)), Array.from({ length: 30 }, (_, i) => 16 + i), 1, alt)).bestClimbMs;
    const keep914 = at('rotax_914', 3000) / at('rotax_914', 0);
    const keep912 = at('rotax_912', 3000) / at('rotax_912', 0);
    expect(keep914).toBeGreaterThan(keep912 + 0.15);
  });
});

describe('engines in the real flight model', () => {
  const cases: Array<[string, string]> = [];
  for (const f of FRAMES) for (const id of f.hardpoints.find((h) => h.category === 'engine')!.accepts) if (getPart(id)?.id.match(/rotax|hirth|turbo/)) cases.push([f.id, id]);

  it.each(cases)('%s + %s takes off, climbs and holds level flight', async (frameId, engine) => {
    const h = await createHarness({ build: buildWith(frameId, engine) });
    let s = h.run(14, (x) => ({ throttle: 1, pitch: x && x.airspeedMs > x.stallSpeedMs * 1.1 ? 0.5 : 0 }));
    for (let i = 0; i < 30 && s.altitudeM < 40; i++) s = h.run(1, (x) => ({ throttle: 1, ...hold(x, 7) }));
    expect(s.altitudeM, 'reached 40 m').toBeGreaterThan(40);
    s = h.run(12, (x) => ({ throttle: 0.7, ...hold(x, 1) }));
    expect(s.crashed).toBe(false);
    expect(Math.abs(s.rollDeg)).toBeLessThan(15);
    expect(s.airspeedMs).toBeGreaterThan(s.stallSpeedMs * 1.1);
  });

  it('a turbojet lags the throttle: little thrust 1 s after slamming it open, full thrust after 6 s', async () => {
    const h = await createHarness({ build: buildWith('frame_trailblazer', 'turbojet_tj100') });
    h.run(6, { throttle: 0, brake: true }); // light-off to idle
    h.run(1, { throttle: 1, brake: true });
    const early = h.fc.sim.propulsion!.thrustN;
    h.run(6, { throttle: 1, brake: true });
    const late = h.fc.sim.propulsion!.thrustN;
    expect(early).toBeLessThan(late * 0.6);
    expect(late).toBeGreaterThan(1000);
  });

  it('a free-air Hirth held at full power on the ground overheats and derates; the liquid-cooled 582 does not', async () => {
    const run = async (engine: string) => {
      const h = await createHarness({ build: buildWith('frame_zero', engine) });
      const s = h.run(75, { throttle: 1, brake: true }); // an 8 L tank lasts ~90 s at full power
      return s;
    };
    const hirth = await run('hirth_f23');
    const blue = await run('rotax_582');
    expect(hirth.engineTempFrac!).toBeGreaterThan(1);
    expect(hirth.engineDerate!).toBeLessThan(0.97);
    expect(blue.engineTempFrac!).toBeLessThan(0.95);
    expect(blue.engineDerate).toBe(1);
  });
});
