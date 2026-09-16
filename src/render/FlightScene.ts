// Vanilla Three.js scene for the flight view. React only owns UI/menus (spec 31.1);
// the 3D scene graph is managed imperatively here for performance on mobile GPUs.

import * as THREE from 'three';
import type { RegionDefinition } from '../core/types';
import { WorldEnvironment } from './WorldEnvironment';

export class FlightScene {
  scene = new THREE.Scene();
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  aircraftGroup = new THREE.Group();
  private targetRing: THREE.Mesh | null = null;
  private cameraLookTarget = new THREE.Vector3();
  private cameraPos = new THREE.Vector3(0, 6, 15);
  private shakeTimeRemainingS = 0;
  private shakeMagnitude = 0;
  private readonly environment: WorldEnvironment;
  // Scratch vectors reused every frame in syncAircraft() to avoid per-frame GC churn.
  private readonly scratchBehind = new THREE.Vector3();
  private readonly scratchDesiredPos = new THREE.Vector3();
  private readonly scratchAhead = new THREE.Vector3();
  private readonly scratchDesiredLook = new THREE.Vector3();
  private readonly scratchShake = new THREE.Vector3();

  // Damage-system hooks (src/sim/damageSystem.ts via FlightController): named refs to the
  // placeholder meshes that stand in for "wing" and "tail" so a detach/damage event can
  // hide or re-tint them without the damage system knowing anything about Three.js.
  private wingMesh: THREE.Mesh | null = null;
  private tailMeshes: THREE.Mesh[] = [];

  constructor(canvas: HTMLCanvasElement, region: RegionDefinition, paint?: { fabricColor: string; tubeColor: string }) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = false;

    this.camera = new THREE.PerspectiveCamera(62, 1, 0.1, 6000);

    // Sky/fog: a soft gradient feel via a lighter fog color than the sky base so
    // the horizon hazes out instead of hard-cutting (spec 82: "Stylized tactile
    // realism" — real-feeling atmosphere, simplified for mobile clarity, not
    // photoreal). Fog color is blended toward white to read as sunlit haze.
    const skyColor = new THREE.Color(region.skyColor);
    const fogColor = skyColor.clone().lerp(new THREE.Color('#ffffff'), 0.18);
    this.scene.background = skyColor;
    this.scene.fog = new THREE.Fog(fogColor, 380, 2400);

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
    this.scene.add(sun);
    const rim = new THREE.DirectionalLight(0x9fc7ff, 0.35);
    rim.position.set(-220, 160, -260);
    this.scene.add(rim);
    const ambient = new THREE.AmbientLight(0x33302a, 0.25);
    this.scene.add(ambient);

    this.environment = new WorldEnvironment(region);
    this.scene.add(this.environment.root);

    // Simple runway strip
    const runwayGeo = new THREE.PlaneGeometry(24, 400);
    const runwayMat = new THREE.MeshStandardMaterial({ color: '#8f8a76', roughness: 0.9, metalness: 0.05 });
    const runway = new THREE.Mesh(runwayGeo, runwayMat);
    runway.rotation.x = -Math.PI / 2;
    runway.position.set(0, 0.02, 150);
    this.scene.add(runway);

    // Landmarks: region-specific, so the world isn't a flat void (spec 12.2/12.3).
    if (region.id === 'scrap_valley') {
      this.buildScrapValleyLandmarks();
    } else {
      this.buildTheFieldLandmarks();
    }

