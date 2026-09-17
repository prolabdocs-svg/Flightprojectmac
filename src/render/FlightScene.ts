// Vanilla Three.js scene for the flight view. React only owns UI/menus (spec 31.1);
// the 3D scene graph is managed imperatively here for performance on mobile GPUs.

import * as THREE from 'three';
import type { RegionDefinition } from '../core/types';
import { WorldEnvironment } from './WorldEnvironment';
import { createSeededRandom, type SeededRandom } from '../core/seededRandom';
import { assetLibrary } from './assetLibrary';
import { ACTIVE_REGION_ASSETS, FRAME_ASSET_IDS } from './assetManifest';
import { ChaseCamera, type ChaseCameraInput } from './ChaseCamera';
import { getFreeFlightAirfield, type RunwaySurface } from '../world/airfields';

export class FlightScene {
  scene = new THREE.Scene();
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  aircraftGroup = new THREE.Group();
  private readonly streamedProps = new THREE.Group();
  private targetRing: THREE.Mesh | null = null;
  private readonly chase = new ChaseCamera();
  private readonly environment: WorldEnvironment;

  // Damage-system hooks (src/sim/damageSystem.ts via FlightController): named refs to the
  // placeholder meshes that stand in for "wing" and "tail" so a detach/damage event can
  // hide or re-tint them without the damage system knowing anything about Three.js.
  private wingMesh: THREE.Mesh | null = null;
  private tailMeshes: THREE.Mesh[] = [];
  private propellerMeshes: THREE.Mesh[] = [];
  // Deterministic PRNG for procedural landmark placement (trees, scrap piles), seeded
  // from the region id so the same region always generates the same layout across
  // sessions (see src/core/seededRandom.ts).
  private readonly worldRng: SeededRandom;

  constructor(canvas: HTMLCanvasElement, region: RegionDefinition, paint?: { fabricColor: string; tubeColor: string }) {
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

    // Sky/fog: a soft gradient feel via a lighter fog color than the sky base so
    // the horizon hazes out instead of hard-cutting (spec 82: "Stylized tactile
    // realism" — real-feeling atmosphere, simplified for mobile clarity, not
    // photoreal). Fog color is blended toward white to read as sunlit haze.
    const skyColor = new THREE.Color(region.skyColor);
    const fogColor = skyColor.clone().lerp(new THREE.Color('#ffffff'), 0.18);
    this.scene.background = skyColor;
    // Keep nearby terrain and navigation anchors readable; haze belongs on the distant
    // ridge layers, not across the first kilometre of a flight scene.
    this.scene.fog = new THREE.Fog(fogColor, 700, 3200);

    // Lighting: warm low-angle "workshop afternoon" key light + cool sky fill,
    // matching the DIY-garage/golden-hour mood (spec 10 tono, 83.1) rather than
    // flat/neutral default lighting. Hemisphere gives believable sky/ground
    // bounce; directional sun casts no shadow (perf budget, mobile) but its warm
    // tint plus a small cool rim light keep the primitives from reading as
    // untextured gray shapes.
    const hemi = new THREE.HemisphereLight(0xcfe6ff, 0x40381f, 0.85);
    this.scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xffdca8, 1.75);
    sun.position.set(260, 340, 120);
    sun.castShadow = true;
    sun.shadow.mapSize.set(lowPowerMobile ? 512 : 1024, lowPowerMobile ? 512 : 1024);
    sun.shadow.camera.left = -70;
    sun.shadow.camera.right = 70;
    sun.shadow.camera.top = 70;
    sun.shadow.camera.bottom = -70;
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = 500;
    sun.shadow.bias = -0.0002;
    this.scene.add(sun);
    const rim = new THREE.DirectionalLight(0x9fc7ff, 0.35);
    rim.position.set(-220, 160, -260);
    this.scene.add(rim);
    const ambient = new THREE.AmbientLight(0x33302a, 0.25);
    this.scene.add(ambient);

    this.environment = new WorldEnvironment(region);
    this.scene.add(this.environment.root);

