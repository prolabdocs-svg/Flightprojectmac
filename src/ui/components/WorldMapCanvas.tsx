import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { getRegionMap, type MapPoi, type RegionMap } from '../../map/mapGeography';
import { formatDistance, type MapTarget, type RangeStatus } from '../../map/mapPlan';
import { FOG_CELL_M, FOG_N, isCellRevealed, isRevealed } from '../../world/exploration';
import { homeView, type MapRange, clampView, fitRect, panBy, pointsVisible, scaleLimits, worldToScreen, zoomAt, type Insets, type MapSize, type MapView } from '../../map/mapProjection';

/** Canvas renderer + pointer/touch/wheel interaction for the world map. It only DRAWS map data
 * (see map/mapGeography.ts) and reports taps; all planning logic lives in map/mapPlan.ts. */

export interface WorldMapHandle {
  /** Re-frame on the origin + its range ring (the CENTER / HOME control). */
  centerHome: () => void;
  zoomBy: (factor: number) => void;
}
interface Props {
  regionId: string;
  targets: MapTarget[];
  origin: MapTarget | null;
  originHeadingDeg: number;
  routes: Array<{ from: MapTarget; to: MapTarget }>;
  range: MapRange | null;
  statusOf: (t: MapTarget) => RangeStatus | null;
  selectedId: string | null;
  contractTarget: { x: number; z: number; radiusM: number } | null;
  /** Intermediate FlightPlan points on the selected route (src/nav), drawn as the route's bends. */
  via?: Array<{ x: number; z: number }>;
  /** Screen area covered by the destination panel; keeps the route out from under it. */
  insets: Insets;
  initialView?: MapView;
  onViewChange: (view: MapView) => void;
  onSelect: (id: string | null) => void;
  /** Fog of Discovery bitset (world/exploration.ts), only for the master chart. Null = fully charted. */
  fog?: Uint8Array | null;
}

const COLORS = {
  bg: '#0d1517', text: '#f4f1e6', halo: 'rgba(10,14,15,.88)', accent: '#ff8a4d', accentDeep: '#f06a2a', cyan: '#58c7e8', amber: '#e0a93a', red: '#e2503f',
  river: '#5b9cc0', riverEdge: 'rgba(30,70,96,.75)',
};
const CROP: Record<string, string> = { green: 'rgba(96,150,70,.5)', dry: 'rgba(196,170,96,.5)', bare: 'rgba(150,118,84,.45)', grass: 'rgba(120,160,84,.4)', harvested: 'rgba(206,188,120,.5)' };
const ROAD = {
  asphalt: { fill: '#ece8d8', minPx: 2.6, alpha: 1 },
  gravel: { fill: '#d4c9a4', minPx: 1.8, alpha: 0.95 },
  dirt: { fill: '#b79f78', minPx: 1.2, alpha: 0.85 },
} as const;
/** POI label visibility by priority (px per metre). */
const MIN_SCALE_FOR_LABEL: Record<number, number> = { 1: 0, 2: 0.05, 3: 0.09 };

const rasterCanvases = new Map<string, HTMLCanvasElement>();
function rasterCanvas(map: RegionMap): HTMLCanvasElement | null {
  let c = rasterCanvases.get(map.regionId);
  if (!c) {
    c = document.createElement('canvas');
    c.width = c.height = map.raster.size;
    const ctx = c.getContext('2d');
    if (!ctx) return null;
    ctx.putImageData(new ImageData(new Uint8ClampedArray(map.raster.rgba), map.raster.size, map.raster.size), 0, 0);
    rasterCanvases.set(map.regionId, c);
  }
  return c;
}

