// Ridgeway RW-12 Nightjar runtime asset (second playable aircraft; high-wing side-by-side pusher
// inspired by the RANS S-12). Rebuilds the shipped GLBs from the static source sculpt:
//
//   node tools/nightjar/build_nightjar.mjs
//
// Source: tools/nightjar/source/nightjar_rw12.source.glb (one mesh per part, metres, nose +Z, +X = left
// wing, wheels on y = 0). The sculpt is static, so this script:
//  1. notches the wing root trailing edge for the pusher propeller arc (the S-12 wing has the same cut-out;
//     the sculpt's continuous wing would otherwise intersect the spinning disc);
//  2. moves the main-gear axle 0.15 m aft (legs sheared, wheels/axle translated) so the tricycle sits
//     nose-down with a realistic ~10-15 % nose-wheel load at the physics CG (docs/aircraft/NIGHTJAR_RW12.md);
//  3. cuts the ailerons, elevator and rudder out of their fixed surfaces on the sculpt's own hinge lines
//     (capped cuts), and parents them under hinge pivots whose local +X (Y for the rudder) is the hinge axis;
//  4. builds propeller, wheel and nose-steering pivots, wingtip break-off pieces and nav/strobe lights;
//  5. groups the static parts into named semantic nodes (damage/visual mapping lives in
//     src/aircraft/profiles/nightjar.ts) and writes LOD0/1/2, meshopt-compressed.
// Pivot names are the contract with src/render/aircraftRig.ts (see NIGHTJAR_RIG in the profile).

import fs from 'node:fs/promises';
import { Document, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, weld, prune, meshopt, simplify } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';
import { clip } from '../a0/clip.mjs';

const SRC = 'tools/nightjar/source/nightjar_rw12.source.glb';
const OUT_DIR = 'public/assets/models/airframes';
const NAME = 'nightjar_rw12';

// ---- authored cut geometry (metres, model axes) ------------------------------------------------
const NOTCH_HALF_WIDTH = 0.74; // prop radius 0.685 + clearance
const NOTCH_FRONT_Z = -0.76; // hub front face is at z -0.79
const MAIN_GEAR_SHIFT_Z = -0.15;
const AILERON_SPAN = [1.45, 4.2]; // the sculpt's hinge-line extent
const WINGTIP_X = 4.2;
const ELEVATOR_HINGE_Z = -4.88; // "Elevator hinge seam"
const ELEVATOR_ROOT_X = 0.12; // centre section stays fixed (rudder sweep clearance)
const RUDDER_HINGE_Z = -4.72; // "Rudder hinge seam" posts
const RUDDER_FOOT_Y = 1.035; // above the tailplane
const PROP_CENTRE = [0, 2.091, -0.83];
const NOSE_STEER_AXIS = [0, 0.5, 1.6];

await MeshoptEncoder.ready;
await MeshoptSimplifier.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder });

// ---- read the source into per-part triangle soups ----------------------------------------------
const src = await io.read(SRC);
/** @type {{name: string, mat: string, tris: Float64Array[]}[]} */
let parts = [];
const materialProps = new Map();
for (const node of src.getRoot().listNodes()) {
  const mesh = node.getMesh();
  if (!mesh) continue;
  const name = node.getName().replace(/_export$/, '');
  for (const prim of mesh.listPrimitives()) {
    const P = prim.getAttribute('POSITION'), N = prim.getAttribute('NORMAL'), I = prim.getIndices();
    const mat = prim.getMaterial();
    const matName = mat?.getName() ?? 'default';
    if (mat && !materialProps.has(matName)) {
      materialProps.set(matName, { color: mat.getBaseColorFactor(), rough: mat.getRoughnessFactor(), metal: mat.getMetallicFactor() });
    }
    const tris = [];
    const a = [], b = [];
    const count = I ? I.getCount() : P.getCount();
    for (let i = 0; i < count; i += 3) {
      const t = new Float64Array(18);
      for (let v = 0; v < 3; v++) {
        const idx = I ? I.getScalar(i + v) : i + v;
        P.getElement(idx, a); N.getElement(idx, b);
        t.set(a, v * 6); t.set(b, v * 6 + 3);
      }
      tris.push(t);
    }
    parts.push({ name, mat: matName, tris });
  }
}
const byName = (re) => parts.filter((p) => re.test(p.name));
const one = (re) => { const found = byName(re); if (found.length !== 1) throw new Error(`expected exactly one part for ${re}, got ${found.length}`); return found[0]; };

