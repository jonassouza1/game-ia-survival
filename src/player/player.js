import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { retargetMixamoClip } from './retarget.js';
import { createGait } from './locomotion.js';
import { createSidearm, SIDEARM } from './sidearm.js';

const clamp = THREE.MathUtils.clamp;

// Câmera sobre o ombro e parâmetros de movimentação no estilo do remake.
const CAM = { distFree: 3.1, distAim: 2.4, shoulderFree: 0.8, shoulderAim: 0.72,
  height: 1.62, fovFree: 58, fovAim: 38, pitchMin: -0.62, pitchMax: 0.5 };
const SPEED = { jog: 2.75, walk: 1.42, run: 4.35, aim: 1.18, accel: 4.7, brake: 7.8, turn: 5.1 };
const angleDiff = (a, b) => ((b - a + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;

function makePistol() {
  const weapon = new THREE.Group();
  weapon.name = 'ServicePistol';
  const steel = new THREE.MeshLambertMaterial({ color: 0x92948d, emissive: 0x111312, flatShading: true });
  const edge = new THREE.MeshLambertMaterial({ color: 0xb0a995, flatShading: true });
  const dark = new THREE.MeshLambertMaterial({ color: 0x303432, flatShading: true });
  const grip = new THREE.MeshLambertMaterial({ color: 0x242a28, flatShading: true });
  const addProfile = (points, thickness, material, sideOffset = 0) => {
    const shape = new THREE.Shape();
    points.forEach(([z, y], index) => {
      if (index === 0) shape.moveTo(z, y);
      else shape.lineTo(z, y);
    });
    shape.closePath();
    const geometry = new THREE.ExtrudeGeometry(shape, {
      depth: thickness, bevelEnabled: true, bevelSegments: 1,
      bevelSize: 0.002, bevelThickness: 0.002,
    });
    geometry.translate(0, 0, -thickness / 2);
    geometry.rotateY(-Math.PI / 2);
    const part = new THREE.Mesh(geometry, material);
    part.position.x = sideOffset;
    part.castShadow = true;
    weapon.add(part);
    return part;
  };
  addProfile([
    [-0.015, -0.012], [0.015, 0.012], [0.07, 0.026], [0.238, 0.026],
    [0.267, 0.044], [0.267, 0.073], [0.245, 0.09], [0.045, 0.09],
    [0.017, 0.071], [0.005, 0.04],
  ], 0.052, steel);
  addProfile([
    [0.018, 0.035], [0.225, 0.035], [0.218, 0.006], [0.105, 0.002],
    [0.076, -0.025], [0.035, -0.073], [-0.012, -0.091], [-0.047, -0.078],
    [-0.039, -0.052], [-0.002, -0.005],
  ], 0.05, dark);
  addProfile([
    [-0.038, -0.071], [-0.012, -0.084], [0.024, -0.039],
    [0.005, -0.012], [-0.018, -0.025],
  ], 0.055, grip, 0.001);
  for (let i = 0; i < 5; i++) {
    const groove = new THREE.Mesh(new THREE.BoxGeometry(0.002, 0.004, 0.018), dark);
    groove.position.set(0.029, -0.066 + i * 0.006, -0.029 + i * 0.009);
    weapon.add(groove);
  }
  const triggerPath = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 0.025, 0.085),
    new THREE.Vector3(0, -0.005, 0.155),
    new THREE.Vector3(0, -0.043, 0.145),
    new THREE.Vector3(0, -0.043, 0.095),
    new THREE.Vector3(0, -0.005, 0.075),
  ]);
  weapon.add(new THREE.Mesh(new THREE.TubeGeometry(triggerPath, 8, 0.004, 4, false), edge));
  const ejectionPort = new THREE.Mesh(new THREE.BoxGeometry(0.004, 0.018, 0.043), dark);
  ejectionPort.position.set(0.028, 0.062, 0.139);
  weapon.add(ejectionPort);
  for (const z of [0.065, 0.225]) {
    const serration = new THREE.Mesh(new THREE.BoxGeometry(0.004, 0.004, 0.006), edge);
    serration.position.set(0.028, 0.078, z);
    weapon.add(serration);
  }
  for (const z of [0.025, 0.245]) {
    const sight = new THREE.Mesh(new THREE.BoxGeometry(0.016, 0.012, 0.018), dark);
    sight.position.set(0, 0.096, z);
    weapon.add(sight);
  }
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.009, 0.009, 0.045, 8), dark);
  barrel.rotation.x = Math.PI / 2;
  barrel.position.set(0, 0.055, 0.25);
  weapon.add(barrel);
  const muzzle = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.011, 0.006, 8), edge);
  muzzle.rotation.x = Math.PI / 2;
  muzzle.position.set(0, 0.055, 0.274);
  weapon.add(muzzle);
  const flash = new THREE.Mesh(
    new THREE.ConeGeometry(0.026, 0.11, 5),
    new THREE.MeshBasicMaterial({ color: 0xffc35a }),
  );
  flash.rotation.x = Math.PI / 2;
  flash.position.set(0, 0.055, 0.33);
  flash.castShadow = true;
  weapon.add(flash);
  flash.visible = false;
  return { weapon, muzzleFlash: flash };
}

