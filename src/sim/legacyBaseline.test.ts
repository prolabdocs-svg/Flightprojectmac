// Phase 0 baseline: measures the LEGACY FlightController with scripted flights so the new
// model can be compared against numbers instead of feel. Writes docs/flight/baseline_legacy.json
// only when WRITE_BASELINE=1. Deleted together with the legacy model.
import { describe, expect, it, vi } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createHarness, hold, type Sample } from './flightHarness';

// Flight simulations are CPU heavy; the default 5 s can be exceeded when the whole suite runs in parallel.
vi.setConfig({ testTimeout: 60_000 });

const rotate = (s: Sample | undefined) => ({ throttle: 1, pitch: s && s.airspeedMs > s.stallSpeedMs * 1.05 ? 0.6 : 0 });

async function airborne(altitudeM: number) {
  const h = await createHarness();
  h.run(9, rotate);
  for (let i = 0; i < 90 && h.log.at(-1)!.altitudeM < altitudeM; i++) h.run(1, (s) => ({ throttle: 1, ...hold(s, 8) }));
  h.run(4, (s) => ({ throttle: 0.65, ...hold(s, 0) }));
  return h;
}

describe('legacy baseline (Phase 0)', () => {
  it('records takeoff, climb, cruise, glide, stall and control-authority numbers', async () => {
    const out: Record<string, unknown> = { model: 'legacy FlightController @60Hz' };

    const t = await createHarness();
    let liftoff: Sample | undefined;
    for (let i = 0; i < 15 * 60 && !liftoff; i++) {
      const s = t.run(1 / 60, rotate);
      if (s.wheelsOnGround === 0 && s.altitudeM > 0.3) liftoff = s;
    }
    out.takeoff = { groundRollM: liftoff?.distanceM, liftoffKmh: (liftoff?.airspeedMs ?? 0) * 3.6, timeS: liftoff?.t };
    out.stallSpeedKmh_1g = t.log[0].stallSpeedMs * 3.6;

    const a = await airborne(60);
    const climb = a.run(8, (s) => ({ throttle: 1, ...hold(s, 8) }));
    out.climb = { vsMs: climb.verticalSpeedMs, kmh: climb.airspeedMs * 3.6 };
    const cruise = a.run(20, (s) => ({ throttle: 0.65, ...hold(s, 1) }));
    out.cruise = { kmh: cruise.airspeedMs * 3.6, vsMs: cruise.verticalSpeedMs };

    const glides: unknown[] = [];
    for (const pitch of [-2, -4, -6]) {
      const g = await airborne(120);
      g.run(2, { throttle: 0, engineOn: false, ...{ assistMode: 'standard' as const } });
      const s = g.run(15, (x) => ({ throttle: 0, engineOn: false, assistMode: 'standard' as const, ...hold(x, pitch) }));
      glides.push({ holdPitchDeg: pitch, kmh: s.airspeedMs * 3.6, sinkMs: -s.verticalSpeedMs, ratio: s.airspeedMs / Math.max(0.01, -s.verticalSpeedMs) });
    }
    out.powerOffGlide = glides;

    const auth: unknown[] = [];
    for (const throttle of [0.25, 0.65, 1]) {
      const h = await airborne(100);
      h.run(6, (s) => ({ throttle, ...hold(s, throttle > 0.9 ? -8 : 0) }));
      const pre = h.log.at(-1)!;
      // 'acro' = no bank limiter / auto-level, so this is the raw aileron response.
      const s = h.run(0.6, { throttle, roll: 1, assistMode: 'acro' });
      auth.push({ airspeedKmh: pre.airspeedMs * 3.6, rollDegIn0p6s: s.rollDeg - pre.rollDeg });
    }
    out.rollAuthority = auth;

    expect(Number.isFinite(climb.verticalSpeedMs)).toBe(true);
    if (process.env.WRITE_BASELINE === '1') {
      mkdirSync('docs/flight', { recursive: true });
      writeFileSync('docs/flight/baseline_legacy.json', JSON.stringify(out, null, 2) + '\n');
    }
    console.log(JSON.stringify(out, null, 2));
  }, 30_000); // scripted flights on the exact Rapier heightfield; slow under parallel load
});
