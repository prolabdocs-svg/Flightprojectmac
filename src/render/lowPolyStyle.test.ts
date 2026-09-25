import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { applyLowPolyStyle, LOW_POLY_RULES } from './lowPolyStyle';

describe('low-poly style sweep', () => {
  it('normalises plain props, leaves the excluded aircraft and textured/transparent materials alone', () => {
    const root = new THREE.Group(), plane = new THREE.Group();
    const chrome = new THREE.MeshStandardMaterial({ roughness: 0.2, metalness: 0.9 });
    const glass = new THREE.MeshStandardMaterial({ roughness: 0.1, transparent: true });
    const engine = new THREE.MeshStandardMaterial({ roughness: 0.3, metalness: 0.8 });
    root.add(new THREE.Mesh(new THREE.BoxGeometry(), chrome), new THREE.Mesh(new THREE.BoxGeometry(), glass), plane);
    plane.add(new THREE.Mesh(new THREE.BoxGeometry(), engine));
    expect(applyLowPolyStyle(root, plane)).toBe(1);
    expect(chrome).toMatchObject({ roughness: LOW_POLY_RULES.minRoughness, metalness: LOW_POLY_RULES.maxMetalness, flatShading: true });
    expect(glass.roughness).toBe(0.1);
    expect(engine.metalness).toBe(0.8);
    expect(applyLowPolyStyle(root, plane)).toBe(0); // memoised
  });
});
