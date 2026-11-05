import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { Builder } from './builder.js';
import { makeTextures } from './textures.js';
import { CollisionWorld } from '../systems/collision.js';

// Dimensões do saguão (metros). Norte = -z (escadas/estátua), Sul = +z (portas de entrada).
export const HALL = { x0: -12, x1: 12, z0: -16, z1: 24, h: 9.2, gy: 4.6 };

export function buildPoliceStation(scene) {
  const { x0, x1, z0, z1, h, gy } = HALL;
  const W = x1 - x0, D = z1 - z0, cz = (z0 + z1) / 2;

  const T = makeTextures();
  const mk = (map, tile, color = 0xffffff, o = {}) => {
    // Diffuse sem brilho ou bump: superfícies foscas e pintadas como cenário pré-renderizado.
    const m = new THREE.MeshLambertMaterial({ map, color, ...o });
    m.userData.tile = tile;
    return m;
  };
  const basic = (o, tile = 2) => { const m = new THREE.MeshBasicMaterial(o); m.userData.tile = tile; return m; };
  const M = {
    marble: mk(T.marble, 4),
    floor: mk(T.floor, 4),
    panel: mk(T.wainscot, 3),
    wallStone: mk(T.wallStone, 3.8),
    plasterLt: mk(T.plaster, 3, 0xe4dcc8),
    recess: mk(T.plaster, 3, 0x6d675a),
    wood: mk(T.wood, 2),
    woodLt: mk(T.woodLt, 2),
    upholstery: mk(T.upholstery, 1.5),
    trim: mk(T.wood, 2, 0x9b7a62),
    dark: basic({ color: 0x020303, side: THREE.DoubleSide }),
    stone: mk(T.stone, 3, 0xffffff, { flatShading: true }),
    statue: mk(T.statuary, 2.4, 0xd1cebd, { flatShading: true }),
    lion: mk(T.statuary, 2, 0xc3b99f, { flatShading: true }),
    greenDoor: mk(T.greenDoor, 2.4),
    ceil: mk(T.ceiling, 4),
    carpet: mk(T.carpet, 3),
    stairCarpet: mk(T.stairCarpet, 0.8),
    metal: mk(T.metal, 2),
    brass: mk(null, 2, 0xa88d4e),
    black: mk(null, 2, 0x1d1e1b),
    paper: mk(null, 2, 0xc2b99c),
    green: mk(null, 2, 0x4f8f3e, { flatShading: true }),
    olive: mk(null, 2, 0x5f673b),
    screen: basic({ color: 0x86d0a4 }),
    lamp: basic({ color: 0xffd9a0 }),
    glass: basic({ map: T.glass, color: 0xffffff }, 3),
    stainedGlass: basic({ map: T.stainedGlass, color: 0xffffff }, 2),
  };

  const b = new Builder();
  const col = new CollisionWorld();
  col.addFloor({ minX: x0 + 0.3, maxX: x1 - 0.3, minZ: z0 + 0.3, maxZ: 22.8, y: 0 });
  const props = [];
  const lights = [];
  const animatedDoors = [];
  let pendingDoorTransition = null;
  let northDoorItem = null;
  let flickerLight = null;
  const D0 = { cam: false };               // decoração: câmera ignora
  const DN = { cam: false, cast: false };  // decoração sem sombra
  const box = (...a) => b.box(...a);
  const softBox = (w, h, d, mat, x, y, z, o = D0, bevel = 0.06) => {
    const radius = Math.min(bevel, w * 0.45, h * 0.45, d * 0.45);
    b.geo(new RoundedBoxGeometry(w, h, d, 2, radius), mat, x, y, z, o);
  };
  const cyl = (...a) => b.cyl(...a);
  const oval = (sx, sy, sz, mat, x, y, z, seg = 7, rings = 5, o = D0) => {
    const g = new THREE.SphereGeometry(1, seg, rings);
    g.scale(sx, sy, sz);
    b.geo(g, mat, x, y, z, o);
  };
  const beamBetween = (from, to, width, mat, o = D0) => {
    const start = new THREE.Vector3(...from), end = new THREE.Vector3(...to);
    const direction = end.clone().sub(start);
    const geometry = new THREE.BoxGeometry(width, direction.length(), width);
    geometry.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(
      new THREE.Vector3(0, 1, 0), direction.normalize()));
    b.geo(geometry, mat, ...start.add(end).multiplyScalar(0.5).toArray(), o);
  };
  const octagonalTier = (w, d, h, mat, x, baseY, z, chamfer = 0.16) => {
    const shape = new THREE.Shape();
    const c = Math.min(w, d) * chamfer;
    const points = [
      [-w / 2 + c, -d / 2], [w / 2 - c, -d / 2], [w / 2, -d / 2 + c],
      [w / 2, d / 2 - c], [w / 2 - c, d / 2], [-w / 2 + c, d / 2],
      [-w / 2, d / 2 - c], [-w / 2, -d / 2 + c],
    ];
    points.forEach(([px, pz], index) => {
      if (index === 0) shape.moveTo(px, pz);
      else shape.lineTo(px, pz);
    });
    shape.closePath();
    const bevel = Math.min(0.035, h * 0.12);
    const geometry = new THREE.ExtrudeGeometry(shape, {
      depth: h - bevel * 2, bevelEnabled: true, bevelSegments: 1,
      bevelSize: bevel, bevelThickness: bevel,
    });
    geometry.translate(0, 0, -(h - bevel * 2) / 2);
    geometry.rotateX(-Math.PI / 2);
    b.geo(geometry, mat, x, baseY + h / 2, z, D0);
  };

  const planter = (x, z, baseY = 0, scale = 1) => {
    octagonalTier(0.66 * scale, 0.66 * scale, 0.48 * scale, M.stone, x, baseY, z, 0.2);
    octagonalTier(0.74 * scale, 0.74 * scale, 0.09 * scale, M.trim, x, baseY + 0.43 * scale, z, 0.2);
    octagonalTier(0.48 * scale, 0.48 * scale, 0.04 * scale, M.black, x, baseY + 0.51 * scale, z, 0.18);
    softBox(0.25 * scale, 0.29 * scale, 0.025 * scale, M.trim,
      x, baseY + 0.25 * scale, z + 0.335 * scale, DN, 0.025 * scale);
    softBox(0.17 * scale, 0.20 * scale, 0.03 * scale, M.stone,
      x, baseY + 0.25 * scale, z + 0.35 * scale, DN, 0.018 * scale);
    for (let i = 0; i < 9; i++) {
      const a = i * Math.PI * 2 / 9;
      const leaf = new THREE.Shape();
      leaf.moveTo(0, 0);
      leaf.quadraticCurveTo(0.2 * scale, 0.24 * scale, 0.12 * scale, 0.68 * scale);
      leaf.quadraticCurveTo(0.02 * scale, 0.58 * scale, -0.03 * scale, 0.4 * scale);
      leaf.quadraticCurveTo(-0.18 * scale, 0.17 * scale, 0, 0);
      b.geo(new THREE.ShapeGeometry(leaf, 4), M.green, x, baseY + 0.53 * scale, z,
        { ...D0, ry: -a, rx: Math.sin(a) * 0.18, rz: Math.cos(a) * 0.16 });
      cyl(0.012 * scale, 0.016 * scale, 0.5 * scale, M.woodLt,
        x + Math.cos(a) * 0.08 * scale, baseY + 0.78 * scale, z + Math.sin(a) * 0.08 * scale, 4, D0);
    }
    col.addBox(x, z, 0.72 * scale, 0.72 * scale, { y0: baseY, y1: baseY + 1.3 * scale });
  };

  const supplyCrate = (x, z, baseY = 0, scale = 1) => {
    const w = 0.96 * scale, h = 0.76 * scale, d = 0.82 * scale;
    box(w, h, d, M.wood, x, baseY + h / 2, z, D0);
    for (const sx of [-1, 1]) {
      box(0.08 * scale, h + 0.04 * scale, d + 0.04 * scale, M.trim,
        x + sx * (w / 2 - 0.08 * scale), baseY + h / 2, z, D0);
      box(w + 0.03 * scale, 0.075 * scale, 0.08 * scale, M.metal,
        x, baseY + h * 0.27, z + sx * (d / 2 + 0.015 * scale), D0);
    }
    box(w + 0.06 * scale, 0.08 * scale, d + 0.06 * scale, M.woodLt,
      x, baseY + h + 0.025 * scale, z, D0);
    box(0.26 * scale, 0.14 * scale, 0.035 * scale, M.paper,
      x, baseY + h * 0.62, z + d / 2 + 0.02 * scale, D0);
    col.addBox(x, z, w + 0.12 * scale, d + 0.12 * scale,
      { y0: baseY, y1: baseY + h + 0.5 * scale });
  };

  // ───────────────────────── Casca: piso, teto, paredes ─────────────────────────
  box(W, 0.5, D, M.floor, 0, -0.25, cz);
  box(W, 0.5, D, M.ceil, 0, h + 0.25, cz);

  // Vigas do teto (caixotões) e luminárias de teto
  for (const z of [-12, -6, 0, 6, 12, 18]) box(W, 0.45, 0.5, M.wood, 0, h - 0.22, z, D0);
  for (const x of [-6, 0, 6]) box(0.5, 0.45, D, M.wood, x, h - 0.22, cz, D0);
  for (const z of [-9, -3, 3, 9, 15, 21]) {
    box(2.6, 0.1, 0.8, M.trim, 0, h - 0.5, z, D0);
    box(2.1, 0.05, 0.45, M.lamp, 0, h - 0.57, z, DN);
  }

  // Pendentes baixos e de metal envelhecido acrescentam uma fonte de luz legível no salão alto.
  for (const z of [-6, 5, 17]) {
    const chain = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0, h - 0.8, z),
      new THREE.Vector3(0, h - 1.08, z),
      new THREE.Vector3(0, h - 1.35, z),
    ]);
    b.geo(new THREE.TubeGeometry(chain, 4, 0.025, 5, false), M.black, 0, 0, 0, D0);
    octagonalTier(1.45, 1.45, 0.13, M.brass, 0, h - 1.45, z, 0.19);
    octagonalTier(1.05, 1.05, 0.12, M.trim, 0, h - 1.55, z, 0.18);
    octagonalTier(0.5, 0.5, 0.4, M.brass, 0, h - 1.91, z, 0.18);
    for (let i = 0; i < 8; i++) {
      const a = i * Math.PI / 4, x = Math.cos(a), zz = z + Math.sin(a);
      const armPath = new THREE.CatmullRomCurve3([
        new THREE.Vector3(0, h - 1.55, z),
        new THREE.Vector3(x * 0.32, h - 1.43, z + Math.sin(a) * 0.32),
        new THREE.Vector3(x * 0.72, h - 1.45, z + Math.sin(a) * 0.72),
        new THREE.Vector3(x * 0.94, h - 1.57, z + Math.sin(a) * 0.94),
      ]);
      b.geo(new THREE.TubeGeometry(armPath, 6, 0.027, 5, false), M.brass, 0, 0, 0, D0);
      b.geo(new THREE.ConeGeometry(0.075, 0.16, 6), M.trim,
        x * 0.94, h - 1.65, z + Math.sin(a) * 0.94, D0);
      oval(0.11, 0.13, 0.11, M.lamp, x * 0.94, h - 1.77, z + Math.sin(a) * 0.94, 6, 4, DN);
    }
    const pendantGlow = new THREE.PointLight(0xffd39b, 5, 9, 1.5);
    pendantGlow.position.set(0, h - 1.8, z); scene.add(pendantGlow); lights.push(pendantGlow);
  }

  // Cada parede é construída em coordenadas locais: z=0 é a face interna, +z entra na sala,
  // x local corre da esquerda para a direita de quem olha a parede.
  const WALLS = {
    north: { pos: [0, z0], rot: 0, len: W, lx: (x, z) => x },
    south: { pos: [0, z1], rot: Math.PI, len: W, lx: (x, z) => -x },
    west: { pos: [x0, cz], rot: Math.PI / 2, len: D, lx: (x, z) => cz - z },
    east: { pos: [x1, cz], rot: -Math.PI / 2, len: D, lx: (x, z) => z - cz },
  };

  const arch = (lx, yb, w, hr, pane = M.glass) => {
    const sh = new THREE.Shape();
    sh.moveTo(-w / 2, 0); sh.lineTo(w / 2, 0); sh.lineTo(w / 2, hr);
    sh.absarc(0, hr, w / 2, 0, Math.PI, false); sh.lineTo(-w / 2, 0);
    b.geo(new THREE.ShapeGeometry(sh, 8), pane, lx, yb, 0.04, DN);
    const top = hr + w / 2;
    box(0.16, hr + 0.14, 0.14, M.trim, lx - w / 2 - 0.08, yb + hr / 2, 0.07, D0);
    box(0.16, hr + 0.14, 0.14, M.trim, lx + w / 2 + 0.08, yb + hr / 2, 0.07, D0);
    b.geo(new THREE.TorusGeometry(w / 2 + 0.08, 0.08, 4, 12, Math.PI), M.trim, lx, yb + hr, 0.07, D0);
    box(0.09, top, 0.07, M.wood, lx, yb + top / 2, 0.07, D0);
    box(w, 0.09, 0.07, M.wood, lx, yb + hr * 0.55, 0.07, D0);
    box(w + 0.6, 0.2, 0.4, M.stone, lx, yb - 0.1, 0.2, D0);
  };

  const doorDouble = (lx, w, hh, y0 = 0, panel = M.wood, detail = M.woodLt, animated = false) => {
    const t = 0.3;
    box(0.22, hh, t, M.trim, lx - w / 2 - 0.11, y0 + hh / 2, t / 2, D0);
    box(0.22, hh, t, M.trim, lx + w / 2 + 0.11, y0 + hh / 2, t / 2, D0);
    box(w + 0.8, 0.3, t + 0.04, M.trim, lx, y0 + hh + 0.15, (t + 0.04) / 2, D0);
    const leaves = [];
    for (const s of [-1, 1]) {
      const cx = lx + s * (w / 4);
      if (animated) {
        const leafWidth = w / 2 - 0.04;
        const hinge = new THREE.Group();
        hinge.position.copy(b.world(lx + s * (w / 2), y0, 0.08));
        const addLeafBox = (width, height, depth, material, x, y, z) => {
          const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), material);
          mesh.position.set(x, y, z);
          mesh.castShadow = true;
          mesh.receiveShadow = true;
          hinge.add(mesh);
        };
        addLeafBox(leafWidth, hh - 0.04, 0.1, panel, -s * leafWidth / 2, (hh - 0.04) / 2 + 0.02, 0);
        addLeafBox(leafWidth - 0.4, hh * 0.38, 0.05, detail, -s * leafWidth / 2, hh * 0.3, 0.075);
        addLeafBox(leafWidth - 0.4, hh * 0.3, 0.05, detail, -s * leafWidth / 2, hh * 0.74, 0.075);
        addLeafBox(0.05, 0.3, 0.07, M.brass, -s * (leafWidth - 0.14), 1.15, 0.11);
        scene.add(hinge);
        leaves.push(hinge);
      } else {
        box(w / 2 - 0.04, hh - 0.04, 0.1, panel, cx, y0 + (hh - 0.04) / 2 + 0.02, 0.08, D0);
        box(w / 2 - 0.4, hh * 0.38, 0.05, detail, cx, y0 + hh * 0.3, 0.13, D0);
        box(w / 2 - 0.4, hh * 0.3, 0.05, detail, cx, y0 + hh * 0.74, 0.13, D0);
        box(0.05, 0.3, 0.07, M.brass, lx + s * 0.14, y0 + 1.15, 0.16, D0);
      }
    }
    if (animated) animatedDoors.push({ leaves, target: 0 });
    box(w + 0.1, 0.04, 0.5, M.stone, lx, y0 + 0.02, 0.25, D0);
  };

  const pilaster = (lx) => {
    // Colunas molduradas substituem as pilastras lisas e cúbicas.
    box(1.28, 0.22, 0.62, M.stone, lx, 0.11, 0.18, D0);
    box(1.08, 0.22, 0.54, M.trim, lx, 0.33, 0.2, D0);
    cyl(0.46, 0.50, h - 1.75, M.stone, lx, h / 2, 0.2, 10, D0);
    cyl(0.53, 0.50, 0.22, M.stone, lx, 1.05, 0.2, 10, D0);
    cyl(0.56, 0.56, 0.13, M.trim, lx, 1.20, 0.2, 10, D0);
    cyl(0.56, 0.52, 0.18, M.trim, lx, h - 1.18, 0.2, 10, D0);
    cyl(0.66, 0.56, 0.28, M.stone, lx, h - 0.93, 0.2, 10, D0);
    box(1.16, 0.18, 0.58, M.trim, lx, h - 0.67, 0.18, D0);
    box(1.3, 0.22, 0.62, M.stone, lx, h - 0.45, 0.18, D0);
    // Filetes verticais claros dão leitura de coluna talhada na baixa resolução.
    for (const dx of [-0.24, 0, 0.24]) cyl(0.025, 0.025, h - 2.75, M.plasterLt, lx + dx, h / 2, 0.63, 5, D0);
  };

  const sconce = (lx, intensity = 12, flicker = false) => {
    box(0.12, 0.12, 0.24, M.brass, lx, 3.1, 0.3, D0);
    box(0.3, 0.07, 0.26, M.brass, lx, 3.12, 0.42, D0);
    box(0.22, 0.34, 0.2, M.lamp, lx, 3.35, 0.42, DN);
    box(0.3, 0.06, 0.26, M.brass, lx, 3.57, 0.42, D0);
    const L = new THREE.PointLight(0xffc684, intensity, 19, 1.7);
    L.position.copy(b.world(lx, 3.4, 1.0));
    L.userData.base = intensity;
    if (flicker) flickerLight = L;
    scene.add(L); lights.push(L);
  };

  const dress = (len) => {
    box(len, 0.28, 0.18, M.trim, 0, 0.14, 0.09, D0);        // rodapé
    box(len, 1.25, 0.1, M.wood, 0, 0.9, 0.05, D0);          // lambri
    box(len, 0.12, 0.22, M.woodLt, 0, 1.58, 0.11, D0);      // corrimão de parede
    box(len, 0.3, 0.26, M.plasterLt, 0, gy - 0.35, 0.13, D0); // friso no nível da galeria
    box(len, 0.34, 0.46, M.plasterLt, 0, h - 0.55, 0.23, D0); // cornija
    box(len, 0.22, 0.62, M.trim, 0, h - 0.25, 0.31, D0);
  };

  for (const [name, w] of Object.entries(WALLS)) {
    b.push(w.pos[0], 0, w.pos[1], w.rot);
    if (name === 'north') {
      const wallWidth = w.len + 1.2;
      const openingWidth = 3.4;
      const sideWidth = (wallWidth - openingWidth) / 2;
      for (const side of [-1, 1]) {
        const x = side * (openingWidth / 2 + sideWidth / 2);
        box(sideWidth, h + 0.8, 0.6, M.wallStone, x, h / 2, -0.3);
        box(sideWidth, 1.9, 0.12, M.panel, x, 0.98, -0.02, D0);
        box(sideWidth, 0.14, 0.24, M.stone, x, 1.96, 0.05, D0);
        b.push(x, 0, 0);
        dress(sideWidth);
        b.pop();
      }
      box(openingWidth, h + 0.8 - 3.4, 0.6, M.wallStone, 0, (h + 0.8 + 3.4) / 2, -0.3);
      b.geo(new THREE.BoxGeometry(openingWidth, 3.3, 0.05), M.dark, 0, 1.65, -0.65, { cast: false });
    } else {
      box(w.len + 1.2, h + 0.8, 0.6, M.wallStone, 0, h / 2, -0.3);
      box(w.len + 1.2, 1.9, 0.12, M.panel, 0, 0.98, -0.02, D0);
      box(w.len + 1.2, 0.14, 0.24, M.stone, 0, 1.96, 0.05, D0);
      dress(w.len);
    }

    if (name === 'north') {
      for (const lx of [-9, -3, 3, 9]) pilaster(lx);
      doorDouble(0, 2.4, 3.0, 0, M.greenDoor, M.trim, true);
      sconce(-4.2, 8); sconce(4.2, 8);
      doorDouble(-6.5, 2.0, 3.0, gy);                // portas do 2º andar
      doorDouble(6.5, 2.0, 3.0, gy);
      // Janela-nicho atrás do leão, com o vitral original do salão principal de RE2.
      box(3.6, 6.4, 0.05, M.recess, 0, gy + 3.0, 0.02, DN);
      arch(0, gy + 1.35, 1.65, 1.0, M.stainedGlass);
    }
    if (name === 'south') {
      for (const lx of [-9, -3.5, 3.5, 9]) pilaster(lx);
      // Entrada principal mais larga, com bandeira em arco e guarnições de pedra.
      doorDouble(0, 5.6, 4.35);
      arch(0, 4.18, 5.8, 0.18, M.stainedGlass);
      for (const sx of [-1, 1]) {
        box(0.42, 5.05, 0.52, M.stone, sx * 3.15, 2.52, 0.22, D0);
        box(0.72, 0.22, 0.7, M.trim, sx * 3.15, 5.12, 0.22, D0);
        box(0.58, 0.18, 0.62, M.stone, sx * 3.15, 5.32, 0.22, D0);
      }
      box(6.5, 0.28, 0.58, M.stone, 0, 7.42, 0.18, D0);
      box(1.05, 0.72, 0.08, M.brass, 0, 8.12, 0.16, D0);
      // Vitrais laterais e frisos de pedra marcam a fachada interna.
      arch(-6.3, 2.1, 2.4, 2.2); arch(6.3, 2.1, 2.4, 2.2);
      // Caixa de fusíveis deslocada para a ombreira, fora das folhas da porta.
      box(0.6, 0.78, 0.14, M.metal, 4.55, 1.95, 0.08, D0);
      box(0.5, 0.66, 0.05, M.black, 4.55, 1.95, 0.17, D0);
      box(0.08, 0.14, 0.06, M.brass, 4.7, 1.95, 0.21, D0);
    }
    if (name === 'west' || name === 'east') {
      for (const z of [-12, -6, 0, 6, 12, 18]) pilaster(w.lx(0, z));
      for (const z of [-9, -3, 3, 9, 15, 21]) arch(w.lx(0, z), 5.1, 2.2, 2.2, M.stainedGlass);
      doorDouble(w.lx(0, 3), 2.2, 3.2);
      // Portas e guarnições no nível das galerias laterais.
      doorDouble(w.lx(0, -6), 1.9, 2.8, gy);
      box(2.5, 0.12, 0.22, M.trim, w.lx(0, -6), gy + 2.95, 0.12, D0);
      doorDouble(w.lx(0, 0), 1.85, 2.8, gy);
      box(2.45, 0.12, 0.22, M.trim, w.lx(0, 0), gy + 2.95, 0.12, D0);
      doorDouble(w.lx(0, 12), 1.85, 2.8, gy);
      box(2.45, 0.12, 0.22, M.trim, w.lx(0, 12), gy + 2.95, 0.12, D0);
      doorDouble(w.lx(0, 18), 1.85, 2.8, gy);
      box(2.45, 0.12, 0.22, M.trim, w.lx(0, 18), gy + 2.95, 0.12, D0);
      for (const z of [-6, 0, 6, 15, 21]) sconce(w.lx(0, z));
    }
    if (name === 'south') { sconce(-3.5, 12, true); sconce(3.5, 12); }
    b.pop();
  }

  // Pequeno lance de entrada antes do piso principal do saguão.
  const entrySteps = 6, entryRise = 0.15, entryRun = 0.65;
  const entrySouth = 22.8, entryNorth = entrySouth - entrySteps * entryRun;
  for (let i = 0; i < entrySteps; i++) {
    const top = (entrySteps - i) * entryRise;
    const z = entrySouth - (i + 0.5) * entryRun;
    box(7.8, top, entryRun + 0.015, M.floor, 0, top / 2, z);
    box(7.95, 0.055, 0.11, M.trim, 0, top - 0.018, z + entryRun / 2 - 0.035, D0);
  }
  // Patamar alto sob as portas e corrimãos dos degraus menores.
  box(10.8, 0.9, 1.25, M.floor, 0, 0.45, 23.38);
  for (const sx of [-1, 1]) {
    b.slope(0.14, 0.11, entrySouth - 0.12, 1.02, entryNorth + 0.25, 0.12, M.wood, sx * 4.05, D0);
    for (let i = 0; i <= entrySteps; i++) {
      const z = entrySouth - i * entryRun;
      const y = Math.max(0.15, (entrySteps - i) * entryRise + 0.45);
      box(0.16, 0.42, 0.16, M.woodLt, sx * 4.05, y, z, D0);
    }
  }
  col.addPlatform({ minX: -5.4, maxX: 5.4, minZ: 22.7, maxZ: 24.0, y: 0.9, minEntryY: 0.45 });
  col.addRamp({ minX: -4.0, maxX: 4.0, minZ: entryNorth, maxZ: entrySouth, zFrom: entrySouth, yFrom: 0.9, zTo: entryNorth, yTo: 0 });

  // Caixas de suprimentos encostadas às laterais do patamar de entrada, fora da passagem.
  supplyCrate(-4.65, 23.35, 0.9, 1.0);
  supplyCrate(4.65, 23.35, 0.9, 1.0);
  box(0.44, 0.035, 0.3, M.paper, -1.4, 0.925, 23.1, D0);
  box(0.35, 0.035, 0.26, M.paper, -1.25, 0.952, 23.15, { ...D0, ry: 0.18 });
  box(0.32, 0.13, 0.22, M.olive, 1.6, 0.97, 23.15, D0);
  box(0.22, 0.025, 0.05, M.brass, 1.6, 1.05, 23.15, D0);
  supplyCrate(-6.0, 17.6, 0, 1.15);
  supplyCrate(6.0, 17.6, 0, 0.82);
  planter(-7.8, 17.2, 0, 1.0);
  planter(7.8, 17.2, 0, 1.0);

  // Medalhão de mosaico no piso, colocado na aproximação ao balcão como no salão original.
  const floorSeal = new THREE.Mesh(new THREE.PlaneGeometry(4.9, 4.9), new THREE.MeshBasicMaterial({
    map: T.medallion, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2,
    side: THREE.DoubleSide,
  }));
  floorSeal.rotation.x = -Math.PI / 2;
  floorSeal.position.set(0, 0.012, 9.2);
  floorSeal.name = 'RPDFloorMedallion';
  scene.add(floorSeal);

  // ───────────────────────── Escadas duplas + galeria do 2º andar ─────────────────────────
  const N = 23, R = gy / N, L = 11, dS = L / N, zS = -1, stairWidth = 3;
  const stairCenterX = (side, t) => side * (7.05 + 0.85 * Math.sin(t * Math.PI / 2) ** 2);
  for (const sx of [-1, 1]) {
    for (let i = 0; i < N; i++) {
      const t = (i + 0.5) / N;
      const top = (i + 1) * R;
      const z = zS - (i + 0.5) * dS;
      const x = stairCenterX(sx, t);
      box(stairWidth, top, dS + 0.002, M.floor, x, top / 2, z);
      box(1.7, 0.045, dS * 0.72, M.stairCarpet, x, top + 0.027, z, D0);
      for (const edge of [-1, 1]) {
        box(0.035, 0.025, dS * 0.72, M.brass, x + edge * 0.81, top + 0.06, z, D0);
      }
    }
    // Corrimãos segmentados acompanham a curvatura suave e deixam as duas saídas abertas.
    const railSides = [-1, 1];
    for (const edge of railSides) {
      const railX = (t) => stairCenterX(sx, t) + edge * (stairWidth / 2 - 0.12);
      const railY = (t) => t * gy + 0.95;
      for (let i = 0; i <= N; i += 2) {
        const t = Math.min(1, i / N);
        const treadY = Math.max(R, t * gy);
        box(0.12, 0.82, 0.12, M.woodLt, railX(t), treadY + 0.49, zS - t * L, D0);
      }
      const segments = 6;
      for (let i = 0; i < segments; i++) {
        const t0 = i / segments, t1 = (i + 1) / segments;
        const z0 = zS - t0 * L, z1 = zS - t1 * L;
        beamBetween([railX(t0), railY(t0), z0], [railX(t1), railY(t1), z1], 0.16, M.wood);
        beamBetween([railX(t0), t0 * gy + 0.25, z0], [railX(t1), t1 * gy + 0.25, z1], 0.1, M.woodLt);
      }
    }
    for (const edge of railSides) {
      box(0.34, 0.34, 0.34, M.woodLt,
        stairCenterX(sx, edge < 0 ? 0 : 1) + edge * (stairWidth / 2 - 0.12),
        edge < 0 ? 0.9 : gy + 0.95, edge < 0 ? zS + 0.2 : -12.05, D0);
    }

    const centerStart = stairCenterX(sx, 0), centerEnd = stairCenterX(sx, 1);
    const minCenter = Math.min(centerStart, centerEnd), maxCenter = Math.max(centerStart, centerEnd);
    col.addRamp({
      minX: minCenter - stairWidth / 2, maxX: maxCenter + stairWidth / 2,
      minZ: -12, maxZ: zS, zFrom: zS, yFrom: R * 0.5, zTo: -11.8, yTo: gy,
      centerXFrom: centerStart, centerXTo: centerEnd, halfWidth: stairWidth / 2,
    });
  }

  // Piso da galeria + faixa frontal
  box(W, 0.5, 4.2, M.floor, 0, gy - 0.25, z0 + 2.1);
  const frontRailSegments = [[-11.45, -10.0], [-6.0, 6.0], [10.0, 11.45]];
  for (const [minX, maxX] of frontRailSegments) {
    const length = maxX - minX, centerX = (minX + maxX) / 2;
    box(length, 0.4, 0.34, M.trim, centerX, gy - 0.6, -11.8, D0);
    box(length, 0.12, 0.3, M.plasterLt, centerX, gy - 0.2, -11.85, D0);
  }
  for (const [minX, maxX] of frontRailSegments) {
    const centerX = (minX + maxX) / 2, length = maxX - minX;
    box(length, 0.14, 0.2, M.wood, centerX, gy + 1.0, -11.9, D0);
    box(length, 0.08, 0.14, M.woodLt, centerX, gy + 0.15, -11.9, D0);
    for (let x = minX + 0.08; x <= maxX; x += 0.8) {
      box(0.09, 0.9, 0.09, M.woodLt, x, gy + 0.45, -11.9, D0);
    }
    box(0.2, 1.12, 0.2, M.trim, minX, gy + 0.5, -11.9, D0);
    box(0.2, 1.12, 0.2, M.trim, maxX, gy + 0.5, -11.9, D0);
  }
  col.addPlatform({ minX: x0, maxX: x1, minZ: z0, maxZ: -11.8, y: gy, minEntryY: 3.2 });
  for (const [minX, maxX] of frontRailSegments) {
    col.addBox((minX + maxX) / 2, -11.9, maxX - minX, 0.2, { y0: gy + 0.45 });
  }

  // Galerias laterais: o piso segue até as paredes e fecha o saguão em U.
  // As escadas existentes chegam ao extremo norte de cada passarela.
  const balconyFront = 19.2, balconyBack = -11.85;
  const balconyLength = balconyFront - balconyBack;
  for (const sx of [-1, 1]) {
    const innerX = sx * 8.95;
    const midX = sx * 10.25;
    const midZ = (balconyFront + balconyBack) / 2;
    box(3.5, 0.5, balconyLength, M.floor, midX, gy - 0.25, midZ);
    // Friso e fascia de madeira na borda externa da varanda.
    box(0.34, 0.5, balconyLength, M.trim, sx * 11.82, gy - 0.25, midZ, D0);
    box(0.18, 0.3, balconyLength, M.wood, sx * 11.58, gy - 0.65, midZ, D0);
    box(0.18, 0.16, balconyLength, M.woodLt, sx * 11.58, gy - 0.1, midZ, D0);

    // Guarda-corpo trabalhado voltado ao vazio central; a abertura norte recebe a escada.
    const railStart = -9.6, railEnd = balconyFront - 0.55;
    const railLength = railEnd - railStart, railZ = (railStart + railEnd) / 2;
    box(0.16, 0.16, railLength, M.wood, innerX, gy + 1.0, railZ, D0);
    box(0.12, 0.1, railLength, M.woodLt, innerX, gy + 1.1, railZ, D0);
    box(0.12, 0.12, railLength, M.wood, innerX, gy + 0.25, railZ, D0);
    for (let z = railStart + 0.14; z <= railEnd - 0.1; z += 0.34) {
      cyl(0.045, 0.06, 0.68, M.woodLt, innerX, gy + 0.62, z, 6, D0);
      cyl(0.08, 0.08, 0.1, M.trim, innerX, gy + 0.38, z, 6, D0);
      cyl(0.075, 0.075, 0.1, M.trim, innerX, gy + 0.86, z, 6, D0);
    }
    for (let z = railStart; z <= railEnd; z += 2.4) {
      box(0.22, 1.08, 0.22, M.wood, innerX, gy + 0.48, z, D0);
      box(0.34, 0.15, 0.34, M.woodLt, innerX, gy + 1.08, z, D0);
      cyl(0.14, 0.14, 0.12, M.brass, innerX, gy + 0.93, z, 8, D0);
    }

    // Fechamento frontal do mezanino com corrimão, capitéis e consoles.
    {
      const z = balconyFront - 0.2;
      box(3.35, 0.92, 0.18, M.wood, midX, gy + 0.48, z, D0);
      box(3.55, 0.15, 0.28, M.woodLt, midX, gy + 0.98, z, D0);
      box(3.35, 0.22, 0.25, M.trim, midX, gy + 0.08, z, D0);
      for (const x of [sx * 8.85, sx * 11.65]) {
        box(0.42, 1.24, 0.42, M.trim, x, gy + 0.42, z, D0);
        box(0.58, 0.16, 0.58, M.woodLt, x, gy + 1.08, z, D0);
      }
    }
    for (const z of [-9, -3, 3]) {
      box(0.42, 0.55, 0.5, M.trim, sx * 11.25, gy - 0.62, z, D0);
      cyl(0.24, 0.2, 0.1, M.brass, sx * 11.25, gy - 0.28, z, 8, D0);
      box(0.2, 0.34, 0.16, M.lamp, sx * 11.25, gy + 2.55, z, DN);
    }
    col.addPlatform({
      minX: sx < 0 ? -12 : 8.5, maxX: sx < 0 ? -8.5 : 12,
      minZ: balconyBack, maxZ: balconyFront, y: gy, minEntryY: 3.7,
    });
  }

  // Vasos com folhagem nos patamares do mezanino, junto às portas laterais.
  for (const sx of [-1, 1]) {
    planter(sx * 11.0, -13.0, gy, 1.15);
    planter(sx * 11.0, 7.2, gy, 1.15);
    planter(sx * 11.0, 13.5, gy, 1.15);
  }

  // Leão sobre pedestal ornamentado, com juba, face, patas e cauda esculpidas.
  {
    const z = -14.6, y = gy;
    box(2.35, 0.28, 1.65, M.stone, 0, y + 0.14, z, D0);
    box(2.15, 0.22, 1.48, M.trim, 0, y + 0.39, z, D0);
    box(1.92, 0.55, 1.26, M.stone, 0, y + 0.76, z, D0);
    box(2.05, 0.08, 1.36, M.stone, 0, y + 1.06, z, D0);
    const lionPlaque = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.43), new THREE.MeshBasicMaterial({
      map: T.lionEmblem, transparent: true, depthWrite: false, side: THREE.DoubleSide,
    }));
    lionPlaque.position.set(0, y + 0.77, z + 0.645);
    lionPlaque.name = 'RPDLionStatuePlaque';
    scene.add(lionPlaque);

    oval(0.72, 0.45, 0.82, M.lion, 0, y + 1.43, z - 0.08, 10, 7);
    oval(0.64, 0.66, 0.49, M.lion, 0, y + 1.88, z + 0.29, 10, 7);
    oval(0.42, 0.42, 0.39, M.lion, 0, y + 2.06, z + 0.55, 9, 7);
    for (let i = 0; i < 11; i++) {
      const a = (i / 11) * Math.PI * 2;
      const tuft = new THREE.SphereGeometry(1, 6, 5);
      tuft.scale(0.17, 0.25, 0.18);
      b.geo(tuft, M.lion, Math.cos(a) * 0.46, y + 1.88 + Math.sin(a) * 0.49,
        z + 0.43 + Math.max(0, Math.sin(a)) * 0.1, { ...D0, rz: -Math.cos(a) * 0.42 });
    }
    oval(0.32, 0.27, 0.3, M.lion, 0, y + 2.03, z + 0.78, 9, 6);
    for (const sx of [-1, 1]) {
      oval(0.2, 0.14, 0.17, M.stone, sx * 0.13, y + 1.98, z + 0.88, 7, 5);
      oval(0.07, 0.055, 0.04, M.black, sx * 0.16, y + 2.15, z + 0.85, 6, 4);
      oval(0.13, 0.055, 0.09, M.lion, sx * 0.16, y + 2.22, z + 0.8, 6, 4);
    }
    oval(0.12, 0.085, 0.08, M.black, 0, y + 2.08, z + 1.03, 6, 4);
    box(0.035, 0.1, 0.025, M.black, 0, y + 1.88, z + 1.01, D0);
    for (const sx of [-1, 1]) {
      oval(0.14, 0.17, 0.12, M.lion, sx * 0.31, y + 2.34, z + 0.41, 6, 5);
      const frontLeg = new THREE.CylinderGeometry(0.18, 0.22, 0.7, 7, 2);
      b.geo(frontLeg, M.lion, sx * 0.37, y + 1.22, z + 0.42, D0);
      oval(0.22, 0.15, 0.28, M.lion, sx * 0.37, y + 0.85, z + 0.55, 7, 5);
      for (let claw = -1; claw <= 1; claw++) box(0.025, 0.025, 0.13, M.trim,
        sx * 0.37 + claw * 0.09, y + 0.79, z + 0.76, D0);
      const rearLeg = new THREE.CylinderGeometry(0.2, 0.24, 0.62, 7, 2);
      b.geo(rearLeg, M.lion, sx * 0.44, y + 1.13, z - 0.43, D0);
      oval(0.25, 0.23, 0.3, M.lion, sx * 0.44, y + 0.92, z - 0.48, 7, 5);
      oval(0.2, 0.14, 0.24, M.lion, sx * 0.44, y + 0.82, z - 0.29, 7, 5);
    }
    const tailPath = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0.46, y + 1.27, z - 0.58),
      new THREE.Vector3(0.70, y + 1.33, z - 0.75),
      new THREE.Vector3(0.72, y + 1.70, z - 0.78),
      new THREE.Vector3(0.57, y + 1.83, z - 0.74),
    ]);
    b.geo(new THREE.TubeGeometry(tailPath, 10, 0.07, 6, false), M.lion, 0, 0, 0, D0);
    col.addBox(0, z, 2.1, 1.4, { y0: 4.0 });
  }

  // ───────────────────────── Estátua da deusa (centro do saguão) ─────────────────────────
  {
    const sx = 0, sz = -5;
    octagonalTier(4.9, 4.9, 0.25, M.stone, sx, 0, sz, 0.17);
    octagonalTier(4.45, 4.45, 0.18, M.trim, sx, 0.25, sz, 0.17);
    octagonalTier(3.95, 3.95, 0.3, M.stone, sx, 0.43, sz, 0.15);
    octagonalTier(2.9, 2.9, 1.34, M.stone, sx, 0.73, sz, 0.12);
    octagonalTier(3.24, 3.24, 0.2, M.trim, sx, 2.07, sz, 0.14);
    octagonalTier(3.5, 3.5, 0.14, M.stone, sx, 2.27, sz, 0.14);
    box(1.35, 0.68, 0.08, M.stone, sx, 1.56, sz + 1.44, D0);
    box(1.1, 0.48, 0.035, M.trim, sx, 1.56, sz + 1.5, D0);
    box(0.82, 0.32, 0.025, M.brass, sx, 1.56, sz + 1.53, D0);
    const pedestalSeal = new THREE.Mesh(
      new THREE.PlaneGeometry(0.46, 0.46),
      new THREE.MeshBasicMaterial({
        map: T.medallion, transparent: true, depthWrite: false, side: THREE.DoubleSide,
      }),
    );
    pedestalSeal.position.set(sx, 1.56, sz + 1.55);
    pedestalSeal.renderOrder = 1;
    pedestalSeal.name = 'RPDStatuePedestalSeal';
    scene.add(pedestalSeal);
    const robe = new THREE.LatheGeometry([
      new THREE.Vector2(0.88, -1.05), new THREE.Vector2(0.96, -0.92),
      new THREE.Vector2(0.82, -0.72), new THREE.Vector2(0.68, -0.42),
      new THREE.Vector2(0.46, -0.08), new THREE.Vector2(0.36, 0.18),
      new THREE.Vector2(0.39, 0.38), new THREE.Vector2(0.28, 0.56),
    ], 9);
    b.geo(robe, M.statue, sx, 3.65, sz, D0);
    // Pregas finas esculpidas na frente do manto, em vez de uma coluna lisa.
    for (const foldX of [-0.58, -0.34, -0.12, 0.12, 0.34, 0.58]) {
      const edge = Math.abs(foldX);
      const fold = new THREE.CatmullRomCurve3([
        new THREE.Vector3(foldX * 0.68, 2.64, sz + 0.78 - edge * 0.14),
        new THREE.Vector3(foldX * 0.9, 3.05, sz + 0.79 - edge * 0.2),
        new THREE.Vector3(foldX, 3.52, sz + 0.57 - edge * 0.22),
        new THREE.Vector3(foldX * 0.78, 4.05, sz + 0.43 - edge * 0.15),
      ]);
      b.geo(new THREE.TubeGeometry(fold, 7, 0.018, 5, false), M.trim, 0, 0, 0, D0);
    }
    const torso = new THREE.LatheGeometry([
      new THREE.Vector2(0.27, -0.45), new THREE.Vector2(0.32, -0.32),
      new THREE.Vector2(0.29, -0.08), new THREE.Vector2(0.37, 0.14),
      new THREE.Vector2(0.44, 0.30), new THREE.Vector2(0.31, 0.45),
    ], 8);
    b.geo(torso, M.statue, sx, 5.15, sz, D0);
    oval(0.48, 0.17, 0.28, M.statue, sx, 5.44, sz, 8, 5, D0); // ombros talhados
    cyl(0.12, 0.16, 0.3, M.statue, sx, 5.7, sz, 7);
    // Cabeça esculpida com cabelo, orelhas e planos do rosto legíveis no render de baixa resolução.
    oval(0.29, 0.35, 0.28, M.statue, sx, 6.0, sz, 10, 8, D0);
    oval(0.34, 0.13, 0.31, M.statue, sx, 6.22, sz - 0.045, 9, 6, D0);
    oval(0.075, 0.09, 0.07, M.statue, sx - 0.29, 5.98, sz, 6, 5, D0);
    oval(0.075, 0.09, 0.07, M.statue, sx + 0.29, 5.98, sz, 6, 5, D0);
    for (const ex of [-1, 1]) {
      oval(0.075, 0.035, 0.035, M.recess, sx + ex * 0.11, 6.035, sz + 0.245, 6, 4, D0);
      oval(0.095, 0.028, 0.04, M.statue, sx + ex * 0.11, 6.09, sz + 0.255, 6, 4, D0);
    }
    oval(0.055, 0.12, 0.055, M.statue, sx, 5.99, sz + 0.27, 6, 5, D0); // nariz
    oval(0.075, 0.025, 0.025, M.recess, sx, 5.91, sz + 0.275, 6, 4, D0); // boca
    cyl(0.33, 0.36, 0.14, M.statue, sx, 6.25, sz, 8, D0);        // diadema
    const arm = (length) => new THREE.LatheGeometry([
      new THREE.Vector2(0.075, -length), new THREE.Vector2(0.105, -length * 0.88),
      new THREE.Vector2(0.12, -length * 0.58), new THREE.Vector2(0.095, -length * 0.48),
      new THREE.Vector2(0.14, -length * 0.22), new THREE.Vector2(0.12, 0),
    ], 6);
    b.geo(arm(1.15), M.statue, sx - 0.72, 4.85, sz, { ...D0, rz: 0.12 }); // braço esquerdo
    b.geo(arm(1.15), M.statue, sx + 0.78, 6.22, sz, { ...D0, rz: -0.42 }); // braço erguido
    oval(0.16, 0.13, 0.13, M.statue, sx + 0.92, 6.63, sz + 0.04, 7, 5, D0); // mão
    oval(0.15, 0.2, 0.14, M.statue, sx - 0.72, 3.67, sz + 0.06, 7, 5, D0); // mão junto ao manto
    box(1.3, 0.06, 0.06, M.brass, sx + 1.15, 6.75, sz, D0);                   // balança
    cyl(0.28, 0.2, 0.08, M.brass, sx + 0.55, 6.3, sz, 8, D0);
    cyl(0.28, 0.2, 0.08, M.brass, sx + 1.75, 6.3, sz, 8, D0);
    box(0.04, 0.45, 0.04, M.brass, sx + 1.15, 6.55, sz, D0);
    col.addBox(sx, sz, 5.2, 5.2, {});
  }

  // ───────────────────────── Balcão da recepção ─────────────────────────
  {
    const dz = 5.0;
    softBox(8.2, 0.14, 0.3, M.trim, 0, 0.07, dz + 0.8, D0, 0.045);
    softBox(8.0, 1.0, 1.6, M.wood, 0, 0.62, dz, D0, 0.09);
    for (let x = -3.4; x <= 3.41; x += 1.7) {
      softBox(1.42, 0.76, 0.08, M.trim, x, 0.62, dz + 0.83, D0, 0.025);
      softBox(1.20, 0.56, 0.04, M.wood, x, 0.62, dz + 0.89, D0, 0.018);
      softBox(1.04, 0.34, 0.025, M.woodLt, x, 0.62, dz + 0.92, D0, 0.01);
      softBox(0.92, 0.22, 0.025, M.wood, x, 0.62, dz + 0.94, D0, 0.01);
      softBox(1.13, 0.035, 0.04, M.brass, x, 0.99, dz + 0.94, D0, 0.012);
      softBox(1.13, 0.035, 0.04, M.brass, x, 0.25, dz + 0.94, D0, 0.012);
      cyl(0.055, 0.055, 0.035, M.brass, x - 0.52, 0.62, dz + 0.98, 8, D0);
      cyl(0.055, 0.055, 0.035, M.brass, x + 0.52, 0.62, dz + 0.98, 8, D0);
    }
    softBox(8.4, 0.14, 1.9, M.woodLt, 0, 1.19, dz, D0, 0.055);
    softBox(8.4, 0.08, 0.1, M.brass, 0, 1.0, dz + 0.9, D0, 0.025);
    // terminal de computador (tela voltada para o lado do atendente = norte)
    softBox(0.52, 0.04, 0.42, M.black, -2.4, 1.28, dz, D0, 0.018);
    softBox(0.5, 0.4, 0.4, M.black, -2.4, 1.5, dz + 0.05, D0, 0.04);
    softBox(0.4, 0.3, 0.02, M.screen, -2.4, 1.52, dz - 0.16, DN, 0.008);
    softBox(0.42, 0.04, 0.14, M.black, -2.4, 1.27, dz - 0.45, D0, 0.015);
    // máquina de escrever + fita de tinta
    box(0.5, 0.18, 0.4, M.black, 0.9, 1.35, dz, D0);
    box(0.34, 0.03, 0.22, M.paper, 0.9, 1.45, dz - 0.12, { cam: false, rx: -0.3 });
    // caixa de munição de pistola
    box(0.3, 0.1, 0.2, M.olive, 2.9, 1.31, dz, D0);
    // papéis
    box(0.4, 0.015, 0.3, M.paper, -0.8, 1.27, dz + 0.2, D0);
    box(0.36, 0.015, 0.28, M.paper, -1.0, 1.285, dz + 0.25, { cam: false, ry: 0.4 });
    // Abajures, pastas de expediente e bandejas quebram a linha lisa do tampo.
    for (const x of [-3.1, 0, 3.1]) {
      cyl(0.19, 0.24, 0.06, M.brass, x, 1.31, dz - 0.18, 8, D0);
      cyl(0.045, 0.045, 0.4, M.black, x, 1.53, dz - 0.18, 6, D0);
      oval(0.22, 0.08, 0.18, M.lamp, x, 1.76, dz - 0.18, 7, 4, DN);
    }
    for (const [x, color] of [[-1.4, 0x6b3029], [1.75, 0x555842]]) {
      const fileMaterial = new THREE.MeshLambertMaterial({ color, flatShading: true });
      box(0.42, 0.08, 0.3, fileMaterial, x, 1.32, dz + 0.2, D0);
      box(0.4, 0.05, 0.28, M.paper, x, 1.39, dz + 0.2, D0);
      box(0.08, 0.04, 0.03, M.brass, x - 0.13, 1.42, dz + 0.05, D0);
    }
    // baú de itens atrás do balcão
    box(1.1, 0.62, 0.7, M.metal, 3.7, 0.31, 3.0, D0);
    box(1.14, 0.12, 0.74, M.black, 3.7, 0.68, 3.0, D0);
    box(0.18, 0.12, 0.04, M.brass, 3.7, 0.5, 3.37, D0);
    col.addBox(0, dz, 8.6, 2.0, {});
    col.addBox(3.7, 3.0, 1.2, 0.8, {});
  }

  // Área de espera lateral: bancos estofados, mesas baixas e luminárias de apoio.
  const waitingBench = (x, z, yaw) => {
    b.push(x, 0, z, yaw);
    softBox(2.35, 0.18, 0.68, M.wood, 0, 0.56, 0, D0, 0.07);
    softBox(2.16, 0.22, 0.56, M.upholstery, 0, 0.72, 0.02, D0, 0.09);
    softBox(2.35, 0.72, 0.16, M.wood, 0, 1.02, -0.28, D0, 0.07);
    softBox(2.12, 0.48, 0.12, M.upholstery, 0, 1.03, -0.18, D0, 0.055);
    for (const tx of [-0.68, 0, 0.68]) for (const tz of [-0.12, 0.16]) {
      oval(0.026, 0.012, 0.026, M.black, tx, 0.835, tz, 6, 4, D0);
    }
    for (const tx of [-0.68, 0, 0.68]) for (const ty of [0.88, 1.06, 1.24]) {
      oval(0.021, 0.021, 0.012, M.black, tx, ty, -0.112, 6, 4, D0);
    }
    for (const sx of [-1, 1]) {
      softBox(0.18, 0.68, 0.72, M.woodLt, sx * 1.16, 0.78, 0.02, D0, 0.07);
      softBox(0.12, 0.16, 0.78, M.trim, sx * 1.16, 1.16, 0.02, D0, 0.05);
      for (const zz of [-0.24, 0.24]) {
        cyl(0.05, 0.075, 0.52, M.black, sx * 0.93, 0.28, zz, 7, D0);
        cyl(0.078, 0.078, 0.035, M.brass, sx * 0.93, 0.08, zz, 7, D0);
      }
    }
    b.pop();
    col.addBox(x, z, 1.0, 2.5, {});
  };
  waitingBench(-9.15, 7.8, Math.PI / 2);
  waitingBench(9.15, 7.8, -Math.PI / 2);

  // Mesas laterais de atendimento com telefone, fichário e papelada.
  for (const sx of [-1, 1]) {
    const x = sx * 8.9, z = 11.4;
    box(1.45, 0.14, 0.78, M.wood, x, 0.78, z, D0);
    box(1.56, 0.08, 0.86, M.trim, x, 0.86, z, D0);
    for (const dx of [-0.58, 0.58]) for (const dz of [-0.28, 0.28]) box(0.1, 0.72, 0.1, M.woodLt, x + dx, 0.39, z + dz, D0);
    box(0.46, 0.05, 0.32, M.paper, x - 0.28, 0.93, z - 0.06, D0);
    box(0.32, 0.03, 0.24, M.paper, x - 0.26, 0.97, z - 0.04, { cam: false, ry: 0.18 });
    box(0.24, 0.16, 0.22, M.black, x + 0.37, 0.99, z + 0.08, D0);
    col.addBox(x, z, 1.5, 0.9, {});
  }

  // Papéis espalhados pelo chão e manchas — o saguão já foi abandonado às pressas
  {
    let s = 7; const r = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
    for (let i = 0; i < 16; i++) {
      const x = (r() - 0.5) * 18, z = 12 - r() * 14;
      if (Math.abs(x) < 4.4 && z > 3.8 && z < 6.2) continue;
      box(0.32 + r() * 0.1, 0.008, 0.24 + r() * 0.08, M.paper, x, 0.006, z, { cam: false, cast: false, ry: r() * 6.28 });
    }
    const stain = new THREE.MeshLambertMaterial({ color: 0x2b1311, transparent: true, opacity: 0.6, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
    for (const [x, z, sc] of [[-1.2, 10.2, 1.1], [2.2, 8.2, 0.7], [-6.3, 2.4, 0.9]]) {
      const m = new THREE.Mesh(new THREE.CircleGeometry(sc, 9), stain);
      m.rotation.x = -Math.PI / 2; m.position.set(x, 0.012, z); m.scale.set(1, 1.5, 1); scene.add(m);
    }
  }

  // Erva verde perto da escada oeste (item colecionável)
  const herb = new THREE.Group();
  {
    const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.15, 0.3, 6), new THREE.MeshLambertMaterial({ color: 0x6b4a34, flatShading: true }));
    pot.position.y = 0.15; herb.add(pot);
    for (let i = 0; i < 7; i++) {
      const lf = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.5, 0.18), M.green);
      const a = (i / 7) * Math.PI * 2;
      lf.position.set(Math.cos(a) * 0.1, 0.55, Math.sin(a) * 0.1);
      lf.rotation.set(Math.sin(a) * 0.5, -a, Math.cos(a) * 0.5);
      herb.add(lf);
    }
    herb.position.set(-7.6, 0, 0.7);
    scene.add(herb);
  }

  // ───────────────────────── Luz ─────────────────────────
  const hemi = new THREE.HemisphereLight(0x84919a, 0x332d25, 0.48);
  scene.add(hemi);
  const spot = new THREE.SpotLight(0xffd8a6, 92, 27, 0.48, 0.62, 1.6);
  spot.position.set(0, h - 0.9, -0.5);
  spot.target.position.set(0, 4.0, -5);
  scene.add(spot, spot.target);

  // Luz de preenchimento nas laterais das escadas (senão os degraus ficam pretos)
  for (const sx of [-1, 1]) {
    const L = new THREE.PointLight(0xffb878, 6, 12, 1.6);
    L.position.set(sx * 6.4, 2.2, -5.5);
    scene.add(L); lights.push(L);
  }

  // ───────────────────────── Interações ─────────────────────────
  const state = { doorsUnlocked: false, herb: false, ammo: false };
  const P = (x, z, y = 0) => new THREE.Vector3(x, y, z);
  const door = (id, pos, y, label) => {
    const item = {
      id, pos, y, radius: 2.1, label,
      onUse: (c) => {
        if (id === 'door-north') {
          if (northDoor.target === 0) {
            northDoor.target = 1;
            item.label = 'Entrar na rua';
            pendingDoorTransition = { seconds: 0.85, transition: () => c.transition('street') };
            c.toast('A porta verde se abre para a rua escura.');
          } else {
            c.transition('street');
          }
          return;
        }
        if (id === 'door-front') { c.toast('As portas principais estão trancadas.'); return; }
        c.toast(state.doorsUnlocked && id !== 'door-north'
          ? 'A porta está destravada. As outras salas ainda estão em desenvolvimento.'
          : 'Trancada.');
      },
    };
    if (id === 'door-north') northDoorItem = item;
    props.push(item);
  };
  props.push(
    { id: 'terminal', pos: P(-2.4, 4.6), y: 0, radius: 1.8, label: 'Usar terminal',
      onUse: (c) => { c.toast(state.doorsUnlocked
        ? 'TERMINAL — Escritórios Oeste e Leste já estão destravados.'
        : 'TERMINAL — Duas portas foram destravadas: ESCRITÓRIO OESTE e ESCRITÓRIO LESTE.'); state.doorsUnlocked = true; } },
    { id: 'typewriter', pos: P(0.9, 4.6), y: 0, radius: 1.5, label: 'Usar máquina de escrever',
      onUse: (c) => c.toast('Fita de tinta usada. Progresso salvo.') },
    { id: 'ammo', pos: P(2.9, 4.6), y: 0, radius: 1.3, label: 'Pegar munição de pistola',
      enabled: () => !state.ammo, onUse: (c) => { state.ammo = true; c.addAmmo(15); c.toast('Você pegou: Munição de pistola ×15'); } },
    { id: 'chest', pos: P(3.7, 3.0), y: 0, radius: 1.7, label: 'Abrir baú de itens',
      onUse: (c) => c.toast('Baú de itens (vazio).') },
    { id: 'herb', pos: P(-7.6, 0.7), y: 0, radius: 1.6, label: 'Pegar erva verde',
      enabled: () => !state.herb, onUse: (c) => { state.herb = true; herb.visible = false; c.toast('Você pegou: Erva Verde'); } },
    { id: 'statue', pos: P(0, -5), y: 0, radius: 4.2, label: 'Examinar estátua da deusa',
      onUse: (c) => c.toast('Na base da estátua há um encaixe vazio. Parece feito para um medalhão.') },
    { id: 'fuse', pos: P(-4.55, 23.2), y: 0.9, radius: 1.8, label: 'Examinar caixa de fusíveis',
      onUse: (c) => c.toast('Caixa de fusíveis. Falta uma peça.') },
    { id: 'lion', pos: P(0, -14.4), y: gy, radius: 2.2, label: 'Examinar estátua do leão',
      onUse: (c) => c.toast('Um leão de pedra, voltado para a janela. A tempestade o recorta contra o vidro.') },
  );
  door('door-west', P(-11.3, 3), 0, 'Abrir porta (Escritório Oeste)');
  door('door-east', P(11.3, 3), 0, 'Abrir porta (Escritório Leste)');
  door('door-north', P(0, -14.5), 0, 'Abrir porta verde');
  door('door-front', P(0, 23.2), 0.9, 'Portas de entrada');

  // ───────────────────────── Colisão do perímetro ─────────────────────────
  col.addBox(-6.9, z0 + 0.25, 10.2, 0.55);
  col.addBox(6.9, z0 + 0.25, 10.2, 0.55);
  col.addBox(0, z0 - 0.3, W + 2, 0.6, {});
  col.addBox(-7.3, z1 + 0.3, 10.6, 0.6, {});
  col.addBox(7.3, z1 + 0.3, 10.6, 0.6, {});
  col.addBox(x0 - 0.3, cz, 0.6, D + 2, {});
  col.addBox(x1 + 0.3, cz, 0.6, D + 2, {});

  const { occluders } = b.finish(scene);
  const northDoor = animatedDoors[0];
  const resetEntrance = () => {
    northDoor.target = 0;
    pendingDoorTransition = null;
    if (northDoorItem) northDoorItem.label = 'Abrir porta verde';
  };

  // ───────────────────────── Atmosfera: raios e lâmpada falhando ─────────────────────────
  let flash = 0, nextFlash = 3.5;
  const hemiBase = hemi.intensity;
  function update(t, dt) {
    for (const doorState of animatedDoors) {
      for (const leaf of doorState.leaves) {
        const side = leaf.position.x < 0 ? -1 : 1;
        const target = doorState.target * side * 1.3;
        leaf.rotation.y += (target - leaf.rotation.y) * Math.min(1, dt * 4.5);
      }
    }
    if (pendingDoorTransition) {
      pendingDoorTransition.seconds -= dt;
      if (pendingDoorTransition.seconds <= 0) {
        const transition = pendingDoorTransition.transition;
        pendingDoorTransition = null;
        transition();
      }
    }
    nextFlash -= dt;
    if (nextFlash < 0) { flash = 1; nextFlash = 6 + Math.random() * 10; }
    flash = Math.max(0, flash - dt * (flash > 0.55 ? 2.4 : 1.1));
    const f = flash * (0.65 + 0.35 * Math.sin(t * 61));
    M.glass.color.setScalar(1 + f * 5);
    hemi.intensity = hemiBase + f * 2.4;
    if (flickerLight) flickerLight.intensity = flickerLight.userData.base * (0.88 + 0.12 * Math.sin(t * 11) - (Math.random() < 0.015 ? 0.55 : 0));
  }

  return {
    collisions: col, occluders, props, update, state, lights,
    resetEntrance,
    spawn: { x: 0, z: 19.35, y: 0.12, yaw: Math.PI },   // entrada, olhando para o saguão
  };
}
