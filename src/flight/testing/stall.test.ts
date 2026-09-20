// Phase 4 gate: stall and recovery emerge from angle of attack and the coefficient curves.
import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { defaultBuild } from '../../content/assembly';
import { buildAircraftDefinition } from '../aircraft/quicksilver';
import { getAirfoilTable } from '../aero/airfoil';
import { createAirframeRig, type RigSample } from './rig';
import { glideTrim } from './trim';
import { DEG } from '../core/constants';

// Flight simulations are CPU heavy; the default 5 s can be exceeded when the whole suite runs in parallel.
vi.setConfig({ testTimeout: 60_000 });

const def = buildAircraftDefinition(defaultBuild());
const clMaxTable = getAirfoilTable(def.aero.airfoils.wing).clMax;

/** Roll-hold + coordination pilot used to fly banked stalls. */
const bankHold = (target: number) => (s: RigSample | undefined) =>
  s ? { roll: Math.max(-1, Math.min(1, (target - s.rollDeg) * 0.06 - s.pDegS * 0.02)), yaw: Math.max(-1, Math.min(1, s.betaDeg * 0.3)) } : {};

/** Ramps the stick aft at `rate`/s until the wing first reaches ~CLmax; returns the rig at that instant. */
async function approachStall(bankDeg: number, rate: number, boost: number, pilotKg?: number) {
  const d = buildAircraftDefinition(defaultBuild());
  if (pilotKg) d.mass.items.find((i) => i.id === 'pilot')!.massKg = pilotKg;
  const trim = await glideTrim(d);
  const gamma = -Math.atan(1 / trim.glideRatio);
  const rig = await createAirframeRig(d);
  const th = trim.alphaDeg * DEG + gamma;
  const bank = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), bankDeg * DEG);
  const v = trim.speedMs * boost;
  rig.phys.place(new THREE.Vector3(0, 2500, 0), bank.clone().multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(-1, 0, 0), th)),
    new THREE.Vector3(0, v * Math.sin(gamma), v * Math.cos(gamma)).applyQuaternion(bank));
  let atPeak: RigSample | undefined;
  let stick = 0;
  for (let i = 0; i < 90 * 20 && !atPeak; i++) {
    stick = Math.min(1, stick + rate * 0.05);
    const s = rig.run(0.05, (x) => ({ pitch: stick, ...bankHold(bankDeg)(x) }));
    if (s.wingCl >= 0.985 * clMaxTable) atPeak = s;
  }
  return { rig, atPeak, mass: rig.phys.mass.massKg };
}

/** Roll moment (N m) produced by full right aileron at a frozen flow state, minus the neutral value. */
async function aileronRollMoment(alphaDeg: number, speed: number) {
  const rig = await createAirframeRig(def);
  const th = alphaDeg * DEG;
  rig.phys.place(new THREE.Vector3(0, 800, 0), new THREE.Quaternion(), new THREE.Vector3(0, -speed * Math.sin(th), speed * Math.cos(th)));
  const measure = (right: number, left: number) => {
    rig.phys.readState(new THREE.Vector3());
    rig.phys.computeAero({ elevator: 0, aileronLeft: left, aileronRight: right, rudder: 0 }, null, () => 1);
    return rig.phys.momentBody.z;
  };
  const up = 18 * DEG;
  return measure(-up, up * 0.6) - measure(0, 0);
}

