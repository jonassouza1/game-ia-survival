// Separa o "corpo.glb" (naira001, CC-BY 4.0) em dois GLBs prontos para o jogo:
//   body_bag.glb    — saco mortuário amarrado com cintas
//   body_shroud.glb — corpo coberto por mortalha escura
// Tratamento: eixo comprido em Z, ~1,9 m, base em y = 0, centro em x/z = 0, cores levemente clareadas.
// Uso: npm i --no-save @gltf-transform/core @gltf-transform/extensions @gltf-transform/functions
//      node tools/hospital-assets/make-body-bags.mjs <corpo.glb> <pasta-de-saida>
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { prune } from '@gltf-transform/functions';

const [,, src = 'corpo.glb', outDir = 'public/models/hospital'] = process.argv;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const LENGTH = 1.9;                                            // comprimento final em metros
const apply = (m, [x, y, z]) => [m[0]*x + m[4]*y + m[8]*z + m[12], m[1]*x + m[5]*y + m[9]*z + m[13], m[2]*x + m[6]*y + m[10]*z + m[14]];

async function build(name, keepMeshNames, brighten) {
  const doc = await io.read(src);
  const root = doc.getRoot();
  const scene = root.listScenes()[0];
  const nodes = root.listNodes().filter((n) => n.getMesh());
  const keep = nodes.filter((n) => keepMeshNames.includes(n.getMesh().getName()));
  const world = new Map(keep.map((n) => [n, n.getWorldMatrix()]));
  // sobe os nós mantidos para a raiz da cena (a hierarquia original tem rotação/escala do exportador)
  for (const n of keep) { n.getParentNode()?.removeChild(n); scene.addChild(n); }
  for (const c of scene.listChildren()) if (!keep.includes(c)) c.dispose();
  // caixa envolvente no mundo
  const mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9], tmp = [0, 0, 0];
  for (const n of keep) {
    const pos = n.getMesh().listPrimitives()[0].getAttribute('POSITION');
    for (let i = 0; i < pos.getCount(); i++) { pos.getElement(i, tmp); const w = apply(world.get(n), tmp); for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], w[k]); mx[k] = Math.max(mx[k], w[k]); } }
  }
  const size = mx.map((v, k) => v - mn[k]);
  const longX = size[0] > size[2];
  const s = LENGTH / (longX ? size[0] : size[2]);
  const cx = (mn[0] + mx[0]) / 2, cz = (mn[2] + mx[2]) / 2;
  for (const n of keep) {
    const M = world.get(n);
    for (const prim of n.getMesh().listPrimitives()) {
      const pos = prim.getAttribute('POSITION'), nor = prim.getAttribute('NORMAL');
      for (let i = 0; i < pos.getCount(); i++) {
        pos.getElement(i, tmp); let [x, y, z] = apply(M, tmp);
        x -= cx; z -= cz; y -= mn[1];
        if (longX) [x, z] = [z, -x];                           // gira 90° para o comprimento ficar em Z
        pos.setElement(i, [x * s, y * s, z * s]);
        if (nor) {
          nor.getElement(i, tmp);
          let nx = M[0]*tmp[0] + M[4]*tmp[1] + M[8]*tmp[2], ny = M[1]*tmp[0] + M[5]*tmp[1] + M[9]*tmp[2], nz = M[2]*tmp[0] + M[6]*tmp[1] + M[10]*tmp[2];
          if (longX) [nx, nz] = [nz, -nx];
          const l = Math.hypot(nx, ny, nz) || 1; nor.setElement(i, [nx / l, ny / l, nz / l]);
        }
      }
    }
    n.setTranslation([0, 0, 0]); n.setRotation([0, 0, 0, 1]); n.setScale([1, 1, 1]);
  }
  for (const m of root.listMaterials()) {                      // as cores originais são quase pretas: clareia p/ aparecer no escuro
    const c = m.getBaseColorFactor();
    m.setBaseColorFactor([Math.min(1, c[0] * brighten), Math.min(1, c[1] * brighten), Math.min(1, c[2] * brighten), 1]);
    m.setMetallicFactor(0.08); m.setRoughnessFactor(0.62);
  }
  await doc.transform(prune());
  await io.write(`${outDir}/${name}.glb`, doc);
  console.log(name, 'ok', { tamanhoOriginal: size.map((v) => +v.toFixed(1)), escala: +s.toFixed(4), longX });
}
await build('body_bag', ['Object_0', 'Object_2'], 5);
await build('body_shroud', ['Object_1'], 6);
