/** Pure placement/safety helpers for the airfield compound and access road built around
 * a region's runway (FlightScene.ts). Kept dependency-free from Three.js so the safe-zone
 * math and road routing can be unit tested without a WebGL context. */

export interface RunwayFootprint {
  position: readonly [number, number, number];
  runwayWidthM: number;
  runwayLengthM: number;
}

export interface AxisAlignedZone { minX: number; maxX: number; minZ: number; maxZ: number }

/** World spec: no new prop/obstacle may sit within 35m of the runway centerline/pad. */
export const RUNWAY_SAFE_BUFFER_M = 35;

export function getRunwaySafeZone(airfield: RunwayFootprint, bufferM = RUNWAY_SAFE_BUFFER_M): AxisAlignedZone {
  const [cx, , cz] = airfield.position;
  return {
    minX: cx - airfield.runwayWidthM / 2 - bufferM,
    maxX: cx + airfield.runwayWidthM / 2 + bufferM,
    minZ: cz - airfield.runwayLengthM / 2 - bufferM,
    maxZ: cz + airfield.runwayLengthM / 2 + bufferM,
  };
}

export function isInsideZone(x: number, z: number, zone: AxisAlignedZone): boolean {
  return x >= zone.minX && x <= zone.maxX && z >= zone.minZ && z <= zone.maxZ;
}

function sampleSegment(from: readonly [number, number], to: readonly [number, number], steps = 24): Array<[number, number]> {
  const points: Array<[number, number]> = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    points.push([from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t]);
  }
  return points;
}

/** Routes an access road between two points, bending around one waypoint outside the
 * runway safe zone if a straight line would otherwise cross it. */
export function routeAroundSafeZone(
  from: readonly [number, number],
  to: readonly [number, number],
  zone: AxisAlignedZone,
): Array<[number, number]> {
  const straightClear = sampleSegment(from, to).every(([x, z]) => !isInsideZone(x, z, zone));
  if (straightClear) return [[from[0], from[1]], [to[0], to[1]]];
  // Both endpoints sit outside the zone's x-range (compound/rural core are always laid
  // out clear of the runway), so a dogleg that only changes z while holding each
  // endpoint's own x, then crosses at a z outside the zone's z-range, never re-enters it.
  const zEdge = Math.abs((from[1] + to[1]) / 2 - zone.minZ) < Math.abs((from[1] + to[1]) / 2 - zone.maxZ) ? zone.minZ - 6 : zone.maxZ + 6;
  return [[from[0], from[1]], [from[0], zEdge], [to[0], zEdge], [to[0], to[1]]];
}

/** Grid-sampled ground-following mesh data: vertex positions are local to the mesh's own
 * center (so the mesh itself stays at position (centerX, 0, centerZ)), but each vertex's
 * height is sampled from world terrain at that vertex's true world x/z — so an apron,
 * parcel or pad built from this grid hugs the local undulation instead of floating/clipping
 * as a single flat plane would. Pure data/math (no Three.js), so it's unit-testable without
 * a WebGL context; render code turns `positions`/`indices` directly into a BufferGeometry. */
export interface TerrainFollowingMeshData {
  /** Flat [x, y, z] triples, local to the mesh's own center, row-major (rows along Z). */
  positions: Float32Array;
  indices: number[];
}

export function buildTerrainFollowingMesh(
  widthM: number,
  depthM: number,
  segments: number,
  centerX: number,
  centerZ: number,
  getElevation: (x: number, z: number) => number,
  liftM = 0.02,
): TerrainFollowingMeshData {
  const cols = segments + 1;
  const rows = segments + 1;
  const positions = new Float32Array(cols * rows * 3);
  for (let row = 0; row < rows; row++) {
    const localZ = -depthM / 2 + (row / segments) * depthM;
    for (let col = 0; col < cols; col++) {
      const localX = -widthM / 2 + (col / segments) * widthM;
      const i = (row * cols + col) * 3;
      positions[i] = localX;
      positions[i + 1] = getElevation(centerX + localX, centerZ + localZ) + liftM;
      positions[i + 2] = localZ;
    }
  }
  const indices: number[] = [];
  for (let row = 0; row < segments; row++) {
    for (let col = 0; col < segments; col++) {
      const a = row * cols + col, b = a + 1, cIdx = a + cols, d = cIdx + 1;
      indices.push(a, cIdx, b, b, cIdx, d);
    }
  }
  return { positions, indices };
}

/** Flattens a waypoint polyline into fixed-length road tile placements (position + yaw),
 * used to lay out an InstancedMesh without one Mesh per tile. */
export function layoutRoadTiles(waypoints: ReadonlyArray<[number, number]>, tileLengthM: number): Array<{ x: number; z: number; rotationY: number }> {
  const tiles: Array<{ x: number; z: number; rotationY: number }> = [];
  for (let i = 0; i < waypoints.length - 1; i++) {
    const [x0, z0] = waypoints[i];
    const [x1, z1] = waypoints[i + 1];
    const dx = x1 - x0, dz = z1 - z0;
    const length = Math.hypot(dx, dz);
    if (length === 0) continue;
    const rotationY = Math.atan2(dx, dz);
    const count = Math.max(1, Math.round(length / tileLengthM));
    for (let t = 0; t < count; t++) {
      const frac = (t + 0.5) / count;
      tiles.push({ x: x0 + dx * frac, z: z0 + dz * frac, rotationY });
    }
  }
  return tiles;
}