// ---- helpers ------------------------------------------------------------------------------------
const plane = (n, d, keep) => ({ n, d, keep });
const flip = (p) => ({ ...p, keep: p.keep === 'pos' ? 'neg' : 'pos' });
/** Splits a soup by a convex region (intersection of half-spaces). Cuts are capped on both sides. */
function splitConvex(tris, planes) {
  let inside = tris;
  const outside = [];
  for (const p of planes) {
    outside.push(...clip(inside, p.n, p.d, flip(p).keep));
    inside = clip(inside, p.n, p.d, p.keep);
  }
  return { inside, outside };
}
function bounds(tris) {
  const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
  for (const t of tris) for (let v = 0; v < 3; v++) for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], t[v * 6 + k]); mx[k] = Math.max(mx[k], t[v * 6 + k]); }
  return { mn, mx };
}
function mapVerts(tris, fn) {
  for (const t of tris) for (let v = 0; v < 3; v++) {
    const p = fn([t[v * 6], t[v * 6 + 1], t[v * 6 + 2]]);
    t[v * 6] = p[0]; t[v * 6 + 1] = p[1]; t[v * 6 + 2] = p[2];
  }
}
const norm = (v) => { const l = Math.hypot(...v) || 1; return v.map((x) => x / l); };
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
/** Quaternion [x,y,z,w] rotating +X onto unit vector d. */
function quatFromX(d) {
  const x = [1, 0, 0], c = dot(x, d);
  if (c > 0.999999) return [0, 0, 0, 1];
  const ax = norm(cross(x, d)), h = Math.acos(Math.max(-1, Math.min(1, c))) / 2;
  return [ax[0] * Math.sin(h), ax[1] * Math.sin(h), ax[2] * Math.sin(h), Math.cos(h)];
}
function rotateByQuat(v, q) {
  const [x, y, z, w] = q, u = [x, y, z];
  const t = cross(u, v).map((k) => 2 * k);
  const c2 = cross(u, t);
  return [v[0] + w * t[0] + c2[0], v[1] + w * t[1] + c2[1], v[2] + w * t[2] + c2[2]];
}
const invQuat = (q) => [-q[0], -q[1], -q[2], q[3]];

// ---- 1. main gear aft shift ---------------------------------------------------------------------
for (const p of byName(/^Main (axle|wheel)/)) mapVerts(p.tris, ([x, y, z]) => [x, y, z + MAIN_GEAR_SHIFT_Z]);
for (const p of byName(/^Main gear (front|trailing) leg/)) {
  const { mn, mx } = bounds(p.tris);
  mapVerts(p.tris, ([x, y, z]) => [x, y, z + MAIN_GEAR_SHIFT_Z * Math.min(1, Math.max(0, (mx[1] - y) / (mx[1] - mn[1])))]);
}

// ---- 2. propeller notch in the wing root trailing edge --------------------------------------------
const notch = [plane([1, 0, 0], -NOTCH_HALF_WIDTH, 'pos'), plane([1, 0, 0], NOTCH_HALF_WIDTH, 'neg'), plane([0, 0, 1], NOTCH_FRONT_Z, 'neg')];
for (const p of [...byName(/^Continuous fabric high wing$/), ...byName(/^Wing rib seam/), ...byName(/^Yellow underside wing panel/)]) {
  p.tris = splitConvex(p.tris, notch).outside;
}
parts = parts.filter((p) => p.tris.length > 0);

