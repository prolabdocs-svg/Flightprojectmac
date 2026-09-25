// Ridgeway RW-12 Nightjar flight validation: every phase of a flight on the real simulation, with bands for an
// S-12-class enclosed two-seat pusher (50 hp, ~280 kg solo), plus qualitative comparisons against the Kestrel.
// `WRITE_REPORT=1` regenerates docs/flight/nightjar_report.json.
import { afterAll, describe, expect, it, vi } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import * as THREE from 'three';
import { defaultBuild } from '../../content/assembly';
import { buildAircraftDefinition } from '../aircraft/quicksilver';
import { getAirfoilTable } from '../aero/airfoil';
import { DEG } from '../core/constants';
import { applyImpact, createDamageState, impactEnergyJ, isAirframeLost } from '../../sim/damageSystem';
import { createAirframeRig, holdAttitude, keepRunway, headingError, type RigSample } from './rig';
import { glideTrim } from './trim';
import { levelPerformance, summarize } from './performance';

vi.setConfig({ testTimeout: 240_000 });

const build = { frameId: 'frame_nightjar', installed: { engine: 'rotax_503', fuelTank: 'tank_nightjar_20', landingGear: 'gear_light' } };
const def = buildAircraftDefinition(build);
const kestrel = buildAircraftDefinition(defaultBuild());
const KMH = 3.6;

const report: Record<string, { value: number; min: number; max: number; unit: string }> = {};
function measure(key: string, value: number, min: number, max: number, unit: string) {
  report[key] = { value: Number(value.toFixed(3)), min, max, unit };
  expect(value, `${key} = ${value.toFixed(3)} ${unit} (band ${min}..${max})`).toBeGreaterThanOrEqual(min);
  expect(value, `${key} = ${value.toFixed(3)} ${unit} (band ${min}..${max})`).toBeLessThanOrEqual(max);
}
afterAll(() => {
  if (process.env.WRITE_REPORT !== '1') return;
  mkdirSync('docs/flight', { recursive: true });
  writeFileSync('docs/flight/nightjar_report.json', JSON.stringify({ aircraft: def.id, build, metrics: report }, null, 2) + '\n');
});

async function airborne(v: number, alt = 900, d = def) {
  const rig = await createAirframeRig(d, { altM: alt });
  rig.phys.place(new THREE.Vector3(0, alt, 0), new THREE.Quaternion(), new THREE.Vector3(0, 0, v));
  return rig;
}

describe('Nightjar — taxi and ground handling', () => {
  it('sits on all three wheels, taxis straight, steers with the nose wheel and brakes to a stop', async () => {
    const rig = await createAirframeRig(def, { onGround: true });
    rig.run(2, { engineOn: true, throttle: 0 });
    measure('taxi.wheelsAtRest', rig.log.at(-1)!.wheels, 3, 3, '-');
    rig.run(10, (s) => ({ engineOn: true, throttle: s && s.speedMs > 5 ? 0.1 : 0.35, ...keepRunway(s) }));
    const straight = rig.log.at(-1)!;
    measure('taxi.speed', straight.speedMs * KMH, 8, 35, 'km/h');
    measure('taxi.lateralDrift', Math.abs(straight.x), 0, 3, 'm');
    const h0 = straight.headingDeg;
    rig.run(5, { engineOn: true, throttle: 0.25, yaw: 1 });
    measure('taxi.turnRight', headingError(rig.log.at(-1)!.headingDeg, h0), 15, 180, 'deg');
    rig.run(8, { engineOn: true, throttle: 0, brake: 1 });
    measure('taxi.stoppedSpeed', rig.log.at(-1)!.speedMs, 0, 0.5, 'm/s');
  });
});

