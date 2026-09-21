// Simple stylised pilot (blocks + spheres, vertex-coloured) seated in the left seat. The sculpt shipped
// with empty seats; a human silhouette is needed for gameplay readability. Model units (x6 at runtime).
const hex = (s) => [1, 3, 5].map((i) => Math.pow(parseInt(s.slice(i, i + 2), 16) / 255, 2.2));
const out = [];

function quad(a, b, c, d, n, col) {
  for (const tri of [[a, b, c], [a, c, d]]) for (const p of tri) out.push({ p, n, c: col });
}
function box([cx, cy, cz], [sx, sy, sz], color) {
  const c = hex(color), x = sx / 2, y = sy / 2, z = sz / 2;
  const v = (i, j, k) => [cx + i * x, cy + j * y, cz + k * z];
  quad(v(1, -1, -1), v(1, 1, -1), v(1, 1, 1), v(1, -1, 1), [1, 0, 0], c);
  quad(v(-1, -1, 1), v(-1, 1, 1), v(-1, 1, -1), v(-1, -1, -1), [-1, 0, 0], c);
  quad(v(-1, 1, -1), v(-1, 1, 1), v(1, 1, 1), v(1, 1, -1), [0, 1, 0], c);
  quad(v(-1, -1, 1), v(-1, -1, -1), v(1, -1, -1), v(1, -1, 1), [0, -1, 0], c);
  quad(v(-1, -1, 1), v(1, -1, 1), v(1, 1, 1), v(-1, 1, 1), [0, 0, 1], c);
  quad(v(1, -1, -1), v(-1, -1, -1), v(-1, 1, -1), v(1, 1, -1), [0, 0, -1], c);
}
function sphere([cx, cy, cz], r, color, seg = 10, rings = 7) {
  const c = hex(color);
  const pt = (i, j) => { const th = (i / seg) * Math.PI * 2, ph = (j / rings) * Math.PI; const n = [Math.sin(ph) * Math.cos(th), Math.cos(ph), Math.sin(ph) * Math.sin(th)]; return { p: [cx + n[0] * r, cy + n[1] * r, cz + n[2] * r], n }; };
  for (let j = 0; j < rings; j++) for (let i = 0; i < seg; i++) {
    const a = pt(i, j), b = pt(i + 1, j), d = pt(i, j + 1), e = pt(i + 1, j + 1);
    for (const tri of [[a, d, b], [b, d, e]]) for (const q of tri) out.push({ p: q.p, n: q.n, c });
  }
}

export function buildPilot(x = 0.04) {
  out.length = 0;
  const SUIT = '#2f7aa3', PANTS = '#25506b', SKIN = '#d9a37a', HELMET = '#f1ead8', VISOR = '#1c2226', BOOT = '#1d1f21';
  box([x, 0.14, 0.15], [0.058, 0.03, 0.05], PANTS);                   // hips
  box([x, 0.18, 0.135], [0.064, 0.062, 0.038], SUIT);                 // torso
  box([x + 0.036, 0.19, 0.16], [0.016, 0.016, 0.07], SUIT);           // arms reaching forward
  box([x - 0.036, 0.19, 0.16], [0.016, 0.016, 0.07], SUIT);
  box([x, 0.15, 0.2], [0.05, 0.024, 0.08], PANTS);                    // thighs
  box([x, 0.118, 0.24], [0.046, 0.07, 0.026], PANTS);                 // shins
  box([x, 0.084, 0.25], [0.046, 0.016, 0.04], BOOT);                  // boots
  sphere([x, 0.225, 0.135], 0.022, SKIN);                             // head
  sphere([x, 0.23, 0.133], 0.0255, HELMET);                           // helmet
  box([x, 0.228, 0.156], [0.03, 0.011, 0.008], VISOR);                // visor
  return out.slice();
}
