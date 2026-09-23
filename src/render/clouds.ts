import * as THREE from 'three';
import { createSeededRandom } from '../core/seededRandom';
import { ATMOSPHERE_GLSL, atmosphereUniforms, CLOUD_MAP_SIZE, getNoiseTexture, type AtmosphereLook } from './atmosphere';

/**
 * Cumulus field (art bible §10): clusters of lit billboard puffs with flat bases, drifting with the
 * wind across a wrapping 24 km domain that is always centred on the camera. One instanced draw call.
 * The same cluster list is splatted into a coverage map that the atmosphere uses for kilometre-scale
 * cloud shadows (§8.4), so every shadow on the ground belongs to a cloud in the sky.
 */

const DOMAIN_M = 24000;
const MAP_SIZE = CLOUD_MAP_SIZE;

interface Puff { cx: number; cz: number; baseY: number; ox: number; oy: number; oz: number; size: number; h: number; seed: number }

function buildPuffTexture(): THREE.DataTexture {
  const S = 128, data = new Uint8Array(S * S * 4);
  const noise = getNoiseTexture().image.data as Uint8Array, N = 256;
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const dx = (x + 0.5) / S * 2 - 1, dy = (y + 0.5) / S * 2 - 1;
    const n = noise[((y * 2) * N + x * 2) * 4] / 255, n2 = noise[((y * 2) * N + x * 2) * 4 + 1] / 255;
    const d = Math.hypot(dx, dy) + (n - 0.5) * 0.45;
    const a = Math.pow(Math.max(0, 1 - THREE.MathUtils.smoothstep(d, 0.25, 1.0)), 1.4);
    const i = (y * S + x) * 4;
    data[i] = data[i + 1] = data[i + 2] = Math.round((0.75 + 0.25 * n2) * 255); // crease detail
    data[i + 3] = Math.round(a * 255);
  }
  const tex = new THREE.DataTexture(data, S, S, THREE.RGBAFormat);
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}

const VERTEX = /* glsl */ `
uniform vec2 cloudWind;
attribute vec3 aCluster;  // domain x, domain z, base y
attribute vec4 aPuff;     // offset xyz, size
attribute vec2 aShade;    // height in cluster 0..1, seed
varying vec2 vUv;
varying vec3 vWorld;
varying float vBaseY;
varying float vH;
varying float vSize;
varying float vCenterY;
void main() {
  vec2 c = aCluster.xy + cloudWind;
  c = cameraPosition.xz + mod( c - cameraPosition.xz + ${DOMAIN_M / 2}.0, ${DOMAIN_M}.0 ) - ${DOMAIN_M / 2}.0;
  vec3 center = vec3( c.x, aCluster.z, c.y ) + aPuff.xyz;
  vec3 right = vec3( viewMatrix[ 0 ][ 0 ], viewMatrix[ 1 ][ 0 ], viewMatrix[ 2 ][ 0 ] );
  vec3 up = vec3( viewMatrix[ 0 ][ 1 ], viewMatrix[ 1 ][ 1 ], viewMatrix[ 2 ][ 1 ] );
  float a = aShade.y * 6.2831;
  vec2 q = mat2( cos( a ), sin( a ), - sin( a ), cos( a ) ) * position.xy;
  vWorld = center + ( right * q.x + up * q.y ) * aPuff.w;
  vUv = uv;
  vBaseY = aCluster.z;
  vH = aShade.x;
  vSize = aPuff.w;
  vCenterY = center.y;
  gl_Position = projectionMatrix * viewMatrix * vec4( vWorld, 1.0 );
}`;

