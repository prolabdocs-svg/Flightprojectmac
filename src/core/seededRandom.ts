// Deterministic PRNG utility for procedural world/prop generation. Using Math.random()
// directly for things like prop placement means the same region/mission renders a
// different layout every session, which breaks consistency, debugging, and any future
// replay/screenshot-regression tooling. Seed a SeededRandom from stable identifiers
// (region id, mission id, etc.) via deriveSeed() instead.

/** mulberry32: a small, fast, well-known 32-bit PRNG. Not cryptographically secure —
 * fine for cosmetic world generation. */
export class SeededRandom {
  private state: number;

  constructor(seed: number) {
    // Ensure a valid 32-bit unsigned integer seed.
    this.state = seed >>> 0;
  }

  /** Returns the next pseudo-random float in [0, 1). */
  next(): number {
    this.state |= 0;
    this.state = (this.state + 0x6d2b79f5) | 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Returns a pseudo-random float in [min, max). */
  range(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  /** Returns a pseudo-random integer in [min, max) (max exclusive). */
  intRange(min: number, max: number): number {
    return Math.floor(this.range(min, max));
  }

  /** Returns a pseudo-random element from a non-empty array. */
  pick<T>(array: T[]): T {
    if (array.length === 0) throw new Error('SeededRandom.pick: array is empty');
    return array[this.intRange(0, array.length)];
  }

  /** Returns true with the given probability (default 0.5). */
  chance(probability = 0.5): boolean {
    return this.next() < probability;
  }
}

/** Creates a SeededRandom instance seeded deterministically from the given parts. */
export function createSeededRandom(...parts: (string | number)[]): SeededRandom {
  return new SeededRandom(deriveSeed(...parts));
}

/** Hashes a combination of identifiers (world/region/chunk/mission ids, etc.) into a
 * stable 32-bit numeric seed using FNV-1a. Same inputs always produce the same seed. */
export function deriveSeed(...parts: (string | number)[]): number {
  const input = parts.join('|');
  let hash = 0x811c9dc5; // FNV offset basis
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193); // FNV prime
  }
  return hash >>> 0;
}
