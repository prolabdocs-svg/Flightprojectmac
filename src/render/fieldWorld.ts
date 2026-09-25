import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { createSeededRandom } from '../core/seededRandom';
import { FIELD_COMPOSITION_SEED } from '../world/fieldComposition';
import type { TerrainType } from '../world/regionArtBible';
import { buildRoadRibbon, type RoadPath } from '../world/fieldRoads';
import type { FieldLayout, GroundPatch, Placement, PropKind, RockPlacement, TreePlacement } from '../world/fieldPlacement';
import { FIELD_LAKE, lakeEdgeDistance, SEA_LEVEL_M } from '../world/fieldGeography';
import { POWER_LINES, pylonPositions } from '../world/fieldComposition';
import type { TerrainGridSampler } from '../world/terrainHeightfield';
import { assetLibrary } from './assetLibrary';
import { orientWorldProp } from './blenderAxisFix';
import { buildTreeClusterGeometry, instanceGltf, type TreeClusterPlacement } from './vegetation';
import { applySurfaceDetail } from './surfaceDetail';

/**
 * Draws the composed Field (world/fieldPlacement.ts) with a mobile-WebGL2 budget:
 *  - roads and crop parcels are draped ribbon/grid meshes (a handful of draw calls in total)
 *  - everything repeated is an InstancedMesh, bucketed into spatial chunks
 *  - each chunk carries a distance band (near props < 450 m, buildings/tree masses to a few
 *    km, big rocks and landmarks further) and is switched on/off from the camera position.
 * Nothing here is regenerated per frame; `update` only flips chunk visibility.
 */

interface LodEntry { obj: THREE.Object3D; cx: number; cz: number; r: number; near: number; far: number }

const A = '/assets/regions/field/airfields/';
const W = '/assets/models/world/';
/** GLB props: blender = authored Z-down (blenderAxisFix.ts); far = last visible distance (m). */
const GLB_PROPS: Partial<Record<PropKind, { uri: string; blender: boolean; far: number; chunk: number }>> = {
  farmhouse_a: { uri: `${W}farmhouse_a.glb`, blender: true, far: 4200, chunk: 1600 },
  farmhouse_b: { uri: `${W}farmhouse_b.glb`, blender: true, far: 4200, chunk: 1600 },
  small_workshop: { uri: `${W}small_workshop.glb`, blender: true, far: 4200, chunk: 1600 },
  barn_a: { uri: `${W}barn_a.glb`, blender: true, far: 5200, chunk: 1600 },
  barn_b: { uri: `${W}barn_b.glb`, blender: true, far: 5200, chunk: 1600 },
  windmill_landmark: { uri: `${W}windmill_landmark.glb`, blender: true, far: 8000, chunk: 2000 },
  af_hangar_compound: { uri: `${W}field_hangar_compound.glb`, blender: true, far: 4500, chunk: 1600 },
  af_windsock: { uri: `${W}airfield_windsock.glb`, blender: true, far: 1600, chunk: 1200 },
  af_tug: { uri: `${A}pushback_tug.glb`, blender: false, far: 700, chunk: 500 },
  af_floodlight: { uri: `${A}apron_floodligh.glb`, blender: false, far: 900, chunk: 500 },
  af_cone_row: { uri: `${A}safety_cone_row.glb`, blender: false, far: 450, chunk: 500 },
  af_chock: { uri: `${A}wheel_chock_and.glb`, blender: false, far: 400, chunk: 500 },
  af_fence: { uri: `${A}perimeter_fence.glb`, blender: false, far: 900, chunk: 500 },
  af_gate: { uri: `${A}perimeter_gate.glb`, blender: false, far: 900, chunk: 500 },
  af_ground_power: { uri: `${A}ground_power_un.glb`, blender: false, far: 600, chunk: 500 },
  af_bus: { uri: `${A}apron_bus.glb`, blender: false, far: 800, chunk: 500 },
  af_taxiway_sign: { uri: `${A}taxiway_sign.glb`, blender: false, far: 450, chunk: 500 },
  af_stand_guidance: { uri: `${A}stand_guidance.glb`, blender: false, far: 450, chunk: 500 },
};
/** Procedural prop distance/chunk config. */
const PROC_PROPS: Partial<Record<PropKind, { far: number; chunk: number }>> = {
  silo: { far: 6500, chunk: 1600 }, tank: { far: 6000, chunk: 1600 }, warehouse: { far: 5500, chunk: 1600 }, stack: { far: 9000, chunk: 2000 },
  lattice_tower: { far: 9000, chunk: 2000 }, jetty: { far: 3500, chunk: 2000 }, hut: { far: 1400, chunk: 800 },
  pole: { far: 900, chunk: 500 }, fence_seg: { far: 450, chunk: 400 }, hay_bale: { far: 800, chunk: 500 }, barrel: { far: 400, chunk: 400 },
  crate: { far: 400, chunk: 400 }, sign: { far: 500, chunk: 500 },
  townhouse: { far: 4200, chunk: 800 }, church: { far: 9000, chunk: 2000 }, pylon: { far: 4200, chunk: 1600 },
  boat: { far: 1400, chunk: 800 }, reeds: { far: 800, chunk: 500 }, lighthouse: { far: 14000, chunk: 2000 },
  boathouse: { far: 3000, chunk: 1200 }, car: { far: 600, chunk: 500 },
};
const TREE_HI_FAR_M = 1000, TREE_FAR_M = 6800, HERO_TREE_FAR_M = 1300, SHRUB_FAR_M = 750;
const ROCK_SMALL_FAR_M = 1100, ROCK_LARGE_FAR_M = 4200, ROCK_LARGE_SCALE = 3.4;

const TREE_URIS = {
  broadleaf: ['commontree_3', 'commontree_2', 'commontree_1'],
  conifer: ['pine_2', 'pine_1', 'pine_3'],
  shrub: ['bush_common'],
} as const;

function colorize(geo: THREE.BufferGeometry, hex: string): THREE.BufferGeometry {
  const c = new THREE.Color(hex), n = geo.attributes.position.count, colors = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) colors.set([c.r, c.g, c.b], i * 3);
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geo;
}

