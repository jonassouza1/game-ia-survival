// Separa a pistola do coldre de coxa da malha do corpo do SWAT.
//
// O swat.glb (Mixamo) traz a pistola do coldre fundida na malha "Soldier_body":
// ela é só um grupo de triângulos pesado 100% no osso RightUpLeg. Este script:
//
//   1. acha esses triângulos (componentes conexos, soldando vértices por posição);
//   2. remove-os da malha do corpo (compactando os vértices que sobram);
//   3. cria uma malha própria "Soldier_pistol", com os vértices no referencial da
//      PRÓPRIA pistola (origem no centro da coronha, +Z = boca do cano, +Y = massa
//      de mira, +X = lado esquerdo da arma);
//   4. pendura o nó "Soldier_pistol" no osso mixamorig:RightUpLeg, na posição exata
//      em que a pistola já estava (visualmente nada muda com ela no coldre).
//
// Com a pistola como objeto separado, o jogo pode deixá-la no coldre (acompanhando a
// perna de graça, sem cálculo) e levá-la às mãos só durante a mira.
//
// Uso:   node tools/split-holster-pistol.mjs [entrada.glb] [saida.glb]
// O padrão é public/models/character/swat.glb, sobrescrito no lugar. É idempotente:
// se o arquivo já tem o nó "Soldier_pistol", não faz nada.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const input = path.resolve(process.argv[2] || path.join(ROOT, 'public/models/character/swat.glb'));
const output = path.resolve(process.argv[3] || input);

// ── Onde está a pistola no espaço do modelo (T-pose) ────────────────────────────
// Um componente conexo é "pistola" se estiver 100% pesado na coxa direita e o seu
// bounding box couber nesta região. O coldre (que fica) invade a região por baixo e
// pela frente, e as fivelas das tiras ficam mais para dentro da perna.
const BONE = 'mixamorig:RightUpLeg';
const REGION = { min: [-0.23, 0.665, -0.155], max: [-0.17, 0.945, 0.055] };
const EXPECTED_TRIANGLES = 212;

// Referencial da pistola, em coordenadas do modelo:
//   +X_arma = +X_modelo, +Y_arma = +Z_modelo, +Z_arma = -Y_modelo
// (no coldre o cano aponta para baixo e a coronha para trás).
// Origem: centro da coronha.
const ORIGIN = [-0.2024, 0.891, -0.065];
const AXES = [[1, 0, 0], [0, 0, 1], [0, -1, 0]]; // colunas X, Y, Z da arma, no modelo

// ── GLB básico ──────────────────────────────────────────────────────────────────
function readGlb(file) {
  const buf = fs.readFileSync(file);
  if (buf.readUInt32LE(0) !== 0x46546c67) throw new Error('Não é um GLB.');
  const jsonLength = buf.readUInt32LE(12);
  const json = JSON.parse(buf.subarray(20, 20 + jsonLength).toString('utf8'));
  const binOffset = 20 + jsonLength;
  const binLength = buf.readUInt32LE(binOffset);
  const bin = buf.subarray(binOffset + 8, binOffset + 8 + binLength);
  return { json, bin };
}

function writeGlb(file, json, bin) {
  const pad = (b, fill) => {
    const rest = (4 - (b.length % 4)) % 4;
    return rest ? Buffer.concat([b, Buffer.alloc(rest, fill)]) : b;
  };
  const jsonBuf = pad(Buffer.from(JSON.stringify(json), 'utf8'), 0x20);
  const binBuf = pad(bin, 0);
  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546c67, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + 8 + jsonBuf.length + 8 + binBuf.length, 8);
  const chunk = (length, type) => {
    const b = Buffer.alloc(8);
    b.writeUInt32LE(length, 0);
    b.writeUInt32LE(type, 4);
    return b;
  };
  fs.writeFileSync(file, Buffer.concat([
    header, chunk(jsonBuf.length, 0x4e4f534a), jsonBuf, chunk(binBuf.length, 0x004e4942), binBuf,
  ]));
}

