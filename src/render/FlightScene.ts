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

  constructor(canvas: HTMLCanvasElement, region: RegionDefinition) {
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

    // Landmarks: barn + water tower, so the world isn't a flat void.
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

    this.buildAircraftPlaceholder();
    this.scene.add(this.aircraftGroup);
  }

  /** Placeholder DIY-tube aircraft mesh (no imported assets yet — see README TODO). */
  private buildAircraftPlaceholder() {
    const tubeMat = new THREE.MeshStandardMaterial({ color: '#b8b2a4', metalness: 0.3, roughness: 0.6 });
    const fabricMat = new THREE.MeshStandardMaterial({ color: '#d8cf9a', side: THREE.DoubleSide, roughness: 0.9 });
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
