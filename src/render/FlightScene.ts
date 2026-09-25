// Vanilla Three.js scene for the flight view. React only owns UI/menus (spec 31.1);
// the 3D scene graph is managed imperatively here for performance on mobile GPUs.

import * as THREE from 'three';
import type { RegionDefinition } from '../core/types';
import { WorldEnvironment } from './WorldEnvironment';
import { Atmosphere } from './atmosphere';
import { CloudLayer } from './clouds';
import { updateWater } from './waterMaterial';
import { PostProcessing } from './postProcessing';
import { createSeededRandom, type SeededRandom } from '../core/seededRandom';
import { assetLibrary } from './assetLibrary';
import { ACTIVE_REGION_ASSETS, AIRFRAME_VISUALS, UNPAINTED_MATERIAL, FRAME_ASSET_IDS, type WorldAssetPlacement } from './assetManifest';
import { getSettlementPlacements } from '../world/settlementLayout';
import { ChaseCamera, type ChaseCameraInput } from './ChaseCamera';
import { InstrumentPod } from './InstrumentPod';
import type { EngineLimits } from './cockpit/instrumentModel';
import type { FlightTelemetry } from '../flight/flightTypes';
import { getFreeFlightAirfield, getRegionAirfields, type AirfieldDefinition, type RunwaySurface } from '../world/airfields';
import { buildTerrainFollowingMesh, getRunwaySafeZone, layoutRoadTiles } from './fieldAirfieldLayout';
import { getRegionRoadNetwork } from './regionRoadNetworks';
import { buildRegionLayout } from '../world/regionPlacement';
import { getRegionComposition } from '../world/regionCompositions';
import { box, cyl, FieldWorld, mergeParts } from './fieldWorld';
import { AmbientNpcs } from './ambientNpcs';
import { clearCorridor, RAIL_LINES } from '../world/ambientTraffic';
import { buildRoadPath } from '../world/fieldRoads';
import { buildWaterBodies } from '../world/waterBodies';
import { buildTreeClusterInstancedMesh, type TreeClusterPlacement } from './vegetation';
import { orientWorldProp } from './blenderAxisFix';
import { A0_PLACEMENT, AircraftRig, type GearPose } from './aircraftRig';
import { applyLowPolyStyle } from './lowPolyStyle';
import { PilotAvatar, PILOT_HEAD_LAYER, seatAvatar, seatEye, type PilotDrive, type Seat } from './pilotAvatar';
import { DEFAULT_APPEARANCE, type AvatarAppearance } from '../avatar/appearance';
import type { SurfaceDeflections } from '../flight/core/aircraftPhysics';
import type { TerrainQueryService } from '../world/terrainQuery';

export class FlightScene {
  scene = new THREE.Scene();
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  aircraftGroup = new THREE.Group();
  private readonly streamedProps = new THREE.Group();
  /** A ground ring alone disappears against terrain at flight altitude. The marker adds
   * sparse vertical beacons while retaining the precise ring used for landing. */
  private targetMarker: THREE.Group | null = null;
  private targetPulseMaterials: THREE.MeshBasicMaterial[] = [];
  private readonly chase = new ChaseCamera();
  private readonly instruments = new InstrumentPod();
  private fpv = false;
  private readonly environment: WorldEnvironment;
  private readonly atmosphere: Atmosphere;
  private readonly clouds: CloudLayer;
  private lastEnvS = 0;
  private readonly post: PostProcessing | null;
  private styleSweepFrame = 0;

  // Damage-system hooks (src/sim/damageSystem.ts via FlightController): named refs to the
  // placeholder meshes that stand in for "wing" and "tail" so a detach/damage event can
  // hide or re-tint them without the damage system knowing anything about Three.js.
  private wingMesh: THREE.Mesh | null = null;
  private tailMeshes: THREE.Mesh[] = [];
  private readonly damageMarks = new Map<string, THREE.Group>();
  private readonly bursts: { points: THREE.Points; vel: Float32Array; ageS: number }[] = [];
  private readonly debris: Array<{ mesh: THREE.Object3D; velocity: THREE.Vector3; spin: THREE.Vector3; ageS: number }> = [];
  private propellerMeshes: THREE.Mesh[] = [];
  /** Hinged control surfaces + propeller of the A0 hero asset; null for other airframes. */
  private rigs: AircraftRig[] = [];
  private pilot: PilotAvatar | null = null;
  private pilotSeat: Seat | null = null;
  private pilotAppearance: AvatarAppearance = DEFAULT_APPEARANCE;
  private loadedAircraft: { object: THREE.Object3D; id: string } | null = null;
  // Deterministic PRNG for procedural landmark placement (trees, scrap piles), seeded
  // from the region id so the same region always generates the same layout across
  // sessions (see src/core/seededRandom.ts).
  private readonly worldRng: SeededRandom;
  /** The composed Field (roads, parcels, settlements, masses); undefined for other regions. */
  private fieldWorld?: FieldWorld;
  private ambientNpcs?: AmbientNpcs;

  constructor(
    canvas: HTMLCanvasElement,
    region: RegionDefinition,
    paint?: { fabricColor: string; tubeColor: string },
    frameId: string = 'frame_zero',
    /** Phase 2C: when the caller (FlightScreen) is driving this region from the master-world streamer, it supplies the
     * master-backed TerrainQueryService and asks WorldEnvironment to skip its own static ground plane, so
     * MasterRenderStreamer's tiles are the only terrain drawn (single terrain authority — see masterWorldAdapter.ts). */
    worldEnvOptions?: {
      terrainQuery?: TerrainQueryService;
      skipTerrainMesh?: boolean;
      remoteDestination?: { airfield: AirfieldDefinition; position: readonly [number, number, number] };
      worldOffsetXZ?: readonly [number, number];
    },
  ) {
    this.worldRng = createSeededRandom('flight-scene-landmarks', region.id);
    const lowPowerMobile = window.matchMedia('(pointer: coarse)').matches && navigator.hardwareConcurrency <= 4;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, lowPowerMobile ? 1.25 : 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.08;
    this.renderer.shadowMap.enabled = true;
    // PCFSoftShadowMap was removed in the Three.js version used by this project;
    // PCFShadowMap is the supported mobile-friendly equivalent here.
    this.renderer.shadowMap.type = THREE.PCFShadowMap;

    this.camera = this.chase.camera;
    this.camera.layers.enable(PILOT_HEAD_LAYER);
    // Free-look: drag on the 3D view to turn the camera; it eases back on release.
    canvas.style.touchAction = 'none';
    canvas.addEventListener('pointerdown', (e) => { this.chase.dragging = true; canvas.setPointerCapture(e.pointerId); });
    canvas.addEventListener('pointermove', (e) => { if (this.chase.dragging) this.chase.drag(e.movementX, e.movementY); });
    const endDrag = () => { this.chase.dragging = false; };
    canvas.addEventListener('pointerup', endDrag);
    canvas.addEventListener('pointercancel', endDrag);

    // Sky, sun, height fog, IBL and cloud shadows: one atmosphere (atmosphere.ts / clouds.ts).
    const wide = getRegionComposition(region.id) !== undefined;
    // Near plane 0.5 m: the 24-bit depth buffer resolves ground decals (roads/parcels) at range.
    this.camera.far = wide ? 30000 : 16000; this.camera.near = 0.5; this.camera.updateProjectionMatrix();
    this.atmosphere = new Atmosphere(this.scene, this.renderer, region, { lowPower: lowPowerMobile });
    this.atmosphere.sun.shadow.camera.layers.enable(PILOT_HEAD_LAYER); // pilot head keeps its shadow in the cockpit view
    this.post = lowPowerMobile ? null : new PostProcessing(this.renderer, this.scene, this.camera);
    this.environment = new WorldEnvironment(region, worldEnvOptions);
    this.scene.add(this.environment.root);
    const areaOffset = worldEnvOptions?.worldOffsetXZ;
    if (areaOffset) {
      this.environment.root.position.x += areaOffset[0]; this.environment.root.position.z += areaOffset[1];
    }
    this.clouds = new CloudLayer(this.atmosphere.look, { baseY: this.environment.terrainQuery.getElevation(0, 0) + 1050, seed: region.id });
    this.scene.add(this.clouds.mesh);
    const fieldGrid = this.environment.fieldGrid;
    if (fieldGrid) {
      const composition = getRegionComposition(region.id)!;
      const terrainQuery = this.environment.terrainQuery;
      let layout = buildRegionLayout(composition, { grid: fieldGrid, terrain: terrainQuery });
      const railDef = RAIL_LINES[region.id];
      const rail = railDef ? buildRoadPath(railDef, fieldGrid, composition.anchors) : undefined;
      if (rail) layout = clearCorridor(layout, rail, 12);
      this.fieldWorld = new FieldWorld(fieldGrid, layout, { seed: composition.seed, terrain: composition.terrain });
      this.scene.add(this.fieldWorld.root);
      if (areaOffset) { this.fieldWorld.root.position.x += areaOffset[0]; this.fieldWorld.root.position.z += areaOffset[1]; }
      void this.fieldWorld.hydrate();
      // Presentation-only ground life: road traffic, the train, boats, birds.
      this.ambientNpcs = new AmbientNpcs(fieldGrid, layout.roads, {
        seed: composition.seed,
        rail,
        lakes: buildWaterBodies(region.id, (x, z) => terrainQuery.getElevation(x, z)),
      });
      this.scene.add(this.ambientNpcs.root);
      if (areaOffset) { this.ambientNpcs.root.position.x += areaOffset[0]; this.ambientNpcs.root.position.z += areaOffset[1]; }
    }

    // The visual runway must occupy the same graded airport pad as physics and spawn
    // logic. The previous fixed y=0 strip was buried by the terrain in the first
    // playable region, leaving players to begin on an apparently random field.
    // Every airfield in the region gets a visible strip: destination fields already had a
    // graded pad in physics but rendered as an empty clearing.
    const airfield = getFreeFlightAirfield(region.id);
    const regionAirfields = getRegionAirfields(region.id);
    if (regionAirfields.length === 0) this.buildRunway(undefined);
    for (const field of regionAirfields) this.buildRunway(areaOffset ? { ...field, position: [field.position[0] + areaOffset[0], field.position[1], field.position[2] + areaOffset[1]] } : field);
    if (worldEnvOptions?.remoteDestination) {
      const { airfield: destination, position } = worldEnvOptions.remoteDestination;
      this.buildRunway({ ...destination, position: [...position] as [number, number, number] });
    }

    // Landmarks: region-specific, so the world isn't a flat void (spec 12.2/12.3).
    if (region.environment.terrain === 'quarry') {
      this.buildScrapValleyLandmarks();
    } else if (region.environment.terrain === 'meadow') {
      this.buildTheFieldLandmarks(airfield);
    } else if (!this.fieldWorld) {
      this.buildTerrainLandmarks(region.environment.terrain);
    }
    // Continuous road network connecting the airfield to the region's hero landmark
    // and a branch/second connection (regionRoadNetworks.ts), one system shared by
    // all 8 regions instead of per-region bespoke road code.
    if (!this.fieldWorld) this.buildRegionRoadNetwork(region.id);

    // Keep a first-frame proxy while the GLB streams, then replace it with the
    // authored airframe already shipped with the game.
    this.buildAircraftPlaceholder(paint);
    this.aircraftGroup.visible = false;
    this.scene.add(this.aircraftGroup);
    this.scene.add(this.streamedProps);
    // Loading is deliberately non-blocking. The authored proxy is visible on the first
    // frame; GLB swaps in only when it has arrived, which is essential on mobile/PWA.
    void this.hydrateRuntimeAssets(region, paint, frameId);
  }

