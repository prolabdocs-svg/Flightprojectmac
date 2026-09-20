// Phase 2 gate: the bare Quicksilver-class airframe glides stably without engine, with no
// control input, and the response comes purely from forces and moments.
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { defaultBuild } from '../../content/assembly';
import { buildAircraftDefinition } from '../aircraft/quicksilver';
import { createAirframeRig } from './rig';
import { glideTrim } from './trim';

const def = buildAircraftDefinition(defaultBuild());

async function trimmedRig(d = def) {
  const trim = await glideTrim(d);
  const gamma = -Math.atan(1 / trim.glideRatio);
  const rig = await createAirframeRig(d, { speedMs: trim.speedMs, pitchDeg: ((trim.alphaDeg * Math.PI) / 180 + gamma) * (180 / Math.PI) });
  // createAirframeRig launches along body +Z; re-launch along the true path.
  const th = (trim.alphaDeg * Math.PI) / 180 + gamma;
  rig.phys.place(new THREE.Vector3(0, 500, 0), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(-1, 0, 0), th),
    new THREE.Vector3(0, trim.speedMs * Math.sin(gamma), trim.speedMs * Math.cos(gamma)));
  return { rig, trim };
}

describe('Phase 2 gate — stable power-off glide', () => {
  it('mass/CG/inertia reach Rapier and the body weighs what the definition says', async () => {
    const { rig } = await trimmedRig();
    rig.run(0.05);
    expect(rig.phys.mass.massKg).toBeGreaterThan(200);
    expect(rig.phys.body.mass()).toBeCloseTo(rig.phys.mass.massKg, 3);
  });

  it('is longitudinally statically stable, glides ~8-11:1 and trims where the analysis says', async () => {
    const t = await glideTrim(def);
    expect(t.staticStability).toBeLessThan(0);
    expect(t.glideRatio).toBeGreaterThan(8);
    expect(t.glideRatio).toBeLessThan(11);
    expect(t.speedMs * 3.6).toBeGreaterThan(70);
    expect(t.speedMs * 3.6).toBeLessThan(95);
    const { rig } = await trimmedRig();
    const s = rig.run(8);
    // Starting on the trim point it stays near it (phugoid excursion is small and slow).
    expect(Math.abs(s.airspeedMs - t.speedMs)).toBeLessThan(3);
    expect(Math.abs(s.alphaDeg - t.alphaDeg)).toBeLessThan(2.5);
    expect(-s.vsMs).toBeGreaterThan(t.sinkMs - 1);
    expect(-s.vsMs).toBeLessThan(t.sinkMs + 1);
  });

  it('60 s hands-off glide: no divergence, phugoid damps, bank stays small, no numerical guard fired', async () => {
    const { rig } = await trimmedRig();
    // Disturb it: 6 m/s speed offset excites the phugoid.
    rig.phys.body.setLinvel({ x: 0, y: rig.phys.body.linvel().y, z: rig.phys.body.linvel().z * 1.2 }, true);
    const speeds: number[] = [];
    for (let i = 0; i < 60; i++) {
      const s = rig.run(1);
      speeds.push(s.airspeedMs);
      expect(Number.isFinite(s.airspeedMs + s.altM)).toBe(true);
    }
    const amp = (a: number[]) => Math.max(...a) - Math.min(...a);
    expect(amp(speeds.slice(40))).toBeLessThan(amp(speeds.slice(0, 20)));
    const last = rig.log.at(-1)!;
    expect(Math.abs(last.rollDeg)).toBeLessThan(25);
    expect(Math.abs(last.betaDeg)).toBeLessThan(3);
    expect(Math.max(...rig.log.map((x) => Math.abs(x.qDegS)))).toBeLessThan(60);
    expect(rig.phys.guardEvents).toEqual({ angularRate: 0, speed: 0, nonFinite: 0 });
  });

  it('a perfectly symmetric airframe stays wings-level and straight (no hidden yaw/roll forcing)', async () => {
    const sym = buildAircraftDefinition(defaultBuild());
    for (const e of sym.aero.elements) if (e.id.startsWith('wing_R')) e.incidenceDeg -= 0.04;
    const { rig } = await trimmedRig(sym);
    rig.run(30);
    const s = rig.log.at(-1)!;
    expect(Math.abs(s.rollDeg)).toBeLessThan(0.05);
    expect(Math.abs(s.betaDeg)).toBeLessThan(0.05);
    expect(Math.abs(s.x)).toBeLessThan(0.05);
  });

  it('is deterministic: two identical runs are bit-identical', async () => {
    const a = (await trimmedRig()).rig; a.run(10);
    const b = (await trimmedRig()).rig; b.run(10);
    expect(a.log.at(-1)).toEqual(b.log.at(-1));
  });

  it('a heavier pilot moves the CG and changes trim (mass/CG feed the physics)', async () => {
    const heavy = buildAircraftDefinition(defaultBuild());
    heavy.mass.items.find((i) => i.id === 'pilot')!.massKg = 110;
    const a = await glideTrim(def);
    const b = await glideTrim(heavy);
    expect(b.speedMs).toBeGreaterThan(a.speedMs); // more weight -> faster trim/glide speed
  });
});