// ---- 3. control surfaces ------------------------------------------------------------------------
/** Hinge line of a thin hinge-marker mesh: centroids of its two end caps. */
function hingeLine(part) {
  const { mn, mx } = bounds(part.tris);
  const ends = [mn[0] + 0.01, mx[0] - 0.01].map((edge, i) => {
    const acc = [0, 0, 0]; let n = 0;
    for (const t of part.tris) for (let v = 0; v < 3; v++) {
      const x = t[v * 6];
      if (i === 0 ? x <= edge : x >= edge) { acc[0] += x; acc[1] += t[v * 6 + 1]; acc[2] += t[v * 6 + 2]; n++; }
    }
    return acc.map((a) => a / n);
  });
  return ends; // [inboard-or-min-x, max-x]
}
const surfaceNodes = []; // { name, pivotName, pivot: [x,y,z], rotation, parts }
const wingSources = () => [...byName(/^Continuous fabric high wing$/), ...byName(/^Wing rib seam/), ...byName(/^Yellow underside wing panel/)];

// Split every wing-skin part into left (x >= 0) and right halves first.
const wingSplit = { L: [], R: [] };
for (const p of wingSources()) {
  const { inside: left, outside: right } = splitConvex(p.tris, [plane([1, 0, 0], 0, 'pos')]);
  if (left.length) wingSplit.L.push({ ...p, tris: left });
  if (right.length) wingSplit.R.push({ ...p, tris: right });
}
parts = parts.filter((p) => !wingSources().includes(p));

const wingtipPieces = { L: [], R: [] };
for (const side of ['L', 'R']) {
  const s = side === 'L' ? 1 : -1;
  const [a, b] = hingeLine(one(side === 'L' ? /^Aileron hinge line\.001$/ : /^Aileron hinge line$/));
  // Direction along the hinge, pointing to +X (the rig's hinge-axis convention on both sides).
  const d = norm([b[0] - a[0], b[1] - a[1], b[2] - a[2]]);
  // Vertical plane through the hinge line; normal points aft so 'pos' keeps the surface behind the hinge.
  let n = norm(cross(d, [0, 1, 0]));
  if (n[2] > 0) n = n.map((k) => -k);
  const behind = plane(n, dot(n, a), 'pos');
  const spanIn = plane([s, 0, 0], AILERON_SPAN[0], 'pos');
  const spanOut = plane([s, 0, 0], AILERON_SPAN[1], 'neg');
  const aileron = [];
  const fixed = [];
  for (const p of wingSplit[side]) {
    const { inside, outside } = splitConvex(p.tris, [spanIn, spanOut, behind]);
    if (inside.length) aileron.push({ ...p, tris: inside });
    // Wing tip beyond the aileron end breaks away on a tip strike (FlightScene#setImpactDamage).
    const { inside: tip, outside: panel } = splitConvex(outside, [plane([s, 0, 0], WINGTIP_X, 'pos')]);
    if (tip.length) wingtipPieces[side].push({ ...p, tris: tip });
    if (panel.length) fixed.push({ ...p, tris: panel });
  }
  const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
  surfaceNodes.push({ name: `aileron_${side}`, pivotName: `aileron_${side}_pivot`, pivot: mid, rotation: quatFromX(d), parts: aileron });
  parts.push(...fixed.map((p) => ({ ...p, group: `wing_${side}` })));
  parts.push(...wingtipPieces[side].map((p) => ({ ...p, group: `wingtip_${side}` })));
}

{ // elevator: aft of the hinge seam, outboard of the fixed centre section, both halves on one pivot
  const stab = one(/^Horizontal stabilizer$/);
  const { inside: aft, outside: fwd } = splitConvex(stab.tris, [plane([0, 0, 1], ELEVATOR_HINGE_Z, 'neg')]);
  const { inside: left, outside: rest } = splitConvex(aft, [plane([1, 0, 0], ELEVATOR_ROOT_X, 'pos')]);
  const { inside: right, outside: centre } = splitConvex(rest, [plane([1, 0, 0], -ELEVATOR_ROOT_X, 'neg')]);
  stab.tris = [...fwd, ...centre];
  surfaceNodes.push({ name: 'elevator', pivotName: 'elevator_pivot', pivot: [0, 1.0, ELEVATOR_HINGE_Z], rotation: [0, 0, 0, 1], parts: [{ ...stab, tris: [...left, ...right] }] });
}
{ // rudder: aft of the hinge posts, above the tailplane. Pivot rotates about its local +Y.
  const rudder = [];
  for (const p of [one(/^Vertical tail fin$/), ...byName(/^Tail diagonal yellow stripe/), ...byName(/^Yellow fin cap/)]) {
    const { inside, outside } = splitConvex(p.tris, [plane([0, 0, 1], RUDDER_HINGE_Z, 'neg'), plane([0, 1, 0], RUDDER_FOOT_Y, 'pos')]);
    p.tris = outside;
    if (inside.length) rudder.push({ ...p, tris: inside });
  }
  surfaceNodes.push({ name: 'rudder', pivotName: 'rudder_pivot', pivot: [0, 1.6, RUDDER_HINGE_Z], rotation: [0, 0, 0, 1], parts: rudder });
}
parts = parts.filter((p) => p.tris.length > 0);