interface Part { geo: THREE.BufferGeometry; color: string; pos?: [number, number, number]; rot?: [number, number, number]; scale?: [number, number, number] }
/** Merges coloured primitives into one static vertex-coloured geometry (one draw call per prop type). */
export function mergeParts(parts: Part[]): THREE.BufferGeometry {
  const list = parts.map(({ geo, color, pos = [0, 0, 0], rot = [0, 0, 0], scale = [1, 1, 1] }) => {
    const g = geo.index ? geo.toNonIndexed() : geo;
    g.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(...pos), new THREE.Quaternion().setFromEuler(new THREE.Euler(...rot)), new THREE.Vector3(...scale)));
    g.deleteAttribute('uv');
    return colorize(g, color);
  });
  const merged = mergeGeometries(list, false)!;
  list.forEach((g) => g.dispose());
  return merged;
}
export const box = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d);
export const cyl = (rt: number, rb: number, h: number, seg = 8) => new THREE.CylinderGeometry(rt, rb, h, seg);

/** Procedural prop geometries in metres, origin at the base centre, +Z along the prop's length. */
function buildPropGeometry(kind: PropKind): THREE.BufferGeometry | null {
  switch (kind) {
    case 'fence_seg': return mergeParts([
      { geo: box(0.12, 1.25, 0.12), color: '#77603f', pos: [0, 0.62, -1.95] }, { geo: box(0.12, 1.25, 0.12), color: '#77603f', pos: [0, 0.62, 1.95] },
      { geo: box(0.05, 0.07, 4), color: '#8b7452', pos: [0, 0.5, 0] }, { geo: box(0.05, 0.07, 4), color: '#8b7452', pos: [0, 0.98, 0] },
    ]);
    case 'pole': return mergeParts([{ geo: cyl(0.13, 0.17, 9, 6), color: '#6b563b', pos: [0, 4.5, 0] }, { geo: box(2.2, 0.12, 0.12), color: '#5a4830', pos: [0, 8.4, 0] }, { geo: box(1.4, 0.1, 0.1), color: '#5a4830', pos: [0, 7.5, 0] }]);
    case 'hay_bale': return mergeParts([{ geo: cyl(0.9, 0.9, 1.25, 10), color: '#d8c068', rot: [0, 0, Math.PI / 2], pos: [0, 0.9, 0] }]);
    case 'barrel': return mergeParts([{ geo: cyl(0.3, 0.3, 0.9, 8), color: '#b0442c', pos: [0, 0.45, 0] }]);
    case 'crate': return mergeParts([{ geo: box(0.95, 0.85, 0.95), color: '#8a6a3e', pos: [0, 0.43, 0] }]);
    case 'sign': return mergeParts([{ geo: box(0.08, 2.4, 0.08), color: '#80858a', pos: [0, 1.2, 0] }, { geo: box(0.9, 0.7, 0.06), color: '#e0b93a', pos: [0, 2.3, 0.06] }]);
    case 'hut': return mergeParts([{ geo: box(4, 2.6, 5), color: '#c9c2b0', pos: [0, 1.3, 0] }, { geo: box(4.6, 0.3, 5.6), color: '#6d4d3a', pos: [0, 2.75, 0] }, { geo: box(1, 1.9, 0.1), color: '#3a4a52', pos: [0, 0.95, 2.52] }]);
    case 'silo': return mergeParts([
      { geo: cyl(4.2, 4.4, 18, 14), color: '#dcd8c8', pos: [0, 9, 0] }, { geo: new THREE.SphereGeometry(4.2, 14, 6, 0, Math.PI * 2, 0, Math.PI / 2), color: '#b9c0c4', pos: [0, 18, 0] },
      { geo: cyl(4.5, 4.5, 0.5, 14), color: '#8a8f92', pos: [0, 6, 0] }, { geo: cyl(4.5, 4.5, 0.5, 14), color: '#8a8f92', pos: [0, 12, 0] }, { geo: cyl(0.3, 0.3, 4, 5), color: '#a04a34', pos: [0, 20.5, 0] },
    ]);
    case 'tank': return mergeParts([{ geo: cyl(7, 7, 11, 16), color: '#e8e6dc', pos: [0, 5.5, 0] }, { geo: cyl(7.4, 7.4, 0.5, 16), color: '#a6a89f', pos: [0, 11.2, 0] }, { geo: cyl(7.2, 7.2, 0.4, 16), color: '#c65a3a', pos: [0, 2, 0] }]);
    case 'warehouse': return mergeParts([
      { geo: box(44, 9, 22), color: '#b4bcc2', pos: [0, 4.5, 0] }, { geo: box(46, 0.5, 12.6), color: '#6c757c', pos: [0, 10.2, 5.6], rot: [0.28, 0, 0] }, { geo: box(46, 0.5, 12.6), color: '#6c757c', pos: [0, 10.2, -5.6], rot: [-0.28, 0, 0] },
      { geo: box(9, 6, 0.3), color: '#3a4650', pos: [-9, 3, 11.1] }, { geo: box(9, 6, 0.3), color: '#3a4650', pos: [9, 3, 11.1] }, { geo: box(44.2, 1.2, 22.2), color: '#c26a3e', pos: [0, 8.2, 0] },
    ]);
    case 'stack': {
      const parts: Part[] = [{ geo: cyl(5, 5.5, 3, 12), color: '#84807a', pos: [0, 1.5, 0] }];
      for (let i = 0; i < 6; i++) parts.push({ geo: cyl(3.4 - i * 0.16, 3.6 - i * 0.16, 10.5, 12), color: i % 2 ? '#e8e4da' : '#c4402c', pos: [0, 8.2 + i * 10.5, 0] });
      parts.push({ geo: cyl(2.9, 2.6, 1, 12), color: '#302f2f', pos: [0, 71.5, 0] }, { geo: new THREE.SphereGeometry(0.7, 8, 6), color: '#ff5a3c', pos: [0, 73, 0] });
      return mergeParts(parts);
    }
    case 'lattice_tower': {
      const parts: Part[] = [];
      const H = 96, base = 8;
      for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
        const tilt = Math.atan2(base - 0.8, H);
        parts.push({ geo: cyl(0.45, 0.6, Math.hypot(H, base - 0.8), 5), color: '#d8d8d2', pos: [sx * (base + 0.8) / 2, H / 2, sz * (base + 0.8) / 2], rot: [sz * tilt, 0, -sx * tilt] });
      }
      for (let i = 1; i <= 9; i++) {
        const y = (H / 10) * i, half = base + (0.8 - base) * (y / H);
        const bandColor = i % 2 ? '#d8402c' : '#eeeae0';
        parts.push({ geo: box(half * 2, 0.5, 0.5), color: bandColor, pos: [0, y, half] }, { geo: box(half * 2, 0.5, 0.5), color: bandColor, pos: [0, y, -half] }, { geo: box(0.5, 0.5, half * 2), color: bandColor, pos: [half, y, 0] }, { geo: box(0.5, 0.5, half * 2), color: bandColor, pos: [-half, y, 0] });
        const d = Math.hypot(half * 2, H / 10);
        parts.push({ geo: cyl(0.22, 0.22, d, 4), color: '#c8c8c0', pos: [0, y - H / 20, half], rot: [0, 0, Math.PI / 2 - Math.atan2(H / 10, half * 2)] });
      }
      parts.push({ geo: box(2.4, 1.2, 2.4), color: '#d8402c', pos: [0, H + 0.6, 0] }, { geo: cyl(0.12, 0.12, 12, 5), color: '#d8d8d2', pos: [0, H + 7, 0] }, { geo: new THREE.SphereGeometry(0.9, 8, 6), color: '#ff5a3c', pos: [0, H + 13.2, 0] });
      for (const sx of [-1, 1]) parts.push({ geo: box(4, 0.4, 2.2), color: '#e6e2d6', pos: [sx * 3.5, H - 8, 0] });
      return mergeParts(parts);
    }
    case 'jetty': {
      const parts: Part[] = [{ geo: box(3.4, 0.3, 46), color: '#7b6647', pos: [0, 0, 0] }];
      for (let i = 0; i <= 9; i++) for (const sx of [-1, 1]) parts.push({ geo: cyl(0.16, 0.18, 3.2, 5), color: '#4c3d2a', pos: [sx * 1.6, -1.2, -22 + i * 5] });
      return mergeParts(parts);
    }
    case 'townhouse': return mergeParts([
      { geo: box(8, 6.4, 10), color: '#e2d8c4', pos: [0, 3.2, 0] }, { geo: box(8.8, 0.35, 6.2), color: '#8e4a35', pos: [0, 7.6, 2.5], rot: [0.62, 0, 0] },
      { geo: box(8.8, 0.35, 6.2), color: '#8e4a35', pos: [0, 7.6, -2.5], rot: [-0.62, 0, 0] }, { geo: box(0.9, 2.2, 0.9), color: '#7a6a5c', pos: [2.4, 8.6, -1.5] },
      { geo: box(1.2, 2.1, 0.1), color: '#4b3a2e', pos: [0, 1.05, 5.02] }, { geo: box(6.4, 0.9, 0.1), color: '#44525c', pos: [0, 4.6, 5.02] }, { geo: box(6.4, 0.9, 0.1), color: '#44525c', pos: [0, 2.2, 5.02], scale: [0.35, 1, 1] },
    ]);
    case 'church': return mergeParts([
      { geo: box(11, 8, 22), color: '#d9d2c2', pos: [0, 4, 0] }, { geo: box(12, 0.4, 7.6), color: '#6a5a50', pos: [0, 10.2, 3], rot: [0.72, 0, 0] }, { geo: box(12, 0.4, 7.6), color: '#6a5a50', pos: [0, 10.2, -3], rot: [-0.72, 0, 0] },
      { geo: box(6, 20, 6), color: '#e4ddcd', pos: [0, 10, 13] }, { geo: new THREE.ConeGeometry(4.4, 13, 4), color: '#5b6068', pos: [0, 26.5, 13], rot: [0, Math.PI / 4, 0] },
      { geo: box(0.3, 3, 0.3), color: '#c9a64a', pos: [0, 34.5, 13] }, { geo: box(1.6, 0.3, 0.3), color: '#c9a64a', pos: [0, 35, 13] }, { geo: box(2.2, 3.2, 0.1), color: '#3e3228', pos: [0, 1.6, 16.02] },
    ]);
    case 'pylon': {
      const parts: Part[] = [], H = 34, base = 3.4;
      for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
        const tilt = Math.atan2(base - 0.6, H);
        parts.push({ geo: cyl(0.16, 0.22, Math.hypot(H, base - 0.6), 4), color: '#9ea3a6', pos: [sx * (base + 0.6) / 2, H / 2, sz * (base + 0.6) / 2], rot: [sz * tilt, 0, -sx * tilt] });
      }
      for (const y of [8, 16, 24]) { const w = base + (0.6 - base) * (y / H); parts.push({ geo: box(w * 2, 0.2, 0.2), color: '#9ea3a6', pos: [0, y, w] }, { geo: box(w * 2, 0.2, 0.2), color: '#9ea3a6', pos: [0, y, -w] }); }
      parts.push({ geo: box(14, 0.5, 0.6), color: '#9ea3a6', pos: [0, H - 6, 0] }, { geo: box(10, 0.5, 0.6), color: '#9ea3a6', pos: [0, H - 1.5, 0] });
      for (const x of [-6.6, 0, 6.6]) parts.push({ geo: cyl(0.18, 0.18, 1.6, 5), color: '#5d7f8a', pos: [x, H - 7, 0] });
      return mergeParts(parts);
    }
    case 'boat': return mergeParts([
      { geo: box(2.1, 0.8, 5.6), color: '#e8e4da', pos: [0, 0.3, 0] }, { geo: new THREE.ConeGeometry(1.05, 1.6, 4), color: '#e8e4da', pos: [0, 0.3, 3.5], rot: [Math.PI / 2, Math.PI / 4, 0], scale: [1, 1, 0.55] },
      { geo: box(2.15, 0.2, 5.65), color: '#2f5f86', pos: [0, 0.05, 0] }, { geo: box(1.4, 0.9, 1.6), color: '#c9c3b4', pos: [0, 1.1, -0.8] },
    ]);
    case 'reeds': {
      const parts: Part[] = [];
      for (let i = 0; i < 7; i++) { const a = i * 2.4, r = 0.3 + (i % 3) * 0.45; parts.push({ geo: new THREE.ConeGeometry(0.22, 2.2 + (i % 3) * 0.5, 4), color: i % 2 ? '#7d8a4a' : '#98915a', pos: [Math.cos(a) * r, 1.1, Math.sin(a) * r] }); }
      return mergeParts(parts);
    }
    case 'lighthouse': return mergeParts([
      { geo: cyl(3.1, 4.3, 24, 14), color: '#f0ece2', pos: [0, 12, 0] }, { geo: cyl(3.5, 3.9, 3, 14), color: '#c33a2a', pos: [0, 8, 0] }, { geo: cyl(3.2, 3.5, 3, 14), color: '#c33a2a', pos: [0, 17, 0] },
      { geo: cyl(4.2, 4.2, 0.5, 14), color: '#3b3f44', pos: [0, 24.2, 0] }, { geo: cyl(2.4, 2.4, 3, 10), color: '#fff4c2', pos: [0, 26, 0] }, { geo: new THREE.ConeGeometry(2.9, 2.6, 10), color: '#c33a2a', pos: [0, 28.8, 0] },
      { geo: box(6, 3.2, 5), color: '#e8e4da', pos: [4.5, 1.6, 0] },
    ]);
    case 'boathouse': return mergeParts([
      { geo: box(8, 5, 13), color: '#7a5a3e', pos: [0, 2.5, 0] }, { geo: box(8.8, 0.3, 5), color: '#4f5a60', pos: [0, 5.9, 2.2], rot: [0.5, 0, 0] }, { geo: box(8.8, 0.3, 5), color: '#4f5a60', pos: [0, 5.9, -2.2], rot: [-0.5, 0, 0] },
      { geo: box(5, 3.8, 0.1), color: '#2e3a40', pos: [0, 1.9, 6.52] },
    ]);
    case 'car': return mergeParts([{ geo: box(1.8, 0.8, 4.2), color: '#ffffff', pos: [0, 0.6, 0] }, { geo: box(1.6, 0.6, 2.2), color: '#d8dde2', pos: [0, 1.3, -0.3] }]);
    default: return null;
  }
}

