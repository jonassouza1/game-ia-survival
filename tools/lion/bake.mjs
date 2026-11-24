// Aplica as transformações de todos os nós nos vértices (mundo → vértices) e junta tudo numa malha só.
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { join, flatten } from '@gltf-transform/functions';
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read('lion_statue_scan.glb');
const root = doc.getRoot();
for (const node of root.listNodes()) {
  const mesh = node.getMesh(); if (!mesh) continue;
  const m = node.getWorldMatrix();
  // matriz normal = inversa transposta do 3x3
  const a = [m[0],m[4],m[8], m[1],m[5],m[9], m[2],m[6],m[10]]; // linhas do 3x3 (col-major m)
  const det = a[0]*(a[4]*a[8]-a[5]*a[7]) - a[1]*(a[3]*a[8]-a[5]*a[6]) + a[2]*(a[3]*a[7]-a[4]*a[6]);
  const inv = [
    (a[4]*a[8]-a[5]*a[7])/det, (a[2]*a[7]-a[1]*a[8])/det, (a[1]*a[5]-a[2]*a[4])/det,
    (a[5]*a[6]-a[3]*a[8])/det, (a[0]*a[8]-a[2]*a[6])/det, (a[2]*a[3]-a[0]*a[5])/det,
    (a[3]*a[7]-a[4]*a[6])/det, (a[1]*a[6]-a[0]*a[7])/det, (a[0]*a[4]-a[1]*a[3])/det];
  for (const prim of mesh.listPrimitives()) {
    const pos = prim.getAttribute('POSITION'), nor = prim.getAttribute('NORMAL');
    const p = [0,0,0];
    for (let i = 0; i < pos.getCount(); i++) {
      pos.getElement(i, p);
      pos.setElement(i, [m[0]*p[0]+m[4]*p[1]+m[8]*p[2]+m[12], m[1]*p[0]+m[5]*p[1]+m[9]*p[2]+m[13], m[2]*p[0]+m[6]*p[1]+m[10]*p[2]+m[14]]);
      if (nor) {
        nor.getElement(i, p);
        // n' = (M^-1)^T n  → usa inv transposta: linhas de inv^T = colunas de inv
        const x = inv[0]*p[0]+inv[3]*p[1]+inv[6]*p[2], y = inv[1]*p[0]+inv[4]*p[1]+inv[7]*p[2], z = inv[2]*p[0]+inv[5]*p[1]+inv[8]*p[2];
        const l = Math.hypot(x,y,z) || 1; nor.setElement(i, [x/l,y/l,z/l]);
      }
    }
  }
  node.setTranslation([0,0,0]); node.setRotation([0,0,0,1]); node.setScale([1,1,1]);
}
await doc.transform(flatten(), join({ keepMeshes: false, keepNamed: false }));
for (const n of root.listNodes()) if (n.getMesh()) { n.setTranslation([0,0,0]); n.setRotation([0,0,0,1]); n.setScale([1,1,1]); }
await io.write('baked.glb', doc);
let tris = 0; for (const mesh of root.listMeshes()) for (const pr of mesh.listPrimitives()) tris += pr.getIndices().getCount()/3;
console.log('baked: malhas', root.listMeshes().length, 'tris', tris);
