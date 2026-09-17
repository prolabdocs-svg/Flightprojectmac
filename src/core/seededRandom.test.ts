import { describe, expect, it } from 'vitest';
import { SeededRandom, createSeededRandom, deriveSeed } from './seededRandom';

describe('SeededRandom', () => {
  it('produces the same sequence for the same seed', () => {
    const a = new SeededRandom(12345);
    const b = new SeededRandom(12345);
    const seqA = Array.from({ length: 10 }, () => a.next());
    const seqB = Array.from({ length: 10 }, () => b.next());
    expect(seqA).toEqual(seqB);
  });

  it('produces different sequences for different seeds', () => {
    const a = new SeededRandom(1);
    const b = new SeededRandom(2);
    const seqA = Array.from({ length: 10 }, () => a.next());
    const seqB = Array.from({ length: 10 }, () => b.next());
    expect(seqA).not.toEqual(seqB);
  });

  it('next() stays within [0, 1)', () => {
    const rng = new SeededRandom(42);
    for (let i = 0; i < 1000; i++) {
      const v = rng.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('range() stays within [min, max)', () => {
    const rng = new SeededRandom(99);
    for (let i = 0; i < 1000; i++) {
      const v = rng.range(5, 15);
      expect(v).toBeGreaterThanOrEqual(5);
      expect(v).toBeLessThan(15);
    }
  });

  it('intRange() stays within [min, max) and is an integer', () => {
    const rng = new SeededRandom(7);
    for (let i = 0; i < 1000; i++) {
      const v = rng.intRange(0, 4);
      expect(Number.isInteger(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(4);
    }
  });

  it('pick() only returns elements from the array', () => {
    const rng = new SeededRandom(2024);
    const arr = ['a', 'b', 'c', 'd'];
    for (let i = 0; i < 100; i++) {
      expect(arr).toContain(rng.pick(arr));
    }
  });

  it('pick() throws on empty array', () => {
    const rng = new SeededRandom(1);
    expect(() => rng.pick([])).toThrow();
  });

  it('createSeededRandom is deterministic for the same parts', () => {
    const a = createSeededRandom('region', 'scrap_valley', 1);
    const b = createSeededRandom('region', 'scrap_valley', 1);
    expect(a.next()).toBe(b.next());
  });
});

describe('deriveSeed', () => {
  it('is stable for the same inputs', () => {
    expect(deriveSeed('scrap_valley', 'mission-1')).toBe(deriveSeed('scrap_valley', 'mission-1'));
  });

  it('produces different seeds for different inputs', () => {
    expect(deriveSeed('scrap_valley')).not.toBe(deriveSeed('the_field'));
    expect(deriveSeed('region', 1)).not.toBe(deriveSeed('region', 2));
  });

  it('returns a non-negative 32-bit integer', () => {
    const seed = deriveSeed('anything', 42, 'more-parts');
    expect(Number.isInteger(seed)).toBe(true);
    expect(seed).toBeGreaterThanOrEqual(0);
    expect(seed).toBeLessThan(2 ** 32);
  });
});
