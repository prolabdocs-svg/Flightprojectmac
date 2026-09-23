import * as THREE from 'three';
import { getNoiseTexture } from './atmosphere';

/**
 * Water (art bible §15): sky reflection through the scene IBL with real Fresnel, sun glints from the
 * key light on two scrolling ripple layers, and a depth read from the terrain height grid that drives
 * the shallow->deep colour gradient, shoreline transparency and lapping foam. No reflection pass,
 * no depth pre-pass: the shore comes from the same heights the terrain and physics use.
 */

export interface WaterHeights { texture: THREE.DataTexture; sizeM: number; n: number }

/** Half-float copy of a row-major (n x n) terrain grid centred on the origin (x -> u, z -> v). */
export function createWaterHeights(heights: Float32Array, n: number, sizeM: number): WaterHeights {
  const data = new Uint16Array(n * n);
  for (let i = 0; i < data.length; i++) data[i] = THREE.DataUtils.toHalfFloat(heights[i]);
  const texture = new THREE.DataTexture(data, n, n, THREE.RedFormat, THREE.HalfFloatType);
  texture.magFilter = texture.minFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return { texture, sizeM, n };
}

export interface WaterLook { shallow: THREE.ColorRepresentation; deep: THREE.ColorRepresentation; rippleM?: number }

const time = { value: 0 };
/** One clock for every water surface (call once per frame). */
export function updateWater(elapsedS: number): void { time.value = elapsedS; }

export function createWaterMaterial(look: WaterLook, heights?: WaterHeights): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({ color: look.deep, roughness: 0.06, metalness: 0, transparent: true, side: THREE.DoubleSide });
  material.name = 'water';
  const uniforms = {
    waterNoise: { value: getNoiseTexture() },
    waterHeights: { value: heights?.texture ?? null },
    // 1/size, size/2, n, has heights
    waterGrid: { value: new THREE.Vector4(heights ? 1 / heights.sizeM : 0, heights ? heights.sizeM / 2 : 0, heights?.n ?? 1, heights ? 1 : 0) },
    waterShallow: { value: new THREE.Color(look.shallow) },
    waterDeep: { value: new THREE.Color(look.deep) },
    waterRipple: { value: look.rippleM ?? 1 },
    waterTime: time,
  };
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWaterWorld;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWaterWorld = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform sampler2D waterNoise;
        uniform sampler2D waterHeights;
        uniform vec4 waterGrid;
        uniform vec3 waterShallow;
        uniform vec3 waterDeep;
        uniform float waterRipple;
        uniform float waterTime;
        varying vec3 vWaterWorld;
        float waterFoam;
        float waterRippleH( vec2 uv, float ch ) { vec4 n = texture2D( waterNoise, uv ); return ch < 0.5 ? n.r : n.b; }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        {
          float depth = 40.0;
          if ( waterGrid.w > 0.5 ) {
            float n = waterGrid.z;
            vec2 uv = ( ( vWaterWorld.xz + waterGrid.y ) * waterGrid.x * ( n - 1.0 ) + 0.5 ) / n;
            depth = vWaterWorld.y - texture2D( waterHeights, uv ).r;
          }
          float deepK = 1.0 - exp( - max( depth, 0.0 ) / 6.0 );
          diffuseColor.rgb = mix( waterShallow, waterDeep, deepK );
          vec2 p = vWaterWorld.xz;
          float fn = texture2D( waterNoise, p / 7.0 + vec2( waterTime * 0.013, - waterTime * 0.009 ) ).g;
          float band = 0.5 + 0.5 * sin( waterTime * 1.2 - depth * 5.0 + fn * 4.0 );
          waterFoam = ( 1.0 - smoothstep( 0.05, 1.4, depth ) ) * smoothstep( 0.45, 0.75, fn * 0.7 + band * 0.45 );
          diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.92, 0.95, 0.95 ), waterFoam * 0.85 );
          diffuseColor.a = mix( 0.55, 0.96, deepK ) * smoothstep( -0.05, 0.35, depth );
          diffuseColor.a = max( diffuseColor.a, waterFoam * 0.9 * step( 0.0, depth ) );
        }`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix( roughnessFactor, 0.6, waterFoam );')
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        {
          vec2 p = vWaterWorld.xz;
          float fade = 1.0 - 0.75 * smoothstep( 150.0, 3500.0, length( vWaterWorld - cameraPosition ) );
          vec2 u1 = p / ( 34.0 * waterRipple ) + vec2( waterTime * 0.010, waterTime * 0.006 );
          vec2 u2 = p / ( 9.0 * waterRipple ) + vec2( - waterTime * 0.016, waterTime * 0.019 );
          float e = 1.0 / 256.0;
          float a = waterRippleH( u1, 0.0 ), b = waterRippleH( u2, 1.0 );
          vec2 g = vec2( waterRippleH( u1 + vec2( e, 0.0 ), 0.0 ) - a, waterRippleH( u1 + vec2( 0.0, e ), 0.0 ) - a ) * 5.0
                 + vec2( waterRippleH( u2 + vec2( e, 0.0 ), 1.0 ) - b, waterRippleH( u2 + vec2( 0.0, e ), 1.0 ) - b ) * 3.0;
          vec3 nW = normalize( vec3( - g.x * fade, 1.0, - g.y * fade ) );
          normal = normalize( ( viewMatrix * vec4( nW, 0.0 ) ).xyz );
        }`);
  };
  return material;
}