export function makeTexture(w: number, h: number, draw: (ctx: CanvasRenderingContext2D) => void, repeat = true): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  draw(ctx);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  if (repeat) tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

/** Deterministic speckle so surfaces never read as flat plastic. */
export function speckle(ctx: CanvasRenderingContext2D, w: number, h: number, count: number, tones: string[], seed: string) {
  const rng = createSeededRandom(FIELD_COMPOSITION_SEED, seed);
  for (let i = 0; i < count; i++) {
    ctx.globalAlpha = 0.08 + rng.next() * 0.16;
    ctx.fillStyle = tones[Math.floor(rng.next() * tones.length)];
    ctx.fillRect(rng.next() * w, rng.next() * h, 1 + rng.next() * 2.4, 1 + rng.next() * 2.4);
  }
  ctx.globalAlpha = 1;
}

const roadTexture = (surface: 'asphalt' | 'gravel' | 'dirt'): THREE.CanvasTexture =>
  makeTexture(128, 256, (ctx) => {
    // u = across the road, v = 12 m along it. Wear follows traffic: wheel paths, eroded edges.
    const wheelPaths = (tone: string, alpha: number, w: number) => {
      ctx.globalAlpha = alpha; ctx.fillStyle = tone;
      for (const x of [26, 46, 82, 102]) ctx.fillRect(x - w / 2, 0, w, 256);
      ctx.globalAlpha = 1;
    };
    const ragged = (tone: string, depth: number, seed: string) => {
      const rng = createSeededRandom(FIELD_COMPOSITION_SEED, seed);
      ctx.fillStyle = tone;
      for (let y = 0; y < 256; y += 4) {
        ctx.fillRect(0, y, 2 + rng.next() * depth, 4);
        ctx.fillRect(128 - 2 - rng.next() * depth, y, 2 + depth, 4);
      }
    };
    if (surface === 'asphalt') {
      ctx.fillStyle = '#50545a'; ctx.fillRect(0, 0, 128, 256);
      speckle(ctx, 128, 256, 2600, ['#3c4043', '#6d7175', '#585c5f', '#7a7d80'], 'road-asphalt');
      wheelPaths('#2f3236', 0.22, 12);
      // A patched repair and a few hairline cracks.
      ctx.fillStyle = 'rgba(40,43,46,0.35)'; ctx.fillRect(70, 150, 34, 40);
      ctx.strokeStyle = 'rgba(30,32,34,0.5)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(14, 20); ctx.lineTo(20, 60); ctx.lineTo(16, 96); ctx.moveTo(110, 200); ctx.lineTo(104, 236); ctx.stroke();
      ragged('rgba(110,120,80,0.55)', 4, 'asphalt-edge');
      ctx.fillStyle = '#e9e6d6'; ctx.fillRect(8, 0, 3, 256); ctx.fillRect(117, 0, 3, 256);
      ctx.fillStyle = '#e8c85a'; ctx.fillRect(62, 16, 4, 92); ctx.fillRect(62, 144, 4, 92);
    } else if (surface === 'gravel') {
      ctx.fillStyle = '#b3a891'; ctx.fillRect(0, 0, 128, 256);
      speckle(ctx, 128, 256, 4200, ['#8f8571', '#cbc0aa', '#a1977f', '#6f6757'], 'road-gravel');
      wheelPaths('#786c58', 0.3, 14);
      ctx.fillStyle = 'rgba(120,150,80,0.3)'; ctx.fillRect(58, 0, 12, 256); // grassy crown
      ragged('rgba(110,140,70,0.6)', 10, 'gravel-edge');
    } else {
      ctx.fillStyle = '#a4825a'; ctx.fillRect(0, 0, 128, 256);
      speckle(ctx, 128, 256, 3000, ['#876a45', '#bd9a6d', '#7a5f3d'], 'road-dirt');
      wheelPaths('#604a30', 0.38, 16);
      ctx.fillStyle = 'rgba(110,140,70,0.45)'; ctx.fillRect(56, 0, 16, 256);
      ragged('rgba(100,135,62,0.7)', 14, 'dirt-edge');
    }
  });