/** Unknown territory as a soft cloud deck: one pixel per fog cell (plus a 1-cell border), upscaled with smoothing. */
let fogCache: { fog: Uint8Array; canvas: HTMLCanvasElement } | null = null;
function fogCanvas(fog: Uint8Array): HTMLCanvasElement | null {
  if (fogCache?.fog === fog) return fogCache.canvas;
  const n = FOG_N + 2, c = document.createElement('canvas');
  c.width = c.height = n;
  const ctx = c.getContext('2d');
  if (!ctx) return null;
  const img = ctx.createImageData(n, n);
  for (let py = 0; py < n; py++) for (let px = 0; px < n; px++) {
    const i = FOG_N - px, j = FOG_N - py; // image: east (-x) right, north up; fog rows grow north
    const h = Math.sin(i * 12.9898 + j * 78.233) * 43758.5453, v = 196 + (h - Math.floor(h)) * 30, k = (py * n + px) * 4;
    if (isCellRevealed(fog, i, j)) {
      img.data[k] = 52; img.data[k + 1] = 100; img.data[k + 2] = 132; img.data[k + 3] = 0;
    } else {
      img.data[k] = v; img.data[k + 1] = v + 4; img.data[k + 2] = v + 10; img.data[k + 3] = 164;
    }
  }
  ctx.putImageData(img, 0, 0);
  fogCache = { fog, canvas: c };
  return c;
}

