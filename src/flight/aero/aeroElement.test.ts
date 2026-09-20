import { describe, expect, it } from 'vitest';
import { AeroContext, AeroElement, BluffBody, newElementResult, type AeroElementSpec } from './aeroElement';
import { AirfoilTable, finiteWingSlope, flapEffectiveness, type AirfoilSpec } from './airfoil';
import { groundInducedFactor } from './groundEffect';
import { DEG } from '../core/constants';

const AR = 6.75;
const profile: AirfoilSpec = {
  clAlpha: finiteWingSlope(AR),
  alphaZeroRad: -4 * DEG,
  stallPosRad: 19 * DEG,
  stallNegRad: -12 * DEG,
  sepWidthRad: 2.2 * DEG,
  cd0: 0.03,
  cmAc: -0.08,
};
const table = new AirfoilTable(profile);

const wingSpec = (over: Partial<AeroElementSpec> = {}): AeroElementSpec => ({
  id: 'w', group: 'wing', position: [0, 0, 0], areaM2: 12, chordM: 1.33, spanM: 9, orientation: 'up',
  incidenceDeg: 0, dihedralDeg: 0, outboard: 0, clAlpha: profile.clAlpha, effectiveAr: AR, oswald: 0.8,
  downwashFactor: 0, propwashImmersion: 0, damageId: 'wing_root_main', ...over,
});

const flyAt = (speed: number, alphaDeg: number, ctx = new AeroContext()) => {
  // body velocity for a given AoA: alpha>0 => vy<0
  ctx.vz = speed * Math.cos(alphaDeg * DEG);
  ctx.vy = -speed * Math.sin(alphaDeg * DEG);
  return ctx;
};

describe('airfoil table', () => {
  it('has a rounded CLmax, then loses lift progressively (no cliff), returning to ~0 at 90 deg', () => {
    expect(table.clMax).toBeGreaterThan(1.2);
    expect(table.clMax).toBeLessThan(2.0);
    const s = (deg: number) => AirfoilTable.evaluate(profile, deg * DEG);
    expect(s(30).cl).toBeLessThan(table.clMax);
    expect(s(20).cl).toBeLessThan(s(14).cl + 0.001);
    expect(Math.abs(s(90).cl)).toBeLessThan(0.05);
    // continuity: no step bigger than 0.15 CL per 0.5 deg anywhere
    for (let d = -180; d < 180; d += 0.5) expect(Math.abs(s(d + 0.5).cl - s(d).cl)).toBeLessThan(0.15);
    expect(s(90).cd).toBeGreaterThan(1.5);
  });
  it('is linear pre-stall with the finite-wing slope and zero lift at alpha0', () => {
    expect(AirfoilTable.evaluate(profile, profile.alphaZeroRad).cl).toBeCloseTo(0, 6);
    const dcl = AirfoilTable.evaluate(profile, 6 * DEG).cl - AirfoilTable.evaluate(profile, 4 * DEG).cl;
    expect(dcl / (2 * DEG)).toBeCloseTo(profile.clAlpha, 0);
  });
  it('finite-wing slope drops with lower aspect ratio; flap effectiveness rises with chord fraction', () => {
    expect(finiteWingSlope(3)).toBeLessThan(finiteWingSlope(8));
    expect(flapEffectiveness(0.3)).toBeGreaterThan(flapEffectiveness(0.15));
    expect(flapEffectiveness(0.3)).toBeGreaterThan(0.5);
    expect(flapEffectiveness(0.3)).toBeLessThan(0.8);
  });
});

