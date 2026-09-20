// Phase 9: scenario-based acceptance (spec section 32, tests A-H) for the reference aircraft.
// Each scenario measures numbers on the real simulation and compares them with an explicit
// tolerance band. Bands are traceable to docs/flight/baseline_legacy.json (gameplay targets) and to
// physics identities (turn rate = g tan(bank) / V; stall speed from weight and CLmax).
// `WRITE_REPORT=1 npx vitest run src/flight/testing/acceptance.test.ts` regenerates
// docs/flight/acceptance_report.json.
import { afterAll, describe, expect, it, vi } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import * as THREE from 'three';
import { defaultBuild } from '../../content/assembly';
import { buildAircraftDefinition } from '../aircraft/quicksilver';
import { getAirfoilTable } from '../aero/airfoil';
import { createAirframeRig, holdAttitude, keepRunway, headingError, type RigSample } from './rig';
import { glideTrim } from './trim';
import { levelPerformance, summarize } from './performance';
import { DEG } from '../core/constants';

vi.setConfig({ testTimeout: 120_000 });

const def = buildAircraftDefinition(defaultBuild());
const KMH = 3.6;

interface Metric { value: number; min: number; max: number; unit: string; note: string; pass?: boolean }
const report: Record<string, Metric> = {};
function measure(key: string, value: number, min: number, max: number, unit: string, note: string) {
  report[key] = { value: Number(value.toFixed(3)), min, max, unit, note, pass: value >= min && value <= max };
  expect(value, `${key} = ${value.toFixed(3)} ${unit} (band ${min}..${max})`).toBeGreaterThanOrEqual(min);
  expect(value, `${key} = ${value.toFixed(3)} ${unit} (band ${min}..${max})`).toBeLessThanOrEqual(max);
}

afterAll(() => {
  if (process.env.WRITE_REPORT === '1') {
    mkdirSync('docs/flight', { recursive: true });
    writeFileSync('docs/flight/acceptance_report.json', JSON.stringify({ aircraft: def.id, generatedBy: 'src/flight/testing/acceptance.test.ts', metrics: report }, null, 2) + '\n');
  }
});

async function airborneRig(v: number, alt = 900) {
  const rig = await createAirframeRig(def, { altM: alt });
  rig.phys.place(new THREE.Vector3(0, alt, 0), new THREE.Quaternion(), new THREE.Vector3(0, 0, v));
  return rig;
}

describe('A — trimmed level flight', () => {
  it('holds level at cruise power with a converged speed and no divergent oscillation', async () => {
    const rig = await airborneRig(24);
    let ref = 2;
    const pilot = (s: RigSample | undefined) => {
      if (!s) return {};
      ref = Math.max(-5, Math.min(12, ref - 0.08 * s.vsMs * 0.01 * 100 * 0.1));
      return { engineOn: true, throttle: 0.65, ...holdAttitude(s, ref) };
    };
    rig.run(60, pilot);
    const tail = rig.log.slice(-1000);
    const v = tail.map((x) => x.airspeedMs * KMH);
    const early = rig.log.slice(-2000, -1000).map((x) => x.airspeedMs * KMH);
    measure('A.cruiseSpeed@65%', v.reduce((a, b) => a + b, 0) / v.length, 78, 102, 'km/h', 'legacy 82; band widened for an honest aircraft with a pilot');
    measure('A.verticalSpeed', Math.abs(tail.reduce((a, b) => a + b.vsMs, 0) / tail.length), 0, 0.8, 'm/s', 'level flight');
    const amp = (a: number[]) => Math.max(...a) - Math.min(...a);
    measure('A.speedOscillation(last10s)', amp(v), 0, Math.max(6, amp(early) * 1.1), 'km/h', 'must not grow');
  });
});