export const WorldMapCanvas = forwardRef<WorldMapHandle, Props>(function WorldMapCanvas(props, ref) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const propsRef = useRef(props);
  propsRef.current = props;
  const sizeRef = useRef<MapSize>({ w: 0, h: 0 });
  const viewRef = useRef<MapView | null>(null);
  const targetRef = useRef<MapView | null>(null);
  const frameRef = useRef(0);
  const regionRef = useRef('');
  const saveTimer = useRef<number>(0);

  // --- drawing ------------------------------------------------------------------------------
  const draw = () => {
    const canvas = canvasRef.current, view = viewRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx || !view) return;
    const p = propsRef.current, size = sizeRef.current, map = getRegionMap(p.regionId);
    const dpr = canvas.width / size.w;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = 'rgb(52,100,132)'; // beyond the map edge the world is open sea (raster edge sinks below sea level)
    ctx.fillRect(0, 0, size.w, size.h);
    const toS = (x: number, z: number) => worldToScreen(view, size, x, z);
    const sc = view.scale;
    const family = getComputedStyle(document.documentElement).getPropertyValue('--font-technical').trim() || 'monospace';

    // Terrain raster (image space == map space: east right, north up).
    const raster = rasterCanvas(map);
    if (raster) {
      const tl = toS(map.rect.maxX, map.rect.maxZ), span = (map.rect.maxX - map.rect.minX) * sc;
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(raster, tl.sx, tl.sy, span, span);
    }

    // Farm parcels.
    if (sc > 0.045) for (const pc of map.parcels) {
      const c = Math.cos(pc.headingRad), s = Math.sin(pc.headingRad);
      ctx.beginPath();
      ([[-1, -1], [1, -1], [1, 1], [-1, 1]] as const).forEach(([ax, az], i) => {
        const lx = (ax * pc.widthM) / 2, lz = (az * pc.depthM) / 2;
        const q = toS(pc.center[0] + lx * c + lz * s, pc.center[1] - lx * s + lz * c);
        if (i === 0) ctx.moveTo(q.sx, q.sy); else ctx.lineTo(q.sx, q.sy);
      });
      ctx.closePath();
      ctx.fillStyle = CROP[pc.crop];
      ctx.fill();
      ctx.strokeStyle = 'rgba(30,40,24,.28)';
      ctx.lineWidth = 0.75;
      ctx.stroke();
    }

    // Graticule.
    const step = [500, 1000, 2000, 5000].find((m) => m * sc >= 90) ?? 5000;
    ctx.strokeStyle = 'rgba(255,255,255,.07)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let m = Math.ceil(map.rect.minX / step) * step; m <= map.rect.maxX; m += step) { const a = toS(m, map.rect.minZ), b = toS(m, map.rect.maxZ); ctx.moveTo(a.sx, a.sy); ctx.lineTo(b.sx, b.sy); }
    for (let m = Math.ceil(map.rect.minZ / step) * step; m <= map.rect.maxZ; m += step) { const a = toS(map.rect.minX, m), b = toS(map.rect.maxX, m); ctx.moveTo(a.sx, a.sy); ctx.lineTo(b.sx, b.sy); }
    ctx.stroke();

    const strokePath = (pts: ReadonlyArray<readonly [number, number]>) => {
      ctx.beginPath();
      pts.forEach(([x, z], i) => { const q = toS(x, z); if (i === 0) ctx.moveTo(q.sx, q.sy); else ctx.lineTo(q.sx, q.sy); });
      ctx.stroke();
    };
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // River: real width (~90 m) but never thinner than 3.5 px.
    for (const river of map.rivers) {
      const w = Math.max(3.5, 60 * sc);
      ctx.strokeStyle = COLORS.riverEdge; ctx.lineWidth = w + 2; strokePath(river);
      ctx.strokeStyle = COLORS.river; ctx.lineWidth = w; strokePath(river);
    }

    // Roads: dark casing then surface; class decides minimum on-screen width.
    for (const road of [...map.roads].sort((a, b) => a.priority - b.priority)) {
      const st = ROAD[road.surface], w = Math.max(st.minPx, road.widthM * sc * 1.6);
      ctx.globalAlpha = st.alpha;
      ctx.strokeStyle = 'rgba(28,30,26,.6)'; ctx.lineWidth = w + 1.6; strokePath(road.pts);
      ctx.strokeStyle = st.fill; ctx.lineWidth = w; strokePath(road.pts);
      ctx.globalAlpha = 1;
    }
    for (const b of map.bridges) {
      const q = toS(b.x, b.z);
      ctx.fillStyle = '#2a2f2c'; ctx.fillRect(q.sx - 5, q.sy - 5, 10, 10);
      ctx.strokeStyle = '#ece8d8'; ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.moveTo(q.sx - 3, q.sy - 3); ctx.lineTo(q.sx - 3, q.sy + 3); ctx.moveTo(q.sx + 3, q.sy - 3); ctx.lineTo(q.sx + 3, q.sy + 3); ctx.stroke();
    }

    if (p.fog) {
      const fc = fogCanvas(p.fog);
      if (fc) {
        const tl = toS(map.rect.maxX + FOG_CELL_M, map.rect.maxZ + FOG_CELL_M), span = (FOG_N + 2) * FOG_CELL_M * sc;
        ctx.imageSmoothingEnabled = true;
        ctx.drawImage(fc, tl.sx, tl.sy, span, span);
      }
    }

    const origin = p.origin;
    const o = origin ? toS(origin.x, origin.z) : null;

    // Range: dim everything beyond the usable radius, ring at the limit, dashed ring at "comfortable".
    if (p.range && o) {
      const R = p.range.usableM * sc;
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, size.w, size.h);
      ctx.arc(o.sx, o.sy, R, 0, Math.PI * 2, true);
      ctx.fillStyle = 'rgba(8,14,18,.34)';
      ctx.fill('evenodd');
      ctx.restore();
      ctx.beginPath(); ctx.arc(o.sx, o.sy, R, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(8,14,18,.7)'; ctx.lineWidth = 4.5; ctx.stroke();
      ctx.strokeStyle = COLORS.cyan; ctx.lineWidth = 2; ctx.stroke();
      ctx.beginPath(); ctx.arc(o.sx, o.sy, p.range.comfortableM * sc, 0, Math.PI * 2);
      ctx.setLineDash([3, 6]); ctx.strokeStyle = 'rgba(88,199,232,.65)'; ctx.lineWidth = 1.2; ctx.stroke(); ctx.setLineDash([]);
    }

    // Airfield links (the old "RUTAS AÉREAS" list, now geometry).
    ctx.strokeStyle = 'rgba(88,199,232,.55)'; ctx.lineWidth = 1.3; ctx.setLineDash([2, 5]);
    for (const r of p.routes) strokePath([[r.from.x, r.from.z], [r.to.x, r.to.z]]);
    ctx.setLineDash([]);

    // Selected route.
    const sel = p.targets.find((t) => t.id === p.selectedId) ?? null;
    if (sel && origin && sel.id !== origin.id) {
      const a = toS(origin.x, origin.z), b = toS(sel.x, sel.z);
      const len = Math.hypot(b.sx - a.sx, b.sy - a.sy);
      const legs = [a, ...(p.via ?? []).map((v) => toS(v.x, v.z)), b];
      const leg = () => { ctx.beginPath(); legs.forEach((q, i) => (i ? ctx.lineTo(q.sx, q.sy) : ctx.moveTo(q.sx, q.sy))); ctx.stroke(); };
      ctx.lineWidth = 6; ctx.strokeStyle = 'rgba(10,14,15,.7)'; ctx.setLineDash([]); leg();
      ctx.lineWidth = 3; ctx.strokeStyle = COLORS.accent; ctx.setLineDash([11, 6]); leg(); ctx.setLineDash([]);
      for (const q of legs.slice(1, -1)) { // waypoint diamonds
        ctx.fillStyle = COLORS.text; ctx.strokeStyle = 'rgba(10,14,15,.85)'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(q.sx, q.sy - 6); ctx.lineTo(q.sx + 6, q.sy); ctx.lineTo(q.sx, q.sy + 6); ctx.lineTo(q.sx - 6, q.sy); ctx.closePath(); ctx.stroke(); ctx.fill();
      }
      if (len > 50) { // direction chevron at the midpoint
        const mx = (a.sx + b.sx) / 2, my = (a.sy + b.sy) / 2, ang = Math.atan2(b.sy - a.sy, b.sx - a.sx);
        ctx.save(); ctx.translate(mx, my); ctx.rotate(ang);
        ctx.fillStyle = COLORS.accent; ctx.strokeStyle = 'rgba(10,14,15,.85)'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(7, 0); ctx.lineTo(-5, -6); ctx.lineTo(-2, 0); ctx.lineTo(-5, 6); ctx.closePath(); ctx.stroke(); ctx.fill();
        ctx.restore();
      }
      const dM = Math.hypot(sel.x - origin.x, sel.z - origin.z);
      if (p.range && dM > p.range.usableM) { // where the tank runs out
        const t = p.range.usableM / dM, fx = a.sx + (b.sx - a.sx) * t, fy = a.sy + (b.sy - a.sy) * t;
        ctx.strokeStyle = 'rgba(10,14,15,.8)'; ctx.lineWidth = 5.5;
        ctx.beginPath(); ctx.moveTo(fx - 6, fy - 6); ctx.lineTo(fx + 6, fy + 6); ctx.moveTo(fx + 6, fy - 6); ctx.lineTo(fx - 6, fy + 6); ctx.stroke();
        ctx.strokeStyle = COLORS.red; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.moveTo(fx - 6, fy - 6); ctx.lineTo(fx + 6, fy + 6); ctx.moveTo(fx + 6, fy - 6); ctx.lineTo(fx - 6, fy + 6); ctx.stroke();
      }
    }
    if (p.contractTarget) {
      const q = toS(p.contractTarget.x, p.contractTarget.z), r = Math.max(7, p.contractTarget.radiusM * sc);
      ctx.strokeStyle = COLORS.accent; ctx.lineWidth = 2; ctx.setLineDash([4, 3]);
      ctx.beginPath(); ctx.arc(q.sx, q.sy, r, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
      ctx.beginPath(); ctx.arc(q.sx, q.sy, 2, 0, Math.PI * 2); ctx.fillStyle = COLORS.accent; ctx.fill();
    }

    // Markers + label candidates.
    interface Lbl { text: string; sx: number; sy: number; r: number; prio: number; force: boolean; dim?: boolean }
    const labels: Lbl[] = [];
    if (sc > 0.02) for (const l of map.labels) { if (p.fog && !isRevealed(p.fog, l.x, l.z)) continue; const q = toS(l.x, l.z); labels.push({ text: l.name.toUpperCase(), sx: q.sx, sy: q.sy, r: -1, prio: 6, force: false }); }
    for (const t of p.targets) {
      const q = toS(t.x, t.z);
      if (q.sx < -40 || q.sx > size.w + 40 || q.sy < -40 || q.sy > size.h + 40) continue;
      const isSel = t.id === p.selectedId;
      if (t.kind === 'poi') {
        drawPoi(ctx, t.poi!, q.sx, q.sy, isSel);
        if (isSel || sc >= MIN_SCALE_FOR_LABEL[t.poi!.priority]) labels.push({ text: t.name, sx: q.sx, sy: q.sy, r: 8, prio: 2 + t.poi!.priority, force: isSel });
        continue;
      }
      const isOrigin = t.id === origin?.id;
      const status = isOrigin ? null : p.statusOf(t);
      drawAirfield(ctx, q.sx, q.sy, { isOrigin, isSel, revealed: t.revealed, status, headingDeg: p.originHeadingDeg });
      labels.push({ text: t.revealed ? t.name : 'Pista sin descubrir', sx: q.sx, sy: q.sy, r: isOrigin ? 16 : 12, prio: isSel ? 0 : isOrigin ? 1 : 2, force: isSel || isOrigin, dim: !t.revealed || status === 'insufficient' });
    }

    // Labels: greedy placement by priority; right, left, above, below.
    ctx.font = `600 11px ${family}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    const placed: Array<[number, number, number, number]> = [];
    const hits = (b: [number, number, number, number]) => placed.some((q) => b[0] < q[2] && b[2] > q[0] && b[1] < q[3] && b[3] > q[1]);
    for (const l of labels.sort((a, b) => a.prio - b.prio)) {
      const w = ctx.measureText(l.text).width, h = 13;
      const spots: Array<[number, number]> = l.r < 0
        ? [[l.sx - w / 2, l.sy - h / 2]]
        : [[l.sx + l.r + 4, l.sy - h / 2], [l.sx - l.r - 4 - w, l.sy - h / 2], [l.sx - w / 2, l.sy - l.r - 4 - h], [l.sx - w / 2, l.sy + l.r + 4]];
      const spot = spots.find(([x, y]) => !hits([x - 2, y - 1, x + w + 2, y + h + 1]));
      if (!spot && !l.force) continue;
      const [x, y] = spot ?? spots[0];
      placed.push([x - 2, y - 1, x + w + 2, y + h + 1]);
      ctx.lineWidth = 3.2; ctx.lineJoin = 'round'; ctx.strokeStyle = COLORS.halo;
      ctx.strokeText(l.text, x, y + h / 2);
      ctx.fillStyle = l.r < 0 || l.dim ? 'rgba(244,241,230,.72)' : COLORS.text;
      ctx.fillText(l.text, x, y + h / 2);
    }

    // Scale bar.
    const barM = [100, 200, 500, 1000, 2000, 5000].find((m) => m * sc >= 70) ?? 5000;
    const bx = 16, by = size.h - 16, bw = barM * sc;
    const bar = () => { ctx.beginPath(); ctx.moveTo(bx, by - 4); ctx.lineTo(bx, by); ctx.lineTo(bx + bw, by); ctx.lineTo(bx + bw, by - 4); ctx.stroke(); };
    ctx.strokeStyle = COLORS.halo; ctx.lineWidth = 4; bar();
    ctx.strokeStyle = COLORS.text; ctx.lineWidth = 1.6; bar();
    ctx.lineWidth = 3; ctx.strokeStyle = COLORS.halo; ctx.strokeText(formatDistance(barM), bx + 2, by - 11);
    ctx.fillStyle = COLORS.text; ctx.fillText(formatDistance(barM), bx + 2, by - 11);
  };

  const schedule = () => {
    if (frameRef.current) return;
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = 0;
      const v = viewRef.current, t = targetRef.current;
      if (!v || !t) return;
      const k = 0.28; // exponential ease per frame
      const near = Math.abs(t.scale / v.scale - 1) < 0.003 && Math.hypot(t.centerEast - v.centerEast, t.centerNorth - v.centerNorth) * v.scale < 0.4;
      viewRef.current = near ? t : {
        scale: v.scale * Math.pow(t.scale / v.scale, k),
        centerEast: v.centerEast + (t.centerEast - v.centerEast) * k,
        centerNorth: v.centerNorth + (t.centerNorth - v.centerNorth) * k,
      };
      draw();
      if (!near) schedule();
    });
  };

  const commit = (next: MapView, immediate = false) => {
    const map = getRegionMap(propsRef.current.regionId);
    const clamped = clampView(next, sizeRef.current, map.rect);
    targetRef.current = clamped;
    if (immediate || !viewRef.current) viewRef.current = clamped;
    schedule();
    window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => propsRef.current.onViewChange(clamped), 250);
  };

  useImperativeHandle(ref, () => ({
    centerHome: () => {
      const p = propsRef.current, map = getRegionMap(p.regionId);
      commit(homeView(p.origin, p.range, sizeRef.current, map.rect));
    },
    zoomBy: (factor) => {
      const size = sizeRef.current, map = getRegionMap(propsRef.current.regionId);
      if (targetRef.current) commit(zoomAt(targetRef.current, size, size.w / 2, size.h / 2, factor, scaleLimits(map.rect, size)));
    },
  }));

  // --- size + region framing ---------------------------------------------------------------
  useEffect(() => {
    const wrap = wrapRef.current, canvas = canvasRef.current;
    if (!wrap || !canvas) return;
    const resize = () => {
      const w = wrap.clientWidth, h = wrap.clientHeight;
      if (!w || !h) return;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
      canvas.style.width = `${w}px`; canvas.style.height = `${h}px`;
      const first = !viewRef.current || regionRef.current !== propsRef.current.regionId;
      sizeRef.current = { w, h };
      const p = propsRef.current, map = getRegionMap(p.regionId);
      if (first) {
        regionRef.current = p.regionId;
        commit(p.initialView ?? (p.regionId === 'master' ? fitRect(map.rect, sizeRef.current) : homeView(p.origin, p.range, sizeRef.current, map.rect)), true);
      } else commit(targetRef.current ?? viewRef.current!, true);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);
    return () => { ro.disconnect(); cancelAnimationFrame(frameRef.current); frameRef.current = 0; window.clearTimeout(saveTimer.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.regionId]);

  // Redraw on any prop change.
  useEffect(() => { schedule(); }, [props.selectedId, props.range, props.targets, props.origin, props.routes, props.contractTarget, props.via]); // eslint-disable-line react-hooks/exhaustive-deps

  // Selecting a destination frames the route: out from under the panel, and never a 40 px speck.
  useEffect(() => {
    const p = propsRef.current, sel = p.targets.find((t) => t.id === p.selectedId), view = targetRef.current;
    if (!sel || !p.origin || !view) return;
    if (sel.id === p.origin.id) { // base selected: keep the zoom, just slide it clear of the panel
      if (pointsVisible(view, sizeRef.current, [[sel.x, sel.z]], p.insets, 40)) return;
      const hx = (sizeRef.current.w - p.insets.left - p.insets.right) / 2 / view.scale, hz = (sizeRef.current.h - p.insets.top - p.insets.bottom) / 2 / view.scale;
      commit(fitRect({ minX: sel.x - hx, maxX: sel.x + hx, minZ: sel.z - hz, maxZ: sel.z + hz }, sizeRef.current, p.insets));
      return;
    }
    const pts: Array<[number, number]> = [[sel.x, sel.z], [p.origin.x, p.origin.z]];
    const routePx = Math.hypot(sel.x - p.origin.x, sel.z - p.origin.z) * view.scale;
    if (routePx >= 140 && pointsVisible(view, sizeRef.current, pts, p.insets, 28)) return;
    const rect = { minX: Math.min(pts[0][0], pts[1][0]), maxX: Math.max(pts[0][0], pts[1][0]), minZ: Math.min(pts[0][1], pts[1][1]), maxZ: Math.max(pts[0][1], pts[1][1]) };
    const pad = Math.max(300, Math.hypot(rect.maxX - rect.minX, rect.maxZ - rect.minZ) * 0.25);
    commit(fitRect({ minX: rect.minX - pad, maxX: rect.maxX + pad, minZ: rect.minZ - pad, maxZ: rect.maxZ + pad }, sizeRef.current, p.insets, 0.2));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.selectedId, props.insets.right, props.insets.bottom]);

  // --- pointer / touch / wheel ---------------------------------------------------------------
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const pointers = new Map<number, { x: number; y: number }>();
    let downAt = { x: 0, y: 0, t: 0 }, moved = false, lastPinch = 0;
    const local = (e: { clientX: number; clientY: number }) => { const r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
    const hitTest = (sx: number, sy: number): string | null => {
      const p = propsRef.current, view = viewRef.current;
      if (!view) return null;
      let best: { id: string; d: number } | null = null;
      for (const t of p.targets) {
        const q = worldToScreen(view, sizeRef.current, t.x, t.z);
        const bias = t.kind === 'airfield' ? 6 : 0, d = Math.hypot(q.sx - sx, q.sy - sy);
        const reach = t.kind === 'airfield' ? 26 : 18; // generous touch target around a small icon
        if (d <= reach && (!best || d - bias < best.d)) best = { id: t.id, d: d - bias };
      }
      return best?.id ?? null;
    };
    const onDown = (e: PointerEvent) => {
      canvas.setPointerCapture(e.pointerId);
      pointers.set(e.pointerId, local(e));
      if (pointers.size === 1) { downAt = { ...local(e), t: performance.now() }; moved = false; }
      if (pointers.size === 2) { moved = true; const [a, b] = [...pointers.values()]; lastPinch = Math.hypot(a.x - b.x, a.y - b.y); }
    };
    const onMove = (e: PointerEvent) => {
      const cur = local(e);
      if (!pointers.has(e.pointerId)) { canvas.style.cursor = hitTest(cur.x, cur.y) ? 'pointer' : 'grab'; return; }
      const prev = pointers.get(e.pointerId)!;
      pointers.set(e.pointerId, cur);
      const size = sizeRef.current, map = getRegionMap(propsRef.current.regionId), base = targetRef.current;
      if (!base) return;
      if (pointers.size === 1) {
        if (!moved && Math.hypot(cur.x - downAt.x, cur.y - downAt.y) < 6) return;
        moved = true;
        canvas.style.cursor = 'grabbing';
        commit(panBy(base, cur.x - prev.x, cur.y - prev.y), true);
      } else if (pointers.size === 2) {
        const [a, b] = [...pointers.values()], d = Math.hypot(a.x - b.x, a.y - b.y);
        if (lastPinch > 0) commit(zoomAt(base, size, (a.x + b.x) / 2, (a.y + b.y) / 2, d / lastPinch, scaleLimits(map.rect, size)), true);
        lastPinch = d;
      }
    };
    const onUp = (e: PointerEvent) => {
      const wasSingle = pointers.size === 1;
      pointers.delete(e.pointerId);
      lastPinch = 0;
      canvas.style.cursor = 'grab';
      if (wasSingle && !moved && performance.now() - downAt.t < 600) {
        const p = local(e);
        propsRef.current.onSelect(hitTest(p.x, p.y));
      }
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const size = sizeRef.current, map = getRegionMap(propsRef.current.regionId), base = targetRef.current, p = local(e);
      if (!base) return;
      const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
      commit(zoomAt(base, size, p.x, p.y, Math.exp(-dy * 0.0016), scaleLimits(map.rect, size)));
    };
    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerup', onUp);
    canvas.addEventListener('pointercancel', onUp);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointercancel', onUp);
      canvas.removeEventListener('wheel', onWheel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <div className="wmap-canvas" ref={wrapRef}><canvas ref={canvasRef} aria-hidden="true" /></div>;
});

// --- glyphs -------------------------------------------------------------------------------------

function drawPoi(ctx: CanvasRenderingContext2D, poi: MapPoi, x: number, y: number, selected: boolean) {
  ctx.save();
  ctx.translate(x, y);
  ctx.lineJoin = 'round';
  ctx.beginPath();
  switch (poi.kind) {
    case 'settlement': ctx.moveTo(-5, 1); ctx.lineTo(0, -5); ctx.lineTo(5, 1); ctx.lineTo(5, 5); ctx.lineTo(-5, 5); ctx.closePath(); break;
    case 'farm': ctx.rect(-4, -3, 8, 7); ctx.moveTo(-4, -3); ctx.lineTo(0, -6); ctx.lineTo(4, -3); break;
    case 'industry': ctx.moveTo(-5, 5); ctx.lineTo(-5, -2); ctx.lineTo(-1, 1); ctx.lineTo(-1, -2); ctx.lineTo(3, 1); ctx.lineTo(3, -5); ctx.lineTo(5, -5); ctx.lineTo(5, 5); ctx.closePath(); break;
    case 'bridge': ctx.moveTo(-6, 0); ctx.quadraticCurveTo(0, -7, 6, 0); ctx.moveTo(-6, 3); ctx.lineTo(6, 3); break;
    case 'tower': ctx.moveTo(0, -6); ctx.lineTo(4, 5); ctx.lineTo(-4, 5); ctx.closePath(); ctx.moveTo(-2.4, 1); ctx.lineTo(2.4, 1); break;
    case 'pass': ctx.moveTo(-7, 5); ctx.lineTo(-3, -3); ctx.lineTo(0, 2); ctx.lineTo(3, -3); ctx.lineTo(7, 5); break;
    case 'windmill': ctx.moveTo(-5, -5); ctx.lineTo(5, 5); ctx.moveTo(5, -5); ctx.lineTo(-5, 5); break;
  }
  ctx.strokeStyle = 'rgba(10,14,15,.9)'; ctx.lineWidth = 4; ctx.stroke();
  ctx.strokeStyle = '#f4f1e6'; ctx.lineWidth = 1.7; ctx.stroke();
  if (poi.kind === 'settlement' || poi.kind === 'farm' || poi.kind === 'industry') { ctx.fillStyle = 'rgba(244,241,230,.35)'; ctx.fill(); }
  if (selected) {
    ctx.beginPath(); ctx.arc(0, 0, 12, 0, Math.PI * 2);
    ctx.strokeStyle = COLORS.accent; ctx.lineWidth = 2.5; ctx.stroke();
  }
  ctx.restore();
}

interface AirfieldStyle { isOrigin: boolean; isSel: boolean; revealed: boolean; status: RangeStatus | null; headingDeg: number }
function drawAirfield(ctx: CanvasRenderingContext2D, x: number, y: number, s: AirfieldStyle) {
  ctx.save();
  ctx.translate(x, y);
  const R = s.isOrigin ? 13 : 9.5;
  if (s.isSel) { // selection: orange double ring, visible over any terrain
    ctx.beginPath(); ctx.arc(0, 0, R + 7, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(10,14,15,.75)'; ctx.lineWidth = 5.5; ctx.stroke();
    ctx.strokeStyle = COLORS.accent; ctx.lineWidth = 2.6; ctx.stroke();
  }
  ctx.beginPath(); ctx.arc(0, 0, R, 0, Math.PI * 2);
  if (s.isOrigin) {
    ctx.fillStyle = COLORS.accentDeep; ctx.fill();
    ctx.strokeStyle = '#17191a'; ctx.lineWidth = 2.5; ctx.stroke();
    // Aircraft glyph, nose towards the spawn heading (0 = north/up).
    ctx.rotate((s.headingDeg * Math.PI) / 180);
    ctx.beginPath();
    ctx.moveTo(0, -8.5); ctx.lineTo(1.6, -3); ctx.lineTo(8, 1.5); ctx.lineTo(8, 3.4); ctx.lineTo(1.5, 1.6); ctx.lineTo(1.2, 5.6); ctx.lineTo(3.6, 7.4); ctx.lineTo(3.6, 8.6); ctx.lineTo(0, 7.6);
    ctx.lineTo(-3.6, 8.6); ctx.lineTo(-3.6, 7.4); ctx.lineTo(-1.2, 5.6); ctx.lineTo(-1.5, 1.6); ctx.lineTo(-8, 3.4); ctx.lineTo(-8, 1.5); ctx.lineTo(-1.6, -3); ctx.closePath();
    ctx.fillStyle = '#faf8f2'; ctx.fill();
  } else if (!s.revealed) {
    ctx.fillStyle = 'rgba(16,22,24,.85)'; ctx.fill();
    ctx.setLineDash([3, 3]); ctx.strokeStyle = 'rgba(244,241,230,.85)'; ctx.lineWidth = 1.8; ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = '#f4f1e6'; ctx.font = '700 12px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('?', 0, 0.5);
  } else if (s.status === 'insufficient') {
    ctx.fillStyle = 'rgba(16,22,24,.72)'; ctx.fill();
    ctx.strokeStyle = 'rgba(88,199,232,.85)'; ctx.lineWidth = 2; ctx.stroke();
    ctx.beginPath(); ctx.moveTo(-R * 0.62, R * 0.62); ctx.lineTo(R * 0.62, -R * 0.62); // slash = out of range
    ctx.strokeStyle = COLORS.red; ctx.lineWidth = 2.2; ctx.stroke();
  } else {
    ctx.fillStyle = COLORS.cyan; ctx.fill();
    ctx.strokeStyle = '#0d1517'; ctx.lineWidth = 2; ctx.stroke();
    ctx.fillStyle = '#0d1517'; ctx.fillRect(-1.3, -5, 2.6, 10); // runway tick
    if (s.status === 'marginal') { // amber dashed halo = tight on fuel
      ctx.beginPath(); ctx.arc(0, 0, R + 3.5, 0, Math.PI * 2);
      ctx.setLineDash([3, 2.5]); ctx.strokeStyle = COLORS.amber; ctx.lineWidth = 2; ctx.stroke(); ctx.setLineDash([]);
    }
  }
  ctx.restore();
}
