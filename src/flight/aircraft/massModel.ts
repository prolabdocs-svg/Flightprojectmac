// Mass, centre of gravity and inertia tensor from a list of mass items (spec sections 18-19).
// Each item contributes its own box inertia plus the parallel-axis term about the combined CG, so
// two aircraft of equal mass but different layout get different roll/pitch/yaw inertia.
// Axes: BODY (X left, Y up, Z nose). Tensor is the symmetric 3x3 [[Ixx,-Ixy,-Ixz],[.,Iyy,-Iyz],[.,.,Izz]].

import type { MassItem } from './aircraftDefinition';
import type { Vec3 } from '../core/coordinates';

export type Mat3 = [number, number, number, number, number, number, number, number, number]; // row-major

export interface MassProperties {
  massKg: number;
  cg: Vec3;
  inertia: Mat3;
}

export function computeMassProperties(items: readonly MassItem[]): MassProperties {
  let m = 0;
  let cx = 0;
  let cy = 0;
  let cz = 0;
  for (const it of items) {
    m += it.massKg;
    cx += it.massKg * it.position[0];
    cy += it.massKg * it.position[1];
    cz += it.massKg * it.position[2];
  }
  if (m <= 0) throw new Error('aircraft has no mass');
  cx /= m; cy /= m; cz /= m;

  let ixx = 0, iyy = 0, izz = 0, ixy = 0, ixz = 0, iyz = 0;
  for (const it of items) {
    const [sx, sy, sz] = it.size;
    const k = it.massKg / 12;
    ixx += k * (sy * sy + sz * sz);
    iyy += k * (sx * sx + sz * sz);
    izz += k * (sx * sx + sy * sy);
    const dx = it.position[0] - cx;
    const dy = it.position[1] - cy;
    const dz = it.position[2] - cz;
    ixx += it.massKg * (dy * dy + dz * dz);
    iyy += it.massKg * (dx * dx + dz * dz);
    izz += it.massKg * (dx * dx + dy * dy);
    ixy += it.massKg * dx * dy;
    ixz += it.massKg * dx * dz;
    iyz += it.massKg * dy * dz;
  }
  return { massKg: m, cg: [cx, cy, cz], inertia: [ixx, -ixy, -ixz, -ixy, iyy, -iyz, -ixz, -iyz, izz] };
}

/** Jacobi eigen-decomposition of a symmetric 3x3: principal moments + rotation (columns = axes). */
export function principalAxes(I: Mat3): { moments: Vec3; quaternion: [number, number, number, number] } {
  const a = [I[0], I[1], I[2], I[3], I[4], I[5], I[6], I[7], I[8]];
  const v = [1, 0, 0, 0, 1, 0, 0, 0, 1];
  for (let sweep = 0; sweep < 24; sweep++) {
    const off = Math.abs(a[1]) + Math.abs(a[2]) + Math.abs(a[5]);
    if (off < 1e-12) break;
    for (const [p, q] of [[0, 1], [0, 2], [1, 2]] as const) {
      const apq = a[p * 3 + q];
      if (Math.abs(apq) < 1e-15) continue;
      const theta = (a[q * 3 + q] - a[p * 3 + p]) / (2 * apq);
      const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
      const c = 1 / Math.sqrt(t * t + 1);
      const s = t * c;
      for (let k = 0; k < 3; k++) {
        const akp = a[k * 3 + p];
        const akq = a[k * 3 + q];
        a[k * 3 + p] = c * akp - s * akq;
        a[k * 3 + q] = s * akp + c * akq;
      }
      for (let k = 0; k < 3; k++) {
        const apk = a[p * 3 + k];
        const aqk = a[q * 3 + k];
        a[p * 3 + k] = c * apk - s * aqk;
        a[q * 3 + k] = s * apk + c * aqk;
      }
      for (let k = 0; k < 3; k++) {
        const vkp = v[k * 3 + p];
        const vkq = v[k * 3 + q];
        v[k * 3 + p] = c * vkp - s * vkq;
        v[k * 3 + q] = s * vkp + c * vkq;
      }
    }
  }
  // Rotation matrix R = v (columns are principal axes). Ensure a proper rotation (det +1).
  const det =
    v[0] * (v[4] * v[8] - v[5] * v[7]) - v[1] * (v[3] * v[8] - v[5] * v[6]) + v[2] * (v[3] * v[7] - v[4] * v[6]);
  if (det < 0) { v[2] = -v[2]; v[5] = -v[5]; v[8] = -v[8]; }
  const trace = v[0] + v[4] + v[8];
  let qw: number, qx: number, qy: number, qz: number;
  if (trace > 0) {
    const s = Math.sqrt(trace + 1) * 2;
    qw = s / 4; qx = (v[7] - v[5]) / s; qy = (v[2] - v[6]) / s; qz = (v[3] - v[1]) / s;
  } else if (v[0] > v[4] && v[0] > v[8]) {
    const s = Math.sqrt(1 + v[0] - v[4] - v[8]) * 2;
    qw = (v[7] - v[5]) / s; qx = s / 4; qy = (v[1] + v[3]) / s; qz = (v[2] + v[6]) / s;
  } else if (v[4] > v[8]) {
    const s = Math.sqrt(1 + v[4] - v[0] - v[8]) * 2;
    qw = (v[2] - v[6]) / s; qx = (v[1] + v[3]) / s; qy = s / 4; qz = (v[5] + v[7]) / s;
  } else {
    const s = Math.sqrt(1 + v[8] - v[0] - v[4]) * 2;
    qw = (v[3] - v[1]) / s; qx = (v[2] + v[6]) / s; qy = (v[5] + v[7]) / s; qz = s / 4;
  }
  const n = Math.hypot(qx, qy, qz, qw) || 1;
  return { moments: [a[0], a[4], a[8]], quaternion: [qx / n, qy / n, qz / n, qw / n] };
}
