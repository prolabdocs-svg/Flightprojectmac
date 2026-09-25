import * as THREE from 'three';
import type { RegionDefinition } from '../core/types';
import { createTerrainQueryService, type TerrainQueryService } from '../world/terrainQuery';
import { BIOME_COLORS } from '../world/biomeWeights';
import { createSeededRandom } from '../core/seededRandom';
import { getAmbientTrafficPose } from '../world/ambientTraffic';
import { buildWaterBodies, type WaterBody } from '../world/waterBodies';
import { buildHeightGrid, createGridSampler, FIELD_TERRAIN_SEGMENTS, FIELD_TERRAIN_SIZE_M, type TerrainGridSampler } from '../world/terrainHeightfield';
import { FIELD_RIVER_POINTS, fieldElevation, lakeShoreRadius, RIVER_WATER_HALF_M, SEA_LEVEL_M } from '../world/fieldGeography';
import { createWaterHeights, createWaterMaterial, updateWater } from './waterMaterial';
import { fieldGroundColor } from './fieldTerrainColor';
import { buildRegionGroundPalette, regionGroundColor } from './regionTerrainColor';
import { getRegionArtBible } from '../world/regionArtBible';
import { hasRegionComposition } from '../world/regionCompositions';
import { getDistantLandmarkKind, getTerrainVisualProfile, type TerrainVisualProfile } from './worldVisualIdentity';
import { applySurfaceDetail } from './surfaceDetail';

/** Water sheet following an irregular shoreline (`lakeShoreRadius`) with a 40 m apron so the
 * bed-depth fade, not the mesh edge, draws the shore. Local XY -> world XZ after the -90 deg X turn. */
function shoreOutlineGeometry(body: WaterBody): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  for (let i = 0; i <= 160; i++) {
    const a = (i / 160) * Math.PI * 2, r = Math.min(body.radiusM, lakeShoreRadius(a) + 40);
    // world (dx, dz) = (cos a, sin a) * r; mesh is rotated -90 deg about X so local y = -world dz.
    if (i === 0) shape.moveTo(Math.cos(a) * r, -Math.sin(a) * r); else shape.lineTo(Math.cos(a) * r, -Math.sin(a) * r);
  }
  return new THREE.ShapeGeometry(shape, 1);
}

/** Lake surfaces sit this far above the (flat) terrain under them so the two never z-fight at range. */
const WATER_LIFT_M = 0.3;

/** Presentation-only region kit.  Simulation reads the matching data profile through
 * sim/weather.ts, so visual density can be changed independently of flight behaviour. */
export class WorldEnvironment {
  readonly root = new THREE.Group();
  private readonly windSock: THREE.Mesh;
  private readonly rain: THREE.Points | null;
  private readonly ambientAircraft: THREE.Group[] = [];
  private readonly region: RegionDefinition;
  readonly terrainQuery: TerrainQueryService;
  /** The Field's rendered terrain heights (row-major, same grid as the Rapier heightfield). */
  private fieldHeights?: Float32Array;
  /** Exact sampler over the rendered Field mesh (decals, roads and prop bases sit on this). */
  fieldGrid?: TerrainGridSampler;

  constructor(region: RegionDefinition, options: { terrainQuery?: TerrainQueryService; skipTerrainMesh?: boolean } = {}) {
    this.region = region;
    // Phase 2C (master-world streaming): a caller that already built the region's TerrainQueryService against the master
    // authority (`createMasterRegionTerrain`) passes it in so every consumer below — biome colours, water, scatter — reads
    // the SAME elevation the streamed tiles draw, instead of this class quietly building its own equivalent-but-separate
    // instance. `skipTerrainMesh` drops this class's own static ground plane when `MasterRenderStreamer` is drawing the
    // real terrain instead (single-terrain-authority: never both at once — see masterWorldAdapter.ts).
    this.terrainQuery = options.terrainQuery ?? createTerrainQueryService(region);
    this.root.name = `environment:${region.id}`;
    if (!options.skipTerrainMesh) this.addTerrain();
    this.addWaterSurfaces(!!options.skipTerrainMesh);
    this.windSock = this.addWindSock();
    this.rain = region.environment.weather === 'rain' ? this.addRain() : null;
    // The Field's landmarks, scatter and rocks come from the authored composition (FieldWorld).
    if (!this.fieldGrid) {
      this.addDistantLandmark();
      // Streamed master terrain reaches the real horizon; painted unlit cones would sit on top of it.
      if (!options.skipTerrainMesh) this.addRidgeline();
      this.addGroundScatter();
    }
    this.addAmbientTraffic();
  }

