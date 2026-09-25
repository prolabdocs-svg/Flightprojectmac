import * as THREE from 'three';
import { createSeededRandom } from '../core/seededRandom';
import { planRoadTraffic, ROAD_END_MARGIN_M, samplePath, shuttleDistance, type VehicleKind } from '../world/ambientTraffic';
import { buildRoadRibbon, roadLiftM, type RoadPath } from '../world/fieldRoads';
import type { TerrainGridSampler } from '../world/terrainHeightfield';
import type { WaterBody } from '../world/waterBodies';
import { box, cyl, makeTexture, mergeParts, speckle } from './fieldWorld';

/**
 * Ground life for composed regions: cars/trucks/buses/tractors shuttling on the authored
 * roads, a freight train on the rail line, boats circling lakes and bird flocks. Every actor
 * is a pure function of flight time (world/ambientTraffic.ts) drawn through one InstancedMesh
 * per model — ~10 draw calls, no colliders, no per-frame allocation.
 */

type Kind = VehicleKind | 'loco' | 'boxcar' | 'tanker' | 'hopper' | 'boat' | 'bird';

const DARK = '#1f2124', GLASS = '#3a454e', FRAME = '#2a2a2a';
const wheels = (xs: number, zs: number[], r: number, w: number, y = r) =>
  xs === 0 ? [] : zs.flatMap((z) => [-xs, xs].map((x) => ({ geo: cyl(r, r, w, 10), color: DARK, pos: [x, y, z] as [number, number, number], rot: [0, 0, Math.PI / 2] as [number, number, number] })));
const railBase = (len: number) => [
  { geo: box(2.6, 0.5, len - 0.4), color: FRAME, pos: [0, 1.05, 0] as [number, number, number] },
  { geo: box(2.2, 0.8, 2.8), color: FRAME, pos: [0, 0.45, len / 2 - 2.6] as [number, number, number] },
  { geo: box(2.2, 0.8, 2.8), color: FRAME, pos: [0, 0.45, -len / 2 + 2.6] as [number, number, number] },
];

/** Hand-built triangles need normals to merge with (and light like) the primitive parts. */
const withNormals = (g: THREE.BufferGeometry) => { g.computeVertexNormals(); return g; };