describe('B — power-off glide', () => {
  it('static and dynamic glide agree and give a plausible L/D', async () => {
    const t = await glideTrim(def);
    measure('B.glideRatio', t.glideRatio, 8, 11, ':1', 'legacy 8.3');
    measure('B.trimSpeed', t.speedMs * KMH, 68, 90, 'km/h', 'hands-off power-off trim');
    measure('B.sinkRate', t.sinkMs, 1.9, 3.0, 'm/s', 'legacy 2.3-2.9');
    const gamma = -Math.atan(1 / t.glideRatio);
    const rig = await createAirframeRig(def, { altM: 1500 });
    rig.phys.place(new THREE.Vector3(0, 1500, 0), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(-1, 0, 0), t.alphaDeg * DEG + gamma), new THREE.Vector3(0, t.speedMs * Math.sin(gamma), t.speedMs * Math.cos(gamma)));
    rig.run(40, { engineOn: false });
    const seg = rig.log.slice(-2000);
    const sink = -(seg[seg.length - 1].altM - seg[0].altM) / 20;
    measure('B.dynamicSink', sink, t.sinkMs * 0.75, t.sinkMs * 1.3, 'm/s', 'simulated glide within 25% of the static analysis');
  });
});

describe('C — stall', () => {
  it('1g stall speed and CLmax are consistent with weight', async () => {
    const table = getAirfoilTable(def.aero.airfoils.wing);
    const rig = await createAirframeRig(def);
    const trim = await glideTrim(def);
    const gamma = -Math.atan(1 / trim.glideRatio);
    rig.phys.place(new THREE.Vector3(0, 2500, 0), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(-1, 0, 0), trim.alphaDeg * DEG + gamma), new THREE.Vector3(0, trim.speedMs * Math.sin(gamma), trim.speedMs * Math.cos(gamma)));
    let stick = 0;
    let at: RigSample | undefined;
    for (let i = 0; i < 1500 && !at; i++) {
      stick = Math.min(1, stick + 0.0025);
      const s = rig.run(0.05, (x) => ({ pitch: stick, ...(x ? { roll: Math.max(-1, Math.min(1, -x.rollDeg * 0.06 - x.pDegS * 0.02)), yaw: Math.max(-1, Math.min(1, x.betaDeg * 0.3)) } : {}) }));
      if (s.wingCl >= 0.985 * table.clMax) at = s;
    }
    expect(at).toBeDefined();
    measure('C.stallSpeed(1g)', at!.airspeedMs * KMH, 52, 68, 'km/h', 'legacy 49 (no pilot); +70 kg pilot raises it');
    measure('C.CLmax', table.clMax, 1.15, 1.6, '-', 'fabric ultralight wing');
    measure('C.alphaAtStall', at!.alphaDeg, 8, 16, 'deg body', 'body AoA at CLmax');
  });
});

describe('D — coordinated turn', () => {
  it('30 degree turn: rate follows g*tan(bank)/V, sideslip and altitude loss stay small with assistance', async () => {
    const rig = await airborneRig(24);
    const roll = (s: RigSample | undefined) => ({ roll: Math.max(-1, Math.min(1, (30 - (s?.rollDeg ?? 0)) * 0.1)) });
    rig.run(8, (s) => ({ engineOn: true, throttle: 0.75, assist: 'arcade', ...roll(s) }));
    const a = rig.log.at(-1)!;
    rig.run(10, (s) => ({ engineOn: true, throttle: 0.75, assist: 'arcade', ...roll(s) }));
    const b = rig.log.at(-1)!;
    const rate = headingError(b.headingDeg, a.headingDeg) / 10; // deg/s, + = right
    const expected = ((9.80665 * Math.tan(b.rollDeg * DEG)) / (b.airspeedMs)) / DEG;
    measure('D.bank', b.rollDeg, 26, 34, 'deg', 'commanded 30');
    measure('D.turnRate/expected', rate / expected, 0.8, 1.2, '-', 'physics identity for a coordinated level turn');
    measure('D.sideslip', Math.abs(b.betaDeg), 0, 3, 'deg', 'coordinated');
    measure('D.altitudeChange(10s)', b.altM - a.altM, -25, 25, 'm', 'assisted turn holds altitude');
    measure('D.G', b.gLoad, 1.05, 1.3, 'g', '1/cos(30)=1.155');
  });
});

