// Phase 6 gate: taxi -> takeoff -> landing -> rollout on independent wheels.
import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { defaultBuild } from '../../content/assembly';
import { buildAircraftDefinition } from '../aircraft/quicksilver';
import { createAirframeRig, holdAttitude, keepRunway, type RigSample } from './rig';
import { classifyTouchdown } from '../ground/touchdown';
import { DEG } from '../core/constants';

// Flight simulations are CPU heavy; the default 5 s can be exceeded when the whole suite runs in parallel.
vi.setConfig({ testTimeout: 60_000 });

const def = buildAircraftDefinition(defaultBuild());
const KMH = 3.6;

const keepLine = (s: RigSample | undefined) => keepRunway(s);

async function takeoffRun(opts: { rotateKmh?: number; wind?: THREE.Vector3; stopAt?: number } = {}) {
  const rig = await createAirframeRig(def, { onGround: true, wind: opts.wind });
  const vr = (opts.rotateKmh ?? 52) / KMH;
  let liftoff: RigSample | undefined;
  let rotate: RigSample | undefined;
  for (let i = 0; i < 25 * 20 && !(liftoff && rig.log.at(-1)!.agl > (opts.stopAt ?? 15)); i++) {
    const s = rig.run(0.05, (x) => {
      if (!x) return { engineOn: true, throttle: 1 };
      const airborne = x.wheels === 0;
      const rotating = x.airspeedMs > vr;
      if (rotating && !rotate) rotate = x;
      return { engineOn: true, throttle: 1, ...keepLine(x), ...(rotating || airborne ? { pitch: holdAttitude(x, airborne ? 8 : 10).pitch, roll: holdAttitude(x, 8).roll } : {}) };
    });
    if (!liftoff && s.wheels === 0 && s.agl > 1.2) liftoff = s;
  }
  return { rig, liftoff, rotate };
}

describe('gear at rest', () => {
  it('settles on its struts: static compression, load split, no creep, all three wheels loaded', async () => {
    const rig = await createAirframeRig(def, { onGround: true });
    const s = rig.run(3, { engineOn: false });
    expect(s.wheels).toBe(3);
    expect(s.speedMs).toBeLessThan(0.03);
    expect(Math.abs(s.pitchDeg)).toBeLessThan(3);
    const w = rig.sim.gear.wheels;
    for (const wh of w) expect(Math.abs(wh.compressionM - def.gear.staticCompressionM)).toBeLessThan(0.02);
    const total = w.reduce((a, x) => a + x.loadN, 0);
    expect(total).toBeCloseTo(rig.phys.mass.massKg * 9.80665, -1);
    expect(w[0].loadN / total).toBeGreaterThan(0.08); // nose carries a minority of the weight
    expect(w[0].loadN / total).toBeLessThan(0.3);
    expect(Math.abs(w[1].loadN - w[2].loadN)).toBeLessThan(20); // mains share equally
  });
});

describe('Phase 6 gate — takeoff', () => {
  it('rolls straight, rotates, lifts off in 45-110 m and climbs away', async () => {
    const { rig, liftoff, rotate } = await takeoffRun();
    expect(rotate).toBeDefined();
    expect(liftoff).toBeDefined();
    expect(liftoff!.z).toBeGreaterThan(45);
    expect(liftoff!.z).toBeLessThan(110);
    expect(liftoff!.airspeedMs * KMH).toBeGreaterThan(50);
    expect(liftoff!.airspeedMs * KMH).toBeLessThan(75);
    expect(Math.abs(liftoff!.x)).toBeLessThan(3);
    const end = rig.log.at(-1)!;
    expect(end.agl).toBeGreaterThan(8);
    expect(rig.phys.guardEvents).toEqual({ angularRate: 0, speed: 0, nonFinite: 0 });
  });

  it('a crosswind is handled with rudder/nose-wheel steering on the ground (no runaway)', async () => {
    const { rig, liftoff } = await takeoffRun({ wind: new THREE.Vector3(-5, 0, 0) });
    expect(liftoff).toBeDefined();
    expect(Math.abs(liftoff!.x)).toBeLessThan(8);
    expect(Math.abs(rig.log.at(-1)!.headingDeg > 180 ? rig.log.at(-1)!.headingDeg - 360 : rig.log.at(-1)!.headingDeg)).toBeLessThan(20);
  });
});

