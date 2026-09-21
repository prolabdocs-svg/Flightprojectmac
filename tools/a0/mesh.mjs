// Mesh helpers for the A0 finishing pipeline (tools/a0/split_a0.mjs). Plain arrays, no deps,
// so the same code runs in Node and in the browser harness.

/** Per-triangle data from an indexed position/normal buffer. */
export function triangleData(P, N, I) {
  const n = I.length / 3;
  const c = new Float32Array(n * 3);
  const nr = new Float32Array(n * 3);
  for (let t = 0; t < n; t++) {
    const a = I[t * 3], b = I[t * 3 + 1], d = I[t * 3 + 2];
    for (let k = 0; k < 3; k++) {
      c[t * 3 + k] = (P[a * 3 + k] + P[b * 3 + k] + P[d * 3 + k]) / 3;
      nr[t * 3 + k] = N[a * 3 + k] + N[b * 3 + k] + N[d * 3 + k];
    }
    const l = Math.hypot(nr[t * 3], nr[t * 3 + 1], nr[t * 3 + 2]) || 1;
    nr[t * 3] /= l; nr[t * 3 + 1] /= l; nr[t * 3 + 2] /= l;
  }
  return { count: n, c, n: nr };
}

/**
 * Local wall-to-wall thickness per triangle: a ray from each centroid straight into the solid,
 * distance to the far wall. Wires ~ 0.01, tubes ~ 0.02-0.03, fabric skin ~ 0.03-0.045, blobs >= max.
 */
export function thickness(P, I, tri, maxT = 0.08, cell = 0.02) {
  const n = tri.count;
  const grid = new Map();
  const key = (x, y, z) => ((x + 512) * 1024 + (y + 512)) * 1024 + (z + 512);
  const tmin = new Float32Array(n * 3), tmax = new Float32Array(n * 3);
  for (let t = 0; t < n; t++) {
    for (let k = 0; k < 3; k++) {
      let lo = 1e9, hi = -1e9;
      for (let v = 0; v < 3; v++) { const q = P[I[t * 3 + v] * 3 + k]; lo = Math.min(lo, q); hi = Math.max(hi, q); }
      tmin[t * 3 + k] = lo; tmax[t * 3 + k] = hi;
    }
    for (let x = Math.floor(tmin[t * 3] / cell); x <= Math.floor(tmax[t * 3] / cell); x++)
      for (let y = Math.floor(tmin[t * 3 + 1] / cell); y <= Math.floor(tmax[t * 3 + 1] / cell); y++)
        for (let z = Math.floor(tmin[t * 3 + 2] / cell); z <= Math.floor(tmax[t * 3 + 2] / cell); z++) {
          const kk = key(x, y, z); let l = grid.get(kk); if (!l) grid.set(kk, l = []); l.push(t);
        }
  }
  const out = new Float32Array(n).fill(maxT);
  const seen = new Int32Array(n).fill(-1);
  for (let t = 0; t < n; t++) {
    const ox = tri.c[t * 3] - tri.n[t * 3] * 1e-4, oy = tri.c[t * 3 + 1] - tri.n[t * 3 + 1] * 1e-4, oz = tri.c[t * 3 + 2] - tri.n[t * 3 + 2] * 1e-4;
    const dx = -tri.n[t * 3], dy = -tri.n[t * 3 + 1], dz = -tri.n[t * 3 + 2];
    let best = maxT;
    for (let s = 0; s <= maxT; s += cell * 0.5) {
      const kk = key(Math.floor((ox + dx * s) / cell), Math.floor((oy + dy * s) / cell), Math.floor((oz + dz * s) / cell));
      const l = grid.get(kk); if (!l) continue;
      for (const u of l) {
        if (u === t || seen[u] === t) continue; seen[u] = t;
        if (tri.n[u * 3] * dx + tri.n[u * 3 + 1] * dy + tri.n[u * 3 + 2] * dz < 0.2) continue;
        const a = I[u * 3] * 3, b = I[u * 3 + 1] * 3, d = I[u * 3 + 2] * 3;
        const e1x = P[b] - P[a], e1y = P[b + 1] - P[a + 1], e1z = P[b + 2] - P[a + 2];
        const e2x = P[d] - P[a], e2y = P[d + 1] - P[a + 1], e2z = P[d + 2] - P[a + 2];
        const px = dy * e2z - dz * e2y, py = dz * e2x - dx * e2z, pz = dx * e2y - dy * e2x;
        const det = e1x * px + e1y * py + e1z * pz;
        if (Math.abs(det) < 1e-12) continue;
        const inv = 1 / det, tx = ox - P[a], ty = oy - P[a + 1], tz = oz - P[a + 2];
        const uu = (tx * px + ty * py + tz * pz) * inv; if (uu < 0 || uu > 1) continue;
        const qx = ty * e1z - tz * e1y, qy = tz * e1x - tx * e1z, qz = tx * e1y - ty * e1x;
        const vv = (dx * qx + dy * qy + dz * qz) * inv; if (vv < 0 || uu + vv > 1) continue;
        const tt = (e2x * qx + e2y * qy + e2z * qz) * inv;
        if (tt > 1e-4 && tt < best) best = tt;
      }
    }
    out[t] = best;
  }
  return out;
}