describe('Nightjar — takeoff and climb', () => {
  it('rolls, rotates, lifts off and climbs away', async () => {
    const rig = await createAirframeRig(def, { onGround: true });
    let liftoff: RigSample | undefined;
    for (let i = 0; i < 20 * 40; i++) {
      const s = rig.run(0.05, (x) => {
        if (!x) return { engineOn: true, throttle: 1 };
        const rot = x.airspeedMs > 60 / KMH;
        return { engineOn: true, throttle: 1, ...keepRunway(x), ...(rot || x.wheels === 0 ? { pitch: holdAttitude(x, x.wheels === 0 ? 8 : 9).pitch, roll: holdAttitude(x, 8).roll } : {}) };
      });
      if (!liftoff && s.wheels === 0 && s.agl > 1.2) liftoff = s;
      if (liftoff && s.t - liftoff.t > 12) break;
    }
    expect(liftoff).toBeDefined();
    measure('takeoff.groundRoll', liftoff!.z, 50, 190, 'm');
    measure('takeoff.liftoffSpeed', liftoff!.airspeedMs * KMH, 58, 85, 'km/h');
    const end = rig.log.at(-1)!;
    measure('climb.initial', (end.altM - liftoff!.altM) / (end.t - liftoff!.t), 1.5, 5.5, 'm/s');
    expect(rig.sim.structure.contacts.some((c) => c.active && c.id === 'tail'), 'no tail-skid strike on rotation').toBe(false);
    expect(rig.phys.guardEvents).toEqual({ angularRate: 0, speed: 0, nonFinite: 0 });
  });

  it('static performance: best climb, cruise-class top speed, and the 582 upgrade climbs harder', async () => {
    const speeds = Array.from({ length: 40 }, (_, i) => 12 + i);
    const s = summarize(await levelPerformance(def, speeds, 1));
    measure('perf.bestClimb', s.bestClimbMs, 3, 5.5, 'm/s');
    measure('perf.topSpeed', s.topSpeedKmh, 112, 140, 'km/h');
    const up = summarize(await levelPerformance(buildAircraftDefinition({ ...build, installed: { ...build.installed, engine: 'rotax_582' } }), speeds, 1));
    measure('perf.582ClimbGain', up.bestClimbMs - s.bestClimbMs, 1, 4, 'm/s');
    measure('perf.582TopSpeedGain', up.topSpeedKmh - s.topSpeedKmh, 0, 20, 'km/h');
  });
});

describe('Nightjar — cruise', () => {
  it('holds level at cruise power without divergent oscillation', async () => {
    const rig = await airborne(30);
    let ref = 1;
    rig.run(70, (s) => {
      if (!s) return {};
      ref = Math.max(-5, Math.min(12, ref - 0.008 * s.vsMs));
      return { engineOn: true, throttle: 0.7, ...holdAttitude(s, ref) };
    });
    const tail = rig.log.slice(-1000);
    const v = tail.map((x) => x.airspeedMs * KMH);
    measure('cruise.speed@70%', v.reduce((a, b) => a + b, 0) / v.length, 95, 125, 'km/h');
    measure('cruise.verticalSpeed', Math.abs(tail.reduce((a, b) => a + b.vsMs, 0) / tail.length), 0, 0.8, 'm/s');
    measure('cruise.speedBand', Math.max(...v) - Math.min(...v), 0, 8, 'km/h');
  });
});

describe('Nightjar — turn', () => {
  it('30 degree coordinated turn follows g tan(bank)/V', async () => {
    const rig = await airborne(29);
    const roll = (s: RigSample | undefined) => ({ roll: Math.max(-1, Math.min(1, (30 - (s?.rollDeg ?? 0)) * 0.1)) });
    rig.run(8, (s) => ({ engineOn: true, throttle: 0.8, assist: 'arcade', ...roll(s) }));
    const a = rig.log.at(-1)!;
    rig.run(10, (s) => ({ engineOn: true, throttle: 0.8, assist: 'arcade', ...roll(s) }));
    const b = rig.log.at(-1)!;
    const rate = headingError(b.headingDeg, a.headingDeg) / 10;
    const expected = (9.80665 * Math.tan(b.rollDeg * DEG) / b.airspeedMs) / DEG;
    measure('turn.bank', b.rollDeg, 25, 35, 'deg');
    measure('turn.rate/expected', rate / expected, 0.8, 1.2, '-');
    measure('turn.sideslip', Math.abs(b.betaDeg), 0, 4, 'deg');
    measure('turn.altitudeChange10s', b.altM - a.altM, -30, 30, 'm');
  });
});

