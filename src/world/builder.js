import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

const Y = new THREE.Vector3(0, 1, 0);
const BAKED_LIGHTS = (() => {
  const out = [{ x: 0, y: 8.2, z: -0.5, power: 0.42, tint: [1, 0.91, 0.76] }];
  for (const x of [-11.55, 11.55]) for (const z of [-9, -3, 3, 9])
    out.push({ x, y: 3.35, z, power: 0.28, tint: [1, 0.82, 0.61] });
  for (const x of [-3.5, 3.5]) out.push({ x, y: 3.35, z: 13.5, power: 0.24, tint: [1, 0.82, 0.61] });
  for (const x of [-6.4, 6.4]) out.push({ x, y: 2.2, z: -5.5, power: 0.2, tint: [1, 0.84, 0.67] });
  return out;
})();

// UV em escala de mundo: a textura mantém a mesma densidade de pixels em qualquer
// caixa, independente do tamanho dela (essencial para o look PS1 consistente).
function worldUV(geo, tile) {
  const p = geo.attributes.position, n = geo.attributes.normal, uv = geo.attributes.uv;
  for (let i = 0; i < p.count; i++) {
    const ax = Math.abs(n.getX(i)), ay = Math.abs(n.getY(i)), az = Math.abs(n.getZ(i));
    let u, v;
    if (ay >= ax && ay >= az) { u = p.getX(i); v = p.getZ(i); }
    else if (ax >= az) { u = p.getZ(i); v = p.getY(i); }
    else { u = p.getX(i); v = p.getY(i); }
    uv.setXY(i, u / tile, v / tile);
  }
  uv.needsUpdate = true;
}

// Atlas vertical: U percorre o comprimento da parede, V sobe o eixo Y (lambri embaixo, pedra em cima).
function wallUV(geo, tile, vHeight, v0 = 0) {
  const p = geo.attributes.position, n = geo.attributes.normal, uv = geo.attributes.uv;
  for (let i = 0; i < p.count; i++) {
    const ax = Math.abs(n.getX(i)), az = Math.abs(n.getZ(i));
    const u = ax >= az ? p.getZ(i) : p.getX(i);
    const v = v0 + (p.getY(i) / vHeight) * (1 - v0);
    uv.setXY(i, u / tile, v);
  }
  uv.needsUpdate = true;
}

function applyUV(geo, mat) {
  const mode = mat.userData.uv || 'world';
  if (mode === 'keep') return;
  if (mode === 'wall') {
    wallUV(geo, mat.userData.tile || 4, mat.userData.vHeight || 3.2, mat.userData.v0 || 0);
    return;
  }
  worldUV(geo, mat.userData.tile || 2);
}

function bakeLightAndOcclusion(geo) {
  const p = geo.attributes.position, n = geo.attributes.normal;
  const colors = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const nx = n.getX(i), ny = n.getY(i), nz = n.getZ(i);
    const wallZ = z < 0 ? 16 + z : 14 - z;
    const wallGap = Math.max(0, Math.min(12 - Math.abs(x), wallZ));
    const contact = 0.15 * Math.exp(-Math.max(0, y) / 0.7)
      + 0.11 * Math.exp(-wallGap / 0.38)
      + 0.07 * Math.exp(-Math.max(0, 9.2 - y) / 0.4);
    let cr = 0.83 - contact, cg = 0.83 - contact, cb = 0.83 - contact;
    for (const light of BAKED_LIGHTS) {
      const dx = light.x - x, dy = light.y - y, dz = light.z - z;
      const d2 = dx * dx + dy * dy + dz * dz;
      const inv = 1 / Math.sqrt(Math.max(d2, 0.0001));
      const diffuse = Math.max(0, nx * dx * inv + ny * dy * inv + nz * dz * inv);
      const energy = light.power * diffuse / (1 + d2 * 0.055);
      cr += energy * light.tint[0]; cg += energy * light.tint[1]; cb += energy * light.tint[2];
    }
    const j = i * 3;
    colors[j] = THREE.MathUtils.clamp(cr, 0.48, 1.1);
    colors[j + 1] = THREE.MathUtils.clamp(cg, 0.46, 1.06);
    colors[j + 2] = THREE.MathUtils.clamp(cb, 0.44, 1.02);
  }
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
}