const COMPONENT = {
  5120: [Int8Array, 1], 5121: [Uint8Array, 1], 5122: [Int16Array, 2],
  5123: [Uint16Array, 2], 5125: [Uint32Array, 4], 5126: [Float32Array, 4],
};
const TYPE_SIZE = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };

// Lê um accessor como bytes por elemento (suporta byteStride).
function accessorBytes(json, bin, index) {
  const accessor = json.accessors[index];
  const view = json.bufferViews[accessor.bufferView];
  const [, bytes] = COMPONENT[accessor.componentType];
  const itemSize = bytes * TYPE_SIZE[accessor.type];
  const stride = view.byteStride || itemSize;
  const start = (view.byteOffset || 0) + (accessor.byteOffset || 0);
  return { accessor, itemSize, stride, start, count: accessor.count };
}

function readFloats(json, bin, index) {
  const { accessor, itemSize, stride, start, count } = accessorBytes(json, bin, index);
  const comps = TYPE_SIZE[accessor.type];
  const [Type] = COMPONENT[accessor.componentType];
  const out = new Float64Array(count * comps);
  const dv = new DataView(bin.buffer, bin.byteOffset, bin.byteLength);
  for (let i = 0; i < count; i++) {
    for (let c = 0; c < comps; c++) {
      const at = start + i * stride + c * Type.BYTES_PER_ELEMENT;
      let v;
      switch (accessor.componentType) {
        case 5126: v = dv.getFloat32(at, true); break;
        case 5125: v = dv.getUint32(at, true); break;
        case 5123: v = dv.getUint16(at, true); break;
        case 5121: v = dv.getUint8(at); break;
        case 5122: v = dv.getInt16(at, true); break;
        case 5120: v = dv.getInt8(at); break;
        default: throw new Error('componentType não suportado');
      }
      out[i * comps + c] = v;
    }
  }
  return out;
}

// Copia elementos crus (bytes) de um accessor, na ordem dada por "keep".
function gatherRaw(json, bin, index, keep) {
  const { itemSize, stride, start } = accessorBytes(json, bin, index);
  const out = Buffer.alloc(keep.length * itemSize);
  keep.forEach((src, dst) => {
    bin.copy(out, dst * itemSize, start + src * stride, start + src * stride + itemSize);
  });
  return out;
}

// ── Matemática mínima (matrizes 3x3 em array de 9, linhas) ──────────────────────
const quatToMat = ([x, y, z, w]) => [
  1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w),
  2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w),
  2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y),
];
const mul3 = (a, b) => {
  const out = new Array(9).fill(0);
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) for (let k = 0; k < 3; k++) out[r * 3 + c] += a[r * 3 + k] * b[k * 3 + c];
  return out;
};
const transpose3 = (m) => [m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]];
const apply3 = (m, v) => [
  m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
  m[3] * v[0] + m[4] * v[1] + m[5] * v[2],
  m[6] * v[0] + m[7] * v[1] + m[8] * v[2],
];
function matToQuat(m) {
  const trace = m[0] + m[4] + m[8];
  let x; let y; let z; let w;
  if (trace > 0) {
    const s = 0.5 / Math.sqrt(trace + 1);
    w = 0.25 / s; x = (m[7] - m[5]) * s; y = (m[2] - m[6]) * s; z = (m[3] - m[1]) * s;
  } else if (m[0] > m[4] && m[0] > m[8]) {
    const s = 2 * Math.sqrt(1 + m[0] - m[4] - m[8]);
    w = (m[7] - m[5]) / s; x = 0.25 * s; y = (m[1] + m[3]) / s; z = (m[2] + m[6]) / s;
  } else if (m[4] > m[8]) {
    const s = 2 * Math.sqrt(1 + m[4] - m[0] - m[8]);
    w = (m[2] - m[6]) / s; x = (m[1] + m[3]) / s; y = 0.25 * s; z = (m[5] + m[7]) / s;
  } else {
    const s = 2 * Math.sqrt(1 + m[8] - m[0] - m[4]);
    w = (m[3] - m[1]) / s; x = (m[2] + m[6]) / s; y = (m[5] + m[7]) / s; z = 0.25 * s;
  }
  return [x, y, z, w];
}