describe('E — takeoff', () => {
  it('ground roll, rotation, liftoff and initial climb', async () => {
    const rig = await createAirframeRig(def, { onGround: true });
    let rotate: RigSample | undefined;
    let liftoff: RigSample | undefined;
    for (let i = 0; i < 20 * 22; i++) {
      const s = rig.run(0.05, (x) => {
        if (!x) return { engineOn: true, throttle: 1 };
        const rot = x.airspeedMs > 52 / KMH;
        if (rot && !rotate) rotate = x;
        return { engineOn: true, throttle: 1, ...keepRunway(x), ...(rot || x.wheels === 0 ? { pitch: holdAttitude(x, x.wheels === 0 ? 8 : 10).pitch, roll: holdAttitude(x, 8).roll } : {}) };
      });
      if (!liftoff && s.wheels === 0 && s.agl > 1.2) liftoff = s;
      if (liftoff && s.t - liftoff.t > 8) break;
    }
    expect(liftoff).toBeDefined();
    measure('E.groundRoll', liftoff!.z, 45, 110, 'm', 'legacy 59');
    measure('E.rotateSpeed', rotate!.airspeedMs * KMH, 45, 62, 'km/h', 'scripted 52');
    measure('E.liftoffSpeed', liftoff!.airspeedMs * KMH, 50, 72, 'km/h', 'legacy 59');
    const end = rig.log.at(-1)!;
    measure('E.climbAfterLiftoff', (end.altM - liftoff!.altM) / (end.t - liftoff!.t), 1.0, 4.0, 'm/s', 'legacy 2.6 (best-climb, higher wing loading here)');
  });
  it('level performance: best climb and top speed from the static analysis', async () => {
    const pts = await levelPerformance(def, Array.from({ length: 34 }, (_, i) => 14 + i), 1);
    const s = summarize(pts);
    measure('E.bestClimb', s.bestClimbMs, 1.8, 3.5, 'm/s', 'legacy 2.6');
    measure('E.bestClimbSpeed', s.bestClimbSpeedKmh, 60, 85, 'km/h', '');
    measure('E.topSpeed', s.topSpeedKmh, 95, 118, 'km/h', 'legacy ~100');
  });
});

describe('F — landing', () => {
  it('stabilised approach, flare, soft touchdown and rollout', async () => {
    const rig = await createAirframeRig(def, { altM: 45, speedMs: 20 });
    rig.phys.place(new THREE.Vector3(0, 45 + rig.sim.gear.restHeightM, -320), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(-1, 0, 0), -3 * DEG), new THREE.Vector3(0, -1.2, 19.5));
    let touch: RigSample | undefined;
    let approach: RigSample | undefined;
    let pitchAtFlare = 0;
    for (let i = 0; i < 20 * 70; i++) {
      const x = rig.log.at(-1);
      const cmd = !x ? { engineOn: true, throttle: 0.2 } : x.wheels > 0
        ? { engineOn: true, throttle: 0, brake: 0.8, ...keepRunway(x), pitch: holdAttitude(x, 0).pitch }
        : { engineOn: true, throttle: x.agl < 3.5 ? 0 : 0.25, ...holdAttitude(x, x.agl < 3.5 ? 5 : -3), yaw: keepRunway(x).yaw ?? 0 };
      const s = rig.run(0.05, cmd);
      if (!approach && s.agl < 20) approach = s;
      if (s.agl < 3.5 && !pitchAtFlare) pitchAtFlare = s.pitchDeg;
      if (!touch && s.wheels > 0) touch = s;
      if (touch && s.speedMs < 0.5) break;
    }
    expect(touch).toBeDefined();
    measure('F.approachSpeed', approach!.airspeedMs * KMH, 62, 88, 'km/h', '');
    measure('F.touchdownSink', -touch!.vsMs, 0, def.gear.toleranceMs, 'm/s', 'within gear tolerance');
    measure('F.flarePitch', pitchAtFlare, -2, 12, 'deg', 'nose comes up in the flare');
    measure('F.rollout', rig.log.at(-1)!.z - touch!.z, 5, 250, 'm', 'brakes on');
  });
});

