import * as THREE from 'three';
import type { RegionDefinition } from '../core/types';

/**
 * One atmosphere for everything the player sees (art bible §8-§10):
 *  - an HDR sky (zenith gradient, Mie halo, sun disc) that is ALSO the image-based light, so props,
 *    aircraft and water are lit and reflect the same sky that is on screen;
 *  - exponential height fog with sun in-scattering, patched into Three's fog chunks, so every
 *    fogged material gets aerial perspective (thin over peaks, thick in valleys, warm toward the sun)
 *    and the sky shader applies the identical integral to infinity, so the horizon never seams;
 *  - kilometre-scale cloud shadows on the sun's direct light, read from the same coverage map the
 *    cloud layer is built from (clouds.ts), so shadows correspond to real clouds.
 * Presentation only: nothing here feeds simulation.
 */

export interface AtmosphereLook {
  /** Unit vector pointing TO the sun (world, +Y up, +Z north, EAST = -X). */
  sunDir: THREE.Vector3;
  sunColor: THREE.Color;
  sunIntensity: number;
  zenith: THREE.Color;
  /** Fog/haze colour looking away from the sun, and toward it. */
  haze: THREE.Color;
  hazeSun: THREE.Color;
  /** Below-horizon colour for the sky dome / IBL ground bounce. */
  ground: THREE.Color;
  /** Extinction per metre at `fogBaseY`, and its falloff with height (1/m). */
  fogDensity: number;
  fogFalloff: number;
  fogBaseY: number;
  cloudCover: number;
  cloudShadow: number;
  envIntensity: number;
  exposure: number;
}

const sunVector = (azimuthDeg: number, elevationDeg: number): THREE.Vector3 => {
  // Azimuth measured from north (+Z) toward east (-X).
  const az = (azimuthDeg * Math.PI) / 180, el = (elevationDeg * Math.PI) / 180;
  return new THREE.Vector3(-Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el));
};

/** Region -> atmosphere. Time of day sets the sun; weather thickens haze and dims the key light. */
export function atmosphereLook(region: Pick<RegionDefinition, 'skyColor' | 'environment'>): AtmosphereLook {
  const { timeOfDay, weather, cloudCover } = region.environment;
  const hint = new THREE.Color(region.skyColor);
  const c = (hex: string) => new THREE.Color(hex);
  let look: AtmosphereLook;
  switch (timeOfDay) {
    case 'morning':
      look = {
        sunDir: sunVector(118, 21), sunColor: c('#ffe0b4'), sunIntensity: 3.0, zenith: c('#3f7cc4'),
        haze: c('#c9d9e4'), hazeSun: c('#ffe6c4'), ground: c('#4c5238'),
        fogDensity: 1.5e-4, fogFalloff: 1 / 900, fogBaseY: 0, cloudCover, cloudShadow: 0.55, envIntensity: 1, exposure: 1,
      };
      break;
    case 'sunset':
      look = {
        sunDir: sunVector(262, 7), sunColor: c('#ffa860'), sunIntensity: 2.6, zenith: c('#48679e'),
        haze: c('#d9b49a'), hazeSun: c('#ffc07a'), ground: c('#4a3a2c'),
        fogDensity: 1.6e-4, fogFalloff: 1 / 1000, fogBaseY: 0, cloudCover, cloudShadow: 0.45, envIntensity: 0.9, exposure: 1.05,
      };
      break;
    case 'overcast':
      look = {
        sunDir: sunVector(200, 48), sunColor: c('#e8edf2'), sunIntensity: 1.1, zenith: c('#8d99a4'),
        haze: c('#bcc3c6'), hazeSun: c('#d8dcdc'), ground: c('#4a4c46'),
        fogDensity: 2.4e-4, fogFalloff: 1 / 1300, fogBaseY: 0, cloudCover, cloudShadow: 0.25, envIntensity: 1.5, exposure: 1.05,
      };
      break;
    default: // afternoon
      look = {
        sunDir: sunVector(242, 38), sunColor: c('#fff0d8'), sunIntensity: 3.0, zenith: c('#2a6ad8'),
        haze: c('#c2d8ec'), hazeSun: c('#fff0d6'), ground: c('#4e5636'),
        fogDensity: 1.15e-4, fogFalloff: 1 / 1100, fogBaseY: 0, cloudCover, cloudShadow: 0.6, envIntensity: 0.8, exposure: 0.82,
      };
  }
  // The authored region sky colour still steers the haze so each region keeps its tint.
  look.haze.lerp(hint, 0.35);
  if (weather === 'rain') { look.fogDensity *= 2.4; look.sunIntensity *= 0.5; look.cloudShadow *= 0.5; }
  else if (weather === 'overcast') { look.fogDensity *= 1.3; }
  else if (weather === 'windy') { look.fogDensity *= 0.85; } // wind scours haze
  return look;
}

