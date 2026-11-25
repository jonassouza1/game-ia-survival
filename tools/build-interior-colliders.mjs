// Gera caixas de colisão (2D) do térreo de um GLB: rasteriza triângulos verticais que cruzam a "altura do corpo".
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { writeFileSync } from 'node:fs';
const [file, out, yLo, yHi, cell, zMin] = [process.argv[2], process.argv[3], +process.argv[4], +process.argv[5], +process.argv[6], +(process.argv[7] ?? -1e9)];
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(file);
const segs = []; let minX = 1e9, maxX = -1e9, minZ = 1e9, maxZ = -1e9;
const tris = [];
for (const node of doc.getRoot().listNodes()) {
  const mesh = node.getMesh(); if (!mesh) continue;
  const M = node.getWorldMatrix();
  const tf = (p) => [M[0]*p[0]+M[4]*p[1]+M[8]*p[2]+M[12], M[1]*p[0]+M[5]*p[1]+M[9]*p[2]+M[13], M[2]*p[0]+M[6]*p[1]+M[10]*p[2]+M[14]];
  for (const prim of mesh.listPrimitives()) {
    if (prim.getMaterial()?.getAlphaMode() === 'BLEND') continue;   // feixes de luz e vidros translúcidos não são paredes
    const pos = prim.getAttribute('POSITION'), idx = prim.getIndices();
    const n = idx ? idx.getCount() : pos.getCount();
    for (let i = 0; i < n; i += 3) {
      const g = (k) => tf(pos.getElement(idx ? idx.getScalar(i + k) : i + k, [0, 0, 0]));
      const a = g(0), b = g(1), c = g(2);
      if (![...a, ...b, ...c].every(Number.isFinite)) continue;
      const lo = Math.min(a[1], b[1], c[1]), hi = Math.max(a[1], b[1], c[1]);
      if (hi < yLo || lo > yHi) continue;
      const ux = b[0]-a[0], uy = b[1]-a[1], uz = b[2]-a[2], vx = c[0]-a[0], vy = c[1]-a[1], vz = c[2]-a[2];
      const nx = uy*vz-uz*vy, ny = uz*vx-ux*vz, nz = ux*vy-uy*vx, l = Math.hypot(nx, ny, nz) || 1;
      if (Math.abs(ny / l) > 0.2) continue;                  // só superfícies verticais
      if (Math.min(hi, yHi) - Math.max(lo, yLo) < (yHi - yLo) * 0.5) continue;   // precisa cobrir boa parte da altura do corpo
      if (Math.min(a[2], b[2], c[2]) < zMin) continue;      // ignora o que está fora do corpo (pórtico)
      if (tris.length === 0) console.log("primeiro tri", JSON.stringify([a, b, c]));
      tris.push([a, b, c]);
      for (const p of [a, b, c]) { minX = Math.min(minX, p[0]); maxX = Math.max(maxX, p[0]); minZ = Math.min(minZ, p[2]); maxZ = Math.max(maxZ, p[2]); }
    }
  }
}
const W = Math.ceil((maxX - minX) / cell) + 2, H = Math.ceil((maxZ - minZ) / cell) + 2;
const grid = new Uint8Array(W * H);
const mark = (x, z) => { const cx = Math.floor((x - minX) / cell) + 1, cz = Math.floor((z - minZ) / cell) + 1; grid[cz * W + cx] = 1; };
for (const [a, b, c] of tris) {
  const len = Math.max(Math.hypot(b[0]-a[0], b[2]-a[2]), Math.hypot(c[0]-b[0], c[2]-b[2]), Math.hypot(a[0]-c[0], a[2]-c[2]));
  const steps = Math.max(2, Math.ceil(len / (cell * 0.5)));
  for (let i = 0; i <= steps; i++) for (let j = 0; j <= steps - i; j++) {
    const u = i / steps, v = j / steps, w = 1 - u - v;
    mark(a[0]*u + b[0]*v + c[0]*w, a[2]*u + b[2]*v + c[2]*w);
  }
}
// funde células em retângulos (corridas por linha, unidas na vertical)
const rects = []; let open = new Map();
for (let z = 0; z <= H; z++) {
  const runs = []; let x = 0;
  while (x < W) { if (z < H && grid[z*W+x]) { let e = x; while (e < W && grid[z*W+e]) e++; runs.push([x, e]); x = e; } else x++; }
  const next = new Map();
  for (const [s, e] of runs) { const k = s + ':' + e; if (open.has(k)) { next.set(k, open.get(k)); open.delete(k); } else next.set(k, { s, e, z0: z }); }
  for (const r of open.values()) rects.push({ ...r, z1: z });
  open = next;
}
// pode filtrar retângulos por região (ex.: batentes/folhas da porta): XMIN,XMAX,ZMAX
const dropBox = process.env.DROP ? process.env.DROP.split(',').map(Number) : null;
const R0 = rects.map(r => [+(minX + (r.s - 1) * cell).toFixed(1), +(minX + (r.e - 1) * cell).toFixed(1), +(minZ + (r.z0 - 1) * cell).toFixed(1), +(minZ + (r.z1 - 1) * cell).toFixed(1)]);
const R = dropBox ? R0.filter(([a, b, c, d]) => !(a >= dropBox[0] && b <= dropBox[1] && d <= dropBox[2])) : R0;
writeFileSync(out, JSON.stringify({ rects: R }));
console.log('triângulos', tris.length, 'retângulos', R.length, 'bounds x', minX.toFixed(0), maxX.toFixed(0), 'z', minZ.toFixed(0), maxZ.toFixed(0));
