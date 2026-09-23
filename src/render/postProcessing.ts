import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';

/**
 * HDR frame: MSAA scene render -> bloom on true highlights (sun, glints) -> grade -> ACES + sRGB.
 * The grade runs in linear HDR before tone mapping: a touch of saturation and contrast back after the
 * filmic curve flattens them, and a soft vignette that frames the aircraft. Low-power devices skip it.
 */
const GradeShader = {
  uniforms: { tDiffuse: { value: null }, saturation: { value: 1.12 }, contrast: { value: 1.08 }, vignette: { value: 0.22 } },
  vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 ); }',
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse; uniform float saturation; uniform float contrast; uniform float vignette; varying vec2 vUv;
    void main() {
      vec3 c = texture2D( tDiffuse, vUv ).rgb;
      float l = dot( c, vec3( 0.2126, 0.7152, 0.0722 ) );
      c = max( mix( vec3( l ), c, saturation ), 0.0 );
      // Contrast around mid-grey in log space so HDR highlights are not clipped.
      c = exp2( ( log2( c + 1e-4 ) - log2( 0.18 ) ) * contrast + log2( 0.18 ) );
      vec2 d = vUv - 0.5;
      c *= 1.0 - vignette * smoothstep( 0.2, 0.75, dot( d, d ) * 2.0 );
      gl_FragColor = vec4( c, 1.0 );
    }`,
};

export class PostProcessing {
  private readonly composer: EffectComposer;
  private readonly bloom: UnrealBloomPass;

  constructor(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera) {
    const size = renderer.getSize(new THREE.Vector2());
    const target = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: renderer.getPixelRatio() > 1.5 ? 2 : 4 });
    this.composer = new EffectComposer(renderer, target);
    this.composer.addPass(new RenderPass(scene, camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x / 2, size.y / 2), 0.32, 0.55, 1.6);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new ShaderPass(GradeShader));
    this.composer.addPass(new OutputPass());
  }

  setSize(width: number, height: number): void { this.composer.setSize(width, height); }
  render(): void { this.composer.render(); }
  dispose(): void { this.composer.dispose(); }
}
