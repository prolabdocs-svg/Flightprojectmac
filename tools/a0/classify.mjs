// Triangle -> part classification for the A0 hero mesh (pf_aircraft_ultralight.glb, model units,
// +Z nose, +Y up, +X left wing). Thresholds were measured off the sculpted mesh; see split_a0.mjs.

export const WHEELS = [
  { id: 'nose', x: 0, z: 0.516 },
  { id: 'mainL', x: 0.155, z: 0.14 },
  { id: 'mainR', x: -0.155, z: 0.14 },
];
export const AXLE_Y = 0.075;
export const WHEEL_R = 0.082;
export const PROP_HUB = [0, 0.327, -0.036];

const wingBottom = (ax) => 0.283 + 0.081 * ax;
const wingTrailingEdge = (ax) => (ax < 0.3 ? -0.012 : -0.012 - 0.073 * (ax - 0.3));
const tailBottom = (ax) => 0.212 + 0.2 * Math.max(0, ax - 0.12);

/** @returns {string} part name */
export function classify(x, y, z, nx, ny, nz, t) {
  const ax = Math.abs(x);
  // Wheels: lower half of each disc is the tyre; its side-face centre is the hub.
  if (y < 0.088) for (const w of WHEELS) {
    if (Math.abs(x - w.x) < 0.045 && z > w.z - 0.09 && z < w.z + 0.09) {
      const r = Math.hypot(y - AXLE_Y, z - w.z);
      if (r < WHEEL_R) return r < 0.034 ? 'hub' : 'tire';
    }
  }
  // Propeller: two blades behind the wing trailing edge, hub on the crank shaft.
  if (ax < 0.16 && z > -0.062 && z < -0.014 && y > 0.293 && y < 0.362) return 'prop';
  const yb = wingBottom(ax);
  // Cables and frame tubes (t < 0.026) poking into the skin band stay tube-coloured; the skin itself is caught by its normal.
  const rim = (z > 0.27 && (nz > 0.2 || Math.abs(ny) > 0.5)) || z < wingTrailingEdge(ax) + 0.024 || ax > 0.94;
  if (ax < 0.965 && z > -0.075 && z < 0.305 && y > yb - 0.008 && y < yb + (ax < 0.2 ? 0.056 : 0.05) && (Math.abs(ny) > 0.75 || t > 0.03 || rim)) return 'wing';
  const tb = tailBottom(ax);
  if (z < -0.40 && ax < 0.245 && y > tb - 0.014 && y < tb + 0.05 && !(ax < 0.02 && y > tb + 0.03)) return 'tail';
  if (z < -0.395 && ax < 0.03 && y > 0.235 && y < 0.42 && t < 0.02) return 'fin';
  // Powerplant block on the wing centre and the seat pair.
  if (ax < 0.052 && z > 0.07 && z < 0.24 && y > 0.335 && y < 0.432 && t > 0.017) return 'engine';
  if (ax < 0.1 && z > 0.0 && z < 0.3 && y > 0.104 && y < 0.22 && t > 0.011) return 'seat';
  // Wheel pants / fork fairings.
  if (y > 0.075 && y < 0.13 && t > 0.026) for (const w of WHEELS) if (Math.abs(x - w.x) < 0.05 && Math.abs(z - w.z) < 0.09) return 'pant';
  if (t < 0.007) return 'wire';
  if (t < 0.026) return 'frame';
  return 'mech';
}

export const PART_COLORS = {
  wing: '#e23', tail: '#3c3', fin: '#36f', prop: '#fc0', engine: '#f0f', seat: '#0cc', tire: '#000',
  hub: '#fff', pant: '#fa0', frame: '#c9c9c9', wire: '#963', mech: '#8f8',
};
