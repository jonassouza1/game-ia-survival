import * as THREE from 'three';
import { Builder } from './builder.js';
import { createProps } from './props.js';
import { LightPool } from '../render/lightPool.js';
import { pbr, solid, glow } from '../render/pbr.js';
import { CollisionWorld } from '../systems/collision.js';

/**
 * Hospital abandonado (estilo "The Last of Us"): evacuado às pressas, deteriorado, escuro.
 * Mesmo contrato do saguão do RPD: devolve { collisions, occluders, props, update, resetEntrance, spawn }.
 *
 * Planta (metros). Norte = -z. A entrada fica ao sul (+z), de frente para a rua.
 *
 *   z=-26 ┌──────────┬───────┬──────────┐
 *         │ NECROTÉ- │       │   UTI    │
 *   z=-10 ├────  RIO ┤       ├──────────┤
 *         │ ENFER-   │CORRE- │ CIRURGIA │
 *   z= 6  ├──MARIA───┴ DOR ───┴──────────┤
 *         │        SAGUÃO / RECEPÇÃO     │
 *   z=20  └────────────[porta]───────────┘
 */
const HOSP = { x0: -11, x1: 11, z0: -26, z1: 20, h: 3.8 };
// Ao sair, o jogador volta à rua diante do prédio, olhando para longe dele (-z).
const HOSPITAL_STREET_RETURN = { x: 0, y: 0, z: 64.6, yaw: Math.PI };

