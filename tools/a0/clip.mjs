// Half-space clipping of triangle soups with planar cap generation. A triangle is a Float64Array(18):
// three vertices of [px,py,pz,nx,ny,nz]. Used to cut control surfaces out of the fused A0 shell.

const EPS = 1e-9;
/** Cap triangles (planar cut faces) are tagged so they can take the dark hinge material. */
export const isCap = new WeakSet();
const key = (p) => `${Math.round(p[0] * 1e6)},${Math.round(p[1] * 1e6)},${Math.round(p[2] * 1e6)}`;

function lerpVert(a, b, t) {
  const o = new Float64Array(6);
  for (let k = 0; k < 6; k++) o[k] = a[k] + (b[k] - a[k]) * t;
  const l = Math.hypot(o[3], o[4], o[5]) || 1;
  o[3] /= l; o[4] /= l; o[5] /= l;
  return o;
}

/**
 * Keeps the part of `tris` where n·p >= d (or <= d when keep = 'neg'). The cut is closed with a cap
 * whose winding faces away from the kept side. `stats.openLoops` counts sections that failed to chain.
 */
export function clip(tris, n, d, keep = 'pos', stats = { openLoops: 0, capTris: 0 }) {
  const sgn = keep === 'pos' ? 1 : -1;
  const out = [];
  const segs = []; // directed exit -> entry points on the plane
  const dist = (v) => sgn * (n[0] * v[0] + n[1] * v[1] + n[2] * v[2] - d);
  for (const t of tris) {
    const v = [t.subarray(0, 6), t.subarray(6, 12), t.subarray(12, 18)];
    const s = v.map(dist);
    if (s[0] >= -EPS && s[1] >= -EPS && s[2] >= -EPS) { out.push(t); continue; }
    if (s[0] <= EPS && s[1] <= EPS && s[2] <= EPS) continue;
    const poly = [];
    let exit = null, entry = null;
    for (let i = 0; i < 3; i++) {
      const a = v[i], b = v[(i + 1) % 3], sa = s[i], sb = s[(i + 1) % 3];
      const aIn = sa >= 0, bIn = sb >= 0;
      if (aIn) poly.push(a);
      if (aIn !== bIn) {
        const p = lerpVert(a, b, sa / (sa - sb));
        // put the point exactly on the plane along the dominant axis to keep loops welded
        const ax = Math.abs(n[0]) > 0.5 ? 0 : Math.abs(n[1]) > 0.5 ? 1 : 2;
        if (Math.abs(n[ax]) > 0.9999) p[ax] = d / n[ax];
        poly.push(p);
        if (aIn) exit = p; else entry = p;
      }
    }
    for (let i = 1; i + 1 < poly.length; i++) {
      const q = new Float64Array(18);
      q.set(poly[0], 0); q.set(poly[i], 6); q.set(poly[i + 1], 12);
      if (isCap.has(t)) isCap.add(q);
      out.push(q);
    }
    if (exit && entry && key(exit) !== key(entry)) segs.push([exit, entry]);
  }
  // Cap: chain exit->entry segments into loops, reverse to face away from the kept side, ear-clip.
  const m = [-n[0] * sgn, -n[1] * sgn, -n[2] * sgn];
  const next = new Map();
  for (const sg of segs) { const k = key(sg[0]); (next.get(k) ?? next.set(k, []).get(k)).push(sg); }
  const used = new Set();
  for (const sg of segs) {
    if (used.has(sg)) continue;
    const loop = [];
    let cur = sg, closed = false;
    while (cur && !used.has(cur)) {
      used.add(cur); loop.push(cur[0]);
      const k = key(cur[1]);
      if (k === key(sg[0])) { closed = true; break; }
      cur = next.get(k)?.find((c) => !used.has(c));
    }
    if (!closed || loop.length < 3) { stats.openLoops++; continue; }
    loop.reverse();
    stats.capTris += earClip(loop, m, out);
  }
  return out;
}

function earClip(loop, m, out) {
  // project to 2D using a basis (u, v) with u x v = m
  const ref = Math.abs(m[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  const u = cross(ref, m), ul = Math.hypot(...u); u[0] /= ul; u[1] /= ul; u[2] /= ul;
  const w = cross(m, u);
  const pts = loop.map((p) => [p[0] * u[0] + p[1] * u[1] + p[2] * u[2], p[0] * w[0] + p[1] * w[1] + p[2] * w[2]]);
  let area = 0;
  for (let i = 0; i < pts.length; i++) { const a = pts[i], b = pts[(i + 1) % pts.length]; area += a[0] * b[1] - b[0] * a[1]; }
  if (area < 0) return 0; // a hole (or degenerate); the shells we cut have none
  const idx = loop.map((_, i) => i);
  let made = 0;
  const emit = (a, b, c) => {
    const q = new Float64Array(18);
    for (const [o, i] of [[0, a], [6, b], [12, c]]) { q.set(loop[i].subarray(0, 3), o); q[o + 3] = m[0]; q[o + 4] = m[1]; q[o + 5] = m[2]; }
    out.push(q); isCap.add(q); made++;
  };
  let guard = idx.length * idx.length;
  while (idx.length > 3 && guard-- > 0) {
    let clipped = false;
    for (let k = 0; k < idx.length; k++) {
      const ia = idx[(k + idx.length - 1) % idx.length], ib = idx[k], ic = idx[(k + 1) % idx.length];
      const a = pts[ia], b = pts[ib], c = pts[ic];
      const cr = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
      if (cr <= 1e-14) continue;
      let inside = false;
      for (const j of idx) {
        if (j === ia || j === ib || j === ic) continue;
        if (pointInTri(pts[j], a, b, c)) { inside = true; break; }
      }
      if (inside) continue;
      emit(ia, ib, ic); idx.splice(k, 1); clipped = true; break;
    }
    if (!clipped) { // numerically stuck: drop the flattest vertex
      idx.splice(0, 1);
    }
  }
  if (idx.length === 3) emit(idx[0], idx[1], idx[2]);
  return made;
}

function cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
function pointInTri(p, a, b, c) {
  const s = (p1, p2, p3) => (p1[0] - p3[0]) * (p2[1] - p3[1]) - (p2[0] - p3[0]) * (p1[1] - p3[1]);
  const d1 = s(p, a, b), d2 = s(p, b, c), d3 = s(p, c, a);
  const neg = d1 < 0 || d2 < 0 || d3 < 0, pos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(neg && pos);
}

/** Signed volume of a closed triangle soup (sanity check: caps must close the shell). */
export function volume(tris) {
  let v = 0;
  for (const t of tris) {
    const a = t.subarray(0, 3), b = t.subarray(6, 9), c = t.subarray(12, 15);
    v += (a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0])) / 6;
  }
  return v;
}
