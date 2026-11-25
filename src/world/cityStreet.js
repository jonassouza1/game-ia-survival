import cityWalls from './data/city_block.walls.json';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { buildHospitalFacade } from './hospitalExterior.js';
import { placeHospitalBuilding } from './hospitalBuilding.js';
import { CollisionWorld } from '../systems/collision.js';
import { createProps } from './props.js';
import { LightPool } from '../render/lightPool.js';
import { pbr, solid, glow } from '../render/pbr.js';

function texture(draw, repeatX = 1, repeatY = 1) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 128;
  const context = canvas.getContext('2d');
  context.imageSmoothingEnabled = false;
  let seed = 0x13d5a91;
  const random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
  draw(context, random);
  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  map.repeat.set(repeatX, repeatY);
  map.magFilter = THREE.NearestFilter;
  map.minFilter = THREE.NearestMipmapNearestFilter;
  return map;
}

// UV em escala de mundo: as texturas PBR mantêm a mesma densidade em qualquer
// face, em vez de esticar uma imagem por 90 metros de rua.
function worldUV(geometry, tile = 2) {
  const position = geometry.attributes.position;
  const normal = geometry.attributes.normal;
  const uv = geometry.attributes.uv;
  for (let i = 0; i < position.count; i++) {
    const ax = Math.abs(normal.getX(i));
    const ay = Math.abs(normal.getY(i));
    const az = Math.abs(normal.getZ(i));
    let u, v;
    if (ay >= ax && ay >= az) { u = position.getX(i); v = position.getZ(i); }
    else if (ax >= az) { u = position.getZ(i); v = position.getY(i); }
    else { u = position.getX(i); v = position.getY(i); }
    uv.setXY(i, u / tile, v / tile);
  }
  uv.needsUpdate = true;
}

