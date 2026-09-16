// Vanilla Three.js scene for the flight view. React only owns UI/menus (spec 31.1);
// the 3D scene graph is managed imperatively here for performance on mobile GPUs.

import * as THREE from 'three';
import type { RegionDefinition } from '../core/types';

export class FlightScene {
  scene = new THREE.Scene();
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  aircraftGroup = new THREE.Group();
  private targetRing: THREE.Mesh | null = null;
  private cameraLookTarget = new THREE.Vector3();
  private cameraPos = new THREE.Vector3(0, 6, 15);

  constructor(canvas: HTMLCanvasElement, region: RegionDefinition, paint?: { fabricColor: string; tubeColor: string }) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = false;

    this.camera = new THREE.PerspectiveCamera(62, 1, 0.1, 6000);

    this.scene.background = new THREE.Color(region.skyColor);
    this.scene.fog = new THREE.Fog(region.skyColor, 400, 2600);

    const hemi = new THREE.HemisphereLight(0xffffff, 0x445533, 1.1);
    this.scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xfff4d6, 1.6);
    sun.position.set(300, 400, 150);
    this.scene.add(sun);

    // Ground
    const groundGeo = new THREE.PlaneGeometry(6000, 6000, 1, 1);
    const groundMat = new THREE.MeshStandardMaterial({ color: region.groundColor, roughness: 1 });
    const ground = new THREE.Mesh(groundGeo, groundMat);
    ground.rotation.x = -Math.PI / 2;
    this.scene.add(ground);

    // Simple runway strip
    const runwayGeo = new THREE.PlaneGeometry(24, 400);
    const runwayMat = new THREE.MeshStandardMaterial({ color: '#9a9a86', roughness: 0.95 });
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

  /** Region 1 landmarks (spec 12.2): barn, water tower, scattered trees. */
  private buildTheFieldLandmarks() {
    const barn = new THREE.Mesh(
      new THREE.BoxGeometry(14, 10, 18),
      new THREE.MeshStandardMaterial({ color: '#8c3b32' }),
    );
    barn.position.set(-40, 5, 20);
    this.scene.add(barn);

    const towerBase = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.2, 14, 8), new THREE.MeshStandardMaterial({ color: '#9b9b9b' }));
    towerBase.position.set(35, 7, 260);
    this.scene.add(towerBase);
    const towerTank = new THREE.Mesh(new THREE.CylinderGeometry(6, 6, 6, 12), new THREE.MeshStandardMaterial({ color: '#b7b7a8' }));
    towerTank.position.set(35, 17, 260);
    this.scene.add(towerTank);

    for (let i = 0; i < 40; i++) {
      const tree = new THREE.Mesh(
        new THREE.ConeGeometry(2.2 + Math.random(), 7 + Math.random() * 3, 6),
        new THREE.MeshStandardMaterial({ color: '#3f6b34' }),
      );
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

  /** Placeholder DIY-tube aircraft mesh (no imported assets yet — see README TODO). */
  private buildAircraftPlaceholder(paint?: { fabricColor: string; tubeColor: string }) {
    const tubeMat = new THREE.MeshStandardMaterial({ color: paint?.tubeColor ?? '#b8b2a4', metalness: 0.3, roughness: 0.6 });
    const fabricMat = new THREE.MeshStandardMaterial({ color: paint?.fabricColor ?? '#d8cf9a', side: THREE.DoubleSide, roughness: 0.9 });
    const engineMat = new THREE.MeshStandardMaterial({ color: '#33322f', roughness: 0.5, metalness: 0.4 });
    const wheelMat = new THREE.MeshStandardMaterial({ color: '#181818', roughness: 0.9 });

    const fuselage = new THREE.Mesh(new THREE.CapsuleGeometry(0.5, 4.2, 4, 8), tubeMat);
    fuselage.rotation.x = Math.PI / 2;
    this.aircraftGroup.add(fuselage);

    const wing = new THREE.Mesh(new THREE.BoxGeometry(9, 0.12, 1.4), fabricMat);
    wing.position.set(0, 0.3, 0);
    this.aircraftGroup.add(wing);

    const tailBoom = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 3.2, 6), tubeMat);
    tailBoom.rotation.x = Math.PI / 2;
    tailBoom.position.set(0, 0.3, -3.6);
    this.aircraftGroup.add(tailBoom);

    const hStab = new THREE.Mesh(new THREE.BoxGeometry(3, 0.08, 0.6), fabricMat);
    hStab.position.set(0, 0.4, -4.4);
    this.aircraftGroup.add(hStab);

    const vStab = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.2, 0.7), fabricMat);
    vStab.position.set(0, 0.9, -4.4);
    this.aircraftGroup.add(vStab);

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

  syncAircraft(position: THREE.Vector3, quaternion: THREE.Quaternion) {
    this.aircraftGroup.position.copy(position);
    this.aircraftGroup.quaternion.copy(quaternion);

    // Chase camera (spec 90.1): smoothed offset behind + above, looking slightly ahead.
    const behind = new THREE.Vector3(0, 3.2, 11).applyQuaternion(quaternion);
    const desiredPos = position.clone().add(behind);
    this.cameraPos.lerp(desiredPos, 0.06);
    this.camera.position.copy(this.cameraPos);

    const ahead = new THREE.Vector3(0, 0.5, -6).applyQuaternion(quaternion);
    const desiredLook = position.clone().add(ahead);
    this.cameraLookTarget.lerp(desiredLook, 0.15);
    this.camera.lookAt(this.cameraLookTarget);
  }

  resize(width: number, height: number) {
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
  }

  render() {
    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    this.renderer.dispose();
  }
}
