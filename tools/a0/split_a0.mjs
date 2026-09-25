// Rebuilds public/assets/models/pf_aircraft_ultralight.glb from the fused, single-material sculpt in
// tools/a0/source/: separates the airframe into semantic wing, tail, control, drivetrain,
// cable, wheel and propeller assemblies with pivots at their working axes; applies the A0 livery
// and pilot. The source sculpt still defines the aircraft's silhouette.
//   node tools/a0/split_a0.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Document, NodeIO } from '@gltf-transform/core';
import { clip, volume, isCap } from './clip.mjs';
import { triangleData, thickness } from './mesh.mjs';
import { classify, PROP_HUB, WHEELS, AXLE_Y } from './classify.mjs';
import { renderAtlas, encodePng, uvFor, SURF, G, SIZE } from './livery.mjs';
import { buildPilot } from './pilot.mjs';
import { buildEngine, buildWheel, buildMainGear, buildNoseFork, buildPropHub } from './hardware.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(HERE, 'source/pf_aircraft_ultralight.source.glb');
const OUT = path.join(HERE, '../../public/assets/models/airframes/aerofox_kestrel2.glb');
const LEGACY_OUT = path.join(HERE, '../../public/assets/models/pf_aircraft_ultralight.glb');

// ---------- load the fused sculpt ----------
const io = new NodeIO();
const srcDoc = await io.read(SRC);
const prim = srcDoc.getRoot().listMeshes()[0].listPrimitives()[0];
const P0 = prim.getAttribute('POSITION').getArray(), N0 = prim.getAttribute('NORMAL').getArray(), I0 = prim.getIndices().getArray();
let soup = [];
for (let t = 0; t < I0.length; t += 3) {
  const q = new Float64Array(18);
  for (let k = 0; k < 3; k++) { const v = I0[t + k]; for (let a = 0; a < 3; a++) { q[k * 6 + a] = P0[v * 3 + a]; q[k * 6 + 3 + a] = N0[v * 3 + a]; } }
  soup.push(q);
}
console.log('source triangles', soup.length, 'volume', volume(soup).toFixed(5));

// ---------- carve hinged surfaces out of the closed shell ----------
const stats = { openLoops: 0, capTris: 0 };
const pieceStats = { openLoops: 0, capTris: 0 };
const g = G.hingeGap;
const pl = (axis, d, keep) => ({ n: axis === 'x' ? [1, 0, 0] : axis === 'y' ? [0, 1, 0] : [0, 0, 1], d, keep });
/** Plane following the wing dihedral: y - slope*s*x = c (keeps the cut to the skin band, not the struts). */
const skinPlane = (s, c, keep, slope) => { const l = Math.hypot(1, slope); return { n: [-slope * s / l, 1 / l, 0], d: c / l, keep }; };
const grownD = (p, by) => (p.keep === 'pos' ? p.d - by : p.d + by);

/** piece = the region; rest = soup minus the region grown by one hinge gap on every cut face. */
function carve(tris, planes) {
  let piece = tris;
  for (const p of planes) piece = clip(piece, p.n, p.d, p.keep, pieceStats);
  const rest = [];
  for (let i = 0; i < planes.length; i++) {
    let base = tris;
    for (let j = 0; j < i; j++) base = clip(base, planes[j].n, grownD(planes[j], g), planes[j].keep, stats);
    const p = planes[i];
    rest.push(...clip(base, p.n, grownD(p, g), p.keep === 'pos' ? 'neg' : 'pos', stats));
  }
  return { piece, rest };
}

const parts = {}; // name -> { tris, pivot: {origin, rotZ} }
const cut = (name, planes, pivot) => {
  const { piece, rest } = carve(soup, planes);
  parts[name] = { tris: [...(parts[name]?.tris ?? []), ...piece], pivot };
  soup = rest;
};