function buildModel() {
  const root = new THREE.Group();

  const makeTexture = (width, height, paint) => {
    const canvas = document.createElement('canvas');
    canvas.width = width; canvas.height = height;
    const ctx = canvas.getContext('2d'); ctx.imageSmoothingEnabled = false;
    paint(ctx, width, height);
    const map = new THREE.CanvasTexture(canvas);
    map.colorSpace = THREE.SRGBColorSpace;
    map.magFilter = THREE.NearestFilter; map.minFilter = THREE.NearestFilter;
    return map;
  };
  const fabricTexture = (base, seed, style = 'cloth') => makeTexture(128, 128, (ctx, w, h) => {
    ctx.fillStyle = base; ctx.fillRect(0, 0, w, h);
    let state = seed >>> 0;
    const rnd = () => ((state = (Math.imul(state, 1664525) + 1013904223) >>> 0) / 4294967296);
    for (let i = 0; i < 320; i++) {
      ctx.fillStyle = rnd() < .55 ? 'rgba(12,17,21,.13)' : 'rgba(195,198,187,.10)';
      ctx.fillRect(rnd() * w | 0, rnd() * h | 0, 1 + (rnd() < .08 ? 1 : 0), 1);
    }
    // Broad, irregular dye variation keeps the low-resolution cloth from reading as a grid.
    const wear = ctx.createLinearGradient(0, 0, w, h);
    wear.addColorStop(0, 'rgba(191,190,177,.10)');
    wear.addColorStop(.42, 'rgba(15,20,24,.05)');
    wear.addColorStop(1, 'rgba(7,11,15,.24)');
    ctx.fillStyle = wear; ctx.fillRect(0, 0, w, h);
    if (style === 'jacket') {
      // UV da frente passa pelas bordas do mapa; as costas ficam no centro.
      // Front half of the cylindrical UV atlas wraps across both texture edges.
      // Keep chest pockets away from the seam so they land on either side of the sternum.
      ctx.fillStyle = '#222d34'; ctx.fillRect(12, 37, 16, 17); ctx.fillRect(w - 28, 37, 16, 17);
      ctx.fillStyle = 'rgba(156,169,171,.54)';
      ctx.fillRect(13, 37, 14, 2); ctx.fillRect(w - 27, 37, 14, 2);
      ctx.fillStyle = 'rgba(14,23,29,.60)';
      ctx.fillRect(12, 45, 16, 2); ctx.fillRect(w - 28, 45, 16, 2);
      ctx.fillStyle = 'rgba(183,173,145,.60)';
      ctx.fillRect(19, 48, 2, 2); ctx.fillRect(w - 21, 48, 2, 2);
      ctx.fillStyle = 'rgba(15,21,25,.62)'; ctx.fillRect(0, 0, w, 5);
      // Large stitched rear shield and vest seams remain readable at the PS1 render size.
      ctx.fillStyle = '#202a30'; ctx.fillRect(48, 31, 32, 31);
      ctx.fillStyle = 'rgba(165,171,165,.58)'; ctx.fillRect(49, 32, 30, 1); ctx.fillRect(49, 60, 30, 1);
      ctx.fillStyle = 'rgba(9,14,17,.58)'; ctx.fillRect(51, 34, 26, 25);
      ctx.fillStyle = '#d0c6a8'; ctx.font = 'bold 8px monospace'; ctx.textAlign = 'center';
      ctx.fillText('RPD', 64, 46);
      ctx.fillStyle = '#b6ad95'; ctx.font = '5px monospace'; ctx.fillText('POLICE', 64, 54);
      ctx.fillStyle = 'rgba(176,187,188,.22)'; ctx.fillRect(39, 31, 3, 61); ctx.fillRect(86, 31, 3, 61);
      ctx.fillStyle = 'rgba(10,15,18,.28)'; ctx.fillRect(45, 65, 38, 3); ctx.fillRect(45, 91, 38, 2);
      // A restrained front closure and collar, repeated at the UV seam on both front edges.
      ctx.fillStyle = 'rgba(19,25,29,.68)';
      ctx.beginPath(); ctx.moveTo(0, 7); ctx.lineTo(13, 13); ctx.lineTo(7, 23); ctx.lineTo(0, 20); ctx.fill();
      ctx.beginPath(); ctx.moveTo(w, 7); ctx.lineTo(w - 13, 13); ctx.lineTo(w - 7, 23); ctx.lineTo(w, 20); ctx.fill();
      ctx.fillStyle = 'rgba(184,187,176,.36)';
      ctx.fillRect(0, 24, 1, 63); ctx.fillRect(w - 1, 24, 1, 63);
      ctx.fillStyle = 'rgba(184,187,176,.45)';
      ctx.fillRect(2, 72, 7, 1); ctx.fillRect(w - 9, 72, 7, 1);
      ctx.fillStyle = 'rgba(11,17,20,.65)'; ctx.fillRect(0, 113, w, 5);
      ctx.fillStyle = 'rgba(198,189,161,.18)'; ctx.fillRect(0, 111, w, 1);
      // Broad hand-painted folds and panel seams survive the game's 320px framebuffer.
      ctx.fillStyle = 'rgba(8,13,18,.22)';
      ctx.fillRect(39, 22, 2, 82); ctx.fillRect(87, 22, 2, 82);
      ctx.fillRect(42, 27, 2, 12); ctx.fillRect(84, 27, 2, 12);
      ctx.fillStyle = 'rgba(176,187,188,.16)';
      ctx.fillRect(41, 22, 1, 80); ctx.fillRect(89, 22, 1, 80);
      ctx.fillRect(20, 28, 20, 2); ctx.fillRect(88, 28, 20, 2);
    } else if (style === 'sleeve') {
      ctx.fillStyle = 'rgba(8,13,18,.30)';
      ctx.fillRect(30, 0, 2, h); ctx.fillRect(96, 0, 2, h);
      ctx.fillRect(0, 18, w, 2); ctx.fillRect(0, 82, w, 1);
      ctx.fillStyle = 'rgba(177,188,190,.19)';
      ctx.fillRect(33, 0, 1, h); ctx.fillRect(93, 0, 1, h);
      ctx.fillRect(0, 20, w, 1);
    } else if (style === 'trousers') {
      ctx.fillStyle = 'rgba(12,17,21,.45)';
      ctx.fillRect(20, 26, 23, 18); ctx.fillRect(84, 26, 23, 18);
      ctx.fillStyle = 'rgba(164,169,165,.28)';
      ctx.fillRect(21, 27, 21, 1); ctx.fillRect(85, 27, 21, 1);
      ctx.fillStyle = 'rgba(8,12,16,.38)'; ctx.fillRect(62, 0, 2, h);
    } else {
      ctx.fillStyle = 'rgba(220,210,190,.15)'; ctx.fillRect(0, 18, w, 2);
      ctx.fillStyle = 'rgba(14,18,19,.22)'; ctx.fillRect(0, 20, w, 2);
    }
  });
  const jacket = new THREE.MeshLambertMaterial({
    map: fabricTexture('#3b4140', 32, 'jacket'), color: 0xffffff, emissive: 0x090b0b, flatShading: false,
  });
  const sleeve = new THREE.MeshLambertMaterial({
    map: fabricTexture('#474f4d', 38, 'sleeve'), color: 0xffffff, emissive: 0x0c0e0d, flatShading: false,
  });
  const trousers = new THREE.MeshLambertMaterial({
    map: fabricTexture('#39434c', 51, 'trousers'), color: 0xffffff, flatShading: false,
  });
  const shirt = new THREE.MeshLambertMaterial({ color: 0x65706c, flatShading: false });
  const faceMap = makeTexture(128, 128, (ctx, w, h) => {
    ctx.fillStyle = '#aa836a'; ctx.fillRect(0, 0, w, h);
    const shade = ctx.createLinearGradient(0, 0, w, 0);
    shade.addColorStop(0, 'rgba(48,35,27,.36)'); shade.addColorStop(.18, 'rgba(48,35,27,.03)');
    shade.addColorStop(.82, 'rgba(48,35,27,.03)'); shade.addColorStop(1, 'rgba(48,35,27,.36)');
    ctx.fillStyle = shade; ctx.fillRect(0, 0, w, h);
    // UV seam is at the front of the face. Features are painted on both sides of it.
    for (const x of [5, 117]) {
      ctx.fillStyle = '#392d26'; ctx.fillRect(x - 1, 47, 9, 2);
      ctx.fillStyle = '#d7b598'; ctx.fillRect(x, 54, 7, 4);
      ctx.fillStyle = '#343333'; ctx.fillRect(x + 2, 54, 3, 4);
    }
    ctx.fillStyle = 'rgba(64,43,33,.24)'; ctx.fillRect(0, 58, 3, 19); ctx.fillRect(w - 3, 58, 3, 19);
    ctx.fillStyle = 'rgba(226,187,151,.28)'; ctx.fillRect(0, 64, 2, 8); ctx.fillRect(w - 2, 64, 2, 8);
    ctx.fillStyle = '#755044'; ctx.fillRect(0, 91, 4, 2); ctx.fillRect(w - 4, 91, 4, 2);
    ctx.fillStyle = 'rgba(60,40,30,.18)'; ctx.fillRect(0, 101, w, 5);
  });
  const skin = new THREE.MeshLambertMaterial({ map: faceMap, color: 0xffffff, flatShading: false });
  const hairMap = makeTexture(64, 64, (ctx, w, h) => {
    ctx.fillStyle = '#493b2e'; ctx.fillRect(0, 0, w, h);
    const shade = ctx.createLinearGradient(0, 0, w, h);
    shade.addColorStop(0, '#94764d'); shade.addColorStop(.45, '#70583a'); shade.addColorStop(1, '#302b27');
    ctx.fillStyle = shade; ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = 'rgba(207,175,119,.38)'; ctx.lineWidth = 2;
    for (let i = 0; i < 7; i++) {
      ctx.beginPath(); ctx.moveTo(5 + i * 8, 54); ctx.quadraticCurveTo(16 + i * 5, 25, 22 + i * 4, 5); ctx.stroke();
    }
  });
  const hair = new THREE.MeshLambertMaterial({ map: hairMap, color: 0xffffff, flatShading: false });
  const boot = new THREE.MeshLambertMaterial({ color: 0x242526, flatShading: true });
  const leather = new THREE.MeshLambertMaterial({ color: 0x303438, flatShading: true });
  const eye = new THREE.MeshBasicMaterial({ color: 0x29241e });
  const eyeWhite = new THREE.MeshBasicMaterial({ color: 0xc2b6a0 });

  // Loft meshes are shaped from human proportions, rather than scaled cubes/capsules.
  function loftGeometry(rings, sides = 8) {
    const g = new THREE.BufferGeometry();
    const positions = [], uvs = [], indices = [];
    const minY = rings[0].y, maxY = rings[rings.length - 1].y;
    rings.forEach((ring) => {
      for (let i = 0; i < sides; i++) {
        const a = (i / sides) * Math.PI * 2;
        positions.push((ring.cx || 0) + Math.sin(a) * ring.rx, ring.y, (ring.cz || 0) + Math.cos(a) * ring.rz);
        uvs.push(i / sides, (ring.y - minY) / (maxY - minY));
      }
    });
    for (let row = 0; row < rings.length - 1; row++) {
      for (let i = 0; i < sides; i++) {
        const next = (i + 1) % sides;
        const a = row * sides + i, an = row * sides + next;
        const b = (row + 1) * sides + i, bn = (row + 1) * sides + next;
        indices.push(a, an, b, an, bn, b);
      }
    }
    g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    g.setIndex(indices); g.computeVertexNormals();
    return g;
  }
  const mesh = (geometry, material, x = 0, y = 0, z = 0, parent = root) => {
    const m = new THREE.Mesh(geometry, material);
    m.position.set(x, y, z); m.castShadow = true; parent.add(m); return m;
  };

  // Jaqueta em peça contínua: peito, cintura e ombros formam uma única silhueta.
  const torso = mesh(loftGeometry([
    { y: -0.42, rx: 0.15, rz: 0.105 },
    { y: -0.34, rx: 0.15, rz: 0.12 },
    { y: -0.19, rx: 0.16, rz: 0.13 },
    { y: -0.05, rx: 0.175, rz: 0.14 },
    { y: 0.10, rx: 0.195, rz: 0.15 },
    { y: 0.22, rx: 0.205, rz: 0.14 },
    { y: 0.29, rx: 0.235, rz: 0.135 },
    { y: 0.36, rx: 0.205, rz: 0.12 },
    { y: 0.41, rx: 0.15, rz: 0.10 },
  ], 14), jacket, 0, 1.30, 0);
  const belt = mesh(new THREE.CylinderGeometry(0.175, 0.20, 0.065, 10, 1), leather, 0, 0.94, 0);
  const buckle = mesh(new THREE.BoxGeometry(0.075, 0.055, 0.018), new THREE.MeshLambertMaterial({
    color: 0x918363, flatShading: true,
  }), 0, 0.94, 0.201);

  // Pescoço e cabeça com mandíbula afinada e caixa craniana separada do cabelo.
  mesh(new THREE.CylinderGeometry(0.048, 0.054, 0.095, 8), shirt, 0, 1.682, 0);
  const head = mesh(loftGeometry([
    { y: -0.14, rx: 0.045, rz: 0.052 },
    { y: -0.105, rx: 0.068, rz: 0.078 },
    { y: -0.045, rx: 0.091, rz: 0.096 },
    { y: 0.025, rx: 0.108, rz: 0.105 },
    { y: 0.095, rx: 0.101, rz: 0.096 },
    { y: 0.145, rx: 0.062, rz: 0.062 },
  ], 12), skin, 0, 1.79, 0);
  head.userData.baseY = 1.79;
  const earGeo = new THREE.SphereGeometry(1, 5, 4);
  const earL = mesh(earGeo, skin, -0.105, 0, 0, head);
  earL.scale.set(0.018, 0.034, 0.023);
  const earR = mesh(earGeo, skin, 0.105, 0, 0, head);
  earR.scale.set(0.018, 0.034, 0.023);
  const hairCap = mesh(new THREE.SphereGeometry(1, 10, 6, 0, Math.PI * 2, 0, Math.PI * 0.64), hair, 0, 0.101, -0.006, head);
  hairCap.scale.set(0.117, 0.09, 0.12);
  // Low swept locks break the round helmet-like cap at the nape.
  const lockGeo = new THREE.CapsuleGeometry(0.014, 0.065, 2, 5);
  const lockL = mesh(lockGeo, hair, -0.064, 0.033, -0.073, head); lockL.rotation.z = -0.28; lockL.rotation.x = -0.34;
  const lockR = mesh(lockGeo, hair, 0.057, 0.027, -0.078, head); lockR.rotation.z = 0.32; lockR.rotation.x = -0.35;
  const fringeShape = new THREE.Shape();
  fringeShape.moveTo(-0.11, 0.045); fringeShape.lineTo(-0.065, 0.07);
  fringeShape.lineTo(-0.012, 0.047); fringeShape.lineTo(0.045, 0.026);
  fringeShape.lineTo(0.103, -0.006); fringeShape.lineTo(0.074, -0.035);
  fringeShape.lineTo(0.033, -0.018); fringeShape.lineTo(-0.005, -0.066);
  fringeShape.lineTo(-0.042, -0.026); fringeShape.lineTo(-0.086, -0.042); fringeShape.closePath();
  mesh(new THREE.ShapeGeometry(fringeShape), new THREE.MeshLambertMaterial({
    color: 0x9a7848, flatShading: true, side: THREE.DoubleSide,
  // The old card sat behind the face surface, so the swept fringe disappeared in the render.
  }), 0, 0.10, 0.112, head);

  // Eyes, brows and a shallow nose sit just in front of the face surface.
  for (const x of [-0.038, 0.038]) {
    mesh(new THREE.SphereGeometry(0.009, 6, 4), eyeWhite, x, 0.021, 0.101, head);
    mesh(new THREE.SphereGeometry(0.0048, 5, 4), eye, x, 0.021, 0.108, head);
    const brow = mesh(new THREE.BoxGeometry(0.034, 0.006, 0.009), hair, x, 0.041, 0.101, head);
    brow.rotation.z = x < 0 ? 0.08 : -0.08;
  }
  const noseGeo = new THREE.BufferGeometry();
  noseGeo.setAttribute('position', new THREE.Float32BufferAttribute([
    -0.012, 0.032, 0.096, 0.012, 0.032, 0.096, 0, -0.008, 0.115,
    -0.012, 0.032, 0.096, 0, -0.008, 0.115, 0, -0.012, 0.099,
    0.012, 0.032, 0.096, 0, -0.012, 0.099, 0, -0.008, 0.115,
  ], 3));
  noseGeo.computeVertexNormals();
  mesh(noseGeo, new THREE.MeshLambertMaterial({ color: 0x9c735f, side: THREE.DoubleSide }), 0, 0, 0, head);
  const mouth = mesh(new THREE.BoxGeometry(0.024, 0.004, 0.004), new THREE.MeshBasicMaterial({ color: 0x65473d }), 0, -0.035, 0.102, head);
  const limb = (x, y, rings, material, sides = 8) => {
    const group = new THREE.Group(); group.position.set(x, y, 0); root.add(group);
    mesh(loftGeometry(rings, sides), material, 0, 0, 0, group);
    return group;
  };
  const legRings = [
    { y: -0.88, rx: 0.066, rz: 0.073 }, { y: -0.80, rx: 0.075, rz: 0.082 },
    { y: -0.65, rx: 0.087, rz: 0.09 }, { y: -0.50, rx: 0.075, rz: 0.078 },
    { y: -0.37, rx: 0.085, rz: 0.095 }, { y: -0.20, rx: 0.105, rz: 0.12 },
    { y: -0.07, rx: 0.108, rz: 0.12 }, { y: 0, rx: 0.092, rz: 0.10 },
  ];
  const legL = limb(-0.112, 0.97, legRings, trousers, 8);
  const legR = limb(0.112, 0.97, legRings, trousers, 8);
  const foot = new THREE.SphereGeometry(1, 7, 4);
  const shoeL = mesh(foot, boot, 0, -0.805, 0.065, legL);
  shoeL.scale.set(0.105, 0.063, 0.16);
  const shoeR = mesh(foot, boot, 0, -0.805, 0.065, legR);
  shoeR.scale.set(0.105, 0.063, 0.16);
  const upperArmRings = [
    { y: -0.34, rx: 0.050, rz: 0.058 }, { y: -0.29, rx: 0.060, rz: 0.069 },
    { y: -0.22, rx: 0.067, rz: 0.076 }, { y: -0.14, rx: 0.074, rz: 0.084 },
    { y: -0.06, rx: 0.079, rz: 0.089 }, { y: 0.015, rx: 0.085, rz: 0.091 },
    { y: 0.075, rx: 0.067, rz: 0.078 },
  ];
  const forearmRings = (side) => [
    { y: 0, rx: 0.057, rz: 0.064, cx: side * 0.012 },
    { y: -0.07, rx: 0.061, rz: 0.067, cx: side * 0.018 },
    { y: -0.15, rx: 0.058, rz: 0.065, cx: side * 0.025 },
    { y: -0.23, rx: 0.052, rz: 0.060, cx: side * 0.020 },
    { y: -0.30, rx: 0.045, rz: 0.053, cx: side * 0.010 },
    { y: -0.35, rx: 0.039, rz: 0.047, cx: 0 },
  ];
  const makeArm = (side) => {
    // Move the sleeves clear of the torso silhouette; the old placement buried most of both arms.
    const arm = limb(side * 0.245, 1.59, upperArmRings, sleeve, 10);
    // Rounded shoulder caps bridge torso and sleeves, avoiding the detached pipe-like arm look.
    const shoulder = mesh(new THREE.SphereGeometry(1, 8, 5), sleeve, -side * 0.039, -0.025, 0, arm);
    shoulder.scale.set(0.105, 0.112, 0.098);
    const forearm = new THREE.Group(); forearm.position.set(side * 0.018, -0.29, -0.008); arm.add(forearm);
    mesh(loftGeometry(forearmRings(side), 10), sleeve, 0, 0, 0, forearm);
    const cuff = mesh(new THREE.CylinderGeometry(0.047, 0.052, 0.038, 8), leather, 0, -0.286, 0, forearm);
    cuff.rotation.z = side * 0.03;
    arm.userData.forearm = forearm;
    return arm;
  };
  const armR = makeArm(-1);
  const armL = makeArm(1);
  const gloveGeo = new THREE.SphereGeometry(1, 8, 5);
  for (const [arm, side] of [[armL, -1], [armR, 1]]) {
    const forearm = arm.userData.forearm;
    const palm = mesh(gloveGeo, leather, 0, -0.37, 0.018, forearm);
    palm.scale.set(0.048, 0.066, 0.037);
    const thumb = mesh(gloveGeo, leather, side * 0.037, -0.35, 0.026, forearm);
    thumb.scale.set(0.023, 0.043, 0.025);
  }

  // Keep the holster on the torso and mount the pistol to the right palm.
  const holster = mesh(new THREE.BoxGeometry(0.09, 0.18, 0.11), leather, -0.20, 0.86, 0.045);
  holster.rotation.z = 0.10;
  const { weapon, muzzleFlash } = makePistol();
  weapon.scale.setScalar(1.08);
  weapon.position.set(0, -0.36, 0.035);
  armR.userData.forearm.add(weapon);
  return {
    root, head, legL, legR, armL, armR, weapon, muzzleFlash,
    muzzleLocal: new THREE.Vector3(0, 0.055, 0.274),
  };
}
export function createPlayer({ scene, world, camera, displayCamera, dom, audio, inventory, getFixedView, quality }) {
  const col = world.collisions;
  const model = buildModel();
  // A pistola CC0 só é usada pelo boneco procedural de reserva (se o swat.glb falhar).
  // O SWAT usa a pistola do próprio coldre (ver sidearm.js).
  function loadFallbackPistol() {
    new GLTFLoader().load('/models/service_pistol/service_pistol_1k.gltf', ({ scene: pistol }) => {
      const visibleParts = new Set([
        'service_pistol_pistol_a',
        'service_pistol_slide_a',
        'service_pistol_hammer_a',
        'service_pistol_trigger_a',
      ]);
      pistol.children.forEach((part) => { part.visible = visibleParts.has(part.name); });
      pistol.rotation.y = -Math.PI / 2;
      pistol.name = 'ServicePistolCC0';
      pistol.traverse((part) => {
        if (!part.isMesh || !part.visible) return;
        part.castShadow = true;
        part.receiveShadow = true;
      });
      for (const part of [...model.weapon.children]) {
        if (part === model.muzzleFlash) continue;
        part.traverse((object) => {
          object.geometry?.dispose();
          const materials = Array.isArray(object.material) ? object.material : [object.material];
          materials.forEach((material) => material?.dispose());
        });
        part.removeFromParent();
      }
      model.weapon.add(pistol);
      model.muzzleLocal.set(0, 0.008, 0.176);
      model.muzzleFlash.position.set(0, 0.008, 0.204);
    }, undefined, (error) => {
      console.error('Nao foi possivel carregar a pistola CC0; usando o modelo substituto.', error);
    });
  }
  scene.add(model.root);

  // ── Personagem real (SWAT Mixamo) + clips de caminhada do mesmo rig ──
  // O boneco procedural continua como fallback caso o GLB não carregue.
  const skinned = {
    root: new THREE.Group(),
    mixer: null,
    actions: {},
    bones: {},
    ready: false,
  };
  skinned.root.name = 'PlayerSkinnedCharacter';
  skinned.root.visible = false;
  scene.add(skinned.root);
  model.skinned = skinned;

  new GLTFLoader().load('/models/character/swat.glb', (gltf) => {
    const character = gltf.scene;
    const bounds = new THREE.Box3().setFromObject(character);
    const size = bounds.getSize(new THREE.Vector3());
    if (!Number.isFinite(size.y) || size.y <= 0.001) {
      console.error('Personagem SWAT com dimensões inválidas.');
      return;
    }
    character.scale.setScalar(1.82 / size.y);
    character.updateMatrixWorld(true);
    const scaled = new THREE.Box3().setFromObject(character);
    const center = scaled.getCenter(new THREE.Vector3());
    character.position.set(-center.x, -scaled.min.y, -center.z);
    character.traverse((object) => {
      if (object.isMesh) {
        object.castShadow = true;
        object.receiveShadow = true;
        object.frustumCulled = false; // o bounding box da malha com skin é impreciso
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        for (const material of materials) {
          if (!material) continue;
          material.envMapIntensity = 1.1;
          if ('roughness' in material) material.roughness = Math.min(material.roughness ?? 1, 0.95);
        }
      }
      if (object.isBone) skinned.bones[object.name] = object;
    });
    skinned.root.add(character);
    skinned.mixer = new THREE.AnimationMixer(character);
    if (gltf.animations[0]) {
      const idle = skinned.mixer.clipAction(gltf.animations[0]);
      idle.play();
      skinned.actions.idle = idle;
    }
    // Pistola do coldre (nó separado pelo tools/split-holster-pistol.mjs).
    const holsterPistol = character.getObjectByName('Soldier_pistol');
    if (holsterPistol) {
      skinned.sidearm = createSidearm({ character, bones: skinned.bones, pistol: holsterPistol });
      model.weapon = holsterPistol;
      model.muzzleFlash = skinned.sidearm.muzzleFlash;
      model.muzzleLocal.copy(SIDEARM.muzzle);
    } else {
      console.warn('swat.glb sem o nó Soldier_pistol: rode `npm run split-pistol`.');
    }
    model.root.visible = false;
    model.root = skinned.root;
    skinned.root.visible = true;
    skinned.ready = true;
    character.userData.character = 'swat';

    // Os clipes Walk/Run vêm do Soldier.glb (também Mixamo, mas com outra orientação
    // de ossos, outra escala e olhando para o lado oposto). Ver retarget.js: o
    // movimento é convertido osso a osso para o esqueleto do SWAT, incluindo a
    // rotação e o deslocamento do quadril (Hips).
    new GLTFLoader().load('/models/character/Soldier.glb', (soldier) => {
      const locomotion = {};
      for (const name of ['Walk', 'Run']) {
        const source = soldier.animations.find((clip) => clip.name === name);
        if (!source) continue;
        try {
          const result = retargetMixamoClip(soldier.scene, character, source);
          const action = skinned.mixer.clipAction(result.clip);
          action.timeScale = 0; // a fase é definida pela distância percorrida (locomotion.js)
          action.play();
          action.setEffectiveWeight(0);
          skinned.actions[name.toLowerCase()] = action;
          locomotion[name.toLowerCase()] = {
            duration: result.clip.duration,
            strike: result.strikePhase,
            // velocidade (m/s no mundo do jogo) em que o pé de apoio não escorrega
            speed: result.groundSpeed * character.scale.x,
          };
        } catch (error) {
          console.warn(`Não foi possível adaptar o clipe ${name}.`, error);
        }
      }
      if (locomotion.walk && locomotion.run) skinned.gait = createGait(locomotion);
    }, undefined, (error) => {
      console.warn('Clipes de caminhada indisponíveis; mantendo idle.', error);
    });
  }, undefined, (error) => {
    console.error('Não foi possível carregar o personagem SWAT; usando o boneco procedural.', error);
    loadFallbackPistol();
  });

  const occlusionGroup = new THREE.Group();
  occlusionGroup.renderOrder = 10;
  scene.add(occlusionGroup);

  function updateOcclusion(view) {
    for (const mask of occlusionGroup.children) {
      mask.geometry.dispose();
      mask.material.dispose();
    }
    occlusionGroup.clear();
    for (const polygon of view?.mapping?.occlusion || []) {
      const shape = new THREE.Shape();
      polygon.forEach(([x, y], index) => {
        const px = x * displayCamera.right;
        if (index === 0) shape.moveTo(px, y);
        else shape.lineTo(px, y);
      });
      shape.closePath();
      const geometry = new THREE.ShapeGeometry(shape);
      const positions = geometry.attributes.position;
      const uv = new Float32Array(positions.count * 2);
      for (let i = 0; i < positions.count; i++) {
        uv[i * 2] = (positions.getX(i) / displayCamera.right + 1) / 2;
        uv[i * 2 + 1] = (positions.getY(i) + 1) / 2;
      }
      geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
      const material = new THREE.MeshBasicMaterial({
        map: view.texture, depthTest: false, depthWrite: false, toneMapped: false,
      });
      const mask = new THREE.Mesh(geometry, material);
      mask.position.z = 0.3;
      mask.renderOrder = 10;
      occlusionGroup.add(mask);
    }
  }

  const S = {
    x: world.spawn.x, z: world.spawn.z, y: world.spawn.y,
    yaw: world.spawn.yaw, pitch: -0.1, bodyYaw: world.spawn.yaw,
    vx: 0, vz: 0, speed: 0, aimT: 0, aiming: false, flash: true, phase: 0, camFrac: 1, active: false,
    paused: false, recoil: 0, reloadTime: 0, gaitLean: 0,
    fixedView: null, fixedCameraPose: null,
  };
  const keys = {};
  function shoot() {
    if (!S.active || S.paused || !S.aiming || S.reloadTime > 0) return;
    const sidearm = model.skinned?.sidearm;
    if (sidearm && (!sidearm.drawn || S.aimT < 0.8)) return; // ainda sacando a arma
    if (!inventory?.consumeRound()) { audio?.emptyGun?.(); return; }
    S.recoil = 1;
    model.muzzleTime = 0.075;
    if (model.muzzleFlash) model.muzzleFlash.visible = true;
    fireProjectile();
    audio?.gunshot?.();
  }

  // ── Entrada ──
  const onKey = (e) => {
    keys[e.code] = e.type === 'keydown';
    if (e.type === 'keydown' && e.code === 'KeyF' && !e.repeat) { S.flash = !S.flash; audio?.toggleFlashlight(S.flash); }
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
  };
  window.addEventListener('keydown', onKey);
  window.addEventListener('keyup', onKey);
  window.addEventListener('blur', () => { for (const k in keys) keys[k] = false; S.aiming = false; });
  dom.addEventListener('mousedown', (e) => {
    if (e.button === 2 && !S.paused) beginAim();
    if (e.button === 0) shoot();
  });
  window.addEventListener('mouseup', (e) => { if (e.button === 2) S.aiming = false; });
  window.addEventListener('contextmenu', (e) => e.preventDefault());
  document.addEventListener('mousemove', (e) => {
    if (!S.active) return;
    if (document.pointerLockElement !== dom) {
      const bounds = dom.getBoundingClientRect();
      if (e.clientX < bounds.left || e.clientX > bounds.right || e.clientY < bounds.top || e.clientY > bounds.bottom) return;
    }
    const sensitivity = THREE.MathUtils.lerp(1, 0.55, S.aimT);
    const yaw = S.yaw, pitch = S.pitch;
    S.yaw -= e.movementX * 0.0022 * sensitivity;
    S.pitch = clamp(S.pitch - e.movementY * 0.002 * sensitivity, CAM.pitchMin, CAM.pitchMax);
    if (S.aiming && S.fixedView) {
      const point = aimScreenPosition();
      if (!point || Math.abs(point.x) > 0.86 || Math.abs(point.y) > 0.82) {
        S.yaw = yaw;
        S.pitch = pitch;
      }
    }
  });
  // Lanterna presa ao colete
  const flash = new THREE.SpotLight(0xfff0d0, 62, 22, 0.5, 0.68, 2);
  flash.castShadow = true;
  const flashShadowSize = quality?.shadows === 'flashlight' ? 256 : 512;
  flash.shadow.mapSize.set(flashShadowSize, flashShadowSize);
  flash.shadow.bias = -0.0008;
  scene.add(flash, flash.target);

  // Preenchimento suave preso à câmera: revela o personagem e o chão imediato
  // sem apagar o contraste das fontes de luz da cena.
  const cameraFill = new THREE.PointLight(0xa8bdd4, 0.9, 4.2, 2);
  cameraFill.castShadow = false;
  scene.add(cameraFill);

  const raycaster = new THREE.Raycaster();
  const dir = new THREE.Vector3(), right = new THREE.Vector3(), pivot = new THREE.Vector3();
  const rayDir = new THREE.Vector3(), camPos = new THREE.Vector3(), tmp = new THREE.Vector3();
  const muzzlePoint = new THREE.Vector3();
  const shots = [];
  // Inimigos: o gerenciador recebe {origin, dir, maxDistance} e devolve o ponto atingido (ou null).
  let shotHandler = null;

  function getMuzzlePoint() {
    const displayPosition = model.root.position.clone();
    const displayScale = model.root.scale.clone();
    model.root.position.set(S.x, S.y, S.z);
    model.root.scale.setScalar(1);
    model.root.updateMatrixWorld(true);
    const sidearm = model.skinned?.sidearm;
    if (sidearm) sidearm.muzzleWorld(muzzlePoint);
    else model.weapon.localToWorld(muzzlePoint.copy(model.muzzleLocal));
    model.root.position.copy(displayPosition);
    model.root.scale.copy(displayScale);
    model.root.updateMatrixWorld(true);
    return muzzlePoint;
  }

  function aimScreenPosition() {
    const cp = Math.cos(S.pitch);
    dir.set(Math.sin(S.yaw) * cp, Math.sin(S.pitch), Math.cos(S.yaw) * cp);
    const origin = getMuzzlePoint().clone();
    raycaster.set(origin, dir);
    raycaster.far = 36;
    const hit = raycaster.intersectObjects(world.occluders, false)[0];
    const target = hit ? hit.point : origin.addScaledVector(dir, 24);
    const projected = S.fixedView?.project?.(target);
    if (projected) return { x: projected.x, y: projected.y };
    target.project(camera);
    if (target.z < -1 || target.z > 1) return null;
    return { x: target.x, y: target.y };
  }

  function displayPoint(point) {
    const projected = S.fixedView?.project?.(point);
    return projected
      ? new THREE.Vector3(projected.x * displayCamera.right, projected.y, 0.2)
      : point.clone();
  }

  function isInsidePolygon(point, polygon) {
    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      const [xi, yi] = polygon[i], [xj, yj] = polygon[j];
      const crosses = (yi > point.y) !== (yj > point.y)
        && point.x < ((xj - xi) * (point.y - yi)) / (yj - yi) + xi;
      if (crosses) inside = !inside;
    }
    return inside;
  }

  function positionInView(state, view = S.fixedView) {
    if (!view?.project) return true;
    const projected = view.project(state);
    const inFrame = Math.abs(projected.x) + projected.scale * 0.3 <= 0.92
      && projected.y >= -0.95
      && projected.y + projected.scale * 1.82 <= 0.92;
    const walkable = view.mapping?.walkable;
    return inFrame && (!view.contains || view.contains(state))
      && (!walkable || isInsidePolygon(projected, walkable));
  }

  function alignAimToView(view) {
    const origin = new THREE.Vector3(S.x, S.y + 1.35, S.z);
    const target = new THREE.Vector3(...view.target);
    dir.copy(target.sub(origin)).normalize();
    S.yaw = Math.atan2(dir.x, dir.z);
    S.pitch = clamp(Math.asin(clamp(dir.y, -1, 1)), CAM.pitchMin, CAM.pitchMax);
  }

  function beginAim() {
    if (!S.aiming && S.fixedView) alignAimToView(S.fixedView);
    S.aiming = true;
  }

  function addImpact(hit) {
    const normal = hit.face?.normal.clone().transformDirection(hit.object.matrixWorld) || new THREE.Vector3(0, 1, 0);
    const mark = new THREE.Mesh(
      new THREE.CircleGeometry(0.055, 7),
      new THREE.MeshBasicMaterial({ color: 0x221b13, transparent: true, opacity: 0.82, depthWrite: false }),
    );
    mark.position.copy(displayPoint(hit.point)).addScaledVector(S.fixedView ? new THREE.Vector3(0, 0, 1) : normal, 0.004);
    if (S.fixedView) mark.quaternion.identity();
    else mark.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal);
    scene.add(mark);
    const sparks = [];
    for (let i = 0; i < 7; i++) {
      const velocity = new THREE.Vector3((Math.random() - 0.5) * 1.8, Math.random() * 1.5, (Math.random() - 0.5) * 1.8)
        .addScaledVector(normal, 0.75 + Math.random() * 0.55);
      const geometry = new THREE.BufferGeometry().setFromPoints([displayPoint(hit.point), displayPoint(hit.point)]);
      const material = new THREE.LineBasicMaterial({ color: i % 2 ? 0xffc56a : 0xe9e0c3, transparent: true });
      const spark = new THREE.Line(geometry, material);
      scene.add(spark);
      sparks.push({ object: spark, velocity });
    }
    shots.push({ mark, sparks, point: hit.point.clone(), age: 0, duration: 4.5, impact: true });
  }

  function fireProjectile() {
    const start = getMuzzlePoint().clone();
    const cp = Math.cos(S.pitch);
    dir.set(Math.sin(S.yaw) * cp, Math.sin(S.pitch), Math.cos(S.yaw) * cp).normalize();
    raycaster.set(start, dir);
    raycaster.far = 36;
    let hit = raycaster.intersectObjects(world.occluders, false)[0];
    let end = hit ? hit.point.clone() : start.clone().addScaledVector(dir, 36);
    // Inimigo na linha de tiro (antes da parede)? O projétil termina nele e não marca a parede.
    const enemyHit = shotHandler?.({ origin: start.clone(), dir: dir.clone(), maxDistance: hit ? hit.distance : 36 });
    if (enemyHit) { end = enemyHit.point.clone(); hit = null; }
    const geometry = new THREE.BufferGeometry().setFromPoints([displayPoint(start), displayPoint(start)]);
    const material = new THREE.LineBasicMaterial({ color: 0xffe6a1, transparent: true, opacity: 0.95 });
    const tracer = new THREE.Line(geometry, material);
    tracer.frustumCulled = false;
    scene.add(tracer);
    shots.push({ tracer, start, end, age: 0, duration: 0.11, impact: false });
    if (hit) addImpact(hit);
  }

  function updateShots(dt) {
    for (let i = shots.length - 1; i >= 0; i--) {
      const shot = shots[i];
      shot.age += dt;
      const progress = clamp(shot.age / shot.duration, 0, 1);
      if (shot.impact) {
        const sparkProgress = clamp(shot.age / 0.42, 0, 1);
        shot.sparks.forEach(({ object, velocity }, index) => {
          const from = shot.point.clone().addScaledVector(velocity, sparkProgress * 0.30);
          const to = from.clone().addScaledVector(velocity, (1 - sparkProgress) * 0.34);
          object.geometry.setFromPoints([displayPoint(from), displayPoint(to)]);
          object.material.opacity = 1 - sparkProgress;
        });
        shot.mark.material.opacity = 0.82 * (1 - clamp((shot.age - 1) / 3.5, 0, 1));
      } else {
        const current = shot.start.clone().lerp(shot.end, progress);
        shot.tracer.geometry.setFromPoints([displayPoint(shot.start), displayPoint(current)]);
        shot.tracer.material.opacity = 1 - progress * 0.75;
      }
      if (progress >= 1) {
        if (shot.tracer) {
          scene.remove(shot.tracer); shot.tracer.geometry.dispose(); shot.tracer.material.dispose();
        }
        if (shot.mark) {
          scene.remove(shot.mark); shot.mark.geometry.dispose(); shot.mark.material.dispose();
          shot.sparks.forEach(({ object }) => {
            scene.remove(object); object.geometry.dispose(); object.material.dispose();
          });
        }
        shots.splice(i, 1);
      }
    }
  }

  function updateMovement(dt) {
    if (S.paused) {
      S.vx = 0; S.vz = 0; S.speed = 0; S.aiming = false;
      S.aimT += (0 - S.aimT) * Math.min(1, dt * 14);
      return;
    }
    const f = (keys.KeyW || keys.ArrowUp ? 1 : 0) - (keys.KeyS || keys.ArrowDown ? 1 : 0);
    const s = (keys.KeyD || keys.ArrowRight ? 1 : 0) - (keys.KeyA || keys.ArrowLeft ? 1 : 0);
    const fx = Math.sin(S.yaw), fz = Math.cos(S.yaw), rx = -Math.cos(S.yaw), rz = Math.sin(S.yaw);
    let wx = fx * f + rx * s, wz = fz * f + rz * s;
    const len = Math.hypot(wx, wz);
    if (len > 0) { wx /= len; wz /= len; }
    const sprinting = !S.aiming && (keys.ShiftLeft || keys.ShiftRight);
    const walking = !S.aiming && keys.KeyC;
    let max = S.aiming ? SPEED.aim : (walking ? SPEED.walk : (sprinting ? SPEED.run : SPEED.jog));
    if (S.aiming && f < 0) max *= 0.8;
    const hasInput = len > 0;
    const targetX = wx * max * (hasInput ? 1 : 0);
    const targetZ = wz * max * (hasInput ? 1 : 0);
    const reversing = (S.vx * targetX + S.vz * targetZ) < -0.15;
    const response = hasInput ? (reversing ? SPEED.brake : SPEED.accel) : SPEED.brake;
    const k = 1 - Math.exp(-dt * response);
    S.vx += (targetX - S.vx) * k;
    S.vz += (targetZ - S.vz) * k;
    S.speed = Math.hypot(S.vx, S.vz);
    if (S.speed > 0.01) {
      let p = col.move(S.x, S.z, S.vx * dt, S.vz * dt, 0.36, S.y);
      const floor = col.floorY(p.x, p.z, S.y) ?? S.y;
      const nextState = { x: p.x, y: floor, z: p.z };
      const nextView = getFixedView?.(nextState);
      if (nextView && !positionInView(nextState, nextView)) {
        p = { x: S.x, z: S.z };
        S.vx = 0;
        S.vz = 0;
      }
      if (p.x === S.x) S.vx = 0;
      if (p.z === S.z) S.vz = 0;
      S.x = p.x; S.z = p.z;
    }
    S.speed = Math.hypot(S.vx, S.vz);
    S.y = col.floorY(S.x, S.z, S.y) ?? S.y;
    const wantYaw = S.aiming ? S.yaw : (S.speed > 0.35 ? Math.atan2(S.vx, S.vz) : S.bodyYaw);
    S.bodyYaw += angleDiff(S.bodyYaw, wantYaw) * (1 - Math.exp(-dt * (S.aiming ? 15 : SPEED.turn)));
    const lateral = Math.cos(S.bodyYaw) * S.vx - Math.sin(S.bodyYaw) * S.vz;
    S.gaitLean += (clamp(-lateral * 0.045, -0.075, 0.075) - S.gaitLean) * (1 - Math.exp(-dt * 5));
    S.aimT += ((S.aiming ? 1 : 0) - S.aimT) * (1 - Math.exp(-dt * 11));
  }


  function updateSkinnedCharacter(dt, strideBob, amp, reload) {
    const sk = model.skinned;
    const root = model.root;
    // A oscilação vertical do corpo vem do próprio clipe (Hips), então não se soma strideBob.
    root.position.set(S.x, S.y, S.z);
    root.rotation.set(-0.018 * amp - 0.012 * S.aimT, S.bodyYaw, S.gaitLean * 0.5);

    const actions = sk.actions;
    if (sk.gait) {
      // Velocidade na direção em que o corpo olha (negativa = de costas, ex.: mirando).
      const along = S.vx * Math.sin(S.bodyYaw) + S.vz * Math.cos(S.bodyYaw);
      const gait = sk.gait.update(dt, S.speed, along);
      if (actions.idle) actions.idle.setEffectiveWeight(gait.idle);
      actions.walk.setEffectiveWeight(gait.walk);
      actions.run.setEffectiveWeight(gait.run);
      actions.walk.time = gait.walkTime;
      actions.run.time = gait.runTime;
      // Câmera acompanha o mesmo passo (o balanço é mais baixo no apoio do pé esquerdo).
      S.phase = gait.phase * Math.PI * 2 - Math.PI / 4;
    } else if (actions.idle) {
      actions.idle.setEffectiveWeight(1);
    }
    sk.mixer.update(dt);

    if (sk.sidearm) {
      sk.sidearm.update(dt, {
        x: S.x, y: S.y, z: S.z, bodyYaw: S.bodyYaw, yaw: S.yaw, pitch: S.pitch,
        aimT: S.aimT, recoil: S.recoil, reloadTime: S.reloadTime,
      }, S.aiming || S.reloadTime > 0);
    }
  }

  function animateModel(dt) {
    const m = model;
    S.recoil = Math.max(0, S.recoil - dt * 4.8);
    S.reloadTime = Math.max(0, S.reloadTime - dt);
    if (m.muzzleTime > 0) {
      m.muzzleTime -= dt;
      if (m.muzzleTime <= 0 && m.muzzleFlash) m.muzzleFlash.visible = false;
    }
    const stride = clamp(S.speed / SPEED.jog, 0, 1);
    const strideBob = (Math.sin(S.phase * 2) * 0.018 + Math.abs(Math.sin(S.phase)) * 0.012) * stride;
    m.root.position.set(S.x, S.y + strideBob, S.z);
    m.root.rotation.y = S.bodyYaw;
    S.phase += S.speed * dt * 2.55;
    const amp = clamp(S.speed / SPEED.jog, 0, 1);
    const sw = Math.sin(S.phase);
    const reload = S.reloadTime > 0 ? Math.sin((1 - S.reloadTime / 2.15) * Math.PI) : 0;
    if (m.skinned?.ready && m.skinned.mixer) {
      updateSkinnedCharacter(dt, strideBob, amp, reload);
      return;
    }
    if (m.assetRig) {
      const idle = Math.sin(performance.now() * 0.00125) * 0.006;
      const stepLiftL = Math.max(0, -sw);
      const stepLiftR = Math.max(0, sw);
      // Pequenas compensações de quadril, joelhos e ombros quebram o ciclo rígido
      // de pernas perfeitamente alternadas e dão peso ao apoio de cada passada.
      m.root.rotation.x = -0.026 * amp - 0.018 * S.aimT + Math.sin(S.phase * 2 + 0.5) * 0.012 * amp;
      m.root.rotation.z = Math.sin(S.phase * 0.5 + 0.7) * amp * 0.022 + S.gaitLean
        + Math.sin(S.phase * 0.5) * 0.012 * amp;
      m.root.rotation.y = S.bodyYaw + Math.sin(S.phase * 0.5) * amp * 0.018;
      const strideWave = Math.sin(S.phase);
      const weightShift = Math.sin(S.phase * 2 + 0.42) * amp;
      m.legL.rotation.x = strideWave * amp * 0.43 + Math.max(0, -strideWave) * amp * 0.10;
      m.legR.rotation.x = -Math.sin(S.phase + 0.12) * amp * 0.43 + Math.max(0, strideWave) * amp * 0.08;
      m.legL.rotation.z = weightShift * 0.035;
      m.legR.rotation.z = -weightShift * 0.032;
      m.kneeL.rotation.x = stepLiftL * amp * 0.72 + Math.max(0, Math.sin(S.phase - 0.35)) * amp * 0.08;
      m.kneeR.rotation.x = stepLiftR * amp * 0.68 + Math.max(0, -Math.sin(S.phase + 0.35)) * amp * 0.08;
      m.armL.rotation.x = -Math.sin(S.phase + 0.18) * amp * 0.24 + idle;
      m.armR.rotation.x = Math.sin(S.phase - 0.12) * amp * 0.25 - idle;
      m.armL.rotation.z = 0.025 * (1 - amp) + stepLiftR * amp * 0.018;
      m.armR.rotation.z = -0.025 * (1 - amp) - stepLiftL * amp * 0.018;
      const elbowIdle = 0.075 + Math.abs(sw) * amp * 0.075;
      m.armL.userData.forearm.rotation.x = elbowIdle;
      m.armR.userData.forearm.rotation.x = elbowIdle;
      const a = S.aimT;
      const raised = -Math.PI / 2 - S.pitch;
      m.armR.rotation.x = THREE.MathUtils.lerp(m.armR.rotation.x, raised, a) - S.recoil * 0.30 * a;
      m.armL.rotation.x = THREE.MathUtils.lerp(m.armL.rotation.x, raised, a) + reload * 0.35;
      m.armR.userData.forearm.rotation.x = THREE.MathUtils.lerp(elbowIdle, 0.42, a) + S.recoil * 0.28 * a;
      m.armL.userData.forearm.rotation.x = THREE.MathUtils.lerp(elbowIdle, 0.42, a) + reload * 0.5;
      m.armL.rotation.z = THREE.MathUtils.lerp(m.armL.rotation.z, 0.2, a) + reload * 0.12;
      m.weapon.position.set(-2.0, -10.3 + reload * 3.2, 1.6);
      const aimedWeaponPitch = -S.pitch - m.armR.rotation.x - m.armR.userData.forearm.rotation.x;
      m.weapon.rotation.x = THREE.MathUtils.lerp(1.3, aimedWeaponPitch, a)
        + reload * 0.28 + S.recoil * 0.27;
      m.weapon.rotation.y = 0;
      m.head.rotation.x = -S.pitch * 0.5 * a + Math.sin(S.phase * 2 + 0.9) * amp * 0.012;
      m.head.rotation.z = -m.root.rotation.z * 0.82 + Math.sin(S.phase * 0.5 + 0.6) * amp * 0.016;
      return;
    }
    m.legL.rotation.x = sw * amp * 0.75;
    m.legR.rotation.x = -sw * amp * 0.75;
    const idle = Math.sin(performance.now() * 0.0016) * 0.012;
    m.root.rotation.x = -0.025 * amp - 0.012 * S.aimT;
    m.root.rotation.z = Math.sin(S.phase) * amp * 0.035 + S.gaitLean;
    m.root.rotation.y = S.bodyYaw + Math.sin(S.phase * 0.5) * amp * 0.012;
    m.armL.rotation.x = -sw * amp * 0.4 + idle;
    m.armR.rotation.x = sw * amp * 0.4 - idle;
    m.armL.rotation.z = 0.06 * (1 - amp); m.armR.rotation.z = -0.06 * (1 - amp);
    const a = S.aimT;
    const elbowIdle = -0.10 + sw * amp * 0.10;
    m.armL.userData.forearm.rotation.x = elbowIdle;
    m.armR.userData.forearm.rotation.x = elbowIdle;
    if (a > 0.001) {
      const up = -Math.PI / 2 - S.pitch;
      m.armR.rotation.x = THREE.MathUtils.lerp(m.armR.rotation.x, up, a);
      m.armL.rotation.x = THREE.MathUtils.lerp(m.armL.rotation.x, up, a);
      m.armR.userData.forearm.rotation.x = THREE.MathUtils.lerp(elbowIdle, 0.42, a);
      m.armL.userData.forearm.rotation.x = THREE.MathUtils.lerp(elbowIdle, 0.42, a) + reload * 0.5;
      m.armR.rotation.z = THREE.MathUtils.lerp(m.armR.rotation.z, -0.02, a);
      m.armL.rotation.z = THREE.MathUtils.lerp(m.armL.rotation.z, 0.32, a);
    }
    m.armL.rotation.x += reload * 0.35;
    m.armL.rotation.z += reload * 0.12;
    m.weapon.position.set(0, -0.36 + reload * 0.12, 0.035);
    const aimedWeaponPitch = -S.pitch - m.armR.rotation.x - m.armR.userData.forearm.rotation.x;
    m.weapon.rotation.x = THREE.MathUtils.lerp(1.3, aimedWeaponPitch, a) + S.recoil * 0.27;
    m.head.rotation.x = -S.pitch * 0.5 * a + Math.sin(S.phase * 0.5) * amp * 0.016;
    m.head.rotation.z = -m.root.rotation.z * 0.55 + Math.sin(S.phase * 0.5) * amp * 0.009;
  }

  function updateFlashlight() {
    flash.visible = S.flash;
    flash.position.set(S.x + Math.sin(S.bodyYaw) * 0.25 + Math.cos(S.bodyYaw) * 0.17, S.y + 1.42, S.z + Math.cos(S.bodyYaw) * 0.25 - Math.sin(S.bodyYaw) * 0.17);
    const a = S.aimT, cp = Math.cos(S.pitch);
    tmp.set(THREE.MathUtils.lerp(Math.sin(S.bodyYaw), Math.sin(S.yaw) * cp, a),
      THREE.MathUtils.lerp(-0.06, Math.sin(S.pitch), a),
      THREE.MathUtils.lerp(Math.cos(S.bodyYaw), Math.cos(S.yaw) * cp, a)).normalize();
    flash.target.position.copy(flash.position).addScaledVector(tmp, 10);
  }

  function updateCamera(dt) {
    if (S.fixedView) {
      if (!S.fixedCameraPose) {
        camera.position.fromArray(S.fixedView.position);
        camera.lookAt(...S.fixedView.target);
        camera.fov = S.fixedView.fov;
        camera.updateProjectionMatrix();
        camera.updateMatrixWorld(true);
        S.fixedCameraPose = {
          position: camera.position.clone(),
          quaternion: camera.quaternion.clone(),
        };
      } else {
        camera.position.copy(S.fixedCameraPose.position);
        camera.quaternion.copy(S.fixedCameraPose.quaternion);
      }
      const projected = S.fixedView.project(S);
      model.root.position.set(projected.x * displayCamera.right, projected.y, 0);
      model.root.scale.setScalar(projected.scale);
      displayCamera.position.set(0, 0, 10);
      displayCamera.lookAt(0, 0, 0);
      displayCamera.updateMatrixWorld(true);
      model.root.visible = true;
      return;
    }
    const a = S.aimT, dist = THREE.MathUtils.lerp(CAM.distFree, CAM.distAim, a);
    const shoulder = THREE.MathUtils.lerp(CAM.shoulderFree, CAM.shoulderAim, a);
    const cp = Math.cos(S.pitch), sp = Math.sin(S.pitch);
    dir.set(Math.sin(S.yaw) * cp, sp, Math.cos(S.yaw) * cp);
    right.set(-Math.cos(S.yaw), 0, Math.sin(S.yaw));
    const bob = Math.sin(S.phase * 2) * 0.018 * Math.min(1, S.speed / 3) + Math.sin(performance.now() * 0.0016) * 0.004;
    pivot.set(S.x, S.y + CAM.height + bob, S.z);
    pivot.addScaledVector(right, Math.sin(S.phase) * 0.012 * Math.min(1, S.speed / 3));
    camPos.copy(pivot).addScaledVector(right, shoulder).addScaledVector(dir, -dist);
    rayDir.copy(camPos).sub(pivot);
    const full = rayDir.length(); rayDir.divideScalar(full);
    raycaster.set(pivot, rayDir); raycaster.far = full;
    const hit = raycaster.intersectObjects(world.occluders, false)[0];
    const frac = hit ? clamp((hit.distance - 0.18) / full, 0.1, 1) : 1;
    if (frac < S.camFrac) S.camFrac = frac;
    else S.camFrac += (frac - S.camFrac) * Math.min(1, dt * 5);
    camera.position.copy(pivot).addScaledVector(rayDir, full * S.camFrac);
    camera.lookAt(tmp.copy(camera.position).addScaledVector(dir, 10));
    tmp.y += S.recoil * 0.42 * a;
    camera.lookAt(tmp);
    cameraFill.position.copy(camera.position).addScaledVector(dir, 0.45);
    cameraFill.position.y += 0.15;
    camera.rotateZ(S.gaitLean * 0.55 + Math.sin(S.phase * 2) * S.speed * 0.0022);
    const sprintFov = clamp((S.speed - 2.9) * 0.9, 0, 3.2);
    const fov = THREE.MathUtils.lerp(CAM.fovFree, CAM.fovAim, a) + sprintFov;
    if (Math.abs(camera.fov - fov) > 0.01) { camera.fov = fov; camera.updateProjectionMatrix(); }
    model.root.visible = full * S.camFrac > 0.75;
  }

  function update(dt) {
    updateMovement(dt);
    animateModel(dt);
    updateShots(dt);
    updateFlashlight();
    updateCamera(dt);
    audio?.update(dt, S.speed);
  }

  return {
    state: S, model, update, keys,
    setFixedView(view) {
      if (S.fixedView?.id === view?.id) return;
      S.fixedView = view;
      S.fixedCameraPose = null;
      updateOcclusion(view);
      if (S.aiming) alignAimToView(view);
      updateCamera(0);
    },
    setDisplayAspect(aspect) {
      displayCamera.left = -aspect;
      displayCamera.right = aspect;
      displayCamera.top = 1;
      displayCamera.bottom = -1;
      displayCamera.updateProjectionMatrix();
      updateOcclusion(S.fixedView);
    },
    aimScreenPosition,
    setShotHandler(fn) { shotHandler = fn; },
    setActive: (active) => { S.active = active; },
    setPaused: (paused) => {
      S.paused = paused;
      if (paused) { S.aiming = false; S.vx = 0; S.vz = 0; S.speed = 0; }
    },
    startReload() { S.reloadTime = SIDEARM.reloadTime; },
    teleport(spawn) {
      S.x = spawn.x; S.y = spawn.y; S.z = spawn.z;
      S.yaw = spawn.yaw; S.bodyYaw = spawn.yaw; S.pitch = 0;
      S.vx = 0; S.vz = 0; S.speed = 0; S.aiming = false; S.aimT = 0; S.camFrac = 1;
      model.skinned?.sidearm?.reset();
    },
  };
}