describe('braking and steering', () => {
  async function rollingAt(kmh: number) {
    const rig = await createAirframeRig(def, { onGround: true });
    rig.phys.body.setLinvel({ x: 0, y: 0, z: kmh / KMH }, true);
    return rig;
  }

  it('brakes stop the aircraft on the wheels, limited by tyre friction (no teleport deceleration)', async () => {
    const rig = await rollingAt(40);
    rig.run(0.3, { engineOn: false });
    const v0 = rig.log.at(-1)!.speedMs;
    const z0 = rig.log.at(-1)!.z;
    let peakDecel = 0;
    let last = v0;
    for (let i = 0; i < 20 * 15 && rig.log.at(-1)!.speedMs > 0.3; i++) {
      const s = rig.run(0.05, { engineOn: false, brake: 1, ...keepLine(rig.log.at(-1)) });
      peakDecel = Math.max(peakDecel, (last - s.speedMs) / 0.05);
      last = s.speedMs;
    }
    const stop = rig.log.at(-1)!;
    expect(stop.speedMs).toBeLessThan(0.5);
    expect(stop.z - z0).toBeLessThan(35);
    expect(peakDecel).toBeLessThan(9.81); // < 1 g
    expect(peakDecel).toBeGreaterThan(2);
    expect(rig.sim.gear.wheels[1].mode === 'braking' || rig.sim.gear.wheels[1].mode === 'rolling' || rig.sim.gear.wheels[1].mode === 'skidding').toBe(true);
  });

  it('free rolling decelerates slowly (rolling resistance), much less than braking', async () => {
    const rig = await rollingAt(30);
    const s = rig.run(3, { engineOn: false });
    expect(s.speedMs).toBeGreaterThan(4);
    expect(s.speedMs).toBeLessThan(30 / KMH);
  });

  it('nose-wheel steering from the rudder pedals turns the aircraft on the ground', async () => {
    const rig = await rollingAt(15);
    rig.run(0.3, { engineOn: false });
    const s = rig.run(1.5, { engineOn: false, yaw: 1 });
    expect(s.rDegS).toBeGreaterThan(3);
  });

  it('differential braking yaws toward the braked side', async () => {
    const rig = await rollingAt(30);
    const s = rig.run(1, { engineOn: false, brake: 0.6, yaw: 1 }); // right pedal biases the right brake
    expect(s.rDegS).toBeGreaterThan(0.5);
  });

  it('lateral tyre force resists sideways sliding: a sideways-moving aircraft is stopped by the tyres', async () => {
    const rig = await createAirframeRig(def, { onGround: true });
    rig.phys.body.setLinvel({ x: 3, y: 0, z: 0 }, true);
    rig.run(0.3, { engineOn: false });
    const s = rig.run(2, { engineOn: false });
    expect(Math.abs(rig.phys.velWorld.x)).toBeLessThan(0.3);
    expect(s.wheels).toBe(3);
  });
});

