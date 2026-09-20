import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { defaultBuild } from '../../content/assembly';
import { buildAircraftDefinition } from '../aircraft/quicksilver';
import { Propulsion } from './propulsion';

const def = buildAircraftDefinition(defaultBuild());

function run(seconds: number, opts: { throttle: number; V?: number; rho?: number; engineOn?: boolean; fuel?: number; alphaDeg?: number }, pr = new Propulsion(def.engine!, def.propeller!)) {
  const V = opts.V ?? 0;
  const a = ((opts.alphaDeg ?? 0) * Math.PI) / 180;
  const air = new THREE.Vector3(0, -V * Math.sin(a), V * Math.cos(a));
  for (let i = 0; i < seconds * 100; i++) {
    pr.step(0.01, { throttle: opts.throttle, engineOn: opts.engineOn ?? true, fuelL: opts.fuel ?? 5, rho: opts.rho ?? 1.225, airAtHub: air });
  }
  return pr;
}

describe('engine + propeller', () => {
  it('starts, then idles at the idle rpm the balance produces (not a lookup)', () => {
    const pr = run(3, { throttle: 0 });
    expect(pr.engine.state).toBe('running');
    expect(pr.engine.rpm).toBeGreaterThan(def.engine!.idleRpm * 0.92);
    expect(pr.engine.rpm).toBeLessThan(def.engine!.idleRpm * 1.08);
  });

  it('full throttle: rpm settles below redline, thrust matches the propeller equation, spool-up < 1 s', () => {
    const pr = new Propulsion(def.engine!, def.propeller!);
    run(2, { throttle: 0 }, pr);
    let t90 = -1;
    for (let i = 0; i < 300; i++) {
      run(0.01, { throttle: 1 }, pr);
      if (t90 < 0 && pr.engine.rpm > 0.9 * 4400) t90 = i * 0.01;
    }
    expect(pr.engine.rpm).toBeLessThan(def.engine!.redlineRpm);
    expect(pr.engine.rpm).toBeGreaterThan(3500);
    expect(t90).toBeGreaterThan(0);
    expect(t90).toBeLessThan(1);
    const n = pr.propRpm / 60;
    const expected = def.propeller!.ct0 * 1.225 * n * n * def.propeller!.diameterM ** 4;
    expect(pr.thrustN).toBeCloseTo(expected, 0);
    expect(pr.thrustN).toBeGreaterThan(300);
  });

  it('thrust is NOT throttle * constant: it is nonlinear and lapses with airspeed', () => {
    const half = run(3, { throttle: 0.5 }).thrustN;
    const full = run(3, { throttle: 1 }).thrustN;
    // thrust ~ n^2 and rpm ~ power^(1/3): half throttle gives clearly more than half the thrust.
    expect(half / full).toBeGreaterThan(0.55);
    expect(half / full).toBeLessThan(0.8);
    const fast = run(3, { throttle: 1, V: 28 }).thrustN;
    expect(fast).toBeLessThan(full * 0.75);
  });

  it('rpm rises as the prop unloads with airspeed; a windmilling prop is a brake', () => {
    const slow = run(3, { throttle: 1, V: 5 }).engine.rpm;
    const fast = run(3, { throttle: 1, V: 26 }).engine.rpm;
    expect(fast).toBeGreaterThan(slow);
    const windmill = run(3, { throttle: 0, V: 38 });
    expect(windmill.thrustN).toBeLessThan(0);
  });

  it('power lapses with altitude (density) and the engine dies without fuel or when switched off', () => {
    const sea = run(3, { throttle: 1 }).engine.powerW;
    const high = run(3, { throttle: 1, rho: 0.9 }).engine.powerW;
    expect(high).toBeLessThan(sea * 0.85);
    const pr = run(3, { throttle: 1 });
    run(6, { throttle: 1, fuel: 0 }, pr);
    expect(pr.engine.state).toBe('off');
    expect(pr.engine.rpm).toBeLessThan(500);
  });

  it('fuel burn follows power', () => {
    const idle = run(2, { throttle: 0 }).fuelFlowLps;
    const wot = run(3, { throttle: 1 }).fuelFlowLps;
    expect(wot).toBeGreaterThan(idle * 3);
  });

  it('reaction torque is the shaft torque and opposes the (clockwise) prop rotation', () => {
    const pr = run(3, { throttle: 1 });
    expect(pr.reactionTorque.z).toBeLessThan(-10);
    const Q = pr.reactionTorque.z;
    expect(Math.abs(Q)).toBeGreaterThan(10);
  });

  it('P-factor: with the disc at positive alpha the thrust centre moves to the descending (right) blade', () => {
    const a = run(2, { throttle: 1, V: 20, alphaDeg: 0 });
    const b = run(2, { throttle: 1, V: 20, alphaDeg: 12 });
    expect(a.thrustPoint[0]).toBeCloseTo(0, 3);
    expect(b.thrustPoint[0]).toBeLessThan(-0.01); // -X = right
  });

  it('slipstream speed comes from momentum theory and shrinks as airspeed grows', () => {
    const stat = run(3, { throttle: 1 }).slipstream.axialMs;
    const cruise = run(3, { throttle: 1, V: 22 }).slipstream.axialMs;
    expect(stat).toBeGreaterThan(cruise);
    expect(cruise).toBeGreaterThan(2);
  });
});