// Transformação do nó no espaço do modelo (T-pose), subindo a hierarquia de nós.
function worldOf(json, nodeIndex, parents) {
  const chain = [];
  for (let n = nodeIndex; n !== undefined; n = parents.get(n)) chain.unshift(n);
  let rot = [1, 0, 0, 0, 1, 0, 0, 0, 1];
  let pos = [0, 0, 0];
  for (const n of chain) {
    const node = json.nodes[n];
    const r = quatToMat(node.rotation || [0, 0, 0, 1]);
    const s = node.scale || [1, 1, 1];
    if (Math.abs(s[0] - 1) + Math.abs(s[1] - 1) + Math.abs(s[2] - 1) > 1e-6) throw new Error(`Escala no nó ${node.name}`);
    const t = node.translation || [0, 0, 0];
    const moved = apply3(rot, t);
    pos = [pos[0] + moved[0], pos[1] + moved[1], pos[2] + moved[2]];
    rot = mul3(rot, r);
  }
  return { rot, pos };
}

// ── Principal ───────────────────────────────────────────────────────────────────
const { json, bin } = readGlb(input);

if (json.nodes.some((n) => n.name === 'Soldier_pistol')) {
  console.log(`[split-pistol] ${path.relative(ROOT, input)} já tem a pistola separada. Nada a fazer.`);
  process.exit(0);
}

const bodyNodeIndex = json.nodes.findIndex((n) => n.name === 'Soldier_body');
const boneIndex = json.nodes.findIndex((n) => n.name === BONE);
if (bodyNodeIndex < 0 || boneIndex < 0) throw new Error('Esperava os nós Soldier_body e mixamorig:RightUpLeg (este não é o swat.glb do Mixamo).');
const meshIndex = json.nodes[bodyNodeIndex].mesh;
const prim = json.meshes[meshIndex].primitives[0];
const skin = json.skins[json.nodes[bodyNodeIndex].skin];
const boneJoint = skin.joints.indexOf(boneIndex);

const A = prim.attributes;
const pos = readFloats(json, bin, A.POSITION);
const nor = readFloats(json, bin, A.NORMAL);
const uv0 = readFloats(json, bin, A.TEXCOORD_0);
const joints = readFloats(json, bin, A.JOINTS_0);
const weights = readFloats(json, bin, A.WEIGHTS_0);
const idx = readFloats(json, bin, prim.indices);
const vertexCount = pos.length / 3;
const triCount = idx.length / 3;

// Componentes conexos (UV partida duplica vértices, então solda por posição).
const weld = new Map();
const rep = new Int32Array(vertexCount);
for (let v = 0; v < vertexCount; v++) {
  const key = `${Math.round(pos[v * 3] * 1e5)},${Math.round(pos[v * 3 + 1] * 1e5)},${Math.round(pos[v * 3 + 2] * 1e5)}`;
  if (!weld.has(key)) weld.set(key, v);
  rep[v] = weld.get(key);
}
const parent = new Int32Array(vertexCount).map((_, i) => i);
const find = (a) => { while (parent[a] !== a) { parent[a] = parent[parent[a]]; a = parent[a]; } return a; };
for (let t = 0; t < triCount; t++) {
  const a = find(rep[idx[t * 3]]);
  for (let k = 1; k < 3; k++) { const b = find(rep[idx[t * 3 + k]]); if (a !== b) parent[b] = a; }
}
const comps = new Map();
for (let t = 0; t < triCount; t++) {
  const root = find(rep[idx[t * 3]]);
  if (!comps.has(root)) comps.set(root, { tris: [], min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity], thigh: 0, total: 0 });
  const c = comps.get(root);
  c.tris.push(t);
  for (let k = 0; k < 3; k++) {
    const v = idx[t * 3 + k];
    for (let a = 0; a < 3; a++) { c.min[a] = Math.min(c.min[a], pos[v * 3 + a]); c.max[a] = Math.max(c.max[a], pos[v * 3 + a]); }
    for (let j = 0; j < 4; j++) {
      const w = weights[v * 4 + j];
      c.total += w;
      if (joints[v * 4 + j] === boneJoint) c.thigh += w;
    }
  }
}