/** Models in metres, origin at the base centre, +Z forward. White parts take the instance tint. */
function buildModel(kind: Kind): THREE.BufferGeometry {
  switch (kind) {
    case 'car': return mergeParts([
      { geo: box(1.8, 0.7, 4.3), color: '#ffffff', pos: [0, 0.65, 0] },
      { geo: box(1.6, 0.6, 2.1), color: GLASS, pos: [0, 1.3, -0.25] },
      ...wheels(0.8, [1.35, -1.35], 0.34, 0.26),
    ]);
    case 'truck': return mergeParts([
      { geo: box(2.3, 2.1, 2.2), color: '#ffffff', pos: [0, 1.55, 2.9] },
      { geo: box(2.32, 0.6, 1.2), color: GLASS, pos: [0, 2.05, 3.45] },
      { geo: box(2.45, 2.7, 5.6), color: '#e4e1d8', pos: [0, 2.0, -1.2] },
      ...wheels(1.05, [2.9, -0.4, -3.1], 0.5, 0.4),
    ]);
    case 'bus': return mergeParts([
      { geo: box(2.5, 2.6, 11), color: '#ffffff', pos: [0, 1.75, 0] },
      { geo: box(2.54, 0.8, 10.2), color: GLASS, pos: [0, 2.35, 0.2] },
      ...wheels(1.1, [3.6, -3.4], 0.5, 0.4),
    ]);
    case 'tractor': return mergeParts([
      { geo: box(1.2, 1.0, 2.4), color: '#ffffff', pos: [0, 1.25, 0.6] },
      { geo: box(1.4, 1.4, 1.3), color: GLASS, pos: [0, 2.2, -0.6] },
      { geo: box(1.5, 0.12, 1.5), color: '#ffffff', pos: [0, 2.95, -0.6] },
      ...wheels(0.95, [-0.8], 0.8, 0.5),
      ...wheels(0.8, [1.3], 0.45, 0.3),
    ]);
    case 'loco': return mergeParts([
      ...railBase(16),
      { geo: box(2.4, 2.4, 11), color: '#b8402f', pos: [0, 2.5, -2.2] },
      { geo: box(2.9, 2.9, 3.8), color: '#b8402f', pos: [0, 2.75, 5.3] },
      { geo: box(2.95, 0.7, 3.85), color: GLASS, pos: [0, 3.4, 5.3] },
      { geo: box(2.5, 0.25, 11), color: '#e8c85a', pos: [0, 1.4, -2.2] },
    ]);
    case 'boxcar': return mergeParts([...railBase(13), { geo: box(2.9, 3.0, 12.4), color: '#7a4a32', pos: [0, 2.8, 0] }]);
    case 'tanker': return mergeParts([
      ...railBase(13),
      { geo: cyl(1.35, 1.35, 11.6, 12), color: '#d9d6cf', pos: [0, 2.7, 0], rot: [Math.PI / 2, 0, 0] },
      { geo: cyl(0.5, 0.5, 0.5, 8), color: '#d9d6cf', pos: [0, 4.1, 0] },
    ]);
    case 'hopper': return mergeParts([...railBase(13), { geo: box(2.9, 2.4, 12), color: '#5f6a4a', pos: [0, 2.5, 0] }, { geo: box(2.6, 0.2, 11.4), color: '#6b5a3f', pos: [0, 3.75, 0] }]);
    case 'boat': {
      const wake = new THREE.BufferGeometry();
      wake.setAttribute('position', new THREE.Float32BufferAttribute([0, 0.05, -2.6, 2.4, 0.05, -13, -2.4, 0.05, -13], 3));
      return mergeParts([
        { geo: box(2.2, 0.8, 5), color: '#ffffff', pos: [0, 0.2, -0.3] },
        // 3-sided prism = pointed bow (apex on +Z, back edge flush with the hull).
        { geo: cyl(1.27, 1.27, 0.8, 3), color: '#ffffff', pos: [0, 0.2, 2.835] },
        { geo: box(2.24, 0.16, 5.02), color: '#c9423a', pos: [0, 0.45, -0.3] },
        { geo: box(1.4, 1.0, 1.8), color: '#f4f2ea', pos: [0, 1.05, -0.8] },
        { geo: withNormals(wake), color: '#c4d8de' },
      ]);
    }
    case 'bird': {
      const g = new THREE.BufferGeometry();
      // Two wings as a shallow V; instance scale.y flips the tips up/down to flap.
      g.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0.3, 0, 0, -0.25, 0.95, 0.35, -0.1, 0, 0, 0.3, -0.95, 0.35, -0.1, 0, 0, -0.25], 3));
      return mergeParts([{ geo: withNormals(g), color: '#2b2b2b' }]);
    }
  }
}

const railTexture = (): THREE.CanvasTexture =>
  makeTexture(64, 64, (ctx) => {
    ctx.fillStyle = '#8a8174'; ctx.fillRect(0, 0, 64, 64);
    speckle(ctx, 64, 64, 500, ['#6f675b', '#a39a8b', '#5d564c'], 'rail-ballast');
    ctx.fillStyle = '#5a4634';
    for (let i = 0; i < 6; i++) ctx.fillRect(13, i * 10.67 + 3, 38, 4);
    ctx.fillStyle = '#3b3a38'; ctx.fillRect(20, 0, 3, 64); ctx.fillRect(41, 0, 3, 64);
    ctx.fillStyle = '#c9ccd0'; ctx.fillRect(21, 0, 1, 64); ctx.fillRect(42, 0, 1, 64);
  });

const CONSIST: Kind[] = ['loco', 'boxcar', 'tanker', 'tanker', 'hopper', 'boxcar'];
const CAR_LEN: Partial<Record<Kind, number>> = { loco: 16 };
const TRAIN_GAP_M = 1, RAIL_END_M = 10;

