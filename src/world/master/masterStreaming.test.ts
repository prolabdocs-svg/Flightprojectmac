import { describe, expect, it } from 'vitest';
import {
  MAX_LEVEL, MasterStreamer, ROOTS_PER_AXIS, TILE_VERTS, WORLD_MIN_M, childrenOf, distanceToTile, float32ResolutionM,
  parentOf, rebaseOrigin, tileAt, tileHeightGrid, tileId, tileMinX, tileMinZ, tileSizeM,
} from './masterStreaming';

describe('tile lattice', () => {
  it('covers the whole map with no gaps at every level, and children exactly tile their parent', () => {
    for (let level = 0; level <= MAX_LEVEL; level++) {
      const n = ROOTS_PER_AXIS * 2 ** (MAX_LEVEL - level);
      expect(tileAt(level, WORLD_MIN_M + 0.1, WORLD_MIN_M + 0.1)).toEqual({ level, ix: 0, iz: 0 });
      expect(tileAt(level, -WORLD_MIN_M - 0.1, -WORLD_MIN_M - 0.1)).toEqual({ level, ix: n - 1, iz: n - 1 });
    }
    const p = { level: 3, ix: 2, iz: 5 };
    const kids = childrenOf(p);
    expect(kids.map((k) => parentOf(k))).toEqual([p, p, p, p]);
    const s = tileSizeM(p.level);
    expect(tileMinX(kids[0])).toBe(tileMinX(p));
    expect(tileMinX(kids[1])).toBe(tileMinX(p) + s / 2);
    expect(tileMinZ(kids[2])).toBe(tileMinZ(p) + s / 2);
  });

  it('the map half-extent (24 km) is fully inside the tile lattice', () => {
    const half = -WORLD_MIN_M;
    expect(half).toBeGreaterThanOrEqual(24000);
  });
});

describe('LOD selection', () => {
  it('is 2:1 balanced: no two adjacent leaves differ by more than one level', () => {
    const s = new MasterStreamer();
    const plan = s.update({ x: -10500, z: -2000, vx: 40, vz: 0, aglM: 300 });
    const byId = new Map(plan.tiles.filter((t) => !t.prefetch).map((t) => [t.id, t]));
    for (const t of byId.values()) {
      const size = tileSizeM(t.key.level), x0 = tileMinX(t.key), z0 = tileMinZ(t.key);
      const probes: Array<[number, number]> = [[x0 + size / 2, z0 + size + 1], [x0 + size / 2, z0 - 1], [x0 - 1, z0 + size / 2], [x0 + size + 1, z0 + size / 2]];
      for (const [px, pz] of probes) {
        if (px < WORLD_MIN_M || pz < WORLD_MIN_M) continue;
        let probeLevel: number | null = null;
        for (const o of byId.values()) if (px >= tileMinX(o.key) && px < tileMinX(o.key) + tileSizeM(o.key.level) && pz >= tileMinZ(o.key) && pz < tileMinZ(o.key) + tileSizeM(o.key.level)) { probeLevel = o.key.level; break; }
        if (probeLevel !== null) expect(Math.abs(probeLevel - t.key.level), `${t.id} vs neighbour L${probeLevel}`).toBeLessThanOrEqual(1);
      }
    }
  });

  it('refines toward the aircraft (nearest tile is always L0) and respects maxTiles', () => {
    const s = new MasterStreamer({ maxTiles: 200 });
    const plan = s.update({ x: 0, z: 0, vx: 0, vz: 0, aglM: 50 });
    const drawn = plan.tiles.filter((t) => !t.prefetch);
    expect(drawn.length).toBeLessThanOrEqual(200);
    const nearest = drawn.reduce((a, b) => (distanceToTile(a.key, 0, 0) <= distanceToTile(b.key, 0, 0) ? a : b));
    expect(nearest.key.level).toBe(0);
  });

  it('coarsens with altitude (same position, higher AGL selects fewer/coarser tiles)', () => {
    const low = new MasterStreamer().update({ x: -10500, z: -2000, vx: 0, vz: 0, aglM: 60 });
    const high = new MasterStreamer().update({ x: -10500, z: -2000, vx: 0, vz: 0, aglM: 6000 });
    const meanLevel = (p: typeof low) => { const d = p.tiles.filter((t) => !t.prefetch); return d.reduce((s2, t) => s2 + t.key.level, 0) / d.length; };
    expect(meanLevel(high)).toBeGreaterThan(meanLevel(low));
  });

  it('the physics ring only ever contains L0 tiles, grows with speed, and collapses to (at most) the tile(s) under the aircraft well above the ground', () => {
    const slow = new MasterStreamer().update({ x: 100, z: 100, vx: 5, vz: 0, aglM: 100 });
    for (const t of slow.tiles) if (t.physics) expect(t.key.level).toBe(0);
    const fastPlan = new MasterStreamer().update({ x: 100, z: 100, vx: 60, vz: 0, aglM: 100 });
    expect(fastPlan.physicsRingM).toBeGreaterThan(slow.physicsRingM);
    const cruise = new MasterStreamer().update({ x: 100, z: 100, vx: 0, vz: 0, aglM: 5000 });
    const cruisePhysics = cruise.tiles.filter((t) => t.physics);
    expect(cruisePhysics.length).toBeLessThan(slow.tiles.filter((t) => t.physics).length);
    for (const t of cruisePhysics) expect(distanceToTile(t.key, 100, 100)).toBeLessThan(512);
  });

  it('produces the same plan for the same inputs (deterministic), independent of call history', () => {
    const a = new MasterStreamer().update({ x: 1234, z: -5678, vx: 12, vz: -8, aglM: 220 });
    const b = new MasterStreamer().update({ x: 1234, z: -5678, vx: 12, vz: -8, aglM: 220 });
    expect(a.tiles.map((t) => t.id).sort()).toEqual(b.tiles.map((t) => t.id).sort());
  });

  it('load/unload are bounded per update and unload only drops tiles that left the current plan', () => {
    const s = new MasterStreamer({}, 5);
    const first = s.update({ x: 0, z: 0, vx: 0, vz: 0, aglM: 50 });
    expect(first.load.length).toBeLessThanOrEqual(5);
    const moved = s.update({ x: 20000, z: 20000, vx: 0, vz: 0, aglM: 50 });
    const stillWanted = new Set(moved.tiles.map((t) => t.id));
    for (const id of moved.unload) expect(stillWanted.has(id)).toBe(false);
  });

  it('looks ahead along velocity and marks those tiles prefetch (not yet drawn)', () => {
    const s = new MasterStreamer();
    const plan = s.update({ x: 0, z: 0, vx: 300, vz: 0, aglM: 1000 });
    const pre = plan.tiles.filter((t) => t.prefetch);
    expect(pre.length).toBeGreaterThan(0);
    for (const t of pre) expect(t.key.level).toBe(0);
  });
});

