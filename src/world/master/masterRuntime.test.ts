import { beforeAll, describe, expect, it } from 'vitest';
import { AIRFIELDS } from '../airfields';
import { MISSIONS } from '../../content/missions';
import { REGIONS, getRegion } from '../../content/regions';
import { fieldElevation } from '../fieldGeography';
import { createTerrainQueryService } from '../terrainQuery';
import { CAMPAIGN_SITES, STARTER_BASIN, geoToWorld } from './masterGeography';
import { MasterTerrain, bicubicWorld, createMasterRegionTerrain } from './masterRuntime';

let W: MasterTerrain;
beforeAll(() => { W = new MasterTerrain(); }, 120_000);

describe('Phase 2 — runtime authority: terrain', () => {
  it('reproduces The Field verbatim through the master (raw relief == fieldElevation) across the preserved core, dry land', () => {
    const f = W.frame('the_field');
    let worst = 0, n = 0;
    const R = STARTER_BASIN.coreRadiusM - 40;
    for (let z = -R; z <= R; z += 211) for (let x = -R; x <= R; x += 211) {
      const [wx, wz] = W.localToWorld('the_field', x, z);
      if (W.waterAt(wx, wz)) continue; // lake surface is intentionally the collidable surface (legacy contract), checked separately
      worst = Math.max(worst, Math.abs(W.groundAt(wx, wz) - f.datumM - fieldElevation(x, z)));
      n++;
    }
    expect(n).toBeGreaterThan(300);
    expect(worst).toBeLessThan(1e-6);
  });

  it('createMasterRegionTerrain(the_field) matches the legacy TerrainQueryService (elevation, slope, graded pads) in the core', () => {
    const legacy = createTerrainQueryService(getRegion('the_field')), master = createMasterRegionTerrain(getRegion('the_field'), W);
    let worstE = 0, worstS = 0, padMismatch = 0, n = 0;
    for (let z = -3900; z <= 3900; z += 173) for (let x = -3900; x <= 3900; x += 173) {
      const [wx, wz] = W.localToWorld('the_field', x, z);
      // Water differs by design: the Field's own sea/estuary sits 230 m up (dry) in the master, and rivers aren't collidable.
      if (W.waterAt(wx, wz) || legacy.getWaterDepth(x, z) > 0) continue;
      worstE = Math.max(worstE, Math.abs(master.getElevation(x, z) - legacy.getElevation(x, z)));
      worstS = Math.max(worstS, Math.abs(master.getSlopeDeg(x, z) - legacy.getSlopeDeg(x, z)));
      if (master.isOnGradedRunway(x, z) !== legacy.isOnGradedRunway(x, z)) padMismatch++;
      n++;
    }
    expect(n).toBeGreaterThan(400);
    expect(worstE).toBeLessThan(1e-6);
    expect(worstS).toBeLessThan(1e-3);
    expect(padMismatch).toBe(0);
  });

  it('the Field lake is a lake at its legacy level (218 m) and its collidable ground is the water surface', () => {
    const [lx, lz] = W.localToWorld('the_field', 2500, 1900);
    const w = W.waterAt(lx, lz);
    expect(w?.kind).toBe('lake');
    expect(Math.abs((w?.surfaceM ?? 0) - (STARTER_BASIN.elevationOffsetM - 12))).toBeLessThan(4);
    expect(W.groundAt(lx, lz)).toBeCloseTo(w!.surfaceM, 6);
    expect(W.elevationAt(lx, lz)).toBeLessThan(w!.surfaceM - 10); // the bed is well below
  });

  it('bicubic resampling interpolates the master grid exactly at cell centres and is continuous', () => {
    for (const [e, n] of [[-3, 5], [4.2, -9.1], [-9.4, 14.9], [20, -1]] as const) {
      const i = Math.round((e * 1000 + 24000) / 48 - 0.5), j = Math.round((n * 1000 + 24000) / 48 - 0.5);
      const ce = (-24000 + (i + 0.5) * 48) / 1000, cn = (-24000 + (j + 0.5) * 48) / 1000;
      const [wx, wz] = geoToWorld(ce, cn);
      expect(bicubicWorld(W.map.heightM, wx, wz)).toBeCloseTo(W.map.heightM[j * 1000 + i], 3);
    }
    let maxJump = 0;
    for (let x = 0; x < 3000; x += 1.7) maxJump = Math.max(maxJump, Math.abs(W.elevationAt(-5000 - x, 8000) - W.elevationAt(-5000 - x - 1.7, 8000)));
    expect(maxJump).toBeLessThan(6); // mountain slopes only: no steps
  });

  it('classifies water and surfaces from the master (sea, beach, salt flat, alpine rock)', () => {
    expect(W.waterAt(...geoToWorld(0, -20))?.kind).toBe('sea');
    expect(W.groundAt(...geoToWorld(0, -20))).toBe(0);
    expect(W.surfaceAt(...geoToWorld(-9.4, 14.9))).toBe('rock');
    const desert = W.frame('high_desert_test_range');
    expect(W.surfaceAt(desert.originWorld[0], desert.originWorld[1] + 400)).toBe('salt');
    const gran = W.sampleGeo(...geoToWorld(-9.4, 14.9));
    expect(gran.region).toBe('R03_northern_mountains');
  });
});

