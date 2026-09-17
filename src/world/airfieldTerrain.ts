import { getRegionAirfields, type AirfieldDefinition } from './airfields';

/** Airport terrain override (WLD-02, world spec section 72): the flat, vegetation-free
 * graded footprint every runway needs regardless of the noisy natural terrain around it.
 * Before this, exactly one region (`the_field`) had a single hand-placed flat disc baked
 * into the elevation formula, centered on nothing in particular — every other airfield in
 * every other region (including a second strip inside `the_field` itself) sat directly on
 * raw undulating noise. This derives one override per airfield straight from the airfield
 * registry instead, so grading always matches where the runway actually is. */
export interface AirportTerrainOverride {
  airfieldId: string;
  /** World x/z of the runway center (== the airfield's own position). */
  center: [number, number];
  /** Graded pad radius in metres: half the runway length plus obstacle-clearance margin. */
  radiusM: number;
  surface: AirfieldDefinition['surface'];
}

/** Clearance beyond the runway ends/edges kept flat and vegetation-free (world spec
 * section 74 "approach clearance"). Not a real obstacle-clearance surface calculation —
 * just enough margin that props/trees never spawn on the usable runway. */
const GRADING_MARGIN_M = 40;

export function buildAirportOverrides(regionId: string): AirportTerrainOverride[] {
  return getRegionAirfields(regionId).map((airfield) => ({
    airfieldId: airfield.id,
    center: [airfield.position[0], airfield.position[2]],
    radiusM: airfield.runwayLengthM / 2 + GRADING_MARGIN_M,
    surface: airfield.surface,
  }));
}

/** The override whose graded pad contains this world point, if any. */
export function findAirportOverrideAt(
  overrides: AirportTerrainOverride[],
  x: number,
  z: number,
): AirportTerrainOverride | undefined {
  return overrides.find((o) => Math.hypot(x - o.center[0], z - o.center[1]) < o.radiusM);
}
