// npm run asset:validate — PF-ASSET-006 quality gate. Exits 1 on any failure.
import { existsSync, readFileSync, statSync } from 'node:fs';
import { AssetManifestSchema } from '../../src/assets/AssetManifest.ts';
import validator from 'gltf-validator';

const MAX_TEX = 2048;
const errors: string[] = [];
const fail = (id: string, msg: string) => errors.push(`${id}: ${msg}`);

const parsed = AssetManifestSchema.safeParse(JSON.parse(readFileSync('ASSET_MANIFEST.json', 'utf8')));
if (!parsed.success) { console.error(parsed.error.issues.map((i) => `manifest ${i.path.join('.')}: ${i.message}`).join('\n')); process.exit(1); }

const ledger = existsSync('assets-source/_licenses/LEDGER.jsonl')
  ? readFileSync('assets-source/_licenses/LEDGER.jsonl', 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l).sha256 as string)
  : [];
const seen = new Set<string>();

for (const a of parsed.data.assets) {
  if (seen.has(a.id)) fail(a.id, 'duplicate id');
  seen.add(a.id);
  if (!ledger.includes(a.source.sha256)) fail(a.id, 'sha256 not in LEDGER.jsonl');
  const path = `public${a.runtime.uri}`;
  if (!existsSync(path)) { fail(a.id, `missing ${path}`); continue; }
  if (a.textures.maxDimension > MAX_TEX) fail(a.id, `texture budget ${a.textures.maxDimension} > ${MAX_TEX}`);
  if (a.geometry.lodRequired && a.geometry.lodTriangles.length < 2) fail(a.id, 'lodRequired but <2 LODs');
  if (a.collision.required && a.collision.type === 'none') fail(a.id, 'collision required but none');
  if (statSync(path).size > 16 * 1024 * 1024) fail(a.id, 'file > 16MB');

  const report = await validator.validateBytes(new Uint8Array(readFileSync(path)));
  for (const m of report.issues.messages) if (m.severity === 0) fail(a.id, `glTF ${m.code}: ${m.message}`);
  if (report.info.materialCount > 5) fail(a.id, `${report.info.materialCount} materials (>5)`);
}

if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
console.log(`asset:validate ok (${parsed.data.assets.length} assets)`);