const cropRowTexture = (): THREE.CanvasTexture =>
  makeTexture(128, 128, (ctx) => {
    // 16 m tile: 16 rows of crop with darker soil furrows between them; multiplied by parcel colour.
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, 128, 128);
    for (let i = 0; i < 16; i++) {
      ctx.fillStyle = 'rgba(60,40,20,0.22)'; ctx.fillRect(i * 8, 0, 3, 128);
      ctx.fillStyle = 'rgba(255,255,230,0.3)'; ctx.fillRect(i * 8 + 5, 0, 2, 128);
    }
    speckle(ctx, 128, 128, 700, ['#000000', '#ffffff', '#5a4020'], 'crop-rows');
  });

/** Per-region tree palette. The shared instanced-tree geometry stays the same; only the
 * colours change, which is what keeps a canyon cottonwood from reading as a meadow oak.
 * Regions not listed fall back to `meadow`. */
const TREE_PALETTES: Partial<Record<TerrainType, { canopy: string; canopyLit: string; conifer: string; coniferTip: string; shrub: string; trunk: string; emissive: string }>> = {
  meadow: { canopy: '#3f7d36', canopyLit: '#45853b', conifer: '#2f6a3a', coniferTip: '#285a33', shrub: '#4d8a3c', trunk: '#5c4326', emissive: '#18351c' },
  canyon: { canopy: '#6d8a46', canopyLit: '#7d9a52', conifer: '#6f6a3c', coniferTip: '#625d34', shrub: '#8a8150', trunk: '#6a4632', emissive: '#2a2a14' },
};