describe('G — crosswind', () => {
  it('4 m/s crosswind: crab, de-crab, land, stay on the runway', async () => {
    const wind = new THREE.Vector3(-4, 0, 0);
    const rig = await createAirframeRig(def, { altM: 40, speedMs: 20, wind });
    const crab = -Math.asin(4 / 20) / DEG;
    rig.phys.place(new THREE.Vector3(0, 40 + rig.sim.gear.restHeightM, -320), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(-1, 0, 0), -3 * DEG).premultiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -crab * DEG)), new THREE.Vector3());
    rig.phys.body.setLinvel({ x: -19.5 * Math.sin(crab * DEG) - 4, y: -1.2, z: 19.5 * Math.cos(crab * DEG) }, true);
    let touch: RigSample | undefined;
    let sideMax = 0;
    for (let i = 0; i < 20 * 70; i++) {
      const x = rig.log.at(-1);
      const flare = !!x && x.agl < 3.5;
      const headingTarget = flare ? 0 : crab + 0.08 * Math.max(-30, Math.min(30, -(x?.x ?? 0)));
      const cmd = !x ? { engineOn: true, throttle: 0.25 } : x.wheels > 0
        ? { engineOn: true, throttle: 0, brake: 0.7, ...keepRunway(x) }
        : { engineOn: true, throttle: flare ? 0 : 0.25, ...holdAttitude(x, flare ? 5 : -3, flare ? -3 : 0), yaw: Math.max(-1, Math.min(1, headingError(headingTarget, x.headingDeg) * 0.12 - x.rDegS * 0.03)) };
      const s = rig.run(0.05, cmd);
      if (!touch && s.wheels > 0) touch = s;
      if (s.wheels > 0) sideMax = Math.max(sideMax, ...rig.sim.gear.wheels.map((w) => Math.abs(w.latForceN)));
      if (touch && s.speedMs < 0.5) break;
    }
    expect(touch).toBeDefined();
    measure('G.touchdownOffset', Math.abs(touch!.x), 0, 20, 'm', 'lateral error at touchdown');
    measure('G.finalOffset', Math.abs(rig.log.at(-1)!.x), 0, 30, 'm', '');
    measure('G.maxSideForce', sideMax, 50, 4000, 'N', 'tyres carry a real side load, within limits');
    measure('G.structuralStrike', rig.sim.structure.contacts.some((c) => c.active) ? 1 : 0, 0, 0, '-', 'no wing/belly strike');
  });
});

describe('H — control authority vs dynamic pressure', () => {
  it('roll, pitch and yaw acceleration grow with V^2', async () => {
    const accel = async (v: number, cmd: { pitch?: number; roll?: number; yaw?: number }, key: 'qDegS' | 'pDegS' | 'rDegS') => {
      const rig = await airborneRig(v, 800);
      return rig.run(0.1, cmd)[key] / 0.1;
    };
    for (const [name, cmd, key] of [['roll', { roll: 1 }, 'pDegS'], ['pitch', { pitch: 1 }, 'qDegS'], ['yaw', { yaw: 1 }, 'rDegS']] as const) {
      const slow = Math.abs(await accel(15, cmd, key));
      const fast = Math.abs(await accel(30, cmd, key));
      measure(`H.${name}Authority(30/15 m/s)`, fast / slow, 2.5, 4.6, '-', 'ideal (30/15)^2 = 4; damping trims it');
    }
  });
});