  private async hydrateRuntimeAssets(region: RegionDefinition, paint: { fabricColor: string; tubeColor: string } | undefined, frameId: string) {
    const assetId = FRAME_ASSET_IDS[frameId];
    if (!assetId) {
      // A declared frame id with no manifest entry is a content bug, not a runtime
      // fallback path: surface it instead of silently rendering the wrong airframe.
      console.error(`FlightScene: no FRAME_ASSET_IDS entry for frame id "${frameId}", falling back to frame_zero`);
    }
    void this.hydrateAircraft(assetId ?? FRAME_ASSET_IDS.frame_zero, paint);

    const placements: WorldAssetPlacement[] = [...(ACTIVE_REGION_ASSETS[region.id] ?? []), ...getSettlementPlacements(region.id)];
    if (placements.length === 0) return;
    await Promise.all(placements.map(async ({ id, uri, position: [x, z], scale = 1, rotationY = 0 }) => {
      try {
        let wrapper: THREE.Group;
        if (uri) {
          wrapper = new THREE.Group();
          wrapper.rotation.y = rotationY;
          wrapper.add(await assetLibrary.loadUri(uri));
        } else {
          wrapper = orientWorldProp(await assetLibrary.load('world', id), rotationY);
        }
        wrapper.position.set(x, this.environment.terrainQuery.getElevation(x, z), z);
        wrapper.scale.setScalar(scale);
        this.streamedProps.add(wrapper);
      } catch {
        // Existing procedural landmarks are the graceful fallback for every prop.
      }
    }));
  }