/**
 * Acumula caixas/cilindros/etc. e, no finish(), funde tudo em 1 mesh por material.
 * Antes: centenas de meshes soltos. Agora: ~25 draw calls para o saguão inteiro.
 *
 * Opções por peça: { cam:false } = a câmera ignora a peça na colisão (decoração fina),
 *                  { cast:false } = não projeta sombra, { rx, ry, rz } = rotação.
 */
export class Builder {
  constructor() {
    this.base = new THREE.Matrix4();
    this.stack = [];
    this.buckets = new Map();
  }

  // Sistema de coordenadas local (ex.: "plano da parede") para repetir decoração em 4 paredes.
  push(x = 0, y = 0, z = 0, ry = 0) {
    this.stack.push(this.base.clone());
    const m = new THREE.Matrix4().compose(
      new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromAxisAngle(Y, ry), new THREE.Vector3(1, 1, 1));
    this.base.multiply(m);
  }
  pop() { this.base = this.stack.pop(); }
  world(x, y, z) { return new THREE.Vector3(x, y, z).applyMatrix4(this.base); }

  geo(g, mat, x = 0, y = 0, z = 0, o = {}) {
    const { rx = 0, ry = 0, rz = 0, cam = true, cast = true } = o;
    // Normalize mixed indexed and non-indexed primitives before merging by material.
    if (g.index) {
      const nonIndexed = g.toNonIndexed();
      g.dispose();
      g = nonIndexed;
    }
    const local = new THREE.Matrix4().compose(
      new THREE.Vector3(x, y, z),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)),
      new THREE.Vector3(1, 1, 1));
    g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(this.base, local));
    applyUV(g, mat);
    const bake = mat.userData.bake !== false;
    if (bake) bakeLightAndOcclusion(g);
    const key = `${mat.uuid}|${cam ? 1 : 0}|${cast ? 1 : 0}|${bake ? 1 : 0}`;
    let bk = this.buckets.get(key);
    if (!bk) { bk = { mat, cam, cast, bake, geos: [] }; this.buckets.set(key, bk); }
    bk.geos.push(g);
  }

  box(w, h, d, mat, x, y, z, o) {
    const segments = (v) => Math.max(1, Math.min(24, Math.ceil(v / 1.6)));
    this.geo(new THREE.BoxGeometry(w, h, d, segments(w), segments(h), segments(d)), mat, x, y, z, o);
  }
  cyl(rt, rb, h, mat, x, y, z, seg = 8, o) { this.geo(new THREE.CylinderGeometry(rt, rb, h, seg), mat, x, y, z, o); }
  sph(r, mat, x, y, z, o, ws = 7, hs = 5) { this.geo(new THREE.SphereGeometry(r, ws, hs), mat, x, y, z, o); }

  // Caixa esticada entre dois pontos do plano (z,y) a x constante — corrimãos, tapetes de escada.
  slope(thickW, thickH, z0, y0, z1, y1, mat, x, o) {
    const dz = z1 - z0, dy = y1 - y0, len = Math.hypot(dz, dy);
    this.box(thickW, thickH, len, mat, x, (y0 + y1) / 2, (z0 + z1) / 2, { ...o, rx: Math.atan2(-dy, dz) });
  }

  finish(scene) {
    const occluders = [];
    for (const bk of this.buckets.values()) {
      const g = mergeGeometries(bk.geos, false);
      if (!g) throw new Error('mergeGeometries falhou: atributos incompatíveis');
      const material = bk.mat.clone();
      if (bk.bake) material.vertexColors = true;
      const mesh = new THREE.Mesh(g, material);
      mesh.castShadow = bk.cast;
      mesh.receiveShadow = true;
      scene.add(mesh);
      if (bk.cam) occluders.push(mesh);
      bk.geos.forEach(x => x.dispose());
    }
    return { occluders };
  }
}