describe('Phase 2 — reconciliation: 8 campaign regions, 13+ airfields, 17 missions', () => {
  it('every campaign region has exactly one frame, and every non-Field frame is a flat graded platform at its datum', () => {
    expect(REGIONS.map((r) => r.id).sort()).toEqual(['backcountry', 'coast_run', 'high_desert_test_range', 'industrial_belt', 'red_canyon', 'scrap_valley', 'the_field', 'the_range']);
    for (const r of REGIONS) expect(W.hasFrame(r.id), r.id).toBe(true);
    for (const S of CAMPAIGN_SITES) {
      const f = W.frame(S.campaignRegionId);
      expect(f.macro).toBe(S.macro);
      for (const [x, z] of [[0, 0], [S.footprintLocalM.x[0], S.footprintLocalM.z[0]], [S.footprintLocalM.x[1], S.footprintLocalM.z[1]], [S.footprintLocalM.x[0], S.footprintLocalM.z[1]]] as const) {
        const [wx, wz] = W.localToWorld(S.campaignRegionId, x, z);
        expect(Math.abs(W.groundAt(wx, wz) - f.datumM), `${S.campaignRegionId} local ${x},${z}`).toBeLessThan(0.01);
        expect(W.waterAt(wx, wz), `${S.campaignRegionId} dry`).toBeNull();
      }
      const [wx, wz] = W.localToWorld(S.campaignRegionId, 0, 0);
      expect(W.regionAt(wx, wz), S.campaignRegionId).toBe(S.macro);
      const [lx, lz] = W.worldToLocal(S.campaignRegionId, wx, wz);
      expect([lx, lz]).toEqual([0, 0]);
    }
  });

  it('every airfield in the registry belongs to a campaign region that has a frame (fails loudly if one is added for an unmapped region)', () => {
    const mapped = new Set(W.airfields().map((a) => a.id));
    for (const a of AIRFIELDS) expect(mapped.has(a.id), `airfield ${a.id} (${a.regionId}) has no master placement`).toBe(true);
    expect(W.airfields().length).toBe(AIRFIELDS.length);
  });

  it('every airfield is on dry land, in its macro region, and (non-Field) on the flat graded platform along its whole runway', () => {
    for (const a of W.airfields()) {
      expect(W.waterAt(...a.worldPosition), a.id).toBeNull();
      expect(W.regionAt(...a.worldPosition), a.id).toBe(a.macro);
      if (a.campaignRegionId === 'the_field') { expect(W.slopeDegAt(...a.worldPosition), a.id).toBeLessThan(8); continue; }
      const f = W.frame(a.campaignRegionId);
      for (const t of [-0.5, 0, 0.5]) {
        const z = a.worldPosition[1] + t * a.runwayLengthM;
        expect(Math.abs(W.groundAt(a.worldPosition[0], z) - f.datumM), `${a.id} runway t=${t}`).toBeLessThan(0.01);
      }
    }
  });

  it('every mission is playable in the master: spawn and target on dry gentle land, airfield links resolve inside the mission region', () => {
    expect(MISSIONS.length).toBe(17);
    for (const m of MISSIONS) {
      const [sx, sz] = W.localToWorld(m.regionId, m.spawnPoint[0], m.spawnPoint[2]);
      expect(W.waterAt(sx, sz), `${m.id} spawn`).toBeNull();
      expect(W.slopeDegAt(sx, sz), `${m.id} spawn slope`).toBeLessThan(5);
      if (m.targetPoint) {
        const [tx, tz] = W.localToWorld(m.regionId, m.targetPoint[0], m.targetPoint[2]);
        expect(W.waterAt(tx, tz), `${m.id} target`).toBeNull();
        expect(W.slopeDegAt(tx, tz), `${m.id} target slope`).toBeLessThan(m.regionId === 'the_field' ? 10 : 5);
      }
      for (const id of [m.originAirfieldId, m.destinationAirfieldId]) if (id) expect(W.airfield(id)?.campaignRegionId, `${m.id} -> ${id}`).toBe(m.regionId);
      // distance-run missions: the required distance must be flyable along +Z (local north) without leaving land or a graded site's neighbourhood
      if (m.family === 'distanceRun' && m.minDistanceM) {
        const [ex, ez] = W.localToWorld(m.regionId, m.spawnPoint[0], m.spawnPoint[2] + m.minDistanceM);
        expect(W.regionAt(ex, ez), `${m.id} end of the run stays on land`).not.toBeNull();
      }
    }
  });

  it('sites are ≥ 3 km apart, and none sits inside the Starter Basin fusion zone', () => {
    const fr = CAMPAIGN_SITES.map((s) => W.frame(s.campaignRegionId).originWorld);
    for (let i = 0; i < fr.length; i++) for (let j = i + 1; j < fr.length; j++) expect(Math.hypot(fr[i][0] - fr[j][0], fr[i][1] - fr[j][1])).toBeGreaterThan(3000);
    for (const S of CAMPAIGN_SITES) {
      const [x, z] = W.frame(S.campaignRegionId).originWorld;
      expect(Math.max(Math.abs(x - STARTER_BASIN.worldOffsetM[0]), Math.abs(z - STARTER_BASIN.worldOffsetM[1])), S.campaignRegionId).toBeGreaterThan(STARTER_BASIN.fadeEndM + 500);
    }
  });

  it('keeps the atmosphere base at 0 for every region until missions are rebalanced for real altitude (documented debt), and reports each site altitude', () => {
    for (const S of CAMPAIGN_SITES) expect(W.frame(S.campaignRegionId).pressureAltitudeBaseM).toBe(0);
    const highest = Math.max(...CAMPAIGN_SITES.map((s) => W.frame(s.campaignRegionId).datumM));
    expect(highest).toBeGreaterThan(2000); // the_range platform: recorded so the rebalance is not forgotten
  });
});

describe('Phase 2 — navigation', () => {
  it('nearest airfield, landmarks and route profiles come from the master', () => {
    const home = W.airfield('field_home')!;
    expect(W.nearestAirfield(...home.worldPosition)?.airfield.id).toBe('field_home');
    expect(W.nearestAirfield(...geoToWorld(20, 0))?.airfield.macro).toBeDefined();
    const lm = W.landmarks();
    expect(lm.find((l) => l.id === 'gran_pico')!.elevationM).toBeGreaterThan(2700);
    expect(lm.some((l) => l.kind === 'dam')).toBe(true);
    const prof = W.terrainProfile(home.worldPosition, lm.find((l) => l.id === 'gran_pico')!.worldPosition, 80);
    expect(prof.maxM).toBeGreaterThan(2500);
    expect(prof.groundM.length).toBe(80);
  });
});
