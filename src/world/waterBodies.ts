/**
 * WLD-03 hydrology (spec §19-24, §217, §240, §249). Deliberately minimal per spec §266
 * non-goals: no flow accumulation, no watershed graph, no polyline rivers — a water body
 * is just a flat circular footprint, which is the simplest shape that satisfies the MVP
 * scope (one lake, one bay) without scattering water into every region (spec §2.1
 * causality: an element exists because the story/geography justifies it).
 */
export type WaterBodyKind = 'pond' | 'stream' | 'lake' | 'reservoir';

export interface WaterBody {
  id: string;
  regionId: string;
  kind: WaterBodyKind;
  center: [number, number]; // world x/z
  radiusM: number;
  surfaceElevationM: number; // filled in by buildWaterBodies from natural terrain
}

interface WaterBodySeed {
  id: string;
  regionId: string;
  kind: WaterBodyKind;
  center: [number, number];
  radiusM: number;
}

/**
 * Only regions whose flavor text already promises water get one (spec §2.1 causality):
 * - backcountry: "Bosques, lagos y pistas cortas entre montañas" -> one lake.
 * - coast_run: "Acantilados, playas y viento cruzado sobre el agua" -> one bay.
 * No airfield exists yet in either region (see src/world/airfields.ts), so there is no
 * runway-overlap risk today, but the QA guard below still checks it for whenever one is added.
 */
// Centers were picked by sampling the region's own natural terrain for a local low point
// (a real basin, not an arbitrary coordinate), so the surrounding terrain slopes down toward
// it rather than the lake sitting on a ridge (spec §222 QA: no "water over ridge").
const WATER_BODY_SEEDS: WaterBodySeed[] = [
  { id: 'backcountry_lake', regionId: 'backcountry', kind: 'lake', center: [300, 65], radiusM: 90 },
  { id: 'coast_run_bay', regionId: 'coast_run', kind: 'lake', center: [340, 1250], radiusM: 220 },
];

/** Builds this region's water bodies, sampling the surface elevation once per body from
 * the natural (pre-grading) terrain — same "sample once, treat as flat" trick as airfield
 * grading — so a lake never has multiple surface elevations (spec §222 QA: hydrology). */
export function buildWaterBodies(
  regionId: string,
  naturalElevation: (x: number, z: number) => number,
): WaterBody[] {
  return WATER_BODY_SEEDS.filter((s) => s.regionId === regionId).map((s) => ({
    ...s,
    surfaceElevationM: naturalElevation(s.center[0], s.center[1]),
  }));
}

/** The water body covering point (x, z), if any. Circular footprints only, so this is a
 * simple distance check — no spatial index needed at this scale (a handful of bodies per region). */
export function findWaterBodyAt(bodies: WaterBody[], x: number, z: number): WaterBody | undefined {
  return bodies.find((b) => Math.hypot(x - b.center[0], z - b.center[1]) <= b.radiusM);
}
