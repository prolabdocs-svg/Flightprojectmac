// Generates the Master Geographic Map V1 validation artifacts.
//   node scripts/world/run.mjs /scripts/world/renderMasterMap.ts [outDir] [only=name,name]
// Uses `sharp` (present in node_modules as a transitive dev dependency) for PNG encoding + SVG labels.
import { mkdirSync, writeFileSync } from 'node:fs';
import sharp from 'sharp';
import { GRID_N, HALF_M, NATURAL_LANDMARKS, REGION_IDS, REGION_NAMES, STARTER_BASIN, worldToGeo } from '../../src/world/master/masterGeography';
import { RIVER_ACCUM_CELLS, STREAM_ACCUM_CELLS, getMasterMap, type MasterMapData } from '../../src/world/master/masterMap';
import { computeMasterStats } from '../../src/world/master/masterStats';

const OUT = process.argv[3] ?? 'docs/world/master-map-v1';
const ONLY = (process.argv[4] ?? '').split(',').filter(Boolean);
const want = (n: string) => ONLY.length === 0 || ONLY.includes(n);
mkdirSync(OUT, { recursive: true });

const N = GRID_N;
const m = getMasterMap();
const h = m.heightM;
const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/* ---------- colour ramps ---------- */
const LAND: ReadonlyArray<readonly [number, number, number, number]> = [
  [0, 132, 170, 112], [40, 150, 186, 116], [150, 184, 198, 128], [300, 210, 204, 138], [520, 208, 178, 116], [800, 184, 146, 98],
  [1200, 156, 122, 94], [1700, 146, 130, 122], [2200, 182, 180, 180], [2850, 250, 250, 252],
];
function ramp(t: ReadonlyArray<readonly [number, number, number, number]>, v: number): [number, number, number] {
  if (v <= t[0][0]) return [t[0][1], t[0][2], t[0][3]];
  for (let i = 1; i < t.length; i++) if (v <= t[i][0]) { const u = (v - t[i - 1][0]) / (t[i][0] - t[i - 1][0]); return [lerp(t[i - 1][1], t[i][1], u), lerp(t[i - 1][2], t[i][2], u), lerp(t[i - 1][3], t[i][3], u)]; }
  const l = t[t.length - 1]; return [l[1], l[2], l[3]];
}
const SEA_COL = (d: number): [number, number, number] => { const u = clamp(-d / 500, 0, 1) ** 0.55; return [lerp(96, 14, u), lerp(176, 52, u), lerp(196, 100, u)]; };

/* ---------- hillshade ---------- */
function hillshade(zx: number, az = 315, alt = 42): Float32Array {
  const out = new Float32Array(N * N), A = (az * Math.PI) / 180, Z = (alt * Math.PI) / 180;
  const lx = Math.sin(A) * Math.cos(Z), ly = Math.cos(A) * Math.cos(Z), lz = Math.sin(Z);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const i0 = Math.max(0, i - 1), i1 = Math.min(N - 1, i + 1), j0 = Math.max(0, j - 1), j1 = Math.min(N - 1, j + 1);
    const gx = ((h[j * N + i1] - h[j * N + i0]) / ((i1 - i0) * m.cellM)) * zx, gy = ((h[j1 * N + i] - h[j0 * N + i]) / ((j1 - j0) * m.cellM)) * zx;
    const nl = Math.hypot(gx, gy, 1);
    out[j * N + i] = clamp((-gx * lx - gy * ly + lz) / nl, 0, 1);
  }
  return out;
}
const shadeBroad = hillshade(3.2), shadeFine = hillshade(1.6, 20, 55);
const shade = (k: number) => 0.62 * shadeBroad[k] + 0.38 * shadeFine[k];

