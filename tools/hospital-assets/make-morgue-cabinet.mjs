// Gera morgue_cabinet.glb a partir do "Morgue Refrigerator. Dead" (Mehdi Shahsavan, CC BY 4.0).
//  - usa só o bloco 01 (15 gavetas: 5 colunas x 3 linhas), com a frente voltada para +X;
//  - origem no CHÃO, encostada na parede de fundo e centrada na largura (basta posicionar o gabinete na parede);
//  - gavetas listadas em OPEN ficam abertas: porta girada e bandeja puxada (os corpos são colocados pelo jogo);
//  - peças mescladas por material (poucos draw calls) e texturas em WebP.
// Uso: npm i --no-save @gltf-transform/core @gltf-transform/extensions @gltf-transform/functions sharp
//      node tools/hospital-assets/make-morgue-cabinet.mjs <morgue_refrigerator.glb> <pasta-de-saida>
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { flatten, join, dedup, prune, textureCompress } from '@gltf-transform/functions';
import sharp from 'sharp';

const [,, src = 'morgue_refrigerator.glb', outDir = 'public/models/hospital'] = process.argv;
// Gavetas abertas: [linha (0 = embaixo), coluna (0 = a de menor z)]
const OPEN = [[0, 1], [1, 3], [2, 0]];
const PULL = 1.45;                     // quanto a bandeja sai (m, escala original)
const DOOR_ANGLE = -100 * Math.PI / 180;

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(src);
const root = doc.getRoot();
const scene = root.listScenes()[0];
const ap = (m, [x, y, z]) => [m[0]*x + m[4]*y + m[8]*z + m[12], m[1]*x + m[5]*y + m[9]*z + m[13], m[2]*x + m[6]*y + m[10]*z + m[14]];
const rot = (m, [x, y, z]) => [m[0]*x + m[4]*y + m[8]*z, m[1]*x + m[5]*y + m[9]*z, m[2]*x + m[6]*y + m[10]*z];

// ── 1. só o bloco 01 (índices 1..15; o bloco 02 usa 16..30 e traz peças soltas/deslocadas)
const part = (n) => { const m = n.getName().match(/^(Wall|base|br|door)(?:_(\d+))?_(Wall|Base|Takht|Door)_0$/); return m ? { kind: m[1], idx: m[2] ? +m[2] : 1 } : null; };
const keep = [];
for (const n of root.listNodes()) {
  if (!n.getMesh()) continue;
  const p = part(n);
  if (p && p.idx <= 15 && n.getName() !== 'Wall_2_Wall_0') keep.push({ n, ...p, M: n.getWorldMatrix() });
}
for (const k of keep) { k.n.getParentNode()?.removeChild(k.n); scene.addChild(k.n); }
for (const c of scene.listChildren()) if (!keep.some((k) => k.n === c)) c.dispose();

// ── 2. cozinha a geometria no espaço do mundo
const tmp = [0, 0, 0];
const eachPrim = (k, fn) => { for (const prim of k.n.getMesh().listPrimitives()) fn(prim); };
for (const k of keep) eachPrim(k, (prim) => {
  const pos = prim.getAttribute('POSITION'), nor = prim.getAttribute('NORMAL'), tan = prim.getAttribute('TANGENT');
  for (let i = 0; i < pos.getCount(); i++) { pos.getElement(i, tmp); pos.setElement(i, ap(k.M, tmp)); }
  if (nor) for (let i = 0; i < nor.getCount(); i++) { nor.getElement(i, tmp); const r = rot(k.M, tmp), l = Math.hypot(...r) || 1; nor.setElement(i, r.map((v) => v / l)); }
  if (tan) for (let i = 0; i < tan.getCount(); i++) { const t4 = tan.getElement(i, [0, 0, 0, 1]); const r = rot(k.M, t4), l = Math.hypot(...r) || 1; tan.setElement(i, [r[0] / l, r[1] / l, r[2] / l, t4[3]]); }
});
const bounds = (k) => { const mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9]; eachPrim(k, (p) => { const pos = p.getAttribute('POSITION'); for (let i = 0; i < pos.getCount(); i++) { pos.getElement(i, tmp); for (let a = 0; a < 3; a++) { mn[a] = Math.min(mn[a], tmp[a]); mx[a] = Math.max(mx[a], tmp[a]); } } }); return { mn, mx }; };
const wall = keep.find((k) => k.kind === 'Wall');
const wb = bounds(wall);
const X0 = wb.mn[0], ZC = (wb.mn[2] + wb.mx[2]) / 2;          // fundo do gabinete e centro da largura