/** A value whose clone() is itself: Three clones built-in material uniforms per material, and this
 * keeps every clone pointing at the one shared value, so one write per frame updates the whole scene
 * without touching any material's onBeforeCompile (other systems own those hooks). */
class SharedVector4 extends THREE.Vector4 { override clone(): this { return this; } }
class SharedVector3 extends THREE.Vector3 { override clone(): this { return this; } }
class SharedColor extends THREE.Color { override clone(): this { return this; } }

/** Cloud coverage lives in one persistent texture whose pixels clouds.ts rewrites. */
export const CLOUD_MAP_SIZE = 256;
const cloudMap = new THREE.DataTexture(new Uint8Array(CLOUD_MAP_SIZE * CLOUD_MAP_SIZE * 4), CLOUD_MAP_SIZE, CLOUD_MAP_SIZE, THREE.RGBAFormat);
cloudMap.wrapS = cloudMap.wrapT = THREE.RepeatWrapping;
cloudMap.magFilter = cloudMap.minFilter = THREE.LinearFilter;
cloudMap.clone = function () { return this; };

export const atmosphereUniforms = {
  atmoSunDir: { value: new SharedVector3(0, 1, 0) },
  atmoHazeSun: { value: new SharedColor() },
  atmoFogParams: { value: new SharedVector4(0, 1 / 1000, 0, 1) }, // density, falloff, baseY, max
  atmoCloudMap: { value: cloudMap as THREE.DataTexture },
  atmoCloudParams: { value: new SharedVector4(0, 0, 1 / 24000, 0) }, // offset.xy, 1/domain, strength
  atmoCloudY: { value: new SharedVector4(1000, 0, 0, 0) }, // x = cloud shadow plane height
};

/** GLSL shared by the fog chunk, the sky and the cloud billboards. Expects `fogColor` and `cameraPosition`. */
export const ATMOSPHERE_GLSL = /* glsl */ `
uniform vec3 atmoSunDir;
uniform vec3 atmoHazeSun;
uniform vec4 atmoFogParams;
uniform sampler2D atmoCloudMap;
uniform vec4 atmoCloudParams;
uniform vec4 atmoCloudY;

// Optical depth of exponential height fog along camera -> p (closed form).
float atmoFogAmount( vec3 ray ) {
  float dist = length( ray );
  float b = atmoFogParams.y;
  float h0 = max( cameraPosition.y - atmoFogParams.z, -300.0 );
  float k = b * ray.y;
  float f = abs( k ) > 1e-4 ? ( 1.0 - exp( - k ) ) / k : 1.0;
  float od = atmoFogParams.x * exp( - b * h0 ) * dist * f;
  return min( 1.0 - exp( - od ), atmoFogParams.w );
}
vec3 atmoFogColor( vec3 dir ) {
  float s = max( dot( dir, atmoSunDir ), 0.0 );
  return mix( fogColor, atmoHazeSun, pow( s, 5.0 ) * 0.85 );
}
vec3 atmoApplyFog( vec3 col, vec3 worldPos ) {
  vec3 ray = worldPos - cameraPosition;
  return mix( col, atmoFogColor( normalize( ray ) ), atmoFogAmount( ray ) );
}
float atmoCloudShadow( vec3 worldPos ) {
  vec2 p = worldPos.xz + atmoSunDir.xz / max( atmoSunDir.y, 0.12 ) * ( atmoCloudY.x - worldPos.y );
  float c = texture2D( atmoCloudMap, ( p - atmoCloudParams.xy ) * atmoCloudParams.z ).r;
  return 1.0 - c * atmoCloudParams.w;
}
`;

const LIGHT_ANCHOR = 'getDirectionalLightInfo( directionalLight, directLight );';
let installed = false;

