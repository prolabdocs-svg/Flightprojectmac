// A0 default PROJECT FLIGHT livery: one 1024x1024 atlas, flat colours + a few marks, no fine texture.
// Regions are planar projections of the fabric surfaces so the control-surface footprints can be
// baked as darker tones with an ink hinge line (see split_a0.mjs for the geometry they line up with).
import zlib from 'node:zlib';

export const SIZE = 1024;
export const COLORS = { ivory: '#eee6d2', ivoryDark: '#d3c4a0', accent: '#f06a2a', ink: '#23272b' };
export const G = { hingeGap: 0.003 };

/** Atlas regions (pixels) + the model-space rectangle each one projects. */
export const REGIONS = {
  wingTop: { px: [0, 0, 1024, 256], x: [-0.97, 0.97], z: [-0.08, 0.31], flipU: true },
  wingBottom: { px: [0, 256, 1024, 256], x: [-0.97, 0.97], z: [-0.08, 0.31], flipU: false },
  tailTop: { px: [0, 512, 512, 160], x: [-0.26, 0.26], z: [-0.61, -0.38], flipU: true },
  tailBottom: { px: [0, 672, 512, 160], x: [-0.26, 0.26], z: [-0.61, -0.38], flipU: false },
  finLeft: { px: [512, 512, 256, 320], y: [0.19, 0.44], z: [-0.6, -0.38] }, // seen from +X: nose on the left
  finRight: { px: [768, 512, 256, 320], y: [0.19, 0.44], z: [-0.6, -0.38] }, // seen from -X: nose on the right
};

/** Model-space point + which side -> atlas uv (glTF, v down). Clamped 1.5px inside the region. */
export function uvFor(region, a, b) {
  const R = REGIONS[region];
  const [x0, y0, w, h] = R.px;
  let u, v;
  if (R.x) {
    u = (a - R.x[0]) / (R.x[1] - R.x[0]);
    if (R.flipU) u = 1 - u;
    v = (R.z[1] - b) / (R.z[1] - R.z[0]);
  } else {
    // fin: a = z, b = y
    u = region === 'finLeft' ? (R.z[1] - a) / (R.z[1] - R.z[0]) : (a - R.z[0]) / (R.z[1] - R.z[0]);
    v = (R.y[1] - b) / (R.y[1] - R.y[0]);
  }
  u = Math.min(1 - 1.5 / w, Math.max(1.5 / w, u));
  v = Math.min(1 - 1.5 / h, Math.max(1.5 / h, v));
  return [(x0 + u * w) / SIZE, (y0 + v * h) / SIZE];
}

// 5x7 bitmap glyphs for the marks.
const FONT = {
  A: ['01110', '10001', '10001', '11111', '10001', '10001', '10001'],
  0: ['01110', '10001', '10011', '10101', '11001', '10001', '01110'],
  P: ['11110', '10001', '10001', '11110', '10000', '10000', '10000'],
  R: ['11110', '10001', '10001', '11110', '10100', '10010', '10001'],
  O: ['01110', '10001', '10001', '10001', '10001', '10001', '01110'],
  J: ['00111', '00010', '00010', '00010', '00010', '10010', '01100'],
  E: ['11111', '10000', '10000', '11110', '10000', '10000', '11111'],
  C: ['01110', '10001', '10000', '10000', '10000', '10001', '01110'],
  T: ['11111', '00100', '00100', '00100', '00100', '00100', '00100'],
  F: ['11111', '10000', '10000', '11110', '10000', '10000', '10000'],
  L: ['10000', '10000', '10000', '10000', '10000', '10000', '11111'],
  I: ['01110', '00100', '00100', '00100', '00100', '00100', '01110'],
  G: ['01110', '10001', '10000', '10111', '10001', '10001', '01111'],
  H: ['10001', '10001', '10001', '11111', '10001', '10001', '10001'],
  ' ': ['00000', '00000', '00000', '00000', '00000', '00000', '00000'],
};

/** true if text pixel at (col,row) in cell units is inked; text is laid out left->right, top->bottom. */
function textHit(text, col, row) {
  if (row < 0 || row >= 7 || col < 0) return false;
  const gi = Math.floor(col / 6), gc = col - gi * 6;
  if (gi >= text.length || gc >= 5) return false;
  return FONT[text[gi]][row][gc] === '1';
}
/** Vertical stack: one glyph per 8-row band. */
function stackHit(text, col, row) {
  const gi = Math.floor(row / 8), gr = row - gi * 8;
  if (gi < 0 || gi >= text.length || gr >= 7 || col < 0 || col >= 5) return false;
  return FONT[text[gi]][gr][col] === '1';
}

const hex = (s) => [1, 3, 5].map((i) => parseInt(s.slice(i, i + 2), 16));
const C = Object.fromEntries(Object.entries(COLORS).map(([k, v]) => [k, hex(v)]));