  private addTerrain() {
    // The Field is a single 16 km heightfield (authored geography, see fieldGeography.ts);
    // other regions keep the 6 km plane.
    const isField = this.region.environment.terrain === 'meadow';
    // Every region with an authored composition (regionCompositions.ts) gets the big
    // 16 km heightfield + grid sampler, because roads/patches/props drape on that sampler.
    const composed = hasRegionComposition(this.region.id);
    const size = composed ? FIELD_TERRAIN_SIZE_M : 6000;
    // 192x192 remains a single mobile-friendly draw call (one static plane, built once),
    // while giving the elevation/biome interpolation and near-player relief noticeably
    // finer triangles than the previous 160x160 grid.
    const segments = composed ? FIELD_TERRAIN_SEGMENTS : 192;
    const geo = new THREE.PlaneGeometry(size, size, segments, segments);
    const pos = geo.attributes.position;
    // Elevation now comes from the shared TerrainQueryService (src/world/terrainQuery.ts) so
    // the visual mesh and the physics ground collider (see FlightScreen.tsx) can never drift
    // apart. This plane is authored in local (x, y) space and rotated -90deg about X below,
    // which maps local x -> world x and local y -> world -z (see terrainQuery.ts for detail).
    for (let i = 0; i < pos.count; i++) {
      const localX = pos.getX(i);
      const localY = pos.getY(i);
      const height = this.terrainQuery.getElevation(localX, -localY);
      pos.setZ(i, height);
    }
    if (composed) {
      this.fieldHeights = new Float32Array(pos.count);
      for (let i = 0; i < pos.count; i++) this.fieldHeights[i] = pos.getZ(i);
      this.fieldGrid = createGridSampler(this.fieldHeights);
    }
    geo.computeVertexNormals();
    // Vertex colour blends real biome weights from TerrainQueryService (spec §250, DoD
    // "region readable from altitude") instead of an ad hoc pattern, plus a light regional tint.
    const colors = new Float32Array(pos.count * 3);
    const base = new THREE.Color(this.region.groundColor);
    const biomeColorCache = new Map<string, THREE.Color>();
    const getBiomeColor = (biomeId: string): THREE.Color => {
      let c = biomeColorCache.get(biomeId);
      if (!c) {
        c = new THREE.Color(BIOME_COLORS[biomeId] ?? this.region.groundColor);
        biomeColorCache.set(biomeId, c);
      }
      return c;
    };
    const color = new THREE.Color();
    const palette = buildRegionGroundPalette(getRegionArtBible(this.region.environment.terrain), base.clone());
    // Reference height for "low ground" shading: the graded elevation at the region's first
    // airfield is a reliable stand-in for the flown datum.
    const lowRefM = this.terrainQuery.getElevation(0, 0);
    const n = segments + 1;
    const cell = size / segments;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = -pos.getY(i);
      if (composed && !isField) {
        const ix = i % n, iy = Math.floor(i / n);
        const h = (dx: number, dy: number) => pos.getZ(Math.min(n - 1, Math.max(0, iy + dy)) * n + Math.min(n - 1, Math.max(0, ix + dx)));
        const slopeDeg = (Math.atan(Math.hypot(h(1, 0) - h(-1, 0), h(0, 1) - h(0, -1)) / (2 * cell)) * 180) / Math.PI;
        const weights = this.terrainQuery.getBiomeWeights(x, z);
        color.setRGB(0, 0, 0);
        for (const biomeId in weights) {
          const w = weights[biomeId];
          if (w <= 0) continue;
          const bc = getBiomeColor(biomeId);
          color.r += bc.r * w; color.g += bc.g * w; color.b += bc.b * w;
        }
        color.lerp(base, 0.12);
        regionGroundColor(palette, pos.getZ(i), slopeDeg, lowRefM, color);
        colors.set([color.r, color.g, color.b], i * 3);
        continue;
      }
      if (isField) {
        // Geography-driven colour (see fieldTerrainColor.ts); slope from the mesh's own
        // neighbouring vertices so it matches what the player sees at 62 m cells.
        const ix = i % n, iy = Math.floor(i / n);
        const h = (dx: number, dy: number) => pos.getZ(Math.min(n - 1, Math.max(0, iy + dy)) * n + Math.min(n - 1, Math.max(0, ix + dx)));
        const slopeDeg = (Math.atan(Math.hypot(h(1, 0) - h(-1, 0), h(0, 1) - h(0, -1)) / (2 * cell)) * 180) / Math.PI;
        fieldGroundColor(x, z, pos.getZ(i), slopeDeg, color);
        colors.set([color.r, color.g, color.b], i * 3);
        continue;
      }
      const weights = this.terrainQuery.getBiomeWeights(x, z);
      color.setRGB(0, 0, 0);
      for (const biomeId in weights) {
        const w = weights[biomeId];
        if (w <= 0) continue;
        const bc = getBiomeColor(biomeId);
        color.r += bc.r * w;
        color.g += bc.g * w;
        color.b += bc.b * w;
      }
      color.lerp(base, 0.12);
      colors.set([color.r, color.g, color.b], i * 3);
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    // Keep the world deliberately graphic. The previous photographic grass albedo fought
    // the low-poly aircraft/props and multiplied with vertex colours into muddy patches.
    // Smooth normals plus denser geometry preserve the shared physical relief without
    // exposing the terrain as a coarse faceted grid.
    const profile = getTerrainVisualProfile(this.region);
    // The Field's colour is geographic (vertex colours); the repeating parcel/blotch texture
    // would read as noise across mountains and valleys, so it stays off on the 16 km terrain
    // (every composed region, not just The Field: on Red Canyon it tiled as dark blotches).
    let detailTexture: THREE.CanvasTexture | null = null;
    if (!composed) {
      detailTexture = this.buildGroundDetailTexture(profile, createSeededRandom('world-environment-ground-detail', this.region.id));
      detailTexture.repeat.set(size / profile.parcelScaleM, size / profile.parcelScaleM);
    }
    // World-space multi-scale detail + slope strata (surfaceDetail.ts) on top of the geographic
    // vertex colour: macro breakup from altitude, clumps at 50 m, grain and relief at 5 m.
    const terrainMat = applySurfaceDetail(new THREE.MeshStandardMaterial({
      color: '#ffffff',
      map: detailTexture,
      vertexColors: true,
      roughness: 0.96,
      metalness: 0,
      flatShading: false,
    }), { rock: true });
    const terrain = new THREE.Mesh(geo, terrainMat);
    terrain.rotation.x = -Math.PI / 2;
    terrain.receiveShadow = true;
    this.root.add(terrain);

    // Low-cost water/earth horizon shell gives distant terrain a clear silhouette on mobile.
    // The Field's real terrain reaches its own horizon, and a flat shell would float over its lowlands.
    if (isField) return;
    const horizon = new THREE.Mesh(new THREE.RingGeometry(1050, 2900, 64), new THREE.MeshBasicMaterial({ color: this.region.environment.terrain === 'quarry' ? '#786d60' : '#708f58', side: THREE.DoubleSide, transparent: true, opacity: 0.55 }));
    horizon.rotation.x = -Math.PI / 2;
    horizon.position.y = -0.08;
    this.root.add(horizon);
  }