describe('Phase 4 gate — stall from angle of attack', () => {
  it('CL peaks near the airfoil CLmax at a speed consistent with weight (~1g)', async () => {
    const { atPeak, mass } = await approachStall(0, 0.05, 1);
    expect(atPeak).toBeDefined();
    const vs = Math.sqrt((2 * mass * 9.80665) / (1.225 * def.geometry.wingAreaM2 * clMaxTable));
    expect(atPeak!.airspeedMs).toBeGreaterThan(vs * 0.92);
    expect(atPeak!.airspeedMs).toBeLessThan(vs * 1.2);
  });

  it('it is an AoA event, not a speed event: an accelerated pull-up stalls at a much higher speed', async () => {
    const slow = await approachStall(0, 0.05, 1);
    const fast = await approachStall(0, 1.5, 1.35);
    expect(fast.atPeak).toBeDefined();
    expect(fast.atPeak!.airspeedMs).toBeGreaterThan(slow.atPeak!.airspeedMs * 1.1);
    expect(fast.atPeak!.gLoad).toBeGreaterThan(slow.atPeak!.gLoad + 0.2);
  });

  it('a 45 degree banked stall happens at a higher speed (load factor), not at the same speed', async () => {
    const level = await approachStall(0, 0.06, 1);
    const banked = await approachStall(45, 0.06, 1.1);
    expect(banked.atPeak).toBeDefined();
    expect(banked.atPeak!.airspeedMs / level.atPeak!.airspeedMs).toBeGreaterThan(1.05);
    // The physics: V_stall ~ sqrt(n). Normalising by the measured load factor collapses both runs.
    const norm = (r: typeof level) => r.atPeak!.airspeedMs / Math.sqrt(r.atPeak!.gLoad);
    expect(norm(banked) / norm(level)).toBeGreaterThan(0.8);
    expect(norm(banked) / norm(level)).toBeLessThan(1.25);
  });

  it('stall speed scales with sqrt(mass): a heavier pilot stalls faster', async () => {
    const light = await approachStall(0, 0.05, 1, 60);
    const heavy = await approachStall(0, 0.05, 1, 120);
    const expected = Math.sqrt(heavy.mass / light.mass);
    const ratio = heavy.atPeak!.airspeedMs / light.atPeak!.airspeedMs;
    expect(ratio).toBeGreaterThan(1 + (expected - 1) * 0.5);
    expect(ratio).toBeLessThan(expected * 1.15);
  });

  it('past CLmax lift falls progressively (no cliff); a wing drops and the nose drops with no scripted torque', async () => {
    const { rig, atPeak } = await approachStall(0, 0.05, 1);
    const t0 = atPeak!.t;
    rig.run(8, (s) => ({ pitch: 1, ...bankHold(0)(s) }));
    const after = rig.log.filter((s) => s.t > t0);
    expect(Math.min(...after.map((s) => s.wingCl))).toBeGreaterThan(0.4 * clMaxTable);
    for (let i = 1; i < after.length; i++) expect(Math.abs(after[i].wingCl - after[i - 1].wingCl)).toBeLessThan(0.1);
    expect(Math.max(...after.map((s) => Math.abs(s.rollDeg)))).toBeGreaterThan(15);
    expect(Math.min(...after.map((s) => s.qDegS))).toBeLessThan(-3);
    // stalled AoA is well beyond the alpha of CLmax
    expect(Math.max(...after.map((s) => s.alphaDeg))).toBeGreaterThan(atPeak!.alphaDeg + 2);
  });

  it('recovery is by reducing AoA: forward stick brings alpha down, lift returns, wings level with ailerons', async () => {
    const { rig, atPeak } = await approachStall(0, 0.05, 1);
    rig.run(3, (s) => ({ pitch: 1, ...bankHold(0)(s) }));
    const stalledAlpha = Math.max(...rig.log.filter((s) => s.t > atPeak!.t).map((s) => s.alphaDeg));
    // forward stick, wings level with ailerons + coordination
    rig.run(2.5, (s) => ({ pitch: -0.5, ...bankHold(0)(s) }));
    const rec = rig.log.at(-1)!;
    expect(rec.alphaDeg).toBeLessThan(stalledAlpha - 4);
    rig.run(8, (s) => ({ pitch: s ? Math.max(-0.5, Math.min(0.5, -(s.pitchDeg + 3) * 0.05)) : 0, ...bankHold(0)(s) }));
    expect(Math.abs(rig.log.at(-1)!.rollDeg)).toBeLessThan(15);
    expect(rig.log.at(-1)!.wingCl).toBeGreaterThan(0.4 * clMaxTable);
    expect(rig.phys.guardEvents).toEqual({ angularRate: 0, speed: 0, nonFinite: 0 });
  });

  it('aileron authority collapses in the stall: the same deflection gives far less roll moment', async () => {
    const attached = Math.abs(await aileronRollMoment(6, 20));
    const stalled = Math.abs(await aileronRollMoment(24, 20));
    expect(attached).toBeGreaterThan(50);
    expect(stalled).toBeLessThan(attached * 0.5);
  });
});
