// Phase 7 gate: wind and gusts act through the airflow, never by moving the aircraft.
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { defaultBuild } from '../../content/assembly';
import { buildAircraftDefinition } from '../aircraft/quicksilver';
import { createAirframeRig, holdAttitude, keepRunway, headingError, type RigSample } from './rig';
import { DEG } from '../core/constants';

const def = buildAircraftDefinition(defaultBuild());
const KMH = 3.6;

async function takeoffDistance(wind: THREE.Vector3) {
  const rig = await createAirframeRig(def, { onGround: true, wind });
  let liftoff: RigSample | undefined;
  for (let i = 0; i < 25 * 20 && !liftoff; i++) {
    const s = rig.run(0.05, (x) => ({
      engineOn: true, throttle: 1, ...keepRunway(x),
      ...(x && x.airspeedMs > 52 / KMH ? { pitch: holdAttitude(x, 9).pitch } : {}),
    }));
    if (s.wheels === 0 && s.agl > 1.2) liftoff = s;
  }
  return liftoff!;
}

describe('wind changes the airflow', () => {
  it('headwind shortens the takeoff roll, tailwind lengthens it (airspeed, not ground speed, drives lift)', async () => {
    const still = await takeoffDistance(new THREE.Vector3());
    const head = await takeoffDistance(new THREE.Vector3(0, 0, -6));
    const tail = await takeoffDistance(new THREE.Vector3(0, 0, 4));
    expect(head.z).toBeLessThan(still.z * 0.85);
    expect(tail.z).toBeGreaterThan(still.z * 1.1);
    // the liftoff AIRSPEED is nearly the same in all three; ground speed differs
    expect(Math.abs(head.airspeedMs - still.airspeedMs)).toBeLessThan(3);
  });

  it('a steady crosswind carries the aircraft with the air mass (drift ~ wind * t) without disturbing airspeed', async () => {
    const wind = new THREE.Vector3(-5, 0, 0);
    const rig = await createAirframeRig(def, { altM: 900, speedMs: 24, wind });
    // Start in the air mass frame: aircraft already moving at the airmass velocity + airspeed.
    rig.phys.place(new THREE.Vector3(0, 900, 0), new THREE.Quaternion(), new THREE.Vector3(-5, 0, 24));
    rig.run(1, (s) => ({ engineOn: true, throttle: 0.75, ...holdAttitude(s, 1.5) }));
    const x0 = rig.log.at(-1)!.x;
    const v0 = rig.log.at(-1)!.airspeedMs;
    const s = rig.run(12, (x) => ({ engineOn: true, throttle: 0.75, ...holdAttitude(x, 1.5) }));
    const drift = s.x - x0;
    expect(drift).toBeLessThan(-40); // carried toward -X
    expect(drift).toBeGreaterThan(-75);
    expect(Math.abs(s.airspeedMs - v0)).toBeLessThan(4);
    expect(Math.abs(s.betaDeg)).toBeLessThan(3); // it crabs, it does not slip
  });

  it('a sudden updraft raises AoA and produces a load-factor spike from the wing, with no scripted force', async () => {
    const rig = await createAirframeRig(def, { altM: 900, speedMs: 22 });
    rig.phys.place(new THREE.Vector3(0, 900, 0), new THREE.Quaternion(), new THREE.Vector3(0, 0, 22));
    rig.run(1.5, (s) => ({ engineOn: true, throttle: 0.7, ...holdAttitude(s, 1.5) }));
    const g0 = rig.log.at(-1)!.gLoad;
    const a0 = rig.log.at(-1)!.alphaDeg;
    // vertical gust: the wind vector moves up 3 m/s. rig.wind is the shared Vector3.
    rig.wind.set(0, 3, 0);
    const s = rig.run(0.3, (x) => ({ engineOn: true, throttle: 0.7, ...holdAttitude(x, 1.5) }));
    const peakG = Math.max(...rig.log.slice(-30).map((x) => x.gLoad));
    const peakAlpha = Math.max(...rig.log.slice(-30).map((x) => x.alphaDeg));
    expect(peakAlpha - a0).toBeGreaterThan(3);
    expect(peakG - g0).toBeGreaterThan(0.3);
    expect(peakG - g0).toBeLessThan(1.6);
    void s;
  });

  it('a parked aircraft in wind stays put (tyres hold it; wind is not a push on the transform)', async () => {
    const rig = await createAirframeRig(def, { onGround: true, wind: new THREE.Vector3(-6, 0, 2) });
    const s = rig.run(6, { engineOn: false, brake: 1 });
    expect(s.speedMs).toBeLessThan(0.4);
    expect(s.wheels).toBe(3);
  });
});

describe('crosswind landing', () => {
  it('crab on approach, de-crab in the flare, land on the wheels and stop on the runway', async () => {
    const wind = new THREE.Vector3(-4, 0, 0); // from the left, blowing right
    const rig = await createAirframeRig(def, { altM: 40, speedMs: 20, wind });
    const crab = -Math.asin(4 / 20) / DEG; // nose into the wind (left of track)
    rig.phys.place(
      new THREE.Vector3(0, 40 + rig.sim.gear.restHeightM, -320),
      new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(-1, 0, 0), -3 * DEG).premultiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -crab * DEG)),
      new THREE.Vector3(-4 + 20 * Math.sin(-crab * DEG) * 0, -1.2, 19.5),
    );
    // Start in the air mass: ground velocity = air velocity (heading) + wind.
    const h = crab * DEG;
    rig.phys.body.setLinvel({ x: -19.5 * Math.sin(h) - 4, y: -1.2, z: 19.5 * Math.cos(h) }, true);
    let touch: RigSample | undefined;
    let maxSide = 0;
    for (let i = 0; i < 20 * 70; i++) {
      const x = rig.log.at(-1);
      const cmd = (() => {
        if (!x) return { engineOn: true, throttle: 0.25 };
        if (x.wheels > 0) return { engineOn: true, throttle: 0, brake: 0.7, ...keepRunway(x) };
        const flare = x.agl < 3.5;
        const headingTarget = flare ? 0 : crab + 0.08 * Math.max(-30, Math.min(30, -x.x)); // steer toward the centreline while crabbing
        const yaw = Math.max(-1, Math.min(1, headingError(headingTarget, x.headingDeg) * 0.12 - x.rDegS * 0.03));
        const rollTarget = flare ? -3 : 0; // wing low into the wind in the flare
        return { engineOn: true, throttle: flare ? 0 : 0.25, ...holdAttitude(x, flare ? 5 : -3, rollTarget), yaw };
      })();
      const s = rig.run(0.05, cmd);
      if (!touch && s.wheels > 0) touch = s;
      if (s.wheels > 0) maxSide = Math.max(maxSide, ...rig.sim.gear.wheels.map((w) => Math.abs(w.latForceN)));
      if (touch && s.speedMs < 0.5) break;
    }
    expect(touch).toBeDefined();
    expect(Math.abs(touch!.x)).toBeLessThan(20);
    const end = rig.log.at(-1)!;
    expect(end.speedMs).toBeLessThan(1);
    expect(end.wheels).toBe(3);
    expect(Math.abs(end.x)).toBeLessThan(30);
    expect(rig.sim.structure.contacts.some((c) => c.active)).toBe(false); // no wing/belly strike
    expect(maxSide).toBeGreaterThan(50); // the tyres really took a side load
    expect(rig.phys.guardEvents).toEqual({ angularRate: 0, speed: 0, nonFinite: 0 });
  });
});