describe('Nightjar — stall and recovery', () => {
  it('stalls from angle of attack at a speed consistent with its weight, and recovers with forward stick', async () => {
    const table = getAirfoilTable(def.aero.airfoils.wing);
    const trim = await glideTrim(def);
    measure('stall.staticStability', trim.staticStability, -Infinity, -1, 'N m/rad');
    measure('glide.ratio', trim.glideRatio, 7, 10, ':1');
    const rig = await createAirframeRig(def);
    const gamma = -Math.atan(1 / trim.glideRatio);
    rig.phys.place(new THREE.Vector3(0, 2500, 0), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(-1, 0, 0), trim.alphaDeg * DEG + gamma), new THREE.Vector3(0, trim.speedMs * Math.sin(gamma), trim.speedMs * Math.cos(gamma)));
    let stick = 0;
    let at: RigSample | undefined;
    const level = (x: RigSample | undefined) => (x ? { roll: Math.max(-1, Math.min(1, -x.rollDeg * 0.06 - x.pDegS * 0.02)), yaw: Math.max(-1, Math.min(1, x.betaDeg * 0.3)) } : {});
    for (let i = 0; i < 1500 && !at; i++) {
      stick = Math.min(1, stick + 0.0025);
      const s = rig.run(0.05, (x) => ({ pitch: stick, ...level(x) }));
      if (s.wingCl >= 0.985 * table.clMax) at = s;
    }
    expect(at).toBeDefined();
    measure('stall.speed1g', at!.airspeedMs * KMH, 58, 76, 'km/h');
    // Hold the stick back through the break, then recover: forward stick, wings level, power.
    rig.run(3, (x) => ({ pitch: 1, ...level(x) }));
    const broken = rig.log.at(-1)!;
    rig.run(8, (x) => ({ engineOn: false, ...holdAttitude(x, -4), ...level(x) }));
    const rec = rig.log.at(-1)!;
    measure('recovery.alphaAfter', rec.alphaDeg, -6, 10, 'deg');
    measure('recovery.speed', rec.airspeedMs * KMH, 70, 150, 'km/h');
    measure('recovery.bank', Math.abs(rec.rollDeg), 0, 20, 'deg');
    measure('recovery.altitudeLost', broken.altM - rec.altM, 0, 150, 'm');
  });
});

describe('Nightjar — approach and landing', () => {
  it('stabilised approach, flare, touchdown within gear tolerance, brakes to a stop', async () => {
    const rig = await createAirframeRig(def, { altM: 45, speedMs: 24 });
    rig.phys.place(new THREE.Vector3(0, 45 + rig.sim.gear.restHeightM, -400), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(-1, 0, 0), -3 * DEG), new THREE.Vector3(0, -1.4, 23.5));
    let touch: RigSample | undefined, approach: RigSample | undefined;
    for (let i = 0; i < 20 * 80; i++) {
      const x = rig.log.at(-1);
      const cmd = !x ? { engineOn: true, throttle: 0.25 } : x.wheels > 0
        ? { engineOn: true, throttle: 0, brake: 0.8, ...keepRunway(x), pitch: holdAttitude(x, 0).pitch }
        : { engineOn: true, throttle: x.agl < 3.5 ? 0 : 0.15, ...holdAttitude(x, x.agl < 3.5 ? 5 : -3), yaw: keepRunway(x).yaw ?? 0 };
      const s = rig.run(0.05, cmd);
      if (!approach && s.agl < 20) approach = s;
      if (!touch && s.wheels > 0) touch = s;
      if (touch && s.speedMs < 0.5) break;
    }
    expect(touch).toBeDefined();
    measure('landing.approachSpeed', approach!.airspeedMs * KMH, 72, 100, 'km/h');
    measure('landing.touchdownSink', -touch!.vsMs, 0, def.gear.toleranceMs, 'm/s');
    measure('landing.rollout', rig.log.at(-1)!.z - touch!.z, 5, 300, 'm');
    expect(rig.sim.structure.contacts.some((c) => c.active)).toBe(false);
  });

  it('4 m/s crosswind: crab, de-crab, land on the wheels and stay on the runway', async () => {
    const wind = new THREE.Vector3(-4, 0, 0);
    const rig = await createAirframeRig(def, { altM: 40, speedMs: 24, wind });
    const crab = -Math.asin(4 / 24) / DEG;
    rig.phys.place(new THREE.Vector3(0, 40 + rig.sim.gear.restHeightM, -380), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(-1, 0, 0), -3 * DEG).premultiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -crab * DEG)), new THREE.Vector3());
    rig.phys.body.setLinvel({ x: -23.5 * Math.sin(crab * DEG) - 4, y: -1.4, z: 23.5 * Math.cos(crab * DEG) }, true);
    let touch: RigSample | undefined;
    for (let i = 0; i < 20 * 80; i++) {
      const x = rig.log.at(-1);
      const flare = !!x && x.agl < 3.5;
      const headingTarget = flare ? 0 : crab + 0.3 * Math.max(-30, Math.min(30, x?.x ?? 0)); // +X is left: drifting left needs a right (+) heading correction
      const cmd = !x ? { engineOn: true, throttle: 0.3 } : x.wheels > 0
        ? { engineOn: true, throttle: 0, brake: 0.7, ...keepRunway(x) }
        : flare
          ? { engineOn: true, throttle: 0, ...holdAttitude(x, 5, -3), yaw: Math.max(-1, Math.min(1, headingError(0, x.headingDeg) * 0.12 - x.rDegS * 0.03)) }
          // Turn with bank (coordinated), not with a rudder skid.
          : { engineOn: true, throttle: 0.15, ...holdAttitude(x, -3, Math.max(-12, Math.min(12, headingError(headingTarget, x.headingDeg) * 1.5))) };
      const s = rig.run(0.05, cmd);
      if (!touch && s.wheels > 0) touch = s;
      if (touch && s.speedMs < 0.5) break;
    }
    expect(touch).toBeDefined();
    measure('crosswind.touchdownOffset', Math.abs(touch!.x), 0, 20, 'm');
    measure('crosswind.finalOffset', Math.abs(rig.log.at(-1)!.x), 0, 30, 'm');
    measure('crosswind.structuralStrike', rig.sim.structure.contacts.some((c) => c.active) ? 1 : 0, 0, 0, '-');
  });
});