const hingeSlope = 0.081; // wing dihedral: hinge axis follows the wing so the aileron does not bind
const yb = (ax) => 0.283 + hingeSlope * ax;
for (const s of [1, -1]) {
  const xIn = s * (SURF.aileronX0 + g / 2);
  const zh = SURF.aileronHingeZ - g / 2;
  const name = s > 0 ? 'aileron_L' : 'aileron_R'; // +X is the LEFT wing
  cut(name, [pl('x', xIn, s > 0 ? 'pos' : 'neg'), pl('z', zh, 'neg'), skinPlane(s, 0.283 - 0.014, 'pos', 0.081), skinPlane(s, 0.283 + 0.062, 'neg', 0.081)], {
    origin: [s * 0.75, yb(0.75) + 0.0085, SURF.aileronHingeZ],
    rotZ: Math.atan2(hingeSlope * s, 1),
  });
}
for (const s of [1, -1]) {
  cut('elevator', [pl('z', SURF.elevatorHingeZ - g / 2, 'neg'), pl('x', s * 0.012, s > 0 ? 'pos' : 'neg'), pl('y', 0.2, 'pos'), pl('y', 0.262, 'neg')],
    { origin: [0, 0.2265, SURF.elevatorHingeZ], rotZ: 0 });
}
cut('rudder', [pl('z', SURF.rudderHingeZ - g / 2, 'neg'), pl('y', SURF.rudderBottomY, 'pos'), pl('y', 0.43, 'neg'), pl('x', -0.04, 'pos'), pl('x', 0.04, 'neg')],
  { origin: [0, 0.33, SURF.rudderHingeZ], rotZ: Math.PI / 2 }); // local X = world up: rotating about X yaws
parts.main = { tris: soup };
console.log('caps rest', stats, 'piece', pieceStats, 'volume after', Object.values(parts).reduce((a, p) => a + volume(p.tris), 0).toFixed(5));

// ---------- classify every triangle ----------
const flat = [];
for (const [name, p] of Object.entries(parts)) for (const t of p.tris) flat.push({ name, t });
const nTri = flat.length;
const Pall = new Float32Array(nTri * 9), Nall = new Float32Array(nTri * 9), Iall = new Uint32Array(nTri * 3);
flat.forEach(({ t }, i) => {
  for (let k = 0; k < 3; k++) for (let a = 0; a < 3; a++) { Pall[i * 9 + k * 3 + a] = t[k * 6 + a]; Nall[i * 9 + k * 3 + a] = t[k * 6 + 3 + a]; }
  Iall.set([i * 3, i * 3 + 1, i * 3 + 2], i * 3);
});
const tri = triangleData(Pall, Nall, Iall);
const th = thickness(Pall, Iall, tri);
const counts = {};
for (let i = 0; i < nTri; i++) {
  const { name, t } = flat[i];
  const cls = isCap.has(t) ? 'cap' : classify(tri.c[i * 3], tri.c[i * 3 + 1], tri.c[i * 3 + 2], tri.n[i * 3], tri.n[i * 3 + 1], tri.n[i * 3 + 2], th[i]);
  flat[i].cls = cls;
  const key = `${name}:${cls}`; counts[key] = (counts[key] ?? 0) + 1;
  if (name === 'main' && cls === 'prop') flat[i].name = 'propeller';
}
// Thickness-based rules leave speckle on the sculpt's noisy surface: majority-vote over edge neighbours.
{
  const LOCKED = new Set(['wing', 'tail', 'fin', 'prop', 'cap']);
  const vkey = (t, k) => `${Math.round(t[k * 6] * 1e5)},${Math.round(t[k * 6 + 1] * 1e5)},${Math.round(t[k * 6 + 2] * 1e5)}`;
  const edges = new Map();
  flat.forEach((e, i) => {
    const ks = [vkey(e.t, 0), vkey(e.t, 1), vkey(e.t, 2)];
    for (let k = 0; k < 3; k++) { const a = ks[k], b = ks[(k + 1) % 3], ek = a < b ? `${a}|${b}` : `${b}|${a}`; (edges.get(ek) ?? edges.set(ek, []).get(ek)).push(i); }
  });
  const nb = flat.map(() => []);
  for (const l of edges.values()) if (l.length === 2) { nb[l[0]].push(l[1]); nb[l[1]].push(l[0]); }
  let changed = 0;
  for (let it = 0; it < 4; it++) {
    const next = flat.map((e) => e.cls);
    flat.forEach((e, i) => {
      if (LOCKED.has(e.cls) || e.name !== 'main' && e.name !== 'propeller') return;
      const votes = {};
      for (const j of nb[i]) if (flat[j].name === e.name && !LOCKED.has(flat[j].cls)) votes[flat[j].cls] = (votes[flat[j].cls] ?? 0) + 1;
      const best = Object.entries(votes).sort((a, b) => b[1] - a[1])[0];
      if (best && best[0] !== e.cls && best[1] >= 2 && best[1] > (votes[e.cls] ?? 0)) { next[i] = best[0]; changed++; }
    });
    flat.forEach((e, i) => { e.cls = next[i]; });
  }
  console.log('mode filter flipped', changed);
}
console.log(counts);
const probe = process.argv.find((a) => a.startsWith('--probe='))?.slice(8);
if (probe) {
  const [pn, pc] = probe.split(':'); const mn = [9, 9, 9], mx = [-9, -9, -9]; let ts = 0, n = 0; const sample = [];
  flat.forEach((e, i) => { if (e.name !== pn || e.cls !== pc) return; n++; ts += th[i]; for (let a = 0; a < 3; a++) { mn[a] = Math.min(mn[a], tri.c[i * 3 + a]); mx[a] = Math.max(mx[a], tri.c[i * 3 + a]); } if (sample.length < 6 && i % 37 === 0) sample.push([...tri.c.slice(i * 3, i * 3 + 3)].map((v) => +v.toFixed(3)).join(',') + ' n' + [...tri.n.slice(i * 3, i * 3 + 3)].map((v) => +v.toFixed(2)).join(',') + ' t' + th[i].toFixed(3)); });
  console.log(probe, n, 'bbox', mn.map((v) => +v.toFixed(3)), mx.map((v) => +v.toFixed(3)), 'meanT', (ts / n).toFixed(3), sample);
}
if (process.argv.includes('--dry')) process.exit(0);

