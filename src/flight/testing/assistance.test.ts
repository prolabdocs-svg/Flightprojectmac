// Phase 8 gate: assistance is a separate layer that only edits pilot commands; the physics is the
// same in every mode.
import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { defaultBuild } from '../../content/assembly';
import { buildAircraftDefinition } from '../aircraft/quicksilver';
import { createAirframeRig, holdAttitude } from './rig';
import { FlightAssistance, assistLevelFromMode, type AssistLevel } from '../controls/flightAssistance';
import { DEG } from '../core/constants';

// Flight simulations are CPU heavy; the default 5 s can be exceeded when the whole suite runs in parallel.
vi.setConfig({ testTimeout: 60_000 });

const def = buildAircraftDefinition(defaultBuild());

async function cruising(level: AssistLevel, opts: { bank?: number; speed?: number } = {}) {
  const rig = await createAirframeRig(def, { altM: 1200 });
  const v = opts.speed ?? 22;
  const bank = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), (opts.bank ?? 0) * DEG);
  const pitch = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(-1, 0, 0), 2 * DEG);
  rig.phys.place(new THREE.Vector3(0, 1200, 0), bank.multiply(pitch), new THREE.Vector3(0, 0, v).applyQuaternion(bank));
  rig.run(1, { engineOn: true, throttle: 0.75, assist: level, ...holdAttitude(undefined, 0) });
  const fly = (seconds: number, cmd: Parameters<typeof rig.run>[1] = {}) =>
    rig.run(seconds, (s) => ({ engineOn: true, throttle: 0.75, assist: level, ...(typeof cmd === 'function' ? cmd(s) : cmd) }));
  return { rig, fly };
}

describe('assistance is a separate layer', () => {
  it('never writes to the rigid body (source check) and maps the legacy modes', () => {
    const src = readFileSync('src/flight/controls/flightAssistance.ts', 'utf8');
    for (const banned of ['setTranslation', 'setRotation', 'setLinvel', 'setAngvel', 'addForce', 'addTorque', 'AircraftPhysics', 'rapier']) expect(src).not.toContain(banned);
    expect(assistLevelFromMode('acro')).toBe('simulation');
    expect(assistLevelFromMode('standard')).toBe('assisted');
    expect(assistLevelFromMode('assisted')).toBe('arcade');
  });

  it('simulation mode is an exact pass-through', () => {
    const a = new FlightAssistance();
    const out = { pitch: 0, roll: 0, yaw: 0, throttle: 0, brake: 0 };
    a.apply({ pitch: 0.3, roll: -0.7, yaw: 0.1, throttle: 0.5, brake: 0 }, { bankRad: 1, pitchRad: 0, p: 2, q: 0, r: 0, betaRad: 0.3, airspeedMs: 20, stallMarginRad: -1, onGround: false }, 0.01, out);
    expect([out.pitch, out.roll, out.yaw]).toEqual([0.3, -0.7, 0.1]);
  });

  it('input shaping limits how fast the stick can move', () => {
    const a = new FlightAssistance();
    a.setLevel('arcade');
    const out = { pitch: 0, roll: 0, yaw: 0, throttle: 0, brake: 0 };
    a.apply({ pitch: 1, roll: 0, yaw: 0, throttle: 0, brake: 0 }, { bankRad: 0, pitchRad: 0, p: 0, q: 0, r: 0, betaRad: 0, airspeedMs: 22, stallMarginRad: 1, onGround: false }, 0.01, out);
    expect(out.pitch).toBeLessThan(0.1);
  });
});