describe('Nightjar — crash and damage', () => {
  const m = def.mass.items.reduce((s, i) => s + i.massKg, 0);
  const fresh = () => createDamageState(['aileron_l', 'aileron_r', 'elevator', 'rudder'], def.damage);
  it('a nose strike cannot reach the pusher propeller above the wing, a nose-over wrecks it', () => {
    const nose = applyImpact(fresh(), 'nose', impactEnergyJ(m, 5, 8));
    expect(nose.parts.propeller.integrity).toBe(1);
    expect(nose.parts.nose.integrity).toBeLessThan(1);
    const over = applyImpact(fresh(), 'canopy', impactEnergyJ(m, 5, 8));
    expect(over.parts.propeller.integrity).toBeLessThan(0.5);
  });
  it('a wingtip strike damages that wing only; a vertical impact at 12 m/s is a total loss', () => {
    const tip = applyImpact(fresh(), 'wingtipL', impactEnergyJ(m, 6, 10));
    expect(tip.parts.wing_l.integrity).toBeLessThan(1);
    expect(tip.parts.wing_r.integrity).toBe(1);
    let s = fresh();
    for (const zone of ['gear', 'bellyFront', 'nose']) s = applyImpact(s, zone, impactEnergyJ(m, 12, 20));
    expect(isAirframeLost(s)).toBe(true);
  });
  it('the braced wing takes more energy than the Kestrel before it is damaged', () => {
    const e = impactEnergyJ(m, 4, 6);
    const nj = applyImpact(fresh(), 'wingtipL', e).parts.wing_l.integrity;
    const ks = applyImpact(createDamageState(['aileron_l'], kestrel.damage), 'wingtipL', e).parts.wing_l.integrity;
    expect(nj).toBeGreaterThan(ks);
  });
});

describe('Nightjar vs Kestrel (qualitative class comparison)', () => {
  it('heavier and faster, with more wing loading and more roll inertia', async () => {
    const speeds = Array.from({ length: 40 }, (_, i) => 12 + i);
    const [nj, ks] = [summarize(await levelPerformance(def, speeds, 1)), summarize(await levelPerformance(kestrel, speeds, 1))];
    const mass = (d: typeof def) => d.mass.items.reduce((s, i) => s + i.massKg, 0);
    expect(mass(def)).toBeGreaterThan(mass(kestrel));
    expect(nj.topSpeedKmh).toBeGreaterThan(ks.topSpeedKmh);
    expect(nj.minSpeedKmh).toBeGreaterThan(ks.minSpeedKmh);
    expect(mass(def) / def.geometry.wingAreaM2).toBeGreaterThan(mass(kestrel) / kestrel.geometry.wingAreaM2);
    const rollAccel = async (d: typeof def) => Math.abs((await airborne(25, 800, d)).run(0.1, { roll: 1 }).pDegS / 0.1);
    expect(await rollAccel(def)).toBeLessThan(await rollAccel(kestrel));
  });
});