    // The visual runway must occupy the same graded airport pad as physics and spawn
    // logic. The previous fixed y=0 strip was buried by the terrain in the first
    // playable region, leaving players to begin on an apparently random field.
    const airfield = getFreeFlightAirfield(region.id);
    const runwayCenter: [number, number] = airfield ? [airfield.position[0], airfield.position[2]] : [0, 0];
    const runwayWidth = airfield?.runwayWidthM ?? 24;
    const runwayLength = airfield?.runwayLengthM ?? 220;
    const runwayY = this.environment.terrainQuery.getElevation(...runwayCenter);
    const runwayGeo = new THREE.PlaneGeometry(runwayWidth, runwayLength);
    const runwayMat = new THREE.MeshStandardMaterial({ color: this.runwayColor(airfield?.surface), roughness: 0.9, metalness: 0.03 });
    const runway = new THREE.Mesh(runwayGeo, runwayMat);
    runway.rotation.x = -Math.PI / 2;
    runway.position.set(runwayCenter[0], runwayY + 0.025, runwayCenter[1]);
    runway.receiveShadow = true;
    this.scene.add(runway);
    this.addRunwayDressings(runwayCenter, runwayY, runwayWidth, runwayLength, airfield?.surface);

    // Landmarks: region-specific, so the world isn't a flat void (spec 12.2/12.3).
    if (region.environment.terrain === 'quarry') {
      this.buildScrapValleyLandmarks();
    } else if (region.environment.terrain === 'meadow') {
      this.buildTheFieldLandmarks();
    } else {
      this.buildTerrainLandmarks(region.environment.terrain);
    }