describe('Phase 6 gate — landing', () => {
  it('approach, flare, touchdown within gear tolerance, brake to a stop', async () => {
    const rig = await createAirframeRig(def, { altM: 45, speedMs: 20 });
    rig.phys.place(new THREE.Vector3(0, 45 + rig.sim.gear.restHeightM, -300), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(-1, 0, 0), -3 * DEG), new THREE.Vector3(0, -1.2, 19.5));
    rig.run(0.05, { engineOn: true, throttle: 0.2 });
    let touch: RigSample | undefined;
    let sinkAtTouch = 0;
    for (let i = 0; i < 20 * 60; i++) {
      const x = rig.log.at(-1)!;
      const flare = x.agl < 3.5;
      const cmd = x.wheels > 0
        ? { engineOn: true, throttle: 0, brake: 0.8, ...keepLine(x), pitch: holdAttitude(x, 0).pitch }
        : { engineOn: true, throttle: flare ? 0 : 0.25, ...holdAttitude(x, flare ? 5 : -3), yaw: keepLine(x).yaw ?? 0 };
      const s = rig.run(0.05, cmd);
      if (!touch && s.wheels > 0) { touch = s; sinkAtTouch = -s.vsMs; }
      if (touch && s.speedMs < 0.5) break;
    }
    expect(touch).toBeDefined();
    expect(sinkAtTouch).toBeLessThan(def.gear.toleranceMs);
    const end = rig.log.at(-1)!;
    expect(end.speedMs).toBeLessThan(1);
    expect(end.wheels).toBe(3);
    expect(end.z - touch!.z).toBeLessThan(250);
    expect(rig.phys.guardEvents).toEqual({ angularRate: 0, speed: 0, nonFinite: 0 });
  });

  it('gear loads scale with sink rate and touchdown is classified from physical quantities', async () => {
    const drop = async (h: number) => {
      const rig = await createAirframeRig(def, { onGround: true });
      rig.phys.place(new THREE.Vector3(0, rig.sim.gear.restHeightM + h, 0), new THREE.Quaternion(), new THREE.Vector3());
      let peak = 0;
      let sink = 0;
      let vPrev = 0;
      for (let i = 0; i < 20 * 3; i++) {
        const s = rig.run(0.05, { engineOn: false });
        peak = Math.max(peak, s.gearLoadN);
        if (s.wheels > 0 && sink === 0) sink = -vPrev;
        vPrev = s.vsMs;
      }
      return { peak, sink, rig };
    };
    const soft = await drop(0.15);
    const firm = await drop(0.8);
    const hard = await drop(3);
    expect(firm.peak).toBeGreaterThan(soft.peak * 1.3);
    expect(hard.peak).toBeGreaterThan(firm.peak);
    const cls = (d: { sink: number }) => classifyTouchdown({ sinkMs: d.sink, toleranceMs: def.gear.toleranceMs, structuralStrike: false, bankDeg: 0, pitchDeg: 0, groundSpeedMs: 0 });
    expect(cls(soft)).toBe('normal');
    expect(['hard', 'gearOverstress', 'catastrophic']).toContain(cls(hard));
    // the struts absorb it: it settles again, it does not bounce away or explode
    const rest = firm.rig.log.at(-1)!;
    expect(rest.agl).toBeLessThan(1.15);
    expect(Math.abs(rest.vsMs)).toBeLessThan(0.3);
  });
});

describe('ground effect', () => {
  it('near the ground the wing gains lift and loses induced drag (continuous in height)', async () => {
    const measure = async (h: number) => {
      const rig = await createAirframeRig(def, { altM: h });
      rig.phys.place(new THREE.Vector3(0, h, 0), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(-1, 0, 0), 5 * DEG), new THREE.Vector3(0, 0, 20));
      rig.phys.readState(new THREE.Vector3());
      rig.phys.computeAero({ elevator: 0, aileronLeft: 0, aileronRight: 0, rudder: 0 }, null, () => 1);
      const w = rig.phys.results.slice(0, 8);
      return { lift: w.reduce((a, r) => a + r.liftN, 0), cd: w.reduce((a, r) => a + r.cd * 1, 0) / 8, downwash: rig.phys.ctx.downwashRad };
    };
    const low = await measure(1.5);
    const mid = await measure(6);
    const high = await measure(60);
    expect(low.lift).toBeGreaterThan(high.lift * 1.02);
    expect(low.cd).toBeLessThan(high.cd);
    expect(low.downwash).toBeLessThan(high.downwash);
    expect(mid.lift).toBeGreaterThan(high.lift * 0.999);
    expect(mid.lift).toBeLessThan(low.lift);
  });
});