    this.buildAircraftPlaceholder(paint);
    this.scene.add(this.aircraftGroup);
  }

  /** Region 1 landmarks (spec 12.2): barn, water tower, scattered trees.
   * Materials given intentional roughness/metalness so they don't read as flat
   * default-gray primitives — weathered wood barn, galvanized-steel tower. */
  private buildTheFieldLandmarks() {
    const barn = new THREE.Mesh(
      new THREE.BoxGeometry(14, 10, 18),
      new THREE.MeshStandardMaterial({ color: '#8c3b32', roughness: 0.85, metalness: 0.05 }),
    );
    barn.position.set(-40, 5, 20);
    this.scene.add(barn);

    const towerMat = new THREE.MeshStandardMaterial({ color: '#9b9b9b', roughness: 0.55, metalness: 0.5 });
    const towerBase = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.2, 14, 8), towerMat);
    towerBase.position.set(35, 7, 260);
    this.scene.add(towerBase);
    const towerTank = new THREE.Mesh(
      new THREE.CylinderGeometry(6, 6, 6, 12),
      new THREE.MeshStandardMaterial({ color: '#b7b7a8', roughness: 0.6, metalness: 0.45 }),
    );
    towerTank.position.set(35, 17, 260);
    this.scene.add(towerTank);

    const treeMat = new THREE.MeshStandardMaterial({ color: '#3f6b34', roughness: 0.9, metalness: 0 });
    for (let i = 0; i < 40; i++) {
      const tree = new THREE.Mesh(new THREE.ConeGeometry(2.2 + Math.random(), 7 + Math.random() * 3, 6), treeMat);
      const angle = Math.random() * Math.PI * 2;
      const dist = 80 + Math.random() * 500;
      tree.position.set(Math.cos(angle) * dist, 3.5, 150 + Math.sin(angle) * dist);
      this.scene.add(tree);
    }
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
    craneGroup.position.set(-25, 0, 300);
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
      const boxCount = 2 + Math.floor(Math.random() * 3);
      for (let b = 0; b < boxCount; b++) {
        const size = 1.5 + Math.random() * 2.5;
        const box = new THREE.Mesh(new THREE.BoxGeometry(size, size * 0.7, size), Math.random() > 0.5 ? scrapMat : rustMat);
        box.position.set((Math.random() - 0.5) * 3, size * 0.35 * (b + 1), (Math.random() - 0.5) * 3);
        box.rotation.y = Math.random() * Math.PI;
        pileGroup.add(box);
      }
      const angle = Math.random() * Math.PI * 2;
      const dist = 60 + Math.random() * 480;
      pileGroup.position.set(Math.cos(angle) * dist, 0, 150 + Math.sin(angle) * dist);
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
      const pole = new THREE.Mesh(poleGeo, poleMat);
      pole.position.set(x, 9, z);
      this.scene.add(pole);
      const top = new THREE.Vector3(x, 17.5, z);
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
    const tubeMat = new THREE.MeshStandardMaterial({ color: paint?.tubeColor ?? '#b8b2a4', metalness: 0.55, roughness: 0.42 });
    const fabricMat = new THREE.MeshStandardMaterial({ color: paint?.fabricColor ?? '#d8cf9a', side: THREE.DoubleSide, roughness: 0.85, metalness: 0.02 });
    const engineMat = new THREE.MeshStandardMaterial({ color: '#3a372f', roughness: 0.4, metalness: 0.7 });
    const wheelMat = new THREE.MeshStandardMaterial({ color: '#1c1c1c', roughness: 0.75, metalness: 0.1 });

    const fuselage = new THREE.Mesh(new THREE.CapsuleGeometry(0.5, 4.2, 4, 8), tubeMat);
    fuselage.rotation.x = Math.PI / 2;
    this.aircraftGroup.add(fuselage);

    const wing = new THREE.Mesh(new THREE.BoxGeometry(9, 0.12, 1.4), fabricMat);
    wing.position.set(0, 0.3, 0);
    this.aircraftGroup.add(wing);
    this.wingMesh = wing;

    const tailBoom = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 3.2, 6), tubeMat);
    tailBoom.rotation.x = Math.PI / 2;
    tailBoom.position.set(0, 0.3, -3.6);
    this.aircraftGroup.add(tailBoom);

    const hStab = new THREE.Mesh(new THREE.BoxGeometry(3, 0.08, 0.6), fabricMat);
    hStab.position.set(0, 0.4, -4.4);
    this.aircraftGroup.add(hStab);
    this.tailMeshes.push(hStab);

    const vStab = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.2, 0.7), fabricMat);
    vStab.position.set(0, 0.9, -4.4);
    this.aircraftGroup.add(vStab);
    this.tailMeshes.push(vStab);

    const engine = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 0.6, 10), engineMat);
    engine.rotation.x = Math.PI / 2;
    engine.position.set(0, 0, 2.1);
    this.aircraftGroup.add(engine);

    const prop = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.08, 0.1), engineMat);
    prop.position.set(0, 0, 2.45);
    this.aircraftGroup.add(prop);

    for (const x of [-1.1, 1.1]) {
      const wheel = new THREE.Mesh(new THREE.TorusGeometry(0.4, 0.14, 8, 16), wheelMat);
      wheel.position.set(x, -0.9, 0.4);
      this.aircraftGroup.add(wheel);
      const strut = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.9, 6), tubeMat);
      strut.position.set(x, -0.5, 0.4);
      this.aircraftGroup.add(strut);
    }
    const noseWheel = new THREE.Mesh(new THREE.TorusGeometry(0.28, 0.1, 8, 16), wheelMat);
    noseWheel.position.set(0, -0.7, 1.8);
    this.aircraftGroup.add(noseWheel);
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
    ring.position.set(pos[0], 0.05, pos[2]);
    this.targetRing = ring;
    this.scene.add(ring);
  }

  syncAircraft(position: THREE.Vector3, quaternion: THREE.Quaternion, dtS = 1 / 60) {
    this.aircraftGroup.position.copy(position);
    this.aircraftGroup.quaternion.copy(quaternion);

    // Chase camera (spec 90.1): smoothed offset behind + above, looking slightly ahead.
    const behind = this.scratchBehind.set(0, 3.2, 11).applyQuaternion(quaternion);
    const desiredPos = this.scratchDesiredPos.copy(position).add(behind);
    this.cameraPos.lerp(desiredPos, 0.06);
    this.camera.position.copy(this.cameraPos);

    // Impact feedback (spec "vibración estructural visual intensa" / task item 4): a
    // short decaying random jitter on top of the chase camera, triggered by
    // triggerImpactShake() from FlightScreen on a hard-landing/crash event.
    if (this.shakeTimeRemainingS > 0) {
      this.shakeTimeRemainingS = Math.max(0, this.shakeTimeRemainingS - dtS);
      const falloff = this.shakeTimeRemainingS > 0 ? this.shakeTimeRemainingS : 0;
      const amount = this.shakeMagnitude * falloff;
      this.scratchShake.set((Math.random() - 0.5) * amount, (Math.random() - 0.5) * amount, (Math.random() - 0.5) * amount);
      this.camera.position.add(this.scratchShake);
    }

    const ahead = this.scratchAhead.set(0, 0.5, -6).applyQuaternion(quaternion);
    const desiredLook = this.scratchDesiredLook.copy(position).add(ahead);
    this.cameraLookTarget.lerp(desiredLook, 0.15);
    this.camera.lookAt(this.cameraLookTarget);
  }

  /** Triggers a short decaying camera-shake burst (task item 4: impact feedback).
   * `magnitude` is a rough meters-of-jitter scale; `durationS` how long it decays over. */
  triggerImpactShake(magnitude: number, durationS = 0.4): void {
    this.shakeMagnitude = magnitude;
    this.shakeTimeRemainingS = durationS;
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
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
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
    this.renderer.dispose();
  }
}