// ---------- materials ----------
const MAT_OF = { wing: 'fabric', tail: 'fabric', fin: 'fabric', frame: 'frame', pant: 'frame', wire: 'wire', mech: 'mech', hub: 'mech', cap: 'mech', engine: 'engine', exhaust: 'exhaust', tire: 'rubber', seat: 'seat', prop: 'prop' };
const doc = new Document();
const buffer = doc.createBuffer();
const atlas = doc.createTexture('a0_livery').setImage(encodePng(renderAtlas())).setMimeType('image/png');
const mk = (name, rgb, rough, metal) => doc.createMaterial(name).setBaseColorFactor([...rgb.map((c) => Math.pow(c / 255, 2.2)), 1]).setRoughnessFactor(rough).setMetallicFactor(metal);
const hex = (s) => [1, 3, 5].map((i) => parseInt(s.slice(i, i + 2), 16));
const MATS = {
  fabric: doc.createMaterial('A0_FABRIC').setBaseColorFactor([1, 1, 1, 1]).setBaseColorTexture(atlas).setRoughnessFactor(0.84).setMetallicFactor(0),
  frame: mk('A0_FRAME', hex('#f06a2a'), 0.6, 0.05),
  wire: mk('A0_CONTROL_CABLE', hex('#6a747b'), 0.78, 0.12),
  mech: mk('A0_MECHANICAL', hex('#8a929a'), 0.5, 0.35),
  engine: mk('A0_ENGINE_DARK', hex('#2a2e32'), 0.55, 0.3),
  exhaust: mk('A0_EXHAUST', hex('#5b4a3e'), 0.7, 0.4),
  rubber: mk('A0_RUBBER', hex('#16181a'), 0.92, 0),
  seat: mk('A0_SEAT', hex('#3b342e'), 0.8, 0),
  pilot: doc.createMaterial('A0_PILOT').setBaseColorFactor([1, 1, 1, 1]).setRoughnessFactor(0.75).setMetallicFactor(0),
  prop: mk('A0_PROP', hex('#8a5a2b'), 0.55, 0),
};
MATS.fabric.getBaseColorTextureInfo().setMinFilter(9987).setMagFilter(9729); // LINEAR_MIPMAP_LINEAR / LINEAR

// ---------- per-part, per-material primitives ----------
function atlasRegion(cls, nx, ny) {
  if (cls === 'wing') return ny >= 0 ? 'wingTop' : 'wingBottom';
  if (cls === 'tail') return ny >= 0 ? 'tailTop' : 'tailBottom';
  return nx >= 0 ? 'finLeft' : 'finRight'; // fin: +X side is the aircraft's left
}