const FRAGMENT = /* glsl */ `
uniform vec3 fogColor;
uniform sampler2D puffMap;
uniform vec3 cloudSun;
uniform vec3 cloudTop;
uniform vec3 cloudBottom;
uniform float cloudOpacity;
${ATMOSPHERE_GLSL}
varying vec2 vUv;
varying vec3 vWorld;
varying float vBaseY;
varying float vH;
varying float vSize;
varying float vCenterY;
void main() {
  vec4 t = texture2D( puffMap, vUv );
  float alpha = t.a;
  if ( alpha < 0.01 ) discard;
  // Treat each puff as a sphere for lighting: bright sun side, soft blue-grey shade side.
  vec2 d = vUv * 2.0 - 1.0;
  vec3 nView = normalize( vec3( d, sqrt( max( 0.0, 1.0 - dot( d, d ) ) ) + 0.35 ) );
  vec3 n = normalize( ( vec4( nView, 0.0 ) * viewMatrix ).xyz );
  float h = clamp( vH + ( vWorld.y - vCenterY ) / vSize * 0.6, 0.0, 1.0 );
  float lit = clamp( dot( n, atmoSunDir ) * 0.55 + 0.5, 0.0, 1.0 ) * mix( 0.5, 1.0, h );
  vec3 col = mix( cloudBottom, cloudTop, h ) + cloudSun * lit;
  col *= t.r;
  // Silver lining: forward scattering through thin edges when looking toward the sun.
  vec3 viewDir = normalize( vWorld - cameraPosition );
  col += cloudSun * pow( max( dot( viewDir, atmoSunDir ), 0.0 ), 10.0 ) * ( 1.0 - alpha ) * 1.8;
  // Flat condensation base, and dissolve when the camera flies into a cloud.
  alpha *= smoothstep( vBaseY - 30.0, vBaseY + 45.0, vWorld.y );
  alpha *= smoothstep( 25.0, 60.0 + vSize * 0.5, length( vWorld - cameraPosition ) );
  alpha *= cloudOpacity;
  gl_FragColor = vec4( atmoApplyFog( col, vWorld ), alpha );
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

export class CloudLayer {
  readonly mesh: THREE.Mesh;
  private readonly puffs: Puff[] = [];
  private readonly geometry: THREE.InstancedBufferGeometry;
  private readonly material: THREE.ShaderMaterial;
  private readonly puffMap: THREE.DataTexture;
  private readonly wind = new THREE.Vector2();
  private sortTimer = 0;

  constructor(look: AtmosphereLook, options: { baseY: number; seed: string }) {
    const rng = createSeededRandom('cloud-layer', options.seed);
    const cover = THREE.MathUtils.clamp(look.cloudCover, 0, 1);
    const clusters = Math.round(10 + cover * 70);
    const coverage = new Float32Array(MAP_SIZE * MAP_SIZE);
    for (let c = 0; c < clusters; c++) {
      // A few towering cumulus for scale (§9.3); the rest fair-weather clouds.
      const tower = rng.next() < 0.12;
      const R = tower ? 600 + rng.next() * 500 : 160 + rng.next() * 340;
      const H = R * (tower ? 1.6 + rng.next() * 0.8 : 0.55 + rng.next() * 0.5);
      const cx = rng.next() * DOMAIN_M, cz = rng.next() * DOMAIN_M;
      const baseY = options.baseY + (rng.next() - 0.5) * 160;
      const count = Math.round(8 + R / 28);
      for (let i = 0; i < count; i++) {
        const h = Math.pow(rng.next(), 1.3);
        const spread = R * (1 - 0.6 * Math.pow(h, 1.4));
        const ang = rng.next() * Math.PI * 2, rad = Math.sqrt(rng.next()) * spread;
        const size = R * (0.55 + rng.next() * 0.5) * (1 - 0.35 * h);
        this.puffs.push({ cx, cz, baseY, ox: Math.cos(ang) * rad, oy: size * 0.3 + h * H, oz: Math.sin(ang) * rad * 0.8, size, h, seed: rng.next() });
      }
      // Coverage splat (gaussian, wraps with the domain).
      const texel = DOMAIN_M / MAP_SIZE, rr = Math.ceil((R * 1.3) / texel);
      const px = cx / texel, pz = cz / texel;
      for (let y = -rr; y <= rr; y++) for (let x = -rr; x <= rr; x++) {
        const d2 = (x * x + y * y) * texel * texel;
        const w = Math.exp(-d2 / (2 * (R * 0.6) ** 2)) * (tower ? 1 : 0.85);
        const ix = ((Math.floor(px) + x) % MAP_SIZE + MAP_SIZE) % MAP_SIZE, iy = ((Math.floor(pz) + y) % MAP_SIZE + MAP_SIZE) % MAP_SIZE;
        coverage[iy * MAP_SIZE + ix] += w;
      }
    }
    const map = atmosphereUniforms.atmoCloudMap.value, bytes = map.image.data as Uint8Array;
    for (let i = 0; i < coverage.length; i++) bytes[i * 4] = Math.round(THREE.MathUtils.smoothstep(coverage[i], 0.25, 0.75) * 255);
    map.needsUpdate = true;
    atmosphereUniforms.atmoCloudParams.value.set(0, 0, 1 / DOMAIN_M, look.cloudShadow * Math.min(1, 0.4 + cover));
    atmosphereUniforms.atmoCloudY.value.x = options.baseY + 200;

    this.geometry = new THREE.InstancedBufferGeometry();
    const quad = new THREE.PlaneGeometry(1, 1);
    this.geometry.index = quad.index;
    this.geometry.setAttribute('position', quad.getAttribute('position'));
    this.geometry.setAttribute('uv', quad.getAttribute('uv'));
    const n = this.puffs.length;
    this.geometry.setAttribute('aCluster', new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3));
    this.geometry.setAttribute('aPuff', new THREE.InstancedBufferAttribute(new Float32Array(n * 4), 4));
    this.geometry.setAttribute('aShade', new THREE.InstancedBufferAttribute(new Float32Array(n * 2), 2));
    this.geometry.instanceCount = n;

    const sun = look.sunColor.clone().multiplyScalar(look.sunIntensity * 0.42);
    this.puffMap = buildPuffTexture();
    this.material = new THREE.ShaderMaterial({
      name: 'cloud-layer',
      uniforms: {
        ...atmosphereUniforms,
        fogColor: { value: look.haze },
        puffMap: { value: this.puffMap },
        cloudWind: { value: this.wind },
        cloudSun: { value: sun },
        cloudTop: { value: look.zenith.clone().lerp(new THREE.Color('#ffffff'), 0.65).multiplyScalar(0.55) },
        cloudBottom: { value: look.haze.clone().lerp(look.zenith, 0.35).multiplyScalar(0.42) },
        cloudOpacity: { value: 0.92 },
      },
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      transparent: true,
      depthWrite: false,
      fog: false,
    });
    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.name = 'atmosphere:clouds';
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 10;
    this.sort(new THREE.Vector3());
  }

  /** Drift with the wind (m/s) and keep puffs sorted back-to-front for blending. */
  update(dtS: number, wind: THREE.Vector3, camera: THREE.Vector3): void {
    this.wind.x = (this.wind.x + wind.x * 1.6 * dtS) % DOMAIN_M;
    this.wind.y = (this.wind.y + wind.z * 1.6 * dtS) % DOMAIN_M;
    atmosphereUniforms.atmoCloudParams.value.x = this.wind.x;
    atmosphereUniforms.atmoCloudParams.value.y = this.wind.y;
    this.sortTimer -= dtS;
    if (this.sortTimer <= 0) { this.sortTimer = 0.25; this.sort(camera); }
  }

  private sort(camera: THREE.Vector3): void {
    const wrap = (v: number, c: number) => c + ((((v - c + DOMAIN_M / 2) % DOMAIN_M) + DOMAIN_M) % DOMAIN_M) - DOMAIN_M / 2;
    const dist = this.puffs.map((p) => {
      const x = wrap(p.cx + this.wind.x, camera.x) + p.ox, z = wrap(p.cz + this.wind.y, camera.z) + p.oz, y = p.baseY + p.oy;
      return (x - camera.x) ** 2 + (y - camera.y) ** 2 + (z - camera.z) ** 2;
    });
    const order = this.puffs.map((_, i) => i).sort((a, b) => dist[b] - dist[a]);
    const cl = this.geometry.getAttribute('aCluster') as THREE.InstancedBufferAttribute;
    const pf = this.geometry.getAttribute('aPuff') as THREE.InstancedBufferAttribute;
    const sh = this.geometry.getAttribute('aShade') as THREE.InstancedBufferAttribute;
    order.forEach((src, i) => {
      const p = this.puffs[src];
      cl.setXYZ(i, p.cx, p.cz, p.baseY);
      pf.setXYZW(i, p.ox, p.oy, p.oz, p.size);
      sh.setXY(i, p.h, p.seed);
    });
    cl.needsUpdate = pf.needsUpdate = sh.needsUpdate = true;
  }

  dispose(): void {
    atmosphereUniforms.atmoCloudParams.value.w = 0;
    this.geometry.dispose();
    this.material.dispose();
    this.puffMap.dispose();
  }
}