  /** Deterministic procedural ground-detail texture (CanvasTexture, no photography, no
   * flat/uniform color from any altitude). Multiplied against the per-vertex biome color
   * so it adds macro mottling + fine speckle everywhere, and — for farmland-like terrains
   * (TerrainVisualProfile.parcels) — soft-edged cultivated parcels with discrete furrow
   * lines, tiled across the terrain by `parcelScaleM` (spec: readable field boundaries,
   * not a repeating photographic decal or a flat plate of color). */
  private buildGroundDetailTexture(profile: TerrainVisualProfile, rng: ReturnType<typeof createSeededRandom>): THREE.CanvasTexture {
    const size = 512;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, size, size);

    // Macro mottling: broad soft blotches in both the accent and detail tones, at low
    // opacity so they tint rather than overpower the underlying biome vertex color.
    for (let i = 0; i < 26; i++) {
      const color = rng.next() > 0.5 ? profile.groundAccent : profile.groundDetail;
      ctx.fillStyle = color;
      ctx.globalAlpha = 0.05 + rng.next() * 0.08;
      const r = 40 + rng.next() * 120;
      ctx.beginPath();
      ctx.ellipse(rng.next() * size, rng.next() * size, r, r * (0.6 + rng.next() * 0.5), rng.next() * Math.PI, 0, Math.PI * 2);
      ctx.fill();
    }

    if (profile.parcels) {
      // Irregular parcel grid: a handful of jittered cells (not a perfect grid) with a
      // discrete boundary line and internal furrows running a consistent direction per
      // cell, so tended land reads as tended from 150-500m instead of a flat green plate.
      const cells = 4;
      const cellSize = size / cells;
      for (let cx = 0; cx < cells; cx++) {
        for (let cy = 0; cy < cells; cy++) {
          const jitterX = (rng.next() - 0.5) * cellSize * 0.18;
          const jitterY = (rng.next() - 0.5) * cellSize * 0.18;
          const x0 = cx * cellSize + jitterX, y0 = cy * cellSize + jitterY;
          const w = cellSize * (0.86 + rng.next() * 0.12), h = cellSize * (0.86 + rng.next() * 0.12);
          ctx.globalAlpha = 0.16;
          ctx.strokeStyle = profile.groundDetail;
          ctx.lineWidth = 2;
          ctx.strokeRect(x0, y0, w, h);

          ctx.globalAlpha = 0.1;
          ctx.strokeStyle = profile.groundAccent;
          ctx.lineWidth = 1;
          const vertical = (cx + cy) % 2 === 0;
          const furrowCount = 5 + Math.floor(rng.next() * 4);
          for (let f = 1; f < furrowCount; f++) {
            ctx.beginPath();
            if (vertical) {
              const fx = x0 + (w * f) / furrowCount;
              ctx.moveTo(fx, y0);
              ctx.lineTo(fx, y0 + h);
            } else {
              const fy = y0 + (h * f) / furrowCount;
              ctx.moveTo(x0, fy);
              ctx.lineTo(x0 + w, fy);
            }
            ctx.stroke();
          }
        }
      }
    }