function rotZ(v, a) { const c = Math.cos(a), s = Math.sin(a); return [v[0] * c - v[1] * s, v[0] * s + v[1] * c, v[2]]; }

/** Distance-weighted normal smoothing (the sculpt's noise shows as streaks on fabric and crumpled tubes up close in FPV).
 *  skinOnly: top/bottom of wing+tail, sides of the fin. Faces >60° apart never blend, so hard edges survive. */
function smoothNormals(list, radius = 0.03, skinOnly = true) {
  const cell = radius, hash = new Map();
  const verts = [];
  for (const { t } of list) for (let k = 0; k < 3; k++) {
    const v = { p: t.subarray(k * 6, k * 6 + 3), n: t.subarray(k * 6 + 3, k * 6 + 6), out: null };
    // skin faces only: top/bottom of wing+tail, sides of the fin
    if (skinOnly && !(Math.abs(v.n[1]) > 0.6 || Math.abs(v.n[0]) > 0.6)) continue;
    verts.push(v);
    const key = `${Math.floor(v.p[0] / cell)},${Math.floor(v.p[1] / cell)},${Math.floor(v.p[2] / cell)}`;
    (hash.get(key) ?? hash.set(key, []).get(key)).push(v);
  }
  for (const v of verts) {
    const cx = Math.floor(v.p[0] / cell), cy = Math.floor(v.p[1] / cell), cz = Math.floor(v.p[2] / cell);
    let nx = 0, ny = 0, nz = 0;
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (let c = -1; c <= 1; c++) {
      for (const o of hash.get(`${cx + a},${cy + b},${cz + c}`) ?? []) {
        const d = Math.hypot(o.p[0] - v.p[0], o.p[1] - v.p[1], o.p[2] - v.p[2]);
        if (d >= radius || o.n[0] * v.n[0] + o.n[1] * v.n[1] + o.n[2] * v.n[2] < 0.5) continue;
        const w = 1 - d / radius; nx += o.n[0] * w; ny += o.n[1] * w; nz += o.n[2] * w;
      }
    }
    const l = Math.hypot(nx, ny, nz) || 1; v.out = [nx / l, ny / l, nz / l];
  }
  for (const v of verts) if (v.out) { v.n[0] = v.out[0]; v.n[1] = v.out[1]; v.n[2] = v.out[2]; }
}

function buildMesh(name, entries, pivot) {
  // Clipping a shell can leave zero-area faces at exact seam vertices. They are
  // invisible in game but trigger validator noise and can break collision baking.
  entries = entries.filter(({ t }) => {
    // Match the actual Float32 vertex payload: sub-millimetre triangles can
    // collapse only after export even when their Float64 source is non-zero.
    const p = [0, 1, 2].map((i) => Math.fround(t[i]));
    const q = [0, 1, 2].map((i) => Math.fround(t[6 + i]));
    const r = [0, 1, 2].map((i) => Math.fround(t[12 + i]));
    const ax = q[0] - p[0], ay = q[1] - p[1], az = q[2] - p[2];
    const bx = r[0] - p[0], by = r[1] - p[1], bz = r[2] - p[2];
    const cx = ay * bz - az * by, cy = az * bx - ax * bz, cz = ax * by - ay * bx;
    return cx * cx + cy * cy + cz * cz > 1e-16;
  });
  const fabric = entries.filter((e) => MAT_OF[e.cls] === 'fabric');
  smoothNormals(fabric);
  smoothNormals(fabric, 0.012, false); // leading edges / rims
  smoothNormals(entries.filter((e) => ['frame', 'mech', 'engine', 'seat'].includes(MAT_OF[e.cls]) && e.cls !== 'cap'), 0.012, false);
  const groups = {};
  for (const { t, cls } of entries) {
    const m = MAT_OF[cls] ?? 'mech';
    (groups[m] ??= []).push({ t, cls });
  }
  const mesh = doc.createMesh(name);
  for (const [m, list] of Object.entries(groups)) {
    const pos = [], nor = [], uv = [], idx = [];
    const seen = new Map();
    for (const { t, cls } of list) {
      for (let k = 0; k < 3; k++) {
        const w = [t[k * 6], t[k * 6 + 1], t[k * 6 + 2]], nw = [t[k * 6 + 3], t[k * 6 + 4], t[k * 6 + 5]];
        let p = w, n = nw;
        if (pivot) { p = rotZ([w[0] - pivot.origin[0], w[1] - pivot.origin[1], w[2] - pivot.origin[2]], -pivot.rotZ); n = rotZ(nw, -pivot.rotZ); }
        let u = null;
        if (m === 'fabric') {
          const r = atlasRegion(cls, nw[0], nw[1]);
          u = r.startsWith('fin') ? uvFor(r, w[2], w[1]) : uvFor(r, w[0], w[2]);
        }
        const key = `${p.map((v) => v.toFixed(7))}|${n.map((v) => v.toFixed(2))}|${u ? u.map((v) => v.toFixed(5)) : ''}`;
        let i = seen.get(key);
        if (i === undefined) { i = pos.length / 3; seen.set(key, i); pos.push(...p); nor.push(...n); if (u) uv.push(...u); }
        idx.push(i);
      }
    }
    const pr = doc.createPrimitive().setMaterial(MATS[m])
      .setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(new Float32Array(pos)).setBuffer(buffer))
      .setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setArray(new Float32Array(nor)).setBuffer(buffer))
      .setIndices(doc.createAccessor().setType('SCALAR').setArray(new Uint32Array(idx)).setBuffer(buffer));
    if (uv.length) pr.setAttribute('TEXCOORD_0', doc.createAccessor().setType('VEC2').setArray(new Float32Array(uv)).setBuffer(buffer));
    mesh.addPrimitive(pr);
  }
  return mesh;
}

