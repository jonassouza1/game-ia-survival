// Otimiza os GLB originais da rua (carro, garagem, prédios, bairro pós-guerra, ar-condicionado).
// Uso (instale as dependências sem mexer no package.json):
//   npm i --no-save @gltf-transform/core @gltf-transform/extensions @gltf-transform/functions sharp meshoptimizer draco3dgltf
//   INPUT_DIR=./originais OUTPUT_DIR=./public/models/street GROUND_Y=0.72 RATIO=0.06 ERR=0.01 FLAGS=Sparse \
//     node tools/optimize-street-assets.mjs car garage tower city ac postwar
import { NodeIO, getBounds } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { weld, simplify, simplifyPrimitive, compactPrimitive, join, prune, dedup, textureCompress, metalRough, flatten } from '@gltf-transform/functions';
import draco3d from 'draco3dgltf';
import { MeshoptDecoder, MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';
import { writeFileSync } from 'node:fs';

await MeshoptSimplifier.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
  'draco3d.decoder': await draco3d.createDecoderModule(), 'meshopt.decoder': MeshoptDecoder,
});
const IN = (process.env.INPUT_DIR ?? './originais') + '/', OUT = (process.env.OUTPUT_DIR ?? './public/models/street') + '/';
const triCount = (doc) => { let t = 0; for (const m of doc.getRoot().listMeshes()) for (const p of m.listPrimitives()) t += (p.getIndices()?.getCount() ?? p.getAttribute('POSITION').getCount()) / 3; return Math.round(t); };

// Remove triângulos por regra (coordenadas de mundo).
function dropTriangles(doc, shouldDrop) {
  let dropped = 0;
  for (const node of doc.getRoot().listNodes()) {
    const mesh = node.getMesh(); if (!mesh) continue;
    const M = node.getWorldMatrix();
    const tf = (x, y, z) => [M[0]*x + M[4]*y + M[8]*z + M[12], M[1]*x + M[5]*y + M[9]*z + M[13], M[2]*x + M[6]*y + M[10]*z + M[14]];
    for (const prim of mesh.listPrimitives()) {
      const pos = prim.getAttribute('POSITION'); const idx = prim.getIndices();
      const n = idx ? idx.getCount() : pos.getCount();
      const get = (i) => idx ? idx.getScalar(i) : i;
      const keep = [];
      for (let i = 0; i < n; i += 3) {
        const a = tf(...pos.getElement(get(i), [0,0,0])), b = tf(...pos.getElement(get(i+1), [0,0,0])), c = tf(...pos.getElement(get(i+2), [0,0,0]));
        if (shouldDrop(a, b, c)) { dropped++; continue; }
        keep.push(get(i), get(i+1), get(i+2));
      }
      if (keep.length === n) continue;
      const arr = new Uint32Array(keep);
      if (!idx) { const acc = doc.createAccessor().setType('SCALAR').setArray(arr).setBuffer(pos.getBuffer()); prim.setIndices(acc); }
      else idx.setArray(arr);
    }
  }
  return dropped;
}
const normalY = (a, b, c) => {
  const ux = b[0]-a[0], uy = b[1]-a[1], uz = b[2]-a[2], vx = c[0]-a[0], vy = c[1]-a[1], vz = c[2]-a[2];
  const nx = uy*vz - uz*vy, ny = uz*vx - ux*vz, nz = ux*vy - uy*vx;
  const l = Math.hypot(nx, ny, nz) || 1; return ny / l;
};


