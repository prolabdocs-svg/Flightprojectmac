import fs from 'node:fs/promises';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, weld, prune, meshopt, join } from '@gltf-transform/functions';
import { MeshoptEncoder } from 'meshoptimizer';

const source='assets/aircraft/rans-s12xl/models/rans_s12xl_source.glb';
const output='assets/aircraft/rans-s12xl/models';
await fs.mkdir(output,{recursive:true});
await MeshoptEncoder.ready;
const io=new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({'meshopt.encoder':MeshoptEncoder});
const animationNames=/^(aileron_[LR]|flap_[LR]|(?:aileron|flap)_[LR]_pivot|elevator_pivot|rudder_pivot|propeller_pivot|wheel_(?:L|R|nose)_pivot)$/;
const make=async (name,drop=[]) => {
  const doc=await io.read(source);
  for (const node of doc.getRoot().listNodes()) {
    const mesh=node.getMesh();
    if (mesh && drop.some(pattern=>pattern.test(mesh.getName()))) node.dispose();
  }
  await doc.transform(
    join({filter:(node)=>!animationNames.test(node.getName())&&!node.listParents().some(parent=>animationNames.test(parent.getName()))}),
    dedup(),weld(),prune(),meshopt({encoder:MeshoptEncoder,level:'high'}),
  );
  const path=`${output}/rans_s12xl_${name}.glb`;
  await io.write(path,doc);
  const bytes=(await fs.stat(path)).size;
  const meshes=doc.getRoot().listMeshes();
  const triangles=meshes.flatMap(m=>m.listPrimitives()).reduce((sum,p)=>sum+(p.getIndices()?.getCount()??p.getAttribute('POSITION')?.getCount()??0)/3,0);
  console.log(`${name}: ${Math.round(triangles)} triangles, ${meshes.length} meshes, ${(bytes/1024).toFixed(1)} KiB`);
};
await make('lod0');
await make('lod1',[/^Wing rib tape/]);
await make('lod2',[/^Wing rib tape/,/^Instrument dial/,/^Gauge needle/,/^Spark plug lead/]);
await fs.copyFile(`${output}/rans_s12xl_lod0.glb`,'public/assets/models/airframes/rans_s12xl.glb');
await fs.copyFile(`${output}/rans_s12xl_lod1.glb`,'public/assets/models/airframes/rans_s12xl_lod1.glb');
await fs.copyFile(`${output}/rans_s12xl_lod2.glb`,'public/assets/models/airframes/rans_s12xl_lod2.glb');