const scene = doc.createScene('A0');
const root = doc.createNode('A0'); scene.addChild(root);
const requiredEntries = (name, entries, min = 1) => {
  if (!entries || entries.length < min) throw new Error(`A0 mesh split failed: ${name} has ${entries?.length ?? 0} triangles (need ${min})`);
  return entries;
};
const byPart = {};
for (const e of flat) (byPart[e.name] ??= []).push(e);

// Keep the original closed shell as independently addressable airframe sections.
// This preserves the sculpted topology and livery while enabling true per-side damage.
const mainEntries = byPart.main ?? [];
const centre = (entry, axis) => (entry.t[axis] + entry.t[6 + axis] + entry.t[12 + axis]) / 3;
const coreEntries = [];
const cableEntries = new Map([['L', []], ['R', []]]);
// The sculpt's balloon tyres, wheel pants and engine blob are replaced by tools/a0/hardware.mjs.
// Airframe tubes (frame/wire) that pass through the old tyre volume are kept.
const inSculptWheel = (e) => e.cls !== 'frame' && e.cls !== 'wire' && WHEELS.some((w) => Math.abs(centre(e, 0) - w.x) < 0.046 && Math.hypot(centre(e, 1) - AXLE_Y, centre(e, 2) - w.z) < 0.086);
for (const e of mainEntries) {
  if (e.cls === 'tire' || e.cls === 'hub' || e.cls === 'pant' || e.cls === 'engine' || inSculptWheel(e)) continue;
  if (e.cls === 'wire') { cableEntries.get(centre(e, 0) >= 0 ? 'L' : 'R').push(e); continue; }
  if (e.cls === 'wing' || e.cls === 'tail' || e.cls === 'fin') continue;
  coreEntries.push(e);
}
root.addChild(doc.createNode('a0_body').setMesh(buildMesh('a0_body', requiredEntries('a0_body', coreEntries))));
for (const cls of ['wing', 'tail']) {
  for (const s of [1, -1]) {
    const side = s > 0 ? 'L' : 'R';
    const entries = mainEntries.filter((e) => e.cls === cls && centre(e, 0) * s >= -0.0001);
    if (cls === 'wing') {
      const tip = entries.filter((e) => Math.abs(centre(e, 0)) >= 0.79);
      const panel = entries.filter((e) => Math.abs(centre(e, 0)) < 0.79);
      root.addChild(doc.createNode(`wing_panel_${side}`).setMesh(buildMesh(`wing_panel_${side}`, requiredEntries(`wing_panel_${side}`, panel, 100))));
      root.addChild(doc.createNode(`wingtip_${side}`).setMesh(buildMesh(`wingtip_${side}`, requiredEntries(`wingtip_${side}`, tip, 10))));
    } else {
      const name = `horizontal_tail_${side}`;
      root.addChild(doc.createNode(name).setMesh(buildMesh(name, requiredEntries(name, entries, 20))));
    }
  }
}
const finEntries = mainEntries.filter((e) => e.cls === 'fin');
root.addChild(doc.createNode('vertical_tail').setMesh(buildMesh('vertical_tail', requiredEntries('vertical_tail', finEntries, 20))));
const engineOrigin = [0, 0.37, 0.16];
const engineMount = doc.createNode('engine_mount').setTranslation(engineOrigin);
engineMount.addChild(doc.createNode('engine').setMesh(buildMesh('engine', buildEngine(), { origin: engineOrigin, rotZ: 0 })));
root.addChild(engineMount);
for (const side of ['L', 'R']) {
  const origin = [side === 'L' ? 0.2 : -0.2, 0.25, 0];
  const cableMount = doc.createNode(`cables_${side}_mount`).setTranslation(origin);
  cableMount.addChild(doc.createNode(`cables_${side}`).setMesh(buildMesh(`cables_${side}`, requiredEntries(`cables_${side}`, cableEntries.get(side), 20), { origin, rotZ: 0 })));
  root.addChild(cableMount);
}
// Gear: <strut node, moved by the rig with the simulated compression> -> <wheel pivot, spins about X>.
// The nose strut is also the steering node (turns about Y with the fork).
for (const wheel of WHEELS) {
  const side = wheel.id === 'mainL' ? 'L' : wheel.id === 'mainR' ? 'R' : 'nose';
  const axle = [wheel.x, AXLE_Y, wheel.z];
  const at = { origin: axle, rotZ: 0 };
  const strut = doc.createNode(side === 'nose' ? 'nose_steer' : `wheel_${side}_strut`).setTranslation(axle);
  if (side === 'nose') strut.setMesh(buildMesh('nose_fork', buildNoseFork(), at));
  else {
    const leg = buildMainGear(wheel.id);
    strut.setMesh(buildMesh(`gear_leg_${side}`, leg.moving, at));
    root.addChild(doc.createNode(`gear_sleeve_${side}`).setMesh(buildMesh(`gear_sleeve_${side}`, leg.fixed)));
  }
  const node = doc.createNode(`wheel_${side}_pivot`);
  node.addChild(doc.createNode(`wheel_${side}`).setMesh(buildMesh(`wheel_${side}`, buildWheel(wheel.id), at)));
  strut.addChild(node);
  root.addChild(strut);
}
const PIVOTS = { ...Object.fromEntries(['aileron_L', 'aileron_R', 'elevator', 'rudder'].map((k) => [k, parts[k].pivot])), propeller: { origin: PROP_HUB, rotZ: 0 } };
for (const [name, pv] of Object.entries(PIVOTS)) {
  const node = doc.createNode(`${name}_pivot`).setTranslation(pv.origin)
    .setRotation([0, 0, Math.sin(pv.rotZ / 2), Math.cos(pv.rotZ / 2)]);
  node.addChild(doc.createNode(name).setMesh(buildMesh(name, name === 'propeller' ? [...byPart[name], ...buildPropHub()] : byPart[name], pv)));
  root.addChild(node);
}
const pilotEntries = buildPilot();
root.addChild(doc.createNode('pilot').setMesh(buildPilotMesh(pilotEntries)));

function buildPilotMesh(entries) {
  const pos = [], nor = [], col = [], idx = [];
  for (const { p, n, c } of entries) { const i = pos.length / 3; pos.push(...p); nor.push(...n); col.push(...c); idx.push(i); }
  const mesh = doc.createMesh('pilot');
  mesh.addPrimitive(doc.createPrimitive().setMaterial(MATS.pilot)
    .setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(new Float32Array(pos)).setBuffer(buffer))
    .setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setArray(new Float32Array(nor)).setBuffer(buffer))
    .setAttribute('COLOR_0', doc.createAccessor().setType('VEC3').setArray(new Float32Array(col)).setBuffer(buffer))
    .setIndices(doc.createAccessor().setType('SCALAR').setArray(new Uint32Array(idx)).setBuffer(buffer)));
  return mesh;
}

await io.write(OUT, doc);
await io.write(LEGACY_OUT, doc);
console.log('wrote', OUT, (fs.statSync(OUT).size / 1e6).toFixed(2), 'MB; legacy alias', LEGACY_OUT, '; atlas', SIZE);
