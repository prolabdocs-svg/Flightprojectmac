import * as THREE from 'three';
import type { RegionDefinition } from '../core/types';
import { createTerrainQueryService, type TerrainQueryService } from '../world/terrainQuery';

/** Presentation-only region kit.  Simulation reads the matching data profile through
 * sim/weather.ts, so visual density can be changed independently of flight behaviour. */
export class WorldEnvironment {
  readonly root = new THREE.Group();
  private readonly clouds: THREE.Group[] = [];
  private readonly windSock: THREE.Mesh;
  private readonly rain: THREE.Points | null;
  private readonly region: RegionDefinition;
  readonly terrainQuery: TerrainQueryService;

  constructor(region: RegionDefinition) {
    this.region = region;
    this.terrainQuery = createTerrainQueryService(region);
    this.root.name = `environment:${region.id}`;
    this.addTerrain();
    this.addClouds();
    this.windSock = this.addWindSock();
    this.rain = region.environment.weather === 'rain' ? this.addRain() : null;
  }

  private addTerrain() {
    const size = 6000;
    const segments = 96;
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
    geo.computeVertexNormals();
    const terrain = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: this.region.groundColor, roughness: 0.98, metalness: 0 }));
    terrain.rotation.x = -Math.PI / 2;
    terrain.receiveShadow = false;
    this.root.add(terrain);

    // Low-cost water/earth horizon shell gives distant terrain a clear silhouette on mobile.
    const horizon = new THREE.Mesh(new THREE.RingGeometry(1050, 2900, 64), new THREE.MeshBasicMaterial({ color: this.region.environment.terrain === 'quarry' ? '#786d60' : '#708f58', side: THREE.DoubleSide, transparent: true, opacity: 0.55 }));
    horizon.rotation.x = -Math.PI / 2;
    horizon.position.y = -0.08;
    this.root.add(horizon);
  }

  private addClouds() {
    const cloudMat = new THREE.MeshBasicMaterial({ color: '#f7f3e8', transparent: true, opacity: 0.16 + this.region.environment.cloudCover * 0.42, depthWrite: false });
    const count = Math.round(4 + this.region.environment.cloudCover * 10);
    for (let i = 0; i < count; i++) {
      const group = new THREE.Group();
      for (let puff = 0; puff < 3; puff++) {
        const mesh = new THREE.Mesh(new THREE.SphereGeometry(24 + puff * 9, 8, 6), cloudMat);
        mesh.position.set(puff * 28, Math.sin(puff * 2.1) * 8, Math.cos(puff) * 12);
        group.add(mesh);
      }
      group.position.set(-900 + (i * 371) % 1800, 150 + (i % 3) * 45, -600 + (i * 277) % 1600);
      group.scale.setScalar(0.7 + (i % 4) * 0.16);
      this.clouds.push(group);
      this.root.add(group);
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
    for (let i = 0; i < this.clouds.length; i++) this.clouds[i].position.x = ((-900 + i * 371 + elapsedS * (0.7 + i * 0.04)) % 2100) - 1050;
    this.windSock.rotation.y = Math.atan2(wind.x, wind.z);
    this.windSock.rotation.z = -Math.PI / 2 + Math.min(0.48, wind.length() * 0.045);
    if (this.rain) {
      const p = this.rain.geometry.attributes.position;
      for (let i = 1; i < p.count * 3; i += 3) { const y = p.array[i] - 0.9; p.array[i] = y < 0 ? 80 : y; }
      p.needsUpdate = true;
    }
  }
}