describe('Phase 8 gate — assisted flight is accessible without changing the physics', () => {
  it('arcade levels the wings when the stick is released; simulation does not', async () => {
    const arcade = await cruising('arcade', { bank: 40 });
    const a = arcade.fly(7);
    expect(Math.abs(a.rollDeg)).toBeLessThan(6);
    const sim = await cruising('simulation', { bank: 40 });
    const s = sim.fly(7);
    expect(Math.abs(s.rollDeg)).toBeGreaterThan(20);
  });

  it('bank limit: full roll input saturates at the limit in arcade, keeps rolling in simulation', async () => {
    const arcade = await cruising('arcade');
    arcade.fly(9, { roll: 1 });
    expect(Math.max(...arcade.rig.log.map((x) => x.rollDeg))).toBeLessThan(68);
    expect(Math.max(...arcade.rig.log.map((x) => x.rollDeg))).toBeGreaterThan(40);
    const sim = await cruising('simulation');
    sim.fly(9, { roll: 1 });
    expect(Math.max(...sim.rig.log.map((x) => x.rollDeg))).toBeGreaterThan(80);
  });

  it('default (assisted) never limits a maneuver: full roll goes past 90 deg, full back stick stalls, input is unfiltered', async () => {
    const a = new FlightAssistance();
    a.setLevel('assisted');
    const out = { pitch: 0, roll: 0, yaw: 0, throttle: 0, brake: 0 };
    a.apply({ pitch: 1, roll: -1, yaw: 0, throttle: 0, brake: 0 }, { bankRad: 0, pitchRad: 0, p: 0, q: 0, r: 0, betaRad: 0, airspeedMs: 22, stallMarginRad: 1, onGround: false }, 0.01, out);
    expect(out.pitch).toBe(1);
    expect(out.roll).toBe(-1);
    const roll = await cruising('assisted');
    roll.fly(9, { roll: 1 });
    expect(Math.max(...roll.rig.log.map((x) => x.rollDeg))).toBeGreaterThan(90);
    const { rig, fly } = await cruising('assisted', { speed: 20 });
    fly(10, { pitch: 1 });
    expect(rig.log.some((x) => x.wheels === 0 && rig.phys.stallMarginRad < 0 || x.alphaDeg > 12)).toBe(true);
  });

  it('auto-coordination removes most of the sideslip (and adverse yaw) in a roll entry', async () => {
    const peakBeta = async (level: AssistLevel) => {
      const { rig, fly } = await cruising(level);
      fly(2, { roll: 0.8 });
      return Math.max(...rig.log.slice(-200).map((x) => Math.abs(x.betaDeg)));
    };
    const sim = await peakBeta('simulation');
    const asst = await peakBeta('assisted');
    const arc = await peakBeta('arcade');
    expect(asst).toBeLessThan(sim * 0.85);
    expect(arc).toBeLessThan(sim * 0.5);
  });

  it('arcade stall protection: full back stick at low speed does not stall or drop a wing; simulation does', async () => {
    const run = async (level: AssistLevel) => {
      const { rig, fly } = await cruising(level, { speed: 20 });
      fly(30, { pitch: 1 });
      return {
        minMargin: Math.min(...rig.log.map((x) => x.wingCl)) , maxRoll: Math.max(...rig.log.map((x) => Math.abs(x.rollDeg))),
        margin: rig.phys.stallMarginRad, stalledFrames: rig.log.filter((x) => x.alphaDeg > 16).length,
      };
    };
    const arc = await run('arcade');
    const sim = await run('simulation');
    expect(arc.maxRoll).toBeLessThan(25);
    expect(sim.maxRoll).toBeGreaterThan(arc.maxRoll + 15);
    expect(arc.stalledFrames).toBeLessThan(sim.stalledFrames);
  });

  it('pitch-attitude hold damps the phugoid when the stick is released (arcade) — simulation keeps oscillating', async () => {
    const range = async (level: AssistLevel) => {
      const { rig, fly } = await cruising(level, { speed: 26 });
      fly(25);
      const p = rig.log.slice(-1500).map((x) => x.pitchDeg);
      return Math.max(...p) - Math.min(...p);
    };
    expect(await range('arcade')).toBeLessThan((await range('simulation')) * 0.6);
  });

  it('a level turn holds altitude with automatic back-pressure (arcade)', async () => {
    const { rig, fly } = await cruising('arcade', { speed: 24 });
    const roll = (s: { rollDeg: number } | undefined) => ({ roll: Math.max(-1, Math.min(1, (30 - (s?.rollDeg ?? 0)) * 0.1)) });
    fly(6, roll);
    const a0 = rig.log.at(-1)!.altM;
    fly(8, roll);
    const lost = a0 - rig.log.at(-1)!.altM;
    expect(Math.abs(lost)).toBeLessThan(20);
    expect(Math.abs(rig.log.at(-1)!.rollDeg - 30)).toBeLessThan(12);
  });

  it('the pilot keeps full authority: pitching up with the stick still raises the nose in arcade', async () => {
    const { rig, fly } = await cruising('arcade');
    fly(4, { pitch: 0.6 });
    expect(rig.log.at(-1)!.pitchDeg).toBeGreaterThan(8);
  });
});
