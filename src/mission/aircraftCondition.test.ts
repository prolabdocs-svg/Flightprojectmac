import { describe, expect, it } from 'vitest';
import {
  componentTopology, createAircraftCondition, severityForIntegrity, damageAccumulated, repairRequired,
  isCriticalDamage, evaluateAirworthiness, INTEGRITY_WORN, INTEGRITY_DAMAGED, INTEGRITY_CRITICAL, INTEGRITY_INOPERATIVE,
} from './aircraftCondition';

describe('createAircraftCondition', () => {
  it('starts every component fully healthy', () => {
    const c = createAircraftCondition();
    for (const id of componentTopology()) {
      expect(c[id].integrity).toBe(1);
      expect(severityForIntegrity(c[id].integrity)).toBe('HEALTHY');
      expect(repairRequired(c[id])).toBe(false);
    }
  });
});

describe('severityForIntegrity thresholds', () => {
  it('bands are ordered and centralized', () => {
    expect(INTEGRITY_WORN).toBeGreaterThan(INTEGRITY_DAMAGED);
    expect(INTEGRITY_DAMAGED).toBeGreaterThan(INTEGRITY_CRITICAL);
    expect(INTEGRITY_CRITICAL).toBeGreaterThan(INTEGRITY_INOPERATIVE);
  });
  it.each([
    [1, 'HEALTHY'], [INTEGRITY_WORN, 'HEALTHY'], [INTEGRITY_WORN - 0.01, 'WORN'],
    [INTEGRITY_DAMAGED, 'WORN'], [INTEGRITY_DAMAGED - 0.01, 'DAMAGED'],
    [INTEGRITY_CRITICAL, 'DAMAGED'], [INTEGRITY_CRITICAL - 0.01, 'CRITICAL'],
    [INTEGRITY_INOPERATIVE, 'CRITICAL'], [INTEGRITY_INOPERATIVE - 0.01, 'INOPERATIVE'], [0, 'INOPERATIVE'],
  ] as const)('%f -> %s', (integrity, expected) => {
    expect(severityForIntegrity(integrity)).toBe(expected);
  });
});

describe('damageAccumulated / isCriticalDamage', () => {
  it('is the complement of integrity', () => {
    expect(damageAccumulated({ integrity: 0.7 })).toBeCloseTo(0.3);
  });
  it('flags CRITICAL and INOPERATIVE as critical damage, nothing better', () => {
    expect(isCriticalDamage({ integrity: INTEGRITY_CRITICAL - 0.01 })).toBe(true);
    expect(isCriticalDamage({ integrity: INTEGRITY_INOPERATIVE })).toBe(true);
    expect(isCriticalDamage({ integrity: INTEGRITY_DAMAGED })).toBe(false);
  });
});

describe('evaluateAirworthiness', () => {
  it('a fresh aircraft is AIRWORTHY with no reasons', () => {
    const a = evaluateAirworthiness(createAircraftCondition());
    expect(a.status).toBe('AIRWORTHY');
    expect(a.reasons).toEqual([]);
  });
  it('a CRITICAL component RESTRICTS, naming the component', () => {
    const c = createAircraftCondition();
    c.wingLeft = { integrity: INTEGRITY_CRITICAL - 0.01 };
    const a = evaluateAirworthiness(c);
    expect(a.status).toBe('RESTRICTED');
    expect(a.reasons).toEqual([{ componentId: 'wingLeft', severity: 'CRITICAL' }]);
  });
  it('an INOPERATIVE component GROUNDS even if another is only CRITICAL', () => {
    const c = createAircraftCondition();
    c.wingLeft = { integrity: INTEGRITY_CRITICAL };
    c.engine = { integrity: 0 };
    const a = evaluateAirworthiness(c);
    expect(a.status).toBe('GROUNDED');
    expect(a.reasons.some((r) => r.componentId === 'engine' && r.severity === 'INOPERATIVE')).toBe(true);
  });
});
