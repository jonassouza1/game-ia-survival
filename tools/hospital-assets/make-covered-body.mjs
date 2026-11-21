import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dequantize } from '@gltf-transform/functions';
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read('public/models/hospital/gurney_covered.glb');
await doc.transform(dequantize());
const mesh = doc.getRoot().listMeshes()[0];
mesh.listPrimitives().forEach((p, i) => { if (i !== 3) mesh.removePrimitive(p); });   // só o lençol com o corpo
const node = doc.getRoot().listNodes().find((n) => n.getMesh() === mesh);
const M = node.getWorldMatrix();                       // gl-matrix, coluna-maior
const apply = (m, x, y, z) => [m[0]*x + m[4]*y + m[8]*z + m[12], m[1]*x + m[5]*y + m[9]*z + m[13], m[2]*x + m[6]*y + m[10]*z + m[14]];
const prim = mesh.listPrimitives()[0];
const pos = prim.getAttribute('POSITION'), nor = prim.getAttribute('NORMAL');
const n = pos.getCount();
const P = [], v = [0,0,0];
let mn = [1e9,1e9,1e9], mx = [-1e9,-1e9,-1e9];
for (let i = 0; i < n; i++) { pos.getElement(i, v); const w = apply(M, ...v); P.push(w); for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], w[k]); mx[k] = Math.max(mx[k], w[k]); } }
console.log('mundo', mn.map(x=>+x.toFixed(2)), mx.map(x=>+x.toFixed(2)));
const size = mx.map((x, k) => x - mn[k]);
const longX = size[0] > size[2];                       // eixo comprido → vira Z
const L = longX ? size[0] : size[2], W = longX ? size[2] : size[0], H = size[1];
const TL = 1.9, TW = 0.74, TH = 0.30;                  // tamanho final (m): comprimento, largura, altura
const sx = TW / W, sy = TH / H, sz = TL / L;
const cx = (mn[0] + mx[0]) / 2, cz = (mn[2] + mx[2]) / 2;
const out = P.map(([x, y, z]) => {
  const dx = x - cx, dz = z - cz;
  const lx = longX ? dz : dx, lz = longX ? dx : dz;    // gira 90° se o corpo estava ao longo de X
  return [lx * sx, (y - mn[1]) * sy, lz * sz * (longX ? -1 : 1)];
});
for (let i = 0; i < n; i++) pos.setElement(i, out[i]);
// normais: refaz por transformação inversa-transposta aproximada (escala não uniforme)
for (let i = 0; i < n; i++) {
  nor.getElement(i, v);
  let [nx, ny, nz] = apply([M[0],M[1],M[2],0, M[4],M[5],M[6],0, M[8],M[9],M[10],0, 0,0,0,1], ...v);
  [nx, ny, nz] = longX ? [nz, ny, -nx] : [nx, ny, nz];
  const k = [nx / sx, ny / sy, nz / sz]; const l = Math.hypot(...k) || 1;
  nor.setElement(i, [k[0]/l, k[1]/l, k[2]/l]);
}
node.setTranslation([0,0,0]); node.setRotation([0,0,0,1]); node.setScale([1,1,1]);
await io.write('public/models/hospital/covered_body.glb', doc);
console.log('ok', { L, W, H, sx, sy, sz, longX });