export function buildCityStreet(group, { hospitalExterior = null, hospitalDoor = null } = {}) {
  // Prédio do pacote (com planta de colisão e entrada) ou, sem ele, a fachada procedural / um GLB simples.
  const useHospitalBuilding = Boolean(hospitalExterior?.data);
  // Entorno do hospital: as alas do prédio vão até x = ±14,23 e a fachada começa em z ≈ 69,5. O último prédio
  // lateral (z = 71) e o beco seguinte (z = 78) ficavam dentro delas. Agora o prédio vira um "anexo" que recua e
  // encosta na lateral do hospital, e o beco que sobrava dentro da ala deixa de existir.
  const HOSPITAL_FLANK_X = 14.75;     // face interna do anexo (a ala do hospital termina em ±14,23)
  const HOSPITAL_ANNEX_Z = 66.05;     // face frontal do anexo (no layout antigo, alinhada à parede do beco de z = 64)
  // Becos que sobraram entre os prédios novos (centro em z, por lado). Cada um tem 3,9 m de largura.
  const ALLEY_Z = { '-1': [3.1, 22.2, 63.2], '1': [2.3, 30.7] };
  // Rua transversal (oeste) que liga a rua principal ao bairro pós-guerra. O vão de 7,3 m coincide
  // com a abertura natural na muralha leste do cenário (postwar.glb).
  const CROSS = { z0: 38.65, z1: 45.95, zc: 42.3, xEnd: -48.8 };
  const DISTRICT = { tx: -63.9, tz: 68.75 };   // deslocamento do postwar.glb para o mundo da rua
  const rpdSign = (() => {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 128;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#24231f'; ctx.fillRect(0, 0, 512, 128);
    ctx.fillStyle = '#a89063'; ctx.fillRect(12, 8, 488, 112);
    ctx.fillStyle = '#3a3931'; ctx.fillRect(22, 16, 468, 96);
    ctx.strokeStyle = '#b7a16d'; ctx.lineWidth = 5; ctx.strokeRect(30, 22, 452, 84);
    ctx.fillStyle = '#d7c79e'; ctx.textAlign = 'center';
    ctx.font = 'bold 48px serif'; ctx.fillText('R.P.D.', 256, 68);
    ctx.font = 'bold 16px monospace'; ctx.fillText('POLICE DEPARTMENT', 256, 96);
    ctx.fillStyle = '#8d3e32'; ctx.fillRect(128, 102, 256, 3);
    const map = new THREE.CanvasTexture(canvas);
    map.colorSpace = THREE.SRGBColorSpace;
    map.magFilter = THREE.LinearFilter;
    map.minFilter = THREE.LinearMipmapLinearFilter;
    return map;
  })();
  const storefrontSign = texture((ctx) => {
    ctx.fillStyle = '#24302d'; ctx.fillRect(0, 0, 128, 128);
    ctx.fillStyle = '#a89468'; ctx.fillRect(5, 6, 118, 116);
    ctx.fillStyle = '#343b35'; ctx.fillRect(9, 10, 110, 108);
    ctx.fillStyle = '#b7a16d'; ctx.fillRect(12, 14, 104, 7);
    ctx.fillStyle = '#d7c79e'; ctx.textAlign = 'center';
    ctx.font = 'bold 15px monospace'; ctx.fillText('MERCEARIA', 64, 56);
    ctx.font = 'bold 9px monospace'; ctx.fillText('ABERTA DESDE 1948', 64, 77);
    ctx.fillStyle = '#8d3e32'; ctx.fillRect(18, 89, 92, 3);
    ctx.font = 'bold 8px monospace'; ctx.fillText('ESTOQUE ESGOTADO', 64, 105);
    ctx.fillStyle = 'rgba(206,187,145,.24)';
    for (let x = 18; x < 116; x += 16) ctx.fillRect(x, 24, 1, 84);
  });
  const glass = new THREE.MeshPhysicalMaterial({
    color: 0x1d2a2b, roughness: 0.08, metalness: 0.35, transparent: true, opacity: 0.55,
    envMapIntensity: 1.6, depthWrite: false,
  });
  glass.userData.tile = 2;

  const materials = {
    asphalt: pbr('asphalt_02', { tile: 3.2, roughness: 0.82, normalScale: 1, aoIntensity: 0.8, envMapIntensity: 1.5, color: 0xb9b7af }),
    brick: pbr('red_brick', { tile: 2.8, roughness: 1, normalScale: 1, color: 0xa39a84 }),
    brickSoot: pbr('brick_wall_10', { tile: 2.8, roughness: 1, normalScale: 1, color: 0x8b8880 }),
    concrete: pbr('concrete_pavement', { tile: 2.4, roughness: 1, normalScale: 0.9, color: 0x9c968a }),
    trim: pbr('wooden_panels', { tile: 2, roughness: 0.9, color: 0x5b4636 }),
    wood: pbr('dark_wooden_planks', { tile: 1.7, roughness: 0.9 }),
    rust: pbr('rusty_metal', { tile: 1.6, roughness: 1, metalness: 1 }),
    metal: pbr('metal_plate_02', { tile: 1.4, roughness: 0.82, metalness: 1 }),
    glass,
    sign: solid({ color: 0x9a6e32, roughness: 0.6, metalness: 0.3, emissive: 0x201304, emissiveIntensity: 1 }),
    rpdSign: solid({ map: rpdSign, color: 0xffffff, roughness: 0.55, metalness: 0.2 }),
    storefrontSign: solid({ map: storefrontSign, color: 0xffffff, roughness: 0.8, metalness: 0.1 }),
    glow: glow(0xffc66e, 2.2),
    puddle: new THREE.MeshPhysicalMaterial({
      color: 0x0a1214, roughness: 0.04, metalness: 0.35, transparent: true,
      opacity: 0.72, depthWrite: false, envMapIntensity: 2.2,
    }),
  };
  let streetSeed = 0x2d8147;
  const streetRandom = () => ((streetSeed = (Math.imul(streetSeed, 1664525) + 1013904223) >>> 0) / 4294967296);
  // Caixas estáticas ligadas direto ao grupo da rua: no fim da construção elas são
  // fundidas por material e por célula espacial (ver mergeStaticBoxes), o que troca
  // centenas de draw calls (e de passes de sombra) por algumas dezenas.
  const staticBoxes = [];
  const box = (w, h, d, material, x, y, z, parent = group) => {
    const geometry = new THREE.BoxGeometry(w, h, d);
    worldUV(geometry, material.userData.tile ?? 2);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(x, y, z); mesh.castShadow = true; mesh.receiveShadow = true;
    parent.add(mesh);
    if (parent === group) staticBoxes.push(mesh);
    return mesh;
  };
  const MERGE_CELL = 16;      // metros: mantém culling e raycast locais
  const MERGE_BIG = 24;       // caixas maiores que isso (pista, calçadas) ficam num balde próprio
  // As caixas originais saem da cena mas continuam como alvos de raycast (câmera, tiros, mira):
  // a colisão fica idêntica à de antes e só o desenho usa a geometria fundida.
  const occluderProxies = [];
  function mergeStaticBoxes() {
    const buckets = new Map();
    for (const mesh of staticBoxes) {
      const material = mesh.material;
      if (mesh.parent !== group || material.transparent) continue;
      const { width, height, depth } = mesh.geometry.parameters;
      const cell = Math.max(width, height, depth) > MERGE_BIG
        ? 'big'
        : `${Math.floor(mesh.position.x / MERGE_CELL)},${Math.floor(mesh.position.z / MERGE_CELL)}`;
      const key = `${material.uuid}|${mesh.castShadow ? 1 : 0}|${mesh.receiveShadow ? 1 : 0}|${cell}`;
      let bucket = buckets.get(key);
      if (!bucket) buckets.set(key, bucket = { material, cast: mesh.castShadow, receive: mesh.receiveShadow, meshes: [] });
      bucket.meshes.push(mesh);
    }
    for (const { material, cast, receive, meshes } of buckets.values()) {
      if (meshes.length < 2) continue;
      const geometries = meshes.map((mesh) => {
        mesh.updateMatrix();
        return mesh.geometry.clone().applyMatrix4(mesh.matrix);
      });
      const merged = mergeGeometries(geometries, false);
      geometries.forEach((geometry) => geometry.dispose());
      if (!merged) continue;
      const combined = new THREE.Mesh(merged, material);
      combined.castShadow = cast; combined.receiveShadow = receive;
      combined.userData.renderOnly = true;
      group.add(combined);
      for (const mesh of meshes) {
        mesh.updateMatrixWorld(true);
        group.remove(mesh);
        occluderProxies.push(mesh);
      }
    }
  }
  const occluders = [];
  const streetLightPool = new LightPool(group, { count: 8 });
  const modelLoader = new GLTFLoader();
  const streetDoorLeaves = [];
  let streetDoorTarget = 0;
  let pendingDoorTransition = null;
  let streetDoorItem = null;
  let hospitalDoorTarget = 0;
  let pendingHospitalTransition = null;
  let hospitalDoorItem = null;
  const hospitalDoorLeaves = [];
  // Cada arquivo é baixado e decodificado uma única vez; as instâncias são clones que dividem geometria e
  // texturas (antes, cada torre/bloco repetia o GLB inteiro na memória da GPU).
  const modelCache = new Map();
  const loadShared = (asset, onSuccess, onError) => {
    let entry = modelCache.get(asset);
    if (!entry) {
      entry = { scene: null, error: null, waiting: [] };
      modelCache.set(asset, entry);
      const current = entry;
      modelLoader.load(asset, (gltf) => {
        current.scene = gltf.scene;
        current.waiting.forEach(([ok]) => ok({ scene: gltf.scene.clone(true) }));
        current.waiting.length = 0;
      }, undefined, (error) => {
        current.error = error;
        current.waiting.forEach(([, fail]) => fail(error));
        current.waiting.length = 0;
      });
    }
    if (entry.scene) onSuccess({ scene: entry.scene.clone(true) });
    else if (entry.error) onError(entry.error);
    else entry.waiting.push([onSuccess, onError]);
  };
  const loadStreetModel = (asset, { height, scale, position, rotationY = 0, tint = 1, occlude = true, rough = 0.9 }, onLoad = () => {}) => {
    loadShared(asset, ({ scene: model }) => {
      model.rotation.y = rotationY;
      model.updateMatrixWorld(true);
      const initialBounds = new THREE.Box3().setFromObject(model);
      const size = initialBounds.getSize(new THREE.Vector3());
      if (!Number.isFinite(size.y) || size.y <= 0) {
        console.error(`O modelo ${asset} tem dimensoes invalidas.`);
        return;
      }
      model.scale.setScalar(height ? height / size.y : scale);
      model.updateMatrixWorld(true);
      const bounds = new THREE.Box3().setFromObject(model);
      const center = bounds.getCenter(new THREE.Vector3());
      model.position.set(position.x - center.x, position.y - bounds.min.y, position.z - center.z);
      model.traverse((object) => {
        if (!object.isMesh) return;
        object.castShadow = true;
        object.receiveShadow = true;
        const tintMaterial = (material) => {
          const copy = material.clone();
          if (copy.color) copy.color.multiplyScalar(tint);
          if ('roughness' in copy) copy.roughness = Math.max(copy.roughness, rough);
          return copy;
        };
        object.material = Array.isArray(object.material)
          ? object.material.map(tintMaterial)
          : tintMaterial(object.material);
      });
      group.add(model);
      if (occlude) model.traverse((object) => { if (object.isMesh) occluders.push(object); });
      onLoad(model);
    }, (error) => {
      console.error(`Nao foi possivel carregar o asset ${asset}:`, error);
      if (asset.includes('car_burnt')) car.visible = true;
    });
  };
  const streetLights = [];
  const flickeringStoreLights = [];
  const alleyLights = [];

  // Colisão + proxy de raycast (câmera/tiros) para os prédios novos: os GLB são pesados demais para raycast por malha.
  const collisions = new CollisionWorld();
  const registerSolid = (cx, cz, w, d, h, y0 = 0) => {
    collisions.addBox(cx, cz, w, d, { y0, y1: y0 + h });
    const proxy = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshBasicMaterial());
    proxy.position.set(cx, y0 + h / 2, cz);
    proxy.updateMatrixWorld(true);
    occluders.push(proxy);
  };

  box(24, 0.35, 90, materials.asphalt, 0, -0.18, 35);
  box(3.2, 0.35, 90, materials.concrete, -13.1, -0.15, 35);
  box(3.2, 0.35, 90, materials.concrete, 13.1, -0.15, 35);
  for (const side of [-1, 1]) {
    box(2.7, 0.14, 90, materials.concrete, side * 13.25, 0.06, 35);
    box(0.18, 0.22, 90, materials.trim, side * 11.88, 0.045, 35);
    box(0.28, 0.2, 90, materials.trim, side * 12.02, -0.015, 35);
    for (let z = -7; z < 79; z += 4) {
      box(3.05, 0.012, 0.035, materials.trim, side * 13.1, 0.035, z);
      box(2.64, 0.009, 0.025, materials.trim, side * 13.25, 0.136, z);
    }
  }
  const lanePaint = solid({ color: 0x91805b, transparent: true, opacity: 0.62, roughness: 0.9 });
  for (let z = -4; z < 76; z += 8) {
    for (const x of [-0.12, 0.12]) {
      const dash = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.008, 2.8), lanePaint);
      dash.position.set(x, 0.003, z + 1.4);
      group.add(dash);
    }
  }
  const crosswalkPaint = solid({ color: 0xaaa593, transparent: true, opacity: 0.36, roughness: 0.9 });
  for (let x = -6.5; x <= 6.5; x += 1.9) {
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.008, 0.12), crosswalkPaint);
    stripe.position.set(x, 0.004, -4.1);
    group.add(stripe);
  }
  // ── Prédios (assets novos) ────────────────────────────────────────────────
  // city_block: bloco de 4 andares (~24,5 m de frente × 10,6 m de fundo × 13 m); o pórtico rosa avança ~1,75 m
  // sobre a calçada. tower: torre de concreto (~10,5 × 14,4 m na planta, 25 m de altura), fachada de janelas em +x.
  const CITY_SCALE = 0.02395;
  const TOWER_SCALE = 3;
  // Itens/props que só podem ser criados depois que `props` e `streetProps` existirem (bloco mais abaixo).
  const pendingProps = [];
  const pendingFurniture = [];
  const cityState = { ammo: false };

  // ── city_block: o térreo tem hall, salas e móveis de verdade (a entrada já vem aberta) ──
  // Mapeia coordenadas do GLB (unidades originais) para o mundo; o modelo é centrado na caixa dele.
  const CITY = { cx: 81.46, cz: 189.235, floorY: 11.2 };
  const cityToWorld = (side, zc, nx, nz) => ({
    x: side * 19.1 + side * (nz - CITY.cz) * CITY_SCALE,
    z: zc - side * (nx - CITY.cx) * CITY_SCALE,
  });
  const placeCity = (side, zc, interior = {}) => {
    loadStreetModel('/models/street/city_block.glb', {
      scale: CITY_SCALE, position: { x: side * 19.1, y: 0, z: zc }, rotationY: side * Math.PI / 2, tint: 0.66, occlude: false,
    });
    const rect = (x0, x1, z0, z1) => {
      const a = cityToWorld(side, zc, x0, z0), b = cityToWorld(side, zc, x1, z1);
      return { cx: (a.x + b.x) / 2, cz: (a.z + b.z) / 2, w: Math.abs(a.x - b.x), d: Math.abs(a.z - b.z) };
    };
    // Parte alta (câmera/tiros): do teto do térreo para cima.
    registerSolid(side * 20.0, zc, 10.6, 24.5, 10.3, 2.9);
    // Paredes e móveis do térreo, geradas automaticamente do próprio modelo (tools/build-interior-colliders.mjs).
    for (const [x0, x1, z0, z1] of cityWalls.rects) {
      const r = rect(x0, x1, z0, z1);
      registerSolid(r.cx, r.cz, Math.max(r.w, 0.14), Math.max(r.d, 0.14), 2.9);
    }
    // Perímetro de segurança: vidros translúcidos não geram parede. A porta fica no vão x ∈ [97, 175].
    for (const [x0, x1, z0, z1] of [[-440, 97, 3, 14], [175, 600, 3, 14], [-440, -424, 3, 452], [585, 600, 3, 452], [-440, 600, 440, 452]]) {
      const r = rect(x0, x1, z0, z1);
      registerSolid(r.cx, r.cz, r.w, r.d, 2.9);
    }
    // Pisos: hall interno e o pórtico (27 cm acima da calçada, como no modelo).
    const floorY = CITY.floorY * CITY_SCALE;
    for (const [x0, x1, z0, z1] of [[-428, 188, 7, 263], [92, 180, -66, 8]]) {
      const r = rect(x0, x1, z0, z1);
      collisions.floors.unshift({ minX: r.cx - r.w / 2, maxX: r.cx + r.w / 2, minZ: r.cz - r.d / 2, maxZ: r.cz + r.d / 2, y: floorY });
    }
    // Luz da entrada + luzes internas fracas e instáveis.
    const doorLight = streetLightPool.add({
      position: new THREE.Vector3(side * 12.9, 3.4, zc - side * 1.3),       // sobre a porta (x ≈ 136 no modelo)
      color: 0xffa65e, intensity: 18, distance: 8, decay: 2,
    });
    flickeringStoreLights.push({ fixture: doorLight, base: 18, seed: zc + side * 11 });
    for (const [nx, nz, color, intensity, distance, seed] of [
      [-330, 120, 0xb9d3c0, 12, 8, 1.3], [-200, 70, 0xffa860, 8, 7, 4.2], [-40, 140, 0xb9d3c0, 13, 9, 7.7], [140, 100, 0xffa860, 9, 7, 9.1],
    ]) {
      const at = cityToWorld(side, zc, nx, nz);
      const fixture = streetLightPool.add({
        position: new THREE.Vector3(at.x, 112 * CITY_SCALE, at.z), color, intensity, distance, decay: 2,
      });
      flickeringStoreLights.push({ fixture, base: intensity, seed: seed + zc });
    }
    for (const item of interior.items ?? []) {
      const at = cityToWorld(side, zc, item.nx, item.nz);
      pendingProps.push({ ...item, pos: new THREE.Vector3(at.x, 0, at.z), y: floorY });
    }
  };

  // ── tower: casca de concreto com 3 portões de enrolar; o do meio sobe e abre a entrada ──
  const TOWER = { cx: 1.625, cz: -0.297, s: TOWER_SCALE };
  const towerToWorld = (side, zc, nx, nz) => {
    const centerX = side * (14.9 + 5.25);
    return side > 0
      ? { x: centerX - (nx - TOWER.cx) * TOWER.s, z: zc - (nz - TOWER.cz) * TOWER.s }
      : { x: centerX + (nx - TOWER.cx) * TOWER.s, z: zc + (nz - TOWER.cz) * TOWER.s };
  };
  const placeTower = (side, zc, tint = 0.72, enterable = false) => {
    const cx = side * (14.9 + 5.25);
    loadStreetModel('/models/street/tower.glb', {
      scale: TOWER_SCALE, position: { x: cx, y: 0, z: zc }, rotationY: side > 0 ? Math.PI : 0, tint, occlude: false,
    }, (model) => {
      if (!enterable) return;
      const door = model.getObjectByName('2_Door1_0');
      if (!door || !door.parent) return;
      // Sobe o portão do meio ~3,6 m (por trás da parede, como um portão de enrolar aberto).
      model.updateMatrixWorld(true);
      const inverse = new THREE.Matrix4().copy(door.parent.matrixWorld).invert();
      const origin = new THREE.Vector3(0, 0, 0).applyMatrix4(inverse);
      const lift = new THREE.Vector3(0, 3.6, 0).applyMatrix4(inverse).sub(origin);
      door.position.add(lift);
    });
    if (!enterable) { registerSolid(cx, zc, 10.5, 14.4, 25.4); return; }
    registerSolid(cx, zc, 10.5, 14.4, 21.7, 3.7);          // parte alta: só para câmera/tiros
    const rect = (x0, x1, z0, z1) => {
      const a = towerToWorld(side, zc, x0, z0), b = towerToWorld(side, zc, x1, z1);
      return { cx: (a.x + b.x) / 2, cz: (a.z + b.z) / 2, w: Math.abs(a.x - b.x), d: Math.abs(a.z - b.z) };
    };
    for (const [x0, x1, z0, z1] of [
      [-0.2, 0.1, -2.8, 2.2], [-0.2, 3.5, -2.8, -2.45], [-0.2, 3.5, 1.85, 2.2],   // fundo e laterais
      [3.1, 3.5, -2.8, -1.0], [3.1, 3.5, 0.5, 2.2],                                 // fachada, com o vão do portão do meio
    ]) {
      const r = rect(x0, x1, z0, z1);
      registerSolid(r.cx, r.cz, r.w, r.d, 3.7);
    }
    for (const [x0, x1, z0, z1] of [[0.05, 3.1, -2.4, 1.8], [3.0, 3.6, -1.0, 0.5]]) {
      const r = rect(x0, x1, z0, z1);
      collisions.floors.unshift({ minX: r.cx - r.w / 2, maxX: r.cx + r.w / 2, minZ: r.cz - r.d / 2, maxZ: r.cz + r.d / 2, y: 0 });
    }
    for (const [nx, nz, color, intensity, seed] of [[1.0, -1.2, 0xb9d3c0, 12, 2.2], [2.3, 0.9, 0xffa860, 8, 5.7]]) {
      const at = towerToWorld(side, zc, nx, nz);
      const fixture = streetLightPool.add({ position: new THREE.Vector3(at.x, 3.25, at.z), color, intensity, distance: 9, decay: 2 });
      flickeringStoreLights.push({ fixture, base: intensity, seed: seed + zc });
    }
    pendingFurniture.push({ side, zc });
  };
  const closeGap = (side, z0, z1) => {     // fresta entre um beco e o prédio vizinho
    const length = z1 - z0;
    if (length < 0.05) return;
    box(2.4, 9, length, materials.brickSoot, side * 15.9, 4.5, (z0 + z1) / 2);
    registerSolid(side * 15.9, (z0 + z1) / 2, 2.4, length, 9);
  };
  // Esquerda: três torres, becos entre elas e, em z ≈ 42, a rua transversal para o bairro.
  placeTower(-1, 13.05, 0.72, true);
  placeTower(-1, 31.45, 0.72, true);
  placeTower(-1, 53.15, 0.72, true);
  closeGap(-1, 0.35, 1.15); closeGap(-1, 5.05, 5.85);
  closeGap(-1, 60.35, 61.25); closeGap(-1, 65.15, HOSPITAL_ANNEX_Z);
  // Direita: bloco, beco, garagem (dá para entrar), bloco.
  placeCity(1, 16.5, { items: [
    { id: 'city-a-desk', nx: -250, nz: 60, radius: 2.2, label: 'Examinar mesa',
      onUse: (c) => c.toast('Uma lista de chamada com quase todos os nomes riscados. O último, ainda legível, está datado de ontem.') },
  ] });
  placeCity(1, 53.75, { items: [
    { id: 'city-b-ammo', nx: -300, nz: 200, radius: 2.0, label: 'Pegar munição de pistola',
      enabled: () => !cityState.ammo, onUse: (c) => { cityState.ammo = true; c.addAmmo(12); c.toast('Você pegou: Munição de pistola ×12'); } },
  ] });
  closeGap(1, 32.65, 33.15); closeGap(1, 40.85, 41.5);
  // Anexo do hospital: uma torre encostada na lateral da ala, em cada lado.
  if (useHospitalBuilding) {
    for (const side of [-1, 1]) placeTower(side, HOSPITAL_ANNEX_Z + 7.2, 0.6);
  }

  // Skyline: torres e blocos nos fundos da rua, bem escuros por causa da névoa.
  for (const [kind, x, z, height] of [
    ['city', -46, 96, 17], ['tower', -26, 92, 33], ['tower', -8, 99, 26],
    ['tower', 10, 94, 36], ['tower', 28, 97, 29], ['city', 50, 93, 17],
  ]) {
    loadStreetModel(`/models/street/${kind === 'city' ? 'city_block' : 'tower'}.glb`, {
      height, position: { x, y: 0, z }, rotationY: kind === 'city' ? Math.PI : 0, tint: 0.2, occlude: false,
    });
  }

  const alleyWall = pbr('red_brick', { tile: 2.6, roughness: 1, normalScale: 1, color: 0x9a8f7e });
  const alleyWallVariants = [alleyWall, materials.brickSoot, materials.concrete];
  const alleyMetal = pbr('metal_plate_02', { tile: 1.4, roughness: 0.85, metalness: 1, color: 0x6f736c });
  const garbageBag = solid({ color: 0x111413, roughness: 0.55, metalness: 0.05 });
  const alleyPaving = [0x948f82, 0x706d65, 0x4c4941].map((color) =>
    pbr('concrete_pavement', { tile: 2, color, roughness: 1, normalScale: 0.8 }));
  for (const side of [-1, 1]) {
    for (const [index, z] of ALLEY_Z[side].entries()) {
      const alleyFace = alleyWallVariants[(index + (side > 0 ? 1 : 0)) % alleyWallVariants.length];
      box(6.7, 0.06, 4.4, materials.asphalt, side * 14.35, 0.02, z);
      box(5.9, 0.08, 4.0, alleyPaving[0], side * 14.3, 0.045, z);
      box(4.0, 0.06, 3.7, alleyPaving[1], side * 15.2, 0.09, z);
      box(2.0, 0.04, 3.4, alleyPaving[2], side * 16.3, 0.12, z);
      for (const wallZ of [z - 1.95, z + 1.95]) {
        box(5.8, 8.0, 0.2, alleyFace, side * 14.25, 4.0, wallZ);
        box(0.28, 3.35, 0.25, alleyMetal, side * 11.35, 1.68, wallZ);
      }
      box(0.24, 0.22, 4.15, alleyMetal, side * 11.35, 3.4, z);
      box(0.22, 8.0, 2.4, alleyFace, side * 17.0, 4.0, z + side * 1.2);
      box(0.18, 3.4, 0.18, alleyMetal, side * 11.05, 1.7, z - 2.45);
      box(0.18, 3.4, 0.18, alleyMetal, side * 11.05, 1.7, z + 2.45);

      const corridorX = side * 22.7;
      box(10.0, 0.06, 3.65, alleyPaving[index % alleyPaving.length], corridorX, 0.02, z);
      for (const wallSide of [-1, 1]) {
        box(10.0, 7.6, 0.28, alleyFace, corridorX, 3.8, z + wallSide * 1.9);
        box(0.08, 0.12, 10.0, alleyMetal, corridorX, 7.25, z + wallSide * 1.62);
      }
      box(0.4, 8.0, 4.0, alleyFace, side * 27.7, 4.0, z);
      box(0.08, 2.7, 1.55, materials.wood, side * 27.46, 1.38, z);
      box(0.1, 0.12, 0.16, materials.rust, side * 27.39, 1.34, z - 0.54);
      for (const [lampIndex, lampX] of [19.5, 24.0].entries()) {
        const lampZ = z + (lampIndex % 2 === 0 ? -1 : 1) * 1.76;
        const lampPosition = new THREE.Vector3(side * lampX, 3.35, lampZ);
        box(0.42, 0.12, 0.3, alleyMetal, lampPosition.x, 3.42, lampZ);
        const bulbMaterial = new THREE.MeshBasicMaterial({ color: lampIndex === 0 ? 0xffc27a : 0x8c7654 });
        const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.085, 6, 4), bulbMaterial);
        bulb.position.copy(lampPosition);
        group.add(bulb);
        const intensity = lampIndex === 0 ? 20 : 6;
        const fixture = streetLightPool.add({
          position: lampPosition, color: 0xffae68, intensity,
          distance: lampIndex === 0 ? 11 : 7, decay: 2,
        });
        alleyLights.push({ fixture, bulb: bulbMaterial, base: intensity, phase: streetRandom() * 8 });
      }
      if ((index + (side > 0 ? 1 : 0)) % 3 !== 0) {
        const tippedBin = new THREE.Group();
        const binBody = new THREE.Mesh(new THREE.BoxGeometry(1.25, 0.95, 1.0), alleyMetal);
        binBody.position.y = 0.45;
        binBody.castShadow = true;
        binBody.receiveShadow = true;
        tippedBin.add(binBody);
        const binLid = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.12, 1.08), materials.rust);
        binLid.position.set(0, 0.92, 0);
        binLid.castShadow = true;
        tippedBin.add(binLid);
        tippedBin.position.set(side * (21.5 + streetRandom() * 1.6), 0.55, z + (side > 0 ? 0.85 : -0.85));
        tippedBin.rotation.set(0, streetRandom() * Math.PI, side * (0.72 + streetRandom() * 0.18));
        group.add(tippedBin);
        for (let spill = 0; spill < 3; spill++) {
          const bag = new THREE.Mesh(new THREE.SphereGeometry(0.22 + streetRandom() * 0.08, 6, 4), garbageBag);
          bag.scale.set(1.2, 0.72, 0.9);
          bag.position.set(
            tippedBin.position.x + side * (0.8 + streetRandom() * 0.6),
            0.22,
            tippedBin.position.z + (streetRandom() - 0.5) * 1.4,
          );
          group.add(bag);
        }
      }

      if (index % 2 === 1) {
        const landingX = side * 16.25;
        const landingY = 3.0;
        box(1.65, 0.14, 2.5, alleyMetal, landingX, landingY, z);
        for (const railZ of [z - 1.2, z + 1.2]) {
          box(0.1, 0.9, 0.1, alleyMetal, landingX, landingY + 0.5, railZ);
        }
        box(1.65, 0.08, 0.08, alleyMetal, landingX, landingY + 0.92, z);
        for (let step = 0; step < 9; step++) {
          const progress = step / 8;
          box(
            0.48,
            0.12,
            2.15,
            alleyMetal,
            side * (13.05 + progress * 2.45),
            0.24 + progress * (landingY - 0.24),
            z + (side < 0 ? 1 : -1) * (1.25 - progress * 2.5),
          );
        }
        for (const railSide of [-1, 1]) {
          for (let post = 0; post < 5; post++) {
            const progress = post / 4;
            box(
              0.07,
              0.78,
              0.07,
              alleyMetal,
              side * (13.35 + progress * 2.1),
              0.5 + progress * 2.2,
              z + railSide * (1.15 - progress * 2.3),
            );
          }
        }
      }

      if ((index + (side > 0 ? 1 : 0)) % 2 === 0) {
        const dumpsterX = side * 13.55;
        const dumpsterZ = z + 1.7;
        box(1.55, 1.36, 1.75, alleyMetal, dumpsterX, 0.74, dumpsterZ);
        box(1.68, 0.14, 1.9, materials.rust, dumpsterX, 1.48, dumpsterZ);
        for (const wheelSide of [-1, 1]) {
          for (const wheelZ of [-0.52, 0.52]) {
            const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.12, 6), materials.trim);
            wheel.rotation.z = Math.PI / 2;
            wheel.position.set(dumpsterX + wheelSide * 0.8, 0.18, dumpsterZ + wheelZ);
            group.add(wheel);
          }
        }
      } else {
        const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.36, 0.95, 8), materials.rust);
        barrel.position.set(side * 13.7, 0.52, z + 1.9);
        group.add(barrel);
      }

      for (let piece = 0; piece < 4; piece++) {
        const debris = new THREE.Mesh(
          new THREE.BoxGeometry(0.24 + streetRandom() * 0.48, 0.06 + streetRandom() * 0.08, 0.18 + streetRandom() * 0.38),
          piece % 2 ? materials.brickSoot : materials.wood,
        );
        debris.position.set(
          side * (11.8 + streetRandom() * 2.6),
          0.06,
          z - 2.8 + streetRandom() * 5.6,
        );
        debris.rotation.y = streetRandom() * Math.PI;
        debris.castShadow = true;
        group.add(debris);
      }

      for (let bagIndex = 0; bagIndex < 2; bagIndex++) {
        const bag = new THREE.Mesh(new THREE.SphereGeometry(0.38, 7, 5), garbageBag);
        bag.scale.set(1.2, 0.75, 0.9);
        bag.position.set(side * (12.0 + bagIndex * 0.55), 0.3, z - 1.5 + bagIndex * 0.75);
        bag.rotation.y = streetRandom() * Math.PI;
        group.add(bag);
      }
    }
  }

  // Prédio do hospital, no fim da rua: o GLB do encaixe `exterior` (se houver) ou a fachada procedural.
  if (useHospitalBuilding) {
    // o prédio é posicionado mais adiante (precisa da colisão da rua), junto da porta
  } else if (hospitalExterior) {
    const [px, py, pz] = hospitalExterior.position ?? [0, 0, 73.5];
    loadStreetModel(hospitalExterior.url, {
      height: hospitalExterior.height, position: { x: px, y: py, z: pz },
      rotationY: hospitalExterior.rotationY ?? Math.PI, tint: hospitalExterior.tint ?? 0.6,
    });
  } else {
    buildHospitalFacade(group);
  }
  if (!useHospitalBuilding) {   // o prédio do pacote já traz a sua própria placa
  const hospitalSignCanvas = document.createElement('canvas');
  hospitalSignCanvas.width = 512;
  hospitalSignCanvas.height = 128;
  const hospitalSignContext = hospitalSignCanvas.getContext('2d');
  hospitalSignContext.fillStyle = '#18222a';
  hospitalSignContext.fillRect(0, 0, 512, 128);
  hospitalSignContext.strokeStyle = '#b3b8b2';
  hospitalSignContext.lineWidth = 6;
  hospitalSignContext.strokeRect(5, 5, 502, 118);
  hospitalSignContext.fillStyle = '#d2d3c7';
  hospitalSignContext.textAlign = 'center';
  hospitalSignContext.font = 'bold 42px sans-serif';
  hospitalSignContext.fillText('RACCOON CITY', 256, 57);
  hospitalSignContext.font = 'bold 35px sans-serif';
  hospitalSignContext.fillText('HOSPITAL', 256, 104);
  const hospitalSignTexture = new THREE.CanvasTexture(hospitalSignCanvas);
  hospitalSignTexture.colorSpace = THREE.SRGBColorSpace;
  const hospitalSignMaterial = solid({ map: hospitalSignTexture, color: 0xffffff, roughness: 0.55, metalness: 0.2, emissive: 0x2a2f31, emissiveIntensity: 0.4 });
  box(4.5, 1.32, 0.16, materials.trim, 0, 13.2, 67.55);
  const hospitalSign = new THREE.Mesh(new THREE.PlaneGeometry(4.2, 1.05), hospitalSignMaterial);
  hospitalSign.position.set(0, 13.2, 67.45);
  hospitalSign.rotation.y = Math.PI;
  group.add(hospitalSign);
  box(0.16, 0.76, 0.12, materials.rust, 0, 11.6, 67.6);
  box(0.56, 0.16, 0.12, materials.rust, 0, 11.6, 67.6);
  }

  // Cidade ao fundo (skyline/horizonte urbano) e estrelas ficavam sempre invisíveis e foram
  // removidos; o gerador pseudoaleatório avança o mesmo tanto para não alterar o que vem depois.
  for (let i = 0; i < 1168; i++) streetRandom();

  box(18, 8.5, 0.7, materials.brickSoot, 0, 4.2, -10.15);
  box(18.5, 0.38, 0.95, materials.trim, 0, 8.65, -10.15);
  box(18.5, 0.34, 0.84, materials.concrete, 0, 0.2, -9.72);
  for (const x of [-8.2, -5.2, 5.2, 8.2]) {
    box(0.52, 8.0, 0.34, materials.concrete, x, 4.25, -9.72);
    box(0.78, 0.28, 0.52, materials.trim, x, 0.3, -9.69);
    box(0.78, 0.28, 0.52, materials.trim, x, 8.22, -9.69);
  }
  for (const x of [-3.25, 3.25]) {
    box(1.95, 1.65, 0.08, materials.glass, x, 6.25, -9.72);
    box(2.14, 0.12, 0.18, materials.trim, x, 7.13, -9.68);
    box(2.14, 0.12, 0.18, materials.trim, x, 5.37, -9.68);
    box(0.12, 1.75, 0.18, materials.trim, x - 1.05, 6.25, -9.68);
    box(0.12, 1.75, 0.18, materials.trim, x + 1.05, 6.25, -9.68);
    box(2.0, 0.1, 0.2, materials.rust, x, 5.32, -9.65);
  }
  box(19.2, 0.28, 0.8, materials.trim, 0, 8.92, -9.74);
  for (const side of [-1, 1]) {
    const lampX = side * 2.85;
    box(0.42, 0.12, 0.28, materials.metal, lampX, 4.0, -9.67);
    box(0.24, 0.08, 0.22, materials.glow, lampX, 3.91, -9.52);
    const entryFixture = streetLightPool.add({
      position: new THREE.Vector3(lampX, 3.94, -9.45),
      color: 0xffc27a, intensity: 20, distance: 9, decay: 2,
    });
    flickeringStoreLights.push({ fixture: entryFixture, base: 20, seed: side * 2.5 });
  }
  for (const [step, width] of [[0, 5.3], [1, 6.2], [2, 7.1]]) {
    box(width, 0.14, 0.62, materials.concrete, 0, 0.09 + step * 0.14, -8.7 + step * 0.62);
  }
  for (const side of [-1, 1]) {
    loadStreetModel('/models/street/tower.glb', {
      scale: 2.2, position: { x: side * 19.0, y: 0, z: -13 }, rotationY: side > 0 ? Math.PI : 0, tint: 0.5, occlude: false,
    });
  }

  // The local building models frame a recessed, readable police-station entrance.
  for (const side of [-1, 1]) {
    box(6.2, 9.2, 10.5, materials.brickSoot, side * 11.8, 4.6, -4.9);
    box(6.25, 0.24, 10.55, materials.trim, side * 11.8, 9.32, -4.9);
  }
  box(0.58, 4.9, 0.9, materials.concrete, -1.83, 2.45, -9.55);
  box(0.58, 4.9, 0.9, materials.concrete, 1.83, 2.45, -9.55);
  box(4.6, 0.68, 1.35, materials.trim, 0, 5.15, -9.55);
  box(5.8, 2.4, 1.25, materials.concrete, 0, 6.6, -9.7);
  box(5.1, 0.22, 1.4, materials.trim, 0, 7.9, -9.6);
  box(4.8, 1.35, 0.08, materials.trim, 0, 6.7, -9.01);
  const rpdPlaque = new THREE.Mesh(new THREE.PlaneGeometry(4.55, 1.12), materials.rpdSign);
  rpdPlaque.position.set(0, 6.7, -8.96);
  rpdPlaque.castShadow = true;
  rpdPlaque.receiveShadow = true;
  group.add(rpdPlaque);
  box(2.68, 3.22, 0.04, new THREE.MeshBasicMaterial({ color: 0x010203 }), 0, 1.61, -9.39);
  const exteriorDoorPanel = pbr('wooden_panels', { tile: 1.3, color: 0x5e7c6c, roughness: 0.9, normalScale: 0.7 });
  const exteriorDoorTrim = pbr('wooden_panels', { tile: 1.0, color: 0xb08a5e, roughness: 0.85, normalScale: 0.7 });
  const exteriorBrass = solid({ color: 0x8c7041, roughness: 0.3, metalness: 0.95, tile: 1 });
  for (const side of [-1, 1]) {
    const leafWidth = 1.18;
    const hinge = new THREE.Group();
    hinge.position.set(side * 1.2, 0, -9.28);
    const leafPart = (width, height, depth, material, x, y, z) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), material);
      mesh.position.set(x, y, z);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      hinge.add(mesh);
    };
    leafPart(leafWidth, 2.96, 0.12, exteriorDoorPanel, -side * leafWidth / 2, 1.5, 0);
    leafPart(leafWidth - 0.26, 0.78, 0.045, exteriorDoorTrim, -side * leafWidth / 2, 0.67, 0.085);
    leafPart(leafWidth - 0.26, 0.68, 0.045, exteriorDoorTrim, -side * leafWidth / 2, 2.29, 0.085);
    leafPart(0.045, 0.28, 0.06, exteriorBrass, -side * (leafWidth - 0.18), 1.46, 0.11);
    leafPart(0.07, 2.98, 0.07, exteriorDoorTrim, -side * (leafWidth - 0.05), 1.5, 0.07);
    streetDoorLeaves.push({ hinge, side });
    group.add(hinge);
  }

  const car = new THREE.Group();
  car.position.set(-3.2, 0.12, 9.3);
  car.rotation.y = -0.52;
  const bodyPaint = solid({ color: 0x46534f, roughness: 0.55, metalness: 0.55, tile: 2, emissive: 0x080a09 });
  const bodyShape = new THREE.Shape();
  bodyShape.moveTo(-2.15, 0.42); bodyShape.lineTo(2.1, 0.42); bodyShape.lineTo(2.18, 0.73);
  bodyShape.lineTo(1.72, 0.97); bodyShape.lineTo(-1.42, 0.97); bodyShape.lineTo(-1.9, 0.8); bodyShape.closePath();
  const bodyGeo = new THREE.ExtrudeGeometry(bodyShape, { depth: 1.82, bevelEnabled: true, bevelThickness: 0.045, bevelSize: 0.05, bevelSegments: 1 });
  bodyGeo.translate(0, 0, -0.91); bodyGeo.rotateY(Math.PI / 2);
  const shell = new THREE.Mesh(bodyGeo, bodyPaint);
  shell.castShadow = true; shell.receiveShadow = true; car.add(shell);
  const cabinShape = new THREE.Shape();
  cabinShape.moveTo(-1.42, 0.93); cabinShape.lineTo(-0.74, 1.92);
  cabinShape.lineTo(0.77, 1.84); cabinShape.lineTo(1.42, 0.93); cabinShape.closePath();
  const cabinGeo = new THREE.ExtrudeGeometry(cabinShape, { depth: 1.58, bevelEnabled: true, bevelThickness: 0.035, bevelSize: 0.04, bevelSegments: 1 });
  cabinGeo.translate(0, 0, -0.79); cabinGeo.rotateY(Math.PI / 2);
  const cabin = new THREE.Mesh(cabinGeo, solid({ color: 0x313a39, roughness: 0.15, metalness: 0.4, tile: 2 }));
  cabin.castShadow = true; car.add(cabin);
  for (const side of [-1, 1]) {
    for (const z of [-1.42, 1.42]) {
      const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.39, 0.39, 0.22, 8), materials.trim);
      wheel.rotation.z = Math.PI / 2; wheel.position.set(side * 1.05, 0.43, z); wheel.castShadow = true; car.add(wheel);
    }
    box(0.03, 0.38, 1.32, materials.glass, side * 0.9, 1.46, -0.1, car);
    box(0.09, 0.24, 0.54, materials.rust, side * 1.1, 0.9, -1.75, car);
  }
  box(1.75, 0.12, 0.05, materials.glow, 0, 0.92, -2.14, car);
  box(1.0, 0.26, 0.08, materials.rust, -0.2, 0.46, 2.12, car);
  car.visible = false;
  group.add(car);
  // Fogo procedural: ruído fractal (fbm) rolando para cima, coluna que afina com a altura e rampa de cor
  // (vermelho escuro → laranja → amarelo → branco quente no miolo). Mistura aditiva, sem texturas.
  const flameMaterial = (seed) => new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    uniforms: { time: { value: 0 }, seed: { value: seed } },
    vertexShader: `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform float time;
      uniform float seed;
      varying vec2 vUv;
      float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float noise(vec2 p) {
        vec2 i = floor(p), f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
      }
      float fbm(vec2 p) {
        float v = 0.0, a = 0.5;
        for (int i = 0; i < 4; i++) { v += a * noise(p); p = p * 2.03 + 17.0; a *= 0.5; }
        return v;
      }
      void main() {
        float y = vUv.y;
        float x = (vUv.x - 0.5) * 2.0;
        vec2 p = vec2(x * 1.6 + seed * 7.3, y * 2.6 - time * 1.9);
        float warp = fbm(p * 1.4 + vec2(0.0, -time * 1.1)) - 0.5;
        float n = fbm(p + vec2(warp * 1.5, 0.0));
        float width = mix(1.0, 0.16, pow(y, 0.75));
        float body = 1.0 - smoothstep(0.0, 1.0, abs(x + warp * 0.55 * y) / width + (n - 0.5) * 0.8 * y);
        float top = 1.0 - smoothstep(0.38, 1.0, y + (n - 0.5) * 0.6);
        float heat = body * top * (0.45 + n * 1.05) * smoothstep(0.0, 0.07, y);
        float flicker = 0.9 + 0.1 * sin(time * 17.0 + seed * 3.0);
        heat *= flicker;
        if (heat < 0.03) discard;
        vec3 color = mix(vec3(0.42, 0.015, 0.0), vec3(1.0, 0.3, 0.015), smoothstep(0.08, 0.45, heat));
        color = mix(color, vec3(1.0, 0.72, 0.2), smoothstep(0.4, 0.8, heat));
        color = mix(color, vec3(1.0, 0.96, 0.78), smoothstep(0.8, 1.15, heat));
        float alpha = clamp(heat * 1.35, 0.0, 1.0);
        gl_FragColor = vec4(color * alpha, alpha);
      }
    `,
  });
  const smokeTexture = (() => {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 128;
    const ctx = canvas.getContext('2d');
    for (let layer = 0; layer < 5; layer++) {
      const x = 34 + streetRandom() * 60;
      const y = 30 + streetRandom() * 68;
      const radius = 16 + streetRandom() * 24;
      const gradient = ctx.createRadialGradient(x, y, 2, x, y, radius);
      gradient.addColorStop(0, `rgba(64,68,67,${0.24 + streetRandom() * 0.12})`);
      gradient.addColorStop(0.52, `rgba(76,80,79,${0.16 + streetRandom() * 0.1})`);
      gradient.addColorStop(1, 'rgba(85,89,87,0)');
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, 128, 128);
    }
    const map = new THREE.CanvasTexture(canvas);
    map.colorSpace = THREE.SRGBColorSpace;
    return map;
  })();
  const embers = [];
  const addWreck = (asset, position, rotationY, height, tint, fireYaw = rotationY) => {
    loadStreetModel(asset, { height, position, rotationY, tint, rough: 0.82 }, () => {
      if (asset.includes('car_burnt')) {
        car.visible = false;
        fire.position.set(position.x, 0, position.z);
        fire.rotation.y = fireYaw;
        fire.visible = true;
      }
    });
  };
  new GLTFLoader().load('/models/covered_car/covered_car_1k.gltf', (gltf) => {
    const wreck = gltf.scene;
    wreck.position.set(-7.3, 0.02, 50);
    wreck.rotation.y = 0.35;
    wreck.scale.setScalar(1.04);
    wreck.traverse((object) => {
      if (!object.isMesh) return;
      object.castShadow = true;
      object.receiveShadow = true;
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
        material.color.multiplyScalar(0.76);
        if ('roughness' in material) material.roughness = 0.98;
      }
    });
    const scorchMaterial = new THREE.MeshBasicMaterial({
      color: 0x26221d, transparent: true, opacity: 0.6, depthWrite: false,
    });
    for (const [x, y, z, sx, sz] of [
      [-0.2, 1.4, -0.55, 0.34, 0.22],
      [0.35, 1.35, 0.05, 0.25, 0.17],
      [-0.45, 1.2, 0.7, 0.28, 0.18],
    ]) {
      const scorch = new THREE.Mesh(new THREE.SphereGeometry(1, 8, 5), scorchMaterial);
      scorch.position.set(x, y, z);
      scorch.scale.set(sx, 0.035, sz);
      wreck.add(scorch);
    }
    group.add(wreck);
  }, undefined, (error) => {
    console.error('Nao foi possivel carregar o modelo CC0 do carro coberto:', error);
    car.visible = true;
  });
  // Carro escaneado, queimado (a frente aponta para -z, como o antigo); o fogo continua por cima.
  addWreck('/models/street/car_burnt.glb', { x: -3.2, y: 0, z: 9.3 }, -0.52 + Math.PI / 2, 1.28, 0.9, -0.52);
  addWreck('/models/police_car/police_car.glb', { x: 6.7, y: 0, z: 30 }, Math.PI * 0.57, 2.0, 0.48);
  box(0.48, 0.11, 0.4, materials.rust, 5.9, 0.12, 31.7);
  box(0.68, 0.12, 0.32, materials.metal, 7.8, 0.1, 28.5);

  const glassShards = solid({ color: 0x879a98, roughness: 0.15, metalness: 0.35, emissive: 0x11191a });
  for (let i = 0; i < 32; i++) {
    const x = -3.2 + (streetRandom() - 0.5) * 5.2;
    const z = 9.3 + (streetRandom() - 0.5) * 5.4;
    const shape = new THREE.Shape();
    shape.moveTo(0, 0);
    shape.lineTo(0.08 + streetRandom() * 0.15, 0.02);
    shape.lineTo(0.03, 0.08 + streetRandom() * 0.13);
    shape.closePath();
    const shard = new THREE.Mesh(new THREE.ShapeGeometry(shape), glassShards);
    shard.rotation.x = -Math.PI / 2;
    shard.rotation.z = streetRandom() * Math.PI;
    shard.position.set(x, 0.012, z);
    group.add(shard);
  }
  const detachedWheel = new THREE.Mesh(
    new THREE.CylinderGeometry(0.36, 0.36, 0.2, 10),
    solid({ color: 0x222321, roughness: 0.9, metalness: 0.1 }),
  );
  detachedWheel.rotation.z = Math.PI / 2;
  detachedWheel.rotation.x = 0.26;
  detachedWheel.position.set(-5.3, 0.36, 10.7);
  detachedWheel.castShadow = true;
  group.add(detachedWheel);
  const tornDoor = box(0.09, 0.82, 1.25, materials.rust, -5.0, 0.48, 8.1);
  tornDoor.rotation.y = -0.72;
  tornDoor.rotation.z = 0.14;
  box(0.1, 0.12, 0.16, materials.metal, -5.0, 0.51, 8.74);

  const fire = new THREE.Group();
  fire.position.set(-3.2, 0, 9.3);
  const flames = [];
  // Línguas de fogo (base y, largura, altura): cofre do motor (frente = -z), cabine e porta-malas.
  for (const [i, [x, y, z, w, h]] of [
    [0, 0.8, -1.45, 1.7, 2.6], [0.28, 0.86, -1.0, 1.2, 2.0], [-0.3, 0.84, -1.8, 1.1, 1.8],
    [0.1, 0.95, -0.2, 1.3, 2.2], [-0.35, 1.0, 0.35, 1.0, 1.8], [0.2, 0.9, 0.95, 0.95, 1.5],
    [0.42, 0.7, -2.0, 0.7, 1.2], [-0.45, 0.75, -0.7, 0.8, 1.4],
  ].entries()) {
    const geometry = new THREE.PlaneGeometry(w, h);
    geometry.translate(0, h / 2, 0);              // pivô na base: a chama gira de frente para a câmera pelo pé
    const flame = new THREE.Mesh(geometry, flameMaterial(i * 1.91));
    flame.position.set(x, y, z);
    flame.userData.seed = i * 1.91;
    flame.renderOrder = 6;
    flames.push(flame);
    fire.add(flame);
  }
  // Mancha de fuligem e combustível queimado no asfalto, com bordas suaves.
  const scorchCanvas = document.createElement('canvas');
  scorchCanvas.width = scorchCanvas.height = 128;
  const scorchCtx = scorchCanvas.getContext('2d');
  const scorchGradient = scorchCtx.createRadialGradient(64, 64, 8, 64, 64, 62);
  scorchGradient.addColorStop(0, 'rgba(12,10,8,0.82)');
  scorchGradient.addColorStop(0.42, 'rgba(24,17,12,0.62)');
  scorchGradient.addColorStop(0.72, 'rgba(44,25,13,0.24)');
  scorchGradient.addColorStop(1, 'rgba(30,20,14,0)');
  scorchCtx.fillStyle = scorchGradient;
  scorchCtx.fillRect(0, 0, 128, 128);
  const scorchMap = new THREE.CanvasTexture(scorchCanvas);
  scorchMap.colorSpace = THREE.SRGBColorSpace;
  const scorchGround = new THREE.Mesh(
    new THREE.PlaneGeometry(4.8, 3.5),
    new THREE.MeshBasicMaterial({ map: scorchMap, transparent: true, opacity: 0.72, depthWrite: false }),
  );
  scorchGround.rotation.x = -Math.PI / 2;
  scorchGround.position.set(0, 0.018, 0.12);
  fire.add(scorchGround);
  // Luz do fogo espalhada no asfalto molhado (aditivo, pulsa junto com as chamas).
  const glowCanvas = document.createElement('canvas');
  glowCanvas.width = glowCanvas.height = 128;
  const glowCtx = glowCanvas.getContext('2d');
  const glowGradient = glowCtx.createRadialGradient(64, 64, 2, 64, 64, 62);
  glowGradient.addColorStop(0, 'rgba(255,170,80,0.9)');
  glowGradient.addColorStop(0.35, 'rgba(255,100,30,0.45)');
  glowGradient.addColorStop(1, 'rgba(255,60,10,0)');
  glowCtx.fillStyle = glowGradient;
  glowCtx.fillRect(0, 0, 128, 128);
  const glowGround = new THREE.Mesh(
    new THREE.PlaneGeometry(9, 9),
    new THREE.MeshBasicMaterial({
      map: new THREE.CanvasTexture(glowCanvas), transparent: true, opacity: 0.4, depthWrite: false,
      blending: THREE.AdditiveBlending, fog: false,
    }),
  );
  glowGround.rotation.x = -Math.PI / 2;
  glowGround.position.set(0, 0.035, -0.3);
  fire.add(glowGround);
  group.add(fire);
  fire.userData.noAO = true; // fogo/fumaça não devem virar oclusores do GTAO
  const fireLight = new THREE.PointLight(0xff6a24, 42, 14, 1.65);
  fireLight.position.set(0, 1.5, -0.35);
  fire.add(fireLight);
  const smokePuffs = [];
  for (let i = 0; i < 10; i++) {
    const smokeMaterial = new THREE.SpriteMaterial({
      map: smokeTexture, color: i % 3 === 0 ? 0x4a4e4d : 0x777c7b, transparent: true, opacity: 0.52,
      depthWrite: false, blending: THREE.NormalBlending,
    });
    const puff = new THREE.Sprite(smokeMaterial);
    puff.position.set((streetRandom() - 0.5) * 0.65, 1.7 + i * 0.3, -0.15 + streetRandom() * 0.55);
    puff.scale.set(1.0 + streetRandom() * 0.45, 1.3 + streetRandom() * 0.5, 1);
    puff.userData = { phase: i / 10, drift: streetRandom() * Math.PI * 2, originX: puff.position.x };
    smokePuffs.push(puff);
    fire.add(puff);
  }
  // Fagulhas: um único Points animado inteiramente na GPU (uma chamada de desenho, sem laço por quadro).
  const emberCount = 56;
  const emberGeometry = new THREE.BufferGeometry();
  const emberBase = new Float32Array(emberCount * 3);
  const emberData = new Float32Array(emberCount * 4);
  for (let i = 0; i < emberCount; i++) {
    emberBase.set([(streetRandom() - 0.5) * 1.1, 0.95 + streetRandom() * 0.35, -0.9 + (streetRandom() - 0.5) * 2.4], i * 3);
    emberData.set([streetRandom(), streetRandom(), 0.7 + streetRandom() * 1.4, 2.0 + streetRandom() * 3.0], i * 4);
  }
  emberGeometry.setAttribute('position', new THREE.BufferAttribute(emberBase, 3));
  emberGeometry.setAttribute('seedData', new THREE.BufferAttribute(emberData, 4));
  const emberMaterial = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { time: { value: 0 } },
    vertexShader: `
      attribute vec4 seedData;
      uniform float time;
      varying float vLife;
      varying float vFlick;
      void main() {
        float life = fract(time * 0.26 * (0.6 + seedData.z * 0.3) + seedData.x);
        vec3 p = position;
        p.y += life * seedData.z * 3.4;
        p.x += sin(time * 1.7 + seedData.y * 6.283) * (0.12 + life * 0.6) + life * 0.55;   // vento leve
        p.z += cos(time * 1.3 + seedData.y * 6.283) * (0.1 + life * 0.35);
        vLife = life;
        vFlick = 0.65 + 0.35 * sin(time * 21.0 + seedData.y * 40.0);
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_PointSize = seedData.w * (1.0 - life * 0.75) * (160.0 / max(0.5, -mv.z));
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: `
      varying float vLife;
      varying float vFlick;
      void main() {
        float d = length(gl_PointCoord - 0.5);
        if (d > 0.5) discard;
        float a = pow(1.0 - d * 2.0, 2.0) * (1.0 - vLife) * vFlick;
        vec3 color = mix(vec3(1.0, 0.85, 0.35), vec3(1.0, 0.22, 0.02), vLife);
        gl_FragColor = vec4(color * a * 1.5, a);
      }
    `,
  });
  const emberPoints = new THREE.Points(emberGeometry, emberMaterial);
  emberPoints.frustumCulled = false;
  fire.add(emberPoints);
  box(1.3, 0.12, 0.8, materials.metal, 1.0, 0.1, 5.2);
  box(0.8, 0.08, 0.42, materials.rust, -7, 0.06, 1.5);

  for (const [x, z, sx, sz] of [
    [-7, 4, 3, 1], [4, 12, 4, 1.2], [8, 4, 2, 0.8], [-9, 17, 3, 1],
    [-3.2, 9.3, 1.8, 0.7], [6.8, 26, 2.4, 0.8], [-5.4, 39, 3.2, 1.1],
  ]) {
    const puddle = new THREE.Mesh(new THREE.CircleGeometry(1, 9), materials.puddle);
    puddle.rotation.x = -Math.PI / 2; puddle.position.set(x, 0.006, z); puddle.scale.set(sx, sz, 1);
    puddle.receiveShadow = true; group.add(puddle);
  }
  const oil = new THREE.Mesh(
    new THREE.CircleGeometry(1, 10),
    new THREE.MeshBasicMaterial({ color: 0x252b29, transparent: true, opacity: 0.55, depthWrite: false }),
  );
  oil.rotation.x = -Math.PI / 2;
  oil.position.set(-3.2, 0.014, 9.3);
  oil.scale.set(1.25, 0.64, 1);
  group.add(oil);
  for (let i = 0; i < 18; i++) {
    const chunk = new THREE.Mesh(
      new THREE.BoxGeometry(0.12 + streetRandom() * 0.32, 0.05 + streetRandom() * 0.12, 0.12 + streetRandom() * 0.28),
      i % 2 ? materials.brickSoot : materials.concrete,
    );
    chunk.position.set(-3.2 + (streetRandom() - 0.5) * 10, 0.04, 9.3 + (streetRandom() - 0.5) * 10);
    chunk.rotation.y = streetRandom() * Math.PI;
    chunk.rotation.z = streetRandom() * 0.18;
    chunk.castShadow = true;
    group.add(chunk);
  }

  for (const side of [-1, 1]) {
    for (const z of [8, 28, 48, 68]) {
      const pole = new THREE.Mesh(
        new THREE.CylinderGeometry(0.09, 0.15, 8.6, 6),
        materials.rust,
      );
      pole.position.set(side * 12.7, 4.25, z);
      pole.castShadow = true;
      group.add(pole);
      box(1.35, 0.1, 0.11, materials.metal, side * 12.15, 7.7, z);
      const insulator = new THREE.Mesh(new THREE.SphereGeometry(0.14, 5, 4), materials.concrete);
      insulator.position.set(side * 11.45, 7.8, z);
      group.add(insulator);
    }
    for (const z of [18, 38, 58]) {
      const wire = new THREE.CatmullRomCurve3([
        new THREE.Vector3(side * 12.7, 8.45, z - 10),
        new THREE.Vector3(side * 12.7, 7.95, z - 5),
        new THREE.Vector3(side * 12.7, 7.85, z),
        new THREE.Vector3(side * 12.7, 7.95, z + 5),
        new THREE.Vector3(side * 12.7, 8.45, z + 10),
      ]);
      group.add(new THREE.Mesh(
        new THREE.TubeGeometry(wire, 12, 0.018, 4, false),
        solid({ color: 0x252724, roughness: 0.55, metalness: 0.6 }),
      ));
    }
  }
  for (const side of [-1, 1]) {
    for (const [index, z] of [4, 18, 32, 46, 60, 74].entries()) {
      const x = side * 12.7;
      const lit = (index + (side < 0 ? 0 : 1)) % 3 !== 1;
      if (useHospitalBuilding && z > 70) {          // o poste de z = 74 ficaria dentro da ala do hospital
        if (lit) streetRandom();                    // mantém a sequência aleatória
        continue;
      }
      loadStreetModel('/models/street_light/street_light.glb', {
        height: 7.4, position: { x, y: 0, z }, rotationY: side < 0 ? Math.PI : 0, tint: 0.68,
      });
      const fixtureX = x + side * 0.34;
      const lampPosition = new THREE.Vector3(fixtureX, 6.92, z);
      const fixture = streetLightPool.add({
        position: lampPosition, color: 0xffc27a, intensity: lit ? 55 : 0,
        distance: 18, decay: 2,
      });
      box(0.7, 0.12, 0.34, materials.metal, fixtureX, 6.98, z);
      const bulb = new THREE.Mesh(
        new THREE.SphereGeometry(0.12, 8, 6),
        glow(lit ? 0xffc27a : 0x38332d, lit ? 4 : 0.15),
      );
      bulb.position.copy(lampPosition);
      group.add(bulb);
      if (lit) streetLights.push({ fixture, bulb: bulb.material, base: 55, phase: streetRandom() * 8 });
    }
  }

  collisions.addFloor({ minX: -14.6, maxX: 14.6, minZ: -9.7, maxZ: 74.8, y: 0 });
  collisions.addBox(0, 75.2, 30, 0.5);
  collisions.addBox(0, -9.75, 10.4, 0.6);
  for (const side of [-1, 1]) {
    for (const [index, z] of ALLEY_Z[side].entries()) {
      collisions.addFloor({
        minX: side > 0 ? 14.5 : -27.45,
        maxX: side > 0 ? 27.45 : -14.5,
        minZ: z - 1.72,
        maxZ: z + 1.72,
        y: 0,
      });
      for (const wallZ of [z - 1.95, z + 1.95]) {
        collisions.addBox(side * 14.25, wallZ, 5.8, 0.2, { y0: 0, y1: 8 });
      }
      collisions.addBox(side * 17.0, z + side * 1.2, 0.22, 2.4, { y0: 0, y1: 8 });
      for (const wallSide of [-1, 1]) {
        collisions.addBox(side * 22.7, z + wallSide * 1.9, 10.0, 0.28, { y0: 0, y1: 7.6 });
      }
      collisions.addBox(side * 27.7, z, 0.4, 4.0, { y0: 0, y1: 8 });
      if ((index + (side > 0 ? 1 : 0)) % 2 === 0) {
        collisions.addBox(side * 13.55, z + 1.7, 1.7, 1.9, { y0: 0, y1: 1.6 });
      } else {
        collisions.addBox(side * 13.7, z + 1.9, 0.75, 0.75, { y0: 0, y1: 1.0 });
      }
      if ((index + (side > 0 ? 1 : 0)) % 3 !== 0) {
        collisions.addBox(side * 22.3, z + (side > 0 ? 0.85 : -0.85), 1.8, 1.2, { y0: 0, y1: 1.7 });
      }
    }
  }
  collisions.addBox(-3.2, 9.3, 3.0, 4.6, { y0: 0, y1: 1.9 });
  collisions.addBox(6.7, 30, 3.2, 4.2, { y0: 0, y1: 2.2 });
  collisions.addBox(-7.3, 50, 3.5, 4.6, { y0: 0, y1: 2.2 });
  collisions.addBox(1.0, 5.2, 1.3, 0.8, { y0: 0, y1: 0.24 });
  collisions.addBox(-7.0, 1.5, 0.8, 0.42, { y0: 0, y1: 0.16 });
  for (const side of [-1, 1]) {
    collisions.addBox(side * 11.8, -4.9, 6.2, 10.5, { y0: 0, y1: 9.2 });
  }
  const props = [];
  streetDoorItem = {
    id: 'street-rpd-door', pos: new THREE.Vector3(0, 0, -9.1), y: 0,
    radius: 2.8, label: 'Entrar na delegacia',
    onUse: (context) => {
      if (streetDoorTarget > 0.95) {
        context.transition('hall');
        return;
      }
      streetDoorTarget = 1;
      streetDoorItem.label = 'Atravessar a porta';
      pendingDoorTransition = {
        seconds: 0.9,
        transition: () => context.transition('hall'),
      };
      context.toast('As portas do R.P.D. se abrem para a entrada escura.');
    },
  };
  props.push(streetDoorItem);

  // Entrada do hospital, no fim da rua. Abre as duas folhas e leva ao interior (mesmo mecanismo do R.P.D.).
  const makeHospitalDoorItem = (pos, radius) => {
    hospitalDoorItem = {
      id: 'street-hospital-door', pos, y: 0, radius, label: 'Entrar no hospital',
      onUse: (context) => {
        if (hospitalDoorTarget > 0.95) {
          context.transition('hospital');
          return;
        }
        hospitalDoorTarget = 1;
        hospitalDoorItem.label = 'Atravessar a porta';
        pendingHospitalTransition = {
          seconds: 0.9,
          transition: () => context.transition('hospital'),
        };
        context.toast('As portas do hospital cedem, rangendo. Lá dentro, só escuridão.');
      },
    };
    props.push(hospitalDoorItem);
  };
  if (useHospitalBuilding) {
    // Prédio do pacote: planta de colisão real, pórtico livre e porta de duas folhas na entrada.
    const building = placeHospitalBuilding({
      group, loader: modelLoader, collisions, occluders, exterior: hospitalExterior, doorLeaves: hospitalDoor,
    });
    hospitalDoorLeaves.push(...building.leaves);
    makeHospitalDoorItem(building.doorPosition, 2.8);
    for (const side of [-1, 1]) {
      // Pilar de tijolo que fecha a fresta entre a ala (x ±14,23) e o anexo, e impede o jogador de entrar nela.
      box(0.62, 11.0, 6.0, materials.brickSoot, side * 14.5, 5.5, 72.55);
      collisions.addBox(side * 14.5, 72.55, 0.62, 6.0, { y0: 0, y1: 11 });
    }
  } else {
    // Fachada procedural (ou GLB simples): portas apodrecidas, com tábuas arrancadas.
    // O prédio (modelo GLB) não tinha colisão: sem isto o jogador atravessava a fachada.
  collisions.addBox(0, 73.75, 20.6, 12.1, { y0: 0, y1: 17 });
  {
    const doorWood = solid({ color: 0x3b362d, roughness: 0.95, tile: 2 });
    const doorPlank = solid({ color: 0x5b4a35, roughness: 1, tile: 2 });
    const doorGlass = solid({ color: 0x1a2227, roughness: 0.15, metalness: 0.2, tile: 2 });
    const doorBlood = solid({ color: 0x3a0907, roughness: 0.4, tile: 2 });
    for (const side of [-1, 1]) {
      const hinge = new THREE.Group();
      hinge.position.set(side * 0.98, 0, 67.55);
      const part = (w, hh, d, material, x, y, z, rz = 0) => {
        const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, hh, d), material);
        mesh.position.set(x, y, z); mesh.rotation.z = rz;
        mesh.castShadow = true; mesh.receiveShadow = true;
        hinge.add(mesh);
        return mesh;
      };
      part(0.96, 2.5, 0.1, doorWood, -side * 0.48, 1.27, 0);
      part(0.5, 0.8, 0.04, doorGlass, -side * 0.48, 1.7, 0.06);
      part(0.1, 2.5, 0.14, doorWood, -side * 0.93, 1.27, 0);
      part(1.1, 0.14, 0.05, doorPlank, -side * 0.45, 0.9 + (side > 0 ? 0.35 : 0), 0.09, side * 0.18);
      part(0.9, 0.14, 0.05, doorPlank, -side * 0.5, 1.55, 0.09, -side * 0.3);
      part(0.04, 0.5, 0.012, doorBlood, -side * 0.3, 1.15, 0.1);
      hospitalDoorLeaves.push({ hinge, side });
      group.add(hinge);
    }
    makeHospitalDoorItem(new THREE.Vector3(0, 0, 66.7), 2.6);
  }
  }

  // Props escaneados (CC0) dão escala e imperfeição à calçada: telefone
  // público, hidrante, lata de lixo, banco, barril e caixotes.
  const streetProps = createProps({ parent: group, collisions, anisotropy: 8 });
  // Props rasos ficam junto ao meio-fio, à frente da fachada dos prédios.
  // O telefone público ficou no saguão do R.P.D. (a calçada da rua é estreita
  // demais e os modelos de prédio avançam sobre ela).
  streetProps.place('fire_hydrant', {
    position: [11.3, 0, 12.6], height: 0.72,
    collider: { w: 0.5, d: 0.5, h: 0.85 },
  });
  streetProps.place('metal_trash_can', {
    position: [-11.3, 0, 12.5], height: 1.0,
    collider: { w: 0.65, d: 0.65, h: 1.1 },
  });
  streetProps.place('trashbag', {
    position: [-11.2, 0, 13.5], height: 0.55,
  });
  streetProps.place('painted_wooden_bench', {
    position: [-11.3, 0, 24.0], height: 0.95, rotationY: Math.PI / 2,
    collider: { w: 0.6, d: 1.5, h: 1.0 },
  });
  streetProps.place('Barrel_01', {
    position: [11.3, 0, 24.6], height: 0.95,
    collider: { w: 0.8, d: 0.8, h: 1.05 },
  });
  streetProps.place('wooden_crate_01', {
    position: [-11.2, 0, 52.0], height: 0.7, rotationY: 0.3,
    collider: { w: 0.85, d: 0.8, h: 0.8 },
  });
  streetProps.place('fire_hydrant', {
    position: [-11.3, 0, 45.5], height: 0.72,
    collider: { w: 0.5, d: 0.5, h: 0.85 },
  });
  streetProps.place('metal_trash_can', {
    position: [11.3, 0, 62.0], height: 1.0,
    collider: { w: 0.65, d: 0.65, h: 1.1 },
  });

  // ═══ Garagem abandonada (dá para entrar), rua transversal e bairro pós-guerra ═══════════════════════
  // Garagem: a parede do lado +x do modelo desabou (vão de ~3 m); ela é virada para a rua. O interior é real
  // (piso, vigas, tubulações), então basta liberar o piso e levantar as paredes como colisão.
  const GARAGE_Z = 37;
  const garageState = { ammo: false };
  loadStreetModel('/models/street/garage.glb', {
    scale: 1.85, position: { x: 20.7, y: 0, z: GARAGE_Z }, rotationY: Math.PI, tint: 0.85, occlude: false, rough: 0.8,
  }, (model) => {
    model.updateMatrixWorld(true);
    const to = (nx, nz) => model.localToWorld(new THREE.Vector3(nx, 0, nz));
    const wall = (nx0, nx1, nz0, nz1, h = 4.3, y0 = 0) => {
      const a = to(nx0, nz0), b = to(nx1, nz1);
      registerSolid((a.x + b.x) / 2, (a.z + b.z) / 2, Math.abs(a.x - b.x), Math.abs(a.z - b.z), h, y0);
    };
    wall(-3.25, -2.85, -2.05, 2.05);     // fundo
    wall(-3.25, 3.25, -2.05, -1.7);      // parede das janelas
    wall(-3.25, 3.25, 1.7, 2.05);        // parede da porta
    wall(2.85, 3.25, -2.05, -1.55);      // batentes da abertura
    wall(2.85, 3.25, 1.55, 2.05);
    wall(-3.25, 3.25, -2.05, 2.05, 0.4, 4.25);   // teto (só alvo para câmera e tiros)
  });
  collisions.addFloor({ minX: 14.5, maxX: 26.8, minZ: GARAGE_Z - 3.9, maxZ: GARAGE_Z + 3.9, y: 0 });
  for (const [x, y, z, color, intensity, distance, seed] of [
    [19.2, 3.7, GARAGE_Z - 1.2, 0xb7d6c0, 16, 10, 3.7],     // luz fria, falhando
    [23.6, 3.3, GARAGE_Z + 1.2, 0xff9a52, 9, 8, 8.1],       // brasa de lâmpada quente ao fundo
  ]) {
    const fixture = streetLightPool.add({ position: new THREE.Vector3(x, y, z), color, intensity, distance, decay: 2 });
    flickeringStoreLights.push({ fixture, base: intensity, seed });
  }

  // Rua transversal: sai da calçada oeste, passa pelo vão da muralha do cenário e chega à praça.
  box(34.2, 0.35, 7.3, materials.asphalt, -31.7, -0.18, CROSS.zc);
  collisions.addFloor({ minX: CROSS.xEnd - 0.4, maxX: -14.6, minZ: CROSS.z0, maxZ: CROSS.z1, y: 0 });
  // Torres com a fachada de janelas virada para a passagem (antes eram muros lisos).
  for (const [towerZ, yaw] of [[CROSS.z0 - 5.25, -Math.PI / 2], [CROSS.z1 + 5.25, Math.PI / 2]]) {
    loadStreetModel('/models/street/tower.glb', {
      scale: TOWER_SCALE, position: { x: -33.65, y: 0, z: towerZ }, rotationY: yaw, tint: 0.72, occlude: false,
    });
    registerSolid(-33.65, towerZ, 14.4, 10.5, 25.4);
  }
  // Trecho que atravessa a muralha leste do bairro: muros encostam nas fachadas soltas e escondem o "avesso" delas.
  for (const [wallZ, wallH] of [[CROSS.z0 + 0.15, 24], [CROSS.z1 - 0.15, 7]]) {
    box(8.0, wallH, 0.3, materials.brickSoot, -44.85, wallH / 2, wallZ);
    collisions.addBox(-44.85, wallZ, 8.0, 0.3, { y0: 0, y1: wallH });
  }
  streetLightPool.add({ position: new THREE.Vector3(-44.5, 4.2, CROSS.zc), color: 0xffa860, intensity: 9, distance: 10, decay: 2 });
  for (const [lampX, face, dir, lit] of [[-20, CROSS.z0, 1, true], [-31, CROSS.z1, -1, true], [-37.5, CROSS.z0, 1, false]]) {
    const lampPosition = new THREE.Vector3(lampX, 3.6, face + dir * 0.4);
    box(0.42, 0.12, 0.5, alleyMetal, lampX, 3.68, face + dir * 0.25);
    const bulbMaterial = new THREE.MeshBasicMaterial({ color: lit ? 0xffc27a : 0x8c7654 });
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.09, 6, 4), bulbMaterial);
    bulb.position.copy(lampPosition);
    group.add(bulb);
    const intensity = lit ? 22 : 5;
    const fixture = streetLightPool.add({ position: lampPosition, color: 0xffae68, intensity, distance: lit ? 12 : 7, decay: 2 });
    alleyLights.push({ fixture, bulb: bulbMaterial, base: intensity, phase: streetRandom() * 8 });
  }

  // Bairro pós-guerra (postwar.glb): praça tomada pelo mato, cercada por fachadas. O arquivo já vem otimizado
  // (sem a cúpula de céu, o chão bege e as massas cinzas do mapa); aqui só escurece os materiais para a noite.
  // Partes do bairro (modelo, mato, heras): só são desenhadas quando dá para vê-las (ver `update`).
  const districtParts = [];
  modelLoader.load('/models/street/postwar.glb', ({ scene: model }) => {
    model.position.set(DISTRICT.tx, 0, DISTRICT.tz);
    model.traverse((object) => {
      if (!object.isMesh) return;
      object.castShadow = false;
      object.receiveShadow = true;
      const dim = (material) => {
        const copy = material.clone();
        const cutout = copy.alphaTest > 0 || copy.transparent;       // folhagem, heras, grades
        if (cutout) {
          copy.side = THREE.DoubleSide;                              // folhas vistas de trás não somem
          copy.transparent = false;
          copy.alphaTest = Math.max(copy.alphaTest, 0.42);           // borda limpa: sem pedaços semi-transparentes boiando
          copy.depthWrite = true;
        }
        if (copy.color) copy.color.multiplyScalar(cutout ? 0.9 : 0.6);
        if ('roughness' in copy) copy.roughness = Math.max(copy.roughness, 0.92);
        if ('metalness' in copy) copy.metalness = Math.min(copy.metalness, 0.1);
        return copy;
      };
      object.material = Array.isArray(object.material) ? object.material.map(dim) : dim(object.material);
    });
    group.add(model);
    districtParts.push(model);
  }, undefined, (error) => console.error('Nao foi possivel carregar o bairro pos-guerra:', error));
  box(31, 0.35, 49.5, materials.concrete, -55.5, -0.2, 53.55);
  collisions.addFloor({ minX: -70.6, maxX: -40.5, minZ: 29.4, maxZ: 77.6, y: 0 });
  // Fachadas do cenário como colisão (x0, x1, z0, z1, altura — coordenadas do próprio modelo).
  for (const [x0, x1, z0, z1, h] of [
    [15.6, 19.8, -2.6, 3.2, 12.6], [16.1, 19.8, -7.3, -2.6, 8.4], [15.0, 19.8, -13.4, -7.3, 9.5],
    [15.3, 19.8, -22.8, -13.4, 6.5], [15.3, 23.4, -38.3, -30.1, 23.7],
    [-3.8, 0.3, -3.5, 3.2, 10.1], [-3.8, 0.4, -8.2, -3.5, 12.2], [-3.8, -0.3, -18.7, -8.2, 9.1], [-3.8, 0.1, -30.4, -22.8, 12.3],
  ]) {
    collisions.addBox((x0 + x1) / 2 + DISTRICT.tx, (z0 + z1) / 2 + DISTRICT.tz, x1 - x0, z1 - z0, { y0: 0, y1: h });
  }
  // Muros que fecham as pontas abertas do cenário.
  for (const [cx, cz, w, d] of [
    [-56, 29.0, 30, 0.8], [-56, 77.75, 30, 0.8], [-70.6, 53.4, 0.8, 49.5],
    [-44.4, 29.7, 0.8, 1.5], [-44.4, 74.85, 0.8, 5.8],
  ]) {
    box(w, 7, d, materials.brickSoot, cx, 3.5, cz);
    collisions.addBox(cx, cz, w, d, { y0: 0, y1: 7 });
  }
  streetProps.place('Barrel_01', { position: [-60.5, 0, 52], height: 0.95, collider: { w: 0.8, d: 0.8, h: 1.05 } });
  streetProps.place('wooden_crate_01', { position: [-57.5, 0, 45.5], height: 0.7, rotationY: 0.5, collider: { w: 0.85, d: 0.8, h: 0.8 } });
  for (const [x, y, z, color, intensity, distance, seed] of [
    [-60.5, 2.2, 52, 0xff8a4a, 28, 15, 1.9],        // barril em chamas (só a luz bruxuleante)
    [-53.0, 4.5, 66, 0x8fb7ff, 8, 13, 6.4],         // poste azulado, quase morto
  ]) {
    const fixture = streetLightPool.add({ position: new THREE.Vector3(x, y, z), color, intensity, distance, decay: 2 });
    flickeringStoreLights.push({ fixture, base: intensity, seed });
  }

  // Restos escaneados de ar-condicionado e sacos de lixo nos fundos dos becos e na praça.
  for (const [x, z, rotationY] of [
    [25.2, 30.7, Math.PI / 2], [-25.2, 22.2, -Math.PI / 2], [-25.2, 3.1, -Math.PI / 2],
    [-25.2, 63.2, -Math.PI / 2], [25.2, 2.3, Math.PI / 2], [-66.5, 66, -Math.PI / 2], [-64, 38.5, 0.4],
  ]) {
    loadStreetModel('/models/street/ac_trash.glb', {
      scale: 1, position: { x, y: 0.04, z }, rotationY, tint: 0.8, occlude: false,
    });
    collisions.addBox(x, z, 1.7, 1.7, { y0: 0, y1: 1.1 });
  }

  props.push(...pendingProps);
  // Mobília simples dentro das torres que dá para entrar.
  for (const { side, zc } of pendingFurniture) {
    for (const [nx, nz, kind, rotationY] of [[0.55, -1.8, 'wooden_crate_01', 0.3], [0.65, 1.25, 'Barrel_01', 0], [2.5, -1.95, 'wooden_crate_01', 1.2], [1.6, 1.5, 'Barrel_01', 0]]) {
      const at = towerToWorld(side, zc, nx, nz);
      const isBarrel = kind === 'Barrel_01';
      streetProps.place(kind, {
        position: [at.x, 0, at.z], height: isBarrel ? 0.95 : 0.7, rotationY,
        collider: { w: isBarrel ? 0.8 : 0.85, d: isBarrel ? 0.8 : 0.8, h: isBarrel ? 1.05 : 0.8 },
      });
    }
  }

  // Vegetação da praça (procedural): tufos de mato instanciados + heras nas fachadas. Só enfeite, sem colisão.
  const makeCanvasTexture = (width, height, draw) => {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    draw(canvas.getContext('2d'), width, height);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 4;
    return texture;
  };
  const grassTexture = makeCanvasTexture(256, 256, (ctx, w, h) => {
    for (let blade = 0; blade < 38; blade++) {
      const baseX = 10 + streetRandom() * (w - 20);
      const lean = (streetRandom() - 0.5) * 60;
      const tall = h * (0.4 + streetRandom() * 0.55);
      const green = 52 + Math.floor(streetRandom() * 50);
      ctx.strokeStyle = `rgb(${46 + Math.floor(streetRandom() * 50)},${green},${28 + Math.floor(streetRandom() * 22)})`;
      ctx.lineWidth = 1.1 + streetRandom() * 1.6;
      ctx.beginPath();
      ctx.moveTo(baseX, h);
      ctx.quadraticCurveTo(baseX + lean * 0.3, h - tall * 0.55, baseX + lean, h - tall);
      ctx.stroke();
    }
  });
  const grassTime = { value: 0 };
  const grassMaterial = new THREE.MeshStandardMaterial({
    map: grassTexture, alphaTest: 0.42, side: THREE.DoubleSide, roughness: 1, metalness: 0, color: 0xffffff,
  });
  grassMaterial.onBeforeCompile = (shader) => {          // balanço leve ao vento, feito na GPU
    shader.uniforms.uGrassTime = grassTime;
    shader.vertexShader = shader.vertexShader
      .replace('void main() {', 'uniform float uGrassTime;\nvoid main() {')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        float sway = sin(uGrassTime * 1.7 + instanceMatrix[3].x * 0.8 + instanceMatrix[3].z * 1.1) * 0.09 * uv.y * uv.y;
        transformed.x += sway;
        transformed.z += sway * 0.6;`);
  };
  const tuftGeometry = new THREE.PlaneGeometry(1, 0.8);
  tuftGeometry.translate(0, 0.4, 0);
  const tufts = [];
  const scatterTuft = (x, z, scale) => tufts.push({ x, z, scale, yaw: streetRandom() * Math.PI });
  for (let cluster = 0; cluster < 56; cluster++) {                       // moitas espalhadas pela praça
    const cx = -69 + streetRandom() * 27, cz = 31 + streetRandom() * 45;
    for (let n = 0; n < 3 + Math.floor(streetRandom() * 3); n++) {
      scatterTuft(cx + (streetRandom() - 0.5) * 2.6, cz + (streetRandom() - 0.5) * 2.6, 0.5 + streetRandom() * 0.85);
    }
  }
  for (let n = 0; n < 56; n++) {                                         // mato crescendo rente às fachadas
    const west = n % 2 === 0;
    scatterTuft(west ? -63.2 - streetRandom() * 0.8 : -47.9 + streetRandom() * 0.8, 31 + streetRandom() * 45, 0.55 + streetRandom() * 0.8);
  }
  const grass = new THREE.InstancedMesh(tuftGeometry, grassMaterial, tufts.length * 2);
  const tuftMatrix = new THREE.Matrix4();
  const tuftColor = new THREE.Color();
  tufts.forEach(({ x, z, scale, yaw }, index) => {
    for (const cross of [0, 1]) {                                        // dois planos cruzados dão volume
      tuftMatrix.compose(
        new THREE.Vector3(x, 0.01, z),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(0, yaw + cross * Math.PI / 2, 0)),
        new THREE.Vector3(scale, scale * (0.85 + streetRandom() * 0.5), scale),
      );
      grass.setMatrixAt(index * 2 + cross, tuftMatrix);
      grass.setColorAt(index * 2 + cross, tuftColor.setHSL(0.2 + streetRandom() * 0.09, 0.3 + streetRandom() * 0.12, 0.2 + streetRandom() * 0.12));
    }
  });
  grass.receiveShadow = true;
  grass.frustumCulled = false;
  group.add(grass);
  districtParts.push(grass);

  const ivyTexture = makeCanvasTexture(128, 256, (ctx, w, h) => {
    for (let strand = 0; strand < 7; strand++) {
      const x = 14 + strand * 16 + streetRandom() * 6;
      ctx.strokeStyle = 'rgb(38,52,28)';
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.bezierCurveTo(x + 6, h * 0.3, x - 8, h * 0.6, x + 4, h * (0.55 + streetRandom() * 0.4));
      ctx.stroke();
    }
    for (let leaf = 0; leaf < 150; leaf++) {
      const y = streetRandom() * h * (0.35 + streetRandom() * 0.65);
      const x = 8 + streetRandom() * (w - 16);
      ctx.fillStyle = `rgb(${30 + Math.floor(streetRandom() * 40)},${58 + Math.floor(streetRandom() * 60)},${22 + Math.floor(streetRandom() * 28)})`;
      ctx.beginPath();
      ctx.ellipse(x, y, 3 + streetRandom() * 4, 2 + streetRandom() * 3, streetRandom() * Math.PI, 0, Math.PI * 2);
      ctx.fill();
    }
  });
  const ivyGeometry = new THREE.PlaneGeometry(2.2, 4.4);
  ivyGeometry.translate(0, -2.2, 0);                                      // pendura de cima para baixo
  const ivyPlacements = [                                                 // x, topo (y), z, virada (+1: face voltada para +x)
    [-63.45, 9.5, 69.6, 1], [-63.45, 8.0, 63.0, 1], [-63.45, 11.0, 57.5, 1], [-63.45, 9.0, 50.5, 1], [-63.45, 7.5, 46.2, 1],
    [-48.45, 11.0, 66.5, -1], [-48.45, 8.5, 62.0, -1], [-48.45, 7.0, 56.5, -1], [-48.45, 5.5, 50.5, -1], [-48.45, 10.5, 71.0, -1],
  ];
  const ivy = new THREE.InstancedMesh(ivyGeometry, new THREE.MeshStandardMaterial({
    map: ivyTexture, alphaTest: 0.45, side: THREE.DoubleSide, roughness: 1, metalness: 0,
  }), ivyPlacements.length);
  ivyPlacements.forEach(([x, top, z, facing], index) => {
    tuftMatrix.compose(
      new THREE.Vector3(x, top, z),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(0, facing * Math.PI / 2, 0)),
      new THREE.Vector3(1 + (index % 3) * 0.25, 0.8 + (index % 4) * 0.2, 1),
    );
    ivy.setMatrixAt(index, tuftMatrix);
  });
  group.add(ivy);
  districtParts.push(ivy);

  props.push(
    { id: 'garage-ammo', pos: new THREE.Vector3(23.4, 0, GARAGE_Z - 0.9), y: 0, radius: 1.8, label: 'Pegar munição de pistola',
      enabled: () => !garageState.ammo,
      onUse: (c) => { garageState.ammo = true; c.addAmmo(10); c.toast('Você pegou: Munição de pistola ×10'); } },
    { id: 'garage-bench', pos: new THREE.Vector3(24.6, 0, GARAGE_Z + 1.3), y: 0, radius: 1.8, label: 'Examinar bancada',
      onUse: (c) => c.toast('Ferramentas espalhadas e uma lanterna sem pilhas. Alguém tentou fechar o portão por dentro — as marcas no concreto são de unhas.') },
    { id: 'plaza-poster', pos: new THREE.Vector3(-58.5, 0, 56), y: 0, radius: 2.2, label: 'Ler cartaz',
      onUse: (c) => c.toast('"ZONA DE EVACUAÇÃO 4 — dirijam-se ao hospital." Alguém riscou por cima, com tinta: "NÃO VÁ."') },
  );

  const hemi = new THREE.HemisphereLight(0x748399, 0x15181c, 0.07);
  group.add(hemi);
  const ambient = new THREE.AmbientLight(0x68758a, 0.02);
  group.add(ambient);
  const moon = new THREE.DirectionalLight(0x8fa4c4, 0.7);
  moon.position.set(-24, 30, 12);
  moon.target.position.set(0, 0, 36);
  moon.castShadow = true;
  moon.shadow.mapSize.set(2048, 2048);
  moon.shadow.camera.left = -32;
  moon.shadow.camera.right = 32;
  moon.shadow.camera.top = 46;
  moon.shadow.camera.bottom = -46;
  moon.shadow.camera.near = 1;
  moon.shadow.camera.far = 110;
  moon.shadow.bias = -0.0006;
  moon.shadow.normalBias = 0.05;
  group.add(moon, moon.target);
  for (let i = 0; i < 180; i++) streetRandom();
  const rainCount = 1200;
  const rainPositions = new Float32Array(rainCount * 6);
  const rainSeeds = new Float32Array(rainCount);
  const rainBaseY = new Float32Array(rainCount);
  const rainSpeeds = new Float32Array(rainCount);
  for (let drop = 0; drop < rainCount; drop++) {
    const offset = drop * 6;
    const x = (streetRandom() - 0.5) * 38;
    const y = 2 + streetRandom() * 18;
    rainSeeds[drop] = streetRandom() * Math.PI * 2;
    rainBaseY[drop] = y;
    rainSpeeds[drop] = 22 + streetRandom() * 9;
    rainPositions[offset] = x;
    rainPositions[offset + 1] = y;
    rainPositions[offset + 2] = -9 + streetRandom() * 92;
    rainPositions[offset + 3] = x + 0.22;
    rainPositions[offset + 4] = y - 0.55;
    rainPositions[offset + 5] = rainPositions[offset + 2];
  }
  const rainGeometry = new THREE.BufferGeometry();
  rainGeometry.setAttribute('position', new THREE.Float32BufferAttribute(rainPositions, 3));
  const rainVertexCount = rainCount * 2;
  const rainFallSpeed = new Float32Array(rainVertexCount);
  const rainPhase = new Float32Array(rainVertexCount);
  const rainStartY = new Float32Array(rainVertexCount);
  const rainTrailOffset = new Float32Array(rainVertexCount);
  for (let drop = 0; drop < rainCount; drop++) {
    for (let endpoint = 0; endpoint < 2; endpoint++) {
      const vertex = drop * 2 + endpoint;
      rainFallSpeed[vertex] = rainSpeeds[drop];
      rainPhase[vertex] = rainSeeds[drop];
      rainStartY[vertex] = rainBaseY[drop];
      rainTrailOffset[vertex] = endpoint * 0.55;
    }
  }
  rainGeometry.setAttribute('fallSpeed', new THREE.Float32BufferAttribute(rainFallSpeed, 1));
  rainGeometry.setAttribute('dropPhase', new THREE.Float32BufferAttribute(rainPhase, 1));
  rainGeometry.setAttribute('startY', new THREE.Float32BufferAttribute(rainStartY, 1));
  rainGeometry.setAttribute('trailOffset', new THREE.Float32BufferAttribute(rainTrailOffset, 1));
  const rainMaterial = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: { time: { value: 0 } },
    vertexShader: `
      uniform float time;
      attribute float fallSpeed;
      attribute float dropPhase;
      attribute float startY;
      attribute float trailOffset;
      varying float vFade;
      void main() {
        vec3 movingPosition = position;
        movingPosition.x += sin(time * 1.7 + dropPhase) * 0.15;
        movingPosition.y = mod(startY - time * fallSpeed, 24.0) - trailOffset;
        vFade = 0.34 + 0.66 * smoothstep(0.0, 20.0, movingPosition.y);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(movingPosition, 1.0);
      }
    `,
    fragmentShader: `
      varying float vFade;
      void main() {
        gl_FragColor = vec4(0.62, 0.7, 0.78, 0.3 * vFade);
      }
    `,
  });
  const rain = new THREE.LineSegments(
    rainGeometry,
    rainMaterial,
  );
  rain.renderOrder = 2;
  group.add(rain);
  const splashCount = 42;
  const splashes = [];
  for (let i = 0; i < splashCount; i++) {
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.08, 0.2, 8),
      new THREE.MeshBasicMaterial({
        color: 0xd0dcde,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.018;
    ring.visible = false;
    group.add(ring);
    splashes.push({ mesh: ring, age: 1 });
  }
  let splashCursor = 0;
  const dumpsterImpactZones = [-1, 1].flatMap((side) =>
    ALLEY_Z[side]
      .filter((_, index) => (index + (side > 0 ? 1 : 0)) % 2 === 0)
      .map((z) => ({ x: side * 13.55, z: z + 1.7 })),
  );
  const splashAt = (x, z, y = 0.018, chance = 0.1) => {
    if (Math.abs(x) > 17.4 || z < -9 || z > 82) return;
    if (streetRandom() > chance) return;
    const splash = splashes[splashCursor];
    splashCursor = (splashCursor + 1) % splashCount;
    splash.age = 0;
    splash.mesh.position.set(x, y, z);
    splash.mesh.scale.setScalar(0.2);
    splash.mesh.material.opacity = 0.72;
    splash.mesh.visible = true;
  };
  const stormLight = new THREE.PointLight(0x9db6d2, 0, 100, 1.2);
  stormLight.position.set(-7, 22, 38);
  group.add(stormLight);
  const poolCamera = new THREE.Vector3(0, 2, 30);
  let elapsed = 0;
  const flameWorld = new THREE.Vector3();
  mergeStaticBoxes();
  group.traverse((object) => { if (object.isMesh && !object.userData.renderOnly) occluders.push(object); });
  occluders.push(...occluderProxies);

  return {
    collisions,
    occluders,
    props,
    // Clarão da tempestade: o controlador (render/storm.js) dá a força 0..1 e a direção do raio.
    setStormFlash(strength, x, y, z) {
      stormLight.intensity = strength * 65;
      if (strength > 0) stormLight.position.set(x, y, z);
    },
    update(timeOrDelta = 0, dt = timeOrDelta, cameraPosition = null) {
      elapsed += dt;
      if (cameraPosition) {
        // O bairro fica atrás de prédios: só é visível de dentro dele ou olhando pela rua transversal (faixa de z da
        // passagem). Fora disso nem é enviado à GPU.
        const showDistrict = cameraPosition.x < -10 || Math.abs(cameraPosition.z - CROSS.zc) < 16;
        for (const part of districtParts) part.visible = showDistrict;
      }
      rainMaterial.uniforms.time.value = elapsed;
      for (let drop = 0; drop < rainCount; drop++) {
        const offset = drop * 6;
        const oldY = rainPositions[offset + 1];
        const cycleY = ((rainBaseY[drop] - elapsed * rainSpeeds[drop]) % 24 + 24) % 24;
        const windDrift = Math.sin(elapsed * 1.7 + rainSeeds[drop]) * 0.15;
        const previousDrift = Math.sin((elapsed - dt) * 1.7 + rainSeeds[drop]) * 0.15;
        rainPositions[offset] += windDrift - previousDrift;
        rainPositions[offset + 1] = cycleY;
        rainPositions[offset + 3] = rainPositions[offset] + 0.22;
        rainPositions[offset + 4] = cycleY - 0.55;
        let hitDumpster = false;
        if (oldY > 1.55 && rainPositions[offset + 1] <= 1.55) {
          for (const zone of dumpsterImpactZones) {
            if (Math.abs(rainPositions[offset] - zone.x) < 0.92
              && Math.abs(rainPositions[offset + 2] - zone.z) < 0.95) {
              splashAt(rainPositions[offset], rainPositions[offset + 2], 1.56, 0.32);
              hitDumpster = true;
              break;
            }
          }
        }
        if (!hitDumpster && oldY > 0 && rainPositions[offset + 1] <= 0) {
          splashAt(rainPositions[offset], rainPositions[offset + 2]);
        }
      }
      splashes.forEach((splash) => {
        if (splash.age >= 1) return;
        splash.age = Math.min(1, splash.age + dt * 2);
        const progress = splash.age;
        splash.mesh.scale.setScalar(0.25 + progress * 2.8);
        splash.mesh.material.opacity = 0.72 * (1 - progress);
        splash.mesh.visible = progress < 1;
      });
      for (const { hinge, side } of streetDoorLeaves) {
        const target = streetDoorTarget * side * 1.3;
        hinge.rotation.y += (target - hinge.rotation.y) * Math.min(1, dt * 4.5);
      }
      for (const { hinge, side } of hospitalDoorLeaves) {
        const target = hospitalDoorTarget * side * 1.3;
        hinge.rotation.y += (target - hinge.rotation.y) * Math.min(1, dt * 4.5);
      }
      if (pendingHospitalTransition) {
        pendingHospitalTransition.seconds -= dt;
        if (pendingHospitalTransition.seconds <= 0) {
          const transition = pendingHospitalTransition.transition;
          pendingHospitalTransition = null;
          transition();
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
      emberMaterial.uniforms.time.value = elapsed;
      grassTime.value = elapsed;
      glowGround.material.opacity = 0.34 + Math.sin(elapsed * 9.1) * 0.07 + Math.sin(elapsed * 17.3) * 0.04;
      flames.forEach((flame) => {
        const phase = flame.userData.seed;
        flame.material.uniforms.time.value = elapsed;
        if (cameraPosition) {          // billboard só em Y (o grupo do fogo também está girado)
          flame.getWorldPosition(flameWorld);
          flame.rotation.y = Math.atan2(cameraPosition.x - flameWorld.x, cameraPosition.z - flameWorld.z) - fire.rotation.y;
        }
        flame.scale.set(
          0.92 + Math.sin(elapsed * 9.0 + phase) * 0.09,
          0.9 + Math.sin(elapsed * 5.3 + phase * 1.3) * 0.15 + Math.sin(elapsed * 13.7 + phase) * 0.05,
          1,
        );
      });
      fireLight.intensity = 36 + Math.sin(elapsed * 8.2) * 11
        + Math.sin(elapsed * 15.7) * 5.2 + Math.sin(elapsed * 24.1) * 2.4;
      fireLight.color.setHSL(0.055 + Math.sin(elapsed * 2.4) * 0.006, 0.92, 0.52);
      smokePuffs.forEach((puff) => {
        const progress = (elapsed * 0.11 + puff.userData.phase) % 1;
        puff.position.y = 1.55 + progress * 5.4;
        puff.position.x = puff.userData.originX
          + Math.sin(elapsed * 0.6 + puff.userData.drift) * (0.22 + progress * 0.85);
        puff.position.z = -0.2 + Math.cos(elapsed * 0.42 + puff.userData.drift) * (0.12 + progress * 0.4);
        puff.material.opacity = 0.78 * Math.sin(Math.PI * progress) * (1 - progress * 0.2);
        const spread = 0.8 + progress * 2.4;
        puff.scale.set(spread, spread * 1.25, 1);
      });
      embers.forEach((ember) => {
        const progress = (elapsed * 0.22 + ember.userData.phase) % 1;
        ember.position.set(
          Math.sin(elapsed * 2 + ember.userData.drift) * (0.16 + progress * 0.38),
          1.0 + progress * ember.userData.rise,
          -0.5 + Math.cos(elapsed + ember.userData.drift) * 0.28,
        );
        ember.visible = progress < 0.82;
      });
      streetLights.forEach(({ fixture, bulb, base, phase }) => {
        const outage = Math.sin(elapsed * 0.8 + phase) > 0.985 ? 0 : 1;
        const flicker = 0.82 + 0.18 * Math.sin(elapsed * 9 + phase);
        fixture.intensity = base * outage * flicker;
        if (bulb.emissive) bulb.emissive.setHex(outage ? 0xffc27a : 0x3a332a);
        else bulb.color.setHex(outage ? 0xffc27a : 0x38332d);
      });
      flickeringStoreLights.forEach(({ fixture, base, seed }) => {
        fixture.intensity = base * (0.72 + 0.28 * Math.sin(elapsed * 6 + seed))
          * (Math.sin(elapsed * 0.7 + seed) > 0.98 ? 0 : 1);
      });
      alleyLights.forEach(({ fixture, bulb, base, phase }) => {
        const outage = Math.sin(elapsed * 1.9 + phase) > 0.96
          || Math.sin(elapsed * 0.37 + phase) > 0.985 ? 0 : 1;
        const flicker = 0.65 + 0.35 * Math.sin(elapsed * 11 + phase);
        fixture.intensity = base * outage * flicker;
        bulb.color.setHex(outage ? 0xffc27a : 0x38332d);
      });
      streetLightPool.update(cameraPosition ?? poolCamera);
    },
    resetEntrance() {
      streetDoorTarget = 0;
      pendingDoorTransition = null;
      hospitalDoorTarget = 0;
      pendingHospitalTransition = null;
      if (hospitalDoorItem) hospitalDoorItem.label = 'Entrar no hospital';
      if (streetDoorItem) streetDoorItem.label = 'Entrar na delegacia';
    },
    spawn: { x: 0, y: 0, z: 2, yaw: 0 },
  };
}