describe('AeroElement (Phase 1 gate: a single wing produces coherent forces)', () => {
  it('lift = q S CL and points up for a level wing; scales with V^2', () => {
    const el = new AeroElement(wingSpec(), table);
    el.setCg([0, 0, 0]);
    const out = newElementResult();
    const c1 = flyAt(20, 5);
    el.compute(c1, out);
    const cl = AirfoilTable.evaluate(profile, 5 * DEG).cl;
    expect(out.liftN).toBeCloseTo(0.5 * 1.225 * 400 * 12 * cl, 0);
    expect(out.cl).toBeCloseTo(cl, 4);
    const f20 = out.fy;
    expect(f20).toBeGreaterThan(0);
    el.compute(flyAt(40, 5), out);
    expect(out.fy / f20).toBeGreaterThan(3.9); // ~4x, drag tilt makes it slightly less than exactly 4
    expect(out.fy / f20).toBeLessThan(4.1);
  });

  it('drag opposes motion and includes induced drag k CL^2', () => {
    const el = new AeroElement(wingSpec(), table);
    el.setCg([0, 0, 0]);
    const out = newElementResult();
    const ctx = flyAt(25, 6);
    el.compute(ctx, out);
    expect(out.dx * ctx.vx + out.dy * ctx.vy + out.dz * ctx.vz).toBeLessThan(0);
    const t = AirfoilTable.evaluate(profile, 6 * DEG);
    expect(out.cd).toBeCloseTo(t.cd + (1 / (Math.PI * 0.8 * AR)) * t.cl * t.cl, 4);
  });

  it('measures airspeed relative to the AIR, not the ground (wind cancels velocity)', () => {
    const el = new AeroElement(wingSpec(), table);
    el.setCg([0, 0, 0]);
    const out = newElementResult();
    const ctx = flyAt(20, 5);
    ctx.windZ = 20 * Math.cos(5 * DEG);
    ctx.windY = -20 * Math.sin(5 * DEG);
    el.compute(ctx, out);
    expect(out.fy).toBeCloseTo(0, 6);
    expect(out.airspeedMs).toBeLessThan(1e-6);
  });

  it('alpha is positive when the flow arrives from below, negative from above', () => {
    const el = new AeroElement(wingSpec(), table);
    el.setCg([0, 0, 0]);
    const out = newElementResult();
    el.compute(flyAt(20, 8), out);
    expect(out.alphaRad).toBeCloseTo(8 * DEG, 5);
    el.compute(flyAt(20, -3), out);
    expect(out.alphaRad).toBeCloseTo(-3 * DEG, 5);
  });

  it('roll rate makes the opposite wing panels see different flow: roll damping emerges from w x r', () => {
    const left = new AeroElement(wingSpec({ id: 'L', position: [2, 0, 0], outboard: 1 }), table);
    const right = new AeroElement(wingSpec({ id: 'R', position: [-2, 0, 0], outboard: -1 }), table);
    left.setCg([0, 0, 0]); right.setCg([0, 0, 0]);
    const ctx = flyAt(22, 5);
    ctx.wz = 1; // p = +1 rad/s (right wing down)
    const a = newElementResult(); const b = newElementResult();
    left.compute(ctx, a); right.compute(ctx, b);
    expect(b.alphaRad).toBeGreaterThan(a.alphaRad); // right wing moves down -> higher alpha
    expect(b.liftN).toBeGreaterThan(a.liftN);
    expect(a.mz + b.mz).toBeLessThan(0); // net moment opposes the roll
  });

  it('a cambered wing behind... a fin weathercocks: sideslip to the right yaws the nose right', () => {
    const fin = new AeroElement(wingSpec({ id: 'VT', group: 'vtail', orientation: 'side', position: [0, 0.8, -4], areaM2: 0.8, chordM: 0.6, effectiveAr: 1.5, clAlpha: finiteWingSlope(1.5) }), table);
    fin.setCg([0, 0, 0]);
    const out = newElementResult();
    const ctx = new AeroContext();
    ctx.vz = 20; ctx.vx = -3; // velocity toward the RIGHT wing (-X): beta > 0
    fin.compute(ctx, out);
    expect(out.fx).toBeGreaterThan(0); // fin pushes the tail left ...
    expect(-out.my).toBeGreaterThan(0); // ... so r = -wy dot > 0: nose right, toward the flow
  });

  it('a deflected control changes lift in the +delta sense and fades when the section stalls', () => {
    const spec = wingSpec({ control: { kind: 'aileron', chordFraction: 0.3, spanFraction: 1 } });
    const el = new AeroElement(spec, table);
    el.setCg([0, 0, 0]);
    const out = newElementResult();
    el.compute(flyAt(22, 4), out);
    const base = out.cl;
    el.deflectionRad = 10 * DEG;
    el.compute(flyAt(22, 4), out);
    expect(out.cl).toBeGreaterThan(base + 0.2);
    el.deflectionRad = 0;
    el.compute(flyAt(22, 30), out);
    const stalledBase = out.cl;
    el.deflectionRad = 10 * DEG;
    el.compute(flyAt(22, 30), out);
    expect(out.cl - stalledBase).toBeLessThan(0.5 * (0.25 * 5 * 0.6 * 10 * DEG * 6));
  });

  it('produces no force in still air and never NaN under extreme rates', () => {
    const el = new AeroElement(wingSpec(), table);
    el.setCg([0, 0, 0]);
    const out = newElementResult();
    el.compute(new AeroContext(), out);
    expect(out.fx + out.fy + out.fz).toBe(0);
    const ctx = flyAt(60, 40);
    ctx.wx = 9; ctx.wy = -9; ctx.wz = 9;
    el.compute(ctx, out);
    expect(Number.isFinite(out.fx + out.fy + out.fz + out.mx + out.my + out.mz)).toBe(true);
  });

  it('ground effect: induced-drag factor is continuous, ~1 aloft, ~0 on the ground', () => {
    expect(groundInducedFactor(50, 9)).toBeGreaterThan(0.99);
    expect(groundInducedFactor(0, 9)).toBe(0);
    let prev = 0;
    for (let h = 0; h <= 12; h += 0.25) {
      const v = groundInducedFactor(h, 9);
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
  });

  it('BluffBody drag opposes relative flow per axis', () => {
    const b = new BluffBody({ id: 'pod', position: [0, 0, 0], cdA: [0.5, 0.6, 0.2] });
    b.setCg([0, 0, 0]);
    const out = newElementResult();
    const ctx = new AeroContext();
    ctx.vz = 20; ctx.vx = 5;
    b.compute(ctx, out);
    expect(out.fz).toBeLessThan(0);
    expect(out.fx).toBeLessThan(0);
  });
});