// ── 3. células: ordena por z (colunas) e y (linhas)
const cells = keep.filter((k) => k.kind === 'base').map((k) => ({ k, b: bounds(k) }));
const zs = [...new Set(cells.map((c) => +((c.b.mn[2] + c.b.mx[2]) / 2).toFixed(2)))].sort((a, b) => a - b);
const ys = [...new Set(cells.map((c) => +c.b.mn[1].toFixed(2)))].sort((a, b) => a - b);
const cellOf = (k) => { const b = bounds(k); const zc = +((b.mn[2] + b.mx[2]) / 2).toFixed(2); const yc = (b.mn[1] + b.mx[1]) / 2;
  const col = zs.reduce((best, z, i) => Math.abs(z - zc) < Math.abs(zs[best] - zc) ? i : best, 0);
  const rowYs = ys.map((y) => y + 0.44); const row = rowYs.reduce((best, y, i) => Math.abs(y - yc) < Math.abs(rowYs[best] - yc) ? i : best, 0); return { row, col, b }; };

const shift = (k, fn) => eachPrim(k, (prim) => {
  const pos = prim.getAttribute('POSITION'), nor = prim.getAttribute('NORMAL');
  for (let i = 0; i < pos.getCount(); i++) { pos.getElement(i, tmp); pos.setElement(i, fn(tmp)); }
  return nor;
});
const info = { trays: {}, doors: {} };
for (const k of keep.filter((k) => k.kind === 'br' || k.kind === 'door')) {
  const { row, col, b } = cellOf(k);
  if (k.kind === 'br') info.trays[`${row},${col}`] = b;
  if (!OPEN.some(([r, c]) => r === row && c === col)) continue;
  if (k.kind === 'br') shift(k, ([x, y, z]) => [x + PULL, y, z]);                      // bandeja puxada
  else {                                                                              // porta girada em torno da dobradiça (canto frontal, lado +z)
    const px = b.mx[0], pz = b.mx[2], cs = Math.cos(DOOR_ANGLE), sn = Math.sin(DOOR_ANGLE);
    eachPrim(k, (prim) => {
      const pos = prim.getAttribute('POSITION'), nor = prim.getAttribute('NORMAL'), tan = prim.getAttribute('TANGENT');
      for (let i = 0; i < pos.getCount(); i++) { pos.getElement(i, tmp); const dx = tmp[0] - px, dz = tmp[2] - pz; pos.setElement(i, [px + dx * cs + dz * sn, tmp[1], pz - dx * sn + dz * cs]); }
      if (nor) for (let i = 0; i < nor.getCount(); i++) { nor.getElement(i, tmp); nor.setElement(i, [tmp[0] * cs + tmp[2] * sn, tmp[1], -tmp[0] * sn + tmp[2] * cs]); }
      if (tan) for (let i = 0; i < tan.getCount(); i++) { const t4 = tan.getElement(i, [0, 0, 0, 1]); tan.setElement(i, [t4[0] * cs + t4[2] * sn, t4[1], -t4[0] * sn + t4[2] * cs, t4[3]]); }
    });
  }
}

// ── 4. origem: chão, fundo do gabinete, centro da largura
for (const k of keep) shift(k, ([x, y, z]) => [x - X0, y, z - ZC]);

// ── 5. mescla por material, dedup e texturas leves
await doc.transform(flatten(), join(), dedup(), prune(),
  textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [1024, 1024], quality: 82 }));
await io.write(`${outDir}/morgue_cabinet.glb`, doc);

// ── 6. constantes para o jogo (escala original; multiplique pela escala do manifest)
const trayTop = (row) => +(Object.entries(info.trays).find(([key]) => key.startsWith(`${row},`))[1].mx[1]).toFixed(3);
const sample = info.trays['0,0'];
console.log(JSON.stringify({
  profundidade: +(wb.mx[0] - X0).toFixed(3), largura: +(wb.mx[2] - wb.mn[2]).toFixed(3), altura: +wb.mx[1].toFixed(3),
  colunasZ: zs.map((z) => +(z - ZC).toFixed(3)), alturaTopoBandeja: [0, 1, 2].map(trayTop),
  bandejaCentroX_fechada: +(((sample.mn[0] + sample.mx[0]) / 2) - X0).toFixed(3), PULL, abertas: OPEN,
}, null, 1));
