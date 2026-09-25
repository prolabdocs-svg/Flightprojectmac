import * as THREE from 'three';

/**
 * Shared low-poly material language for world props (art bible: silhouette and geometry over texture). Props are built
 * in many places with ad-hoc roughness/metalness; this sweep normalises them to one rule set so a hangar, a silo, a
 * crane and a fence post read as the same universe:
 *  - faceted shading (flatShading) so the few polygons are a deliberate style, not a smoothed-over budget cut;
 *  - matte painted surfaces (roughness >= 0.6) and metalness capped at 0.25 — without close reflections, metallic props
 *    render as dark smudges that break the palette at distance.
 * Textured, transparent, vertex-shader-patched (surface detail, water) and physical materials are left alone.
 */
export const LOW_POLY_RULES = { minRoughness: 0.6, maxMetalness: 0.25 } as const;

const styled = new WeakSet<THREE.Material>();

export function styleLowPolyMaterial(m: THREE.Material): boolean {
  if (styled.has(m)) return false;
  styled.add(m);
  if (!(m instanceof THREE.MeshStandardMaterial) || m instanceof THREE.MeshPhysicalMaterial) return false;
  if (m.map || m.transparent || m.onBeforeCompile !== THREE.Material.prototype.onBeforeCompile) return false;
  m.roughness = Math.max(m.roughness, LOW_POLY_RULES.minRoughness);
  m.metalness = Math.min(m.metalness, LOW_POLY_RULES.maxMetalness);
  m.flatShading = true;
  m.needsUpdate = true;
  return true;
}

/** Applies the rules to every mesh under `root`, skipping `exclude` subtrees (the hero aircraft keeps its authored PBR). */
export function applyLowPolyStyle(root: THREE.Object3D, exclude?: THREE.Object3D): number {
  let n = 0;
  const visit = (o: THREE.Object3D) => {
    if (o === exclude) return;
    const mat = (o as THREE.Mesh).material;
    if (mat) for (const m of Array.isArray(mat) ? mat : [mat]) if (styleLowPolyMaterial(m)) n++;
    for (const c of o.children) visit(c);
  };
  visit(root);
  return n;
}