/** Boulder tint per region (The Field's weathered grey; Red Canyon's sandstone, from
 * REGION_ART_BIBLE.canyon.accentColors[1]). */
const ROCK_COLORS: Partial<Record<TerrainType, string>> = { meadow: '#a9a396', canyon: '#c2764a' };

export class FieldWorld {
  readonly root = new THREE.Group();
  private readonly lod: LodEntry[] = [];
  private readonly disposables: Array<{ dispose(): void }> = [];
  private readonly lastCam = new THREE.Vector3(1e9, 0, 1e9);
  private dirty = true;
  private disposed = false;
  /** How many InstancedMesh/Mesh objects are managed by the density LOD (for diagnostics/tests). */
  get lodCount(): number { return this.lod.length; }

  private readonly grid: TerrainGridSampler;
  private readonly layout: FieldLayout;
  private readonly seed: string;
  private readonly terrain: TerrainType;

  constructor(grid: TerrainGridSampler, layout: FieldLayout, opts: { seed?: string; terrain?: TerrainType } = {}) {
    this.grid = grid;
    this.layout = layout;
    this.seed = opts.seed ?? FIELD_COMPOSITION_SEED;
    this.terrain = opts.terrain ?? 'meadow';
    this.root.name = `region-world:${this.terrain}`;
    this.buildRoads();
    this.buildPatches();
    this.buildBridge();
    this.buildProcProps();
    this.buildTreeMasses();
    this.buildPowerWires();
  }