/* ---------- per-cell colours ---------- */
function satelliteColour(k: number): [number, number, number] {
  const s = shade(k);
  if (h[k] <= 0) {
    const c = SEA_COL(h[k]);
    const foam = clamp(1 - Math.abs(h[k]) / 6, 0, 1) ** 2 * 0.35;
    const f = 1;
    return [lerp(c[0] * f, 235, foam), lerp(c[1] * f, 245, foam), lerp(c[2] * f, 245, foam)];
  }
  const w = m.water[k];
  if (w === 2 || w === 3) return [52 + 20 * s, 104 + 25 * s, 138 + 25 * s];
  if (w === 1 || (riverDraw[k] && h[k] < 2900 && m.water[k] === 0 && m.hydro.accum[k] >= 400)) return [58, 118, 156];
  const c = ramp(LAND, h[k]);
  const f = 0.42 + 0.95 * s;
  return [clamp(c[0] * f, 0, 255), clamp(c[1] * f, 0, 255), clamp(c[2] * f, 0, 255)];
}

// Thin 1-cell rivers alias to dashes in renders; widen them by one cell for colouring only (data untouched).
const riverDraw = new Uint8Array(N * N);
for (let j = 1; j < N - 1; j++) for (let i = 1; i < N - 1; i++) {
  const k = j * N + i;
  if (h[k] > 0 && m.water[k] === 1) for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) riverDraw[k + dj * N + di] = 1;
}
const cellColours = new Uint8Array(N * N * 3);
for (let k = 0; k < N * N; k++) { const c = satelliteColour(k); cellColours[k * 3] = c[0]; cellColours[k * 3 + 1] = c[1]; cellColours[k * 3 + 2] = c[2]; }

/* ---------- image helpers (north-up: row 0 of the image = grid row N-1) ---------- */
function toImage(fn: (k: number) => [number, number, number]): Buffer {
  const buf = Buffer.alloc(N * N * 3);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const c = fn(j * N + i), o = ((N - 1 - j) * N + i) * 3;
    buf[o] = c[0]; buf[o + 1] = c[1]; buf[o + 2] = c[2];
  }
  return buf;
}
const S = 2000, PX = S / 48;
const px = (e: number) => (e + 24) * PX, py = (n: number) => (24 - n) * PX;

