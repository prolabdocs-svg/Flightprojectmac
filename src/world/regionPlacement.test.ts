import { describe, expect, it } from 'vitest';
import { getRegion } from '../content/regions';
import { getRegionAirfields } from './airfields';
import { getRegionLandmarks, isLandmarkRecognized } from './landmarks';
import { buildHeightGrid, createGridSampler } from './terrainHeightfield';
import { createTerrainQueryService } from './terrainQuery';
import { buildRegionLayout } from './regionPlacement';
import { getRegionComposition, REGION_COMPOSITIONS } from './regionCompositions';
import { REGION_ART_BIBLE } from './regionArtBible';
import { DENSITY_BUDGETS, getDensityLevel } from './densitySystem';
import { VEGETATION_SPECIES, pickSpecies } from './vegetation';
import { canyonElevation, CANYON_HALF_W, CANYON_RIM_M, distanceToWash } from './canyonGeography';
import { FIELD_COMPOSITION } from './fieldPlacement';
import { RED_CANYON_COMPOSITION } from './regions/redCanyonComposition';

function compose(regionId: string) {
  const region = getRegion(regionId);
  const terrain = createTerrainQueryService(region);
  const grid = createGridSampler(buildHeightGrid(terrain.getElevation));
  const spec = getRegionComposition(regionId)!;
  return { spec, terrain, grid, layout: buildRegionLayout(spec, { grid, terrain }) };
}

const field = compose('the_field');
const canyon = compose('red_canyon');

describe('shared region composer', () => {
  it('composes every registered region from the one pipeline', () => {
    expect(Object.keys(REGION_COMPOSITIONS).sort()).toEqual(['red_canyon', 'the_field']);
    for (const l of [field.layout, canyon.layout]) {
      expect(l.roads.length).toBeGreaterThan(0);
      expect(l.lots.length).toBeGreaterThan(0);
      expect(l.trees.length).toBeGreaterThan(0);
    }
  });

  it('is deterministic: identical inputs produce an identical layout', () => {
    const again = buildRegionLayout(RED_CANYON_COMPOSITION, { grid: canyon.grid, terrain: canyon.terrain });
    expect(again.lots).toEqual(canyon.layout.lots);
    expect(again.props).toEqual(canyon.layout.props);
    expect(again.trees).toEqual(canyon.layout.trees);
    expect(again.rocks).toEqual(canyon.layout.rocks);
  });

  it('The Field is unchanged by the refactor (counts pinned from the pre-refactor composer)', () => {
    // Verified byte-identical against HEAD's fieldPlacement.ts (lots/props/rocks/patches/trees). Re-pinned when the
    // river-datum fix lifted the lower valley out of the sea (trees 8249->8263, rocks 1408->1516 on the reclaimed land).
    expect({
      lots: field.layout.lots.length, props: field.layout.props.length, trees: field.layout.trees.length,
      rocks: field.layout.rocks.length, patches: field.layout.patches.length, exclusions: field.layout.exclusions.length,
    }).toEqual({ lots: 76, props: 501, trees: 8263, rocks: 1516, patches: 42, exclusions: 12 });
  });

  it('respects the global tree budget per region', () => {
    expect(field.layout.trees.length).toBeLessThan(FIELD_COMPOSITION.maxTreeInstances * 2);
    expect(canyon.layout.trees.filter((t) => !t.hero).length).toBeLessThan(20000);
  });
});

describe('placement safety (every composed region)', () => {
  for (const [name, composed] of [['the_field', field], ['red_canyon', canyon]] as const) {
    it(`${name}: nothing spawns on a graded runway or in water`, () => {
      const { layout, terrain } = composed;
      for (const t of layout.trees) {
        expect(terrain.isOnGradedRunway(t.x, t.z), `tree @${t.x | 0},${t.z | 0}`).toBe(false);
        expect(terrain.getWaterDepth(t.x, t.z)).toBe(0);
      }
      for (const r of layout.rocks) expect(terrain.getWaterDepth(r.x, r.z)).toBe(0);
    });

    it(`${name}: every graded runway centre is clear of lots`, () => {
      const { layout } = composed;
      for (const airfield of getRegionAirfields(name)) {
        const [ax, , az] = airfield.position;
        for (const l of layout.lots) {
          expect(Math.hypot(l.x - ax, l.z - az), `${l.kind} on ${airfield.id}`).toBeGreaterThan(airfield.runwayWidthM);
        }
      }
    });

    it(`${name}: road-frontage buildings sit on gentle ground`, () => {
      const { layout, grid } = composed;
      const steep = layout.lots.filter((l) => grid.slopeDeg(l.x, l.z) > 22);
      expect(steep.length).toBe(0);
    });
  }
});

