// Deliberate low-poly hardware for the Aerofox Kestrel 2 (A0): powerplant installation and landing
// gear. Replaces the sculpt's noisy engine blob, balloon tyres and wheel pants with clean, legible
// parts sized to the physics (1 model unit = 5.24 m at runtime, see src/render/aircraftRig.ts).
// Emits split_a0 entries: { t: Float64Array(18) [pos,normal]x3, cls } in model space.
import { WHEELS, AXLE_Y, PROP_HUB } from './classify.mjs';

const M = 1 / 5.24; // metres -> model units
export const WHEEL_R_MODEL = { nose: 0.18 * M, main: 0.2 * M };

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => { const l = Math.hypot(...a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

function tri(out, cls, a, b, c, na, nb, nc) {
  const fn = norm(cross(sub(b, a), sub(c, a)));
  const t = new Float64Array(18);
  [[a, na ?? fn], [b, nb ?? fn], [c, nc ?? fn]].forEach(([p, n], k) => { t.set(p, k * 6); t.set(n, k * 6 + 3); });
  out.push({ t, cls });
}
const quad = (out, cls, a, b, c, d, n) => { tri(out, cls, a, b, c, n?.[0], n?.[1], n?.[2]); tri(out, cls, a, c, d, n?.[0], n?.[2], n?.[3]); };

function frame(axis) {
  const w = norm(axis);
  const u = norm(cross(Math.abs(w[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0], w));
  return [u, cross(w, u), w];
}

/** Capped cylinder / cone from p0 to p1. Smooth sides, flat caps. */
export function cylinder(out, cls, p0, p1, r0, r1 = r0, seg = 8, caps = true) {
  const [u, v] = frame(sub(p1, p0));
  const ring = (p, r, i) => { const a = (i / seg) * Math.PI * 2; const d = add(mul(u, Math.cos(a)), mul(v, Math.sin(a))); return [add(p, mul(d, r)), d]; };
  for (let i = 0; i < seg; i++) {
    const [a0, n0] = ring(p0, r0, i), [a1, n1] = ring(p0, r0, i + 1), [b0] = ring(p1, r1, i), [b1] = ring(p1, r1, i + 1);
    quad(out, cls, a0, a1, b1, b0, [n0, n1, n1, n0]);
    if (caps) { tri(out, cls, p0, a1, a0); tri(out, cls, p1, b0, b1); }
  }
}

/** Axis-aligned box. */
export function box(out, cls, [cx, cy, cz], [sx, sy, sz]) {
  const x = sx / 2, y = sy / 2, z = sz / 2, v = (i, j, k) => [cx + i * x, cy + j * y, cz + k * z];
  quad(out, cls, v(1, -1, -1), v(1, 1, -1), v(1, 1, 1), v(1, -1, 1));
  quad(out, cls, v(-1, -1, 1), v(-1, 1, 1), v(-1, 1, -1), v(-1, -1, -1));
  quad(out, cls, v(-1, 1, -1), v(-1, 1, 1), v(1, 1, 1), v(1, 1, -1));
  quad(out, cls, v(-1, -1, 1), v(-1, -1, -1), v(1, -1, -1), v(1, -1, 1));
  quad(out, cls, v(-1, -1, 1), v(1, -1, 1), v(1, 1, 1), v(-1, 1, 1));
  quad(out, cls, v(1, -1, -1), v(-1, -1, -1), v(-1, 1, -1), v(1, 1, -1));
}

/** Tyre + hub revolved about the X axis at `c`. Tyre profile: flat tread, rounded shoulders. */
function wheel(out, c, r, w) {
  const seg = 16, hw = w / 2, rim = r * 0.58;
  // (radius, x) profile of the tyre, outer tread to inner rim
  const prof = [[rim, -hw * 0.8], [r * 0.86, -hw], [r * 0.97, -hw * 0.8], [r, -hw * 0.4], [r, hw * 0.4], [r * 0.97, hw * 0.8], [r * 0.86, hw], [rim, hw * 0.8]];
  const pt = (rr, x, a) => [c[0] + x, c[1] + Math.cos(a) * rr, c[2] + Math.sin(a) * rr];
  for (let i = 0; i < seg; i++) {
    const a0 = (i / seg) * Math.PI * 2, a1 = ((i + 1) / seg) * Math.PI * 2;
    for (let k = 0; k < prof.length - 1; k++) {
      const [ra, xa] = prof[k], [rb, xb] = prof[k + 1];
      quad(out, 'tire', pt(ra, xa, a0), pt(ra, xa, a1), pt(rb, xb, a1), pt(rb, xb, a0));
    }
  }
  // hub: short drum plus bearing boss either side
  cylinder(out, 'hub', [c[0] - hw * 0.8, c[1], c[2]], [c[0] + hw * 0.8, c[1], c[2]], rim, rim, seg);
  cylinder(out, 'hub', [c[0] - hw * 1.15, c[1], c[2]], [c[0] + hw * 1.15, c[1], c[2]], r * 0.2, r * 0.2, 8);
}

/** Wheel meshes, one per WHEELS entry, in model space around each axle. */
export function buildWheel(id) {
  const out = [], w = WHEELS.find((x) => x.id === id);
  const nose = id === 'nose';
  wheel(out, [w.x, AXLE_Y, w.z], nose ? WHEEL_R_MODEL.nose : WHEEL_R_MODEL.main, (nose ? 0.1 : 0.12) * M);
  return out;
}

const TUBE = 0.022 * M; // 44 mm gear tube

/** Main-gear leg, split in the part that travels with the axle (`moving`) and the spring sleeve
 * fixed to the airframe (`fixed`); the lower leg slides into the sleeve as the strut compresses. */
export function buildMainGear(id) {
  const moving = [], fixed = [], w = WHEELS.find((x) => x.id === id), s = Math.sign(w.x);
  const hw = 0.075 * M;
  const inner = [w.x - s * hw, AXLE_Y, w.z];
  const top = [w.x - s * 0.028, 0.128, w.z]; // where the airframe's gear struts converge
  const along = (f) => add(inner, mul(sub(top, inner), f));
  cylinder(moving, 'mech', [w.x - s * hw, AXLE_Y, w.z], [w.x + s * hw * 1.2, AXLE_Y, w.z], 0.018 * M, 0.018 * M, 8); // axle
  cylinder(moving, 'frame', inner, along(0.8), TUBE, TUBE, 8); // lower leg
  cylinder(moving, 'engine', [w.x - s * hw * 0.98, AXLE_Y, w.z], [w.x - s * hw * 0.6, AXLE_Y, w.z], 0.09 * M, 0.09 * M, 12); // brake drum
  cylinder(fixed, 'mech', along(0.45), top, TUBE * 1.55, TUBE * 1.55, 8); // spring sleeve
  return { moving, fixed };
}

/** Nose fork: two blades, crown and steering tube. Lives under the steering node so it turns. */
export function buildNoseFork() {
  const out = [], w = WHEELS.find((x) => x.id === 'nose'), hw = 0.065 * M;
  const crownY = AXLE_Y + WHEEL_R_MODEL.nose + 0.05 * M;
  for (const s of [1, -1]) cylinder(out, 'frame', [w.x + s * hw, AXLE_Y, w.z], [w.x + s * hw, crownY, w.z - 0.02 * M], TUBE * 0.8, TUBE * 0.8, 8);
  box(out, 'frame', [w.x, crownY + 0.01 * M, w.z - 0.02 * M], [hw * 2 + TUBE * 2, 0.03 * M, 0.06 * M]);
  cylinder(out, 'mech', [w.x, crownY + 0.02 * M, w.z - 0.02 * M], [w.x, 0.128, w.z - 0.02 * M], TUBE * 1.3, TUBE * 1.3, 8);
  cylinder(out, 'mech', [w.x - hw, AXLE_Y, w.z], [w.x + hw, AXLE_Y, w.z], 0.015 * M, 0.015 * M, 8); // axle
  return out;
}

/**
 * Two-stroke twin pusher installation, drawn around the sculpt's engine station on the wing centre
 * (model: x 0, y .335-.43, z .07-.24) and its prop hub behind the trailing edge. Parts, front to back:
 * air filter + carburettor (left), crankcase with two finned cylinders, tuned exhaust + muffler
 * (right), reduction drive dropping to the prop shaft, mount plate and four rubber-bushed legs.
 */
export function buildEngine() {
  const out = [];
  const cx = 0, cy = 0.372, cz = 0.14;
  // crankcase (dark) + mount plate on the keel/root tube
  box(out, 'engine', [cx, cy, cz], [0.3 * M, 0.2 * M, 0.34 * M]);
  box(out, 'mech', [cx, cy - 0.12 * M, cz], [0.36 * M, 0.035 * M, 0.44 * M]);
  for (const sx of [1, -1]) for (const sz of [1, -1]) {
    const foot = [cx + sx * 0.15 * M, cy - 0.14 * M, cz + sz * 0.18 * M];
    cylinder(out, 'engine', foot, [foot[0], foot[1] - 0.12 * M, foot[2]], 0.025 * M, 0.025 * M, 6); // rubber mount legs
  }
  // two cylinders standing up from the case, fore and aft, finned and capped by heads
  for (const dz of [0.085, -0.085]) {
    const base = [cx, cy + 0.1 * M, cz + dz * M], top = [cx, cy + 0.33 * M, cz + dz * M];
    cylinder(out, 'mech', base, top, 0.07 * M, 0.07 * M, 10);
    for (let f = 0; f < 4; f++) {
      const y = cy + (0.14 + f * 0.05) * M;
      cylinder(out, 'mech', [cx, y, cz + dz * M], [cx, y + 0.015 * M, cz + dz * M], 0.1 * M, 0.1 * M, 10);
    }
    box(out, 'engine', [cx, cy + 0.36 * M, cz + dz * M], [0.17 * M, 0.06 * M, 0.15 * M]); // head
    cylinder(out, 'wire', [cx, cy + 0.39 * M, cz + dz * M], [cx - 0.06 * M, cy + 0.43 * M, cz + dz * M], 0.008 * M, 0.008 * M, 5); // plug lead
  }
  // intake: carburettor stub and a round filter pod on the left (+X) side
  const carb = [cx + 0.15 * M, cy + 0.06 * M, cz];
  cylinder(out, 'mech', carb, add(carb, [0.1 * M, 0, 0]), 0.035 * M, 0.035 * M, 8);
  cylinder(out, 'prop', add(carb, [0.1 * M, 0, 0]), add(carb, [0.22 * M, 0, 0]), 0.065 * M, 0.055 * M, 10); // oiled-foam filter
  // exhaust: headers out of the right (-X) side, down into a tuned pipe + muffler running aft under the case
  const pipeY = cy - 0.02 * M, pipeX = cx - 0.22 * M;
  for (const dz of [0.085, -0.085]) {
    const port = [cx - 0.07 * M, cy + 0.2 * M, cz + dz * M];
    cylinder(out, 'exhaust', port, [pipeX, pipeY + 0.06 * M, cz + dz * M], 0.022 * M, 0.022 * M, 6, false);
    cylinder(out, 'exhaust', [pipeX, pipeY + 0.06 * M, cz + dz * M], [pipeX, pipeY, cz], 0.022 * M, 0.03 * M, 6, false);
  }
  cylinder(out, 'exhaust', [pipeX, pipeY, cz + 0.2 * M], [pipeX, pipeY, cz - 0.28 * M], 0.05 * M, 0.06 * M, 10);
  cylinder(out, 'exhaust', [pipeX, pipeY, cz - 0.28 * M], [pipeX, pipeY - 0.01 * M, cz - 0.38 * M], 0.02 * M, 0.02 * M, 6);
  // reduction drive: belt/gear housing from the crank at the back of the case down to the prop shaft
  const shaft = [PROP_HUB[0], PROP_HUB[1], PROP_HUB[2]];
  const back = cz - 0.17 * M;
  box(out, 'engine', [cx, (cy + shaft[1]) / 2 - 0.02 * M, back - 0.04 * M], [0.2 * M, cy - shaft[1] + 0.26 * M, 0.08 * M]);
  cylinder(out, 'mech', [cx, shaft[1], back - 0.08 * M], [cx, shaft[1], shaft[2] + 0.02 * M], 0.03 * M, 0.03 * M, 8); // prop shaft
  cylinder(out, 'mech', [cx, shaft[1], shaft[2] + 0.03 * M], [cx, shaft[1], shaft[2] + 0.005 * M], 0.07 * M, 0.07 * M, 10); // drive flange
  return out;
}

/** Spinner-less hub plate that turns with the propeller (drawn in propeller-pivot local space). */
export function buildPropHub() {
  const out = [], [x, y, z] = PROP_HUB;
  cylinder(out, 'mech', [x, y, z + 0.012 * M], [x, y, z - 0.03 * M], 0.06 * M, 0.06 * M, 10);
  cylinder(out, 'mech', [x, y, z - 0.03 * M], [x, y, z - 0.07 * M], 0.045 * M, 0.02 * M, 10);
  return out;
}
