// Uso: ORIG=/caminho/dos/originais/models node tools/verify-models.mjs
// Verificação offline: carrega originais e otimizados com o GLTFLoader do three e compara caixa/malhas/ossos.
import fs from 'node:fs'; import path from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
globalThis.window = globalThis; globalThis.self = globalThis;
globalThis.document = { createElementNS: () => ({ addEventListener(f, cb) { if (f === 'load') setTimeout(cb, 0); }, removeEventListener() {}, set src(v) {}, width: 1, height: 1 }) };
const THREE = await import('three');
const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
const { MeshoptDecoder: MD } = await import('three/addons/libs/meshopt_decoder.module.js');
await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
const O = process.env.ORIG ?? 'originais/models', N = 'public/models';
const parse = (buf) => new Promise((res, rej) => { const l = new GLTFLoader(); l.setMeshoptDecoder(MD); l.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), '', res, rej); });
function summary(gltf) {
  gltf.scene.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(gltf.scene);
  let meshes = 0, verts = 0, bones = 0, skinned = 0, tris = 0;
  gltf.scene.traverse((o) => { if (o.isMesh) { meshes++; verts += o.geometry.attributes.position.count; tris += (o.geometry.index?.count ?? o.geometry.attributes.position.count) / 3; } if (o.isBone) bones++; if (o.isSkinnedMesh) skinned++; });
  return { box, meshes, verts, bones, skinned, tris, anims: gltf.animations.map((a) => a.name + ':' + a.tracks.length).join(',') };
}
const files = [];
(function walk(d) { for (const f of fs.readdirSync(path.join(O, d))) { const p = path.join(d, f); if (fs.statSync(path.join(O, p)).isDirectory()) walk(p); else if (/\.(glb|gltf)$/.test(f) && !p.startsWith('zombies')) files.push(p); } })('');
let worst = 0, problems = 0;
for (const f of files) {
  const g = f.replace(/\.gltf$/, '.glb');
  const origDoc = await io.read(path.join(O, f));
  const origBuf = Buffer.from(await io.writeBinary(origDoc));
  let a, b;
  try { a = summary(await parse(origBuf)); b = summary(await parse(fs.readFileSync(path.join(N, g)))); }
  catch (e) { console.log('ERRO ao carregar', f, e.message ?? e); problems++; continue; }
  const sz = a.box.getSize(new THREE.Vector3()).length() || 1;
  const dMin = a.box.min.distanceTo(b.box.min) / sz, dMax = a.box.max.distanceTo(b.box.max) / sz;
  worst = Math.max(worst, dMin, dMax);
  const flags = [];
  if (Math.max(dMin, dMax) > 0.002) flags.push(`caixa difere ${(Math.max(dMin, dMax) * 100).toFixed(2)}%`);
  if (a.bones !== b.bones) flags.push(`ossos ${a.bones}→${b.bones}`);
  if (a.skinned !== b.skinned) flags.push(`skinned ${a.skinned}→${b.skinned}`);
  if (a.anims !== b.anims && !f.includes('Soldier')) flags.push(`anims ${a.anims}→${b.anims}`);
  if (a.meshes !== b.meshes && !/polyhaven|covered|street|lion|hospital/.test(f)) flags.push(`malhas ${a.meshes}→${b.meshes}`);
  if (flags.length) { problems++; console.log(f.padEnd(50), flags.join('; ')); }
}
console.log(`${files.length} modelos verificados; maior desvio de caixa: ${(worst * 100).toFixed(3)}% da diagonal; ${problems} com ressalvas`);