  /** Replaces the loading proxy with the authored, mobile-ready starter airframe. */
  private async hydrateAircraft(id: string, paint?: { fabricColor: string; tubeColor: string }) {
    try {
      const loaded = await assetLibrary.load('airframe', id);
      let aircraft: THREE.Object3D = loaded;
      // Blender's exporter converts the source file's Z-up convention to glTF Y-up.
      // The RANS generator starts in game +Z-forward axes and maps those axes once
      // before export, so the scene root stays identity just like the existing roster.
      aircraft.rotation.x = 0;
      const visual = AIRFRAME_VISUALS[id];
      const rigs: AircraftRig[] = [];
      if (visual?.lods) {
        const lod = new THREE.LOD();
        lod.addLevel(loaded, 0);
        for (const [uri, distance] of visual.lods) lod.addLevel(await assetLibrary.loadUri(uri), distance);
        aircraft = lod;
      }
      // The A0 ships its own finished livery and hinged surfaces; every other airframe keeps the
      // name-based paint tint. A missing A0 pivot throws here, before the proxy is replaced.
      const isA0 = id === FRAME_ASSET_IDS.frame_zero;
      aircraft.scale.setScalar(visual ? 1 : isA0 ? A0_PLACEMENT.scale : 6);
      // Seat the A0's drawn tyres on the physics contact points (body datum is the CG, not the ground).
      if (isA0) aircraft.position.copy(A0_PLACEMENT.offset);
      if (isA0) rigs.push(AircraftRig.attach(aircraft));
      else if (visual?.rig) for (const level of aircraft instanceof THREE.LOD ? aircraft.levels.map((l) => l.object) : [aircraft]) rigs.push(AircraftRig.attach(level, visual.rig));
      if (visual?.eye) this.chase.eye.set(...visual.eye);
      aircraft.traverse((object) => {
        const mesh = object as THREE.Mesh;
        if (mesh.isMesh) {
          mesh.castShadow = mesh.name !== 'propeller_disc'; // the translucent blur disc must not cast a solid shadow
          // The A0's thin tubes and skins are finer than the 14 cm sun-shadow texels: self-shadowing only
          // produces acne on them, so it casts onto the ground but does not receive.
          mesh.receiveShadow = !isA0;
          const color = isA0 ? undefined : mesh.name.includes('wing') || mesh.name.includes('aileron') || mesh.name.includes('stabilizer') || mesh.name === 'elevator' || mesh.name === 'rudder'
            ? paint?.fabricColor : mesh.name.includes('longeron') || mesh.name.includes('strut') || mesh.name.includes('brace') || mesh.name.includes('cross')
              ? paint?.tubeColor : undefined;
          if (color) {
            for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
              const standard = material as THREE.MeshStandardMaterial;
              if (standard.color && !UNPAINTED_MATERIAL.test(standard.name)) standard.color.set(color);
            }
          }
        }
      });
      this.aircraftGroup.clear();
      this.damageMarks.clear();
      this.wingMesh = null;
      this.tailMeshes = [];
      this.propellerMeshes = [];
      this.rigs = rigs;
      aircraft.traverse((object) => {
        const mesh = object as THREE.Mesh;
        if (!mesh.isMesh || isA0) return;
        if (mesh.name === 'main_wing' || mesh.name === 'wing_panel_L') this.wingMesh = mesh;
        if (mesh.name === 'horizontal_tail' || mesh.name === 'vertical_tail' || mesh.name === 'horizontal_stabilizer' || mesh.name === 'vertical_stabilizer') this.tailMeshes.push(mesh);
        if (mesh.name.includes('propeller') || mesh.name.includes('prop_blade')) this.propellerMeshes.push(mesh);
      });
      this.aircraftGroup.add(aircraft);
      this.loadedAircraft = { object: aircraft, id };
      this.seatPilot();
      this.aircraftGroup.visible = true;
      this.setFpv(this.fpv);
    } catch (err) {
      // The proxy remains a resilient offline fallback for a failed asset request,
      // but the failure itself must stay visible for diagnosis rather than vanish.
      console.error(`FlightScene: failed to load airframe asset "${id}"`, err);
      this.rigs = [];
      this.aircraftGroup.visible = true;
    }
  }

  /** Lightweight kits for the six later campaign regions. Human infrastructure (workshops,
   * bridges, ports, mills, beacons) is authored GLB streamed from ACTIVE_REGION_ASSETS
   * (assetManifest.ts) — this only builds the procedural macroform (mesas, mountains,
   * skyline) that has no GLB counterpart, plus cheap instanced vegetation for scale. */
  private buildTerrainLandmarks(terrain: RegionDefinition['environment']['terrain']) {
    const ground = (x: number, z: number) => this.environment.terrainQuery.getElevation(x, z);
    const rockMat = new THREE.MeshStandardMaterial({ color: '#96593d', roughness: .95 });
    const concreteMat = new THREE.MeshStandardMaterial({ color: '#69706d', roughness: .8, metalness: .15 });

    if (terrain === 'canyon') {
      // Red Canyon: a ring of eroded mesas as the navigation macroform; the beacon
      // (checkpoint_beacon) is the streamed GLB infrastructure anchor.
      const mesas = new THREE.InstancedMesh(new THREE.CylinderGeometry(1, 1.25, 1, 7), rockMat, 18);
      const matrix = new THREE.Matrix4();
      // Keep the playable Mesa Roja strip clear. The original ring began at 140m and
      // could put a 100m column directly beside the aircraft on spawn; that reads as a
      // broken collider/asset, not a canyon. These are now distant valley walls that
      // frame the route instead of swallowing its first camera shot.
      for (let i = 0; i < 14; i++) {
        const angle = i * 2.399, dist = 430 + (i % 5) * 125;
        const x = Math.cos(angle) * dist, z = 420 + Math.sin(angle) * dist;
        const h = 50 + (i % 4) * 20, radius = 24 + (i % 3) * 10;
        matrix.compose(new THREE.Vector3(x, ground(x, z) + h / 2, z), new THREE.Quaternion(), new THREE.Vector3(radius, h, radius));
        mesas.setMatrixAt(i, matrix);
      }
      mesas.instanceMatrix.needsUpdate = true;
      this.scene.add(mesas);
      return;
    }

    if (terrain === 'forest' || terrain === 'range') {
      // Backcountry/The Range: conifer stand as vegetation/scale (conifer_tree,
      // riparian_tree and reservoir_dam GLBs anchor the lake/dam infrastructure).
      // Trunk+canopy clusters (vegetation.ts) instead of bare cone proxies.
      const count = terrain === 'forest' ? 115 : 64;
      const placements: TreeClusterPlacement[] = [];
      for (let i = 0; i < count; i++) {
        const angle = i * 2.399, dist = 170 + (i % 12) * 55;
        // A forest begins beyond the cleared strip, not in the propeller arc. The
        // placement stays deterministic but retries until it is outside the shared
        // graded-runway footprint used by simulation and rendering.
        const { x, z } = this.placeOffRunway(() => ({ x: Math.cos(angle) * dist, z: 220 + Math.sin(angle) * dist }));
        placements.push({ x, z, groundY: ground(x, z), scale: (.75 + (i % 5) * .14) * (terrain === 'range' ? 1.3 : 1), rotationY: this.worldRng.next() * Math.PI * 2 });
      }
      const trees = buildTreeClusterInstancedMesh(placements, this.worldRng, terrain === 'range' ? '#2e4a30' : '#33562f');
      this.scene.add(trees);
      if (terrain === 'range') {
        // Cumbre: the region's navigation macroform, distinct from the mesas/cliffs of
        // the other regions.
        const peak = new THREE.Mesh(new THREE.ConeGeometry(120, 310, 7), new THREE.MeshStandardMaterial({ color: '#70766d', roughness: 1 }));
        peak.position.set(-340, ground(-340, 720) + 155, 720);
        this.scene.add(peak);
      }
      return;
    }

    if (terrain === 'coast') {
      // Coast Run: the cliff macroform and port infrastructure are streamed GLBs
      // (coastal_cliff_landmark, coastal_port); palms remain the only procedural piece,
      // giving the shoreline scale/vegetation cheaply via instancing. A trunk without a
      // crown reads as a broken black pole from the runway, so both layers are instanced.
      // Palm silhouette = leaning trunk + radiating drooping fronds (a flattened blob read as a mushroom from the ground).
      const palms = new THREE.InstancedMesh(new THREE.CylinderGeometry(.2, .38, 1, 6).translate(0, .5, 0), new THREE.MeshStandardMaterial({ color: '#6f5335', roughness: 1 }), 22);
      const crowns = new THREE.InstancedMesh(palmCrownGeometry(), new THREE.MeshStandardMaterial({ color: '#3f6b3a', roughness: .95, side: THREE.DoubleSide }), 22);
      const matrix = new THREE.Matrix4(), rng = this.worldRng, top = new THREE.Vector3();
      for (let i = 0; i < 22; i++) {
        // Loose beach-line groves (seeded jitter), not a surveyed grid.
        const x = -90 + i * 16 + rng.range(-6, 6), z = 180 + (i % 4) * 95 + rng.range(-25, 25), h = rng.range(8, 14);
        const lean = new THREE.Quaternion().setFromEuler(new THREE.Euler(rng.range(-.18, .18), 0, rng.range(-.18, .18)));
        matrix.compose(new THREE.Vector3(x, ground(x, z), z), lean, new THREE.Vector3(1, h, 1));
        palms.setMatrixAt(i, matrix);
        top.set(0, h, 0).applyQuaternion(lean).add(new THREE.Vector3(x, ground(x, z), z));
        const s = rng.range(3.6, 4.8);
        matrix.compose(top, new THREE.Quaternion().setFromEuler(new THREE.Euler(0, rng.next() * Math.PI * 2, 0)), new THREE.Vector3(s, s, s));
        crowns.setMatrixAt(i, matrix);
      }
      palms.instanceMatrix.needsUpdate = true;
      crowns.instanceMatrix.needsUpdate = true;
      this.scene.add(palms);
      this.scene.add(crowns);
      return;
    }

    if (terrain === 'industrial') {
      // Industrial Belt: bridges/workshop are streamed GLB anchors; the skyline macroform
      // is a cluster of instanced smokestacks (cylinders, not box warehouses).
      const stacks = new THREE.InstancedMesh(new THREE.CylinderGeometry(4, 5, 1, 10), new THREE.MeshStandardMaterial({ color: '#7f5341', roughness: .85 }), 6);
      const matrix = new THREE.Matrix4();
      for (let i = 0; i < 6; i++) {
        const x = -80 + i * 42, z = 300 + (i % 2) * 60, h = 60 + (i % 3) * 30;
        matrix.compose(new THREE.Vector3(x, ground(x, z) + h / 2, z), new THREE.Quaternion(), new THREE.Vector3(1, h, 1));
        stacks.setMatrixAt(i, matrix);
      }
      stacks.instanceMatrix.needsUpdate = true;
      this.scene.add(stacks);
      return;
    }

    if (terrain === 'desert') {
      // High Desert: workshop/mill/scrub are streamed GLB anchors; the radio-mast
      // macroform (matches worldVisualIdentity's 'radio-mast' landmark) is the only
      // procedural piece left, so the region keeps a tall navigation silhouette.
      const tower = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 3.6, 125, 8), concreteMat);
      tower.position.set(130, ground(130, 440) + 62.5, 440);
      this.scene.add(tower);
    }
  }

  /** Region 1 landmarks (spec 12.2): barn, water tower, scattered trees.
   * Materials given intentional roughness/metalness so they don't read as flat
   * default-gray primitives — weathered wood barn, galvanized-steel tower. */
  private buildTheFieldLandmarks(airfield: AirfieldDefinition | undefined) {
    // Farm workshop: a readable construction kit (walls, roof, door, apron) rather
    // than the old monolithic red cube. It is intentionally warm enough to anchor the
    // field, but broken into believable materials and silhouette layers.
    const barnGround = this.environment.terrainQuery.getElevation(-40, 20);
    const barn = new THREE.Group(); barn.position.set(-40, barnGround, 20);
    const plankMat = new THREE.MeshStandardMaterial({ color: '#964735', roughness: .93 });
    const roofMat = new THREE.MeshStandardMaterial({ color: '#384344', roughness: .78, metalness: .18 });
    const trimMat = new THREE.MeshStandardMaterial({ color: '#e1d5b2', roughness: .85 });
    const wall = new THREE.Mesh(new THREE.BoxGeometry(13, 7, 16), plankMat); wall.position.y = 3.5; wall.castShadow = true; wall.receiveShadow = true; barn.add(wall);
    for (const x of [-3.4, 3.4]) {
      // Inner edges up: a pitched roof (the old signs made an inverted butterfly roof).
      const roof = new THREE.Mesh(new THREE.BoxGeometry(7.4, .36, 17.1), roofMat); roof.position.set(x, 8.1, 0); roof.rotation.z = x < 0 ? .36 : -.36; roof.castShadow = true; barn.add(roof);
    }
    const gableGeo = new THREE.ExtrudeGeometry(new THREE.Shape([new THREE.Vector2(-6.5, 7), new THREE.Vector2(6.5, 7), new THREE.Vector2(0, 9.35)]), { depth: 16, bevelEnabled: false });
    gableGeo.translate(0, 0, -8);
    const gables = new THREE.Mesh(gableGeo, plankMat); gables.castShadow = true; barn.add(gables);
    const door = new THREE.Mesh(new THREE.PlaneGeometry(4.4, 4.6), new THREE.MeshStandardMaterial({ color: '#263130', roughness: .9 })); door.position.set(0, 2.55, 8.04); barn.add(door);
    for (const x of [-5.7, 5.7]) { const trim = new THREE.Mesh(new THREE.BoxGeometry(.28, 7, .3), trimMat); trim.position.set(x, 3.5, 8.14); barn.add(trim); }
    const signBoard = new THREE.Mesh(new THREE.BoxGeometry(4.2, .7, .08), trimMat); signBoard.position.set(0, 5.6, 8.08); barn.add(signBoard);
    barn.add(this.buildWorkshopDressing());
    this.scene.add(barn);

    // Workshop apron: terrain-sampled grid (not a flat plane in the barn's own local
    // frame) so it follows the ground under the barn instead of floating/clipping.
    const barnApronX = -40, barnApronZ = 20 + 11;
    const barnApronData = buildTerrainFollowingMesh(23, 19, 5, barnApronX, barnApronZ, (x, z) => this.environment.terrainQuery.getElevation(x, z), 0.015);
    const barnApronGeo = new THREE.BufferGeometry();
    barnApronGeo.setAttribute('position', new THREE.BufferAttribute(barnApronData.positions, 3));
    barnApronGeo.setIndex(barnApronData.indices);
    barnApronGeo.computeVertexNormals();
    const barnApron = new THREE.Mesh(barnApronGeo, new THREE.MeshStandardMaterial({ color: '#7e7057', roughness: 1 }));
    barnApron.position.set(barnApronX, 0, barnApronZ);
    barnApron.receiveShadow = true;
    this.scene.add(barnApron);

    const towerMat = new THREE.MeshStandardMaterial({ color: '#9b9b9b', roughness: 0.55, metalness: 0.5 });
    const towerGroundY = this.environment.terrainQuery.getElevation(35, 260);
    const towerBase = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.2, 14, 8), towerMat);
    towerBase.position.set(35, towerGroundY + 7, 260);
    this.scene.add(towerBase);
    const towerTank = new THREE.Mesh(
      new THREE.CylinderGeometry(6, 6, 6, 12),
      new THREE.MeshStandardMaterial({ color: '#b7b7a8', roughness: 0.6, metalness: 0.45 }),
    );
    towerTank.position.set(35, towerGroundY + 17, 260);
    this.scene.add(towerTank);

    // Trees, fences and bales now come from the authored composition (FieldWorld).

    if (airfield) this.buildFieldAirfieldCompound(airfield);
  }

  /** "Taller de campo" is named after this workshop, so its yard carries the field's
   * micro-story (art bible 18.1 / 20): an engine out on a hoist, bench and pegboard, fuel
   * drums, tyre stacks, a spare wing on trestles, oil stains and a patched post-and-rail fence.
   * Barn-local (door on +Z, runway toward +X), everything kept on the far side of the door from
   * the strip, merged into one vertex-coloured draw call. */
  private buildWorkshopDressing(): THREE.Mesh {
    const parts: Parameters<typeof mergeParts>[0] = [];
    const add = (geo: THREE.BufferGeometry, color: string, pos: [number, number, number], rot?: [number, number, number]) => parts.push({ geo, color, pos, rot });
    const steel = '#d89a2a', wood = '#8a6a42', darkWood = '#5d4a30', rubber = '#1f2223';
    // Engine hoist: A-frame gantry in front of the door with the flat-twin hanging off it.
    const hx = -1.2, hz = 12.5;
    for (const sx of [-1.55, 1.55]) for (const side of [-1, 1]) add(box(.12, 3.4, .12), steel, [hx + sx, 1.65, hz + side * .44], [-side * .26, 0, 0]);
    add(box(3.4, .16, .16), steel, [hx, 3.35, hz]);
    add(box(.3, .2, .3), '#55595c', [hx + .3, 3.2, hz]);
    add(box(.05, 1.25, .05), '#2e2e2e', [hx + .3, 2.5, hz]);
    add(box(.85, .55, .62), '#434a4e', [hx + .3, 1.6, hz]);
    for (const s of [-1, 1]) add(cyl(.16, .16, .5, 8), '#6b7074', [hx + .3 + s * .62, 1.6, hz], [0, 0, Math.PI / 2]);
    add(cyl(.12, .12, .25, 8), '#2a2d2f', [hx + .3, 1.6, hz + .42], [Math.PI / 2, 0, 0]);
    add(box(1.1, .1, .8), '#8b2f23', [hx + .3, .45, hz]);
    for (const [dx, dz] of [[-.48, -.34], [.48, -.34], [-.48, .34], [.48, .34]]) add(box(.07, .4, .07), '#2e2e2e', [hx + .3 + dx, .2, hz + dz]);
    // Bench, pegboard and tools along the front wall, east of the door.
    add(box(2.2, .08, .7), wood, [-4.3, .92, 8.55]);
    add(box(2.1, .04, .6), darkWood, [-4.3, .3, 8.55]);
    for (const [dx, dz] of [[-1, -.28], [1, -.28], [-1, .28], [1, .28]]) add(box(.07, .88, .07), darkWood, [-4.3 + dx, .44, 8.55 + dz]);
    add(box(.22, .18, .2), '#3b5d86', [-5.1, 1.05, 8.4]);
    add(box(.5, .24, .26), '#b8392a', [-3.7, 1.08, 8.6]);
    add(box(2, 1, .04), '#c9b58c', [-4.3, 1.75, 8.1]);
    for (let i = 0; i < 5; i++) add(box(.08, .35 + (i % 3) * .12, .04), '#3a3a3a', [-5.05 + i * .38, 1.8, 8.14]);
    // Ladder leaning on the wall west of the door.
    for (const dx of [-.22, .22]) add(box(.06, 3.2, .06), '#9c9a92', [2.9 + dx, 1.55, 8.4], [-.18, 0, 0]);
    for (let i = 0; i < 7; i++) add(box(.44, .04, .04), '#9c9a92', [2.9, .35 + i * .42, 8.62 - i * .075]);
    // Fuel drums, crates and tyres against the east wall.
    ['#b0442c', '#b0442c', '#3b6ea5', '#b0442c', '#6a7a3a'].forEach((c, i) => add(cyl(.29, .29, .88, 10), c, [-7.1, .44, -5.5 + i * .66]));
    add(cyl(.03, .03, .9, 5), '#3a3a3a', [-7.1, 1.33, -5.5]);
    add(box(.35, .05, .05), '#3a3a3a', [-7.1, 1.78, -5.4]);
    add(box(.9, .8, .9), '#8a6a3e', [-7.4, .4, -.6]);
    add(box(.9, .8, .9), '#7d5f36', [-8.5, .4, -.3], [0, .3, 0]);
    add(box(.7, .6, .7), '#96733f', [-7.5, 1.1, -.6], [0, -.2, 0]);
    for (let i = 0; i < 4; i++) add(new THREE.TorusGeometry(.34, .13, 6, 12), rubber, [-8.2, .13 + i * .26, 5], [Math.PI / 2, 0, 0]);
    for (let i = 0; i < 2; i++) add(new THREE.TorusGeometry(.34, .13, 6, 12), rubber, [-8.5, .13 + i * .26, 6.3], [Math.PI / 2, 0, 0]);
    add(new THREE.TorusGeometry(.34, .13, 6, 12), rubber, [-6.75, .47, 3.2], [0, Math.PI / 2, 0]);
    // Spare wing on trestles: the next project.
    for (const dx of [-1.6, 1.6]) {
      add(box(.1, .1, 1), wood, [5.4 + dx, .8, 14]);
      for (const side of [-1, 1]) add(box(.06, .85, .06), darkWood, [5.4 + dx, .4, 14 + side * .22], [-side * .3, 0, 0]);
    }
    add(box(4.6, .09, 1.25), '#dccfa0', [5.4, .9, 14], [0, .05, .02]);
    add(box(1.6, .06, .3), '#c9bd8e', [6.6, .9, 13.3], [0, .05, .02]);
    // Oil stains on the apron.
    for (const [x, z, r] of [[-.9, 11.8, 1.1], [-2.6, 9.6, .6], [1.5, 15.5, .8]]) add(new THREE.CircleGeometry(r, 12), '#4d463a', [x, .035, z], [-Math.PI / 2, 0, 0]);
    // Post-and-rail fence behind and east of the barn, one post leaning and one rail missing.
    const fence = (x0: number, z0: number, x1: number, z1: number) => {
      const len = Math.hypot(x1 - x0, z1 - z0), n = Math.round(len / 3), yaw = Math.atan2(x1 - x0, z1 - z0);
      for (let i = 0; i <= n; i++) {
        const t = i / n, lean = i === 2 ? .22 : ((i * 37) % 7 - 3) * .02;
        add(box(.12, 1.3, .12), '#6e583a', [x0 + (x1 - x0) * t, .62, z0 + (z1 - z0) * t], [lean, 0, lean * .5]);
        if (i === n) continue;
        const mx = x0 + (x1 - x0) * (t + .5 / n), mz = z0 + (z1 - z0) * (t + .5 / n);
        for (const y of [.55, 1]) if (!(i === 3 && y === 1)) add(box(.05, .07, len / n), '#86704e', [mx, y, mz], [0, yaw, 0]);
      }
    };
    fence(-10, 16, -10, -11);
    fence(-10, -11, 7, -11);
    const mesh = new THREE.Mesh(mergeParts(parts), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .85, metalness: .05 }));
    mesh.name = 'field-workshop-dressing';
    mesh.castShadow = mesh.receiveShadow = true;
    return mesh;
  }

  /** First-minute-of-flight upgrade for field_home (spec: "aeródromo vivo"): an apron
   * compound just outside the runway safe zone (open hangar, gravel apron, tie-downs,
   * fuel point), plus an access road out to the existing farmhouse/barn cluster so the
   * airfield reads as part of one working landscape instead of an isolated strip. */
  private buildFieldAirfieldCompound(airfield: AirfieldDefinition): void {
    const ground = (x: number, z: number) => this.environment.terrainQuery.getElevation(x, z);
    const safeZone = getRunwaySafeZone(airfield);
    const [, , rz] = airfield.position;
    // East of the strip and well south of it, clear of both the safe buffer and the
    // graded pad radius (runwayLengthM/2 + grading margin, see airfieldTerrain.ts) so the
    // compound's own collider never intrudes the pad (obstacles.test.ts).
    const compoundX = safeZone.maxX + 83;
    const compoundZ = rz - 110;

    // Gravel apron: the working surface tying hangar, parking and fuel together. Built
    // from a terrain-sampled grid (fieldAirfieldLayout.ts#buildTerrainFollowingMesh)
    // rather than one flat plane, so it hugs the undulating ground instead of floating
    // over or clipping into it. The hangar itself is the streamed field_hangar_compound
    // GLB (assetManifest.ts), placed by hydrateRuntimeAssets at this same compound
    // anchor — no procedural hangar geometry is built here to avoid a duplicate.
    const apronMat = new THREE.MeshStandardMaterial({ color: '#8c8371', roughness: 1 });
    const apronData = buildTerrainFollowingMesh(34, 40, 6, compoundX, compoundZ, ground);
    const apronGeo = new THREE.BufferGeometry();
    apronGeo.setAttribute('position', new THREE.BufferAttribute(apronData.positions, 3));
    apronGeo.setIndex(apronData.indices);
    apronGeo.computeVertexNormals();
    const apron = new THREE.Mesh(apronGeo, apronMat);
    apron.position.set(compoundX, 0, compoundZ);
    apron.receiveShadow = true;
    this.scene.add(apron);

    // Fuel point: a small tank plus a hose-reel stand, closer to the apron edge.
    const fuelMat = new THREE.MeshStandardMaterial({ color: '#a13b2e', roughness: .5, metalness: .4 });
    const fuelX = compoundX + 12, fuelZ = compoundZ + 10;
    const fuelTank = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.1, 3.4, 12), fuelMat);
    fuelTank.rotation.z = Math.PI / 2; fuelTank.position.set(fuelX, ground(fuelX, fuelZ) + 1.1, fuelZ); fuelTank.castShadow = true; this.scene.add(fuelTank);
    const fuelStandZ = compoundZ + 8;
    const fuelStand = new THREE.Mesh(new THREE.CylinderGeometry(.18, .18, 2.2, 6), new THREE.MeshStandardMaterial({ color: '#3a3a3a', roughness: .8 }));
    fuelStand.position.set(fuelX, ground(fuelX, fuelStandZ) + 1.1, fuelStandZ); this.scene.add(fuelStand);

    // Tie-down parking: three faded rectangles with a corner cone marker each, each pad
    // its own terrain-sampled grid so it doesn't float/clip on the sloped apron edge.
    const tieDownMat = new THREE.MeshStandardMaterial({ color: '#6c6455', roughness: 1 });
    const coneMat = new THREE.MeshStandardMaterial({ color: '#d9611f', roughness: .7 });
    for (let i = 0; i < 3; i++) {
      const px = compoundX + 5 + i * 6.5, pz = compoundZ + 13;
      const padData = buildTerrainFollowingMesh(4.5, 6, 2, px, pz, ground, 0.03);
      const padGeo = new THREE.BufferGeometry();
      padGeo.setAttribute('position', new THREE.BufferAttribute(padData.positions, 3));
      padGeo.setIndex(padData.indices);
      padGeo.computeVertexNormals();
      const pad = new THREE.Mesh(padGeo, tieDownMat); pad.position.set(px, 0, pz); this.scene.add(pad);
      const coneX = px - 2, coneZ = pz - 3;
      const cone = new THREE.Mesh(new THREE.ConeGeometry(.3, .6, 8), coneMat); cone.position.set(coneX, ground(coneX, coneZ) + .3, coneZ); this.scene.add(cone);
    }

    // Access road out to the region's hero landmark is now built once for every region
    // by buildRegionRoadNetwork (regionRoadNetworks.ts), called from the constructor —
    // this compound only owns the apron/fuel/tie-downs. ruralCore stays in sync with
    // that network's the_field primary target (field_village_cluster's anchor).
  }

  /** Builds the continuous access road connecting a region's airfield to its hero
   * landmark, plus a branch to a second anchor (regionRoadNetworks.ts), as terrain-
   * following InstancedMesh tiles styled per biome. Shared by all 8 regions instead of
   * bespoke per-region road code. */
  private buildRegionRoadNetwork(regionId: string): void {
    const network = getRegionRoadNetwork(regionId);
    if (!network) return;
    const ground = (x: number, z: number) => this.environment.terrainQuery.getElevation(x, z);
    const roadMat = new THREE.MeshStandardMaterial({ color: network.style.colorHex, roughness: 1 });
    const tileGeo = new THREE.PlaneGeometry(network.style.widthM, network.style.tileLengthM);
    const matrix = new THREE.Matrix4();
    for (const waypoints of network.links) {
      const tiles = layoutRoadTiles(waypoints, network.style.tileLengthM);
      if (tiles.length === 0) continue;
      const road = new THREE.InstancedMesh(tileGeo, roadMat, tiles.length);
      tiles.forEach((tile, i) => {
        const y = ground(tile.x, tile.z) + 0.02;
        matrix.compose(
          new THREE.Vector3(tile.x, y, tile.z),
          new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, tile.rotationY)),
          new THREE.Vector3(1, 1, 1),
        );
        road.setMatrixAt(i, matrix);
      });
      road.instanceMatrix.needsUpdate = true;
      road.receiveShadow = true;
      this.scene.add(road);
    }
  }

  /** World spec section 227 QA: no prop/tree may land on a graded runway pad. Retries a
   * few times with a fresh sample rather than skipping outright, so excluding the pad
   * doesn't visibly thin scatter density near an airfield. */
  private placeOffRunway(pick: () => { x: number; z: number }): { x: number; z: number } {
    for (let attempt = 0; attempt < 8; attempt++) {
      const p = pick();
      if (!this.environment.terrainQuery.isOnGradedRunway(p.x, p.z)) return p;
    }
    return pick();
  }

  /** Region 2 landmarks (spec 12.3): scrapyard piles, a gantry crane, and fictional
   * power lines as low-altitude obstacles ("turbulencia entre estructuras"). All
   * primitive Three.js geometry, matching the placeholder-art approach used for
   * Region 1 (see README "No real 3D art/audio assets"). */
  private buildScrapValleyLandmarks() {
    const scrapMat = new THREE.MeshStandardMaterial({ color: '#6b6558', roughness: 1, metalness: 0.2 });
    const rustMat = new THREE.MeshStandardMaterial({ color: '#8a4a2c', roughness: 0.95, metalness: 0.3 });
    const craneMat = new THREE.MeshStandardMaterial({ color: '#c9a227', roughness: 0.7, metalness: 0.4 });

    // Gantry crane landmark near the delivery/landing target, playing the barn's role.
    const craneGroup = new THREE.Group();
    craneGroup.position.set(-25, this.environment.terrainQuery.getElevation(-25, 300), 300);
    const legGeo = new THREE.CylinderGeometry(0.5, 0.5, 16, 8);
    for (const x of [-9, 9]) {
      const leg = new THREE.Mesh(legGeo, craneMat);
      leg.position.set(x, 8, 0);
      craneGroup.add(leg);
    }
    const beam = new THREE.Mesh(new THREE.BoxGeometry(20, 1.2, 1.2), craneMat);
    beam.position.set(0, 16, 0);
    craneGroup.add(beam);
    this.scene.add(craneGroup);

    // Scattered scrap piles: irregular stacked boxes, playing the water tower's role
    // as a second distant landmark plus general clutter.
    for (let i = 0; i < 22; i++) {
      const pileGroup = new THREE.Group();
      const boxCount = 2 + Math.floor(this.worldRng.next() * 3);
      for (let b = 0; b < boxCount; b++) {
        const size = 1.5 + this.worldRng.next() * 2.5;
        const box = new THREE.Mesh(new THREE.BoxGeometry(size, size * 0.7, size), this.worldRng.next() > 0.5 ? scrapMat : rustMat);
        box.position.set((this.worldRng.next() - 0.5) * 3, size * 0.35 * (b + 1), (this.worldRng.next() - 0.5) * 3);
        box.rotation.y = this.worldRng.next() * Math.PI;
        pileGroup.add(box);
      }
      const { x, z } = this.placeOffRunway(() => {
        const angle = this.worldRng.next() * Math.PI * 2;
        const dist = 60 + this.worldRng.next() * 480;
        return { x: Math.cos(angle) * dist, z: 150 + Math.sin(angle) * dist };
      });
      pileGroup.position.set(x, this.environment.terrainQuery.getElevation(x, z), z);
      this.scene.add(pileGroup);
    }

    // Fictional power lines strung between poles as low-altitude obstacles/skill gaps
    // (spec 12.3 "líneas eléctricas ficticias como obstáculos").
    const poleMat = new THREE.MeshStandardMaterial({ color: '#4a4238', roughness: 0.9 });
    const poleGeo = new THREE.CylinderGeometry(0.25, 0.3, 18, 6);
    const wireMat = new THREE.LineBasicMaterial({ color: '#222222' });
    const polePositions: [number, number][] = [
      [80, 60],
      [80, 140],
      [80, 220],
      [80, 300],
    ];
    let prevTop: THREE.Vector3 | null = null;
    for (const [x, z] of polePositions) {
      const groundY = this.environment.terrainQuery.getElevation(x, z);
      const pole = new THREE.Mesh(poleGeo, poleMat);
      pole.position.set(x, groundY + 9, z);
      this.scene.add(pole);
      const top = new THREE.Vector3(x, groundY + 17.5, z);
      if (prevTop) {
        const wireGeo = new THREE.BufferGeometry().setFromPoints([prevTop, top]);
        this.scene.add(new THREE.Line(wireGeo, wireMat));
      }
      prevTop = top;
    }
  }

  /** Placeholder DIY-tube aircraft mesh (no imported assets yet — see README TODO).
   * Materials tuned per Art Bible §84/85: welded steel tube reads semi-gloss
   * (brushed metal, not chrome), doped fabric is low-sheen cloth, engine block
   * is dark cast metal with a warmer edge highlight than pure black. */
  private buildAircraftPlaceholder(paint?: { fabricColor: string; tubeColor: string }) {
    const tubeMat = new THREE.MeshStandardMaterial({ color: paint?.tubeColor ?? '#aeb3af', metalness: 0.68, roughness: 0.32 });
    const fabricMat = new THREE.MeshStandardMaterial({ color: paint?.fabricColor ?? '#d4b96e', side: THREE.DoubleSide, roughness: 0.82, metalness: 0.02 });
    new THREE.TextureLoader().load('/assets/textures/aircraft-fabric-v1.png', (texture) => {
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
      texture.repeat.set(3, 2);
      texture.anisotropy = 4;
      fabricMat.map = texture;
      fabricMat.needsUpdate = true;
    });
    const darkFabricMat = new THREE.MeshStandardMaterial({ color: '#30383a', side: THREE.DoubleSide, roughness: 0.92 });
    const engineMat = new THREE.MeshStandardMaterial({ color: '#292d2d', roughness: 0.38, metalness: 0.82 });
    const wheelMat = new THREE.MeshStandardMaterial({ color: '#17191a', roughness: 0.86, metalness: 0.04 });
    const woodMat = new THREE.MeshStandardMaterial({ color: '#6f4525', roughness: 0.55, metalness: 0.05 });
    const makeTube = (from: THREE.Vector3, to: THREE.Vector3, radius = 0.055, material = tubeMat) => {
      const midpoint = from.clone().add(to).multiplyScalar(0.5);
      const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, from.distanceTo(to), 8), material);
      mesh.position.copy(midpoint);
      mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), to.clone().sub(from).normalize());
      mesh.castShadow = true;
      this.aircraftGroup.add(mesh);
      return mesh;
    };
    const makeWing = (span: number, chordRoot: number, chordTip: number, xOffset: number, zOffset: number) => {
      const shape = new THREE.Shape();
      // The shape lives in x/z plan view. Extruding only .08 m, then rotating it,
      // produces a proper airfoil-like cloth panel instead of a vertical slab.
      shape.moveTo(-span / 2, -chordTip * .48);
      shape.lineTo(-span / 2 + .5, chordTip * .52);
      shape.lineTo(-.45, chordRoot * .58);
      shape.lineTo(.45, chordRoot * .58);
      shape.lineTo(span / 2 - .5, chordTip * .52);
      shape.lineTo(span / 2, -chordTip * .48);
      shape.lineTo(.45, -chordRoot * .5);
      shape.lineTo(-.45, -chordRoot * .5);
      shape.closePath();
      const geo = new THREE.ExtrudeGeometry(shape, { depth: .075, bevelEnabled: false });
      geo.translate(0, 0, -.0375);
      const mesh = new THREE.Mesh(geo, fabricMat);
      mesh.rotation.x = Math.PI / 2;
      mesh.position.set(xOffset, .42, zOffset);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.aircraftGroup.add(mesh);
      return mesh;
    };

    // Open tubular truss fuselage: it reads as a crafted ultralight instead of a capsule.
    const nose = new THREE.Vector3(0, 0, 2.5), cockpitFront = new THREE.Vector3(0, .28, .75), cockpitRear = new THREE.Vector3(0, .38, -1.5), tail = new THREE.Vector3(0, .48, -4.75);
    for (const side of [-1, 1]) {
      const frontLow = new THREE.Vector3(side * .42, -.28, .75), rearLow = new THREE.Vector3(side * .38, -.2, -1.5);
      const frontHigh = new THREE.Vector3(side * .32, .65, .55), rearHigh = new THREE.Vector3(side * .25, .72, -1.6);
      makeTube(nose, frontLow); makeTube(frontLow, rearLow); makeTube(rearLow, tail);
      makeTube(frontHigh, rearHigh); makeTube(frontHigh, cockpitFront); makeTube(rearHigh, cockpitRear); makeTube(rearHigh, tail);
      makeTube(frontLow, rearHigh, .038); makeTube(rearLow, frontHigh, .038);
    }
    makeTube(cockpitFront, cockpitRear, .07); makeTube(nose, cockpitFront, .075);

    const wing = makeWing(10.6, 1.7, 1.15, 0, -.25);
    this.wingMesh = wing;
    // Visible struts and tension wires make the airframe's mechanics legible at a glance.
    for (const side of [-1, 1]) {
      makeTube(new THREE.Vector3(side * 4.65, .39, -.3), new THREE.Vector3(side * .35, -.22, .55), .052);
      makeTube(new THREE.Vector3(side * 4.3, .39, -.95), new THREE.Vector3(side * .25, .68, -1.4), .045);
      makeTube(new THREE.Vector3(side * 4.55, .38, -.25), new THREE.Vector3(side * .28, .68, -1.4), .022, darkFabricMat);
    }

    const seat = new THREE.Mesh(new THREE.BoxGeometry(1.05, .12, 1.15), darkFabricMat);
    seat.position.set(0, .18, -.55); seat.rotation.x = -.27; seat.castShadow = true; this.aircraftGroup.add(seat);
    const windshield = new THREE.Mesh(new THREE.SphereGeometry(.62, 12, 8, 0, Math.PI), new THREE.MeshPhysicalMaterial({ color: '#9cd5df', transparent: true, opacity: .33, roughness: .08, transmission: .1, side: THREE.DoubleSide }));
    windshield.scale.set(1, .7, .52); windshield.position.set(0, .82, .35); windshield.rotation.y = Math.PI / 2; this.aircraftGroup.add(windshield);

    const hStab = new THREE.Mesh(new THREE.BoxGeometry(3.1, 0.07, 0.72), fabricMat);
    hStab.position.set(0, .48, -4.85); hStab.castShadow = true;
    this.aircraftGroup.add(hStab);
    this.tailMeshes.push(hStab);

    const vStab = new THREE.Mesh(new THREE.BoxGeometry(0.07, 1.45, 0.8), fabricMat);
    vStab.position.set(0, 1.12, -4.85); vStab.castShadow = true;
    this.aircraftGroup.add(vStab);
    this.tailMeshes.push(vStab);

    const engine = new THREE.Mesh(new THREE.CylinderGeometry(0.48, 0.48, 0.72, 10), engineMat);
    engine.rotation.x = Math.PI / 2;
    engine.position.set(0, 0, 2.1);
    this.aircraftGroup.add(engine);

    // Engine cylinders + wooden two-blade propeller establish a clear prop aircraft silhouette.
    for (const x of [-.28, .28]) { const cylinder = new THREE.Mesh(new THREE.CylinderGeometry(.17, .17, .72, 8), engineMat); cylinder.rotation.z = Math.PI / 2; cylinder.position.set(x, 0, 2.16); this.aircraftGroup.add(cylinder); }
    const propHub = new THREE.Mesh(new THREE.SphereGeometry(.18, 10, 8), engineMat); propHub.position.set(0, 0, 2.52); this.aircraftGroup.add(propHub);
    for (const angle of [Math.PI / 4, Math.PI / 4 + Math.PI]) { const blade = new THREE.Mesh(new THREE.BoxGeometry(.3, 1.5, .08), woodMat); blade.position.set(Math.cos(angle) * .48, Math.sin(angle) * .48, 2.54); blade.rotation.z = -angle; blade.castShadow = true; this.aircraftGroup.add(blade); }

    for (const x of [-1.1, 1.1]) {
      const wheel = new THREE.Mesh(new THREE.TorusGeometry(0.4, 0.14, 8, 16), wheelMat);
      wheel.position.set(x, -0.9, 0.4);
      wheel.rotation.y = Math.PI / 2; wheel.castShadow = true;
      this.aircraftGroup.add(wheel);
      const strut = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.9, 6), tubeMat);
      strut.position.set(x, -0.5, 0.4);
      this.aircraftGroup.add(strut);
    }
    const noseWheel = new THREE.Mesh(new THREE.TorusGeometry(0.28, 0.1, 8, 16), wheelMat);
    noseWheel.position.set(0, -0.7, 1.8);
    noseWheel.rotation.y = Math.PI / 2; noseWheel.castShadow = true;
    this.aircraftGroup.add(noseWheel);
  }

  /** Directive spec XII: "delete the visual concept of the green rectangle runway" —
   * a flat solid-color plane reads as a placeholder regardless of surface type. A
   * cheap canvas noise texture (patches, ruts, scattered rock speckle) breaks up the
   * uniform color without the cost of a real ground material/shader. */
  private buildRunwaySurfaceTexture(surface: RunwaySurface | undefined, rng: SeededRandom): THREE.CanvasTexture {
    const size = 256;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext('2d')!;
    const base = this.runwayColor(surface) as string;
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, size, size);
    const unpaved = surface === 'dirt' || surface === 'grass' || surface === 'gravel' || surface === undefined;
    const blotches = unpaved ? 220 : 50;
    for (let i = 0; i < blotches; i++) {
      const shade = unpaved ? (rng.next() > 0.5 ? '#00000022' : '#ffffff18') : '#00000014';
      ctx.fillStyle = shade;
      // Pebbles and tire-worn variation, not the oversized dark discs that previously
      // made a dirt strip look like a procedural paint splatter from chase camera.
      const r = unpaved ? 0.6 + rng.next() * 2.4 : 0.5 + rng.next() * 2;
      ctx.beginPath();
      ctx.ellipse(rng.next() * size, rng.next() * size, r, r * (0.5 + rng.next() * 0.6), rng.next() * Math.PI, 0, Math.PI * 2);
      ctx.fill();
    }
    if (surface === 'dirt' || surface === undefined) {
      // Wheel ruts: two faint darker tracks running the length of the strip.
      ctx.strokeStyle = '#00000030';
      ctx.lineWidth = 4;
      for (const x of [size * 0.4, size * 0.6]) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, size);
        ctx.stroke();
      }
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(3, 14);
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
  }

  /** Art bible 18.1 ("uneven edges, visible wear"): one non-repeating map for the whole grass
   * strip (~10 cm/px) so wear can vary along its length — mower stripes, main-gear and nose
   * tracks worn to dirt in the touchdown zones, turnaround scars where aircraft backtrack at
   * each threshold, bare patches, and a ragged unmown fringe cut out through alpha. */
  private buildGrassStripTexture(widthM: number, lengthM: number, rng: SeededRandom): THREE.CanvasTexture {
    const W = 256, H = 2048, sx = W / widthM, sz = H / lengthM;
    const canvas = document.createElement('canvas');
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext('2d')!;
    const px = (xM: number) => (xM + widthM / 2) * sx, pz = (zM: number) => (zM + lengthM / 2) * sz;
    ctx.fillStyle = '#7b9658';
    ctx.fillRect(0, 0, W, H);
    // Mower passes: 3 m bands, light/dark by blade direction.
    const passes = Math.max(2, Math.round(widthM / 3));
    for (let i = 0; i < passes; i++) {
      ctx.fillStyle = i % 2 ? 'rgba(255,250,215,0.08)' : 'rgba(25,45,5,0.07)';
      ctx.fillRect((i * W) / passes, 0, W / passes + 1, H);
    }
    for (let i = 0; i < 16000; i++) {
      ctx.fillStyle = rng.next() > 0.5 ? 'rgba(35,62,12,0.2)' : 'rgba(225,235,185,0.13)';
      ctx.fillRect(rng.next() * W, rng.next() * H, 1 + rng.next() * 1.5, 1 + rng.next() * 3);
    }
    // Wear peaks ~45 m in from each threshold (touchdown) and at the very ends (turnaround).
    const wear = (zM: number) => {
      const t = lengthM / 2 - Math.abs(zM);
      return Math.min(1, 0.3 + 0.7 * Math.exp(-(((t - 45) / 28) ** 2)) + 0.6 * Math.exp(-((t / 12) ** 2)));
    };
    const tracks: Array<[number, number, number]> = [[-1.15, 0.5, 0.6], [1.15, 0.5, 0.6], [0, 0.3, 0.35], [-1.6, 0.4, 0.25], [0.7, 0.4, 0.25]];
    for (let y = 0; y < H; y += 2) {
      const zM = y / sz - lengthM / 2, w = wear(zM);
      const wobble = Math.sin(zM * 0.05) * 0.35 + Math.sin(zM * 0.013 + 1) * 0.5;
      for (const [xM, widthTrackM, alpha] of tracks) {
        ctx.fillStyle = `rgba(128,102,66,${(alpha * w).toFixed(3)})`;
        ctx.fillRect(px(xM + wobble) - (widthTrackM * sx) / 2, y, widthTrackM * sx, 2);
      }
    }
    // Turnaround scars where aircraft backtrack and swing round: a blotchy trodden patch (a
    // stroked ring read as a helipad marking from the air).
    for (const end of [-1, 1]) {
      const cz = end * (lengthM / 2 - 10);
      for (let k = 0; k < 7; k++) {
        ctx.fillStyle = `rgba(135,112,72,${(0.12 + rng.next() * 0.14).toFixed(2)})`;
        ctx.beginPath(); ctx.ellipse(px((rng.next() - 0.4) * 5), pz(cz + (rng.next() - 0.5) * 8), (2 + rng.next() * 3) * sx, (2 + rng.next() * 3.5) * sz, rng.next() * 3, 0, Math.PI * 2); ctx.fill();
      }
    }
    for (let i = 0; i < 6; i++) {
      const zM = (rng.next() - 0.5) * lengthM * 0.8, xM = (rng.next() - 0.5) * widthM * 0.5;
      ctx.fillStyle = 'rgba(118,98,62,0.28)';
      ctx.beginPath(); ctx.ellipse(px(xM), pz(zM), (1 + rng.next() * 2) * sx, (2 + rng.next() * 5) * sz, rng.next() * 0.4, 0, Math.PI * 2); ctx.fill();
    }
    // Unmown fringe: darker, then cut ragged; its width wanders so the edge never reads ruled.
    const img = ctx.getImageData(0, 0, W, H), d = img.data;
    for (let y = 0; y < H; y++) {
      const zM = y / sz - lengthM / 2;
      for (const side of [0, 1]) {
        const fringeM = 0.9 + 0.55 * Math.sin(zM * 0.045 + side * 2) + 0.35 * Math.sin(zM * 0.17 + side);
        for (let k = 0; k < (fringeM + 1.2) * sx; k++) {
          const i = (y * W + (side ? W - 1 - k : k)) * 4, dM = k / sx;
          for (let c = 0; c < 3; c++) d[i + c] *= 0.86;
          if (dM < fringeM - rng.next() * 0.7) d[i + 3] = 0;
        }
      }
    }
    ctx.putImageData(img, 0, 0);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
    return texture;
  }

  /** Unpaved strips are graded dirt, not a mathematically flat pad — perturb the
   * mesh's own vertices slightly so the runway reads as a real surface at low
   * grazing angles instead of a billiard-table plane (directive spec XII). */
  private roughenRunwayGeometry(geo: THREE.PlaneGeometry, surface: RunwaySurface | undefined, rng: SeededRandom): void {
    if (surface === 'tarmac' || surface === 'salt') return;
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      pos.setZ(i, pos.getZ(i) + (rng.next() - 0.5) * 0.06);
    }
    pos.needsUpdate = true;
    geo.computeVertexNormals();
  }

  private runwayColor(surface: RunwaySurface | undefined): THREE.ColorRepresentation {
    switch (surface) {
      case 'grass': return '#78925b';
      case 'dirt': return '#9a7550';
      case 'gravel': return '#817b6e';
      case 'salt': return '#c9c2aa';
      case 'tarmac': return '#535858';
      default: return '#817b6e';
    }
  }

  private buildRunway(airfield: AirfieldDefinition | undefined): void {
    const runwayCenter: [number, number] = airfield ? [airfield.position[0], airfield.position[2]] : [0, 0];
    const runwayWidth = airfield?.runwayWidthM ?? 24;
    const runwayLength = airfield?.runwayLengthM ?? 220;
    const runwayY = this.environment.terrainQuery.getElevation(...runwayCenter);
    const runwayGeo = new THREE.PlaneGeometry(runwayWidth, runwayLength, Math.max(4, Math.round(runwayWidth / 3)), Math.max(8, Math.round(runwayLength / 6)));
    this.roughenRunwayGeometry(runwayGeo, airfield?.surface, this.worldRng);
    // Grass gets its own full-length map (tracks, stripes, ragged fringe); the repeating
    // speckle map read as giant dark discs on grass from the chase camera.
    const grass = airfield?.surface === 'grass';
    const runwayMat = new THREE.MeshStandardMaterial({
      color: grass ? '#ffffff' : this.runwayColor(airfield?.surface),
      map: grass
        ? this.buildGrassStripTexture(runwayWidth, runwayLength, createSeededRandom('runway-grass', airfield!.id))
        : this.buildRunwaySurfaceTexture(airfield?.surface, this.worldRng),
      // The fringe is cut out of the map's alpha, so the strip's edge is uneven instead of a ruled line.
      alphaTest: grass ? 0.5 : 0,
      roughness: 0.9,
      metalness: 0.03,
    });
    const runway = new THREE.Mesh(runwayGeo, runwayMat);
    runway.rotation.x = -Math.PI / 2;
    // Clear of the ±3 cm roughening: at +2.5 cm the pad's terrain poked through as green blots.
    runway.position.set(runwayCenter[0], runwayY + 0.06, runwayCenter[1]);
    runway.receiveShadow = true;
    this.scene.add(runway);
    this.addRunwayDressings(runwayCenter, runwayY, runwayWidth, runwayLength, airfield?.surface);
    if (airfield) this.addWindsock(runwayCenter, runwayWidth, runwayLength);
  }

  /** Pole + orange/white sock beside the threshold: the one prop every real strip has. */
  private addWindsock(center: readonly [number, number], width: number, length: number): void {
    const x = center[0] + width / 2 + 9, z = center[1] - length / 2 + 25;
    const y = this.environment.terrainQuery.getElevation(x, z);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(.06, .08, 6, 6), new THREE.MeshStandardMaterial({ color: '#d8d6cf', roughness: .6, metalness: .4 }));
    pole.position.set(x, y + 3, z);
    pole.castShadow = true;
    this.scene.add(pole);
    for (let i = 0; i < 4; i++) {
      const seg = new THREE.Mesh(
        new THREE.CylinderGeometry(.42 - i * .07, .35 - i * .07, .7, 10, 1, true),
        new THREE.MeshStandardMaterial({ color: i % 2 ? '#f2eee4' : '#e0692c', roughness: .8, side: THREE.DoubleSide }),
      );
      seg.rotation.z = Math.PI / 2 - .12; // slight droop in a light breeze
      seg.position.set(x + .45 + i * .7, y + 5.8 - i * .08, z);
      seg.castShadow = true;
      this.scene.add(seg);
    }
  }

  private addRunwayDressings(center: readonly [number, number], runwayY: number, width: number, length: number, surface?: RunwaySurface) {
    const markingMat = new THREE.MeshBasicMaterial({ color: '#e9e2ca' });
    const shouldMark = surface === 'tarmac' || surface === 'salt';
    for (let z = -length / 2 + 18; shouldMark && z < length / 2 - 10; z += 30) {
      const dash = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 12), markingMat);
      dash.rotation.x = -Math.PI / 2;
      dash.position.set(center[0], runwayY + .04, center[1] + z);
      this.scene.add(dash);
    }
    // Unpaved strips are marked the improvised way (art bible 18.1): half-buried painted tyres,
    // faces toward the approach, along both edges plus a row across each threshold with orange
    // corners. Paved strips keep small edge posts. One InstancedMesh either way.
    const tyres = !shouldMark;
    const spots: Array<[number, number, boolean]> = [];
    for (const x of [-width / 2 + .7, width / 2 - .7]) {
      for (let z = -length / 2 + 8; z <= length / 2 - 8; z += 22) spots.push([x, z, false]);
    }
    if (tyres) for (const end of [-1, 1]) for (const f of [-.5, -.17, .17, .5]) spots.push([f * (width - 1.4), end * (length / 2 - 1.5), Math.abs(f) === .5]);
    const markers = new THREE.InstancedMesh(
      tyres ? new THREE.TorusGeometry(.36, .14, 6, 14) : new THREE.BoxGeometry(.22, .55, .22),
      tyres ? new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: .75 }) : new THREE.MeshBasicMaterial({ color: '#d99642' }),
      spots.length,
    );
    const m = new THREE.Matrix4(), white = new THREE.Color('#ece7da'), orange = new THREE.Color('#e0692c');
    spots.forEach(([x, z, corner], i) => {
      markers.setMatrixAt(i, m.makeTranslation(center[0] + x, runwayY + (tyres ? .12 : .28), center[1] + z));
      if (tyres) markers.setColorAt(i, corner ? orange : white);
    });
    this.scene.add(markers);
  }

  setTargetMarker(pos: [number, number, number] | undefined, radiusM: number) {
    if (this.targetMarker) {
      this.scene.remove(this.targetMarker);
      this.targetMarker = null;
    }
    this.targetPulseMaterials = [];
    if (!pos) return;
    const marker = new THREE.Group();
    const groundY = this.environment.terrainQuery.getElevation(pos[0], pos[2]);
    const ringMaterial = new THREE.MeshBasicMaterial({ color: '#ffcc33', side: THREE.DoubleSide, transparent: true, opacity: 0.82, depthWrite: false });
    const ring = new THREE.Mesh(new THREE.RingGeometry(radiusM * 0.9, radiusM, 40), ringMaterial);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.05;
    marker.add(ring);

    // Four thin beacons make the zone readable while approaching, without obscuring the
    // aircraft or suggesting an unrealistically tall obstacle at touchdown.
    const beaconGeo = new THREE.BoxGeometry(0.32, 8, 0.32);
    for (const [x, z] of [[-radiusM * 0.75, 0], [radiusM * 0.75, 0], [0, -radiusM * 0.75], [0, radiusM * 0.75]] as const) {
      const beaconMaterial = new THREE.MeshBasicMaterial({ color: '#ffbb32', transparent: true, opacity: 0.72, depthWrite: false });
      const beacon = new THREE.Mesh(beaconGeo, beaconMaterial);
      beacon.position.set(x, 4, z);
      marker.add(beacon);
      this.targetPulseMaterials.push(beaconMaterial);
    }
    this.targetPulseMaterials.push(ringMaterial);
    marker.position.set(pos[0], groundY, pos[2]);
    this.targetMarker = marker;
    this.scene.add(marker);
  }

  /** Floating-origin rebase: the chase camera's smoothed state isn't a scene child, so shift it explicitly. */
  shiftOrigin(dx: number, dz: number) { this.chase.shift(dx, dz); this.originX += dx; this.originZ += dz; }
  private originX = 0;
  private originZ = 0;

  /** Cockpit view: hide the airframe so the eye point never clips through its own mesh. */
  setFpv(on: boolean) {
    this.fpv = on;
    this.chase.fpv = on;
    // Eye sits inside the avatar's head: drop only the head layer (it still casts its shadow),
    // so the cockpit view keeps the pilot's own arms, hands on the controls and knees.
    if (on) this.camera.layers.disable(PILOT_HEAD_LAYER); else this.camera.layers.enable(PILOT_HEAD_LAYER);
    if (this.pilotSeat) {
      seatEye(this.pilotSeat, this.chase.eye);
      const p = this.pilot;
      p?.root.updateMatrix();
      this.instruments.mount(this.chase.eye, p ? { stick: p.stickGrip.clone().applyMatrix4(p.root.matrix), throttle: p.throttleGrip.clone().applyMatrix4(p.root.matrix), scale: this.pilotSeat.scale } : undefined);
      this.aircraftGroup.add(this.instruments.group, this.instruments.controls); // re-add: airframe loads clear() the group
    }
    // Tubes and panel are centimetres from the eye; the chase near plane would clip them away.
    this.camera.near = on ? 0.03 : 0.5;
    this.camera.updateProjectionMatrix();
  }

  /** Physical cockpit gauges; cheap no-op between redraws. */
  updateInstruments(t: FlightTelemetry, dtS: number, fit?: { engine: EngineLimits | null; hasFlaps: boolean }) {
    if (fit) this.instruments.configure(fit.engine, fit.hasFlaps);
    this.instruments.update(t, dtS);
  }

  private guidanceCue: THREE.Group | null = null;
  /** Optional world cue at the active route point (scene frame x/z, and a min altitude to show as a
   * gate). A slim, pale survey pole + halo — reads like field survey tape, not an arcade ring. */
  setGuidanceCue(cue: { x: number; z: number; minAltM?: number; kind?: string; runway?: { elevationM: number; headingDeg: number; glideAngleDeg: number; thresholdX: number; thresholdZ: number } } | null, navDeltaDeg: number | null) {
    this.instruments.navDeltaDeg = navDeltaDeg;
    if (!cue) { if (this.guidanceCue) this.guidanceCue.visible = false; return; }
    if (!this.guidanceCue) {
      const g = new THREE.Group();
      const mat = new THREE.MeshBasicMaterial({ color: '#f4efe2', transparent: true, opacity: 0.35, depthWrite: false, fog: true });
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.6, 1, 6, 1, true), mat);
      pole.name = 'pole';
      const halo = new THREE.Mesh(new THREE.TorusGeometry(40, 0.8, 6, 48), new THREE.MeshBasicMaterial({ color: '#6fd3f0', transparent: true, opacity: 0.45, depthWrite: false, fog: true }));
      halo.name = 'halo';
      const gates = new THREE.Group(); gates.name = 'approach_gates';
      const gateMat = new THREE.MeshBasicMaterial({ color: '#e9dfc4', transparent: true, opacity: 0.16, depthWrite: false, side: THREE.DoubleSide });
      for (let i = 0; i < 4; i++) {
        const gate = new THREE.Mesh(new THREE.TorusGeometry(34 - i * 4, 0.8, 5, 32), gateMat.clone());
        gate.name = `gate_${i}`;
        gates.add(gate);
      }
      g.add(pole, halo, gates);
      g.name = 'guidance_cue';
      this.scene.add(g);
      this.guidanceCue = g;
    }
    const g = this.guidanceCue;
    const ground = this.environment.terrainQuery.getElevation(cue.x + this.originX, cue.z + this.originZ);
    const top = Math.max(ground + 120, cue.minAltM ?? 0);
    const pole = g.getObjectByName('pole')!, halo = g.getObjectByName('halo')!;
    pole.scale.y = top - ground; pole.position.y = (top - ground) / 2;
    halo.position.y = top - ground; halo.rotation.x = Math.PI / 2;
    halo.visible = cue.minAltM !== undefined; // the gate only exists where the plan sets a crossing altitude
    g.position.set(cue.x, ground, cue.z);
    const gates = g.getObjectByName('approach_gates');
    if (gates && cue.runway && ['approach', 'final', 'threshold'].includes(cue.kind ?? '')) {
      const dx = cue.runway.thresholdX - cue.x, dz = cue.runway.thresholdZ - cue.z;
      const distance = Math.hypot(dx, dz), count = 4;
      for (let i = 0; i < count; i++) {
        const gate = gates.children[i] as THREE.Mesh;
        const t = (i + 1) / (count + 1);
        gate.position.set(dx * t, Math.max(0, distance * t * Math.tan(cue.runway.glideAngleDeg * Math.PI / 180)), dz * t);
        gate.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), new THREE.Vector3(dx, 0, dz).normalize());
        const size = THREE.MathUtils.clamp(0.72 + distance / 6000, 0.72, 1.2);
        gate.scale.setScalar(size);
      }
      gates.visible = true;
    } else if (gates) gates.visible = false;
    g.visible = true;
  }

  syncAircraft(position: THREE.Vector3, quaternion: THREE.Quaternion, dtS: number, cam: ChaseCameraInput) {
    this.aircraftGroup.position.copy(position);
    this.aircraftGroup.quaternion.copy(quaternion);
    this.chase.update(position, quaternion, dtS, cam);
    this.updateDebris(dtS);
    this.updateBursts(dtS);
    // Keep the chase camera above the terrain (free-look can swing it below the ground).
    if (!this.chase.fpv) {
      const p = this.camera.position;
      const floor = this.environment.terrainQuery.getElevation(p.x + this.originX, p.z + this.originZ) + 1.2;
      if (p.y < floor) p.y = floor;
    }
  }

  /** Drives the A0's hinged surfaces and propeller from the flight model's control target and engine rpm. */
  animateAircraft(target: SurfaceDeflections, rpm: number, dtS: number, groundSpeedMs = 0, onGround = false, gearRatio = 2.3, gear?: GearPose) {
    this.instruments.flaps = target.flaps ?? 0;
    if (this.rigs.length) for (const rig of this.rigs) rig.update(target, rpm, dtS, groundSpeedMs, onGround, gearRatio, gear);
    else {
      // Non-A0 propellers use the same engine-RPM-to-shaft-speed mapping; camera speed
      // never drives aircraft animation.
      const omega = (Math.max(0, rpm) / Math.max(1, gearRatio)) * Math.PI * 2 / 60;
      for (const propeller of this.propellerMeshes) propeller.rotation.z = (propeller.rotation.z + omega * Math.max(0, Math.min(0.1, dtS))) % (Math.PI * 2);
    }
  }

  /** Player avatar look; re-seats immediately if an airframe is already loaded. */
  setPilotAppearance(appearance: AvatarAppearance) {
    this.pilotAppearance = appearance;
    if (this.loadedAircraft) { this.seatPilot(); this.setFpv(this.fpv); }
  }

  private seatPilot() {
    this.pilot?.dispose();
    this.pilot = null;
    this.pilotSeat = null;
    if (!this.loadedAircraft) return;
    this.pilot = new PilotAvatar(this.pilotAppearance);
    this.pilotSeat = seatAvatar(this.pilot, this.aircraftGroup, this.loadedAircraft.object, this.loadedAircraft.id, this.chase.eye);
  }

  /** Pilot body: hands follow the stick/throttle, feet the pedals, torso the load factor. */
  animatePilot(drive: PilotDrive, dtS: number) {
    this.instruments.setControls(drive, dtS);
    this.pilot?.update({ ...drive, lookYaw: this.fpv ? 0 : THREE.MathUtils.clamp(this.chase.lookYaw * 0.6, -1, 1) }, dtS);
  }

  /** Short decaying camera-shake burst for impacts. */
  triggerImpactShake(magnitude: number, durationS = 0.4): void {
    this.chase.triggerShake(magnitude, durationS);
    this.pilot?.jolt(magnitude * 2);
  }

  /** Damage-system visual hook (src/sim/damageSystem.ts): tints a damaged part and hides
   * it once detached. `role` maps loosely onto the placeholder mesh set — 'wing' is the
   * single wing box, 'tail' is the horizontal+vertical stabilizer pair. */
  setPartVisualState(role: 'wing' | 'tail', damaged: boolean, detached: boolean): void {
    const meshes = new Set<THREE.Mesh>(role === 'wing' ? (this.wingMesh ? [this.wingMesh] : []) : this.tailMeshes);
    // The A0 hero model has named component meshes but bypasses the proxy refs above.
    // Tint those real surfaces too, so damage remains visible on the shipped aircraft.
    this.aircraftGroup.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (!mesh.isMesh) return;
      const name = mesh.name.toLowerCase();
      const matches = role === 'wing'
        ? name.includes('wing') || name.includes('aileron')
        : name.includes('tail') || name.includes('stabilizer') || name.includes('elevator') || name.includes('rudder');
      if (matches) meshes.add(mesh);
    });
    for (const mesh of meshes) {
      // Only hide a specific movable surface when the whole mapped role has failed;
      // retain the main lifting surface so a localized failure cannot erase a wing.
      const movable = /aileron|elevator|rudder/i.test(mesh.name);
      if (detached && movable) mesh.visible = false;
      else if (!detached && movable) mesh.visible = true;
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const material of mats) {
        const mat = material as THREE.MeshStandardMaterial;
        if (!mat?.emissive) continue;
        mat.emissive.set(damaged && !detached ? '#6f2517' : '#000000');
        mat.emissiveIntensity = damaged && !detached ? 0.34 : 0;
        if (damaged && !detached) mat.roughness = Math.max(mat.roughness, 0.82);
      }
    }
  }

  /** Builds a visible, localized tear at the latest damaged hard point and removes
   * only the actual failed control surface meshes from the A0 model. */
  setImpactDamage(zone: string | null | undefined, detachedIds: string[] = [], impactSpeedMs = 0, integrity: Record<string, number> = {}): void {
    const controlNames: Record<string, string[]> = {
      aileron_l: ['aileron_L'], aileron_r: ['aileron_R'], elevator: ['elevator'], rudder: ['rudder'], tail: ['elevator', 'rudder'],
    };
    // Critical-but-attached control surfaces hang bent off their hinge (wrong orientation).
    for (const [id, names] of Object.entries(controlNames)) {
      if ((integrity[id] ?? 1) >= 0.4 || detachedIds.includes(id)) continue;
      for (const name of names) {
        const part = this.aircraftGroup.getObjectByName(name);
        if (!part || part.userData.bent) continue;
        part.userData.bent = true;
        part.rotation.x += 0.35;
        part.rotation.z += name === 'rudder' ? 0.3 : 0.12;
      }
    }
    if (detachedIds.includes('propeller')) {
      for (const prop of this.propellerMeshes.splice(0)) {
        if (!prop.userData.releasedAsDebris) this.releasePart(prop, new THREE.Vector3(0.4, 0.8, 1), impactSpeedMs);
      }
    }
    for (const id of detachedIds) {
      for (const name of controlNames[id] ?? []) {
        const part = this.aircraftGroup.getObjectByName(name);
        if (part && !part.userData.releasedAsDebris) this.releasePart(part, new THREE.Vector3(0.15, 0.7, -0.3), impactSpeedMs);
      }
    }
    if (detachedIds.includes('__gear__')) {
      for (const name of ['wheel_nose', 'wheel_L', 'wheel_R']) {
        const wheel = this.aircraftGroup.getObjectByName(name);
        if (wheel && !wheel.userData.releasedAsDebris) this.releasePart(wheel, new THREE.Vector3(0, 0.25, -1), impactSpeedMs);
      }
    }
    if (!zone) return;
    const at = this.impactMarkPosition(zone);
    const onWing = zone === 'wingtipL' || zone === 'wingtipR';
    const size = (onWing ? 0.58 : zone === 'nose' || zone === 'tail' ? 0.4 : 0.48) * (1 + Math.min(0.8, Math.max(0, impactSpeedMs) / 20));
    const detachedAtZone = onWing
      ? detachedIds.some((id) => id.includes('wing') || id.includes('aileron'))
      : zone === 'tail' || zone === 'canopy'
        ? detachedIds.some((id) => id === 'elevator' || id === 'rudder' || id.startsWith('tail'))
        : detachedIds.some((id) => id === '__gear__' || id === 'gear');
    const detachWingtip = (target: THREE.Group): boolean => {
      if (!onWing) return false;
      if (target.userData.hasDetachedMesh) return true;
      const wingtip = this.aircraftGroup.getObjectByName(`wingtip_${zone === 'wingtipL' ? 'L' : 'R'}`);
      if (!wingtip || wingtip.userData.releasedAsDebris) return false;
      const side = zone === 'wingtipL' ? 1 : -1;
      this.releasePart(wingtip, new THREE.Vector3(side, 0.42, -0.15), impactSpeedMs);
      target.userData.hasDetachedMesh = true;
      return true;
    };
    const addShard = (target: THREE.Group) => {
      const shardShape = new THREE.Shape();
      shardShape.moveTo(-size * .42, -size * .2); shardShape.lineTo(-size * .08, -size * .27);
      shardShape.lineTo(size * .03, -size * .06); shardShape.lineTo(size * .46, -size * .1);
      shardShape.lineTo(size * .27, size * .04); shardShape.lineTo(size * .48, size * .22);
      shardShape.lineTo(size * .05, size * .15); shardShape.lineTo(-size * .16, size * .32); shardShape.closePath();
      const shardGeometry = new THREE.ExtrudeGeometry(shardShape, { depth: .035, bevelEnabled: true, bevelSize: .012, bevelThickness: .012, bevelSegments: 1 });
      shardGeometry.rotateX(-Math.PI / 2);
      const shard = new THREE.Mesh(shardGeometry, new THREE.MeshStandardMaterial({ color: '#b9a98b', roughness: 0.88, side: THREE.DoubleSide }));
      shard.position.set(onWing ? (zone === 'wingtipL' ? size * .75 : -size * .75) : size * .55, 0.11, -size * .18);
      shard.rotation.set(0.22, 0, zone === 'wingtipL' ? 0.16 : -0.16);
      target.add(shard);
    };
    const existingMark = this.damageMarks.get(zone);
    if (existingMark) {
      if (detachedAtZone && !detachWingtip(existingMark) && !existingMark.userData.hasDetachedShard) {
        addShard(existingMark);
        existingMark.userData.hasDetachedShard = true;
      }
      return;
    }
    const mark = new THREE.Group();
    mark.name = `fracture_${zone}`;
    mark.position.copy(at);
    // Irregular split seam pressed onto the aircraft skin, with a dark open gap and
    // bright exposed spar edge. This reads as a torn structure instead of a color tint.
    const shape = new THREE.Shape();
    shape.moveTo(-size, -size * 0.22); shape.lineTo(-size * 0.38, -size * 0.08);
    shape.lineTo(-size * 0.16, -size * 0.34); shape.lineTo(size * 0.1, -size * 0.04);
    shape.lineTo(size * 0.48, -size * 0.3); shape.lineTo(size, 0);
    shape.lineTo(size * 0.36, size * 0.08); shape.lineTo(size * 0.12, size * 0.37);
    shape.lineTo(-size * 0.1, size * 0.12); shape.lineTo(-size * 0.55, size * 0.32); shape.closePath();
    const tear = new THREE.Mesh(new THREE.ShapeGeometry(shape), new THREE.MeshBasicMaterial({ color: '#161719', side: THREE.DoubleSide, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }));
    tear.rotation.x = -Math.PI / 2;
    tear.position.y = 0.018;
    mark.add(tear);
    const spar = new THREE.Mesh(new THREE.BoxGeometry(size * 1.7, 0.035, 0.08), new THREE.MeshStandardMaterial({ color: '#b65d38', metalness: 0.35, roughness: 0.72 }));
    spar.position.set(0, 0.035, 0);
    spar.rotation.z = (zone === 'wingtipL' ? 1 : -1) * 0.3;
    mark.add(spar);
    if (detachedAtZone) {
      if (!detachWingtip(mark)) {
        addShard(mark);
        mark.userData.hasDetachedShard = true;
      }
    }
    this.aircraftGroup.add(mark);
    this.damageMarks.set(zone, mark);
  }

  private releasePart(mesh: THREE.Object3D, localDirection: THREE.Vector3, impactSpeedMs: number): void {
    this.scene.updateMatrixWorld(true);
    mesh.updateMatrixWorld(true);
    this.scene.attach(mesh);
    mesh.userData.releasedAsDebris = true;
    const direction = localDirection.normalize().applyQuaternion(this.aircraftGroup.quaternion).normalize();
    const kick = Math.min(13, 2.5 + Math.max(0, impactSpeedMs) * 0.42);
    this.debris.push({
      mesh,
      velocity: direction.multiplyScalar(kick).add(new THREE.Vector3(0, 1.5, 0)),
      spin: new THREE.Vector3(1.8, 2.4, 1.2).multiplyScalar(Math.min(1.7, 0.55 + impactSpeedMs * 0.035)),
      ageS: 0,
    });
  }

  /** Low-poly impact particles at a hard point: tan dust for ground/soft hits, bright sparks
   * for fast metal-on-ground scrapes. Additive points, aged out in ~1 s. */
  spawnImpactBurst(zone: string, kind: 'dust' | 'sparks', intensity: number): void {
    const n = Math.round(12 + 40 * Math.min(1, intensity));
    const pos = new Float32Array(n * 3);
    const vel = new Float32Array(n * 3);
    const origin = this.aircraftGroup.localToWorld(this.impactMarkPosition(zone));
    const spread = kind === 'sparks' ? 7 : 2.5;
    for (let i = 0; i < n; i++) {
      pos.set([origin.x, origin.y, origin.z], i * 3);
      vel.set([(Math.random() - 0.5) * spread, Math.random() * spread * 0.7 + 0.5, (Math.random() - 0.5) * spread], i * 3);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const mat = new THREE.PointsMaterial({
      color: kind === 'sparks' ? '#ffc46b' : '#b8a27c', size: kind === 'sparks' ? 0.09 : 0.45,
      transparent: true, opacity: kind === 'sparks' ? 1 : 0.55, depthWrite: false,
      blending: kind === 'sparks' ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    const points = new THREE.Points(geo, mat);
    this.scene.add(points);
    this.bursts.push({ points, vel, ageS: 0 });
  }

  private updateBursts(dtS: number): void {
    const dt = Math.max(0, Math.min(0.1, Number.isFinite(dtS) ? dtS : 0));
    for (let i = this.bursts.length - 1; i >= 0; i--) {
      const b = this.bursts[i];
      b.ageS += dt;
      const attr = b.points.geometry.getAttribute('position') as THREE.BufferAttribute;
      const p = attr.array as Float32Array;
      for (let j = 0; j < p.length; j += 3) {
        b.vel[j + 1] -= 3 * dt;
        p[j] += b.vel[j] * dt; p[j + 1] += b.vel[j + 1] * dt; p[j + 2] += b.vel[j + 2] * dt;
      }
      attr.needsUpdate = true;
      const mat = b.points.material as THREE.PointsMaterial;
      mat.opacity *= 1 - Math.min(1, dt * 2.2);
      if (b.ageS > 1.4) {
        this.scene.remove(b.points);
        b.points.geometry.dispose();
        mat.dispose();
        this.bursts.splice(i, 1);
      }
    }
  }

  private updateDebris(dtS: number): void {
    const dt = Math.max(0, Math.min(0.1, Number.isFinite(dtS) ? dtS : 0));
    for (let i = this.debris.length - 1; i >= 0; i--) {
      const piece = this.debris[i];
      piece.ageS += dt;
      piece.velocity.y -= 9.81 * dt;
      piece.mesh.position.addScaledVector(piece.velocity, dt);
      piece.mesh.rotation.x += piece.spin.x * dt;
      piece.mesh.rotation.y += piece.spin.y * dt;
      piece.mesh.rotation.z += piece.spin.z * dt;
      if (piece.ageS >= 5 || piece.mesh.position.y < -20) {
        this.scene.remove(piece.mesh);
        this.debris.splice(i, 1);
      }
    }
  }

  private impactMarkPosition(zone: string): THREE.Vector3 {
    switch (zone) {
      case 'wingtipL': return new THREE.Vector3(5.15, 2.28, 0.28);
      case 'wingtipR': return new THREE.Vector3(-5.15, 2.28, 0.28);
      case 'nose': return new THREE.Vector3(0, 1.15, 3.05);
      case 'tail': return new THREE.Vector3(0, 1.65, -3.15);
      case 'canopy': return new THREE.Vector3(0, 2.8, -0.6);
      case 'bellyFront': return new THREE.Vector3(0, 0.42, 1.25);
      case 'bellyRear': return new THREE.Vector3(0, 0.55, -1.45);
      case 'gear': return new THREE.Vector3(0, 0.55, -0.35);
      default: return new THREE.Vector3(0, 1.4, 0);
    }
  }

  resize(width: number, height: number) {
    this.chase.resize(width, height);
    this.renderer.setSize(width, height, false);
    this.post?.setSize(width, height);
  }

  render() {
    // ponytail: periodic sweep catches async-hydrated props/tiles; styled materials are memoised so it is a cheap walk.
    if (this.styleSweepFrame++ % 120 === 0) applyLowPolyStyle(this.scene, this.aircraftGroup);
    this.fieldWorld?.update(this.camera.position);
    this.atmosphere.update(this.aircraftGroup.visible ? this.aircraftGroup.position : this.camera.position);
    if (this.post) this.post.render(); else this.renderer.render(this.scene, this.camera);
  }

  /** Advances presentation-only environmental cues.  Flight forces are updated in
   * FlightScreen from the same deterministic air-state, keeping render and sim aligned. */
  updateEnvironment(elapsedS: number, wind: THREE.Vector3) {
    this.environment.update(elapsedS, wind);
    this.clouds.update(Math.min(0.1, Math.max(0, elapsedS - this.lastEnvS)), wind, this.camera.position);
    this.lastEnvS = elapsedS;
    updateWater(elapsedS);
    this.ambientNpcs?.update(elapsedS);
    if (this.targetMarker) {
      const pulse = 0.64 + Math.sin(elapsedS * 3.4) * 0.18;
      for (const material of this.targetPulseMaterials) material.opacity = pulse;
      this.targetMarker.rotation.y = elapsedS * 0.12;
    }
  }

  dispose() {
    this.instruments.dispose();
    this.fieldWorld?.dispose();
    this.atmosphere.dispose();
    this.clouds.dispose();
    this.post?.dispose();
    this.ambientNpcs?.dispose();
    // Three.js does not dispose scene-owned GPU resources automatically. Keep this
    // explicit because mobile players can enter/exit many flight sessions in one app run.
    const geometries = new Set<THREE.BufferGeometry>();
    const materials = new Set<THREE.Material>();
    this.scene.traverse((object) => {
      const renderable = object as THREE.Object3D & {
        geometry?: THREE.BufferGeometry;
        material?: THREE.Material | THREE.Material[];
      };
      if (renderable.geometry) geometries.add(renderable.geometry);
      if (Array.isArray(renderable.material)) {
        for (const material of renderable.material) materials.add(material);
      } else if (renderable.material) {
        materials.add(renderable.material);
      }
    });
    for (const geometry of geometries) geometry.dispose();
    for (const material of materials) material.dispose();
    this.renderer.renderLists.dispose();
    this.renderer.dispose();
  }
}

/** Low-poly palm crown: 7 drooping fronds (two triangles each) radiating from the top, unit radius. */
function palmCrownGeometry(): THREE.BufferGeometry {
  const pos: number[] = [], fronds = 7;
  for (let i = 0; i < fronds; i++) {
    const a = (i / fronds) * Math.PI * 2 + (i % 2) * 0.2, w = 0.16;
    const dir = (r: number, off: number): [number, number] => [Math.cos(a + off) * r, Math.sin(a + off) * r];
    const [mx, mz] = dir(0.55, 0), [lx, lz] = dir(0.5, w), [rx, rz] = dir(0.5, -w), [tx, tz] = dir(1, 0);
    // centre -> mid ridge (raised) -> drooping tip, widened at mid
    pos.push(0, 0.1, 0, lx, 0.12, lz, mx, 0.2, mz, 0, 0.1, 0, mx, 0.2, mz, rx, 0.12, rz);
    pos.push(lx, 0.12, lz, tx, -0.35, tz, mx, 0.2, mz, mx, 0.2, mz, tx, -0.35, tz, rx, 0.12, rz);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}
