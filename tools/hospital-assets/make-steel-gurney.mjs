import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read('public/models/hospital/gurney_covered.glb');
const mesh = doc.getRoot().listMeshes()[0];
mesh.listPrimitives().forEach((p, i) => { if (i === 3) mesh.removePrimitive(p); });     // tira o lençol com o corpo
await io.write('public/models/hospital/steel_gurney.glb', doc);
console.log('ok');