/** Geometry constants shared with split_a0.mjs. */
export const SURF = {
  aileronX0: 0.55, aileronHingeZ: 0.045, wingTipX: 0.885,
  elevatorHingeZ: -0.52, rudderHingeZ: -0.505, rudderBottomY: 0.247,
};

function wingColor(x, z, top) {
  const ax = Math.abs(x), gap = G.hingeGap;
  if (ax > SURF.wingTipX) return C.accent;
  // "A0" designation on both upper wing panels: 11x7 cells, upright when seen from behind (reads toward -x).
  if (top && ax > 0.6 && ax < 0.85) {
    const cell = 0.0155, xc = x > 0 ? 0.72 : -0.72;
    if (textHit('A0', Math.floor((xc + 5.5 * cell - x) / cell), Math.floor((0.17 + 3.5 * cell - z) / cell))) return C.ink;
  }
  // "PROJECT FLIGHT" wordmark under the left wing, read from below.
  if (!top && x > 0.28 && x < 0.9) {
    const cell = 0.0071;
    if (textHit('PROJECT FLIGHT', Math.floor((x - 0.28) / cell), Math.floor((0.2 - z) / cell))) return C.ink;
  }
  const inAileron = ax > SURF.aileronX0 + gap / 2 && z < SURF.aileronHingeZ - gap / 2;
  const nearHinge = ax > SURF.aileronX0 - gap && z < SURF.aileronHingeZ + gap &&
    (Math.abs(z - SURF.aileronHingeZ) < 0.0035 || (Math.abs(ax - SURF.aileronX0) < 0.0035 && z < SURF.aileronHingeZ));
  if (nearHinge) return C.ink;
  return inAileron ? C.ivoryDark : C.ivory;
}

function tailColor(x, z) {
  const ax = Math.abs(x);
  if (ax > 0.215) return C.accent;
  if (Math.abs(z - SURF.elevatorHingeZ) < 0.0025) return C.ink;
  return z < SURF.elevatorHingeZ && ax > 0.012 ? C.ivoryDark : C.ivory;
}

function finColor(z, y, side) {
  if (Math.abs(z - SURF.rudderHingeZ) < 0.0025 && y > SURF.rudderBottomY) return C.ink;
  if (z < SURF.rudderHingeZ && y > SURF.rudderBottomY) return C.accent;
  // vertical "A0" on the fixed fin, upright and reading nose-to-tail from either side
  const cell = 0.0105, row = Math.floor((0.395 - y) / cell);
  const col = side === 'left' ? Math.floor((-0.436 - z) / cell) : Math.floor((z + 0.4888) / cell);
  if (stackHit('A0', col, row)) return C.ink;
  return C.ivory;
}

/** Renders the atlas to RGBA with 2x2 supersampling. */
export function renderAtlas() {
  const img = new Uint8Array(SIZE * SIZE * 4);
  for (let i = 0; i < SIZE * SIZE; i++) { img.set([...C.ivory, 255], i * 4); }
  for (const [name, R] of Object.entries(REGIONS)) {
    const [x0, y0, w, h] = R.px;
    for (let py = 0; py < h; py++) for (let pxl = 0; pxl < w; pxl++) {
      let r = 0, g = 0, b = 0;
      for (let sy = 0; sy < 2; sy++) for (let sx = 0; sx < 2; sx++) {
        const u = (pxl + (sx + 0.5) / 2) / w, v = (py + (sy + 0.5) / 2) / h;
        let col;
        if (R.x) {
          const ux = R.flipU ? 1 - u : u;
          const x = R.x[0] + ux * (R.x[1] - R.x[0]);
          const z = R.z[1] - v * (R.z[1] - R.z[0]);
          col = name.startsWith('wing') ? wingColor(x, z, name === 'wingTop') : tailColor(x, z);
        } else {
          const y = R.y[1] - v * (R.y[1] - R.y[0]);
          const z = name === 'finLeft' ? R.z[1] - u * (R.z[1] - R.z[0]) : R.z[0] + u * (R.z[1] - R.z[0]);
          col = finColor(z, y, name === 'finLeft' ? 'left' : 'right');
        }
        r += col[0]; g += col[1]; b += col[2];
      }
      const o = ((y0 + py) * SIZE + x0 + pxl) * 4;
      img[o] = r / 4; img[o + 1] = g / 4; img[o + 2] = b / 4; img[o + 3] = 255;
    }
  }
  return img;
}

const crcTable = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
export function encodePng(rgba, size = SIZE) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) { raw[y * (size * 4 + 1)] = 0; Buffer.from(rgba.buffer, y * size * 4, size * 4).copy(raw, y * (size * 4 + 1) + 1); }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}