const pistolTris = [];
for (const c of comps.values()) {
  const inside = c.min.every((m, a) => m >= REGION.min[a]) && c.max.every((m, a) => m <= REGION.max[a]);
  if (inside && c.thigh / c.total > 0.95) pistolTris.push(...c.tris);
}
if (pistolTris.length !== EXPECTED_TRIANGLES) {
  throw new Error(`Esperava ${EXPECTED_TRIANGLES} triângulos de pistola e achei ${pistolTris.length}. O asset mudou? Ajuste REGION.`);
}
const isPistol = new Uint8Array(triCount);
pistolTris.forEach((t) => { isPistol[t] = 1; });

// Vértices de cada lado (ordem estável, remapeando índices).
function compact(triangleFilter) {
  const remap = new Map();
  const keep = [];
  const out = [];
  for (let t = 0; t < triCount; t++) {
    if (triangleFilter(t) === false) continue;
    for (let k = 0; k < 3; k++) {
      const v = idx[t * 3 + k];
      if (!remap.has(v)) { remap.set(v, keep.length); keep.push(v); }
      out.push(remap.get(v));
    }
  }
  return { keep, indices: out };
}
const body = compact((t) => !isPistol[t]);
const gun = compact((t) => !!isPistol[t]);

// ── Pistola no referencial próprio ──────────────────────────────────────────────
const axesMat = [AXES[0][0], AXES[1][0], AXES[2][0], AXES[0][1], AXES[1][1], AXES[2][1], AXES[0][2], AXES[1][2], AXES[2][2]]; // colunas
const toLocal = transpose3(axesMat); // modelo → arma (rotação)
const gunPos = new Float32Array(gun.keep.length * 3);
const gunNor = new Float32Array(gun.keep.length * 3);
const gunUv = new Float32Array(gun.keep.length * 2);
gun.keep.forEach((v, i) => {
  const p = apply3(toLocal, [pos[v * 3] - ORIGIN[0], pos[v * 3 + 1] - ORIGIN[1], pos[v * 3 + 2] - ORIGIN[2]]);
  const n = apply3(toLocal, [nor[v * 3], nor[v * 3 + 1], nor[v * 3 + 2]]);
  gunPos.set(p, i * 3); gunNor.set(n, i * 3);
  gunUv.set([uv0[v * 2], uv0[v * 2 + 1]], i * 2);
});

// ── Reescreve o binário ─────────────────────────────────────────────────────────
// Cada accessor tem o próprio bufferView; os do corpo são sobrescritos (compactados).
const views = json.bufferViews.map((view) => Buffer.from(bin.subarray(view.byteOffset || 0, (view.byteOffset || 0) + view.byteLength)));
const setBodyAttr = (name, accessorIndex) => {
  const accessor = json.accessors[accessorIndex];
  const viewIndex = accessor.bufferView;
  views[viewIndex] = gatherRaw(json, bin, accessorIndex, body.keep);
  const view = json.bufferViews[viewIndex];
  delete view.byteStride;
  accessor.byteOffset = 0;
  accessor.count = body.keep.length;
  if (name === 'POSITION') {
    const min = [Infinity, Infinity, Infinity]; const max = [-Infinity, -Infinity, -Infinity];
    body.keep.forEach((v) => { for (let a = 0; a < 3; a++) { min[a] = Math.min(min[a], pos[v * 3 + a]); max[a] = Math.max(max[a], pos[v * 3 + a]); } });
    accessor.min = min; accessor.max = max;
  }
};
for (const [name, accessorIndex] of Object.entries(A)) setBodyAttr(name, accessorIndex);

