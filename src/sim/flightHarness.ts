// Headless flight-test harness: the real FlightController + Rapier + terrain, no renderer.
// Used by the Test Flight Standard (flightTest.test.ts) to measure flight feel with numbers
// instead of by eye (takeoff roll, climb, turn rate, stall, landing).

import * as THREE from 'three';
import { initPhysics, createWorld } from './physics';
import { FlightController, type FlightTelemetry, type ResolvedControls } from './flightController';
import { resolveAircraft, defaultBuild } from '../content/assembly';
import { getRegion } from '../content/regions';
import { createTerrainQueryService } from '../world/terrainQuery';
import type { AircraftBuild } from '../core/types';

export const NEUTRAL: ResolvedControls = {
  throttle: 0, rudder: 0, pitch: 0, roll: 0,
  engineOn: true, brake: false, flapsDown: false, chuteDeployed: false, assistMode: 'assisted',
};

export interface Sample extends FlightTelemetry {
  t: number;
  pitchDeg: number;
  rollDeg: number;
  vsMs: number;
}

export async function createHarness(opts: { build?: AircraftBuild; regionId?: string; wind?: THREE.Vector3; spawn?: THREE.Vector3; headingDeg?: number } = {}) {
  await initPhysics();
  const world = createWorld();
  const region = getRegion(opts.regionId ?? 'the_field');
  const terrain = createTerrainQueryService(region);
  const spawn = opts.spawn ?? new THREE.Vector3(0, terrain.getElevation(0, 0) + 1.2, 0);
  const fc = new FlightController(world, resolveAircraft(opts.build ?? defaultBuild()), spawn, opts.headingDeg ?? 0, terrain);
  const wind = opts.wind ?? new THREE.Vector3();
  let t = 0;
  const log: Sample[] = [];

  const attitude = () => {
    const r = fc.body.rotation();
    const q = new THREE.Quaternion(r.x, r.y, r.z, r.w);
    const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(q);
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(q);
    return {
      pitchDeg: THREE.MathUtils.radToDeg(Math.asin(THREE.MathUtils.clamp(fwd.y, -1, 1))),
      // Positive = right wing down.
      rollDeg: THREE.MathUtils.radToDeg(Math.asin(THREE.MathUtils.clamp(-right.y, -1, 1))),
    };
  };

  /** Runs `seconds` of sim with controls from `ctl` (may be a function of the latest sample). */
  const run = (seconds: number, ctl: Partial<ResolvedControls> | ((s: Sample | undefined) => Partial<ResolvedControls>)) => {
    const n = Math.round(seconds * 60);
    for (let i = 0; i < n; i++) {
      const last = log[log.length - 1];
      const c = { ...NEUTRAL, ...(typeof ctl === 'function' ? ctl(last) : ctl) };
      const tel = fc.step(c, wind);
      t += 1 / 60;
      const lv = fc.body.linvel();
      log.push({ ...tel, t, vsMs: lv.y, ...attitude() });
    }
    return log[log.length - 1];
  };

  return { fc, world, terrain, run, log, get t() { return t; } };
}

/** Simple attitude-hold autopilot for scripted test flights (pitch/roll targets in degrees). */
export function hold(s: Sample | undefined, targetPitchDeg: number, targetRollDeg = 0, gain = 0.08) {
  if (!s) return { pitch: 0, roll: 0 };
  return {
    pitch: THREE.MathUtils.clamp((targetPitchDeg - s.pitchDeg) * gain, -1, 1),
    roll: THREE.MathUtils.clamp((targetRollDeg - s.rollDeg) * gain, -1, 1),
  };
}
