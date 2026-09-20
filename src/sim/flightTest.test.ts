// Test Flight Standard (convergence spec section 13): the real FlightController + Rapier +
// terrain, flown by a scripted pilot. Bands are the starter aircraft's target feel.
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { createHarness, hold, type HarnessModel, type Sample } from './flightHarness';
import { installPart, defaultBuild } from '../content/assembly';
import type { Obstacle } from '../world/obstacles';

const rotate = (s: Sample | undefined) => ({ throttle: 1, pitch: s && s.airspeedMs > s.stallSpeedMs * 1.05 ? 0.6 : 0 });

async function airborneAt(make: Make, altitudeM = 60, opts: Parameters<typeof createHarness>[0] = {}) {
  const h = await make(opts);
  h.run(9, rotate);
  for (let i = 0; i < 90 && h.log.at(-1)!.altitudeM < altitudeM; i++) h.run(1, (s) => ({ throttle: 1, ...hold(s, 8) }));
  h.run(4, (s) => ({ throttle: 0.65, ...hold(s, 0) }));
  return h;
}

type Make = (o?: Parameters<typeof createHarness>[0]) => ReturnType<typeof createHarness>;

describe.each(['legacy', 'new'] as HarnessModel[])('Test Flight Standard — starter ultralight [%s model]', (model) => {
  const make: Make = (o = {}) => createHarness({ ...o, model });
  it('spawns resting on its gear and stays put with the engine off', async () => {
    const h = await make();
    const s = h.run(3, { engineOn: false });
    expect(s.wheelsOnGround).toBe(3);
    expect(s.crashed).toBe(false);
    expect(s.groundSpeedMs).toBeLessThan(0.05);
    expect(Math.abs(s.pitchDeg)).toBeLessThan(3);
    expect(s.state).toBe('prestart');
  });

  it('accelerates straight down the runway, rotates and lifts off in 50-100 m', async () => {
    const h = await make();
    let liftoff: Sample | undefined;
    for (let i = 0; i < 15 * 60 && !liftoff; i++) {
      const s = h.run(1 / 60, rotate);
      if (s.wheelsOnGround === 0 && s.altitudeM > 0.3) liftoff = s;
    }
    expect(liftoff).toBeDefined();
    expect(liftoff!.distanceM).toBeGreaterThan(40);
    expect(liftoff!.distanceM).toBeLessThan(100);
    // The new model flies the reference aircraft WITH a pilot (heavier => higher rotation speed).
    expect(liftoff!.t).toBeLessThan(model === 'new' ? 12 : 10);
    // Stays near the centreline. The new model has real left-turning tendencies (prop torque, slipstream on the fin) and this script never touches the rudder.
    expect(Math.abs(liftoff!.position[0])).toBeLessThan(model === 'new' ? 4 : 2);
    expect(liftoff!.crashed).toBe(false);
  });

  it('climbs at 2-4 m/s at full power and cruises level near 80-95 km/h', async () => {
    const h = await airborneAt(make, 30);
    const climb = h.run(6, (s) => ({ throttle: 1, ...hold(s, 8) }));
    expect(climb.verticalSpeedMs).toBeGreaterThan(2);
    expect(climb.verticalSpeedMs).toBeLessThan(4);
    const cruise = h.run(20, (s) => ({ throttle: 0.65, ...hold(s, 1) }));
    expect(cruise.airspeedMs * 3.6).toBeGreaterThan(75);
    expect(cruise.airspeedMs * 3.6).toBeLessThan(95);
    expect(Math.abs(cruise.verticalSpeedMs)).toBeLessThan(1);
  });

  it('turns at believable rates for 30 and 60 degree banks', async () => {
    const h = await airborneAt(make, 80);
    h.run(3, (s) => ({ throttle: 0.7, roll: hold(s, 0, 30).roll }));
    const a = h.log.at(-1)!.headingDeg;
    const s30 = h.run(4, (s) => ({ throttle: 0.7, roll: hold(s, 0, 30).roll }));
    const rate30 = ((s30.headingDeg - a + 360) % 360) / 4;
    expect(rate30).toBeGreaterThan(8);
    expect(rate30).toBeLessThan(20);
    h.run(3, (s) => ({ throttle: 0.9, roll: hold(s, 0, 60).roll, pitch: 0.3 }));
    const b = h.log.at(-1)!.headingDeg;
    const s60 = h.run(2, (s) => ({ throttle: 0.9, roll: hold(s, 0, 60).roll, pitch: 0.3 }));
    const rate60 = ((s60.headingDeg - b + 360) % 360) / 2;
    expect(rate60).toBeGreaterThan(25);
    expect(s60.gForce).toBeGreaterThan(1.4);
    expect(s60.crashed).toBe(false);
  });

  it('assisted mode holds the bank limit and levels the wings when the stick is released', async () => {
    const h = await airborneAt(make, 80);
    const rolled = h.run(2.5, { throttle: 0.65, roll: 1 });
    expect(rolled.rollDeg).toBeGreaterThan(45);
    expect(rolled.rollDeg).toBeLessThan(70);
    const released = h.run(3, { throttle: 0.65 });
    expect(Math.abs(released.rollDeg)).toBeLessThan(8);
  });

  it('control signs: stick back raises the nose, stick right rolls right, rudder right yaws right', async () => {
    const h = await airborneAt(make, 80);
    const p0 = h.log.at(-1)!;
    expect(h.run(0.5, { throttle: 0.65, pitch: 1 }).pitchDeg).toBeGreaterThan(p0.pitchDeg + 5);
    const h2 = await airborneAt(make, 80);
    expect(h2.run(0.5, { throttle: 0.65, roll: 1 }).rollDeg).toBeGreaterThan(10);
    const h3 = await airborneAt(make, 80);
    const hd = h3.log.at(-1)!.headingDeg;
    const yawed = h3.run(1.5, { throttle: 0.65, rudder: 1 });
    expect(((yawed.headingDeg - hd + 540) % 360) - 180).toBeGreaterThan(3);
  });

  it('stalls when forced, warns first, and recovers with power and forward stick', async () => {
    const h = await airborneAt(make, 100, {});
    let warned = false;
    let stalled = false;
    let stalledFor = 0;
    // Hold the stick back until the wing has stalled, then recognise it (1 s) and recover.
    for (let i = 0; i < 40 * 60 && stalledFor < 1; i++) {
      const s = h.run(1 / 60, { throttle: 0, pitch: 1, assistMode: 'standard' });
      if (s.stallWarning && !stalled) warned = true;
      if (s.stalled) { stalled = true; stalledFor += 1 / 60; }
    }
    expect(warned).toBe(true);
    expect(stalled).toBe(true);
    const before = h.log.at(-1)!;
    const recovered = h.run(6, (s) => ({ throttle: 1, ...hold(s, -5), assistMode: 'standard' }));
    expect(recovered.stalled).toBe(false);
    expect(recovered.crashed).toBe(false);
    expect(before.altitudeM - recovered.altitudeM).toBeLessThan(60);
  });

  it('survives a high-speed dive and pull-out within the structural envelope', async () => {
    const h = await airborneAt(make, 150);
    const dive = h.run(6, (s) => ({ throttle: 1, ...hold(s, -25) }));
    expect(dive.airspeedMs).toBeGreaterThan(30);
    expect(dive.airspeedMs).toBeLessThan(55);
    const pull = h.run(6, (s) => ({ throttle: 0.5, ...hold(s, 5) }));
    expect(pull.crashed).toBe(false);
    expect(pull.verticalSpeedMs).toBeGreaterThan(-2);
  });

  it('approaches, flares, touches down gently, brakes and completes a landing', async () => {
    const h = await airborneAt(make, 40);
    let s: Sample = h.log.at(-1)!;
    for (let i = 0; i < 240 && !s.landed && !s.crashed; i++) {
      s = h.run(0.25, (x) => {
        if (!x) return {};
        if (x.wheelsOnGround > 0 || x.state === 'groundRoll') return { throttle: 0, brake: true };
        if (x.altitudeM < 4) return { throttle: 0, ...hold(x, 6, 0, 0.1) };
        return { throttle: 0.15, ...hold(x, -4) };
      });
    }
    expect(s.crashed).toBe(false);
    expect(s.landed).toBe(true);
    expect(s.lastTouchdownVsMs).not.toBeNull();
    expect(s.lastTouchdownVsMs!).toBeGreaterThan(-2.5);
    expect(s.landingQuality).toBeGreaterThan(0.5);
    expect(s.state).toBe('stopped');
  });

  it('a nose-first dive into terrain is a crash with a reason', async () => {
    const h = await airborneAt(make, 40);
    let s: Sample = h.log.at(-1)!;
    for (let i = 0; i < 60 && !s.crashed; i++) s = h.run(0.25, (x) => ({ throttle: 1, ...hold(x, -45, 0, 0.2), assistMode: 'acro' }));
    expect(s.crashed).toBe(true);
    expect(['terrain', 'hardLanding', 'wingStrike']).toContain(s.crashReason);
    expect(s.crashOutcome).toBe('totalLoss');
  });

  it('dropping in from a deep stall close to the ground breaks the gear', async () => {
    const h = await make({ spawn: new THREE.Vector3(0, 0, 0) });
    // Teleport 25 m up with no forward speed: a pure vertical drop.
    const t = h.fc.body.translation();
    h.fc.body.setTranslation({ x: t.x, y: t.y + 25, z: t.z }, true);
    let s: Sample = h.log.at(-1) ?? h.run(1 / 60, { engineOn: false });
    for (let i = 0; i < 40 && !s.crashed; i++) s = h.run(0.25, { engineOn: false });
    expect(s.crashed).toBe(true);
  });

  it('flying into a solid obstacle is a crash', async () => {
    const tower: Obstacle = { kind: 'cylinder', id: 'test_tower', x: 0, z: 400, baseY: -100, radiusM: 6, heightM: 400 };
    const h = await make({ obstacles: [tower] });
    let s: Sample = h.log.at(-1) ?? h.run(1 / 60, {});
    for (let i = 0; i < 200 && !s.crashed; i++) s = h.run(0.25, (x) => (x && x.wheelsOnGround === 0 ? { throttle: 1, ...hold(x, 4) } : rotate(x)));
    expect(s.crashed).toBe(true);
    expect(s.crashReason).toBe('obstacle');
  });

  it('keeps the runway heading in a 5 m/s crosswind with rudder', async () => {
    const h = await make({ wind: new THREE.Vector3(-5, 0, 0) });
    let s: Sample | undefined;
    for (let i = 0; i < 9 * 60; i++) {
      s = h.run(1 / 60, (x) => ({ ...rotate(x), rudder: x ? THREE.MathUtils.clamp(-(((x.headingDeg + 540) % 360) - 180) * 0.2, -1, 1) : 0 }));
    }
    expect(Math.abs(s!.position[0])).toBeLessThan(8);
    expect(s!.crashed).toBe(false);
  });

  it('the 12 L tank and bigger engine are measurable in the air', async () => {
    const base = await airborneAt(make, 30);
    const bigTank = await airborneAt(make, 30, { build: installPart(defaultBuild(), 'fuelTank', 'tank_12') });
    expect(bigTank.fc.aircraft.fuelCapacityL).toBeGreaterThan(base.fc.aircraft.fuelCapacityL);
    const baseClimb = base.run(5, (s) => ({ throttle: 1, ...hold(s, 8) })).verticalSpeedMs;
    const strong = await airborneAt(make, 30, { build: installPart(defaultBuild(), 'engine', 'engine_medium') });
    const strongClimb = strong.run(5, (s) => ({ throttle: 1, ...hold(s, 8) })).verticalSpeedMs;
    expect(strongClimb).toBeGreaterThan(baseClimb + 0.3);
  });

  it('never produces NaN or explodes under random stick abuse', async () => {
    const h = await airborneAt(make, 60);
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
    let c = { pitch: 0, roll: 0, rudder: 0, throttle: 1 };
    for (let i = 0; i < 120; i++) {
      c = { pitch: rnd(), roll: rnd(), rudder: rnd(), throttle: (rnd() + 1) / 2 };
      const s = h.run(0.5, { ...c, assistMode: i % 2 ? 'acro' : 'standard' });
      expect(Number.isFinite(s.position[0] + s.position[1] + s.position[2] + s.speedMs)).toBe(true);
      expect(s.speedMs).toBeLessThan(95);
      if (s.crashed) break;
    }
  });
});