  /** Three sagging conductors per span between the pylons of each line: one LineSegments per line. */
  private buildPowerWires() {
    const mat = new THREE.LineBasicMaterial({ color: '#3a3d40', transparent: true, opacity: 0.75 });
    this.disposables.push(mat);
    for (const line of POWER_LINES) {
      const pylons = pylonPositions(line).map((p) => ({ ...p, y: this.grid.height(p.x, p.z) + 27 }));
      const pts: number[] = [];
      let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
      for (let i = 0; i < pylons.length - 1; i++) {
        const a = pylons[i], b = pylons[i + 1];
        x0 = Math.min(x0, a.x, b.x); x1 = Math.max(x1, a.x, b.x); z0 = Math.min(z0, a.z, b.z); z1 = Math.max(z1, a.z, b.z);
        const span = Math.hypot(b.x - a.x, b.z - a.z), sag = span * 0.028;
        for (const off of [-6.6, 0, 6.6]) {
          const ax = a.x + Math.cos(a.yaw) * off, az = a.z - Math.sin(a.yaw) * off, bx = b.x + Math.cos(b.yaw) * off, bz = b.z - Math.sin(b.yaw) * off;
          for (let k = 0; k < 10; k++) {
            for (const t of [k / 10, (k + 1) / 10]) pts.push(ax + (bx - ax) * t, a.y + (b.y - a.y) * t - sag * 4 * t * (1 - t), az + (bz - az) * t);
          }
        }
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
      this.disposables.push(geo);
      const wires = new THREE.LineSegments(geo, mat);
      wires.name = 'power:wires';
      wires.frustumCulled = false;
      this.addLod(wires, { cx: (x0 + x1) / 2, cz: (z0 + z1) / 2, r: Math.hypot(x1 - x0, z1 - z0) / 2 }, 2500);
    }
  }

  // ---- density LOD ---------------------------------------------------------------------------
  private addLod(obj: THREE.Object3D, bounds: { cx: number; cz: number; r: number }, far: number, near = 0) {
    obj.visible = false;
    this.lod.push({ obj, ...bounds, near, far });
    this.root.add(obj);
    this.dirty = true;
  }

  /** Flip chunk visibility from the camera position (cheap; only when the camera moved). */
  update(cam: THREE.Vector3): void {
    if (!this.dirty && this.lastCam.distanceToSquared(cam) < 400) return;
    this.lastCam.copy(cam);
    this.dirty = false;
    for (const e of this.lod) {
      const d = Math.max(0, Math.hypot(cam.x - e.cx, cam.z - e.cz) - e.r);
      e.obj.visible = d <= e.far && d + 2 * e.r >= e.near;
    }
  }

  // ---- ground: roads / parcels ---------------------------------------------------------------
  private buildRoads() {
    const bySurface = new Map<string, { positions: number[]; uvs: number[]; index: number[] }>();
    for (const path of this.layout.roads) {
      const ribbon = buildRoadRibbon(path, this.grid);
      const bucket = bySurface.get(path.def.surface) ?? bySurface.set(path.def.surface, { positions: [], uvs: [], index: [] }).get(path.def.surface)!;
      const base = bucket.positions.length / 3;
      bucket.positions.push(...ribbon.positions);
      bucket.uvs.push(...ribbon.uvs);
      bucket.index.push(...ribbon.index.map((i) => i + base));
    }
    const offsets = { asphalt: -6, gravel: -5, dirt: -4 } as const;
    for (const [surface, data] of bySurface) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(data.positions, 3));
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(data.uvs, 2));
      geo.setIndex(data.index);
      geo.computeVertexNormals();
      const tex = roadTexture(surface as 'asphalt');
      // World-space macro/meso wear breaks the 12 m texture repeat (Art Bible §6.8).
      const mat = applySurfaceDetail(new THREE.MeshStandardMaterial({ map: tex, roughness: surface === 'asphalt' ? 0.88 : 1, metalness: 0, polygonOffset: true, polygonOffsetFactor: offsets[surface as keyof typeof offsets], polygonOffsetUnits: offsets[surface as keyof typeof offsets] }), { macro: 0.5, meso: 0.6, soil: 0, bump: 0.5, fineScaleM: 3.1 });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.name = `roads:${surface}`;
      mesh.receiveShadow = true;
      this.root.add(mesh);
      this.disposables.push(geo, mat, tex);
    }
  }

  private buildPatches() {
    const build = (patches: GroundPatch[], textured: boolean) => {
      const positions: number[] = [], colors: number[] = [], uvs: number[] = [], index: number[] = [];
      const rng = createSeededRandom(this.seed, 'patch-shade');
      for (const p of patches) {
        const nx = Math.max(1, Math.ceil(p.widthM / 26)), nz = Math.max(1, Math.ceil(p.depthM / 26));
        const c = Math.cos(p.headingRad), s = Math.sin(p.headingRad), ra = p.rowAngleRad, rc = Math.cos(ra), rs = Math.sin(ra);
        const color = new THREE.Color(p.color), base = positions.length / 3;
        for (let iz = 0; iz <= nz; iz++) for (let ix = 0; ix <= nx; ix++) {
          const lx = (ix / nx - 0.5) * p.widthM, lz = (iz / nz - 0.5) * p.depthM;
          const x = p.center[0] + lx * c + lz * s, z = p.center[1] - lx * s + lz * c;
          positions.push(x, this.grid.height(x, z) + p.liftM, z);
          const shade = 1 + (rng.next() - 0.5) * 0.07;
          colors.push(color.r * shade, color.g * shade, color.b * shade);
          uvs.push((lx * rc + lz * rs) / 16, (-lx * rs + lz * rc) / 16);
        }
        for (let iz = 0; iz < nz; iz++) for (let ix = 0; ix < nx; ix++) {
          const a = base + iz * (nx + 1) + ix, b = a + 1, d = a + nx + 1, e = d + 1;
          index.push(a, d, b, b, d, e);
        }
      }
      if (positions.length === 0) return;
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
      geo.setIndex(index);
      geo.computeVertexNormals();
      const tex = textured ? cropRowTexture() : null;
      const off = textured ? -2 : -3;
      const mat = applySurfaceDetail(new THREE.MeshStandardMaterial({ vertexColors: true, map: tex, roughness: 1, polygonOffset: true, polygonOffsetFactor: off, polygonOffsetUnits: off }), { macro: 0.6, soil: textured ? 0.25 : 0.15 });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.name = textured ? 'parcels:crops' : 'parcels:surfaces';
      mesh.receiveShadow = true;
      this.root.add(mesh);
      this.disposables.push(geo, mat);
      if (tex) this.disposables.push(tex);
    };
    build(this.layout.patches.filter((p) => p.kind === 'field'), true);
    build(this.layout.patches.filter((p) => p.kind === 'plain'), false);
  }

  /** One recognisable truss bridge where ROAD_MAIN crosses the river: deck, kerbs, rails,
   * piers and two red Warren trusses, merged into a single vertex-coloured mesh. */
  private buildBridge() {
    const road: RoadPath | undefined = this.layout.roads.find((r) => r.def.bridge);
    if (!road) return;
    const span = road.points.filter((p) => p.onBridge);
    if (span.length < 3) return;
    const first = span[0], last = span[span.length - 1], mid = span[Math.floor(span.length / 2)];
    const L = Math.hypot(last.x - first.x, last.z - first.z) + 6, W = road.def.widthM + 3.2, deckY = mid.y;
    const yaw = Math.atan2(last.x - first.x, last.z - first.z);
    const bed = Math.min(...span.map((p) => p.groundY)) - 1;
    const parts: Part[] = [
      { geo: box(W, 1.0, L), color: '#8d9093', pos: [0, -0.5, 0] },
      { geo: box(0.5, 0.7, L), color: '#a5a8aa', pos: [-W / 2 + 0.25, 0.35, 0] }, { geo: box(0.5, 0.7, L), color: '#a5a8aa', pos: [W / 2 - 0.25, 0.35, 0] },
    ];
    const pierH = deckY - bed;
    for (const z of [-L * 0.36, -L * 0.12, L * 0.12, L * 0.36]) parts.push({ geo: box(W - 1.6, pierH, 2.2), color: '#77797b', pos: [0, -1 - pierH / 2 + 0.5, z] });
    const truss = Math.min(L * 0.8, 76), panels = 8, pw = truss / panels, H = 12;
    for (const sx of [-1, 1]) {
      const x = sx * (W / 2 - 0.5);
      parts.push({ geo: box(1.0, 1.0, truss), color: '#c5432c', pos: [x, H, 0] }, { geo: box(1.0, 0.8, truss), color: '#c5432c', pos: [x, 0.9, 0] });
      for (let i = 0; i <= panels; i++) parts.push({ geo: box(0.7, H, 0.7), color: '#c5432c', pos: [x, H / 2 + 0.5, -truss / 2 + i * pw] });
      for (let i = 0; i < panels; i++) {
        const dz = pw, len = Math.hypot(dz, H), ang = Math.atan2(dz, H) * (i % 2 ? -1 : 1);
        parts.push({ geo: box(0.6, len, 0.6), color: '#b5391f', pos: [x, H / 2 + 0.5, -truss / 2 + (i + 0.5) * pw], rot: [ang, 0, 0] });
      }
    }
    for (let i = 0; i <= panels; i += 2) parts.push({ geo: box(W - 0.4, 0.7, 0.7), color: '#c5432c', pos: [0, H + 0.5, -truss / 2 + i * pw] });
    for (const sx of [-1, 1]) {
      parts.push({ geo: box(0.1, 0.1, L), color: '#dedbd0', pos: [sx * (W / 2 - 0.15), 1.5, 0] });
      for (let z = -L / 2 + 1; z <= L / 2; z += 4) parts.push({ geo: box(0.12, 1.2, 0.12), color: '#dedbd0', pos: [sx * (W / 2 - 0.15), 1.1, z] });
    }
    const geo = mergeParts(parts);
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, metalness: 0.15 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = 'landmark:bridge';
    mesh.position.set((first.x + last.x) / 2, deckY, (first.z + last.z) / 2);
    mesh.rotation.y = yaw;
    this.disposables.push(geo, mat);
    this.addLod(mesh, { cx: mesh.position.x, cz: mesh.position.z, r: 40 }, 8000);
  }

  // ---- placement -> chunked instances --------------------------------------------------------
  /** Lowest rendered-terrain height under a footprint so buildings on gentle slopes sit in, not on. */
  private baseY(x: number, z: number, radius: number): number {
    let y = this.grid.height(x, z);
    if (radius > 0) for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) y = Math.min(y, this.grid.height(x + dx * radius, z + dz * radius));
    return y - 0.05;
  }

  private chunked<T extends { x: number; z: number }>(items: T[], size: number): Array<{ items: T[]; cx: number; cz: number; r: number }> {
    const buckets = new Map<string, T[]>();
    for (const it of items) {
      const key = `${Math.floor(it.x / size)},${Math.floor(it.z / size)}`;
      (buckets.get(key) ?? buckets.set(key, []).get(key)!).push(it);
    }
    return [...buckets.values()].map((list) => {
      let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
      for (const it of list) { x0 = Math.min(x0, it.x); x1 = Math.max(x1, it.x); z0 = Math.min(z0, it.z); z1 = Math.max(z1, it.z); }
      return { items: list, cx: (x0 + x1) / 2, cz: (z0 + z1) / 2, r: Math.hypot(x1 - x0, z1 - z0) / 2 + 30 };
    });
  }

  private buildProcProps() {
    const all: Placement[] = [...this.layout.lots, ...this.layout.props];
    const byKind = new Map<PropKind, Placement[]>();
    for (const p of all) (byKind.get(p.kind) ?? byKind.set(p.kind, []).get(p.kind)!).push(p);
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0.05 });
    this.disposables.push(mat);
    for (const [kind, list] of byKind) {
      const cfg = PROC_PROPS[kind];
      if (!cfg) continue;
      const geo = buildPropGeometry(kind);
      if (!geo) continue;
      this.disposables.push(geo);
      const m = new THREE.Matrix4(), q = new THREE.Quaternion(), tint = new THREE.Color();
      for (const chunk of this.chunked(list, cfg.chunk)) {
        const mesh = new THREE.InstancedMesh(geo, mat, chunk.items.length);
        mesh.name = `props:${kind}`;
        chunk.items.forEach((p, i) => {
          const onWater = kind === 'jetty' || kind === 'boat' || kind === 'reeds';
          const waterY = lakeEdgeDistance(p.x, p.z) < 300 ? FIELD_LAKE.waterLevelM : SEA_LEVEL_M;
          const y = onWater ? waterY + (kind === 'jetty' ? 0.9 : kind === 'boat' ? 0.1 : -0.3)
            : this.baseY(p.x, p.z, kind === 'warehouse' ? 14 : kind === 'tank' || kind === 'silo' || kind === 'church' ? 5 : kind === 'townhouse' ? 4 : 0);
          q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, p.rotY);
          m.compose(new THREE.Vector3(p.x, y, p.z), q, new THREE.Vector3(p.scale, p.scale, p.scale));
          mesh.setMatrixAt(i, m);
          if (kind === 'townhouse') { tint.setHSL([0.08, 0.11, 0.02, 0.13, 0.55][i % 5], 0.35, 0.78 + (i % 3) * 0.08); mesh.setColorAt(i, tint); }
          if (kind === 'car' || kind === 'boat') { tint.setHSL((i * 0.37) % 1, 0.45, 0.45 + (i % 4) * 0.1); mesh.setColorAt(i, tint); }
          if (kind === 'barrel' || kind === 'crate') { tint.setHSL(kind === 'barrel' ? [0.02, 0.58, 0.1][i % 3] : 0.09 + (i % 3) * 0.04, 0.5, 0.75 + (i % 2) * 0.2); mesh.setColorAt(i, tint); }
        });
        mesh.instanceMatrix.needsUpdate = true;
        this.addLod(mesh, chunk, cfg.far);
      }
    }
  }

  // ---- tree masses (procedural, two detail levels) --------------------------------------------
  private buildTreeMasses() {
    const rng = createSeededRandom(this.seed, 'tree-geo');
    const pal = TREE_PALETTES[this.terrain] ?? TREE_PALETTES.meadow!;
    const geos = {
      broadleafHi: buildTreeClusterGeometry(rng, pal.canopy, pal.trunk),
      broadleafLo: mergeParts([{ geo: new THREE.IcosahedronGeometry(2.0, 0), color: pal.canopy, pos: [0, 3.3, 0], scale: [1, 0.95, 1] }, { geo: new THREE.IcosahedronGeometry(1.5, 0), color: pal.canopyLit, pos: [0.9, 4.1, 0.5] }, { geo: cyl(0.25, 0.3, 1.8, 4), color: pal.trunk, pos: [0, 0.9, 0] }]),
      coniferHi: mergeParts([{ geo: cyl(0.2, 0.32, 1.6, 5), color: pal.trunk, pos: [0, 0.8, 0] }, { geo: new THREE.ConeGeometry(1.9, 3.0, 8), color: pal.conifer, pos: [0, 2.7, 0] }, { geo: new THREE.ConeGeometry(1.5, 2.6, 8), color: pal.conifer, pos: [0, 4.3, 0] }, { geo: new THREE.ConeGeometry(1.0, 2.2, 8), color: pal.coniferTip, pos: [0, 5.7, 0] }]),
      coniferLo: mergeParts([{ geo: new THREE.ConeGeometry(1.9, 6.4, 6), color: pal.conifer, pos: [0, 3.5, 0] }]),
      shrub: mergeParts([{ geo: new THREE.IcosahedronGeometry(1.25, 1), color: pal.shrub, pos: [0, 0.9, 0], scale: [1.4, 0.8, 1.4] }]),
    };
    // Same subtle lift the previous tree pass used, so far crowns don't collapse to black.
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0, emissive: pal.emissive, emissiveIntensity: 0.34 });
    this.disposables.push(mat, ...Object.values(geos));
    const masses = this.layout.trees.filter((t) => !t.hero);
    const instance = (geo: THREE.BufferGeometry, list: TreePlacement[], size: number, far: number, near: number) => {
      const m = new THREE.Matrix4(), q = new THREE.Quaternion(), c = new THREE.Color();
      for (const chunk of this.chunked(list, size)) {
        const mesh = new THREE.InstancedMesh(geo, mat, chunk.items.length);
        mesh.name = 'trees:masses';
        chunk.items.forEach((t, i) => {
          q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, t.rotY);
          m.compose(new THREE.Vector3(t.x, this.grid.height(t.x, t.z) - 0.1, t.z), q, new THREE.Vector3(t.scale, t.scale * (0.9 + t.tint * 0.3), t.scale));
          mesh.setMatrixAt(i, m);
          c.setRGB(0.82 + t.tint * 0.3, 0.88 + t.tint * 0.18, 0.78 + t.tint * 0.24);
          mesh.setColorAt(i, c);
        });
        mesh.instanceMatrix.needsUpdate = true;
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
        this.addLod(mesh, chunk, far, near);
      }
    };
    const kind = (k: TreePlacement['kind']) => masses.filter((t) => t.kind === k);
    instance(geos.broadleafHi, kind('broadleaf'), 450, TREE_HI_FAR_M, 0);
    instance(geos.broadleafLo, kind('broadleaf'), 1500, TREE_FAR_M, TREE_HI_FAR_M);
    instance(geos.coniferHi, kind('conifer'), 450, TREE_HI_FAR_M, 0);
    instance(geos.coniferLo, kind('conifer'), 1500, TREE_FAR_M, TREE_HI_FAR_M);
    instance(geos.shrub, kind('shrub'), 450, SHRUB_FAR_M, 0);
  }

  // ---- GLB-backed content (async): buildings, airfield props, Quaternius trees and rocks ---------
  async hydrate(): Promise<void> {
    await Promise.all([this.hydrateGlbProps(), this.hydrateHeroTrees(), this.hydrateRocks()]);
  }

  private async hydrateGlbProps() {
    const all: Placement[] = [...this.layout.lots, ...this.layout.props];
    const byKind = new Map<PropKind, Placement[]>();
    for (const p of all) if (GLB_PROPS[p.kind]) (byKind.get(p.kind) ?? byKind.set(p.kind, []).get(p.kind)!).push(p);
    await Promise.all([...byKind].map(async ([kind, list]) => {
      const cfg = GLB_PROPS[kind]!;
      try {
        const raw = await assetLibrary.loadUri(cfg.uri);
        if (this.disposed) return;
        const template = cfg.blender ? orientWorldProp(raw, 0) : raw;
        for (const chunk of this.chunked(list, cfg.chunk)) {
          const placements: TreeClusterPlacement[] = chunk.items.map((p) => ({ x: p.x, z: p.z, groundY: this.baseY(p.x, p.z, cfg.blender ? 4 : 0), scale: p.scale, rotationY: p.rotY }));
          const group = instanceGltf(template, placements);
          group.name = `glb:${kind}`;
          group.traverse((o) => { o.castShadow = false; });
          this.addLod(group, chunk, cfg.far);
        }
      } catch (err) { console.warn(`FieldWorld: ${kind} failed to load`, err); }
    }));
  }

  private async hydrateHeroTrees() {
    const heroes = this.layout.trees.filter((t) => t.hero);
    for (const k of ['broadleaf', 'conifer'] as const) {
      const list = heroes.filter((t) => t.kind === k);
      const names = TREE_URIS[k];
      await Promise.all(names.map(async (name, n) => {
        const part = list.filter((_, i) => i % names.length === n);
        if (part.length === 0) return;
        try {
          const template = await assetLibrary.loadUri(`/assets/regions/field/vegetation/${name}_lod2.glb`);
          if (this.disposed) return;
          for (const chunk of this.chunked(part, 800)) {
            const group = instanceGltf(template, chunk.items.map((t) => ({ x: t.x, z: t.z, groundY: this.grid.height(t.x, t.z) - 0.1, scale: t.scale, rotationY: t.rotY })));
            group.name = `trees:hero:${name}`;
            group.traverse((o) => { o.castShadow = false; });
            this.addLod(group, chunk, HERO_TREE_FAR_M);
          }
        } catch (err) { console.warn(`FieldWorld: tree ${name} failed to load`, err); }
      }));
    }
  }

  private async hydrateRocks() {
    const names = ['rock_medium_1', 'rock_medium_2', 'rock_medium_3'];
    const rocks = this.layout.rocks;
    try {
      await Promise.all(names.map(async (name, k) => {
        const template = await assetLibrary.loadUri(`/assets/regions/field/rocks/${name}.glb`);
        if (this.disposed) return;
        // The source rocks are near-black; lift them to weathered grey so they read as boulders.
        template.traverse((o) => {
          if (o instanceof THREE.Mesh) {
            const mat = (o.material as THREE.MeshStandardMaterial).clone();
            mat.color.set(ROCK_COLORS[this.terrain] ?? '#a9a396'); mat.map = null; mat.vertexColors = false;
            o.material = mat;
          }
        });
        const mine = (r: RockPlacement) => r.kind === (['rock1', 'rock2', 'rock3'] as const)[k];
        for (const large of [false, true]) {
          const list = rocks.filter((r) => mine(r) && (r.scale >= ROCK_LARGE_SCALE) === large);
          for (const chunk of this.chunked(list, 800)) {
            const group = instanceGltf(template, chunk.items.map((r) => ({ x: r.x, z: r.z, groundY: this.grid.height(r.x, r.z) + r.scale * 0.1, scale: r.scale, rotationY: r.rotY })));
            group.name = `rocks:${name}`;
            group.traverse((o) => { o.castShadow = false; });
            this.addLod(group, chunk, large ? ROCK_LARGE_FAR_M : ROCK_SMALL_FAR_M);
          }
        }
      }));
    } catch (err) { console.warn('FieldWorld: rocks failed to load', err); }
  }

  dispose() {
    this.disposed = true;
    for (const d of this.disposables) d.dispose();
  }
}
