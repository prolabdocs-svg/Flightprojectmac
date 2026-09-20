import { describe, expect, it } from 'vitest';
import { FIELD_LAKE, FIELD_RIVER_POINTS } from '../world/fieldGeography';
import { fieldGroundColor } from './fieldTerrainColor';

const hsl = (x: number, z: number, e: number, slope: number) => {
  const o = { h: 0, s: 0, l: 0 };
  fieldGroundColor(x, z, e, slope).getHSL(o);
  return o;
};

describe('Field ground colour classification', () => {
  it('reads green on the plain, greener in the river valley, and grey on rock', () => {
    const plain = hsl(0, 0, 6, 1);
    const [rx, rz] = FIELD_RIVER_POINTS[30];
    const valley = hsl(rx, rz, -16, 2);
    const steep = hsl(1100, 3100, 300, 40);
    const ridge = hsl(-1500, 4150, 560, 20);
    expect(plain.h).toBeGreaterThan(0.18); // green-yellow, not brown
    expect(valley.h).toBeGreaterThan(plain.h);
    expect(steep.s).toBeLessThan(plain.s * 0.5);
    expect(ridge.l).toBeGreaterThan(steep.l);
    expect(ridge.s).toBeLessThan(0.2);
  });

  it('has a wet green lake margin and mud at the waterline', () => {
    const wet = hsl(FIELD_LAKE.x + FIELD_LAKE.radiusM + 250, FIELD_LAKE.z, -8, 3);
    const rim = hsl(FIELD_LAKE.x + FIELD_LAKE.radiusM + 5, FIELD_LAKE.z, -12, 3);
    expect(wet.h).toBeGreaterThan(0.22);
    expect(rim.h).toBeLessThan(wet.h);
  });
});
