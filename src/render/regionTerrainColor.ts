import * as THREE from 'three';
import type { RegionArtBible } from '../world/regionArtBible';

/**
 * Ground colour for a composed region that is not The Field (which has its own authored
 * `fieldTerrainColor.ts`). This is the runtime consumer of `RegionArtBible.accentColors` and
 * `geologyIds`: the biome blend gives the base hue, the art bible decides what the cliffs,
 * the sedimentary bands and the low ground look like, so Red Canyon reads as layered red
 * sandstone rather than "the meadow shader with a brown tint".
 */
export interface RegionGroundPalette {
  base: THREE.Color;
  cliff: THREE.Color;
  band: THREE.Color;
  low: THREE.Color;
  /** Vertical period (m) of the sedimentary banding; 0 disables banding. */
  bandPeriodM: number;
}

export function buildRegionGroundPalette(artBible: RegionArtBible, base: THREE.Color): RegionGroundPalette {
  const [a0, a1, a2] = artBible.accentColors;
  return {
    base,
    cliff: new THREE.Color(a0 ?? base),
    band: new THREE.Color(a1 ?? a0 ?? base),
    low: new THREE.Color(a2 ?? a0 ?? base),
    // Only the eroded/layered geologies get visible strata banding.
    bandPeriodM: artBible.geologyIds.some((g) => g === 'eroded_mesa' || g === 'red_sandstone' || g === 'scree') ? 30 : 0,
  };
}

const tmp = new THREE.Color();

export function regionGroundColor(p: RegionGroundPalette, elevationM: number, slopeDeg: number, lowRefM: number, out: THREE.Color): void {
  out.copy(p.base);
  // Exposed rock faces take the geology accent; the steeper, the more of it.
  const cliff = Math.min(1, Math.max(0, (slopeDeg - 16) / 26));
  if (p.bandPeriodM > 0) {
    // Sedimentary bands show on exposed faces only; on flat mesa tops the same term drew
    // contour-line blotches (seen in the first viewer pass), so it is gated by slope.
    const phase = Math.abs(((elevationM / p.bandPeriodM) % 2) - 1);
    const exposed = Math.min(1, Math.max(0, (slopeDeg - 8) / 14));
    out.lerp(tmp.copy(p.band), (0.1 + 0.35 * phase) * exposed);
  }
  if (cliff > 0) out.lerp(tmp.copy(p.cliff), 0.65 * cliff);
  // Valley/wash floors: shaded, debris-coloured.
  const low = Math.min(1, Math.max(0, 1 - (elevationM - lowRefM) / 70));
  if (low > 0) out.lerp(tmp.copy(p.low), 0.4 * low);
}