// Simplifica soldando os vértices por POSIÇÃO (scans têm costuras de UV que travam o simplificador).
function simplifyByPosition(doc, ratio, error, flags = (process.env.FLAGS === 'none' ? [] : process.env.FLAGS ? process.env.FLAGS.split(',') : ['LockBorder'])) {
  for (const mesh of doc.getRoot().listMeshes()) for (const prim of mesh.listPrimitives()) {
    const pos = prim.getAttribute('POSITION'); const idx = prim.getIndices(); if (!idx) continue;
    const arr = pos.getArray(); const n = pos.getCount();
    const canon = new Uint32Array(n); const seen = new Map();
    for (let i = 0; i < n; i++) {
      const k = `${Math.round(arr[i*3]*1e5)},${Math.round(arr[i*3+1]*1e5)},${Math.round(arr[i*3+2]*1e5)}`;
      const f = seen.get(k); if (f === undefined) { seen.set(k, i); canon[i] = i; } else canon[i] = f;
    }
    const src = idx.getArray(); const ci = new Uint32Array(src.length);
    for (let i = 0; i < src.length; i++) ci[i] = canon[src[i]];
    const target = Math.max(12, Math.floor(src.length * ratio / 3) * 3);
    const [out] = MeshoptSimplifier.simplify(ci, new Float32Array(arr), 3, target, error, flags);
    idx.setArray(new Uint32Array(out));
    // normais suaves recalculadas por posição (as originais ficam erradas depois da decimação)
    const nrm = new Float32Array(n * 3);
    for (let t = 0; t < out.length; t += 3) {
      const a = out[t], b = out[t+1], c = out[t+2];
      const ux = arr[b*3]-arr[a*3], uy = arr[b*3+1]-arr[a*3+1], uz = arr[b*3+2]-arr[a*3+2];
      const vx = arr[c*3]-arr[a*3], vy = arr[c*3+1]-arr[a*3+1], vz = arr[c*3+2]-arr[a*3+2];
      const fx = uy*vz-uz*vy, fy = uz*vx-ux*vz, fz = ux*vy-uy*vx;      // ponderada pela área
      for (const v of [a, b, c]) { nrm[v*3] += fx; nrm[v*3+1] += fy; nrm[v*3+2] += fz; }
    }
    for (let i = 0; i < n; i++) {
      const k = canon[i] * 3; const l = Math.hypot(nrm[k], nrm[k+1], nrm[k+2]) || 1;
      if (canon[i] !== i) { nrm[i*3] = nrm[k]; nrm[i*3+1] = nrm[k+1]; nrm[i*3+2] = nrm[k+2]; }
    }
    for (let i = 0; i < n; i++) { const l = Math.hypot(nrm[i*3], nrm[i*3+1], nrm[i*3+2]) || 1; nrm[i*3] /= l; nrm[i*3+1] /= l; nrm[i*3+2] /= l; }
    prim.getAttribute('NORMAL').setArray(nrm);
    compactPrimitive(prim);
  }
}

const tex = (max, fmt = 'jpeg', q = 80) => textureCompress({ encoder: sharp, resize: [max, max], targetFormat: fmt, quality: q });