// ---- 4. rotating parts ----------------------------------------------------------------------------
const take = (re) => { const found = byName(re); parts = parts.filter((p) => !found.includes(p)); return found; };
const wheelCentre = (list) => { const { mn, mx } = bounds(list.flatMap((p) => p.tris)); return [(mn[0] + mx[0]) / 2, (mn[1] + mx[1]) / 2, (mn[2] + mx[2]) / 2]; };
const propParts = take(/^(Pusher propeller blade|Propeller hub)/);
const wheelL = take(/^Main wheel 1 /), wheelR = take(/^Main wheel -1 /);
const noseWheel = take(/^Nose wheel /);
const noseFork = take(/^(Nose fork|Nose gear collar)/);
const rotating = [
  { name: 'propeller', pivotName: 'propeller_pivot', pivot: PROP_CENTRE, rotation: [0, 0, 0, 1], parts: propParts },
  { name: 'wheel_L', pivotName: 'wheel_L_pivot', pivot: wheelCentre(wheelL.filter((p) => /tire/.test(p.name))), rotation: [0, 0, 0, 1], parts: wheelL },
  { name: 'wheel_R', pivotName: 'wheel_R_pivot', pivot: wheelCentre(wheelR.filter((p) => /tire/.test(p.name))), rotation: [0, 0, 0, 1], parts: wheelR },
];
const noseWheelNode = { name: 'wheel_nose', pivotName: 'wheel_nose_pivot', pivot: wheelCentre(noseWheel.filter((p) => /tire/.test(p.name))), rotation: [0, 0, 0, 1], parts: noseWheel };

// ---- 5. lights (small emissive octahedra) ----------------------------------------------------------
function octa(c, r) {
  const v = [[r, 0, 0], [-r, 0, 0], [0, r, 0], [0, -r, 0], [0, 0, r], [0, 0, -r]];
  const f = [[0, 2, 4], [2, 1, 4], [1, 3, 4], [3, 0, 4], [2, 0, 5], [1, 2, 5], [3, 1, 5], [0, 3, 5]];
  return f.map((tri) => {
    const t = new Float64Array(18);
    const nrm = norm(tri.reduce((acc, i) => acc.map((a, k) => a + v[i][k]), [0, 0, 0]));
    tri.forEach((i, k) => { t.set([c[0] + v[i][0], c[1] + v[i][1], c[2] + v[i][2]], k * 6); t.set(nrm, k * 6 + 3); });
    return t;
  });
}
const lightParts = {
  nav_light_L: { name: 'nav_light_L', mat: 'NAV_RED', tris: octa([4.305, 1.975, -0.02], 0.035) },
  nav_light_R: { name: 'nav_light_R', mat: 'NAV_GREEN', tris: octa([-4.305, 1.975, -0.02], 0.035) },
  strobe_tail: { name: 'strobe_tail', mat: 'STROBE', tris: octa([0, 2.365, -4.45], 0.03) },
};

