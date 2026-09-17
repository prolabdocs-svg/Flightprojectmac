import * as THREE from 'three';
import type { RegionDefinition } from '../core/types';
import { createTerrainQueryService, type TerrainQueryService } from '../world/terrainQuery';
import { BIOME_COLORS } from '../world/biomeWeights';
import { createSeededRandom } from '../core/seededRandom';
import { getAmbientTrafficPose } from '../world/ambientTraffic';

/** Presentation-only region kit.  Simulation reads the matching data profile through
 * sim/weather.ts, so visual density can be changed independently of flight behaviour. */
export class WorldEnvironment {
  readonly root = new THREE.Group();
  private readonly clouds: THREE.Group[] = [];
  private readonly windSock: THREE.Mesh;
  private readonly rain: THREE.Points | null;
  private readonly ambientAircraft: THREE.Group[] = [];
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
    this.addDistantLandmark();
    this.addRidgeline();
    this.addGroundScatter();
    this.addAmbientTraffic();
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
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = -pos.getY(i);
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
    // The shared detail texture supplies grain, while this per-region tint preserves biome
    // identity at low altitude instead of making every close surface read as The Field.
    const terrainMat = new THREE.MeshStandardMaterial({ color: base.clone().lerp(new THREE.Color('#ffffff'), 0.55), vertexColors: true, roughness: 0.98, metalness: 0, flatShading: true });
    // Generated as a dedicated, tileable albedo asset. Vertex colours remain in the
    // shader as macro variation, while this map contributes the close-range grass/soil
    // detail that procedural geometry alone cannot carry.
    new THREE.TextureLoader().load('/assets/textures/field-ground-v1.png', (texture) => {
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
      texture.repeat.set(34, 34);
      texture.anisotropy = 4;
      terrainMat.map = texture;
      terrainMat.needsUpdate = true;
    });
    const terrain = new THREE.Mesh(geo, terrainMat);
    terrain.rotation.x = -Math.PI / 2;
    terrain.receiveShadow = true;
    this.root.add(terrain);

    // Low-cost water/earth horizon shell gives distant terrain a clear silhouette on mobile.
    const horizon = new THREE.Mesh(new THREE.RingGeometry(1050, 2900, 64), new THREE.MeshBasicMaterial({ color: this.region.environment.terrain === 'quarry' ? '#786d60' : '#708f58', side: THREE.DoubleSide, transparent: true, opacity: 0.55 }));
    horizon.rotation.x = -Math.PI / 2;
    horizon.position.y = -0.08;
    this.root.add(horizon);
  }

  /** A single tall, high-contrast structure placed far from the runway so it stays
   * visible from great distance/altitude and acts as a "visual compass" while flying —
   * the same role GTA San Andreas' Vinewood sign or the Gant bridge play: a landmark
   * you can orient toward without needing a map. Cheap (a handful of primitives), so it
   * doesn't compete with the InstancedMesh prop budget used elsewhere in this file. */
  private addDistantLandmark() {
    const isQuarry = this.region.environment.terrain === 'quarry';
    const x = isQuarry ? -620 : 560;
    const z = isQuarry ? 980 : 1120;
    const groundY = this.terrainQuery.getElevation(x, z);
    const group = new THREE.Group();
    group.position.set(x, groundY, z);

    if (isQuarry) {
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
    const rng = createSeededRandom('world-environment-ridgeline', this.region.id);
    const quarry = this.region.environment.terrain === 'quarry';
    for (const [radius, color, height] of [[1500, quarry ? '#4c493f' : '#355141', 190], [2300, quarry ? '#625a4d' : '#58715d', 330]] as const) {
      const count = 48;
      const vertices: number[] = [];
      const indices: number[] = [];
      for (let i = 0; i <= count; i++) {
        const angle = (i / count) * Math.PI * 2;
        const nearHeight = 22 + rng.next() * 55;
        const farHeight = height * (0.58 + rng.next() * 0.65);
        for (const [distance, y] of [[radius, nearHeight], [radius + 760, farHeight]] as const) {
          vertices.push(Math.cos(angle) * distance, y, Math.sin(angle) * distance);
        }
        if (i) {
          const prev = (i - 1) * 2, current = i * 2;
          indices.push(prev, prev + 1, current, prev + 1, current + 1, current);
        }
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
      geo.setIndex(indices);
      geo.computeVertexNormals();
      this.root.add(new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color, fog: true, side: THREE.DoubleSide })));
    }
  }

  /** Secondary ground clutter (rocks/scrub) distinct from FlightScene's tree/scrap-pile
   * InstancedMeshes: sparser, taller-variance scale, and — unlike those — sampled against
   * TerrainQueryService so props sit flush with the undulating terrain instead of
   * floating/clipping on the now-hilly ground (see terrainQuery.ts). Single InstancedMesh,
   * matching the efficient-instancing pattern used throughout this file/FlightScene. */
  private addGroundScatter() {
    const rng = createSeededRandom('world-environment-scatter', this.region.id);
    const isQuarry = this.region.environment.terrain === 'quarry';
    const count = 60;
    const geo = isQuarry ? new THREE.DodecahedronGeometry(1, 0) : new THREE.IcosahedronGeometry(1, 0);
    const mat = new THREE.MeshStandardMaterial({ color: isQuarry ? '#756a5c' : '#4d6b3d', roughness: 1, metalness: isQuarry ? 0.15 : 0 });
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
    for (let i = 0; i < this.clouds.length; i++) this.clouds[i].position.x = ((-900 + i * 371 + elapsedS * (0.7 + i * 0.04)) % 2100) - 1050;
    this.windSock.rotation.y = Math.atan2(wind.x, wind.z);
    this.windSock.rotation.z = -Math.PI / 2 + Math.min(0.48, wind.length() * 0.045);
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