/** Rewrites Three's fog chunks (once, before any program compiles) into height fog + cloud shadows. */
export function installAtmosphereShaderChunks(): void {
  if (installed) return;
  installed = true;
  const chunks = THREE.ShaderChunk as unknown as Record<string, string>;
  chunks.fog_pars_vertex = '#ifdef USE_FOG\n varying float vFogDepth;\n varying vec3 vAtmoWorldPos;\n#endif\n';
  // World position from view space: works for meshes, instances, sprites and points alike.
  chunks.fog_vertex = '#ifdef USE_FOG\n vFogDepth = - mvPosition.z;\n vAtmoWorldPos = transpose( mat3( viewMatrix ) ) * ( mvPosition.xyz - viewMatrix[ 3 ].xyz );\n#endif\n';
  chunks.fog_pars_fragment = `#ifdef USE_FOG\n uniform vec3 fogColor;\n varying float vFogDepth;\n varying vec3 vAtmoWorldPos;\n${ATMOSPHERE_GLSL}\n#endif\n`;
  chunks.fog_fragment = '#ifdef USE_FOG\n gl_FragColor.rgb = atmoApplyFog( gl_FragColor.rgb, vAtmoWorldPos );\n#endif\n';
  if (!chunks.lights_fragment_begin.includes(LIGHT_ANCHOR)) throw new Error('atmosphere: three.js lights chunk changed; cloud-shadow anchor missing');
  chunks.lights_fragment_begin = chunks.lights_fragment_begin.replace(
    LIGHT_ANCHOR,
    `${LIGHT_ANCHOR}\n#ifdef USE_FOG\n directLight.color *= atmoCloudShadow( vAtmoWorldPos );\n#endif`,
  );
  for (const name of ['basic', 'lambert', 'phong', 'standard', 'physical', 'toon', 'matcap', 'points', 'sprite']) {
    Object.assign(THREE.ShaderLib[name as keyof typeof THREE.ShaderLib].uniforms, atmosphereUniforms);
  }
}

// ---- tileable noise shared by terrain, water and clouds --------------------------------------
let noiseTexture: THREE.DataTexture | null = null;

/** 256² RGBA tileable fbm value noise; each channel is an independent field. Built once. */
export function getNoiseTexture(): THREE.DataTexture {
  if (noiseTexture) return noiseTexture;
  const N = 256, data = new Uint8Array(N * N * 4);
  let seed = 0x9e3779b9;
  const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  for (let ch = 0; ch < 4; ch++) {
    const field = new Float32Array(N * N);
    let amp = 1;
    for (let period = 4; period <= 64; period *= 2) {
      const lattice = new Float32Array(period * period).map(rand);
      const cell = N / period;
      for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
        const fx = x / cell, fy = y / cell, ix = Math.floor(fx), iy = Math.floor(fy);
        const tx = fx - ix, ty = fy - iy, sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
        const at = (a: number, b: number) => lattice[((b % period) * period) + (a % period)];
        const v = at(ix, iy) * (1 - sx) * (1 - sy) + at(ix + 1, iy) * sx * (1 - sy) + at(ix, iy + 1) * (1 - sx) * sy + at(ix + 1, iy + 1) * sx * sy;
        field[y * N + x] += v * amp;
      }
      amp *= 0.55;
    }
    // Stretch contrast to the full byte range so every channel uses 0..1.
    let lo = Infinity, hi = -Infinity;
    for (const v of field) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
    for (let i = 0; i < N * N; i++) data[i * 4 + ch] = Math.round(((field[i] - lo) / (hi - lo)) * 255);
  }
  noiseTexture = new THREE.DataTexture(data, N, N, THREE.RGBAFormat);
  noiseTexture.wrapS = noiseTexture.wrapT = THREE.RepeatWrapping;
  noiseTexture.magFilter = THREE.LinearFilter;
  noiseTexture.minFilter = THREE.LinearMipmapLinearFilter;
  noiseTexture.generateMipmaps = true;
  noiseTexture.anisotropy = 4;
  noiseTexture.needsUpdate = true;
  return noiseTexture;
}

// ---- sky -----------------------------------------------------------------------------------
const SKY_VERTEX = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = normalize( position );
  // Rotation only: the dome is infinitely far, always centred on the camera, at the far plane.
  vec4 p = projectionMatrix * vec4( mat3( viewMatrix ) * position, 1.0 );
  gl_Position = vec4( p.xy, p.w * 0.99999, p.w );
}`;

const SKY_FRAGMENT = /* glsl */ `
uniform vec3 fogColor;
uniform vec3 skyZenith;
uniform vec3 skyGround;
uniform vec3 skySunColor;
uniform float skySunDisc;
uniform float skyGroundMix;
${ATMOSPHERE_GLSL}
varying vec3 vDir;
void main() {
  vec3 dir = normalize( vDir );
  float up = max( dir.y, 0.0 );
  vec3 col = mix( fogColor, skyZenith, pow( up, 0.32 ) );
  float s = max( dot( dir, atmoSunDir ), 0.0 );
  col += skySunColor * ( 0.12 * pow( s, 6.0 ) + 0.35 * pow( s, 48.0 ) + 1.2 * pow( s, 900.0 ) );
  col += skySunColor * skySunDisc * smoothstep( 0.99965, 0.99985, s );
  // Same height-fog integral as the world, to 60 km: the terrain horizon melts into this.
  col = mix( col, atmoFogColor( dir ), atmoFogAmount( dir * 60000.0 ) );
  // Below the horizon: ground bounce for the IBL only.
  col = mix( col, skyGround, smoothstep( 0.0, -0.12, dir.y ) * skyGroundMix );
  gl_FragColor = vec4( col, 1.0 );
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

function createSkyMaterial(look: AtmosphereLook, disc: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    name: 'atmosphere-sky',
    uniforms: {
      ...atmosphereUniforms,
      fogColor: { value: look.haze },
      skyZenith: { value: look.zenith },
      skyGround: { value: look.ground },
      skySunColor: { value: look.sunColor.clone().multiplyScalar(look.sunIntensity / 3) },
      skySunDisc: { value: disc },
      // Visible dome: haze below the horizon (seamless past terrain edges); IBL: ground bounce.
      skyGroundMix: { value: disc > 0 ? 0 : 1 },
    },
    vertexShader: SKY_VERTEX,
    fragmentShader: SKY_FRAGMENT,
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: false,
    fog: false,
  });
}

