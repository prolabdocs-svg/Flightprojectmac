// Meshopt-pack the animated Aerofox Kestrel 2 runtime exports while retaining named rig nodes.
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, weld, prune, meshopt } from '@gltf-transform/functions';
import { MeshoptEncoder } from 'meshoptimizer';

await MeshoptEncoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder });
for (const path of ['public/assets/models/airframes/aerofox_kestrel2.glb', 'public/assets/models/pf_aircraft_ultralight.glb']) {
  const doc = await io.read(path);
  await doc.transform(dedup(), weld(), prune(), meshopt({ encoder: MeshoptEncoder, level: 'high' }));
  await io.write(path, doc);
  console.log('optimized', path);
}
