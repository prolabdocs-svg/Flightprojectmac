import type { RegionLayout } from './regionPlacement';
import type { TerrainGridSampler } from './terrainHeightfield';
import type { TerrainQueryService } from './terrainQuery';

/**
 * Dead-space metric (World Density & Composition V2). The Field is cut into 500 m cells; a LAND
 * cell below 200 m counts as "occupied" when it holds something that reads from normal flight
 * altitude: a building, a crop parcel/ground patch, a road, a farm prop cluster, or a tree grove.
 *  - dead:   no reading element at all            -> the "nothing here" stretches to eliminate
 *  - sparse: exactly one kind of element          -> transition/open zones (we want some)
 * Mountains, water and the drowned map edge are excluded: wilderness there is intended.
 */
export interface DeadSpaceReport { lowlandCells: number; lowlandDeadFraction: number; lowlandSparseFraction: number; deadCells: Array<[number, number]> }

export function deadSpaceReport(layout: RegionLayout, grid: TerrainGridSampler, terrain: TerrainQueryService, cellM = 500, extentM = 6000): DeadSpaceReport {
  const key = (x: number, z: number) => `${Math.floor(x / cellM)},${Math.floor(z / cellM)}`;
  const kinds = new Map<string, Set<string>>();
  const mark = (x: number, z: number, k: string) => { const c = key(x, z); (kinds.get(c) ?? kinds.set(c, new Set()).get(c)!).add(k); };
  const treeCount = new Map<string, number>();
  for (const t of layout.trees) treeCount.set(key(t.x, t.z), (treeCount.get(key(t.x, t.z)) ?? 0) + 1);
  for (const [c, n] of treeCount) if (n >= 12) { const [cx, cz] = c.split(',').map(Number); mark(cx * cellM + 1, cz * cellM + 1, 'trees'); }
  for (const l of layout.lots) mark(l.x, l.z, 'building');
  for (const p of layout.patches) mark(p.center[0], p.center[1], 'ground');
  for (const r of layout.roads) for (const p of r.points) mark(p.x, p.z, 'road');
  for (const p of layout.props) if (p.kind === 'pylon' || p.kind === 'lattice_tower' || p.kind === 'windmill_landmark') mark(p.x, p.z, 'structure');
  let lowland = 0, dead = 0, sparse = 0;
  const deadCells: Array<[number, number]> = [];
  for (let x = -extentM; x < extentM; x += cellM) for (let z = -extentM; z < extentM; z += cellM) {
    const cx = x + cellM / 2, cz = z + cellM / 2, h = grid.height(cx, cz);
    if (h > 200 || terrain.getWaterDepth(cx, cz) > 0 || h < -20) continue;
    lowland++;
    const n = kinds.get(key(cx, cz))?.size ?? 0;
    if (n === 0) { dead++; deadCells.push([cx, cz]); } else if (n === 1) sparse++;
  }
  return { lowlandCells: lowland, lowlandDeadFraction: dead / Math.max(1, lowland), lowlandSparseFraction: sparse / Math.max(1, lowland), deadCells };
}