// ---- 6. semantic grouping of the static parts ------------------------------------------------------
const GROUPS = [
  ['canopy_glazing', /^(Cabin side glazing|Sloping curved windshield)/],
  ['instrument_panel', /^Instrument pod$/],
  ['control_stick', /^Control stick$/],
  ['seat_cushion_L', /^Seat cushion\.001$/], ['seat_cushion_R', /^Seat cushion$/],
  ['seat_back_L', /^Seat back\.001$/], ['seat_back_R', /^Seat back$/],
  ['engine_mount', /^(Engine|Cylinder cooling fin|Curved exhaust|Propeller shaft)/],
  ['struts', /^(Forward lift strut|Rear lift strut|Cabane)/],
  ['horizontal_stabilizer', /^(Horizontal stabilizer|Elevator hinge seam|Tail lower brace)/],
  ['vertical_stabilizer', /^(Vertical tail fin|Tail diagonal yellow stripe|Yellow fin cap|Rudder hinge seam|Tail upper brace)/],
  ['gear_main', /^(Main gear|Main axle)/],
  ['gear_nose', /^Nose gear upper strut$/],
  ['wing_L', /^Aileron hinge line\.001$/], ['wing_R', /^Aileron hinge line$/],
  ['fuselage', /./], // cabin cage, floor, doors, pod, boom, skid, stripes, seat supports
];
for (const p of parts) if (!p.group) p.group = GROUPS.find(([, re]) => re.test(p.name))[0];

// ---- 7. build the output document ------------------------------------------------------------------
function buildDocument(lod) {
  const doc = new Document();
  doc.createBuffer();
  const mats = new Map();
  const material = (name) => {
    if (mats.has(name)) return mats.get(name);
    let m;
    if (name === 'NAV_RED' || name === 'NAV_GREEN' || name === 'STROBE') {
      const e = name === 'NAV_RED' ? [1, 0.06, 0.03] : name === 'NAV_GREEN' ? [0.08, 1, 0.35] : [1, 1, 1];
      m = doc.createMaterial(name).setBaseColorFactor([...e, 1]).setEmissiveFactor(e).setRoughnessFactor(0.3).setMetallicFactor(0);
    } else {
      const p = materialProps.get(name);
      m = doc.createMaterial(name).setBaseColorFactor(p.color).setRoughnessFactor(p.rough).setMetallicFactor(p.metal).setDoubleSided(true);
      // Smoked Lexan: the source relies on transmission; ship a cheap alpha-blended tint instead.
      if (name === 'Smoked glazing') m.setBaseColorFactor([0.1, 0.13, 0.15, 0.3]).setAlphaMode('BLEND').setRoughnessFactor(0.08).setMetallicFactor(0.1);
    }
    mats.set(name, m);
    return m;
  };
  const makeMesh = (name, list, pivot = [0, 0, 0], rotation = [0, 0, 0, 1]) => {
    const inv = invQuat(rotation);
    const mesh = doc.createMesh(name);
    const byMat = new Map();
    for (const p of list) (byMat.get(p.mat) ?? byMat.set(p.mat, []).get(p.mat)).push(...p.tris);
    for (const [matName, tris] of byMat) {
      if (!tris.length) continue;
      const pos = new Float32Array(tris.length * 9), nor = new Float32Array(tris.length * 9);
      tris.forEach((t, i) => {
        for (let v = 0; v < 3; v++) {
          const lp = rotateByQuat([t[v * 6] - pivot[0], t[v * 6 + 1] - pivot[1], t[v * 6 + 2] - pivot[2]], inv);
          const ln = rotateByQuat([t[v * 6 + 3], t[v * 6 + 4], t[v * 6 + 5]], inv);
          pos.set(lp, i * 9 + v * 3); nor.set(norm(ln), i * 9 + v * 3);
        }
      });
      const prim = doc.createPrimitive()
        .setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(pos))
        .setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setArray(nor))
        .setMaterial(material(matName));
      mesh.addPrimitive(prim);
    }
    return mesh;
  };
  const keep = (p) => lod === 0 ? true : lod === 1
    ? !/^(Wing rib seam|Cylinder cooling fin|Main wheel .* axle cap|Nose wheel axle cap|Seat support|Windshield center seam|Elevator hinge seam|Rudder hinge seam)/.test(p.name)
    : !/^(Wing rib seam|Cylinder cooling fin|Main wheel .* axle cap|Nose wheel axle cap|Seat support|Windshield center seam|Elevator hinge seam|Rudder hinge seam|Seat|Control stick|Instrument pod|Door|Cabin (overhead|roof|rear)|Yellow rear cabin|Tail (upper|lower) brace|Tail skid|Curved exhaust|Aileron hinge line)/.test(p.name);

  const root = doc.createNode(NAME);
  doc.createScene('Scene').addChild(root);
  const groups = new Map();
  for (const p of parts) if (keep(p)) (groups.get(p.group) ?? groups.set(p.group, []).get(p.group)).push(p);
  for (const [group, list] of groups) root.addChild(doc.createNode(group).setMesh(makeMesh(group, list)));
  const pivotNode = (spec, parent = root) => {
    const pivot = doc.createNode(spec.pivotName).setTranslation(spec.pivot).setRotation(spec.rotation);
    const list = spec.parts.filter(keep);
    if (list.length) pivot.addChild(doc.createNode(spec.name).setMesh(makeMesh(spec.name, list, spec.pivot, spec.rotation)));
    parent.addChild(pivot);
    return pivot;
  };
  for (const s of [...surfaceNodes, ...rotating]) pivotNode(s);
  // Nose steering: the fork/collar and the rolling nose wheel turn together about the strut axis.
  const steer = doc.createNode('nose_steer_pivot').setTranslation(NOSE_STEER_AXIS);
  steer.addChild(doc.createNode('nose_fork').setMesh(makeMesh('nose_fork', noseFork.filter(keep), NOSE_STEER_AXIS)));
  const wheelPivot = doc.createNode(noseWheelNode.pivotName)
    .setTranslation(noseWheelNode.pivot.map((v, k) => v - NOSE_STEER_AXIS[k]));
  const noseList = noseWheelNode.parts.filter(keep);
  wheelPivot.addChild(doc.createNode('wheel_nose').setMesh(makeMesh('wheel_nose', noseList, noseWheelNode.pivot)));
  steer.addChild(wheelPivot);
  root.addChild(steer);
  // Lights ride on the parts that carry them, so a detached wingtip takes its nav light along.
  const attachLight = (light, parentName) => {
    const parent = root.listChildren().find((n) => n.getName() === parentName) ?? root;
    parent.addChild(doc.createNode(light.name).setMesh(makeMesh(light.name, [light])));
  };
  attachLight(lightParts.nav_light_L, 'wingtip_L');
  attachLight(lightParts.nav_light_R, 'wingtip_R');
  attachLight(lightParts.strobe_tail, 'vertical_stabilizer');
  return doc;
}