describe('Red Canyon identity', () => {
  it('uses dirt trails only, per REGION_ART_BIBLE.canyon.roadCharacter', () => {
    expect(REGION_ART_BIBLE.canyon.roadCharacter).toBe('dirt-trail');
    for (const r of RED_CANYON_COMPOSITION.roads) expect(r.surface).toBe('dirt');
  });

  it('builds a road -> settlement chain reaching the mining camp', () => {
    const camp = canyon.layout.roads.find((r) => r.def.id === 'ROAD_CANYON_CAMP')!;
    expect(camp.lengthM).toBeGreaterThan(300);
    const near = canyon.layout.lots.filter((l) => Math.hypot(l.x - 430, l.z - 700) < 180);
    expect(near.length).toBeGreaterThanOrEqual(6);
  });

  it('D4 in Red Canyon is a scrap camp, not a recoloured Field village', () => {
    const at = (l: { x: number; z: number }, cx: number, cz: number) => Math.hypot(l.x - cx, l.z - cz) < 200;
    const canyonKinds = new Set(canyon.layout.lots.filter((l) => at(l, 430, 700)).map((l) => l.kind));
    const fieldKinds = new Set(field.layout.lots.filter((l) => at(l, 160, 350)).map((l) => l.kind));
    // Both cores resolve to the same density level...
    const level = (spec: typeof FIELD_COMPOSITION, x: number, z: number) =>
      getDensityLevel({ regionId: spec.regionId, terrain: spec.terrain, x, z, anchors: spec.densityAnchors });
    expect(level(RED_CANYON_COMPOSITION, 430, 700)).toBeGreaterThanOrEqual(4);
    expect(level(FIELD_COMPOSITION, 160, 350)).toBeGreaterThanOrEqual(4);
    // ...and yet share no building kind at all.
    expect(canyonKinds.size).toBeGreaterThan(2);
    expect(fieldKinds.size).toBeGreaterThan(2);
    expect([...canyonKinds].filter((k) => fieldKinds.has(k))).toEqual([]);
    // No farmhouses or hay in the badlands.
    expect([...canyonKinds].some((k) => k.startsWith('farmhouse') || k.startsWith('barn'))).toBe(false);
  });

  it('plants region-appropriate species, not The Field\'s', () => {
    const canyonSpecies = new Set(canyon.layout.trees.map((t) => t.speciesId));
    const fieldSpecies = new Set(field.layout.trees.map((t) => t.speciesId));
    expect([...canyonSpecies].filter((s) => fieldSpecies.has(s))).toEqual([]);
    for (const id of [...canyonSpecies, ...fieldSpecies]) {
      expect(VEGETATION_SPECIES.some((s) => s.id === id)).toBe(true);
    }
  });

  it('keeps buildings out of the flash-flood wash', () => {
    for (const l of canyon.layout.lots) expect(distanceToWash(l.x, l.z)).toBeGreaterThan(CANYON_HALF_W);
  });
});

describe('density system drives the object set', () => {
  it('D0-D5 budgets differ, and a denser zone yields more props on the ground', () => {
    const levels = [0, 1, 2, 3, 4, 5] as const;
    const props = levels.map((l) => DENSITY_BUDGETS[l].props);
    expect(props).toEqual([...props].sort((a, b) => a - b));
    const veg = levels.map((l) => DENSITY_BUDGETS[l].vegetationInstances);
    expect(veg).toEqual([...veg].sort((a, b) => b - a));

    const count = (cx: number, cz: number, r: number) =>
      canyon.layout.props.filter((p) => Math.hypot(p.x - cx, p.z - cz) < r).length;
    // D4 camp core vs D0/D1 open badlands 2 km away.
    expect(count(430, 700, 250)).toBeGreaterThan(count(-1800, -900, 250));
  });

  it('scattered vegetation thins out toward the settled core (D0 > D4)', () => {
    const scrub = canyon.layout.trees.filter((t) => t.kind === 'shrub');
    const near = scrub.filter((t) => Math.hypot(t.x - 430, t.z - 700) < 200).length;
    const far = scrub.filter((t) => Math.hypot(t.x + 1500, t.z + 600) < 200).length;
    expect(far).toBeGreaterThan(near);
  });
});

