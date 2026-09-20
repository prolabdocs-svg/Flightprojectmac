import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { AssetManifestSchema } from './AssetManifest';

const entry = {
  id: 'field.tree.oak_a', category: 'vegetation.tree',
  source: { provider: 'Quaternius', url: 'https://quaternius.com/', license: 'CC0', downloadDate: '2026-09-20', originalFile: 'a.gltf', sha256: 'a'.repeat(64) },
  runtime: { uri: '/assets/regions/field/vegetation/tree_oak_a.glb' },
};

describe('AssetManifestSchema', () => {
  it('accepts the committed manifest', () => {
    expect(AssetManifestSchema.safeParse(JSON.parse(readFileSync('ASSET_MANIFEST.json', 'utf8'))).success).toBe(true);
  });
  it('accepts a complete entry and rejects placeholders / non-glb', () => {
    const wrap = (e: unknown) => AssetManifestSchema.safeParse({ schemaVersion: 1, generatedAt: 'x', assets: [e] }).success;
    expect(wrap(entry)).toBe(true);
    expect(wrap({ ...entry, source: { ...entry.source, sha256: 'SET_AT_IMPORT' } })).toBe(false);
    expect(wrap({ ...entry, source: { ...entry.source, license: 'VERIFY_DOWNLOADED_ARCHIVE' } })).toBe(false);
    expect(wrap({ ...entry, runtime: { uri: '/assets/x.fbx' } })).toBe(false);
  });
});