describe('tile heights and stitching', () => {
  it('every tile has TILE_VERTS² samples and neighbouring tiles of the SAME level agree exactly on their shared edge', () => {
    const h = (x: number, z: number) => Math.sin(x / 1000) * 50 + Math.cos(z / 1300) * 30;
    const a = { level: 2, ix: 4, iz: 4 }, b = { level: 2, ix: 5, iz: 4 }; // b is a's +x neighbour... but east=-x, so b is WEST of a
    const ga = tileHeightGrid(h, a), gb = tileHeightGrid(h, b);
    expect(ga.length).toBe(TILE_VERTS * TILE_VERTS);
    for (let j = 0; j < TILE_VERTS; j++) expect(ga[j * TILE_VERTS + (TILE_VERTS - 1)]).toBeCloseTo(gb[j * TILE_VERTS], 6);
  });

  it('a stitched (coarser-neighbour) edge exactly matches the coarse neighbour’s own edge, closing the crack', () => {
    const h = (x: number, z: number) => Math.sin(x / 700) * 40 + (x + z) * 0.01;
    const fine = { level: 1, ix: 6, iz: 6 }, coarse = { level: 2, ix: 3, iz: 3 }; // fine sits inside coarse's SW quadrant, sharing coarse's south edge
    const gf = tileHeightGrid(h, fine, { n: false, s: true, e: false, w: false });
    const gc = tileHeightGrid(h, coarse);
    // fine's south row (z = tileMinZ(fine)) must equal the linear interpolation of the coarse tile's south row across the same span
    const n = TILE_VERTS;
    for (let i = 0; i < n; i += 2) {
      const worldX = tileMinX(fine) + i * (tileSizeM(fine.level) / (n - 1));
      const cu = (worldX - tileMinX(coarse)) / (tileSizeM(coarse.level) / (n - 1));
      const ci = Math.floor(cu), ct = cu - ci;
      const coarseV = ci + 1 < n ? gc[ci] * (1 - ct) + gc[ci + 1] * ct : gc[n - 1];
      expect(gf[i]).toBeCloseTo(coarseV, 3);
    }
  });

  it('tileId round-trips and distanceToTile is 0 inside, positive outside', () => {
    const t = { level: 3, ix: 5, iz: 5 };
    expect(tileId(t)).toBe('3:5:5');
    expect(distanceToTile(t, tileMinX(t) + 1, tileMinZ(t) + 1)).toBe(0);
    expect(distanceToTile(t, tileMinX(t) - 100, tileMinZ(t))).toBeCloseTo(100, 6);
  });
});

describe('floating origin', () => {
  it('rebases only past the threshold, and snaps to the tile grid so vertex buffers stay valid', () => {
    const cfg = { rebaseThresholdM: 3072, gridSnapM: 512 };
    expect(rebaseOrigin([0, 0], [1000, 0], cfg)).toEqual([0, 0]);
    const [ox, oz] = rebaseOrigin([0, 0], [4000, -500], cfg);
    expect(Math.abs(ox % 512)).toBe(0);
    expect(Math.abs(oz % 512)).toBe(0);
    expect(Math.hypot(ox - 4000, oz - (-500))).toBeLessThan(3072);
  });

  it('float32 resolution stays sub-millimetre within the rebase threshold', () => {
    expect(float32ResolutionM(3072)).toBeLessThan(0.001);
    expect(float32ResolutionM(24000)).toBeLessThan(0.01);
  });
});
