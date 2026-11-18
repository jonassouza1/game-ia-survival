import * as THREE from 'three';
import { Builder } from './builder.js';
import { pbr, solid } from '../render/pbr.js';

/**
 * Fachada do hospital abandonado, no fim da rua (substitui o prédio genérico que ficava ali).
 * Volume: x -10,3..10,3 · z 67,7..79,8 · altura 17 m. A frente (z = 67,7) fica logo atrás do letreiro
 * "RACCOON CITY HOSPITAL" (z ≈ 67,45). Só a frente e as laterais são vistas; a porta dupla é desenhada pela rua (cityStreet.js).
 * Se houver um GLB para o encaixe `exterior` (ver hospitalAssets.js), ele é usado no lugar desta fachada.
 */
export function buildHospitalFacade(group) {
  // Gerador próprio: não mexe na sequência aleatória da rua.
  let seed = 7741;
  const rnd = () => {
    seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const between = (a, c) => a + rnd() * (c - a);
  const mk = (m) => { m.userData.bake = false; return m; };

  const M = {
    stucco: mk(pbr('worn_plaster_wall', { tile: 3, color: 0xa39b86, roughness: 1, normalScale: 1 })),
    brick: mk(pbr('brick_wall_10', { tile: 2.8, color: 0x84766a, roughness: 1, normalScale: 1 })),
    concrete: mk(pbr('concrete_pavement', { tile: 2, color: 0x9a9a92, roughness: 1, normalScale: 0.9 })),
    wood: mk(pbr('dark_wooden_planks', { tile: 2, color: 0x7a6552, roughness: 1, normalScale: 0.9 })),
    rust: mk(pbr('rusty_metal', { tile: 1.5, color: 0x6e4a36, roughness: 1, normalScale: 0.9 })),
    dark: mk(solid({ color: 0x030404, roughness: 1 })),
    soot: mk(solid({ color: 0x0e0d0b, roughness: 1 })),
    moss: mk(solid({ color: 0x28361f, roughness: 1 })),
    mossDry: mk(solid({ color: 0x3b3f24, roughness: 1 })),
    blood: mk(solid({ color: 0x350807, roughness: 0.5 })),
    shard: mk(solid({ color: 0x748890, roughness: 0.15, metalness: 0.2 })),
    curtain: mk(solid({ color: 0x4a585c, roughness: 1 })),
    paper: mk(solid({ color: 0x9d9a88, roughness: 1 })),
  };
  const sign = (text, bg, fg) => {
    const canvas = document.createElement('canvas');
    canvas.width = 512; canvas.height = 128;
    const g = canvas.getContext('2d');
    g.fillStyle = bg; g.fillRect(0, 0, 512, 128);
    g.strokeStyle = fg; g.lineWidth = 5; g.strokeRect(6, 6, 500, 116);
    g.fillStyle = fg; g.font = 'bold 56px sans-serif'; g.textAlign = 'center';
    g.fillText(text, 256, 84);
    g.fillStyle = 'rgba(0,0,0,0.35)';                                // sujeira escorrida sobre a placa
    for (let i = 0; i < 14; i++) g.fillRect(rnd() * 500, 0, 3 + rnd() * 6, 20 + rnd() * 100);
    const map = new THREE.CanvasTexture(canvas);
    map.colorSpace = THREE.SRGBColorSpace;
    const m = solid({ map, color: 0xffffff, roughness: 0.8 });
    m.userData.uv = 'keep'; m.userData.bake = false;
    return m;
  };

  const b = new Builder();
  const X = 10.3, Z0 = 67.7, Z1 = 79.8, H = 17, DEPTH = Z1 - Z0, CZ = (Z0 + Z1) / 2;
  const D = { cam: true };
  const DN = { cam: false, cast: false };
  const box = (...a) => b.box(...a);

  // ── Volume principal ──
  const GF = 4.6;                                                      // pé-direito do térreo
  box(2 * X, H - GF, DEPTH, M.stucco, 0, GF + (H - GF) / 2, CZ);       // andares de cima
  box(2 * X, GF, DEPTH - 1.2, M.brick, 0, GF / 2, CZ + 0.6);           // térreo (parte de trás)
  // Térreo da frente, com vão para a porta (vestíbulo escuro atrás das folhas)
  box(X - 1.1, GF, 1.2, M.brick, -(X + 1.1) / 2, GF / 2, Z0 + 0.6);
  box(X - 1.1, GF, 1.2, M.brick, (X + 1.1) / 2, GF / 2, Z0 + 0.6);
  box(2.2, GF - 2.75, 1.2, M.brick, 0, 2.75 + (GF - 2.75) / 2, Z0 + 0.6);   // verga
  box(2.2, 2.75, 0.1, M.dark, 0, 1.375, Z0 + 1.15, DN);                      // fundo escuro do vestíbulo
  for (const sx of [-1, 1]) box(0.16, 2.75, 1.2, M.concrete, sx * 1.18, 1.375, Z0 + 0.6, DN);   // batentes

  // Faixas entre andares e cornija quebrada
  for (const y of [GF, 8.8, 12.9]) box(2 * X + 0.4, 0.32, 0.3, M.concrete, 0, y, Z0 - 0.0, DN);
  box(2 * X + 0.6, 0.9, DEPTH + 0.6, M.concrete, 0, H + 0.35, CZ, D);
  for (let i = 0; i < 5; i++) box(between(0.8, 2), 0.5, 0.7, M.concrete, between(-9, 9), H + 0.95 + rnd() * 0.2, Z0 + 0.4, { rz: between(-0.3, 0.3), ry: between(-0.5, 0.5), ...DN });   // parapeito caído

  // ── Janelas ──
  const rows = [
    { y: 1.9, h: 1.5, xs: [-8.2, -5.2, 5.2, 8.2], w: 1.4 },
    { y: 6.9, h: 2.0, xs: [-8.4, -5.0, -1.7, 1.7, 5.0, 8.4], w: 1.5 },
    { y: 11.0, h: 2.0, xs: [-8.4, -5.0, -1.7, 1.7, 5.0, 8.4], w: 1.5 },
    { y: 15.0, h: 2.0, xs: [-8.4, -5.0, -1.7, 1.7, 5.0, 8.4], w: 1.5 },
  ];
  const fz = Z0 - 0.04;
  for (const { y, h, xs, w } of rows) for (const x of xs) {
    // O letreiro "RACCOON CITY HOSPITAL" (cityStreet.js) fica no meio do 3º andar; deixa esse trecho livre.
    if (y > 12 && y < 14 && Math.abs(x) < 2.3) continue;
    box(w + 0.36, 0.14, 0.34, M.concrete, x, y - h / 2 - 0.07, fz - 0.06, DN);        // peitoril
    box(w + 0.36, 0.14, 0.2, M.concrete, x, y + h / 2 + 0.07, fz, DN);                // verga
    box(w, h, 0.06, M.dark, x, y, fz, DN);                                           // vão escuro
    const kind = rnd();
    if (kind < 0.34) {                                                              // tapada com tábuas
      for (let i = 0; i < 4; i++) box(w + 0.3, 0.18, 0.06, M.wood, x + between(-0.05, 0.05), y - h / 2 + 0.25 + i * (h / 4), fz - 0.06, { rz: between(-0.08, 0.08), ...DN });
    } else if (kind < 0.62) {                                                       // vidro quebrado + cortina rasgada
      box(0.3, h * between(0.5, 0.85), 0.03, M.curtain, x + between(-0.4, 0.4), y + h / 2 - h * 0.35, fz - 0.04, { rz: between(-0.05, 0.05), ...DN });
      for (let i = 0; i < 3; i++) box(between(0.1, 0.3), between(0.2, 0.6), 0.02, M.shard, x + between(-w / 2, w / 2), y - h / 2 + between(0.1, 0.5), fz - 0.04, { rz: between(-0.5, 0.5), ...DN });
    } else if (kind < 0.8) {                                                        // incendiada: fuligem escorrida
      box(w * 0.9, between(2.0, 3.4), 0.02, M.soot, x, y + h / 2 + between(1.0, 1.6), fz - 0.03, DN);
    }                                                                               // senão: vão aberto e escuro
    if (rnd() < 0.55) box(between(0.18, 0.5), between(1.2, 3.2), 0.018, M.soot, x + between(-w / 2, w / 2), y - h / 2 - between(0.8, 1.7), fz - 0.04, DN);   // mancha escorrida
  }

  // ── Entrada: letreiro apagado, marquise caída, barricada e escombros ──
  box(3.2, 0.62, 0.1, sign('EMERGÊNCIA', '#2a1210', '#8a2a1f'), 0, 3.55, Z0 - 0.05, DN);
  b.push(0, 3.95, Z0 - 1.1, 0);                                        // marquise solta de um lado, pendurada na parede
  box(5.2, 0.16, 2.3, M.concrete, 0, 0, 0, { rx: 0.34, rz: 0.05, ...DN });
  for (const sx of [-1, 1]) box(0.05, 0.05, 2.4, M.rust, sx * 2.2, 0.1, 0.1, { rx: 0.34, ...DN });
  b.pop();
  box(0.18, 3.6, 0.18, M.rust, -2.4, 1.8, Z0 - 2.1, { rz: 0.04, ...DN });          // escora que sobrou da marquise
  // Tábuas e portas pregadas em barricada ao lado da entrada
  for (let i = 0; i < 6; i++) box(0.12, between(1.3, 2.2), 0.05, M.wood, 2.8 + i * 0.2, 1.1, Z0 - 0.15, { rz: between(-0.9, 0.9), ry: between(-0.1, 0.1), ...DN });
  for (let i = 0; i < 3; i++) box(0.9, 0.12, 0.06, M.wood, -3.4 + i * 0.1, 1.0 + i * 0.5, Z0 - 0.2, { rz: between(-0.3, 0.3), ...DN });
  // Mãos e arrastos de sangue junto à porta
  for (let i = 0; i < 6; i++) box(0.12, 0.2, 0.012, M.blood, -1.7 + i * 0.12, 1.2 + (i % 2) * 0.12, Z0 - 0.07, DN);
  for (let i = 0; i < 5; i++) box(0.22, 0.006, between(0.8, 1.6), M.blood, between(-0.8, 0.8), 0.004, Z0 - 1.0 - i * 0.7, { ry: between(-0.15, 0.15), ...DN });
  // Escombros, papéis e entulho ao pé da fachada
  for (let i = 0; i < 40; i++) {
    const s = between(0.06, 0.4);
    box(s * between(0.8, 2), s * 0.6, s * between(0.8, 2), rnd() < 0.5 ? M.concrete : M.stucco,
      between(-9.5, 9.5), s * 0.3, Z0 - between(0.2, 2.2), { ry: rnd() * 3, rx: between(-0.2, 0.2), rz: between(-0.2, 0.2), ...DN });
  }
  for (let i = 0; i < 18; i++) box(between(0.2, 0.32), 0.004, between(0.24, 0.34), M.paper, between(-7, 7), 0.004 + i * 0.0003, Z0 - between(0.5, 3.5), { ry: rnd() * 6, ...DN });

  // ── Natureza retomando o prédio (musgo e trepadeiras) ──
  for (let i = 0; i < 26; i++) {
    const x = between(-9.8, 9.8);
    if (Math.abs(x) < 1.6) continue;
    box(between(0.3, 1.4), between(0.5, 2.0), 0.02, rnd() < 0.5 ? M.moss : M.mossDry, x, between(0.3, 1.1), Z0 - 0.05, DN);
  }
  for (let i = 0; i < 22; i++) {
    const x = between(-9.8, 9.8);
    if (Math.abs(x) < 1.5) continue;
    box(between(0.04, 0.09), between(2.5, 9), 0.02, M.moss, x, between(1.5, 5.5), Z0 - 0.07, { rz: between(-0.12, 0.12), ...DN });
  }

  // ── Laterais e fundo: só massa, com algumas marcas ──
  for (const sx of [-1, 1]) {
    for (let i = 0; i < 6; i++) box(0.02, between(2, 6), between(0.4, 1.2), M.soot, sx * (X + 0.012), between(3, 14), Z0 + 1.5 + i * 1.7, DN);
  }
  b.finish(group);
}
