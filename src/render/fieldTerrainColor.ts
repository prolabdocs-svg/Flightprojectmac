import * as THREE from 'three';
import { distanceToRiver, FIELD_LAKE, homePlainMask, SEA_LEVEL_M, smoothstep } from '../world/fieldGeography';

/** Cheap per-vertex ground colour for The Field, from geography rather than the old biome
 * blend: elevation, slope, river distance and lake proximity classify the surface so the
 * valley, lake shore, plain, hills, slopes and ridges read apart from altitude. */
const c = (hex: string) => new THREE.Color(hex);
const DRY = c('#a2a05a'), HILL = c('#6c9e44'), PLAIN = c('#74a84c'), VALLEY = c('#2c8c44');
const WET = c('#4f9a5a'), MUD = c('#8f8560'), SAND = c('#cdbd8b'), ROCK = c('#7b756c'), HIGH_ROCK = c('#bdb8ae');

export function fieldGroundColor(x: number, z: number, elevationM: number, slopeDeg: number, out = new THREE.Color()): THREE.Color {
  // Broad dry/green patches so rolling hills read as a grass / dry-grass mixture.
  const patch = 0.5 + 0.5 * Math.sin(x / 1100 + Math.sin(z / 1700) * 2) * Math.sin(z / 900 + 1.3);
  out.copy(DRY).lerp(HILL, patch);
  out.lerp(DRY, smoothstep(200, 350, elevationM) * 0.35); // upland turns dry
  out.lerp(PLAIN, homePlainMask(x, z) * 0.85);
  out.lerp(VALLEY, (1 - smoothstep(120, 800, distanceToRiver(x, z))) * 0.85);
  const lakeEdge = Math.hypot(x - FIELD_LAKE.x, z - FIELD_LAKE.z) - FIELD_LAKE.radiusM;
  out.lerp(WET, (1 - smoothstep(0, 450, lakeEdge)) * 0.75);
  out.lerp(MUD, (1 - smoothstep(0, 90, lakeEdge)) * 0.6);
  out.lerp(SAND, (1 - smoothstep(SEA_LEVEL_M, SEA_LEVEL_M + 16, elevationM)) * smoothstep(5500, 7000, Math.max(Math.abs(x), Math.abs(z))) * 0.9); // coast only
  const rock = Math.max(smoothstep(20, 32, slopeDeg), smoothstep(230, 400, elevationM) * 0.6); // steep or alpine
  out.lerp(ROCK, rock * 0.92);
  out.lerp(HIGH_ROCK, smoothstep(400, 560, elevationM) * (0.8 + 0.2 * rock));
  return out;
}
