import { describe, expect, it } from 'vitest';
import { buildSurfaceDetailData } from './surfaceDetail';

describe('surface detail texture', () => {
  const size = 128;
  const data = buildSurfaceDetailData(size);
  const at = (x: number, y: number, c: number) => data[(y * size + x) * 4 + c];

  it('has every channel centred on 0.5 so mip-averaged detail does not shift the palette', () => {
    for (let c = 0; c < 4; c++) {
      let sum = 0;
      for (let i = 0; i < size * size; i++) sum += data[i * 4 + c];
      expect(Math.abs(sum / (size * size) / 255 - 0.5)).toBeLessThan(0.03);
    }
  });

  it('tiles seamlessly: the wrap-around step is no larger than a typical interior step', () => {
    for (let c = 0; c < 4; c++) {
      // Mean absolute step across every interior seam vs across the wrap seam.
      let edgeX = 0, innerX = 0, edgeY = 0, innerY = 0;
      for (let k = 0; k < size; k++) {
        edgeX += Math.abs(at(size - 1, k, c) - at(0, k, c));
        edgeY += Math.abs(at(k, size - 1, c) - at(k, 0, c));
        for (let j = 1; j < size; j++) {
          innerX += Math.abs(at(j, k, c) - at(j - 1, k, c)) / (size - 1);
          innerY += Math.abs(at(k, j, c) - at(k, j - 1, c)) / (size - 1);
        }
      }
      expect(edgeX).toBeLessThan(innerX * 1.5 + size);
      expect(edgeY).toBeLessThan(innerY * 1.5 + size);
    }
  });

  it('is deterministic', () => {
    expect(Buffer.from(buildSurfaceDetailData(size)).equals(Buffer.from(data))).toBe(true);
  });
});