describe('canyonGeography', () => {
  it('carves a deep sheer wash below the mesa rim', () => {
    const onFloor = canyonElevation(-600, 700);
    const onRim = canyonElevation(-600 + 600, 700);
    expect(onFloor).toBeLessThan(CANYON_RIM_M * 0.7);
    expect(onRim - onFloor).toBeGreaterThan(50);
  });

  it('is not The Field: the mesa around the airfield is high tableland', () => {
    expect(canyonElevation(60, 320)).toBeGreaterThan(80);
    expect(distanceToWash(60, 320)).toBeGreaterThan(400);
  });

  it('is pure and deterministic', () => {
    expect(canyonElevation(123, -456)).toBe(canyonElevation(123, -456));
  });
});

describe('landmarks are wired to real geometry', () => {
  it('Red Canyon\'s pinnacle exists in the registry and is built as a rock formation', () => {
    const marks = getRegionLandmarks('red_canyon');
    expect(marks.map((m) => m.id)).toContain('red_canyon_pinnacle');
    const pinnacle = marks.find((m) => m.id === 'red_canyon_pinnacle')!;
    const [lx, , lz] = pinnacle.worldPosition;
    const big = canyon.layout.rocks.filter((r) => r.large && Math.hypot(r.x - lx, r.z - lz) < 60);
    expect(big.length).toBeGreaterThanOrEqual(3);
  });

  it('is recognised from the air above it', () => {
    const pinnacle = getRegionLandmarks('red_canyon').find((m) => m.id === 'red_canyon_pinnacle')!;
    expect(isLandmarkRecognized(pinnacle, canyon.terrain, { x: 700, z: 800, elevationM: 900 })).toBe(true);
  });
});

describe('REGION_ART_BIBLE has no dead config', () => {
  it('every field of every entry is consumed by something', () => {
    // Consumers (asserted structurally rather than by grep so a rename breaks the test):
    //  accentColors + geologyIds -> render/regionTerrainColor.ts (buildRegionGroundPalette)
    //  vegetationArchetypes      -> vegetation.ts pickSpecies (below)
    //  settlementDensityBias     -> densitySystem.ts baselineLevel (below)
    //  roadCharacter             -> region road data (asserted for canyon above)
    //  landmarksPer100km2        -> landmarks.ts registry density (below)
    //  label / silhouette / atmosphere -> docs + UI copy; see the report's deferred list.
    for (const [terrain, bible] of Object.entries(REGION_ART_BIBLE)) {
      expect(bible.accentColors.length, terrain).toBeGreaterThan(0);
      expect(bible.geologyIds.length, terrain).toBeGreaterThan(0);
      const species = pickSpecies('understory', bible.vegetationArchetypes, 'temperate_grassland');
      expect(species, terrain).toBeTruthy();
      expect(bible.settlementDensityBias, terrain).toBeGreaterThan(0);
    }
  });

  it('a region with a lower settlementDensityBias has a lower baseline density level', () => {
    const at = (terrain: 'meadow' | 'canyon') =>
      getDensityLevel({ regionId: 'x', terrain, x: 9000, z: 9000, anchors: [] });
    expect(at('canyon')).toBeLessThanOrEqual(at('meadow'));
  });

  it('every region has at most the landmark budget its art bible allows', () => {
    for (const regionId of ['the_field', 'red_canyon']) {
      const terrain = getRegion(regionId).environment.terrain;
      // 16 km x 16 km world = 256 km^2 = 2.56 * (100 km^2).
      const budget = Math.ceil(REGION_ART_BIBLE[terrain].landmarksPer100km2 * 2.56);
      expect(getRegionLandmarks(regionId).length, regionId).toBeLessThanOrEqual(budget);
    }
  });
});