function overlay(opts: { title: string; grid?: boolean; regions?: boolean; landmarks?: boolean; legend?: string; regionsOutline?: boolean }): string {
  const parts: string[] = [];
  if (opts.grid !== false) {
    for (let v = -24; v <= 24; v += 8) {
      parts.push(`<line x1="${px(v)}" y1="0" x2="${px(v)}" y2="${S}" stroke="#fff" stroke-opacity="0.28" stroke-width="1"/>`);
      parts.push(`<line x1="0" y1="${py(v)}" x2="${S}" y2="${py(v)}" stroke="#fff" stroke-opacity="0.28" stroke-width="1"/>`);
      parts.push(`<text x="${px(v) + 4}" y="${S - 6}" font-size="15" fill="#fff" fill-opacity="0.85" font-family="Helvetica,Arial">E ${v}</text>`);
      parts.push(`<text x="4" y="${py(v) - 4}" font-size="15" fill="#fff" fill-opacity="0.85" font-family="Helvetica,Arial">N ${v}</text>`);
    }
  }
  if (opts.regions) {
    REGION_IDS.forEach((rid, ri) => {
      let sx = 0, sy = 0, c = 0;
      for (let j = 0; j < N; j += 2) for (let i = 0; i < N; i += 2) if (m.region[j * N + i] === ri) { sx += i; sy += j; c++; }
      if (!c) return;
      const e = -24 + (sx / c + 0.5) * (48 / N), n = -24 + (sy / c + 0.5) * (48 / N);
      parts.push(`<text x="${px(e)}" y="${py(n)}" text-anchor="middle" font-size="26" font-weight="700" fill="#fff" stroke="#111" stroke-width="5" paint-order="stroke" font-family="Helvetica,Arial">${rid.slice(0, 3)}</text>`);
      parts.push(`<text x="${px(e)}" y="${py(n) + 24}" text-anchor="middle" font-size="19" fill="#fff" stroke="#111" stroke-width="4" paint-order="stroke" font-family="Helvetica,Arial">${REGION_NAMES[rid]}</text>`);
    });
  }
  if (opts.landmarks) {
    for (const L of NATURAL_LANDMARKS) {
      parts.push(`<circle cx="${px(L.e)}" cy="${py(L.n)}" r="6" fill="#ffd400" stroke="#111" stroke-width="2"/>`);
      parts.push(`<text x="${px(L.e) + 10}" y="${py(L.n) + 5}" font-size="17" fill="#fff" stroke="#111" stroke-width="4" paint-order="stroke" font-family="Helvetica,Arial">${L.name}</text>`);
    }
    const [he, hn] = STARTER_BASIN.homeGeoKm;
    parts.push(`<path d="M${px(he)} ${py(hn) - 11} l9 18 h-18 z" fill="#e63b2e" stroke="#111" stroke-width="2"/>`);
    parts.push(`<text x="${px(he) + 12}" y="${py(hn) + 6}" font-size="17" fill="#fff" stroke="#111" stroke-width="4" paint-order="stroke" font-family="Helvetica,Arial">A0 Hangar (The Field)</text>`);
    const sb = STARTER_BASIN, half = sb.coreRadiusM / 1000;
    parts.push(`<rect x="${px(he - half)}" y="${py(hn + half)}" width="${2 * half * PX}" height="${2 * half * PX}" fill="none" stroke="#ff5a4d" stroke-width="2" stroke-dasharray="10 6"/>`);
    const fe = sb.fadeEndM / 1000;
    parts.push(`<rect x="${px(he - fe)}" y="${py(hn + fe)}" width="${2 * fe * PX}" height="${2 * fe * PX}" fill="none" stroke="#ff5a4d" stroke-opacity="0.5" stroke-width="1.5" stroke-dasharray="3 6"/>`);
  }
  // scale bar + north arrow + title
  parts.push(`<rect x="${S - 250}" y="${S - 46}" width="${10 * PX}" height="8" fill="#fff" stroke="#111"/><text x="${S - 250}" y="${S - 52}" font-size="16" fill="#fff" stroke="#111" stroke-width="3" paint-order="stroke" font-family="Helvetica,Arial">10 km</text>`);
  parts.push(`<path d="M${S - 60} 70 l12 -38 l12 38 l-12 -9 z" fill="#fff" stroke="#111" stroke-width="2"/><text x="${S - 60}" y="94" text-anchor="middle" font-size="20" fill="#fff" stroke="#111" stroke-width="3" paint-order="stroke" font-family="Helvetica,Arial">N</text>`);
  parts.push(`<text x="20" y="38" font-size="26" font-weight="700" fill="#fff" stroke="#111" stroke-width="5" paint-order="stroke" font-family="Helvetica,Arial">${opts.title}</text>`);
  if (opts.legend) parts.push(opts.legend);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${S}" height="${S}">${parts.join('')}</svg>`;
}

async function saveMap(name: string, buf: Buffer, ov?: string): Promise<void> {
  let img = sharp(buf, { raw: { width: N, height: N, channels: 3 } }).resize(S, S, { kernel: 'lanczos3' });
  if (ov) img = img.composite([{ input: Buffer.from(ov) }]);
  await img.png().toFile(`${OUT}/${name}.png`);
  console.log('wrote', name);
}