export function buildHospital(scene) {
  const { x0, x1, z0, z1, h } = HOSP;
  const WT = 0.3;                                   // espessura das paredes

  // Gerador pseudoaleatório com semente: o hospital é sempre o mesmo.
  let seed = 20240611;
  const rnd = () => {
    seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const between = (a, c) => a + rnd() * (c - a);

  // ───────────────────────── Materiais ─────────────────────────
  // A "iluminação assada" do Builder é específica do saguão do RPD; aqui a luz é toda dinâmica.
  const mk = (m) => { m.userData.bake = false; return m; };
  const signMaterial = (draw, w = 512, hgt = 128, extra = {}) => {
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = hgt;
    draw(canvas.getContext('2d'), w, hgt);
    const map = new THREE.CanvasTexture(canvas);
    map.colorSpace = THREE.SRGBColorSpace;
    map.anisotropy = 4;
    const m = solid({ map, color: 0xffffff, roughness: 0.8, ...extra });
    m.userData.uv = 'keep';
    return mk(m);
  };
  const M = {
    floor: mk(pbr('large_grey_tiles', { tile: 3.2, color: 0x8a8f88, roughness: 0.55, normalScale: 0.5, aoIntensity: 0.5 })),
    floorDark: mk(pbr('large_grey_tiles', { tile: 3.2, color: 0x4f5249, roughness: 0.5, normalScale: 0.6, aoIntensity: 0.6 })),
    wall: mk(pbr('painted_plaster_wall', { tile: 3.4, color: 0x7f9282, roughness: 1, normalScale: 0.6 })),
    wallLo: mk(pbr('painted_plaster_wall', { tile: 3, color: 0x3f4b44, roughness: 0.95, normalScale: 0.7 })),
    worn: mk(pbr('worn_plaster_wall', { tile: 3, color: 0x6c6656, roughness: 1, normalScale: 0.9 })),
    ceil: mk(pbr('white_plaster_02', { tile: 2.5, color: 0x77766c, roughness: 1, normalScale: 0.6 })),
    metal: mk(pbr('metal_plate_02', { tile: 2, color: 0x8e9594, roughness: 0.6, normalScale: 0.8 })),
    rust: mk(pbr('rusty_metal', { tile: 1.5, color: 0x93674a, roughness: 0.9, normalScale: 0.9 })),
    wood: mk(pbr('dark_wooden_planks', { tile: 2, color: 0x6e5d4c, roughness: 0.9, normalScale: 0.9 })),
    concrete: mk(pbr('concrete_pavement', { tile: 2, color: 0x7d7b74, roughness: 1, normalScale: 0.8 })),
    seat: mk(pbr('fabric_leather_01', { tile: 1.5, color: 0x4f6a5a, roughness: 0.9, normalScale: 0.7 })),
    sheet: mk(solid({ color: 0xa9a699, roughness: 1 })),
    curtain: mk(solid({ color: 0x5d6d73, roughness: 1 })),
    sheetOld: mk(solid({ color: 0x8b8776, roughness: 1 })),
    mattress: mk(solid({ color: 0x86836f, roughness: 1 })),
    blood: mk(solid({ color: 0x3b0907, roughness: 0.3, metalness: 0.1 })),
    bloodOld: mk(solid({ color: 0x24100d, roughness: 0.85 })),
    dirt: mk(solid({ color: 0x15140f, roughness: 1 })),
    water: mk(solid({ color: 0x040608, roughness: 0.04, metalness: 0.3 })),
    skin: mk(solid({ color: 0x8a9482, roughness: 0.9 })),
    scrubs: mk(solid({ color: 0x35625f, roughness: 1 })),
    coat: mk(solid({ color: 0xb2afa0, roughness: 1 })),
    gown: mk(solid({ color: 0x8d9fa3, roughness: 1 })),
    bag: mk(solid({ color: 0x0b0c0d, roughness: 0.35, metalness: 0.1 })),
    chrome: mk(solid({ color: 0xb2b7b8, roughness: 0.3, metalness: 0.9 })),
    paper: mk(solid({ color: 0xb9b49f, roughness: 1 })),
    plastic: mk(solid({ color: 0x6d7f86, roughness: 0.5 })),
    shard: mk(solid({ color: 0x9db4bd, roughness: 0.1, metalness: 0.2 })),
    dark: mk(solid({ color: 0x050605, roughness: 0.9 })),
    screenOff: mk(solid({ color: 0x0a0c0b, roughness: 0.2, metalness: 0.4 })),
    screenGreen: mk(glow(0x5dff93, 0.9)),
    alarmRed: mk(glow(0xff2a1c, 1.6)),
    slit: mk(glow(0x7f9bba, 0.9)),
    exitGreen: mk(glow(0x38ff7a, 1.5)),
  };
  const signs = {
    emergency: signMaterial((g, w, hg) => {
      g.fillStyle = '#1b2a22'; g.fillRect(0, 0, w, hg);
      g.strokeStyle = '#8fb59b'; g.lineWidth = 5; g.strokeRect(5, 5, w - 10, hg - 10);
      g.fillStyle = '#cfe3d5'; g.font = 'bold 46px sans-serif'; g.textAlign = 'center';
      g.fillText('EMERGÊNCIA', w / 2, 58); g.font = 'bold 30px sans-serif'; g.fillText('UTI ▸  CIRURGIA ▸', w / 2, 104);
    }),
    ward: signMaterial((g, w, hg) => {
      g.fillStyle = '#243229'; g.fillRect(0, 0, w, hg);
      g.fillStyle = '#d4e4d8'; g.font = 'bold 44px sans-serif'; g.textAlign = 'center';
      g.fillText('◂ ENFERMARIA', w / 2, 80);
    }, 384, 128),
    morgue: signMaterial((g, w, hg) => {
      g.fillStyle = '#2a2d2c'; g.fillRect(0, 0, w, hg);
      g.fillStyle = '#d6d2c4'; g.font = 'bold 44px sans-serif'; g.textAlign = 'center';
      g.fillText('NECROTÉRIO ▸', w / 2, 80);
    }, 384, 128),
    icu: signMaterial((g, w, hg) => {
      g.fillStyle = '#2f1d1b'; g.fillRect(0, 0, w, hg);
      g.fillStyle = '#e6c9c2'; g.font = 'bold 44px sans-serif'; g.textAlign = 'center';
      g.fillText('UTI ▸', w / 2, 80);
    }, 384, 128),
    exit: signMaterial((g, w, hg) => {
      g.fillStyle = '#0b3a1c'; g.fillRect(0, 0, w, hg);
      g.fillStyle = '#7dffa5'; g.font = 'bold 40px sans-serif'; g.textAlign = 'center';
      g.fillText('SAÍDA DE EMERGÊNCIA', w / 2, 80);
    }, 512, 128, { emissive: 0x2cff72, emissiveIntensity: 0.55 }),
    // Pichações feitas às pressas, em tinta vermelha escorrida.
    scrawl: (text) => signMaterial((g, w, hg) => {
      g.clearRect(0, 0, w, hg);
      g.fillStyle = 'rgba(0,0,0,0)'; g.fillRect(0, 0, w, hg);
      g.fillStyle = '#7d1209'; g.font = 'bold 74px "Comic Sans MS", cursive, sans-serif'; g.textAlign = 'center';
      g.fillText(text, w / 2, 86);
      for (let i = 0; i < 9; i++) {                                    // escorridos
        const x = 40 + i * (w - 80) / 8 + (i % 3) * 5;
        g.fillRect(x, 86, 3, 14 + ((i * 37) % 36));
      }
    }, 512, 128, { transparent: true, alphaTest: 0.2 }),
  };

  const b = new Builder();
  const col = new CollisionWorld();
  col.addFloor({ minX: x0 + 0.3, maxX: x1 - 0.3, minZ: z0 + 0.3, maxZ: z1 - 0.3, y: 0 });
  const props = [];
  const decor = createProps({ parent: scene, collisions: col, anisotropy: 8 });
  const pool = new LightPool(scene, { count: 8, distance: 12, decay: 2 });
  const D0 = { cam: false };               // decoração: a câmera ignora
  const DN = { cam: false, cast: false };  // sem sombra nem colisão de câmera
  const box = (...a) => b.box(...a);

  // ───────────────────────── Estrutura ─────────────────────────
  // Paredes alinhadas aos eixos, com rodapé escuro e colisão.
  function wall(ax, az, bx, bz, { y0 = 0, y1 = h, mat = M.wall, lo = true, collide = true } = {}) {
    const cx = (ax + bx) / 2, cz = (az + bz) / 2;
    const w = Math.abs(bx - ax) || WT, d = Math.abs(bz - az) || WT;
    box(w, y1 - y0, d, mat, cx, (y0 + y1) / 2, cz);
    if (lo && y0 === 0) box(w + (w > d ? 0.0 : 0.04), 1.05, d + (d > w ? 0.0 : 0.04), M.wallLo, cx, 0.525, cz, D0);
    if (collide && y0 === 0 && y1 > 2) col.addBox(cx, cz, w, d);
  }
  // Pisos e teto
  box(22, 0.2, 14, M.floorDark, 0, -0.1, 13);
  box(22, 0.2, 32, M.floor, 0, -0.1, -10);
  box(22, 0.2, 46, M.ceil, 0, h + 0.1, -3);
  // Perímetro
  wall(x0, z0, x1, z0);                                   // norte
  wall(x0, z0, x0, z1, { mat: M.worn });                  // oeste
  wall(x1, z0, x1, z1, { mat: M.worn });                  // leste
  wall(x0, z1, -1.2, z1);                                 // sul, à esquerda da porta
  wall(1.2, z1, x1, z1);                                  // sul, à direita da porta
  wall(-1.2, z1, 1.2, z1, { y0: 2.6, collide: false });   // verga da porta
  // Divisórias: corredor (x = ±2.5) com vãos para as salas; saguão (z = 6) com a boca do corredor aberta.
  for (const sx of [-2.5, 2.5]) {
    wall(sx, z0, sx, -19);
    wall(sx, -17, sx, -1.6);
    wall(sx, 0.6, sx, 6);
    wall(sx, -19, sx, -17, { y0: 2.4, collide: false });
    wall(sx, -1.6, sx, 0.6, { y0: 2.4, collide: false });
  }
  wall(x0, 6, -2.5, 6);
  wall(2.5, 6, x1, 6);
  wall(x0, -10, -2.5, -10);                               // enfermaria | necrotério
  wall(2.5, -10, x1, -10);                                // cirurgia | UTI
  // Batentes escuros nos vãos
  for (const sx of [-2.5, 2.5]) for (const [za, zb] of [[-19, -17], [-1.6, 0.6]]) {
    box(WT + 0.1, 2.4, 0.1, M.wood, sx, 1.2, za, D0); box(WT + 0.1, 2.4, 0.1, M.wood, sx, 1.2, zb, D0);
  }
  // Pilares do saguão
  for (const px of [-5.2, 5.2]) { box(0.7, h, 0.7, M.concrete, px, h / 2, 12); col.addBox(px, 12, 0.7, 0.7); }

  // ───────────────────────── Peças de decoração ─────────────────────────
  const decal = (x, z, w, d, mat, ry = 0, y = 0) => box(w, 0.006, d, mat, x, y + 0.003, z, { ry, ...DN });
  const wallMark = (x, y, z, w, hh, mat, axis) =>               // axis 'x': na face de uma parede x=cte
    (axis === 'x' ? box(0.012, hh, w, mat, x, y, z, DN) : box(w, hh, 0.012, mat, x, y, z, DN));
  const bloodPool = (x, z, r) => {
    for (let i = 0; i < 4; i++) decal(x + between(-r, r) * 0.4, z + between(-r, r) * 0.4, r * between(0.8, 1.6), r * between(0.7, 1.3), M.blood, rnd() * 3, 0.001 * i);
    decal(x, z, r * 2, r * 1.6, M.bloodOld, rnd() * 3, 0);
  };
  const smear = (x, z, len, ry) => { box(0.22, 0.006, len, M.blood, x, 0.004, z, { ry, ...DN }); };
  const rubble = (x, z, n, spread, big = 0.3) => {
    for (let i = 0; i < n; i++) {
      const s = between(0.05, big);
      box(s * between(0.8, 2), s * 0.6, s * between(0.8, 2), rnd() < 0.5 ? M.concrete : M.worn,
        x + between(-spread, spread), s * 0.3, z + between(-spread, spread), { ry: rnd() * 3, rx: between(-0.2, 0.2), rz: between(-0.2, 0.2), ...D0 });
    }
  };
  const papers = (x, z, n, spread) => {
    for (let i = 0; i < n; i++) box(between(0.18, 0.3), 0.004, between(0.22, 0.32), M.paper, x + between(-spread, spread), 0.003 + i * 0.0004, z + between(-spread, spread), { ry: rnd() * 6, ...DN });
  };

  function corpse(x, z, ry, { cloth = M.scrubs, y0 = 0, sitting = false, bleed = true } = {}) {
    b.push(x, y0, z, ry);
    if (!sitting) {
      box(0.46, 0.2, 0.62, cloth, 0, 0.12, 0, D0);
      box(0.42, 0.18, 0.3, cloth, 0, 0.11, 0.44, D0);
      b.sph(0.12, M.skin, 0, 0.14, -0.44, D0, 7, 5);
      for (const s of [-1, 1]) {
        b.cyl(0.075, 0.065, 0.8, cloth, s * 0.12, 0.08, 0.98, 6, { rx: Math.PI / 2, ry: s * 0.12, ...D0 });
        b.cyl(0.05, 0.045, 0.62, cloth, s * 0.32, 0.07, -0.02, 6, { rx: Math.PI / 2, ry: s * (0.25 + rnd() * 0.4), ...D0 });
        b.sph(0.045, M.skin, s * 0.36, 0.06, 0.28, D0, 5, 4);
      }
    } else {                                              // sentado, encostado na parede (-z local)
      box(0.42, 0.55, 0.26, cloth, 0, 0.62, 0, D0);
      box(0.4, 0.2, 0.3, cloth, 0, 0.3, 0.2, D0);
      b.sph(0.12, M.skin, 0.03, 1.02, 0.02, { ...D0 }, 7, 5);
      for (const s of [-1, 1]) {
        b.cyl(0.075, 0.065, 0.7, cloth, s * 0.12, 0.1, 0.62, 6, { rx: Math.PI / 2, ry: s * 0.15, ...D0 });
        b.cyl(0.05, 0.045, 0.5, cloth, s * 0.27, 0.45, 0.14, 6, { rx: 0.9, ...D0 });
      }
    }
    b.pop();
    if (bleed && y0 === 0) bloodPool(x, z, 0.55);
  }
  // Corpo coberto por lençol (o clássico "evacuaram e deixaram para trás")
  function coveredBody(x, z, ry, y0, { stain = true } = {}) {
    b.push(x, y0, z, ry);
    const g = new THREE.SphereGeometry(1, 8, 6); g.scale(0.27, 0.15, 0.95);
    b.geo(g, M.sheet, 0, 0.12, 0, D0);
    const head = new THREE.SphereGeometry(1, 7, 5); head.scale(0.13, 0.12, 0.14);
    b.geo(head, M.sheet, 0, 0.2, -0.78, D0);
    if (stain) box(0.3, 0.008, 0.4, M.blood, 0.02, 0.26, 0.12, { ry: 0.2, rx: -0.05, ...DN });
    b.pop();
  }
  function bed(x, z, ry, { body = null, broken = false, blood = true } = {}) {
    b.push(x, 0, z, ry);
    box(0.95, 0.07, 2.0, M.metal, 0, 0.55, 0, D0);
    box(0.88, 0.16, 1.92, M.mattress, 0, 0.68, 0, D0);
    box(0.5, 0.1, 0.32, M.sheetOld, 0, 0.8, -0.7, D0);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const ly = broken && sx * sz > 0 ? 0.22 : 0.27;
      b.cyl(0.03, 0.03, ly * 2, M.chrome, sx * 0.43, ly, sz * 0.92, 6, D0);
      b.sph(0.045, M.dark, sx * 0.43, 0.04, sz * 0.92, D0, 5, 4);
    }
    box(0.95, 0.6, 0.06, M.metal, 0, 0.9, -1.0, D0);
    box(0.95, 0.45, 0.06, M.metal, 0, 0.82, 1.0, D0);
    box(0.04, 0.25, 1.4, M.chrome, -0.47, 0.88, 0.05, D0);
    if (!broken) box(0.04, 0.25, 1.4, M.chrome, 0.47, 0.88, 0.05, D0);
    if (blood) box(0.5, 0.012, 0.7, M.blood, 0.05, 0.765, 0.2, { ry: 0.3, ...DN });
    if (body === 'covered') coveredBody(0, 0, 0, 0.78);
    b.pop();
    if (body === 'dead') corpse(x, z, ry, { cloth: M.gown, y0: 0.78, bleed: false });
    col.addBox(x, z, Math.abs(Math.cos(ry)) * 0.95 + Math.abs(Math.sin(ry)) * 2.05, Math.abs(Math.cos(ry)) * 2.05 + Math.abs(Math.sin(ry)) * 0.95, { y0: 0, y1: 0.95 });
  }
  function gurney(x, z, ry, { covered = true } = {}) {
    b.push(x, 0, z, ry);
    box(0.7, 0.06, 1.9, M.chrome, 0, 0.82, 0, D0);
    box(0.64, 0.1, 1.84, M.mattress, 0, 0.9, 0, D0);
    box(0.5, 0.05, 1.5, M.metal, 0, 0.45, 0, D0);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      b.cyl(0.025, 0.025, 0.8, M.chrome, sx * 0.28, 0.42, sz * 0.8, 5, D0);
      b.cyl(0.07, 0.07, 0.05, M.dark, sx * 0.28, 0.07, sz * 0.8, 8, { rx: Math.PI / 2, ...D0 });
    }
    if (covered) coveredBody(0, 0, 0, 0.95);
    b.pop();
    col.addBox(x, z, Math.abs(Math.cos(ry)) * 0.75 + Math.abs(Math.sin(ry)) * 1.95, Math.abs(Math.cos(ry)) * 1.95 + Math.abs(Math.sin(ry)) * 0.75, { y0: 0, y1: 1.0 });
  }
  function ivStand(x, z, { fallen = false } = {}) {
    if (fallen) {
      b.push(x, 0, z, rnd() * 6);
      b.cyl(0.015, 0.015, 1.8, M.chrome, 0, 0.03, 0, 5, { rz: Math.PI / 2, ...DN });
      for (let i = 0; i < 5; i++) box(0.3, 0.02, 0.03, M.chrome, 0.9, 0.03, 0, { ry: i * 1.256, ...DN });
      box(0.1, 0.02, 0.16, M.plastic, -0.6, 0.03, 0.05, DN);
      b.pop();
      return;
    }
    b.push(x, 0, z, rnd() * 6);
    b.cyl(0.015, 0.015, 1.85, M.chrome, 0, 0.92, 0, 5, D0);
    for (let i = 0; i < 5; i++) box(0.34, 0.025, 0.035, M.chrome, 0, 0.03, 0, { ry: i * 1.256, ...D0 });
    box(0.2, 0.014, 0.014, M.chrome, 0.08, 1.84, 0, D0);
    box(0.09, 0.2, 0.025, M.plastic, 0.14, 1.72, 0, D0);
    b.pop();
  }
  function wheelchair(x, z, ry) {
    b.push(x, 0, z, ry);
    box(0.44, 0.06, 0.44, M.dark, 0, 0.48, 0, D0);
    box(0.44, 0.5, 0.05, M.dark, 0, 0.74, -0.2, D0);
    for (const s of [-1, 1]) {
      b.cyl(0.3, 0.3, 0.04, M.chrome, s * 0.27, 0.3, -0.05, 12, { rz: Math.PI / 2, ...D0 });
      b.cyl(0.08, 0.08, 0.03, M.dark, s * 0.24, 0.08, 0.32, 8, { rz: Math.PI / 2, ...D0 });
      box(0.04, 0.04, 0.4, M.chrome, s * 0.22, 0.62, 0, D0);
    }
    b.pop();
    col.addBox(x, z, 0.75, 0.75, { y0: 0, y1: 0.9 });
  }
  function cart(x, z, ry, { fallen = false } = {}) {
    b.push(x, 0, z, ry);
    if (fallen) {
      box(0.8, 0.5, 0.5, M.metal, 0, 0.25, 0, { rz: 1.4, ry: 0.4, ...D0 });
      box(0.3, 0.05, 0.4, M.chrome, 0.5, 0.03, 0.1, { ry: 0.9, ...DN });
      b.pop(); col.addBox(x, z, 0.9, 0.9, { y0: 0, y1: 0.6 }); return;
    }
    box(0.8, 0.8, 0.5, M.metal, 0, 0.5, 0, D0);
    for (let i = 0; i < 3; i++) box(0.76, 0.02, 0.02, M.dark, 0, 0.3 + i * 0.22, 0.26, D0);
    box(0.5, 0.05, 0.3, M.chrome, -0.1, 0.92, 0, D0);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.cyl(0.04, 0.04, 0.05, M.dark, sx * 0.34, 0.06, sz * 0.2, 6, D0);
    b.pop();
    col.addBox(x, z, 0.85, 0.85, { y0: 0, y1: 1.0 });
  }
  function chair(x, z, ry, fallen) {
    b.push(x, 0, z, ry);
    if (fallen) {
      box(0.45, 0.05, 0.45, M.seat, 0, 0.23, 0, { rz: Math.PI / 2, rx: 0.1, ...D0 });
      box(0.05, 0.45, 0.45, M.seat, 0.22, 0.05, 0, { rz: Math.PI / 2, ...D0 });
      b.cyl(0.02, 0.02, 0.45, M.chrome, -0.2, 0.25, 0.2, 5, { rz: 1.3, ...D0 });
    } else {
      box(0.46, 0.06, 0.46, M.seat, 0, 0.45, 0, D0);
      box(0.46, 0.45, 0.05, M.seat, 0, 0.7, -0.21, D0);
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.cyl(0.02, 0.02, 0.45, M.chrome, sx * 0.2, 0.22, sz * 0.2, 5, D0);
    }
    b.pop();
    if (!fallen) col.addBox(x, z, 0.5, 0.5, { y0: 0, y1: 0.9 });
  }
  function shelf(x, z, ry, { fallen = false } = {}) {
    b.push(x, 0, z, ry);
    if (fallen) {
      box(1.2, 0.4, 2.0, M.metal, 0, 0.2, 0, { rz: 0.12, ...D0 });
      for (let i = 0; i < 4; i++) box(1.1, 0.03, 0.4, M.chrome, 0, 0.1 + i * 0.07, -0.6 + i * 0.4, { ry: 0.1 * i, ...DN });
    } else {
      box(1.2, 2.0, 0.45, M.metal, 0, 1.0, 0, D0);
      for (let i = 0; i < 4; i++) box(1.1, 0.03, 0.4, M.dark, 0, 0.4 + i * 0.45, 0.02, D0);
      for (let i = 0; i < 6; i++) box(between(0.06, 0.14), between(0.08, 0.2), 0.08, rnd() < 0.5 ? M.plastic : M.paper, between(-0.5, 0.5), 0.46 + Math.floor(rnd() * 4) * 0.45, 0.02, D0);
    }
    b.pop();
    col.addBox(x, z, Math.abs(Math.cos(ry)) * 1.2 + Math.abs(Math.sin(ry)) * 0.5, Math.abs(Math.cos(ry)) * 0.5 + Math.abs(Math.sin(ry)) * 1.2, { y0: 0, y1: fallen ? 0.5 : 2.0 });
  }
  function boardedWindow(x, z, side) {            // side: +1 = parede leste (face interna em x-0.15)
    const fx = x - side * 0.17;
    b.push(fx, 0, z, side > 0 ? -Math.PI / 2 : Math.PI / 2);
    box(1.7, 1.5, 0.08, M.dark, 0, 1.95, 0.05, D0);
    box(1.55, 1.35, 0.02, M.slit, 0, 1.95, 0.1, DN);
    for (let i = 0; i < 5; i++) box(1.9, 0.16, 0.05, M.wood, between(-0.03, 0.03), 1.4 + i * 0.28, 0.16, { rz: between(-0.05, 0.05), ...D0 });
    b.pop();
  }
  function hang(x, z, len, tilt) {                // fios soltos do forro
    b.cyl(0.012, 0.012, len, M.dark, x, h - len / 2, z, 4, { rx: tilt, rz: between(-0.2, 0.2), ...DN });
  }
  function ceilingHole(x, z, w, d) {              // forro caído: placas penduradas e escombro no chão
    box(w, 0.04, d, M.dark, x, h - 0.02, z, DN);
    for (let i = 0; i < 3; i++) box(between(0.5, 0.9), 0.03, between(0.4, 0.6), M.ceil, x + between(-w / 2, w / 2), h - between(0.2, 0.6), z + between(-d / 2, d / 2), { rx: between(-0.8, 0.8), rz: between(-0.8, 0.8), ...DN });
    rubble(x, z, 10, Math.max(w, d) * 0.6, 0.25);
    hang(x - w * 0.3, z, between(0.5, 1.1), 0.2); hang(x + w * 0.25, z + d * 0.2, between(0.4, 0.9), -0.15);
  }

  // ───────────────────────── Luzes ─────────────────────────
  const tubes = [];
  const hemi = new THREE.HemisphereLight(0x3d5249, 0x0d0f0e, 0.2);
  scene.add(hemi);
  function fluorescent(x, z, { color = 0xcfe6dc, intensity = 14, base = 1, dead = false, ry = 0, red = false, distance = 12 } = {}) {
    const m = red ? glow(0xff2a1c, 1.4) : glow(0xdff2ea, 1.6);
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.05, 0.16), dead ? M.screenOff : m);
    mesh.position.set(x, h - 0.06, z); mesh.rotation.y = ry;
    scene.add(mesh);
    box(1.3, 0.04, 0.24, M.dark, x, h - 0.03, z, { ry, ...DN });
    intensity *= 1.4;
    const fixture = dead ? null : pool.add({ position: new THREE.Vector3(x, h - 0.5, z), color, intensity, distance: distance + 2, decay: 2 });
    if (!dead) tubes.push({ mesh, fixture, base: intensity * base, glow: red ? 1.4 : 1.6, seed: rnd() * 100, rate: red ? 2.2 : between(0.6, 1.6), red });
  }
  // Saguão
  fluorescent(0, 14, { intensity: 15 }); fluorescent(-6.5, 10, { dead: true }); fluorescent(6.5, 10, { intensity: 11 });
  fluorescent(-6.5, 17, { intensity: 10 }); fluorescent(6.5, 17, { dead: true });
  // Corredor
  fluorescent(0, 2, { intensity: 14, ry: Math.PI / 2 }); fluorescent(0, -7, { intensity: 12, ry: Math.PI / 2 });
  fluorescent(0, -15, { intensity: 14, ry: Math.PI / 2, dead: false }); fluorescent(0, -22, { red: true, color: 0xff2a1c, intensity: 12, ry: Math.PI / 2 });
  // Salas
  fluorescent(-7, -2, { intensity: 13 }); fluorescent(7, -2, { intensity: 15 });
  fluorescent(-7, -18, { color: 0x9fd9b8, intensity: 12 }); fluorescent(7, -18, { red: true, color: 0xff2a1c, intensity: 13 });
  fluorescent(-7, -14, { dead: true }); fluorescent(7, -6, { dead: true });

  // ───────────────────────── Saguão / recepção ─────────────────────────
  // Balcão da recepção encostado na parede oeste
  box(1.0, 1.1, 6.2, M.wood, -9.6, 0.55, 14.5, D0); box(1.25, 0.08, 6.4, M.metal, -9.55, 1.12, 14.5, D0);
  col.addBox(-9.6, 14.5, 1.2, 6.4, { y0: 0, y1: 1.2 });
  for (const mz of [12.6, 15.4]) { box(0.5, 0.36, 0.06, M.screenOff, -9.5, 1.35, mz, { ry: 0.3, rz: 0.1, ...D0 }); box(0.2, 0.18, 0.1, M.dark, -9.5, 1.2, mz, D0); }
  papers(-9.4, 14.5, 14, 0.5); papers(-8.2, 13.5, 10, 1.4);
  box(0.4, 1.6, 4.5, M.wood, -10.7, 0.8, 14.5, D0);
  for (let i = 0; i < 5; i++) box(0.38, 0.03, 4.4, M.dark, -10.7, 0.4 + i * 0.35, 14.5, D0);
  // Área de espera (leste): cadeiras tombadas
  for (let i = 0; i < 6; i++) chair(8.4 + between(-0.4, 0.4), 8.5 + i * 1.5, Math.PI / 2 + between(-0.3, 0.3), i % 3 === 1);
  for (const [cx, cz] of [[6.6, 9.4], [7.3, 14.6]]) chair(cx, cz, between(0, 6), true);
  // Barricada improvisada ao lado da porta (leste), feita às pressas
  box(1.5, 0.8, 0.7, M.wood, 3.8, 0.4, 18.9, { ry: 0.15, ...D0 }); col.addBox(3.8, 18.9, 1.6, 0.9);
  box(2.2, 0.06, 0.9, M.wood, 4.6, 1.0, 18.4, { rz: -0.3, ry: 0.4, ...D0 });
  shelf(5.6, 18.5, 0.5, { fallen: true }); col.addBox(5.6, 18.5, 1.6, 1.5, { y0: 0, y1: 0.6 });
  for (let i = 0; i < 4; i++) box(0.06, 1.4, 0.18, M.wood, 2.4 + i * 0.3, 0.7, 19.4, { rz: between(-0.5, 0.5), ...D0 });
  // Corpos, sangue e bagunça
  corpse(-2.4, 17.6, 0.6, { cloth: M.coat });                         // junto da porta
  corpse(7.6, 6.9, 2.4, { cloth: M.scrubs, sitting: true });          // encostado na parede, boca do corredor
  gurney(-5.0, 9.2, 0.4);
  coveredBody(9.2, 12.8, 1.5, 0);
  bloodPool(9.2, 12.8, 0.7);
  for (let i = 0; i < 7; i++) smear(-0.2 + Math.sin(i) * 0.4, 16.5 - i * 1.4, 1.2, 0.1 * i);   // rastro até o corredor
  papers(0, 12, 26, 5); papers(-6, 9, 12, 2);
  rubble(4.2, 9.5, 24, 1.8); ceilingHole(4.2, 9.5, 2.6, 2.2);
  rubble(-6.8, 13.2, 10, 1.2);
  cart(-5.8, 12.5, 0.5, { fallen: true }); ivStand(-3.6, 8.2, { fallen: true }); ivStand(2.9, 16.4);
  decal(-1.2, 12.6, 2.4, 1.8, M.water, 0.3); decal(5.8, 15.6, 1.6, 1.2, M.water, 1.0);
  decal(0, 13, 8, 6, M.dirt, 0.4);
  // Janelas tapadas com tábuas (frestas de luz da tempestade)
  for (const wz of [9, 16.5]) { boardedWindow(x1, wz, 1); boardedWindow(x0 + 0.3, wz, -1); }
  // Placas e pichações
  box(4.2, 0.9, 0.06, signs.emergency, 0, 3.1, 6.05, { ...DN, ry: 0 });
  box(2.4, 0.6, 0.04, signs.scrawl('NÃO ENTRE'), 7.0, 2.1, 6.2, DN);
  box(2.4, 0.6, 0.04, signs.scrawl('ELES VOLTAM'), -7.3, 2.4, 6.2, DN);
  wallMark(x1 - 0.16, 1.4, 6.0, 1.5, 1.2, M.bloodOld, 'x');
  for (let i = 0; i < 5; i++) box(0.12, 0.2, 0.012, M.blood, -3.0 + i * 0.16, 1.5 + (i % 2) * 0.1, 6.17, DN);   // mãos ensanguentadas na parede

  // ───────────────────────── Corredor ─────────────────────────
  gurney(-1.7, -3.0, 1.62, { covered: true });
  gurney(1.6, -12.5, 1.5, { covered: false });
  wheelchair(0.4, -6.2, 0.7); wheelchair(-1.3, 3.6, 2.5);
  ivStand(1.7, -1.0); ivStand(-1.9, -9.0, { fallen: true });
  cart(1.8, 3.7, 0.2);
  corpse(0.6, -9.4, 0.15, { cloth: M.coat });
  corpse(-1.1, -14.2, 1.3, { cloth: M.gown });
  for (let i = 0; i < 10; i++) smear(between(-0.6, 0.6), 3 - i * 2.3, 1.6, between(-0.15, 0.15));
  papers(0, -4, 30, 1.8); papers(0, -16, 24, 1.8); rubble(0, -6, 14, 1.4);
  ceilingHole(-0.4, -4.8, 2.0, 1.8); ceilingHole(0.5, -19.5, 1.6, 1.6);
  decal(0, -9.6, 2.2, 3.0, M.water, 0.1); decal(-0.5, -1.2, 1.4, 1.8, M.dirt, 0.4);
  box(2.6, 0.7, 0.05, signs.ward, -2.2, 2.9, 0.5, { ry: Math.PI / 2, ...DN });
  box(2.6, 0.7, 0.05, signs.icu, 2.2, 2.9, 0.5, { ry: -Math.PI / 2, ...DN });
  box(2.6, 0.7, 0.05, signs.morgue, -2.2, 2.9, -18, { ry: Math.PI / 2, ...DN });
  box(2.6, 0.7, 0.05, signs.icu, 2.2, 2.9, -18, { ry: -Math.PI / 2, ...DN });
  box(2.6, 0.7, 0.04, signs.scrawl('SEM SAÍDA'), 0, 2.3, -9.8, DN);
  for (const sx of [-1, 1]) for (let i = 0; i < 4; i++) box(0.012, 0.22, 0.14, M.blood, sx * 2.33, 1.3 + i * 0.08, -8 - i * 0.25, DN);
  // Saída de emergência no fim do corredor, acorrentada
  box(2.0, 2.4, 0.12, M.metal, 0, 1.2, z0 + 0.2, D0);
  box(0.06, 2.3, 0.14, M.dark, 0, 1.2, z0 + 0.28, D0);
  b.cyl(0.025, 0.025, 2.4, M.chrome, 0, 1.15, z0 + 0.4, 6, { rz: Math.PI / 2, ...D0 });
  b.cyl(0.025, 0.025, 2.4, M.chrome, 0, 0.8, z0 + 0.42, 6, { rz: Math.PI / 2, rx: 0.05, ...D0 });
  box(1.4, 0.4, 0.05, signs.exit, 0, 2.7, z0 + 0.3, DN);
  box(1.3, 0.04, 0.5, M.screenOff, 0, 0.02, z0 + 0.9, DN);
  decal(0, z0 + 1.0, 1.4, 0.9, M.bloodOld, 0.2);
  box(0.03, 1.9, 0.03, M.dark, -0.9, 1.0, z0 + 0.3, DN);
  for (let i = 0; i < 8; i++) box(0.05, 0.3, 0.012, M.blood, -0.5 + i * 0.14, 1.2 + (i % 3) * 0.1, z0 + 0.27, DN);   // marcas de arranhão

  // ───────────────────────── Enfermaria (oeste) ─────────────────────────
  bed(-9.5, 3.6, 0, { body: 'dead' }); bed(-9.5, 0.2, 0, { blood: true });
  bed(-9.5, -3.6, 0.1, { body: 'covered' }); bed(-6.6, -6.4, Math.PI / 2, { broken: true });
  bed(-4.2, 4.2, 1.3, { broken: true });
  for (const sz of [1.9, -1.8]) { box(0.45, 0.7, 0.45, M.metal, -10.3, 0.35, sz, D0); col.addBox(-10.3, sz, 0.5, 0.5, { y0: 0, y1: 0.7 }); }
  ivStand(-8.5, 2.0); ivStand(-8.4, -4.4, { fallen: true }); ivStand(-8.5, -1.8);
  cart(-5.4, 1.0, 1.2); cart(-4.4, -3.0, 0.4, { fallen: true });
  // Cortinas rasgadas separando os leitos
  for (const cz of [1.9, -1.8]) for (let i = 0; i < 5; i++) {
    const len = between(1.7, 2.9);                         // tiras rasgadas penduradas do trilho, não chegam ao chão
    box(0.03, len, 0.3, M.curtain, -8.6, h - len / 2, cz + (i - 2) * 0.32, { rz: between(-0.06, 0.06), rx: between(-0.05, 0.05), ...DN });
  }
  box(0.05, 0.04, 2.0, M.chrome, -8.6, h - 0.05, 1.9, DN); box(0.05, 0.04, 2.0, M.chrome, -8.6, h - 0.05, -1.8, DN);
  corpse(-5.0, -0.6, 2.2, { cloth: M.scrubs }); corpse(-3.3, 2.5, 0.2, { cloth: M.gown, sitting: true });
  papers(-6, 0, 22, 3); rubble(-6.5, 3.8, 12, 1.5); ceilingHole(-6.8, 3.8, 2.4, 2.0);
  decal(-6.2, -3.4, 2.0, 1.6, M.water, 0.6); decal(-7, 0.5, 5.5, 8, M.dirt, 0.3);
  boardedWindow(x0 + 0.3, 3.0, -1); boardedWindow(x0 + 0.3, -4.0, -1);
  box(2.2, 0.55, 0.04, signs.scrawl('LEITO 4'), -10.82, 2.4, -3.6, { ry: Math.PI / 2, ...DN });
  smear(-9.3, 1.6, 2.2, 1.57);

  // ───────────────────────── Cirurgia (leste) ─────────────────────────
  // Mesa de operação sob o foco cirúrgico caído
  b.push(7, 0, -2, 0.1);
  box(0.85, 0.12, 2.0, M.chrome, 0, 0.9, 0, D0); b.cyl(0.12, 0.2, 0.9, M.chrome, 0, 0.45, 0, 8, D0); box(0.7, 0.05, 0.7, M.dark, 0, 0.03, 0, D0);
  coveredBody(0, 0, 0, 0.98, { stain: true });
  b.pop();
  col.addBox(7, -2, 1.0, 2.1, { y0: 0, y1: 1.0 });
  b.cyl(0.55, 0.55, 0.08, M.chrome, 7.4, 2.0, -1.4, 12, { rx: 0.35, rz: 0.25, ...D0 });          // foco soltando do teto
  b.cyl(0.03, 0.03, 1.7, M.chrome, 7.1, 2.9, -1.6, 5, { rx: 0.2, rz: 0.15, ...DN });
  for (let i = 0; i < 4; i++) box(0.3, 0.02, 0.16, M.chrome, 5.6 + i * 0.1, 0.96 + i * 0.01, 1.2 - i * 0.05, { ry: 0.3 * i, ...DN });   // instrumentos
  box(1.0, 0.8, 0.5, M.metal, 5.4, 0.45, 1.3, D0); col.addBox(5.4, 1.3, 1.1, 0.6, { y0: 0, y1: 0.9 });
  shelf(10.4, -6.5, Math.PI / 2); shelf(10.4, 3.3, Math.PI / 2, { fallen: true });
  box(0.3, 1.2, 1.4, M.metal, 10.7, 1.3, -2.2, D0);                                               // pia
  col.addBox(10.7, -2.2, 0.5, 1.5, { y0: 0, y1: 1.0 }); box(0.04, 0.5, 0.7, M.shard, 10.52, 2.1, -2.2, DN);
  box(0.04, 0.9, 1.1, M.slit, 10.84, 1.9, 0.6, DN);                                                 // negatoscópio
  bloodPool(7, -2, 0.8); papers(7, 0, 24, 3); rubble(4.2, -7.5, 14, 1.4); ceilingHole(8.5, 2.5, 2.2, 1.8);
  corpse(8.8, -5.4, 0.5, { cloth: M.coat }); corpse(4.4, 3.6, 1.9, { cloth: M.scrubs, sitting: true });
  cart(9.2, 0.4, 0.2, { fallen: true }); cart(4.3, -3.2, 0.9); ivStand(5.2, -0.4, { fallen: true });
  decal(6.5, 3.8, 2.4, 1.6, M.water, 0.5); decal(7, -1, 6, 8, M.dirt, 0.6);
  boardedWindow(x1, 4.2, 1); boardedWindow(x1, -4.5, 1);

  // ───────────────────────── Necrotério (noroeste) ─────────────────────────
  // Parede de gavetas refrigeradas: algumas abertas, com lençóis saindo
  for (let r = 0; r < 3; r++) for (let c = 0; c < 4; c++) {
    const gz = -23.4 + c * 1.05, gy = 0.55 + r * 0.62;
    box(0.9, 0.55, 0.95, M.chrome, x0 + 0.65, gy, gz, D0);
    box(0.02, 0.4, 0.8, M.dark, x0 + 1.12, gy, gz, DN);
    if ((r * 4 + c) % 5 === 0) { box(1.3, 0.06, 0.62, M.chrome, x0 + 1.7, gy, gz, D0); coveredBody(x0 + 1.9, gz, Math.PI / 2, gy + 0.03, { stain: c % 2 === 0 }); }
  }
  col.addBox(x0 + 1.3, -21.8, 1.9, 4.6, { y0: 0, y1: 2.2 });
  for (const mz of [-14, -17.5]) {
    box(1.0, 0.1, 2.1, M.chrome, -6.0, 0.88, mz, D0); b.cyl(0.08, 0.08, 0.85, M.chrome, -6.0, 0.43, mz, 6, D0);
    col.addBox(-6, mz, 1.0, 2.1, { y0: 0, y1: 1.0 });
  }
  coveredBody(-6.0, -14, 0, 0.96); coveredBody(-6.0, -17.5, 0, 0.96, { stain: false });
  for (let i = 0; i < 4; i++) { const g = new THREE.SphereGeometry(1, 7, 5); g.scale(0.45, 0.22, 0.95); b.geo(g, M.bag, -3.9 + between(-0.3, 0.3), 0.2 + (i > 2 ? 0.3 : 0), -23 + i * 0.5, { ry: between(-0.4, 0.4), ...D0 }); }
  col.addBox(-4.0, -22.2, 1.4, 2.2, { y0: 0, y1: 0.8 });
  corpse(-9.0, -12.0, 0.4, { cloth: M.coat }); corpse(-3.7, -12.6, 2.9, { cloth: M.scrubs, sitting: true });
  bloodPool(-6.0, -14, 0.9); bloodPool(-6.0, -17.5, 0.7); papers(-6.5, -16, 18, 2.5); rubble(-8, -12, 10, 1.4);
  decal(-6.5, -19, 3.5, 3.5, M.water, 0.2); decal(-7.2, -16, 5.5, 8, M.dirt, 0.9); ceilingHole(-7.2, -21.5, 2.0, 1.8);
  box(2.2, 0.55, 0.04, signs.scrawl('GAVETA 7'), -4.0, 2.4, -25.8, DN);
  for (let i = 0; i < 6; i++) box(0.02, 0.4, 0.05, M.blood, x0 + 1.14, 0.5 + 0.62 * 1 + (i % 2) * 0.1, -23.2 + i * 0.3, DN);

  // ───────────────────────── UTI (nordeste) ─────────────────────────
  for (const [bx, bz, br, body] of [[10.0, -13.5, 0, 'dead'], [10.0, -17.0, 0, 'covered'], [10.0, -20.5, 0, null], [4.2, -23.4, Math.PI / 2, 'dead']]) bed(bx, bz, br, { body });
  bed(5.5, -16.5, 1.1, { broken: true });                                          // leito arrastado contra o vão
  for (const mz of [-13.5, -17.0, -20.5]) {
    box(0.4, 0.26, 0.3, M.dark, 10.75, 1.5, mz, D0); box(0.02, 0.2, 0.22, i2g(mz), 10.54, 1.5, mz, DN);
    box(0.06, 1.2, 0.06, M.chrome, 10.55, 0.9, mz + 0.5, D0);
  }
  function i2g(mz) { return mz === -17.0 ? M.alarmRed : M.screenGreen; }
  ivStand(8.4, -14.6); ivStand(8.5, -19.4, { fallen: true }); ivStand(5.2, -13.0);
  cart(6.3, -12.0, 0.3); cart(7.8, -22.8, 1.4, { fallen: true });
  corpse(7.2, -18.6, 0.9, { cloth: M.coat }); corpse(5.0, -20.8, 2.0, { cloth: M.gown, sitting: true });
  bloodPool(7.2, -18.6, 0.8); papers(7, -17, 26, 3); rubble(8, -12, 10, 1.4); ceilingHole(7.0, -15.5, 2.2, 2.0);
  decal(7.5, -20, 3.4, 4, M.water, 0.5); decal(7, -17, 6, 8, M.dirt, 0.2);
  box(2.4, 0.6, 0.04, signs.scrawl('NÃO ABRA'), x1 - 0.17, 2.2, -14.0, { ry: -Math.PI / 2, ...DN });
  boardedWindow(x1, -13, 1); boardedWindow(x1, -21, 1);

  // ───────────────────────── Porta de entrada (volta à rua) ─────────────────────────
  const entranceDoor = { target: 0, leaves: [] };
  const leafMeshes = [];
  for (const side of [-1, 1]) {
    const hinge = new THREE.Group();
    hinge.position.set(side * 1.2, 0, z1);
    const leafMesh = (w, hh, d, mat, x, y, z) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, hh, d), mat); m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true; hinge.add(m); return m; };
    leafMesh(1.2, 2.55, 0.1, M.wood, -side * 0.6, 1.3, 0);
    leafMesh(0.5, 0.9, 0.04, M.shard, -side * 0.6, 1.7, 0.06);           // vidro quebrado
    leafMesh(0.08, 2.5, 0.12, M.dark, -side * 1.15, 1.3, 0);
    entranceDoor.leaves.push({ hinge, side });
    scene.add(hinge);
    leafMeshes.push(...hinge.children.filter((c) => c.isMesh && c.geometry.parameters.width > 0.5));
  }
  box(2.6, 0.1, 0.5, M.water, 0, 0.002, z1 - 0.8, DN);                      // poça de chuva que entrou pela porta

  // ───────────────────────── Itens e interações ─────────────────────────
  const state = { ammoWard: false, ammoIcu: false };
  const P = (x, z, y = 0) => new THREE.Vector3(x, y, z);
  let pendingTransition = null;
  let exitItem = null;
  exitItem = {
    id: 'hospital-exit', pos: P(0, z1 - 1.0), y: 0, radius: 2.8, label: 'Sair para a rua',
    onUse: (c) => {
      if (entranceDoor.target > 0.95) { c.transition('street', HOSPITAL_STREET_RETURN); return; }
      entranceDoor.target = 1;
      exitItem.label = 'Atravessar a porta';
      pendingTransition = { seconds: 0.85, transition: () => c.transition('street', HOSPITAL_STREET_RETURN) };
      c.toast('A porta range e se abre para a chuva.');
    },
  };
  props.push(
    exitItem,
    { id: 'reception', pos: P(-8.4, 14.5), y: 0, radius: 2.4, label: 'Examinar registros',
      onUse: (c) => c.toast('Registro: "Evacuação às 03h12. Pacientes da UTI não puderam ser movidos." O resto está manchado de sangue.') },
    { id: 'ward-clipboard', pos: P(-8.3, -3.4), y: 0, radius: 1.8, label: 'Ler prancheta',
      onUse: (c) => c.toast('Leito 4 — febre alta, agressividade, mordida no antebraço. Isolamento imediato. A anotação termina no meio da frase.') },
    { id: 'ward-ammo', pos: P(-10.0, 1.9), y: 0, radius: 1.6, label: 'Pegar munição de pistola',
      enabled: () => !state.ammoWard, onUse: (c) => { state.ammoWard = true; c.addAmmo(15); c.toast('Você pegou: Munição de pistola ×15'); } },
    { id: 'surgery-tray', pos: P(5.9, 1.2), y: 0, radius: 1.7, label: 'Examinar bandeja cirúrgica',
      onUse: (c) => c.toast('Os instrumentos ainda estão dispostos. Quem operava saiu no meio do procedimento.') },
    { id: 'morgue-tags', pos: P(-9.2, -22), y: 0, radius: 2.2, label: 'Examinar gavetas',
      onUse: (c) => c.toast('O último registro é de três dias atrás. As gavetas 7 e 9 estão arranhadas por dentro.') },
    { id: 'icu-monitor', pos: P(9.4, -17.0), y: 0, radius: 2.0, label: 'Examinar monitor',
      onUse: (c) => c.toast('O monitor mostra uma linha reta. O alarme ainda pisca, sem som.') },
    { id: 'icu-ammo', pos: P(8.6, -21.6), y: 0, radius: 1.6, label: 'Pegar munição de pistola',
      enabled: () => !state.ammoIcu, onUse: (c) => { state.ammoIcu = true; c.addAmmo(12); c.toast('Você pegou: Munição de pistola ×12'); } },
    { id: 'emergency-exit', pos: P(0, z0 + 1.4), y: 0, radius: 2.2, label: 'Tentar abrir a saída de emergência',
      onUse: (c) => c.toast('Acorrentada pelo lado de dentro. Há arranhões profundos na porta... e algo se mexeu atrás dela?') },
  );

  // Props escaneados que já fazem parte do projeto (lixo, caixas, bancos)
  decor.place('painted_wooden_bench', { position: [8.9, 0, 11.2], height: 0.9, rotationY: -Math.PI / 2, tint: 0.55, collider: { w: 0.7, d: 1.9, h: 0.9 } });
  decor.place('metal_trash_can', { position: [-3.2, 0, 18.7], height: 0.85, tint: 0.7, collider: { w: 0.5, d: 0.5, h: 0.85 } });
  decor.place('metal_trash_can', { position: [2.0, 0, -5.6], height: 0.85, rotationY: 1.2, tint: 0.7 });
  decor.place('trashbag', { position: [-2.9, 0, 17.4], height: 0.45, tint: 0.7 });
  decor.place('trashbag', { position: [1.9, 0, 5.2], height: 0.4, rotationY: 2 });
  decor.place('trashbag', { position: [9.6, 0, -8.6], height: 0.5, tint: 0.6 });
  decor.place('wooden_crate_01', { position: [9.8, 0, 3.4], height: 0.6, rotationY: 0.4, tint: 0.55, collider: { w: 0.7, d: 0.7, h: 0.6 } });
  decor.place('GreenChair_01', { position: [-8.2, 0, -11.6], height: 0.9, rotationY: 0.8, tint: 0.5 });

  // Colisão do perímetro (as paredes já registraram as suas; isto evita vazar nos cantos)
  col.addBox(0, z0 - 0.3, x1 - x0 + 2, 0.6);
  col.addBox(x0 - 0.3, -3, 0.6, z1 - z0 + 2);
  col.addBox(x1 + 0.3, -3, 0.6, z1 - z0 + 2);
  // Sul: o vão da porta (2,4 m) fica livre
  col.addBox(-6.1, z1 + 0.3, 9.8, 0.6); col.addBox(6.1, z1 + 0.3, 9.8, 0.6);

  const { occluders } = b.finish(scene);
  occluders.push(...leafMeshes);            // a câmera não pode atravessar a porta fechada
  const resetEntrance = () => {
    entranceDoor.target = 0;
    pendingTransition = null;
    exitItem.label = 'Sair para a rua';
  };

  // ───────────────────────── Atmosfera ─────────────────────────
  const poolCamera = new THREE.Vector3(0, 2, 12);
  const flicker = (t, seed, rate) => {
    const burst = Math.sin(t * rate + seed) * Math.sin(t * rate * 2.37 + seed * 1.7);
    if (burst > 0.86) return 0.06;                              // lâmpada quase apagando
    return 0.82 + 0.18 * Math.sin(t * 41 + seed);
  };
  function update(t, dt, cameraPosition) {
    for (const { hinge, side } of entranceDoor.leaves) {
      const target = entranceDoor.target * side * 1.3;
      hinge.rotation.y += (target - hinge.rotation.y) * Math.min(1, dt * 4.5);
    }
    if (pendingTransition) {
      pendingTransition.seconds -= dt;
      if (pendingTransition.seconds <= 0) { const go = pendingTransition.transition; pendingTransition = null; go(); }
    }
    for (const tube of tubes) {
      const f = tube.red ? 0.55 + 0.45 * Math.max(0, Math.sin(t * tube.rate * 2.2 + tube.seed)) : flicker(t, tube.seed, tube.rate);
      tube.mesh.material.emissiveIntensity = tube.glow * f;
      if (tube.fixture) tube.fixture.intensity = tube.base * f;
    }
    pool.update(cameraPosition ?? poolCamera);
  }

  return {
    collisions: col, occluders, props, update,
    resetEntrance,
    spawn: { x: 0, y: 0, z: z1 - 2.3, yaw: Math.PI },          // junto à porta, olhando para o saguão
  };
}
