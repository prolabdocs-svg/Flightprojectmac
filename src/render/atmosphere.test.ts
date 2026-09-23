import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { atmosphereLook, atmosphereUniforms, installAtmosphereShaderChunks } from './atmosphere';

describe('atmosphere', () => {
  it('patches fog + cloud-shadow chunks and shares uniforms by reference with built-in materials', () => {
    installAtmosphereShaderChunks();
    expect(THREE.ShaderChunk.fog_fragment).toContain('atmoApplyFog');
    expect(THREE.ShaderChunk.lights_fragment_begin).toContain('atmoCloudShadow');
    const cloned = THREE.UniformsUtils.clone(THREE.ShaderLib.standard.uniforms);
    expect(cloned.atmoFogParams.value).toBe(atmosphereUniforms.atmoFogParams.value);
    expect(cloned.atmoCloudMap.value).toBe(atmosphereUniforms.atmoCloudMap.value);
  });

  it('puts the sun above the horizon for every time of day, lowest at sunset', () => {
    const el = (timeOfDay: 'morning' | 'afternoon' | 'overcast' | 'sunset') =>
      atmosphereLook({ skyColor: '#bfe3ff', environment: { timeOfDay, weather: 'clear', cloudCover: 0.3 } as never }).sunDir.y;
    for (const t of ['morning', 'afternoon', 'overcast', 'sunset'] as const) expect(el(t)).toBeGreaterThan(0);
    expect(el('sunset')).toBeLessThan(el('morning'));
  });
});