/* ---------- 1. satellite / relief ---------- */
async function main(): Promise<void> {
  const stats = computeMasterStats(m);
  writeFileSync(`${OUT}/stats.json`, JSON.stringify(stats, null, 2));

  if (want('01_satellite_relief')) await saveMap('01_satellite_relief', toImage((k) => { const c = satelliteColour(k); return c; }), overlay({ title: 'Master Geographic Map V1 — relief cenital', regions: false, landmarks: true }));
  if (want('01b_satellite_clean')) await saveMap('01b_satellite_clean', toImage(satelliteColour));

  // 2. heightmap grayscale 16-bit (−800..3000 m mapped to 0..65535) + 8-bit preview
  if (want('02_heightmap')) {
    const buf16 = Buffer.alloc(N * N * 2), buf8 = Buffer.alloc(N * N);
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const v = clamp((h[j * N + i] + 800) / 3800, 0, 1), o = (N - 1 - j) * N + i;
      buf16.writeUInt16BE(Math.round(v * 65535), o * 2); buf8[o] = Math.round(v * 255);
    }
    await sharp(buf8, { raw: { width: N, height: N, channels: 1 } }).resize(S, S).png().toFile(`${OUT}/02_heightmap_gray.png`);
    await sharp(buf16, { raw: { width: N, height: N, channels: 1, depth: 'ushort' } }).png().toFile(`${OUT}/02_heightmap_16bit_1000px.png`);
    console.log('wrote 02_heightmap');
  }

  // 3. hillshade
  if (want('03_hillshade')) await saveMap('03_hillshade', toImage((k) => { const v = h[k] <= 0 ? 0.35 + 0.4 * shade(k) : shade(k); return [v * 255, v * 255, v * 255]; }), overlay({ title: 'Hillshade (terreno desnudo)', grid: false }));

  // 4. hypsometric with contours every 200 m
  if (want('04_hypsometric')) {
    await saveMap('04_hypsometric', toImage((k) => {
      if (h[k] <= 0) return SEA_COL(h[k]);
      const c = ramp(LAND, h[k]);
      const i = k % N, j = (k / N) | 0;
      const band = Math.floor(h[k] / 200);
      const edge = (i + 1 < N && Math.floor(h[k + 1] / 200) !== band) || (j + 1 < N && Math.floor(h[k + N] / 200) !== band);
      const f = edge ? 0.62 : 1;
      return [c[0] * f, c[1] * f, c[2] * f];
    }), overlay({ title: 'Hipsométrico + curvas cada 200 m', grid: true }));
  }

  // 5. slope
  if (want('05_slope')) {
    const SL: ReadonlyArray<readonly [number, number, number, number]> = [[0, 236, 240, 214], [4, 214, 226, 160], [10, 236, 214, 110], [20, 232, 150, 70], [32, 200, 70, 60], [45, 120, 30, 90], [60, 40, 10, 50]];
    await saveMap('05_slope', toImage((k) => (h[k] <= 0 ? [30, 60, 90] : ramp(SL, m.slopeDeg[k]))), overlay({ title: 'Pendientes (°): menos de 4 · 10 · 20 · 32 · 45+', grid: false }));
  }

  // 6. hydrology / basins
  if (want('06_hydrology_basins')) {
    const basinArea = new Map<number, number>();
    for (let k = 0; k < N * N; k++) if (h[k] > 0) basinArea.set(m.basin[k], (basinArea.get(m.basin[k]) ?? 0) + 1);
    const colour = (id: number): [number, number, number] => { const x = Math.imul(id + 7, 2654435761) >>> 0; return [90 + (x & 127), 90 + ((x >> 8) & 127), 90 + ((x >> 16) & 127)]; };
    await saveMap('06_hydrology_basins', toImage((k) => {
      if (h[k] <= 0) return [22, 46, 74];
      const a = m.hydro.accum[k];
      const f = 0.55 + 0.6 * shade(k);
      if (m.water[k] === 2 || m.water[k] === 3) return [40, 120, 220];
      if (a >= RIVER_ACCUM_CELLS * 4) return [10, 60, 220];
      if (a >= RIVER_ACCUM_CELLS) return [30, 110, 240];
      if (a >= STREAM_ACCUM_CELLS) return [120, 175, 235];
      const big = (basinArea.get(m.basin[k]) ?? 0) * (m.cellM / 1000) ** 2 > 25;
      const c = big ? colour(m.basin[k]) : [175, 175, 170];
      return [Math.min(255, c[0] * f), Math.min(255, c[1] * f), Math.min(255, c[2] * f)];
    }), overlay({ title: 'Cuencas y drenaje (ríos: accum ≥ 2.3 km²)', grid: true }));
  }

  // 7. regions
  if (want('07_regions')) {
    const RC: Array<[number, number, number]> = [[232, 96, 76], [240, 200, 70], [120, 130, 180], [214, 150, 90], [110, 180, 100], [70, 190, 200], [190, 100, 190], [90, 150, 230], [170, 120, 80]];
    await saveMap('07_regions', toImage((k) => {
      if (h[k] <= 0) return [24, 50, 80];
      const r = m.region[k], f = 0.5 + 0.7 * shade(k);
      const c = r === 255 ? [128, 128, 128] : RC[r];
      return [Math.min(255, c[0] * f * 0.85 + 30), Math.min(255, c[1] * f * 0.85 + 30), Math.min(255, c[2] * f * 0.85 + 30)];
    }), overlay({ title: 'Nueve macroregiones (derivadas del relieve)', regions: true, landmarks: true }));
  }

  // 8. clean coast + rivers + lakes
  if (want('08_coast_rivers_lakes')) {
    await saveMap('08_coast_rivers_lakes', toImage((k) => {
      if (h[k] <= 0) return [244, 240, 228];
      const w = m.water[k];
      if (w === 2 || w === 3) return [40, 110, 200];
      if (w === 1) return [30, 90, 200];
      if (m.hydro.accum[k] >= STREAM_ACCUM_CELLS) return [150, 190, 235];
      return [216, 212, 196];
    }), overlay({ title: 'Costa + ríos + lagos', grid: true }));
  }

  // 10. profiles
  if (want('10_profiles')) await profiles();

  // 9. oblique views
  if (want('09_oblique')) {
    const views: Array<{ name: string; title: string; e: number; n: number; alt: number; hdg: number; pitch: number; fov: number; far: number; exag: number }> = [
      { name: 'v1_sur_hacia_cordillera', title: 'V1 · Desde el mar del sur hacia el Valle Central y la cordillera (N)', e: 1, n: -23.5, alt: 1700, hdg: 0, pitch: 9, fov: 70, far: 50, exag: 1 },
      { name: 'v2_starter_basin', title: 'V2 · Starter Basin (hangar A0) mirando al norte, 700 m', e: -10.5, n: -2.5, alt: 760, hdg: 8, pitch: 6, fov: 75, far: 45, exag: 1 },
      { name: 'v3_cordillera_eje', title: 'V3 · Eje NW→SE de la cordillera desde el NW (3,400 m)', e: -21.5, n: 9.5, alt: 3400, hdg: 62, pitch: 12, fov: 72, far: 60, exag: 1 },
      { name: 'v4_estrecho_isla', title: 'V4 · Highlands → estrecho → Isla Oriental (2,000 m)', e: 3.5, n: 1.2, alt: 2000, hdg: 90, pitch: 9, fov: 75, far: 45, exag: 1 },
      { name: 'v5_badlands_costa', title: 'V5 · Badlands y costa oeste desde el mar (900 m)', e: -23.6, n: -14, alt: 900, hdg: 25, pitch: 4, fov: 78, far: 40, exag: 1 },
      { name: 'v6_archipielago_volcan', title: 'V6 · Archipiélago (arco volcánico) hacia la Isla Oriental (1,100 m)', e: -6, n: -23.5, alt: 1100, hdg: 78, pitch: 5, fov: 78, far: 50, exag: 1 },
      { name: 'v7_panorama_alto', title: 'V7 · Panorámica alta desde el sur (exag. vertical ×1.6)', e: 0, n: -40, alt: 9500, hdg: 0, pitch: 22, fov: 55, far: 100, exag: 1.6 },
      { name: 'v8_valle_central', title: 'V8 · Valle Central y río principal desde el sur (1,000 m)', e: 3.5, n: -12, alt: 1000, hdg: 350, pitch: 6, fov: 70, far: 40, exag: 1 },
    ];
    for (const v of views) await oblique(v);
  }
}

