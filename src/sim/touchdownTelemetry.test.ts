import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { computeCrosswindMs, computeRollPitchDeg } from './touchdownTelemetry';

const IDENTITY = { x: 0, y: 0, z: 0, w: 1 };

describe('computeRollPitchDeg', () => {
  it('reads level, wings-flat attitude as zero roll and pitch', () => {
    const { rollDeg, pitchDeg } = computeRollPitchDeg(IDENTITY);
    expect(rollDeg).toBeCloseTo(0, 5);
    expect(pitchDeg).toBeCloseTo(0, 5);
  });

  it('reports a nose-up pitch as positive', () => {
    const quat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), THREE.MathUtils.degToRad(-10));
    const { pitchDeg } = computeRollPitchDeg(quat);
    expect(pitchDeg).toBeCloseTo(10, 3);
  });

  it('reports a nose-down pitch as negative', () => {
    const quat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), THREE.MathUtils.degToRad(10));
    const { pitchDeg } = computeRollPitchDeg(quat);
    expect(pitchDeg).toBeCloseTo(-10, 3);
  });

  it('reports a bank angle as roll, independent of heading', () => {
    const bank = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), THREE.MathUtils.degToRad(20));
    const heading = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), THREE.MathUtils.degToRad(135));
    const combined = heading.clone().multiply(bank);
    const level = computeRollPitchDeg(heading);
    const banked = computeRollPitchDeg(combined);
    expect(level.rollDeg).toBeCloseTo(0, 3);
    // Rotating +20deg about +Z lifts the left (+X) wing: a right-wing-down bank.
    expect(banked.rollDeg).toBeCloseTo(20, 3);
  });
});

describe('computeCrosswindMs', () => {
  it('is zero when the wind blows straight down the aircraft heading', () => {
    const wind = new THREE.Vector3(0, 0, 12);
    expect(computeCrosswindMs(wind, IDENTITY)).toBeCloseTo(0, 5);
  });

  it('reads a pure lateral wind as the full crosswind component', () => {
    // Right wing is -X for a +Z-facing aircraft, so wind toward -X is a +7 right crosswind.
    const wind = new THREE.Vector3(-7, 0, 0);
    expect(computeCrosswindMs(wind, IDENTITY)).toBeCloseTo(7, 5);
  });

  it('rotates with the aircraft heading', () => {
    const wind = new THREE.Vector3(7, 0, 0);
    const heading90 = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2);
    // After a 90 degree yaw the local right axis points along world -Z (or +Z depending on
    // handedness) rather than world +X, so a purely-world-X wind no longer registers fully
    // as crosswind.
    expect(Math.abs(computeCrosswindMs(wind, heading90))).toBeLessThan(1);
  });
});
