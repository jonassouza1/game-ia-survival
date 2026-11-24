import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { prune, dedup, getBounds } from '@gltf-transform/functions';
import { MeshoptSimplifier } from 'meshoptimizer';
import fs from 'node:fs';
const TARGET_RATIO = Number(process.argv[2] ?? 0.2);
const UVW = Number(process.argv[3] ?? 1);
const OUT = process.argv[4] ?? 'lion_statue.glb';
await MeshoptSimplifier.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read('baked.glb');
const root = doc.getRoot();
const prim = root.listMeshes()[0].listPrimitives()[0];
const pos = prim.getAttribute('POSITION'), nor = prim.getAttribute('NORMAL');

// 1) Corrige o giro em Y (~5,85°): o eixo do corpo estava ~6° fora de +Z.
const th = Math.atan2(0.1025, 1), c = Math.cos(th), s = Math.sin(th);
const rot = (v) => [v[0]*c + v[2]*s, v[1], -v[0]*s + v[2]*c];
const p = [0,0,0];
for (let i = 0; i < pos.getCount(); i++) { pos.getElement(i, p); pos.setElement(i, rot(p)); nor.getElement(i, p); nor.setElement(i, rot(p)); }

// 2) Centraliza em XZ e coloca os pés em y = 0 (origem na base da estátua).
let min = [Infinity,Infinity,Infinity], max = [-Infinity,-Infinity,-Infinity];
for (let i = 0; i < pos.getCount(); i++) { pos.getElement(i, p); for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], p[k]); max[k] = Math.max(max[k], p[k]); } }
const off = [(min[0]+max[0])/2, min[1], (min[2]+max[2])/2];
for (let i = 0; i < pos.getCount(); i++) { pos.getElement(i, p); pos.setElement(i, [p[0]-off[0], p[1]-off[1], p[2]-off[2]]); }

// 3) Simplifica. O atlas é fragmentado (cada vértice duplicado ~4x nas costuras de UV), então o modo
//    padrão não colapsa nada; 'Permissive' deixa colapsar atravessando as costuras, e a UV entra no erro.
const before = prim.getIndices().getCount() / 3;
const idx = new Uint32Array(prim.getIndices().getArray());
const uvAcc = prim.getAttribute('TEXCOORD_0');
const target = Math.floor(idx.length * TARGET_RATIO / 3) * 3;
const [simplified, err] = MeshoptSimplifier.simplifyWithAttributes(
  idx, pos.getArray(), 3, uvAcc.getArray(), 2, [UVW, UVW], null, target, 0.05, ['Permissive']);
// Compacta: descarta os vértices que sobraram sem uso.
const remap = new Int32Array(pos.getCount()).fill(-1); const keep = [];
const compact = new Uint32Array(simplified.length);
for (let i = 0; i < simplified.length; i++) {
  const v = simplified[i];
  if (remap[v] < 0) { remap[v] = keep.length; keep.push(v); }
  compact[i] = remap[v];
}
for (const sem of ['POSITION', 'NORMAL', 'TEXCOORD_0']) {
  const acc = prim.getAttribute(sem), n = acc.getElementSize(), src = acc.getArray();
  const out = new Float32Array(keep.length * n);
  keep.forEach((v, k) => { for (let j = 0; j < n; j++) out[k*n + j] = src[v*n + j]; });
  acc.setArray(out);
}
prim.getIndices().setArray(keep.length < 65535 ? new Uint16Array(compact) : compact);
await doc.transform(dedup(), prune());
const after = compact.length / 3;
console.log(`erro de simplificação ${(err * 100).toFixed(3)}% da extensão · vértices ${pos.getCount()}`);

// 4) Material: tira o KHR_materials_unlit (ignorava a iluminação) e usa PBR de pedra fosca.
for (const m of root.listMaterials()) {
  m.setExtension('KHR_materials_unlit', null);
  m.setName('LionStatueStone').setBaseColorFactor([1,1,1,1]).setMetallicFactor(0).setRoughnessFactor(0.86).setDoubleSided(true);
}
for (const ext of root.listExtensionsUsed()) if (ext.extensionName === 'KHR_materials_unlit') ext.dispose();

// 5) Textura 2048 com o fundo preenchido (gerada à parte).
const tex = root.listTextures()[0];
tex.setImage(new Uint8Array(fs.readFileSync('lion_tex_2048.jpg'))).setMimeType('image/jpeg').setName('lion_statue_basecolor');
root.listScenes()[0].listChildren()[0]?.setName('LionStatueScan');
root.listMeshes()[0].setName('LionStatueScan');

await io.write(OUT, doc);
const b = getBounds(root.listScenes()[0]);
console.log(`triângulos ${before} → ${after} (${(after/before*100).toFixed(1)}%)`);
console.log('bounds', b.min.map(v=>+v.toFixed(3)), b.max.map(v=>+v.toFixed(3)), 'tamanho', b.max.map((v,i)=>+(v-b.min[i]).toFixed(3)));
console.log('extensões:', root.listExtensionsUsed().map(e=>e.extensionName));
