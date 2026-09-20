// Usage: node scripts/assets/import.ts   (PF-ASSET-007/009/012/013)
// Converts the selected source models into optimized runtime GLBs (texture resize→webp, weld,
// meshopt compression, LODs for trees) and rewrites ASSET_MANIFEST.json entries for them.
// ponytail: KTX2 skipped (no toktx installed) — webp textures; add uastc/etc1s when toktx is available.
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, join, palette, prune, resample, simplify, textureCompress, weld, meshopt, getBounds } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';
import { mkdirSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { AssetManifestSchema, type AssetEntry } from '../../src/assets/AssetManifest.ts';

await MeshoptEncoder.ready; await MeshoptSimplifier.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder });

const NAT = readdirSync('assets-source/quaternius/stylized-nature-megakit').find((d) => !d.endsWith('.zip'))!;
const NAT_DIR = `assets-source/quaternius/stylized-nature-megakit/${NAT}/glTF`;
const AIR_DIR = 'assets-source/3dassets/airport-terminal-ground-ops';
const ledger = readFileSync('assets-source/_licenses/LEDGER.jsonl', 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const shaFor = (needle: string) => ledger.find((r) => r.source_url.includes(needle) || r.original_filename.includes(needle));
const natSha = shaFor('stylizednaturemegakit');

interface Job { id: string; src: string; out: string; category: string; tex: number; lods: boolean; tags: string[]; ledger: { sha256: string; source_url: string; license_name: string; download_date: string; original_filename: string }; pack: string; provider: string }
const jobs: Job[] = [];
const REG = 'public/assets/regions/field';
const nat = (list: string[], cat: string, folder: string, tex: number, lods: boolean, snake = (s: string) => s.toLowerCase()) =>
  list.forEach((n) => jobs.push({ id: `field.${cat}.${snake(n)}`, src: `${NAT_DIR}/${n}.gltf`, out: `${REG}/${folder}/${snake(n)}.glb`, category: `vegetation.${cat}`, tex, lods, tags: ['field', 'nature', 'instanced'], ledger: natSha, pack: 'Stylized Nature MegaKit (Standard)', provider: 'Quaternius' }));
nat(['CommonTree_1', 'CommonTree_2', 'CommonTree_3', 'Pine_1', 'Pine_2', 'Pine_3', 'TwistedTree_1', 'TwistedTree_2', 'DeadTree_1'], 'tree', 'vegetation', 1024, true);
nat(['Rock_Medium_1', 'Rock_Medium_2', 'Rock_Medium_3', 'Pebble_Round_1', 'Pebble_Square_1'], 'rock', 'rocks', 512, false);
nat(['Bush_Common', 'Bush_Common_Flowers', 'Fern_1', 'Plant_1', 'Plant_7'], 'bush', 'vegetation', 512, false);
nat(['Grass_Common_Short', 'Grass_Common_Tall', 'Grass_Wispy_Short'], 'grass', 'vegetation', 512, false);
nat(['Flower_3_Group', 'Flower_4_Group', 'Clover_1'], 'flower', 'vegetation', 512, false);

const AIR = ['control-tower', 'hangar-frontage', 'gse-store', 'crew-building', 'perimeter-fence', 'perimeter-gate', 'stand-guidance-', 'passenger-air-s', 'apron-bus', 'ground-power-un', 'fuel-bowser', 'safety-cone-row', 'wheel-chock-and', 'apron-floodligh', 'taxiway-sign', 'pushback-tug', 'airfield-suppor', 'jet-blast-fence'];
for (const f of readdirSync(AIR_DIR)) {
  const base = AIR.find((p) => f.startsWith(p + '_'));
  if (!base) continue;
  const name = base.replace(/-+$/, '').replace(/-/g, '_');
  const rec = ledger.find((r) => r.original_filename === f);
  jobs.push({ id: `field.airfield.${name}`, src: `${AIR_DIR}/${f}`, out: `${REG}/airfields/${name}.glb`, category: 'structure.airfield', tex: 512, lods: false, tags: ['field', 'airfield', 'ai-generated'], ledger: rec, pack: 'Airport Terminal and Ground Operations', provider: '3DAssets.dev' });
}

const tris = (doc: Awaited<ReturnType<typeof io.read>>) => doc.getRoot().listMeshes().flatMap((m) => m.listPrimitives()).reduce((n, p) => n + (p.getIndices()?.getCount() ?? p.getAttribute('POSITION')!.getCount()) / 3, 0);

async function pack(src: string, tex: number, ratio?: number, air = false) {
  const doc = await io.read(src);
  const fns = [dedup(), weld(), ...(air ? [palette({ min: 2 }), join()] : []), ...(ratio ? [simplify({ simplifier: MeshoptSimplifier, ratio, error: 0.3 })] : []), prune(), resample()];
  if (doc.getRoot().listTextures().length) fns.push(textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [tex, tex], quality: 80 }));
  fns.push(meshopt({ encoder: MeshoptEncoder, level: 'high' }));
  await doc.transform(...fns);
  return doc;
}

const manifest = AssetManifestSchema.parse(JSON.parse(readFileSync('ASSET_MANIFEST.json', 'utf8')));
const keep = manifest.assets.filter((a) => !jobs.some((j) => j.id === a.id));
const entries: AssetEntry[] = [];
for (const j of jobs) {
  const dir = j.out.slice(0, j.out.lastIndexOf('/')); mkdirSync(dir, { recursive: true });
  const doc = await pack(j.src, j.tex, undefined, j.category === 'structure.airfield');
  await io.write(j.out, doc);
  const lodTriangles = [tris(doc)];
  if (j.lods) for (const [i, r] of [[1, 0.4], [2, 0.12]] as const) {
    const d = await pack(j.src, Math.max(256, j.tex / 2), r);
    await io.write(j.out.replace('.glb', `_lod${i}.glb`), d); lodTriangles.push(tris(d));
  }
  const b = getBounds((doc.getRoot().getDefaultScene() ?? doc.getRoot().listScenes()[0])!);
  const materials = doc.getRoot().listMaterials().length;
  console.log(j.id.padEnd(44), lodTriangles.join('/').padEnd(16), `${materials}mat`, b.max.map((v, i) => (v - b.min[i]).toFixed(1)).join('x'));
  entries.push({
    id: j.id, category: j.category,
    source: { provider: j.provider, pack: j.pack, url: j.ledger.source_url, license: j.ledger.license_name, downloadDate: j.ledger.download_date, originalFile: j.ledger.original_filename, sha256: j.ledger.sha256 },
    runtime: { uri: j.out.replace('public', ''), preload: false, streamGroup: 'region.field.' + j.category.split('.')[0], qualityMin: 'low', castShadow: true, receiveShadow: true },
    geometry: { lodRequired: j.lods, lodTriangles }, collision: { type: 'none', required: false },
    textures: { maxDimension: j.tex, compression: 'none' }, tags: j.tags,
  });
}
writeFileSync('ASSET_MANIFEST.json', JSON.stringify({ ...manifest, generatedAt: new Date().toISOString(), assets: [...keep, ...entries] }, null, 2) + '\n');
