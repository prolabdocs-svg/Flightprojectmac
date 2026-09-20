import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { SeededRandom } from '../core/seededRandom';

/** A single tree-cluster geometry: a trunk plus 2-3 overlapping rounded canopy blobs,
 * merged into one static BufferGeometry with baked-in vertex colors (brown trunk,
 * green canopy) and smoothed normals. Read as a proper tree crown from the air instead
 * of the previous single flat-shaded cone ("espiga"). Built once and reused across every
 * instance via InstancedMesh, so a whole stand of trees stays one draw call. */
export function buildTreeClusterGeometry(rng: SeededRandom, canopyColor: string, trunkColor = '#5c4326'): THREE.BufferGeometry {
  const trunk = new THREE.CylinderGeometry(0.22, 0.32, 2.2, 6).toNonIndexed();
  trunk.translate(0, 1.1, 0);
  paintVertexColor(trunk, trunkColor);

  const canopyParts: THREE.BufferGeometry[] = [trunk];
  const blobs = 3;
  for (let i = 0; i < blobs; i++) {
    const radius = 1.5 + rng.next() * 0.6;
    // Smooth normals are computed on the indexed geometry (so shared vertices average
    // correctly) before flattening to non-indexed for the merge below — reversing the
    // order would bake flat per-face normals onto the duplicated vertices.
    const indexedBlob = new THREE.IcosahedronGeometry(radius, 1);
    indexedBlob.computeVertexNormals();
    const blob = indexedBlob.toNonIndexed();
    const angle = (i / blobs) * Math.PI * 2 + rng.next() * 0.6;
    const offset = i === 0 ? 0 : 0.85;
    blob.translate(Math.cos(angle) * offset, 2.1 + rng.next() * 0.5, Math.sin(angle) * offset);
    paintVertexColor(blob, shadeColor(canopyColor, (rng.next() - 0.5) * 0.12));
    canopyParts.push(blob);
  }

  const merged = mergeGeometries(canopyParts, false);
  merged.computeVertexNormals();
  return merged;
}

function paintVertexColor(geo: THREE.BufferGeometry, hex: string): void {
  const color = new THREE.Color(hex);
  const count = geo.attributes.position.count;
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) colors.set([color.r, color.g, color.b], i * 3);
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
}

function shadeColor(hex: string, delta: number): string {
  const c = new THREE.Color(hex);
  c.r = THREE.MathUtils.clamp(c.r + delta, 0, 1);
  c.g = THREE.MathUtils.clamp(c.g + delta, 0, 1);
  c.b = THREE.MathUtils.clamp(c.b + delta, 0, 1);
  return `#${c.getHexString()}`;
}

export interface TreeClusterPlacement {
  x: number;
  z: number;
  groundY: number;
  scale: number;
  rotationY: number;
}

/** Builds one InstancedMesh of `buildTreeClusterGeometry`, positioned at each placement's
 * ground point. Kept separate from placement logic so callers (FlightScene, WorldEnvironment)
 * supply their own terrain-aware sampling/runway-avoidance while sharing the same tree shape. */
export function buildTreeClusterInstancedMesh(placements: TreeClusterPlacement[], rng: SeededRandom, canopyColor: string): THREE.InstancedMesh {
  const geo = buildTreeClusterGeometry(rng, canopyColor);
  // Vertex colours are deliberately subtle under a low-angle sun. A small leaf-green
  // emissive lift keeps distant forest crowns readable instead of collapsing into black
  // blobs against the horizon; it is not a glow and costs no light/shadow pass.
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0, flatShading: false, emissive: '#18351c', emissiveIntensity: 0.32 });
  const mesh = new THREE.InstancedMesh(geo, mat, placements.length);
  mesh.castShadow = true;
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  for (let i = 0; i < placements.length; i++) {
    const p = placements[i];
    q.setFromEuler(new THREE.Euler(0, p.rotationY, 0));
    m.compose(new THREE.Vector3(p.x, p.groundY, p.z), q, new THREE.Vector3(p.scale, p.scale, p.scale));
    mesh.setMatrixAt(i, m);
  }
  mesh.instanceMatrix.needsUpdate = true;
  return mesh;
}
