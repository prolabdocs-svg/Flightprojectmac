// Wind seen by the aircraft (spec section 23): mean wind + gust (both from the region's
// deterministic weather) + altitude shear + low-frequency turbulence. The result is only ever
// used to change the AIRFLOW; the aircraft is never displaced directly.
// Turbulence is a sum of incommensurate sinusoids of time and position: deterministic, replayable,
// allocation-free. Wind is sampled once at the CG (no gust gradient across the airframe).

import * as THREE from 'three';

export interface WindFieldConfig {
  /** RMS turbulence speed, m/s. 0 disables it (default; keeps flight tests exact). */
  turbulenceRmsMs: number;
  /** Reference height for the shear law (m AGL) and exponent (open terrain ~0.14). */
  shearReferenceM: number;
  shearExponent: number;
}

export const DEFAULT_WIND_CONFIG: WindFieldConfig = { turbulenceRmsMs: 0, shearReferenceM: 10, shearExponent: 0.14 };

const WAVES: ReadonlyArray<readonly [number, number, number, number]> = [
  // [temporal rad/s, spatial rad/m, phase, weight]
  [0.37, 0.011, 0.3, 0.55],
  [0.83, 0.023, 2.1, 0.3],
  [1.71, 0.041, 4.4, 0.15],
];

export class WindField {
  private readonly cfg: WindFieldConfig;
  constructor(cfg: WindFieldConfig = DEFAULT_WIND_CONFIG) {
    this.cfg = cfg;
  }

  /**
   * @param meanWind mean + gust wind (m/s, world) from sim/weather.getEnvironmentWind
   * @param heightAglM height above ground, for the boundary-layer shear
   */
  sample(meanWind: THREE.Vector3, position: THREE.Vector3, timeS: number, heightAglM: number, out: THREE.Vector3): THREE.Vector3 {
    const shear = Math.pow(Math.max(1, heightAglM) / this.cfg.shearReferenceM, this.cfg.shearExponent);
    out.copy(meanWind).multiplyScalar(this.cfg.shearExponent > 0 ? Math.min(1.6, shear) : 1);
    const rms = this.cfg.turbulenceRmsMs;
    if (rms > 0) {
      let tx = 0;
      let ty = 0;
      let tz = 0;
      for (const [w, k, ph, wt] of WAVES) {
        tx += wt * Math.sin(w * timeS + k * position.z + ph);
        ty += wt * Math.sin(w * 1.3 * timeS + k * position.x + ph * 1.7) * 0.5; // vertical is weaker
        tz += wt * Math.sin(w * 0.9 * timeS + k * position.y * 2 + ph * 0.6);
      }
      out.x += tx * rms;
      out.y += ty * rms;
      out.z += tz * rms;
    }
    return out;
  }
}
