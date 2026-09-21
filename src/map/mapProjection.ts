import { worldToMapXY } from '../world/compass';

/**
 * The ONE world <-> map transform. World handedness (world/compass.ts): +Z north, EAST IS -X.
 * Map space is (east, north) in metres; screen space is pixels with +y DOWN, so north is up and
 * east is right. Nothing else in the map code does axis math.
 */

export interface MapView {
  /** Map-space point (metres) shown at the centre of the viewport. */
  centerEast: number;
  centerNorth: number;
  /** Pixels per metre. */
  scale: number;
}
export interface MapSize { w: number; h: number }
/** World-space rectangle (x/z), as regions declare it. */
export interface WorldRect { minX: number; maxX: number; minZ: number; maxZ: number }
export interface ScaleLimits { min: number; max: number }
export interface Insets { left: number; right: number; top: number; bottom: number }

export const worldToMap = worldToMapXY;
export const mapToWorld = (east: number, north: number): { x: number; z: number } => ({ x: -east, z: north });

export const distanceM = (ax: number, az: number, bx: number, bz: number): number => Math.hypot(bx - ax, bz - az);

export function worldToScreen(view: MapView, size: MapSize, x: number, z: number): { sx: number; sy: number } {
  const { east, north } = worldToMap(x, z);
  return { sx: size.w / 2 + (east - view.centerEast) * view.scale, sy: size.h / 2 - (north - view.centerNorth) * view.scale };
}

export function screenToWorld(view: MapView, size: MapSize, sx: number, sy: number): { x: number; z: number } {
  return mapToWorld(view.centerEast + (sx - size.w / 2) / view.scale, view.centerNorth - (sy - size.h / 2) / view.scale);
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/** Min = the whole region fits the viewport (never lose the world); max = ~4.5 m per pixel (the terrain raster is ~62 m/cell). */
export function scaleLimits(rect: WorldRect, size: MapSize): ScaleLimits {
  const fit = Math.min(size.w / (rect.maxX - rect.minX), size.h / (rect.maxZ - rect.minZ)) * 0.9;
  return { min: fit, max: Math.max(fit, 0.22) };
}

/** Keeps the view centre inside the region so the map can never be dragged out of sight. */
export function clampView(view: MapView, size: MapSize, rect: WorldRect, limits = scaleLimits(rect, size)): MapView {
  return {
    scale: clamp(view.scale, limits.min, limits.max),
    centerEast: clamp(view.centerEast, -rect.maxX, -rect.minX),
    centerNorth: clamp(view.centerNorth, rect.minZ, rect.maxZ),
  };
}

export const panBy = (view: MapView, dxPx: number, dyPx: number): MapView => ({
  ...view, centerEast: view.centerEast - dxPx / view.scale, centerNorth: view.centerNorth + dyPx / view.scale,
});

/** Scales by `factor` keeping the map point under (sx, sy) fixed on screen. */
export function zoomAt(view: MapView, size: MapSize, sx: number, sy: number, factor: number, limits: ScaleLimits): MapView {
  const scale = clamp(view.scale * factor, limits.min, limits.max);
  const east = view.centerEast + (sx - size.w / 2) / view.scale;
  const north = view.centerNorth - (sy - size.h / 2) / view.scale;
  return { scale, centerEast: east - (sx - size.w / 2) / scale, centerNorth: north + (sy - size.h / 2) / scale };
}

const NO_INSETS: Insets = { left: 0, right: 0, top: 0, bottom: 0 };

/** View that fits `rect` (world x/z) inside `size` minus insets (px), centred in the free area. */
export function fitRect(rect: WorldRect, size: MapSize, insets: Insets = NO_INSETS, maxScale = Infinity): MapView {
  const freeW = Math.max(40, size.w - insets.left - insets.right), freeH = Math.max(40, size.h - insets.top - insets.bottom);
  const scale = Math.min(freeW / Math.max(1, rect.maxX - rect.minX), freeH / Math.max(1, rect.maxZ - rect.minZ), maxScale);
  // The free area's centre is offset from the viewport centre; convert that to metres.
  const offE = (insets.left - insets.right) / 2 / scale, offN = (insets.bottom - insets.top) / 2 / scale;
  return { scale, centerEast: -(rect.minX + rect.maxX) / 2 - offE, centerNorth: (rect.minZ + rect.maxZ) / 2 - offN };
}

/** True when every world point lies inside the viewport minus insets. */
export function pointsVisible(view: MapView, size: MapSize, pts: ReadonlyArray<readonly [number, number]>, insets: Insets = NO_INSETS, marginPx = 24): boolean {
  return pts.every(([x, z]) => {
    const { sx, sy } = worldToScreen(view, size, x, z);
    return sx >= insets.left + marginPx && sx <= size.w - insets.right - marginPx && sy >= insets.top + marginPx && sy <= size.h - insets.bottom - marginPx;
  });
}

export interface MapRange { usableM: number; comfortableM: number }

/** Default framing: the origin with its whole range ring in view, tilted slightly north. */
export function homeView(origin: { x: number; z: number } | null, range: MapRange | null, size: MapSize, rect: WorldRect, insets?: Insets): MapView {
  const cx = origin?.x ?? 0, cz = origin?.z ?? 0;
  const r = Math.max(700, (range?.usableM ?? 1500) * 1.35);
  const framed = fitRect({ minX: cx - r, maxX: cx + r, minZ: cz - r, maxZ: cz + r }, size, insets);
  return clampView({ ...framed, centerNorth: framed.centerNorth + r * 0.12 }, size, rect);
}
