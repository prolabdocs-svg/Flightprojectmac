# Third-Party Assets and Software

PROJECT FLIGHT uses third-party resources under their respective licenses.
Per-file provenance lives in `assets-source/_licenses/LEDGER.jsonl` (url, date, license, sha256)
and `ASSET_MANIFEST.json`. Earlier imports are detailed in `docs/THIRD_PARTY_ASSETS.md`.

## Currently shipped

- Kenney Nature Kit 2.1 — CC0 1.0 (`public/assets/third-party/kenney-nature/LICENSE.txt`).

## Planned (add a row to the ledger + manifest on import)

### CC0 assets
- Kenney (Nature, City Roads/Industrial/Commercial, Skyboxes, Particle Pack, Impact/UI/Interface audio) — https://kenney.nl/assets
- Poly Haven — https://polyhaven.com/license
- ambientCG — https://ambientcg.com/
- 3DAssets.dev (Airport Terminal and Ground Operations; selected airfield pieces) — CC0 1.0. Packs disclose AI-generated geometry; every imported file gets visual QA.
- Freesound: Breviceps 515293, clif_creates 251971 — CC0 per asset page.
- BigSoundBank: Passage of Small Propeller Plane — CC0 per asset page.

### Quaternius
Sources: https://quaternius.com/ · https://quaternius.com/license.html
Pack pages may say CC0; Quaternius also publishes QAL v1.0 (28/08/2026). Record whichever license
ships inside each downloaded archive in `assets-source/_licenses/`. Do not redistribute the raw
packs as a standalone asset library.

### MIT software
three.js, simplex-noise.js, three.quarks, three-mesh-bvh, glTF-Transform, meshoptimizer.

### Apache-2.0 / mixed tooling
Basis Universal (keep NOTICE); KTX-Software (file-level licenses; use official binaries; `lib/etcdec.cxx` is not under the general license).

### Sonniss GameAudioGDC
NOT CC0. Archive the exact license version active on the download date
(https://sonniss.com/gdc-bundle-license/).
