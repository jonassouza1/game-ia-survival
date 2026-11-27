// Otimiza os modelos do jogo SEM mudar o visual:
//   • texturas JPEG/PNG → WebP, textura a textura (só troca se ficar ≥ 36 dB contra o original e menor; senão mantém);
//   • simplificação com erro máximo limitado (fração do tamanho da peça: 0,1% = milímetros) e bordas travadas;
//   • peças estáticas: quantização (KHR_mesh_quantization, 16 bits) + compressão meshopt; peças com skin: só meshopt;
//   • props Poly Haven (.gltf + .bin + .jpg) e o carro coberto viram um único .glb.
// Os GLB resultantes exigem o MeshoptDecoder (src/render/loaders.js).
//
// Uso:  ORIG=/caminho/dos/originais/models node tools/optimize-models.mjs [filtro-no-nome]
// (lê os originais de ORIG e grava em public/models; tools/optimize-models.mjs é idempotente se ORIG for o original)
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTTextureWebP, EXTMeshoptCompression } from '@gltf-transform/extensions';
import { weld, simplify, dedup, prune, quantize, reorder } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';
import fs from 'node:fs';
import path from 'node:path';

const ORIG = process.env.ORIG ?? 'originais/models';
const OUT = 'public/models';
await Promise.all([MeshoptDecoder.ready, MeshoptEncoder.ready, MeshoptSimplifier.ready]);
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });

// error: erro máximo da simplificação (0 = não simplifica) · skinned: sem quantização · animationSource: só esses clipes,
// sem texturas/materiais/atributos de render (a malha existe só para o skin/retarget) · lockBorder: false p/ malhas de normais duras.
const CONFIG = [];
for (const id of fs.readdirSync(path.join(ORIG, 'polyhaven'))) {
  CONFIG.push({ in: `polyhaven/${id}/${id}.gltf`, out: `polyhaven/${id}/${id}.glb`, error: 0.001 });
}
CONFIG.push({ in: 'covered_car/covered_car_1k.gltf', out: 'covered_car/covered_car_1k.glb', error: 0.001 });
Object.assign(CONFIG.find((c) => c.in.includes('korean_public_payphone')), { lockBorder: false, error: 0.0008 });
for (const f of ['car_burnt', 'city_block', 'garage', 'postwar', 'tower', 'ac_trash']) CONFIG.push({ in: `street/${f}.glb`, out: `street/${f}.glb`, error: 0.0005 });
CONFIG.push({ in: 'lion/lion_statue.glb', out: 'lion/lion_statue.glb', error: 0.0005 });
CONFIG.push({ in: 'police_car/police_car.glb', out: 'police_car/police_car.glb', error: 0 });
CONFIG.push({ in: 'street_light/street_light.glb', out: 'street_light/street_light.glb', error: 0 });
CONFIG.push({ in: 'character/swat.glb', out: 'character/swat.glb', skinned: true, error: 0 });
CONFIG.push({ in: 'character/Soldier.glb', out: 'character/Soldier.glb', skinned: true, error: 0, animationSource: ['Walk', 'Run'] });
for (const f of fs.readdirSync(path.join(ORIG, 'hospital')).filter((n) => n.endsWith('.glb'))) {
  CONFIG.push({ in: `hospital/${f}`, out: `hospital/${f}`, error: /body_bag|body_shroud|morgue|wheelchair|cart_surgical|building/.test(f) ? 0.001 : 0 });
}

const psnr = (a, b) => { let se = 0; for (let i = 0; i < a.length; i++) { const d = a[i] - b[i]; se += d * d; } return se ? 10 * Math.log10(65025 / (se / a.length)) : 99; };
const triCount = (doc) => { let t = 0; for (const m of doc.getRoot().listMeshes()) for (const p of m.listPrimitives()) t += (p.getIndices()?.getCount() ?? p.getAttribute('POSITION').getCount()) / 3; return Math.round(t); };
const dirSize = (d) => fs.readdirSync(d).reduce((s, f) => { const p = path.join(d, f); return s + (fs.statSync(p).isDirectory() ? dirSize(p) : fs.statSync(p).size); }, 0);

