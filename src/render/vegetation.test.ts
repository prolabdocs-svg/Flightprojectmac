import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { createSeededRandom } from '../core/seededRandom';
import { buildTreeClusterGeometry, buildTreeClusterInstancedMesh } from './vegetation';

describe('vegetation tree clusters', () => {
  it('builds a merged trunk+canopy geometry with baked vertex colors, not a bare cone', () => {
    const rng = createSeededRandom('vegetation-test', 'seed-a');
    const geo = buildTreeClusterGeometry(rng, '#3f6b3a');
    expect(geo.attributes.color).toBeDefined();
    expect(geo.attributes.position.count).toBeGreaterThan(0);
    // A single cone proxy has one radius extreme; a trunk+3-blob cluster spans a much
    // taller bounding box than any single primitive used previously.
    geo.computeBoundingBox();
    const height = geo.boundingBox!.max.y - geo.boundingBox!.min.y;
    expect(height).toBeGreaterThan(3);
  });

  it('is deterministic for a given seed', () => {
    const rngA = createSeededRandom('vegetation-test', 'seed-b');
    const rngB = createSeededRandom('vegetation-test', 'seed-b');
    const a = buildTreeClusterGeometry(rngA, '#3f6b3a');
    const b = buildTreeClusterGeometry(rngB, '#3f6b3a');
    expect(Array.from(a.attributes.position.array)).toEqual(Array.from(b.attributes.position.array));
  });

  it('instances placements into one InstancedMesh with matching count', () => {
    const rng = createSeededRandom('vegetation-test', 'seed-c');
    const mesh = buildTreeClusterInstancedMesh(
      [
        { x: 0, z: 0, groundY: 0, scale: 1, rotationY: 0 },
        { x: 10, z: -5, groundY: 1.2, scale: 0.8, rotationY: 1.1 },
      ],
      rng,
      '#3f6b3a',
    );
    expect(mesh.count).toBe(2);
    const m = new THREE.Matrix4();
    mesh.getMatrixAt(1, m);
    const pos = new THREE.Vector3().setFromMatrixPosition(m);
    expect(pos.x).toBeCloseTo(10);
    expect(pos.y).toBeCloseTo(1.2);
    expect(pos.z).toBeCloseTo(-5);
  });
});