const indexAccessor = json.accessors[prim.indices];
const IndexType = body.keep.length > 65535 ? Uint32Array : Uint16Array;
indexAccessor.componentType = IndexType === Uint32Array ? 5125 : 5123;
indexAccessor.count = body.indices.length;
indexAccessor.byteOffset = 0;
views[indexAccessor.bufferView] = Buffer.from(new IndexType(body.indices).buffer);
delete json.bufferViews[indexAccessor.bufferView].byteStride;

const addView = (data, target) => {
  views.push(Buffer.from(data.buffer, data.byteOffset, data.byteLength));
  json.bufferViews.push({ buffer: 0, byteOffset: 0, byteLength: data.byteLength, ...(target ? { target } : {}) });
  return json.bufferViews.length - 1;
};
const addAccessor = (data, componentType, type, count, extra = {}) => {
  json.accessors.push({ bufferView: addView(data, extra.target), componentType, count, type, ...extra.rest });
  return json.accessors.length - 1;
};
const bounds = (arr, comps) => {
  const min = new Array(comps).fill(Infinity); const max = new Array(comps).fill(-Infinity);
  for (let i = 0; i < arr.length; i += comps) for (let c = 0; c < comps; c++) { min[c] = Math.min(min[c], arr[i + c]); max[c] = Math.max(max[c], arr[i + c]); }
  return { min, max };
};
const gunIdx = new Uint16Array(gun.indices);
const gunAttributes = {
  POSITION: addAccessor(gunPos, 5126, 'VEC3', gun.keep.length, { target: 34962, rest: bounds(gunPos, 3) }),
  NORMAL: addAccessor(gunNor, 5126, 'VEC3', gun.keep.length, { target: 34962 }),
  TEXCOORD_0: addAccessor(gunUv, 5126, 'VEC2', gun.keep.length, { target: 34962 }),
};
const gunIndices = addAccessor(gunIdx, 5123, 'SCALAR', gun.indices.length, { target: 34963 });

json.meshes.push({
  name: 'Soldier_pistol',
  primitives: [{ attributes: gunAttributes, indices: gunIndices, material: prim.material, mode: 4 }],
});

// Nó da pistola, filho do osso da coxa, exatamente onde ela já estava.
const thigh = worldOf(json, boneIndex, (() => {
  const map = new Map();
  json.nodes.forEach((n, i) => (n.children || []).forEach((c) => map.set(c, i)));
  return map;
})());
const localRot = mul3(transpose3(thigh.rot), axesMat);
const localPos = apply3(transpose3(thigh.rot), ORIGIN.map((o, i) => o - thigh.pos[i]));
let q = matToQuat(localRot);
const len = Math.hypot(...q);
q = q.map((c) => c / len);
const gunNode = {
  name: 'Soldier_pistol',
  mesh: json.meshes.length - 1,
  translation: localPos,
  rotation: q,
  extras: {
    note: 'Pistola do coldre, extraída de Soldier_body por tools/split-holster-pistol.mjs. +Z = cano, +Y = mira, +X = esquerda.',
  },
};
json.nodes.push(gunNode);
(json.nodes[boneIndex].children ||= []).push(json.nodes.length - 1);

// Reempacota (alinhado a 4 bytes) e atualiza os offsets.
let offset = 0;
const chunks = [];
views.forEach((data, i) => {
  json.bufferViews[i].byteOffset = offset;
  json.bufferViews[i].byteLength = data.length;
  chunks.push(data);
  const padLength = (4 - (data.length % 4)) % 4;
  if (padLength) chunks.push(Buffer.alloc(padLength));
  offset += data.length + padLength;
});
const newBin = Buffer.concat(chunks);
json.buffers[0].byteLength = newBin.length;
json.asset.generator = `${json.asset.generator || 'glTF'} + split-holster-pistol`;

writeGlb(output, json, newBin);
console.log(
  `[split-pistol] ${path.relative(ROOT, output)}: pistola separada (${gun.indices.length / 3} tri, ${gun.keep.length} vértices); `
  + `corpo ficou com ${body.indices.length / 3} tri, ${body.keep.length} vértices.`,
);