export class AmbientNpcs {
  readonly root = new THREE.Group();
  private readonly material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, metalness: 0.1 });
  private readonly meshes = new Map<Kind, THREE.InstancedMesh>();
  private readonly updaters: Array<(t: number) => void> = [];
  private readonly disposables: Array<{ dispose(): void }> = [this.material];
  private readonly dummy = new THREE.Object3D();
  private readonly counts = new Map<Kind, number>();
  private readonly tints: Array<[Kind, number, THREE.Color]> = [];

  constructor(grid: TerrainGridSampler, roads: RoadPath[], opts: { seed: string; rail?: RoadPath; lakes: WaterBody[] }) {
    this.root.name = 'ambient-npcs';
    this.dummy.rotation.order = 'YXZ';
    const rng = createSeededRandom(opts.seed, 'ambient-npcs');

    // Road vehicles: right-hand lane, parked a moment at each end before turning back.
    for (const v of planRoadTraffic(roads, opts.seed)) {
      const road = roads[v.roadIndex], i = this.claim(v.kind);
      const span = road.lengthM - 2 * ROAD_END_MARGIN_M, lane = road.def.widthM * 0.25, lift = roadLiftM(road.def);
      const color = new THREE.Color(v.colorHex);
      this.updaters.push((t) => {
        const { s, dir } = shuttleDistance(t + v.phaseS, span, v.vmaxMs, v.accelMs2, v.dwellS);
        const p = samplePath(road.points, ROAD_END_MARGIN_M + s);
        this.place(v.kind, i, p.x - p.tz * lane * dir, p.y + lift, p.z + p.tx * lane * dir, Math.atan2(p.tx * dir, p.tz * dir), -Math.atan(p.grade * dir));
      });
      this.tints.push([v.kind, i, color]);
    }

    if (opts.rail) this.addTrain(grid, opts.rail);
    for (const lake of opts.lakes) if (lake.radiusM >= 150) this.addBoats(lake, rng);
    this.addBirds(grid, roads, rng);

    for (const [kind, n] of this.counts) {
      const geo = buildModel(kind);
      const mat = kind === 'bird' ? new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide, roughness: 1 }) : this.material;
      const mesh = new THREE.InstancedMesh(geo, mat, n);
      mesh.name = `npc:${kind}`;
      mesh.frustumCulled = false; // instances roam the whole map; the models are a few hundred triangles each
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      for (let i = 0; i < n; i++) mesh.setColorAt(i, new THREE.Color('#ffffff'));
      this.meshes.set(kind, mesh);
      this.root.add(mesh);
      this.disposables.push(geo, mat);
    }
    for (const [kind, i, color] of this.tints) this.meshes.get(kind)!.setColorAt(i, color);
    this.update(0);
  }

  /** Next instance slot of a model. */
  private claim(kind: Kind): number {
    const i = this.counts.get(kind) ?? 0;
    this.counts.set(kind, i + 1);
    return i;
  }

  private place(kind: Kind, i: number, x: number, y: number, z: number, yaw: number, pitch = 0, flap = 1) {
    const d = this.dummy;
    d.position.set(x, y, z);
    d.rotation.set(pitch, yaw, 0);
    d.scale.set(1, flap, 1);
    d.updateMatrix();
    this.meshes.get(kind)?.setMatrixAt(i, d.matrix);
  }

  /** Freight train shuttling end to end (push-pull), with a platform where it waits. */
  private addTrain(grid: TerrainGridSampler, rail: RoadPath) {
    const lens = CONSIST.map((k) => CAR_LEN[k] ?? 13);
    const consistM = lens.reduce((a, b) => a + b + TRAIN_GAP_M, -TRAIN_GAP_M);
    const span = rail.lengthM - 2 * RAIL_END_M - consistM;
    if (span < 200) return;
    let back = 0;
    const cars = CONSIST.map((kind, c) => {
      const center = back + lens[c] / 2;
      back += lens[c] + TRAIN_GAP_M;
      return { kind, i: this.claim(kind), center, half: lens[c] / 2 - 2.6 };
    });
    const lift = roadLiftM(rail.def);
    this.updaters.push((t) => {
      const head = RAIL_END_M + consistM + shuttleDistance(t, span, 16, 0.35, 25).s;
      for (const car of cars) {
        // Pose from the two bogies so the body cuts the chord on curves like a real car.
        const a = samplePath(rail.points, head - car.center - car.half), b = samplePath(rail.points, head - car.center + car.half);
        const dx = b.x - a.x, dz = b.z - a.z;
        this.place(car.kind, car.i, (a.x + b.x) / 2, (a.y + b.y) / 2 + lift, (a.z + b.z) / 2, Math.atan2(dx, dz), -Math.atan2(b.y - a.y, Math.hypot(dx, dz)));
      }
    });

    // Track ribbon (drawn over road ribbons so level crossings show the rails) + two halts.
    const ribbon = buildRoadRibbon(rail, grid, 4.4);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(ribbon.positions, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(ribbon.uvs, 2));
    geo.setIndex(ribbon.index);
    geo.computeVertexNormals();
    const tex = railTexture();
    const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 1, polygonOffset: true, polygonOffsetFactor: -7, polygonOffsetUnits: -7 });
    const track = new THREE.Mesh(geo, mat);
    track.name = 'rail:track';
    track.receiveShadow = true;
    this.root.add(track);
    this.disposables.push(geo, mat, tex);

    const platforms = [RAIL_END_M + consistM / 2, rail.lengthM - RAIL_END_M - consistM / 2].map((s) => {
      const p = samplePath(rail.points, s), yaw = Math.atan2(p.tx, p.tz);
      const parts = mergeParts([
        { geo: box(3.2, 1.6, consistM + 8), color: '#b9b2a4', pos: [0, 0.3, 0] },
        { geo: box(3.0, 0.12, 14), color: '#6d4f3a', pos: [0.2, 3.6, 0] },
        { geo: box(0.2, 2.6, 0.2), color: FRAME, pos: [1.2, 2.3, -6] },
        { geo: box(0.2, 2.6, 0.2), color: FRAME, pos: [1.2, 2.3, 6] },
      ]);
      parts.applyMatrix4(new THREE.Matrix4().makeRotationY(yaw).setPosition(p.x - p.tz * 3.9, p.y, p.z + p.tx * 3.9));
      return parts;
    });
    for (const g of platforms) {
      const m = new THREE.Mesh(g, this.material);
      m.name = 'rail:halt';
      this.root.add(m);
      this.disposables.push(g);
    }
  }

  private addBoats(lake: WaterBody, rng: ReturnType<typeof createSeededRandom>) {
    for (let b = 0; b < 3; b++) {
      // Irregular (bed-shored) lakes: the footprint is only a bound, so circle inside the island's radius.
      const r = lake.shoreFromBed ? rng.range(120, 240) : lake.radiusM * rng.range(0.3, 0.65), w = rng.range(5, 8) / r, a0 = rng.range(0, Math.PI * 2), spin = b % 2 ? 1 : -1;
      const i = this.claim('boat');
      this.updaters.push((t) => {
        const a = a0 + spin * w * t;
        const x = lake.center[0] + Math.cos(a) * r, z = lake.center[1] + Math.sin(a) * r;
        this.place('boat', i, x, lake.surfaceElevationM + 0.3 + Math.sin(t * 1.3 + b) * 0.08, z, Math.atan2(-Math.sin(a) * spin, Math.cos(a) * spin));
      });
    }
  }

  /** A few flocks wheeling over the countryside near the roads. */
  private addBirds(grid: TerrainGridSampler, roads: RoadPath[], rng: ReturnType<typeof createSeededRandom>) {
    const long = [...roads].sort((a, b) => b.lengthM - a.lengthM).slice(0, 3);
    long.forEach((road, f) => {
      const p = samplePath(road.points, road.lengthM * rng.range(0.3, 0.7));
      const cx = p.x - p.tz * 140, cz = p.z + p.tx * 140, cy = grid.height(cx, cz) + rng.range(45, 80);
      const R = rng.range(60, 120), w = rng.range(0.08, 0.14) * (f % 2 ? 1 : -1);
      for (let j = 0; j < 9; j++) {
        const i = this.claim('bird'), lag = j * 0.07, dr = rng.range(-10, 10), dy = rng.range(-4, 4), ph = rng.range(0, 6);
        this.updaters.push((t) => {
          const a = w * t - lag * Math.sign(w);
          const x = cx + Math.cos(a) * (R + dr), z = cz + Math.sin(a) * (R + dr);
          this.place('bird', i, x, cy + dy + Math.sin(t * 0.7 + ph) * 3, z, Math.atan2(-Math.sin(a) * Math.sign(w), Math.cos(a) * Math.sign(w)), 0, Math.sin(t * 9 + ph));
        });
      }
    });
  }

  update(elapsedS: number): void {
    for (const u of this.updaters) u(elapsedS);
    for (const m of this.meshes.values()) m.instanceMatrix.needsUpdate = true;
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
  }
}
