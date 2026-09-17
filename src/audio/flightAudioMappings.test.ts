import { describe, expect, it } from 'vitest';
import {
  engineFilterCutoffHz,
  engineFundamentalHz,
  engineGain,
  propWhooshGain,
  propWhooshHz,
  rpmFraction,
  rumbleGain,
  sinkRateToIntensity,
  stallHornGain,
  windFilterCutoffHz,
  windGain,
} from './flightAudioMappings';

describe('rpmFraction', () => {
  it('is 0 at idle and 1 at redline', () => {
    expect(rpmFraction(1200, 1200, 6200)).toBe(0);
    expect(rpmFraction(6200, 1200, 6200)).toBe(1);
  });

  it('clamps outside the idle..redline band', () => {
    expect(rpmFraction(0, 1200, 6200)).toBe(0);
    expect(rpmFraction(9000, 1200, 6200)).toBe(1);
  });

  it('is 0 for a degenerate (non-positive) rpm band', () => {
    expect(rpmFraction(4000, 6200, 1200)).toBe(0);
  });
});

describe('engineFundamentalHz', () => {
  it('is rpm/60 (one power pulse per revolution)', () => {
    expect(engineFundamentalHz(1200)).toBeCloseTo(20, 5);
    expect(engineFundamentalHz(6000)).toBeCloseTo(100, 5);
  });

  it('never goes negative', () => {
    expect(engineFundamentalHz(-500)).toBe(0);
  });
});

describe('engineFilterCutoffHz', () => {
  it('brightens monotonically with rpm fraction', () => {
    expect(engineFilterCutoffHz(1)).toBeGreaterThan(engineFilterCutoffHz(0));
  });
});

describe('engineGain', () => {
  it('is silent when the engine is off regardless of throttle', () => {
    expect(engineGain(1, false)).toBe(0);
  });

  it('increases with throttle when running', () => {
    expect(engineGain(1, true)).toBeGreaterThan(engineGain(0.2, true));
  });
});

describe('propWhooshHz / propWhooshGain', () => {
  it('whoosh frequency rises with rpm', () => {
    expect(propWhooshHz(6000)).toBeGreaterThan(propWhooshHz(1200));
  });

  it('whoosh gain is silent when the engine is off', () => {
    expect(propWhooshGain(0.8, false)).toBe(0);
  });
});

describe('windGain / windFilterCutoffHz', () => {
  it('increases with airspeed', () => {
    expect(windGain(30)).toBeGreaterThan(windGain(5));
    expect(windFilterCutoffHz(30)).toBeGreaterThan(windFilterCutoffHz(5));
  });

  it('is near zero at a standstill', () => {
    expect(windGain(0)).toBe(0);
  });
});

describe('rumbleGain', () => {
  it('is silent while airborne no matter the ground speed reading', () => {
    expect(rumbleGain(false, 20)).toBe(0);
  });

  it('scales with ground speed while rolling', () => {
    expect(rumbleGain(true, 20)).toBeGreaterThan(rumbleGain(true, 2));
  });
});

describe('stallHornGain', () => {
  it('is silent when no stall warning is active', () => {
    expect(stallHornGain(false, 1.23)).toBe(0);
  });

  it('pulses on and off over time while warning', () => {
    const values = [0, 0.1, 0.2, 0.3, 0.4, 0.5].map((t) => stallHornGain(true, t));
    expect(values.some((v) => v > 0)).toBe(true);
    expect(values.some((v) => v === 0)).toBe(true);
  });
});

describe('sinkRateToIntensity', () => {
  it('maps 0 sink rate to 0 intensity', () => {
    expect(sinkRateToIntensity(0)).toBe(0);
  });

  it('clamps hard impacts to 1', () => {
    expect(sinkRateToIntensity(50)).toBe(1);
  });

  it('treats sink rate direction-independently', () => {
    expect(sinkRateToIntensity(-3)).toBe(sinkRateToIntensity(3));
  });

  it('a gentle touchdown reads much softer than a hard one', () => {
    expect(sinkRateToIntensity(0.5)).toBeLessThan(sinkRateToIntensity(4));
  });
});