    // Keep a first-frame proxy while the GLB streams, then replace it with the
    // authored airframe already shipped with the game.
    this.buildAircraftPlaceholder(paint);
    this.aircraftGroup.visible = false;
    this.scene.add(this.aircraftGroup);
    this.scene.add(this.streamedProps);
    // Loading is deliberately non-blocking. The authored proxy is visible on the first
    // frame; GLB swaps in only when it has arrived, which is essential on mobile/PWA.
    void this.hydrateRuntimeAssets(region, paint);
  }

  private async hydrateRuntimeAssets(region: RegionDefinition, paint?: { fabricColor: string; tubeColor: string }) {
    void this.hydrateAircraft(FRAME_ASSET_IDS.frame_zero, paint);

    const placements = ACTIVE_REGION_ASSETS[region.id];
    if (!placements) return;
    await Promise.all(placements.map(async ({ id, position: [x, z], scale = 1, rotationY = 0 }) => {
      try {
        const prop = await assetLibrary.load('world', id);
        prop.position.set(x, this.environment.terrainQuery.getElevation(x, z), z);
        prop.scale.setScalar(scale);
        prop.rotation.y = rotationY;
        this.streamedProps.add(prop);
      } catch {
        // Existing procedural landmarks are the graceful fallback for every prop.
      }
    }));
  }

  /** Replaces the loading proxy with the authored, mobile-ready starter airframe. */
  private async hydrateAircraft(id: string, paint?: { fabricColor: string; tubeColor: string }) {
    try {
      const aircraft = await assetLibrary.load('airframe', id);
      // Blender exports Z-up while this flight scene uses Three's Y-up / +Z-forward
      // convention. The authored airframe was therefore arriving with its fuselage
      // upright like a mast. One root correction preserves the Blender asset's axes
      // without baking a duplicate or touching its named child meshes.
      aircraft.rotation.x = Math.PI / 2;
      aircraft.traverse((object) => {
        const mesh = object as THREE.Mesh;
        if (mesh.isMesh) {
          mesh.castShadow = true;
          mesh.receiveShadow = true;
          const color = mesh.name.includes('wing') || mesh.name.includes('aileron') || mesh.name.includes('stabilizer') || mesh.name === 'elevator' || mesh.name === 'rudder'
            ? paint?.fabricColor : mesh.name.includes('longeron') || mesh.name.includes('strut') || mesh.name.includes('brace') || mesh.name.includes('cross')
              ? paint?.tubeColor : undefined;
          if (color) {
            for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
              const standard = material as THREE.MeshStandardMaterial;
              if (standard.color) standard.color.set(color);
            }
          }
        }
      });
      this.aircraftGroup.clear();
      this.wingMesh = null;
      this.tailMeshes = [];
      this.propellerMeshes = [];
      aircraft.traverse((object) => {
        const mesh = object as THREE.Mesh;
        if (!mesh.isMesh) return;
        if (mesh.name === 'main_wing' || mesh.name === 'wing_panel_L') this.wingMesh = mesh;
        if (mesh.name === 'horizontal_tail' || mesh.name === 'vertical_tail' || mesh.name === 'horizontal_stabilizer' || mesh.name === 'vertical_stabilizer') this.tailMeshes.push(mesh);
        if (mesh.name.includes('propeller') || mesh.name.includes('prop_blade')) this.propellerMeshes.push(mesh);
      });
      this.aircraftGroup.add(aircraft);
      this.aircraftGroup.visible = true;
    } catch {
      // The proxy remains a resilient offline fallback for a failed asset request.
      this.aircraftGroup.visible = true;
    }
  }

  /** Lightweight kits for the six later campaign regions. Each uses a handful of
   * instanced/simple meshes, keeping their silhouette and navigation language distinct
   * without turning free flight into a mobile draw-call stress test. */
  private buildTerrainLandmarks(terrain: RegionDefinition['environment']['terrain']) {
    const ground = (x: number, z: number) => this.environment.terrainQuery.getElevation(x, z);
    const rockMat = new THREE.MeshStandardMaterial({ color: '#96593d', roughness: .95 });
    const greenMat = new THREE.MeshStandardMaterial({ color: '#365d3a', roughness: .9 });
    const concreteMat = new THREE.MeshStandardMaterial({ color: '#69706d', roughness: .8, metalness: .15 });
    const sandMat = new THREE.MeshStandardMaterial({ color: '#b99864', roughness: 1 });

    if (terrain === 'canyon') {
      const mesas = new THREE.InstancedMesh(new THREE.CylinderGeometry(1, 1.25, 1, 7), rockMat, 18);
      const matrix = new THREE.Matrix4();
      for (let i = 0; i < 18; i++) {
        const angle = i * 2.399, dist = 140 + (i % 5) * 105;
        const x = Math.cos(angle) * dist, z = 260 + Math.sin(angle) * dist;
        const h = 45 + (i % 4) * 24, radius = 18 + (i % 3) * 11;
        matrix.compose(new THREE.Vector3(x, ground(x, z) + h / 2, z), new THREE.Quaternion(), new THREE.Vector3(radius, h, radius));
        mesas.setMatrixAt(i, matrix);
      }
      mesas.instanceMatrix.needsUpdate = true;
      this.scene.add(mesas);
      return;
    }

    if (terrain === 'forest' || terrain === 'range') {
      const count = terrain === 'forest' ? 115 : 64;
      const trees = new THREE.InstancedMesh(new THREE.ConeGeometry(2.8, terrain === 'forest' ? 15 : 20, 7), greenMat, count);
      const matrix = new THREE.Matrix4();
      for (let i = 0; i < count; i++) {
        const angle = i * 2.399, dist = 80 + (i % 12) * 55;
        const x = Math.cos(angle) * dist, z = 220 + Math.sin(angle) * dist;
        const scale = .75 + (i % 5) * .14;
        matrix.compose(new THREE.Vector3(x, ground(x, z) + 7 * scale, z), new THREE.Quaternion(), new THREE.Vector3(scale, scale, scale));
        trees.setMatrixAt(i, matrix);
      }
      trees.instanceMatrix.needsUpdate = true;
      this.scene.add(trees);
      if (terrain === 'range') {
        const peak = new THREE.Mesh(new THREE.ConeGeometry(120, 310, 7), new THREE.MeshStandardMaterial({ color: '#70766d', roughness: 1 }));
        peak.position.set(-340, ground(-340, 720) + 155, 720);
        this.scene.add(peak);
      }
      return;
    }

    if (terrain === 'coast') {
      const cliff = new THREE.Mesh(new THREE.BoxGeometry(420, 95, 55), rockMat);
      cliff.position.set(-210, ground(-210, 410) + 47, 410);
      this.scene.add(cliff);
      const palms = new THREE.InstancedMesh(new THREE.CylinderGeometry(.24, .42, 1, 6), new THREE.MeshStandardMaterial({ color: '#6f5335', roughness: 1 }), 22);
      const matrix = new THREE.Matrix4();
      for (let i = 0; i < 22; i++) {
        const x = -90 + i * 16, z = 180 + (i % 4) * 95, h = 9 + (i % 3) * 3;
        matrix.compose(new THREE.Vector3(x, ground(x, z) + h / 2, z), new THREE.Quaternion(), new THREE.Vector3(1, h, 1));
        palms.setMatrixAt(i, matrix);
      }
      palms.instanceMatrix.needsUpdate = true;
      this.scene.add(palms);
      return;
    }

    if (terrain === 'industrial') {
      for (let i = 0; i < 7; i++) {
        const x = -145 + i * 52, z = 280 + (i % 2) * 85, h = 22 + (i % 3) * 12;
        const warehouse = new THREE.Mesh(new THREE.BoxGeometry(42, h, 55), concreteMat);
        warehouse.position.set(x, ground(x, z) + h / 2, z);
        this.scene.add(warehouse);
      }
      const stack = new THREE.Mesh(new THREE.CylinderGeometry(4, 5, 95, 10), new THREE.MeshStandardMaterial({ color: '#7f5341', roughness: .85 }));
      stack.position.set(115, ground(115, 330) + 47.5, 330);
      this.scene.add(stack);
      return;
    }

    if (terrain === 'desert') {
      const hangar = new THREE.Mesh(new THREE.BoxGeometry(86, 25, 68), sandMat);
      hangar.position.set(-80, ground(-80, 250) + 12.5, 250);
      this.scene.add(hangar);
      const tower = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 3.6, 125, 8), concreteMat);
      tower.position.set(130, ground(130, 440) + 62.5, 440);
      this.scene.add(tower);
    }
  }

  /** Region 1 landmarks (spec 12.2): barn, water tower, scattered trees.
   * Materials given intentional roughness/metalness so they don't read as flat
   * default-gray primitives — weathered wood barn, galvanized-steel tower. */
  private buildTheFieldLandmarks() {
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
      const roof = new THREE.Mesh(new THREE.BoxGeometry(7.4, .36, 17.1), roofMat); roof.position.set(x, 8.1, 0); roof.rotation.z = x < 0 ? -.36 : .36; roof.castShadow = true; barn.add(roof);
    }
    const door = new THREE.Mesh(new THREE.PlaneGeometry(4.4, 4.6), new THREE.MeshStandardMaterial({ color: '#263130', roughness: .9 })); door.position.set(0, 2.55, 8.04); barn.add(door);
    for (const x of [-5.7, 5.7]) { const trim = new THREE.Mesh(new THREE.BoxGeometry(.28, 8, .3), trimMat); trim.position.set(x, 4, 8.14); barn.add(trim); }
    const apron = new THREE.Mesh(new THREE.PlaneGeometry(23, 19), new THREE.MeshStandardMaterial({ color: '#7e7057', roughness: 1 })); apron.rotation.x = -Math.PI / 2; apron.position.set(0, .015, 11); apron.receiveShadow = true; barn.add(apron);
    this.scene.add(barn);

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

    const treeMat = new THREE.MeshStandardMaterial({ color: '#3f6b34', roughness: 0.9, metalness: 0 });
    // One draw call for the repeated vegetation instead of one per tree (GDD §41.4).
    const trees = new THREE.InstancedMesh(new THREE.ConeGeometry(2.8, 9, 6), treeMat, 40);
    const treeMatrix = new THREE.Matrix4();
    for (let i = 0; i < 40; i++) {
      const { x, z } = this.placeOffRunway(() => {
        const angle = this.worldRng.next() * Math.PI * 2;
        const dist = 80 + this.worldRng.next() * 500;
        return { x: Math.cos(angle) * dist, z: 150 + Math.sin(angle) * dist };
      });
      const scale = 0.8 + this.worldRng.next() * 0.4;
      // Sampled from TerrainQueryService so trees sit on the now-undulating ground
      // instead of floating/clipping on a flat Y=0 assumption.
      const groundY = this.environment.terrainQuery.getElevation(x, z);
      treeMatrix.compose(new THREE.Vector3(x, groundY + 4.5 * scale, z), new THREE.Quaternion(), new THREE.Vector3(scale, scale, scale));
      trees.setMatrixAt(i, treeMatrix);
    }
    trees.instanceMatrix.needsUpdate = true;
    this.scene.add(trees);

    // A sparse fence line and hay bales make the near field feel owned and scaled.
    const postMat = new THREE.MeshStandardMaterial({ color: '#695238', roughness: 1 });
    const postGeo = new THREE.CylinderGeometry(.09, .11, 1.3, 5);
    for (let i = 0; i < 18; i++) {
      const x = -95 + i * 11, z = 56;
      if (this.environment.terrainQuery.isOnGradedRunway(x, z)) continue;
      const post = new THREE.Mesh(postGeo, postMat); post.position.set(x, this.environment.terrainQuery.getElevation(x, z) + .65, z); this.scene.add(post);
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

  private addRunwayDressings(center: readonly [number, number], runwayY: number, width: number, length: number, surface?: RunwaySurface) {
    const markingMat = new THREE.MeshBasicMaterial({ color: '#e9e2ca' });
    const shouldMark = surface === 'tarmac' || surface === 'salt';
    for (let z = -length / 2 + 18; shouldMark && z < length / 2 - 10; z += 30) {
      const dash = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 12), markingMat);
      dash.rotation.x = -Math.PI / 2;
      dash.position.set(center[0], runwayY + .04, center[1] + z);
      this.scene.add(dash);
    }
    const edgeMat = new THREE.MeshBasicMaterial({ color: '#d99642' });
    for (const x of [-width / 2 + .7, width / 2 - .7]) {
      for (let z = -length / 2 + 8; z <= length / 2 - 8; z += 22) {
        const marker = new THREE.Mesh(new THREE.BoxGeometry(.22, .55, .22), edgeMat);
        marker.position.set(center[0] + x, runwayY + .28, center[1] + z); this.scene.add(marker);
      }
    }
  }

  setTargetMarker(pos: [number, number, number] | undefined, radiusM: number) {
    if (this.targetRing) {
      this.scene.remove(this.targetRing);
      this.targetRing = null;
    }
    if (!pos) return;
    const geo = new THREE.RingGeometry(radiusM * 0.92, radiusM, 32);
    const mat = new THREE.MeshBasicMaterial({ color: '#ffcc33', side: THREE.DoubleSide, transparent: true, opacity: 0.8 });
    const ring = new THREE.Mesh(geo, mat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(pos[0], this.environment.terrainQuery.getElevation(pos[0], pos[2]) + 0.05, pos[2]);
    this.targetRing = ring;
    this.scene.add(ring);
  }

  syncAircraft(position: THREE.Vector3, quaternion: THREE.Quaternion, dtS: number, cam: ChaseCameraInput) {
    this.aircraftGroup.position.copy(position);
    this.aircraftGroup.quaternion.copy(quaternion);
    for (const propeller of this.propellerMeshes) propeller.rotation.z += dtS * (42 + cam.speedMs * 9);
    this.chase.update(position, quaternion, dtS, cam);
  }

  /** Short decaying camera-shake burst for impacts. */
  triggerImpactShake(magnitude: number, durationS = 0.4): void {
    this.chase.triggerShake(magnitude, durationS);
  }

  /** Damage-system visual hook (src/sim/damageSystem.ts): tints a damaged part and hides
   * it once detached. `role` maps loosely onto the placeholder mesh set — 'wing' is the
   * single wing box, 'tail' is the horizontal+vertical stabilizer pair. */
  setPartVisualState(role: 'wing' | 'tail', damaged: boolean, detached: boolean): void {
    const meshes = role === 'wing' ? (this.wingMesh ? [this.wingMesh] : []) : this.tailMeshes;
    for (const mesh of meshes) {
      mesh.visible = !detached;
      const mat = mesh.material as THREE.MeshStandardMaterial;
      if (!mat) continue;
      mat.emissive = new THREE.Color(damaged && !detached ? '#3a0e0e' : '#000000');
      mat.emissiveIntensity = damaged && !detached ? 0.6 : 0;
    }
  }

  resize(width: number, height: number) {
    this.chase.resize(width, height);
    this.renderer.setSize(width, height, false);
  }

  render() {
    this.renderer.render(this.scene, this.camera);
  }

  /** Advances presentation-only environmental cues.  Flight forces are updated in
   * FlightScreen from the same deterministic air-state, keeping render and sim aligned. */
  updateEnvironment(elapsedS: number, wind: THREE.Vector3) {
    this.environment.update(elapsedS, wind);
  }

  dispose() {
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
