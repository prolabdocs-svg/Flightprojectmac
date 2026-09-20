// Usage: node scripts/assets/ledger.ts <file> <source_url> <provider> <license_name> <license_url>
// Appends a provenance record (PF-ASSET-004) and prints the sha256 for ASSET_MANIFEST.json.
import { createHash } from 'node:crypto';
import { appendFileSync, readFileSync } from 'node:fs';
import { basename } from 'node:path';

const [file, source_url, provider, license_name, license_url] = process.argv.slice(2);
if (!license_url) { console.error('usage: ledger.ts <file> <source_url> <provider> <license_name> <license_url>'); process.exit(1); }
const sha256 = createHash('sha256').update(readFileSync(file)).digest('hex');
const rec = { source_url, download_date: new Date().toISOString().slice(0, 10), author: provider, license_name, license_url, original_filename: basename(file), sha256 };
appendFileSync('assets-source/_licenses/LEDGER.jsonl', JSON.stringify(rec) + '\n');
console.log(sha256);
