import * as THREE from 'three';
import type { GroundSurfaceId } from '../world/surfaces';

/**
 * One curated ground palette for the streamed master world, tuned to the same warm, slightly desaturated hues as the
 * authored field ground (fieldTerrainColor.ts), so every region reads as one universe. Variation is controlled: broad
 * low-frequency mottling plus slope/altitude rules, never per-vertex random noise.
 */
const c = (hex: string) => new THREE.Color(hex);
const SURFACE: Record<GroundSurfaceId, THREE.Color> = {
  grass: c('#7d9a4b'),
  forest_floor: c('#4f7639'),
  scrub: c('#a59a60'),
  rock: c('#877f73'),
  sand: c('#d0bd8a'),
  salt: c('#e2d9c6'),
  dirt: c('#9a7f58'),
  gravel: c('#8e877a'),
  tarmac: c('#5d5d58'),
};
const DRY = c('#aba36a'), LUSH = c('#5f853f'), ROCK = c('#80786d'), HIGH_ROCK = c('#bdb8ae'), SNOW = c('#eef0ee');
const smooth = (a: number, b: number, v: number) => { const t = Math.min(1, Math.max(0, (v - a) / (b - a))); return t * t * (3 - 2 * t); };

export function masterGroundColor(surface: GroundSurfaceId, x: number, z: number, elevationM: number, slopeDeg: number, out: THREE.Color): THREE.Color {
  out.copy(SURFACE[surface]);
  const vegetated = surface === 'grass' || surface === 'forest_floor' || surface === 'scrub';
  if (vegetated) {
    // Lush hollows / dry rises at 200-600 m so broad plains never read as one flat green.
    const m = Math.sin(x / 213 + Math.sin(z / 347) * 1.7) * Math.sin(z / 271 + Math.sin(x / 419) * 1.3);
    out.lerp(m > 0 ? LUSH : DRY, Math.min(1, Math.abs(m) * 1.3) * 0.35);
  }
  // Exposed faces go to rock in the same stone tone everywhere; then altitude bleaches it, then snow caps.
  out.lerp(ROCK, smooth(24, 38, slopeDeg) * 0.85);
  out.lerp(HIGH_ROCK, smooth(1400, 1900, elevationM) * 0.7);
  out.lerp(SNOW, smooth(2100, 2400, elevationM) * (1 - smooth(35, 50, slopeDeg)));
  return out;
}
