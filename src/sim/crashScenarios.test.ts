// Crash & Damage V2 reproducible scenarios: the same contact sequence the flight model feeds
// applyImpact(), with physically derived inputs for a ~300 kg ultralight. Each scenario must
// leave a distinct damage signature.
import { describe, expect, it } from 'vitest';
import {
  applyImpact, componentState, createDamageState, gearPartId, getAeroEffectivenessMultiplier,
  getPowerMultiplier, getVibration, impactEnergyJ, isAirframeLost, type DamageState,
} from './damageSystem';

const M = 300;
const fresh = () => createDamageState(['aileron_l', 'aileron_r', 'elevator', 'rudder']);
const hit = (s: DamageState, zone: string, normal: number, tangent = 0) => applyImpact(s, zone, impactEnergyJ(M, normal, tangent));
const states = (s: DamageState) => Object.fromEntries(Object.keys(s.parts).map((id) => [id, componentState(s, id)]));

describe('Crash & Damage V2 scenarios', () => {
  it('normal touchdown does nothing', () => {
    const s = hit(fresh(), 'gear', 1.5, 25 * 0.15);
    expect(Object.values(states(s)).every((v) => v === 'HEALTHY')).toBe(true);
    expect(s.outcome).toBe('none');
  });

  it('hard landing: gear takes it, airframe survives, flight continues', () => {
    const s = hit(fresh(), 'gear', 5.5, 3);
    expect(componentState(s, gearPartId())).not.toBe('HEALTHY');
    expect(componentState(s, gearPartId())).not.toBe('DETACHED');
    expect(componentState(s, 'engine')).toBe('HEALTHY');
    expect(isAirframeLost(s)).toBe(false);
    expect(s.outcome).toBe('hardLanding');
  });

  it('wingtip strike: one wing only -> asymmetric lift and roll authority', () => {
    const s = hit(fresh(), 'wingtipL', 2.5, 20);
    expect(getAeroEffectivenessMultiplier(s, 'wing_l')).toBeLessThan(1);
    expect(getAeroEffectivenessMultiplier(s, 'wing_r')).toBe(1);
    expect(getAeroEffectivenessMultiplier(s, 'aileron_l')).toBeLessThan(getAeroEffectivenessMultiplier(s, 'aileron_r'));
    expect(isAirframeLost(s)).toBe(false);
  });

  it('nose-over: prop strike, rough engine, vibration; not fatal until it flips', () => {
    let s = hit(fresh(), 'nose', 3, 6);
    expect(componentState(s, 'propeller')).not.toBe('HEALTHY');
    expect(getPowerMultiplier(s, 0)).toBeLessThan(1);
    expect(getVibration(s)).toBeGreaterThan(0.2);
    expect(isAirframeLost(s)).toBe(false);
    s = hit(s, 'nose', 5, 4);
    expect(componentState(s, 'propeller')).toBe('DETACHED');
    expect(getPowerMultiplier(s, 0)).toBe(0);
  });

  it('tree impact at cruise: wing torn off, fuselage intact', () => {
    const v = 22; // obstacle path in flightModel: 0.8 normal / 0.6 tangent of impact speed
    const s = hit(fresh(), 'wingtipR', v * 0.8, v * 0.6);
    expect(componentState(s, 'wing_r')).toBe('DETACHED');
    expect(getAeroEffectivenessMultiplier(s, 'aileron_r')).toBe(0);
    expect(componentState(s, 'wing_l')).toBe('HEALTHY');
    expect(isAirframeLost(s)).toBe(false);
  });

  it('runway excursion: rough-ground scrape wears the gear/belly gradually, never snaps parts', () => {
    let s = fresh();
    for (let i = 0; i < 180; i++) s = applyImpact(s, 'bellyFront', 0.35 * 1500 * 8 / 60, false); // 3 s of scraping
    expect(isAirframeLost(s)).toBe(false);
    expect(s.parts[gearPartId()].integrity).toBeLessThan(1);
    expect(Object.values(states(s))).not.toContain('DETACHED');
  });

  it('high-speed terrain collision: airframe lost', () => {
    const s = hit(fresh(), 'nose', 25, 20);
    expect(isAirframeLost(s)).toBe(true);
    expect(componentState(s, 'propeller')).toBe('DETACHED');
  });

  it('40° nose-in at cruise speed is fatal; a 10 m/s nose strike is not', () => {
    expect(isAirframeLost(hit(fresh(), 'nose', 16, 19))).toBe(true);
    expect(isAirframeLost(hit(fresh(), 'nose', 10, 8))).toBe(false);
  });

  it('small knocks never detach anything, even repeated', () => {
    let s = fresh();
    for (let i = 0; i < 40; i++) s = hit(s, 'tail', 2.2);
    expect(Object.values(states(s))).not.toContain('DETACHED');
  });

  it('damaged engine gives irregular output', () => {
    const s = applyImpact(fresh(), 'nose', 20000);
    const samples = Array.from({ length: 200 }, (_, i) => getPowerMultiplier({ ...s, parts: { ...s.parts, propeller: { ...s.parts.propeller, integrity: 1, detached: false } } }, i * 0.05));
    expect(new Set(samples.map((x) => x.toFixed(3))).size).toBeGreaterThan(1);
  });
});

describe('gear collapse passes energy to the airframe', () => {
  it('8 m/s sink wrecks the gear but not the fuselage; 12 m/s reaches the fuselage', () => {
    const at = (v: number) => hit(fresh(), 'gear', v, 3);
    expect(isAirframeLost(at(8))).toBe(false);
    expect(at(12).parts.fuselage.integrity).toBeLessThan(at(8).parts.fuselage.integrity - 0.3);
  });
});