/** Scene-level atmosphere: sky dome, key light (+ following shadow box), fog, IBL. */
export class Atmosphere {
  readonly look: AtmosphereLook;
  readonly sun: THREE.DirectionalLight;
  readonly sky: THREE.Mesh;
  private readonly envTarget: THREE.WebGLRenderTarget;
  private readonly shadowExtentM: number;
  private readonly right = new THREE.Vector3();
  private readonly up = new THREE.Vector3();

  constructor(scene: THREE.Scene, renderer: THREE.WebGLRenderer, region: Pick<RegionDefinition, 'skyColor' | 'environment'>, options: { lowPower?: boolean; shadowExtentM?: number } = {}) {
    installAtmosphereShaderChunks();
    const look = (this.look = atmosphereLook(region));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = look.exposure;

    // Fog object only switches USE_FOG on and carries the base haze colour; the maths is in the chunks.
    scene.fog = new THREE.Fog(look.haze, 1, 2);
    scene.background = null;
    atmosphereUniforms.atmoSunDir.value.copy(look.sunDir);
    atmosphereUniforms.atmoHazeSun.value.copy(look.hazeSun);
    atmosphereUniforms.atmoFogParams.value.set(look.fogDensity, look.fogFalloff, look.fogBaseY, 1);
    atmosphereUniforms.atmoCloudParams.value.w = 0; // clouds.ts enables shadows once its map exists

    this.sky = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 24), createSkyMaterial(look, 40));
    this.sky.name = 'atmosphere:sky';
    this.sky.frustumCulled = false;
    this.sky.renderOrder = -1000;
    scene.add(this.sky);

    // IBL: the same sky (no disc: the sun is the directional light) prefiltered for PBR.
    const envScene = new THREE.Scene();
    const envSky = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 24), createSkyMaterial(look, 0));
    // The PMREM cube cameras sit at the origin; lift the virtual eye so the haze integral is "above ground".
    envScene.add(envSky);
    const pmrem = new THREE.PMREMGenerator(renderer);
    this.envTarget = pmrem.fromScene(envScene, 0, 0.1, 10);
    pmrem.dispose();
    envSky.geometry.dispose();
    (envSky.material as THREE.Material).dispose();
    scene.environment = this.envTarget.texture;
    scene.environmentIntensity = look.envIntensity;

    this.sun = new THREE.DirectionalLight(look.sunColor, look.sunIntensity);
    this.sun.name = 'atmosphere:sun';
    this.sun.castShadow = true;
    const map = options.lowPower ? 1024 : 2048;
    this.shadowExtentM = options.shadowExtentM ?? 60;
    this.sun.shadow.mapSize.set(map, map);
    const cam = this.sun.shadow.camera;
    cam.left = cam.bottom = -this.shadowExtentM;
    cam.right = cam.top = this.shadowExtentM;
    cam.near = 1;
    cam.far = 1200;
    cam.updateProjectionMatrix();
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.04;
    scene.add(this.sun, this.sun.target);
    this.right.crossVectors(look.sunDir, new THREE.Vector3(0, 1, 0)).normalize();
    if (this.right.lengthSq() < 1e-6) this.right.set(1, 0, 0);
    this.up.crossVectors(this.right, look.sunDir).normalize();
  }

  /** Keeps the shadow box on `focus` (texel-snapped so shadow edges don't crawl as it moves). */
  update(focus: THREE.Vector3): void {
    const texel = (2 * this.shadowExtentM) / this.sun.shadow.mapSize.x;
    const r = focus.dot(this.right), u = focus.dot(this.up);
    const target = this.sun.target.position.copy(focus)
      .addScaledVector(this.right, Math.round(r / texel) * texel - r)
      .addScaledVector(this.up, Math.round(u / texel) * texel - u);
    this.sun.position.copy(target).addScaledVector(this.look.sunDir, 600);
  }

  dispose(): void {
    this.envTarget.dispose();
    this.sky.geometry.dispose();
    (this.sky.material as THREE.Material).dispose();
  }
}