// Recodifica cada textura JPEG/PNG para WebP quando isso é seguro (fidelidade) e compensa (tamanho).
async function recodeTextures(doc, stats) {
  const ext = doc.createExtension(EXTTextureWebP).setRequired(true);
  let used = false;
  for (const tex of doc.getRoot().listTextures()) {
    const mime = tex.getMimeType();
    if (mime === 'image/webp') { used = true; continue; }
    if (mime !== 'image/jpeg' && mime !== 'image/png') continue;
    const buf = Buffer.from(tex.getImage());
    const meta = await sharp(buf).metadata();
    const ref = await sharp(buf).ensureAlpha().raw().toBuffer();
    let best = null, p = 0;
    for (const q of [88, 93, 97]) {
      const out = await sharp(buf).webp({ quality: q, effort: 6, exact: meta.hasAlpha }).toBuffer();
      p = psnr(ref, await sharp(out).ensureAlpha().raw().toBuffer());
      best = out;
      if (p >= 40) break;
    }
    if (p >= 36 && best.length < buf.length) { tex.setImage(best).setMimeType('image/webp'); used = true; stats.recoded++; }
    else stats.kept++;
  }
  if (!used) ext.dispose();
}

async function optimize(cfg) {
  const src = path.join(ORIG, cfg.in), dst = path.join(OUT, cfg.out);
  const doc = await io.read(src);
  const before = triCount(doc);
  const stats = { recoded: 0, kept: 0 };

  if (cfg.animationSource) {
    for (const a of doc.getRoot().listAnimations()) if (!cfg.animationSource.includes(a.getName())) a.dispose();
    for (const t of doc.getRoot().listTextures()) t.dispose();
    for (const m of doc.getRoot().listMaterials()) m.dispose();
    for (const mesh of doc.getRoot().listMeshes()) for (const prim of mesh.listPrimitives()) {
      for (const sem of prim.listSemantics()) if (!['POSITION', 'JOINTS_0', 'WEIGHTS_0'].includes(sem)) prim.setAttribute(sem, null);
    }
  }
  // com skin: mantém os ossos-ponta (o retarget procura ossos pelo nome)
  await doc.transform(dedup(), prune({ keepLeaves: Boolean(cfg.skinned) }));
  if (cfg.error > 0) {
    await doc.transform(weld(), simplify({ simplifier: MeshoptSimplifier, ratio: 0, error: cfg.error, lockBorder: cfg.lockBorder ?? true }));
  }
  await recodeTextures(doc, stats);
  // Modelos que já vêm quantizados (hospital/*) não são requantizados: o quantize() do glTF-Transform reescala o nó
  // sem refazer os dados e distorce a peça.
  const alreadyQuantized = doc.getRoot().listExtensionsUsed().some((e) => e.extensionName === 'KHR_mesh_quantization');
  if (!cfg.skinned && !alreadyQuantized) await doc.transform(quantize({ quantizePosition: 16, quantizeNormal: 10, quantizeTexcoord: 14, quantizeColor: 8, quantizeGeneric: 12 }));
  await doc.transform(reorder({ encoder: MeshoptEncoder, target: 'size' }));
  doc.createExtension(EXTMeshoptCompression).setRequired(true).setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.QUANTIZE });
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  const tmp = dst.replace(/\.glb$/, ".tmp.glb");
  await io.write(tmp, doc);
  fs.renameSync(tmp, dst);
  const sizeBefore = cfg.in.endsWith('.gltf') ? dirSize(path.dirname(src)) : fs.statSync(src).size;
  return { before, after: triCount(doc), sizeBefore, sizeAfter: fs.statSync(dst).size, stats };
}

const filter = process.argv[2];
let totalBefore = 0, totalAfter = 0;
for (const cfg of CONFIG.filter((c) => !filter || c.in.includes(filter))) {
  const r = await optimize(cfg);
  totalBefore += r.sizeBefore; totalAfter += r.sizeAfter;
  console.log(`${cfg.out.padEnd(52)} ${(r.sizeBefore / 1024).toFixed(0).padStart(6)} KB → ${(r.sizeAfter / 1024).toFixed(0).padStart(6)} KB   tris ${String(r.before).padStart(6)} → ${String(r.after).padStart(6)}   tex: ${r.stats.recoded} webp, ${r.stats.kept} mantidas`);
}
console.log(`TOTAL: ${(totalBefore / 1048576).toFixed(1)} MB → ${(totalAfter / 1048576).toFixed(1)} MB`);