await fs.mkdir(OUT_DIR, { recursive: true });
for (const lod of [0, 1, 2]) {
  const doc = buildDocument(lod);
  // Distant LODs: fewer parts (see keep()) and a lossy decimation; hinge pivots are preserved.
  const decimate = lod ? [simplify({ simplifier: MeshoptSimplifier, ratio: lod === 1 ? 0.55 : 0.25, error: lod === 1 ? 0.002 : 0.01 })] : [];
  await doc.transform(weld(), ...decimate, dedup(), prune(), meshopt({ encoder: MeshoptEncoder, level: 'high' }));
  const path = `${OUT_DIR}/${NAME}${lod ? `_lod${lod}` : ''}.glb`;
  await io.write(path, doc);
  const tris = doc.getRoot().listMeshes().flatMap((m) => m.listPrimitives()).reduce((s, p) => s + (p.getIndices()?.getCount() ?? p.getAttribute('POSITION').getCount()) / 3, 0);
  const draws = doc.getRoot().listMeshes().reduce((s, m) => s + m.listPrimitives().length, 0);
  console.log(`LOD${lod}: ${path} ${Math.round(tris)} tris, ${draws} draw calls, ${((await fs.stat(path)).size / 1024).toFixed(1)} KiB`);
}
for (const s of [...surfaceNodes, ...rotating, noseWheelNode]) console.log(`${s.pivotName.padEnd(18)} at [${s.pivot.map((v) => v.toFixed(3)).join(', ')}] parts=${s.parts.length}`);
