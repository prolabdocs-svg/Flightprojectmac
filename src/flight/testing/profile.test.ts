// Mobile-readiness profile (spec section 38) for the flight model on the JS engine: cost per
// fixed step and allocation pressure (GC count as the proxy), measured on the core simulation and
// on the full game-facing FlightModel. Budgets are deliberately generous so the test is stable on
// CI; the numbers themselves are printed and recorded in docs/flight/FLIGHT_PERFORMANCE.md.
import { describe, expect, it, vi } from 'vitest';
import { PerformanceObserver, performance } from 'node:perf_hooks';
import * as THREE from 'three';
import { createHarness } from '../../sim/flightHarness';
import { FlightModel } from '../flightModel';
import { defaultBuild } from '../../content/assembly';
import { buildAircraftDefinition } from '../aircraft/quicksilver';
import { createAirframeRig } from './rig';

vi.setConfig({ testTimeout: 120_000 });

async function profile(label: string, stepFn: () => void, steps: number) {
  for (let i = 0; i < 3000; i++) stepFn(); // JIT warm-up
  let gcs = 0;
  let gcMs = 0;
  const obs = new PerformanceObserver((list) => {
    for (const e of list.getEntries()) { gcs++; gcMs += e.duration; }
  });
  obs.observe({ entryTypes: ['gc'] });
  const t0 = performance.now();
  for (let i = 0; i < steps; i++) stepFn();
  const ms = performance.now() - t0;
  await new Promise((r) => setTimeout(r, 20)); // let the observer flush
  obs.disconnect();
  const perStepUs = (ms / steps) * 1000;
  console.log(`[profile] ${label}: ${perStepUs.toFixed(1)} us/step (${(1e6 / perStepUs).toFixed(0)} steps/s), ${gcs} GC(s), ${gcMs.toFixed(1)} ms GC over ${steps} steps`);
  return { perStepUs, gcs, gcMs };
}

describe('performance budget', () => {
  it('core AircraftSimulation: fast and (almost) allocation free', async () => {
    const def = buildAircraftDefinition(defaultBuild());
    const rig = await createAirframeRig(def, { altM: 2000, speedMs: 24 });
    const cmd = { engineOn: true, throttle: 0.7, pitch: 0, roll: 0, yaw: 0, brake: 0 };
    const wind = new THREE.Vector3(2, 0, 1);
    const p = await profile('AircraftSimulation.step', () => rig.sim.step(cmd, wind), 40_000);
    expect(p.perStepUs).toBeLessThan(200); // ~15-35 us measured in node, ~100 us for the full model in the browser
    expect(p.gcs).toBeLessThanOrEqual(10);
  });

  it('FlightModel (rules + telemetry object per tick): cheap, low GC', async () => {
    const h = await createHarness({ model: 'new' });
    const fc = h.fc as FlightModel;
    const controls = { throttle: 0.6, rudder: 0, pitch: 0, roll: 0, engineOn: true, brake: false, flapsDown: false, chuteDeployed: false, assistMode: 'assisted' as const };
    const wind = new THREE.Vector3();
    let n = 0;
    // Keep it flying (game fuel burn is short): refuel periodically so the scenario stays in cruise.
    const p = await profile('FlightModel.step (cruise, real terrain)', () => {
      if (++n % 500 === 0) fc.sim.physics.fuelL = fc.sim.def.mass.fuelCapacityL;
      fc.step(controls, wind);
    }, 40_000);
    expect(fc.getState()).toBe('airborne');
    expect(p.perStepUs).toBeLessThan(250);
    // Remaining garbage is dominated by the shared TerrainQueryService (~8 KB per getElevation call).
    expect(p.gcs).toBeLessThanOrEqual(60);
  });
});

describe('ground phase cost (gear + structural contacts + real terrain queries)', () => {
  it('taxi/takeoff roll on the field terrain stays cheap', async () => {
    const h = await createHarness({ model: 'new' });
    const fc = h.fc as FlightModel;
    const controls = { throttle: 0.35, rudder: 0, pitch: 0, roll: 0, engineOn: true, brake: true, flapsDown: false, chuteDeployed: false, assistMode: 'assisted' as const };
    const wind = new THREE.Vector3();
    const p = await profile('FlightModel.step (on ground, braked)', () => { fc.step(controls, wind); }, 20_000);
    expect(p.perStepUs).toBeLessThan(900);
  });
});