/* ---------- oblique voxel-space renderer ---------- */
function colourAt(e: number, n: number): [number, number, number] {
  const fi = clamp((e * 1000 + HALF_M) / m.cellM - 0.5, 0, N - 1.001), fj = clamp((n * 1000 + HALF_M) / m.cellM - 0.5, 0, N - 1.001);
  const i = Math.floor(fi), j = Math.floor(fj), u = fi - i, v = fj - j, k = j * N + i;
  const ch = (o: number) => lerp(lerp(cellColours[k * 3 + o], cellColours[(k + 1) * 3 + o], u), lerp(cellColours[(k + N) * 3 + o], cellColours[(k + N + 1) * 3 + o], u), v);
  return [ch(0), ch(1), ch(2)];
}
function bil(a: Float32Array, e: number, n: number): number {
  const fi = clamp((e * 1000 + HALF_M) / m.cellM - 0.5, 0, N - 1.001), fj = clamp((n * 1000 + HALF_M) / m.cellM - 0.5, 0, N - 1.001);
  const i = Math.floor(fi), j = Math.floor(fj), u = fi - i, v = fj - j, k = j * N + i;
  return lerp(lerp(a[k], a[k + 1], u), lerp(a[k + N], a[k + N + 1], u), v);
}
async function oblique(v: { name: string; title: string; e: number; n: number; alt: number; hdg: number; pitch: number; fov: number; far: number; exag: number }): Promise<void> {
  const W = 1600, H = 800, buf = Buffer.alloc(W * H * 3);
  const focal = (W / 2) / Math.tan((v.fov * Math.PI) / 360), horizon = H / 2 - focal * Math.tan((v.pitch * Math.PI) / 180);
  const sky = (y: number): [number, number, number] => { const t = clamp(y / Math.max(1, horizon), 0, 1); return [lerp(70, 196, t), lerp(122, 218, t), lerp(200, 236, t)]; };
  for (let y = 0; y < H; y++) { const c = sky(Math.min(y, horizon)); for (let x = 0; x < W; x++) { const o = (y * W + x) * 3; buf[o] = c[0]; buf[o + 1] = c[1]; buf[o + 2] = c[2]; } }
  const hz: [number, number, number] = [196, 214, 230];
  const hgt = (k: number, e: number, n: number) => { const z = bil(h, e, n); return (z <= 0 ? 0 : z) * v.exag; };
  for (let x = 0; x < W; x++) {
    const rel = Math.atan(((2 * x) / W - 1) * Math.tan((v.fov * Math.PI) / 360)), th = ((v.hdg * Math.PI) / 180) + rel;
    const dx = Math.sin(th), dy = Math.cos(th), cosRel = Math.cos(rel);
    let ymin = H;
    for (let d = 0.15; d < v.far; d += 0.03 + d * 0.0028) {
      const e = v.e + dx * d, n = v.n + dy * d;
      const zc = d * cosRel * 1000;
      const i = clamp(Math.round((e * 1000 + HALF_M) / m.cellM - 0.5), 0, N - 1), j = clamp(Math.round((n * 1000 + HALF_M) / m.cellM - 0.5), 0, N - 1), k = j * N + i;
      const g = bil(h, e, n), water = g <= 0 || m.water[k] === 2 || m.water[k] === 3;
      const top = (water ? (g <= 0 ? 0 : m.hydro.filled[k]) : g) * v.exag;
      const y = horizon + (focal * (v.alt - top)) / zc;
      if (y >= ymin) continue;
      let c: [number, number, number] = colourAt(e, n);
      const haze = 1 - Math.exp(-Math.pow(d / (v.far * 0.55), 1.7));
      c = [lerp(c[0], hz[0], haze), lerp(c[1], hz[1], haze), lerp(c[2], hz[2], haze)];
      const y0 = Math.max(0, Math.floor(y)), y1 = Math.min(H, Math.floor(ymin));
      for (let yy = y0; yy < y1; yy++) { const o = (yy * W + x) * 3; buf[o] = c[0]; buf[o + 1] = c[1]; buf[o + 2] = c[2]; }
      ymin = y; void hgt;
    }
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><text x="16" y="34" font-size="24" font-weight="700" fill="#fff" stroke="#111" stroke-width="5" paint-order="stroke" font-family="Helvetica,Arial">${v.title}</text></svg>`;
  await sharp(buf, { raw: { width: W, height: H, channels: 3 } }).composite([{ input: Buffer.from(svg) }]).png().toFile(`${OUT}/09_oblique_${v.name}.png`);
  console.log('wrote oblique', v.name);
}

/* ---------- profiles (SVG + PNG) ---------- */
async function profiles(): Promise<void> {
  const line = (a: [number, number], b: [number, number], len: number) => Array.from({ length: len }, (_, t) => { const u = t / (len - 1); return { d: u * Math.hypot(b[0] - a[0], b[1] - a[1]), e: lerp(a[0], b[0], u), n: lerp(a[1], b[1], u) }; });
  const prof = (pts: Array<{ d: number; e: number; n: number }>) => pts.map((p) => ({ d: p.d, z: bil(h, p.e, p.n) }));
  const river = m.rivers.find((r) => r.id === 'rio_principal')!;
  let acc = 0;
  const riverProf = Array.from(river.e, (_, i) => { if (i) acc += Math.hypot(river.e[i] - river.e[i - 1], river.n[i] - river.n[i - 1]); return { d: acc, z: river.floorM[i] }; });
  const sets = [
    { name: 'NW-SE', title: 'Perfil NW→SE diagonal: (−23,+23) → (+23,−23) km', data: prof(line([-23, 23], [23, -23], 1400)), color: '#c2410c' },
    { name: 'N-S', title: 'Perfil N→S a E = −9.5 km (Gran Pico → Starter Basin → costa sur → península)', data: prof(line([-9.5, 23], [-9.5, -22], 1400)), color: '#1d4ed8' },
    { name: 'W-E', title: 'Perfil W→E a N = +2 km (Badlands → Valle → Highlands → estrecho → Isla)', data: prof(line([-23, 2], [23, 2], 1400)), color: '#15803d' },
    { name: 'rio_principal', title: 'Perfil longitudinal del Río Principal (lago Espejo → desembocadura)', data: riverProf, color: '#0e7490' },
  ];
  for (const s of sets) {
    const W = 1400, Ht = 420, ml = 70, mb = 40, mt = 40, dMax = s.data[s.data.length - 1].d, zMax = Math.max(500, Math.ceil(Math.max(...s.data.map((p) => p.z)) / 500) * 500), zMin = Math.min(-100, Math.floor(Math.min(...s.data.map((p) => p.z)) / 100) * 100);
    const X = (d: number) => ml + (d / dMax) * (W - ml - 20), Y = (z: number) => mt + (1 - (z - zMin) / (zMax - zMin)) * (Ht - mt - mb);
    const path = s.data.map((p, i) => `${i ? 'L' : 'M'}${X(p.d).toFixed(1)} ${Y(p.z).toFixed(1)}`).join('');
    const grid = [] as string[];
    for (let z = Math.ceil(zMin / 500) * 500; z <= zMax; z += 500) grid.push(`<line x1="${ml}" x2="${W - 20}" y1="${Y(z)}" y2="${Y(z)}" stroke="#ccc"/><text x="8" y="${Y(z) + 4}" font-size="12" font-family="Helvetica">${z} m</text>`);
    for (let d = 0; d <= dMax; d += 10) grid.push(`<line y1="${mt}" y2="${Ht - mb}" x1="${X(d)}" x2="${X(d)}" stroke="#eee"/><text x="${X(d) - 10}" y="${Ht - 18}" font-size="12" font-family="Helvetica">${d.toFixed(0)} km</text>`);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${Ht}"><rect width="100%" height="100%" fill="#fff"/><text x="${ml}" y="24" font-size="16" font-weight="700" font-family="Helvetica">${s.title}</text>${grid.join('')}<line x1="${ml}" x2="${W - 20}" y1="${Y(0)}" y2="${Y(0)}" stroke="#0369a1" stroke-dasharray="4 3"/><path d="${path} L${X(dMax)} ${Y(zMin)} L${X(0)} ${Y(zMin)} Z" fill="${s.color}" fill-opacity="0.22"/><path d="${path}" fill="none" stroke="${s.color}" stroke-width="1.6"/></svg>`;
    writeFileSync(`${OUT}/10_profile_${s.name}.svg`, svg);
    await sharp(Buffer.from(svg)).png().toFile(`${OUT}/10_profile_${s.name}.png`);
  }
  console.log('wrote profiles');
}

await main();
console.log(JSON.stringify({ landPct: computeMasterStats(m).landPct, straitMinKm: computeMasterStats(m).straitMinKm }));
void (null as unknown as MasterMapData); void worldToGeo;