    // Fine micro speckle keeps close-range ground from reading as a smooth plastic
    // surface even inside a single parcel/blotch.
    ctx.globalAlpha = 1;
    for (let i = 0; i < 900; i++) {
      ctx.fillStyle = rng.next() > 0.5 ? profile.groundDetail : '#ffffff';
      ctx.globalAlpha = 0.04 + rng.next() * 0.05;
      const r = 0.6 + rng.next() * 1.6;
      ctx.beginPath();
      ctx.arc(rng.next() * size, rng.next() * size, r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    const texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
  }

  /** Water surfaces for the region's authored water (lakes; The Field's river and sea). All share one
   * material family (waterMaterial.ts: sky Fresnel, ripples, depth gradient, shore foam), and the depth
   * comes from the natural BED grid — the terrain mesh itself is flat at the surface over standing water.
   * Skipped when the master world draws the terrain: master relief carries its own water. */
  private addWaterSurfaces(masterWorld: boolean) {
    if (masterWorld) return;
    const isField = this.region.environment.terrain === 'meadow';
    const bed = isField ? createWaterHeights(buildHeightGrid(fieldElevation), FIELD_TERRAIN_SEGMENTS + 1, FIELD_TERRAIN_SIZE_M) : undefined;
    const lakeMaterial = createWaterMaterial(this.region.environment.terrain === 'coast'
      ? { shallow: '#4fb3bf', deep: '#1c6f8c' } : { shallow: '#5e9c8f', deep: '#23566a' }, bed);
    for (const body of buildWaterBodies(this.region.id, (x, z) => this.terrainQuery.getElevation(x, z))) {
      const water = new THREE.Mesh(body.shoreFromBed ? shoreOutlineGeometry(body) : new THREE.CircleGeometry(body.radiusM * 1.04, 64), lakeMaterial);
      water.name = `water:${body.id}`;
      water.rotation.x = -Math.PI / 2;
      water.position.set(body.center[0], body.surfaceElevationM + WATER_LIFT_M, body.center[1]);
      this.root.add(water);
    }
    if (isField) {
      // No bed grid for the river: its 40 m ribbon is narrower than a 62 m cell, so the grid can't resolve its depth.
      this.addFieldRiver(createWaterMaterial({ shallow: '#5c9c92', deep: '#2f6f82', rippleM: 0.6 }));
      this.addFieldSea(createWaterMaterial({ shallow: '#58b0b4', deep: '#1d5f80', rippleM: 1.6 }, bed));
    }
  }

  /** Height of the rendered (triangulated) terrain mesh at x/z, so water sits on what the
   * player sees rather than on the analytic surface between 62 m grid nodes. */
  private meshHeight(x: number, z: number): number {
    const g = this.fieldHeights!, n = FIELD_TERRAIN_SEGMENTS + 1, cell = FIELD_TERRAIN_SIZE_M / FIELD_TERRAIN_SEGMENTS;
    const fx = Math.min(n - 1.001, Math.max(0, (x + FIELD_TERRAIN_SIZE_M / 2) / cell));
    // Row iy sits at local y = S/2 - iy*cell and world z = -localY, so iy = (z + S/2)/cell.
    const fy = Math.min(n - 1.001, Math.max(0, (FIELD_TERRAIN_SIZE_M / 2 + z) / cell));
    const ix = Math.floor(fx), iy = Math.floor(fy), u = fx - ix, v = fy - iy;
    const at = (a: number, b: number) => g[b * n + a];
    return at(ix, iy) * (1 - u) * (1 - v) + at(ix + 1, iy) * u * (1 - v) + at(ix, iy + 1) * (1 - u) * v + at(ix + 1, iy + 1) * u * v;
  }

  /** One ribbon mesh along the carved river valley (FIELD_RIVER_POINTS), 28-42 m wide. Each
   * cross-section is flat at the highest of its three terrain samples + a little, so the
   * water sits inside the channel and the banks rise through it. Skipped inside the lake. */
  private addFieldRiver(material: THREE.Material) {
    const pts: Array<[number, number]> = [];
    const STEP_M = 45;
    for (let i = 0; i < FIELD_RIVER_POINTS.length - 1; i++) {
      const [ax, az] = FIELD_RIVER_POINTS[i], [bx, bz] = FIELD_RIVER_POINTS[i + 1];
      const k = Math.max(1, Math.round(Math.hypot(bx - ax, bz - az) / STEP_M));
      for (let j = 0; j < k; j++) pts.push([ax + ((bx - ax) * j) / k, az + ((bz - az) * j) / k]);
    }
    const last = FIELD_RIVER_POINTS[FIELD_RIVER_POINTS.length - 1];
    pts.push([last[0], last[1]]);
    const level = pts.map(([x, z], i) => {
      const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1, nx = -(b[1] - a[1]) / len, nz = (b[0] - a[0]) / len;
      const hw = RIVER_WATER_HALF_M - 3 + 6 * (0.5 + 0.5 * Math.sin(i * 0.37));
      return Math.max(this.meshHeight(x, z), this.meshHeight(x + nx * hw, z + nz * hw), this.meshHeight(x - nx * hw, z - nz * hw)) + 0.3;
    });
    // Smooth along the flow so the surface has no sawtooth from the coarse mesh.
    for (let pass = 0; pass < 4; pass++) for (let i = 1; i < level.length - 1; i++) level[i] = Math.max(level[i], (level[i - 1] + level[i] * 2 + level[i + 1]) / 4);
    const positions: number[] = [];
    const index: number[] = [];
    pts.forEach(([x, z], i) => {
      const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1, nx = -(b[1] - a[1]) / len, nz = (b[0] - a[0]) / len;
      const hw = RIVER_WATER_HALF_M - 3 + 6 * (0.5 + 0.5 * Math.sin(i * 0.37));
      positions.push(x + nx * hw, level[i], z + nz * hw, x - nx * hw, level[i], z - nz * hw);
      // Lake/sea flatten the query above the bed; the river itself does not, so this skips only standing water.
      const standing = (px: number, pz: number) => this.terrainQuery.getElevation(px, pz) > fieldElevation(px, pz) + 0.01;
      if (i > 0 && !standing(x, z) && !standing(pts[i - 1][0], pts[i - 1][1])) {
        const p = (i - 1) * 2, q = i * 2;
        index.push(p, q, p + 1, p + 1, q, q + 1);
      }
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setIndex(index);
    geo.computeVertexNormals();
    const river = new THREE.Mesh(geo, material);
    river.name = 'water:field-river';
    this.root.add(river);
  }

  /** The map edge sinks below sea level; this plane is the sea out to (and beyond) the fogged
   * horizon, so the world ends as a coast instead of a cut or a square. */
  private addFieldSea(material: THREE.Material) {
    const sea = new THREE.Mesh(new THREE.PlaneGeometry(60000, 60000, 1, 1), material);
    sea.name = 'water:field-sea';
    sea.rotation.x = -Math.PI / 2;
    // Lifted like the lakes: the terrain mesh is flat AT sea level over the sea (collidable surface).
    sea.position.y = SEA_LEVEL_M + WATER_LIFT_M;
    this.root.add(sea);
  }

  /** A single tall, high-contrast structure placed far from the runway so it stays
   * visible from great distance/altitude and acts as a "visual compass" while flying —
   * the same role GTA San Andreas' Vinewood sign or the Gant bridge play: a landmark
   * you can orient toward without needing a map. Cheap (a handful of primitives), so it
   * doesn't compete with the InstancedMesh prop budget used elsewhere in this file. */
  private addDistantLandmark() {
    const landmarkKind = getDistantLandmarkKind(this.region);
    const x = landmarkKind === 'headframe' ? -620 : 560;
    const z = landmarkKind === 'headframe' ? 980 : 1120;
    const groundY = this.terrainQuery.getElevation(x, z);
    const group = new THREE.Group();
    group.position.set(x, groundY, z);

    if (landmarkKind === 'lighthouse') {
      // A navigation lighthouse makes the coastal route identifiable from the first
      // climb, rather than reusing the inland grain silos in every non-quarry biome.
      // Its warm lantern is intentionally emissive (not a point light), keeping the
      // same mobile lighting budget while retaining a clear long-range focal point.
      const towerMat = new THREE.MeshStandardMaterial({ color: '#eee5cf', roughness: 0.78, metalness: 0.04 });
      const bandMat = new THREE.MeshStandardMaterial({ color: '#b94b31', roughness: 0.64, metalness: 0.08 });
      const tower = new THREE.Mesh(new THREE.CylinderGeometry(9, 14, 100, 14), towerMat);
      tower.position.y = 50;
      group.add(tower);
      for (const y of [30, 70]) {
        const band = new THREE.Mesh(new THREE.CylinderGeometry(9.3, 10.8, 9, 14), bandMat);
        band.position.y = y;
        group.add(band);
      }
      const lantern = new THREE.Mesh(
        new THREE.CylinderGeometry(7, 7, 12, 12),
        new THREE.MeshStandardMaterial({ color: '#ffd77b', emissive: '#7f4a12', emissiveIntensity: 1.1, roughness: 0.35 }),
      );
      lantern.position.y = 105;
      group.add(lantern);
      const roof = new THREE.Mesh(new THREE.ConeGeometry(10, 14, 12), new THREE.MeshStandardMaterial({ color: '#314e57', roughness: 0.55, metalness: 0.28 }));
      roof.position.y = 118;
      group.add(roof);
    } else if (landmarkKind === 'headframe') {
      // Derelict headframe/watchtower: tall lattice tower topped by a rust-red beacon
      // platform, readable in silhouette from kilometres away over the quarry haze.
      const legMat = new THREE.MeshStandardMaterial({ color: '#3f3a33', roughness: 0.85, metalness: 0.4 });
      const legGeo = new THREE.CylinderGeometry(1.1, 1.6, 150, 6);
      for (const [lx, lz] of [[-14, -14], [14, -14], [-14, 14], [14, 14]] as const) {
        const leg = new THREE.Mesh(legGeo, legMat);
        leg.position.set(lx * 0.5, 75, lz * 0.5);
        leg.rotation.x = (lz / 14) * 0.05;
        leg.rotation.z = -(lx / 14) * 0.05;
        group.add(leg);
      }
      const platform = new THREE.Mesh(new THREE.BoxGeometry(24, 4, 24), new THREE.MeshStandardMaterial({ color: '#8a2f22', roughness: 0.7, metalness: 0.3 }));
      platform.position.set(0, 150, 0);
      group.add(platform);
    } else if (landmarkKind === 'stacks') {
      // Stacks give the industrial basin a distinct, legible skyline even through its
      // heavier haze. They use static emissive tips instead of extra point lights.
      const stackMat = new THREE.MeshStandardMaterial({ color: '#5d5b55', roughness: 0.86, metalness: 0.28 });
      const tipMat = new THREE.MeshStandardMaterial({ color: '#d55732', emissive: '#5f170d', emissiveIntensity: 0.7, roughness: 0.55 });
      for (const [ox, height] of [[-18, 120], [12, 164], [36, 94]] as const) {
        const stack = new THREE.Mesh(new THREE.CylinderGeometry(7, 10, height, 12), stackMat);
        stack.position.set(ox, height / 2, 0);
        group.add(stack);
        const tip = new THREE.Mesh(new THREE.CylinderGeometry(7.35, 7.35, 7, 12), tipMat);
        tip.position.set(ox, height - 3.5, 0);
        group.add(tip);
      }
    } else if (landmarkKind === 'radio-mast') {
      // A radio mast is a thin, high-contrast desert navigation aid; it stays readable
      // against the pale ground without pretending the sparse route is a farm district.
      const mastMat = new THREE.MeshStandardMaterial({ color: '#7c3d28', roughness: 0.68, metalness: 0.38 });
      const mast = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 3.2, 160, 6), mastMat);
      mast.position.y = 80;
      group.add(mast);
      for (const y of [45, 92, 139]) {
        const brace = new THREE.Mesh(new THREE.BoxGeometry(48, 0.7, 0.7), mastMat);
        brace.position.y = y;
        brace.rotation.z = 0.18;
        group.add(brace);
      }
      const beacon = new THREE.Mesh(new THREE.SphereGeometry(3.3, 10, 8), new THREE.MeshStandardMaterial({ color: '#f06a37', emissive: '#78200e', emissiveIntensity: 0.9 }));
      beacon.position.y = 162;
      group.add(beacon);
    } else if (landmarkKind === 'rock-gateway') {
      // A red-rock gateway echoes the canyon route's geology and provides a broad
      // silhouette that can be recognized before the player reaches the canyon walls.
      const rockMat = new THREE.MeshStandardMaterial({ color: '#9b4930', roughness: 0.98, flatShading: true });
      for (const xOffset of [-34, 34]) {
        const pillar = new THREE.Mesh(new THREE.CylinderGeometry(13, 18, 105, 7), rockMat);
        pillar.position.set(xOffset, 52, 0);
        group.add(pillar);
      }
      const lintel = new THREE.Mesh(new THREE.BoxGeometry(86, 20, 25), rockMat);
      lintel.position.y = 101;
      lintel.rotation.z = -0.04;
      group.add(lintel);
    } else if (landmarkKind === 'lookout') {
      // Lookout towers belong to both dense forest and alpine range routes, but their
      // dark timber and orange roof differentiate them from the agricultural silos.
      const timber = new THREE.MeshStandardMaterial({ color: '#483d2f', roughness: 0.92 });
      for (const [ox, oz] of [[-10, -10], [10, -10], [-10, 10], [10, 10]] as const) {
        const leg = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 2.1, 112, 6), timber);
        leg.position.set(ox, 56, oz);
        group.add(leg);
      }
      const cabin = new THREE.Mesh(new THREE.BoxGeometry(34, 18, 30), new THREE.MeshStandardMaterial({ color: '#c36a3d', roughness: 0.75 }));
      cabin.position.y = 118;
      group.add(cabin);
      const roof = new THREE.Mesh(new THREE.ConeGeometry(29, 22, 4), timber);
      roof.position.y = 138;
      roof.rotation.y = Math.PI / 4;
      group.add(roof);
    } else {
      // Grain-silo cluster + weathervane spire standing well above the tree line,
      // marking the far edge of the field from any altitude.
      const siloMat = new THREE.MeshStandardMaterial({ color: '#d8d2bd', roughness: 0.75, metalness: 0.15 });
      for (const [ox, r, h] of [[0, 9, 95], [21, 7, 78]] as const) {
        const silo = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, 14), siloMat);
        silo.position.set(ox, h / 2, 0);
        group.add(silo);
        const cap = new THREE.Mesh(new THREE.ConeGeometry(r * 1.02, r * 0.9, 14), siloMat);
        cap.position.set(ox, h + r * 0.45, 0);
        group.add(cap);
      }
      const spire = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 30, 6), new THREE.MeshStandardMaterial({ color: '#b7451f', roughness: 0.5, metalness: 0.6 }));
      spire.position.set(0, 95 + 15, 0);
      group.add(spire);
    }
    this.root.add(group);
  }

  /** Low-cost mountain/hill silhouette ring on the far horizon (well outside the
   * playable/flyable radius). Purely a backdrop — it gives distant altitude changes a
   * sense of scale ("how high am I really") the way San Andreas' background mountains
   * do, without adding any collidable geometry or per-frame cost. One InstancedMesh. */
  private addRidgeline() {
    // The Field has real mountains; painted cones on top of them would be the tabletop look.
    if (this.region.environment.terrain === 'meadow') return;
    const rng = createSeededRandom('world-environment-ridgeline', this.region.id);
    const profile = getTerrainVisualProfile(this.region);
    const jaggedness = profile.horizonJaggedness;
    // A continuous low-frequency noise (sum of a few irrational-ratio sine waves, not
    // just per-vertex random jitter) perturbs both the radius and the height. Earlier
    // versions joined two radial rings into a giant vertical ribbon; at runway level it
    // could cut straight across the sky. These are now overlapping low-poly mountain
    // masses seated on the actual terrain, retaining a continuous far silhouette without
    // any suspended band geometry.
    const silhouette = (angle: number, seed: number): number =>
      Math.sin(angle * 2.7 + seed) * 0.5 + Math.sin(angle * 5.3 + seed * 1.7) * 0.3 + Math.sin(angle * 11.1 + seed * 2.9) * 0.2;

    // Three depth layers give the horizon recession. Their footprints overlap around
    // each ring, so they read as ranges rather than a row of isolated traffic cones.
    const layers = [
      { radius: 1250, color: profile.horizonColors[0], height: 115, seed: 1.3 },
      { radius: 1850, color: profile.horizonColors[1], height: 190, seed: 4.1 },
      { radius: 2500, color: profile.horizonColors[2], height: 275, seed: 7.9 },
    ] as const;

    for (const layer of layers) {
      const count = 28;
      const mountains = new THREE.InstancedMesh(
        new THREE.ConeGeometry(1, 1, jaggedness > 0.7 ? 7 : 10),
        new THREE.MeshBasicMaterial({ color: layer.color, fog: true }),
        count,
      );
      const matrix = new THREE.Matrix4();
      for (let i = 0; i < count; i++) {
        const angle = (i / count) * Math.PI * 2;
        const noise = silhouette(angle, layer.seed);
        const radiusJitter = 1 + noise * 0.14 * jaggedness;
        const distance = layer.radius * radiusJitter;
        const x = Math.cos(angle) * distance;
        const z = Math.sin(angle) * distance;
        const height = layer.height * (0.6 + (noise * 0.5 + 0.5) * (0.42 + jaggedness * 0.35));
        const footprint = (layer.radius * Math.PI * 2 / count) * (0.7 + jaggedness * 0.18);
        matrix.compose(new THREE.Vector3(x, this.terrainQuery.getElevation(x, z) + height / 2, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, rng.next() * Math.PI, 0)), new THREE.Vector3(footprint, height, footprint));
        mountains.setMatrixAt(i, matrix);
      }
      mountains.instanceMatrix.needsUpdate = true;
      this.root.add(mountains);
    }
  }

  /** Secondary ground clutter (rocks/scrub) distinct from FlightScene's tree/scrap-pile
   * InstancedMeshes: sparser, taller-variance scale, and — unlike those — sampled against
   * TerrainQueryService so props sit flush with the undulating terrain instead of
   * floating/clipping on the now-hilly ground (see terrainQuery.ts). Single InstancedMesh,
   * matching the efficient-instancing pattern used throughout this file/FlightScene. */
  private addGroundScatter() {
    const rng = createSeededRandom('world-environment-scatter', this.region.id);
    const terrainKind = this.region.environment.terrain;
    const isQuarry = terrainKind === 'quarry';
    // A forest already owns a dedicated cluster canopy pass in FlightScene. Keeping
    // this generic icosahedral rock pass dense there made the distant woods read as
    // scattered black balls rather than a woodland, so reserve it for a few rocks.
    const count = terrainKind === 'forest' ? 14 : 60;
    const geo = isQuarry ? new THREE.DodecahedronGeometry(1, 0) : new THREE.IcosahedronGeometry(1, 0);
    const mat = new THREE.MeshStandardMaterial({ color: isQuarry ? '#756a5c' : terrainKind === 'forest' ? '#60734c' : '#4d6b3d', roughness: 1, metalness: isQuarry ? 0.15 : 0 });
    const mesh = new THREE.InstancedMesh(geo, mat, count);
    const m = new THREE.Matrix4();
    // World spec section 227 QA: no prop/tree may land on a graded runway. Placement below
    // retries with a fresh angle/distance sample rather than skipping the instance outright,
    // so excluding the pad doesn't thin out scatter density near airfields.
    const placeOffRunway = (pick: () => { x: number; z: number }): { x: number; z: number } => {
      for (let attempt = 0; attempt < 8; attempt++) {
        const p = pick();
        if (!this.terrainQuery.isOnGradedRunway(p.x, p.z)) return p;
      }
      return pick();
    };

    for (let i = 0; i < count; i++) {
      const { x, z } = placeOffRunway(() => {
        const angle = rng.next() * Math.PI * 2;
        const dist = 120 + rng.next() * 820;
        return { x: Math.cos(angle) * dist, z: 150 + Math.sin(angle) * dist };
      });
      const scale = 0.8 + rng.next() * 2.6;
      const y = this.terrainQuery.getElevation(x, z);
      m.compose(new THREE.Vector3(x, y + scale * 0.4, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rng.next(), rng.next() * Math.PI * 2, rng.next())), new THREE.Vector3(scale, scale * (0.6 + rng.next() * 0.5), scale));
      mesh.setMatrixAt(i, m);
    }
    mesh.instanceMatrix.needsUpdate = true;
    this.root.add(mesh);

    // Sparse tufts make the field feel tended/inhabited rather than a green plane.
    if (!isQuarry) {
      const grass = new THREE.InstancedMesh(new THREE.ConeGeometry(.32, 1.4, 4), new THREE.MeshStandardMaterial({ color: '#6b8d3d', roughness: 1 }), 150);
      const blade = new THREE.Matrix4();
      for (let i = 0; i < 150; i++) {
        const { x, z } = placeOffRunway(() => {
          const angle = rng.next() * Math.PI * 2, dist = 20 + rng.next() * 650;
          return { x: Math.cos(angle) * dist, z: 110 + Math.sin(angle) * dist };
        });
        const scale = .35 + rng.next() * .8;
        blade.compose(new THREE.Vector3(x, this.terrainQuery.getElevation(x, z) + scale * .62, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, rng.next() * Math.PI, (rng.next() - .5) * .2)), new THREE.Vector3(scale, scale, scale));
        grass.setMatrixAt(i, blade);
      }
      grass.instanceMatrix.needsUpdate = true;
      this.root.add(grass);
    }
  }

  /** Distant civilian traffic provides movement and scale in free flight. These are
   * intentionally non-colliding background actors — the player can read the world as
   * lived-in without being punished by an invisible simulation obstacle. */
  private addAmbientTraffic() {
    const count = this.region.environment.weather === 'windy' ? 2 : 3;
    const fuselageMat = new THREE.MeshStandardMaterial({ color: '#e8e3d4', roughness: .55, metalness: .3 });
    const wingMat = new THREE.MeshStandardMaterial({ color: '#c55735', roughness: .7, metalness: .15 });
    for (let i = 0; i < count; i++) {
      const aircraft = new THREE.Group();
      const fuselage = new THREE.Mesh(new THREE.CapsuleGeometry(.75, 5.4, 4, 8), fuselageMat);
      fuselage.rotation.x = Math.PI / 2;
      aircraft.add(fuselage);
      const wing = new THREE.Mesh(new THREE.BoxGeometry(7.5, .16, 1.1), wingMat);
      aircraft.add(wing);
      const tail = new THREE.Mesh(new THREE.BoxGeometry(2.4, .1, .6), wingMat);
      tail.position.set(0, .55, -2.7);
      aircraft.add(tail);
      aircraft.scale.setScalar(.8 + i * .1);
      this.ambientAircraft.push(aircraft);
      this.root.add(aircraft);
    }
  }

  private addWindSock() {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 6, 6), new THREE.MeshStandardMaterial({ color: '#e8e2d0', roughness: 0.7 }));
    pole.position.set(-12, 3, 55);
    this.root.add(pole);
    const sock = new THREE.Mesh(new THREE.ConeGeometry(0.5, 3.2, 10, 1, true), new THREE.MeshBasicMaterial({ color: '#f28d35', side: THREE.DoubleSide }));
    sock.rotation.z = -Math.PI / 2;
    sock.position.set(-10.45, 5.7, 55);
    this.root.add(sock);
    return sock;
  }

  private addRain() {
    const positions = new Float32Array(420 * 3);
    for (let i = 0; i < positions.length; i += 3) {
      positions[i] = ((i * 37) % 220) - 110;
      positions[i + 1] = ((i * 19) % 75) + 8;
      positions[i + 2] = ((i * 53) % 180) - 80;
    }
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const rain = new THREE.Points(geo, new THREE.PointsMaterial({ color: '#b9d9ee', size: 0.7, transparent: true, opacity: 0.55 }));
    this.root.add(rain); return rain;
  }

  update(elapsedS: number, wind: THREE.Vector3) {
    this.windSock.rotation.y = Math.atan2(wind.x, wind.z);
    this.windSock.rotation.z = -Math.PI / 2 + Math.min(0.48, wind.length() * 0.045);
    updateWater(elapsedS);
    for (let i = 0; i < this.ambientAircraft.length; i++) {
      const pose = getAmbientTrafficPose(this.region.id, i, elapsedS);
      this.ambientAircraft[i].position.set(pose.x, pose.y, pose.z);
      this.ambientAircraft[i].rotation.y = pose.headingRad;
      this.ambientAircraft[i].rotation.z = Math.sin(elapsedS * .5 + i) * .05;
    }
    if (this.rain) {
      const p = this.rain.geometry.attributes.position;
      for (let i = 1; i < p.count * 3; i += 3) { const y = p.array[i] - 0.9; p.array[i] = y < 0 ? 80 : y; }
      p.needsUpdate = true;
    }
  }
}
