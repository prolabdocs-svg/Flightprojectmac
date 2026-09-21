// Headless flight-test harness: the real FlightModel + Rapier + terrain, no renderer.
// Used by the Test Flight Standard (flightTest.test.ts) to measure flight feel with numbers
// instead of by eye (takeoff roll, climb, turn rate, stall, landing).

import * as THREE from 'three';
import { initPhysics, createWorld } from './physics';
import { buildHeightGrid, createHeightfieldCollider } from '../world/terrainHeightfield';
import { FlightModel } from '../flight/flightModel';
import type { FlightTelemetry, ResolvedControls } from '../flight/flightTypes';
import { resolveAircraft, defaultBuild } from '../content/assembly';
import { getRegion } from '../content/regions';
import { createTerrainQueryService } from '../world/terrainQuery';
import type { AircraftBuild } from '../core/types';
import type { Obstacle } from '../world/obstacles';

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

/** The Field's height grid is deterministic; building it (66k samples) once keeps harnesses cheap. */
let fieldGrid: Float32Array | undefined;

export async function createHarness(opts: { build?: AircraftBuild; regionId?: string; wind?: THREE.Vector3; spawn?: THREE.Vector3; headingDeg?: number; obstacles?: Obstacle[] } = {}) {
  const RAPIER = await initPhysics();
  const world = createWorld();
  const region = getRegion(opts.regionId ?? 'the_field');
  const terrain = createTerrainQueryService(region);
  if (region.environment.terrain === 'meadow') createHeightfieldCollider(RAPIER, world, (fieldGrid ??= buildHeightGrid(terrain.getElevation)));
  const spawn = opts.spawn ?? new THREE.Vector3(0, terrain.getElevation(0, 0) + 1.2, 0);
  const build = opts.build ?? defaultBuild();
  const aircraft = resolveAircraft(build);
  const fc = new FlightModel(world, aircraft, build, spawn, opts.headingDeg ?? 0, terrain, { obstacles: opts.obstacles });
  const dt = fc.dtS;
  const wind = opts.wind ?? new THREE.Vector3();
  let t = 0;
  const log: Sample[] = [];

  const attitude = () => {
    const r = fc.body.rotation();
    const q = new THREE.Quaternion(r.x, r.y, r.z, r.w);
    const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(q);
    const left = new THREE.Vector3(1, 0, 0).applyQuaternion(q);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
    return {
      pitchDeg: THREE.MathUtils.radToDeg(Math.asin(THREE.MathUtils.clamp(fwd.y, -1, 1))),
      // Positive = right wing down (left wing is local +X).
      rollDeg: THREE.MathUtils.radToDeg(Math.atan2(left.y, up.y)),
    };
  };

  /** Runs `seconds` of sim with controls from `ctl` (may be a function of the latest sample). */
  const run = (seconds: number, ctl: Partial<ResolvedControls> | ((s: Sample | undefined) => Partial<ResolvedControls>)) => {
    const n = Math.round(seconds / dt);
    for (let i = 0; i < n; i++) {
      const last = log[log.length - 1];
      const c = { ...NEUTRAL, ...(typeof ctl === 'function' ? ctl(last) : ctl) };
      const tel = fc.step(c, wind);
      t += dt;
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