const jobs = {
  async car(doc) {
    // 1) cor "unlit" vira material físico, para reagir à luz da rua
    for (const mat of doc.getRoot().listMaterials()) { mat.setExtension('KHR_materials_unlit', null); mat.setRoughnessFactor(0.88).setMetallicFactor(0.15); }
    for (const ext of doc.getRoot().listExtensionsUsed()) if (ext.extensionName === 'KHR_materials_unlit') ext.dispose();
    // 2) remove o pedaço de chão escaneado sob o carro
    const d = dropTriangles(doc, (a, b, c) => { const hi = Math.max(a[1], b[1], c[1]); return hi < 0.62 || (hi < +process.env.GROUND_Y && Math.abs(normalY(a, b, c)) > 0.5); });
    console.log('  chão removido (tris):', d);
    simplifyByPosition(doc, +process.env.RATIO, +process.env.ERR);
    await doc.transform(prune(), dedup(), tex(512, 'jpeg', 78));
  },
  async garage(doc) {
    await doc.transform(prune(), dedup(), tex(512, 'jpeg', 80));
    for (const t of doc.getRoot().listTextures()) {      // PNGs com transparência que sobraram descem para 512
      if (t.getMimeType() !== 'image/png') continue;
      const img = await sharp(Buffer.from(t.getImage())).resize(512, 512, { fit: 'inside' }).png({ compressionLevel: 9 }).toBuffer();
      t.setImage(new Uint8Array(img));
    }
  },
  async tower(doc) { await doc.transform(prune(), dedup(), tex(1024, 'jpeg', 82)); },
  async city(doc) { await doc.transform(prune(), dedup(), tex(1024, 'jpeg', 78), flatten(), join({ keepMeshes: false, keepNamed: false })); },
  async ac(doc) {
    simplifyByPosition(doc, 0.3, 0.02);
    await doc.transform(prune(), dedup(), tex(1024, 'jpeg', 78));
  },
  async postwar(doc) {
    const root = doc.getRoot();
    // cúpula de céu, base do mapa (chão bege) e os blocos "map.osm" (massas cinzas sem textura que invadiriam a rua)
    for (const n of root.listNodes()) {
      if (['Sphere', 'map.osm', '42526024.001'].includes(n.getName())) { n.listChildren().forEach((c) => c.dispose()); n.setMesh(null); n.dispose(); }
    }
    // lajes de calçada/estrada do lado de fora da muralha leste: ficavam soltas no meio do nada
    for (const n of root.listNodes()) if (['Cube.001', 'Cube.002', 'Circle.004', 'Circle.005'].includes(n.getName())) { n.setMesh(null); n.dispose(); }
    // peças com polígonos de sobra (monte de cascalho, tronco da hera, toldo): 60 mil → ~15 mil etc., sem mudar a silhueta
    await doc.transform(weld());
    for (const n of root.listNodes()) {
      const mesh = n.getMesh(); if (!mesh) continue;
      for (const prim of mesh.listPrimitives()) {
        const matName = prim.getMaterial()?.getName() ?? '';
        const ratio = /^gravas$/.test(matName) ? 0.25 : /^ivy-tronc/.test(matName) ? 0.35 : /^toile$/.test(matName) ? 0.35 : 0;
        if (ratio) simplifyPrimitive(prim, { simplifier: MeshoptSimplifier, ratio, error: 0.01, lockBorder: true });
      }
    }
    await doc.transform(metalRough());
    await doc.transform(prune(), dedup(), tex(1024, 'jpeg', 80));
    await doc.transform(flatten(), join({ keepMeshes: false, keepNamed: false }));
    for (const t of root.listTextures()) {      // o que sobrou em PNG (com transparência) desce para 512
      if (t.getMimeType() !== 'image/png') continue;
      const img = await sharp(Buffer.from(t.getImage())).resize(512, 512, { fit: 'inside' }).png({ compressionLevel: 9, palette: false }).toBuffer();
      t.setImage(new Uint8Array(img));
    }
  },
};
const files = {
  car: ['abandoned_destroyed_car_hyundai_elantra.glb', 'car_burnt.glb'],
  garage: ['an_abandoned_garage.glb', 'garage.glb'],
  tower: ['abandoned_building.glb', 'tower.glb'],
  city: ['city_building.glb', 'city_block.glb'],
  ac: ['ac_unit_and_trash_bags_1_-_3d_scan.glb', 'ac_trash.glb'],
  postwar: ['postwar_city_-_exterior_scene.glb', 'postwar.glb'],
};
for (const name of process.argv.slice(2)) {
  const [src, dst] = files[name];
  console.log('>>', name);
  const doc = await io.read(IN + src);
  const before = triCount(doc);
  await jobs[name](doc);
  await io.write(OUT + dst, doc);
  const b = getBounds(doc.getRoot().listScenes()[0]);
  console.log(`  tris ${before} -> ${triCount(doc)} | bounds`, b.min.map(v => +v.toFixed(2)), b.max.map(v => +v.toFixed(2)));
}
// resumo de chamadas de desenho (primitivas) por arquivo gerado
for (const name of process.argv.slice(2)) {
  const doc = await io.read(OUT + files[name][1]);
  let prims = 0; for (const n of doc.getRoot().listNodes()) { const m = n.getMesh(); if (m) prims += m.listPrimitives().length; }
  console.log(`  ${files[name][1]}: ${prims} primitivas (draw calls por instância)`);
}
