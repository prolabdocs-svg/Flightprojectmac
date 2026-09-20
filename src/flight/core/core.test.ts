import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { airDensity, indicatedAirspeed, sampleAtmosphere } from '../atmosphere/atmosphere';
import { WindField } from '../atmosphere/windField';
import { BodyFrame, angleOfAttack, bodyRates, pointVelocityBody, sideslip } from './coordinates';

describe('ISA atmosphere', () => {
  it('matches standard values', () => {
    expect(airDensity(0)).toBeCloseTo(1.225, 3);
    expect(airDensity(1000)).toBeCloseTo(1.112, 3);
    expect(airDensity(5000)).toBeCloseTo(0.736, 3);
    const s = sampleAtmosphere(2000, { temperatureK: 0, pressurePa: 0, densityKgM3: 0 });
    expect(s.temperatureK).toBeCloseTo(275.15, 2);
    expect(s.pressurePa).toBeCloseTo(79495, -2);
  });
  it('IAS < TAS aloft', () => {
    expect(indicatedAirspeed(30, airDensity(3000))).toBeLessThan(30);
  });
});

describe('coordinate conventions', () => {
  it('alpha > 0 when flow arrives from below; beta > 0 when velocity has a right-wing component', () => {
    expect(angleOfAttack(new THREE.Vector3(0, -2, 20))).toBeGreaterThan(0);
    expect(angleOfAttack(new THREE.Vector3(0, 2, 20))).toBeLessThan(0);
    expect(sideslip(new THREE.Vector3(-2, 0, 20))).toBeGreaterThan(0); // -X is the right wing
    expect(sideslip(new THREE.Vector3(2, 0, 20))).toBeLessThan(0);
  });
  it('rates: right wing down, nose up, nose right are all positive', () => {
    // Rotation about +Z lifts the +X (left) wing: right wing down = p > 0.
    const w = new THREE.Vector3(0, 0, 1);
    const v = pointVelocityBody(new THREE.Vector3(), w, new THREE.Vector3(-2, 0, 0), new THREE.Vector3());
    expect(v.y).toBeLessThan(0); // right wingtip moves down
    expect(bodyRates(w).p).toBeGreaterThan(0);
    // nose (0,0,+1) under q>0 (w = -X) moves up
    const wq = new THREE.Vector3(-1, 0, 0);
    expect(pointVelocityBody(new THREE.Vector3(), wq, new THREE.Vector3(0, 0, 2), new THREE.Vector3()).y).toBeGreaterThan(0);
    expect(bodyRates(wq).q).toBeGreaterThan(0);
    // nose under r>0 (w = -Y) moves right (-X)
    const wr = new THREE.Vector3(0, -1, 0);
    expect(pointVelocityBody(new THREE.Vector3(), wr, new THREE.Vector3(0, 0, 2), new THREE.Vector3()).x).toBeLessThan(0);
    expect(bodyRates(wr).r).toBeGreaterThan(0);
  });
  it('BodyFrame round-trips world<->body', () => {
    const f = new BodyFrame().set(...new THREE.Quaternion().setFromEuler(new THREE.Euler(0.3, 1.1, -0.4)).toArray() as [number, number, number, number]);
    const v = new THREE.Vector3(3, -2, 7);
    const b = f.toBody(v, new THREE.Vector3());
    expect(f.toWorld(b, new THREE.Vector3()).distanceTo(v)).toBeLessThan(1e-9);
  });
});

describe('WindField', () => {
  it('is deterministic and adds nothing when turbulence is off and shear is off', () => {
    const wf = new WindField({ turbulenceRmsMs: 0, shearReferenceM: 10, shearExponent: 0 });
    const out = wf.sample(new THREE.Vector3(3, 0, 1), new THREE.Vector3(), 5, 50, new THREE.Vector3());
    expect(out.toArray()).toEqual([3, 0, 1]);
  });
  it('turbulence is repeatable and bounded', () => {
    const wf = new WindField({ turbulenceRmsMs: 1.5, shearReferenceM: 10, shearExponent: 0 });
    const a = wf.sample(new THREE.Vector3(), new THREE.Vector3(10, 50, 30), 12.3, 50, new THREE.Vector3());
    const b = wf.sample(new THREE.Vector3(), new THREE.Vector3(10, 50, 30), 12.3, 50, new THREE.Vector3());
    expect(a.equals(b)).toBe(true);
    expect(a.length()).toBeLessThan(6);
  });
});
