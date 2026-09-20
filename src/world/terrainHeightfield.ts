import type RAPIER from '@dimforge/rapier3d-compat';

/** The Field's terrain is one 16 km square, 256x256 cells (~62 m). Render mesh, Rapier
 * heightfield and ground queries all sample the same `getElevation`. */
export const FIELD_TERRAIN_SIZE_M = 16_000;
export const FIELD_TERRAIN_SEGMENTS = 256;

/** Row-major (row = z, column = x) elevation samples at the (segments+1)^2 grid vertices,
 * with the grid centred on the world origin. */
export function buildHeightGrid(
  elevation: (x: number, z: number) => number,
  sizeM = FIELD_TERRAIN_SIZE_M,
  segments = FIELD_TERRAIN_SEGMENTS,
): Float32Array {
  const n = segments + 1;
  const heights = new Float32Array(n * n);
  for (let iz = 0; iz < n; iz++) {
    for (let ix = 0; ix < n; ix++) {
      heights[iz * n + ix] = elevation(-sizeM / 2 + (ix / segments) * sizeM, -sizeM / 2 + (iz / segments) * sizeM);
    }
  }
  return heights;
}

/** Static Rapier heightfield collider from a row-major grid. Rapier wants nrows/ncols in
 * CELLS with (nrows+1)*(ncols+1) heights stored column-major (passing vertex counts here
 * reads past the buffer and traps the wasm module). Rows run along z, columns along x.
 * The collider sits exactly on the terrain surface (no offset). */
export function createHeightfieldCollider(
  rapier: typeof RAPIER,
  world: RAPIER.World,
  grid: Float32Array,
  sizeM = FIELD_TERRAIN_SIZE_M,
  segments = FIELD_TERRAIN_SEGMENTS,
): RAPIER.Collider {
  const n = segments + 1;
  const columnMajor = new Float32Array(n * n);
  for (let iz = 0; iz < n; iz++) for (let ix = 0; ix < n; ix++) columnMajor[ix * n + iz] = grid[iz * n + ix];
  const desc = rapier.ColliderDesc.heightfield(segments, segments, columnMajor, { x: sizeM, y: 1, z: sizeM });
  return world.createCollider(desc);
}
