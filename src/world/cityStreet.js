import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
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

export function buildCityStreet(group) {
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
  const box = (w, h, d, material, x, y, z, parent = group) => {
    const geometry = new THREE.BoxGeometry(w, h, d);
    worldUV(geometry, material.userData.tile ?? 2);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(x, y, z); mesh.castShadow = true; mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  };
  const occluders = [];
  const streetLightPool = new LightPool(group, { count: 8 });
  const modelLoader = new GLTFLoader();
  const streetDoorLeaves = [];
  let streetDoorTarget = 0;
  let pendingDoorTransition = null;
  let streetDoorItem = null;
  const loadStreetModel = (asset, { height, position, rotationY = 0, tint = 1 }, onLoad = () => {}) => {
    modelLoader.load(asset, ({ scene: model }) => {
      model.rotation.y = rotationY;
      model.updateMatrixWorld(true);
      const initialBounds = new THREE.Box3().setFromObject(model);
      const size = initialBounds.getSize(new THREE.Vector3());
      if (!Number.isFinite(size.y) || size.y <= 0) {
        console.error(`O modelo ${asset} tem dimensoes invalidas.`);
        return;
      }
      model.scale.setScalar(height / size.y);
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
          if ('roughness' in copy) copy.roughness = Math.max(copy.roughness, 0.9);
          return copy;
        };
        object.material = Array.isArray(object.material)
          ? object.material.map(tintMaterial)
          : tintMaterial(object.material);
      });
      group.add(model);
      model.traverse((object) => { if (object.isMesh) occluders.push(object); });
      onLoad(model);
    }, undefined, (error) => {
      console.error(`Nao foi possivel carregar o asset ${asset}:`, error);
      if (asset.includes('broken_car')) car.visible = true;
    });
  };
  const streetLights = [];
  const flickeringStoreLights = [];
  const alleyLights = [];

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
  for (const side of [-1, 1]) {
    for (const [index, z] of [1, 15, 29, 43, 57, 71].entries()) {
      const asset = ['large_building_a', 'large_building_b', 'big_building'][index % 3];
      loadStreetModel(`/models/${asset}/${asset}.glb`, {
        height: index % 3 === 2 ? 10.5 : 9.2,
        position: { x: side * 15.1, y: 0, z },
        rotationY: -side * Math.PI / 2,
        tint: index % 3 === 2 ? 0.35 : 0.48,
      });
      if (index % 2 === 0) {
        const sign = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 0.72), materials.storefrontSign);
        sign.position.set(side * 10.9, 5.2, z);
        sign.rotation.y = -side * Math.PI / 2;
        group.add(sign);
        box(0.42, 0.16, 3.1, materials.rust, side * 10.8, 2.85, z);
        box(0.34, 0.12, 2.6, materials.wood, side * 10.52, 2.62, z);
        const intensity = index === 0 ? 22 : 0;
        const fixture = streetLightPool.add({
          position: new THREE.Vector3(side * 10.45, 3.3, z),
          color: 0xffa65e, intensity, distance: 8, decay: 2,
        });
        if (intensity > 0) flickeringStoreLights.push({ fixture, base: intensity, seed: z + side * 11 });
      }
    }
  }

  // Skyline real: reutiliza os prédios CC0 em escala maior no fundo da rua,
  // em vez de silhuetas pintadas num plano.
  for (const [index, [x, z, height]] of [
    [-44, 96, 26], [-27, 92, 33], [-10, 99, 23],
    [8, 94, 36], [26, 97, 28], [44, 93, 22],
  ].entries()) {
    const asset = ['large_building_a', 'large_building_b', 'big_building'][index % 3];
    loadStreetModel(`/models/${asset}/${asset}.glb`, {
      height,
      position: { x, y: 0, z },
      rotationY: Math.PI,
      tint: 0.18,
    });
  }

  const alleyWall = pbr('red_brick', { tile: 2.6, roughness: 1, normalScale: 1, color: 0x9a8f7e });
  const alleyWallVariants = [alleyWall, materials.brickSoot, materials.concrete];
  const alleyMetal = pbr('metal_plate_02', { tile: 1.4, roughness: 0.85, metalness: 1, color: 0x6f736c });
  const garbageBag = solid({ color: 0x111413, roughness: 0.55, metalness: 0.05 });
  const alleyPaving = [0x948f82, 0x706d65, 0x4c4941].map((color) =>
    pbr('concrete_pavement', { tile: 2, color, roughness: 1, normalScale: 0.8 }));
  for (const side of [-1, 1]) {
    for (const [index, z] of [8, 22, 36, 50, 64, 78].entries()) {
      const alleyFace = alleyWallVariants[(index + (side > 0 ? 1 : 0)) % alleyWallVariants.length];
      box(6.7, 0.06, 14.4, materials.asphalt, side * 14.35, 0.02, z);
      for (const wallOffset of [-4.6, 4.6]) {
        box(0.55, 10.8, 5.2, alleyFace, side * 17.8, 5.35, z + wallOffset);
      }
      box(0.42, 0.18, 14.8, materials.trim, side * 17.45, 10.62, z);
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

      for (const windowZ of [z - 5.0, z + 5.0]) {
        box(0.08, 1.85, 1.5, materials.trim, side * 17.48, 4.15, windowZ);
        box(0.035, 1.45, 1.12, materials.glass, side * 17.425, 4.15, windowZ);
        box(0.1, 0.08, 1.65, materials.rust, side * 17.4, 3.18, windowZ);
      }

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

      const drainpipe = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.055, 5.8, 6), alleyMetal);
      drainpipe.position.set(side * 17.4, 3.0, z - 5.7);
      group.add(drainpipe);
      box(1.8, 0.12, 0.12, alleyMetal, side * 16.2, 5.4, z - 2.8);
      box(0.12, 1.2, 0.12, alleyMetal, side * 16.2, 4.8, z - 2.8);

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

  loadStreetModel('/models/large_building_a/large_building_a.glb', {
    height: 17, position: { x: 0, y: 0, z: 73.5 }, rotationY: Math.PI, tint: 0.52,
  });
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

  const skylineCanvas = document.createElement('canvas');
  skylineCanvas.width = 1024;
  skylineCanvas.height = 384;
  const skylineContext = skylineCanvas.getContext('2d');
  // O céu do canvas fica transparente: o HDRI da tempestade aparece atrás
  // e as silhuetas de prédios continuam recortando o horizonte.
  skylineContext.clearRect(0, 0, 1024, 384);
  skylineContext.fillStyle = 'rgba(70, 82, 91, 0.035)';
  skylineContext.beginPath();
  skylineContext.ellipse(520, 195, 370, 45, 0, 0, Math.PI * 2);
  skylineContext.fill();
  for (const layer of [
    { base: 304, color: '#080d10', width: 52, maxHeight: 116, windowAlpha: 0.055 },
    { base: 338, color: '#05090c', width: 37, maxHeight: 77, windowAlpha: 0.075 },
  ]) {
    skylineContext.fillStyle = layer.color;
    for (let x = -10; x < 1034;) {
      const width = layer.width * (0.65 + streetRandom() * 0.8);
      const height = 28 + streetRandom() * layer.maxHeight;
      const top = layer.base - height;
      skylineContext.fillRect(x, top, width, height + 60);
      if (streetRandom() > 0.73) {
        skylineContext.fillRect(x + width * 0.35, top - 14, width * 0.3, 14);
      }
      if (streetRandom() > 0.48) {
        skylineContext.fillStyle = '#020507';
        skylineContext.beginPath();
        skylineContext.moveTo(x + width * (0.2 + streetRandom() * 0.35), top);
        skylineContext.lineTo(x + width * (0.42 + streetRandom() * 0.25), top);
        skylineContext.lineTo(x + width * 0.35, top + 8 + streetRandom() * 17);
        skylineContext.lineTo(x + width * 0.28, top + 3);
        skylineContext.closePath();
        skylineContext.fill();
      }
      for (let wy = layer.base - height + 12; wy < layer.base - 8; wy += 15) {
        for (let wx = x + 7; wx < x + width - 5; wx += 13) {
          if (streetRandom() > 0.84) {
            skylineContext.fillStyle = `rgba(218, 174, 105, ${layer.windowAlpha})`;
            skylineContext.fillRect(wx, wy, 4, 6);
            skylineContext.fillStyle = layer.color;
          }
        }
      }
      if (streetRandom() > 0.55) {
        skylineContext.fillStyle = 'rgba(2,4,5,.88)';
        skylineContext.fillRect(
          x + width * (0.25 + streetRandom() * 0.4),
          layer.base - height + 12 + streetRandom() * Math.max(1, height - 28),
          7 + streetRandom() * 13,
          12 + streetRandom() * 24,
        );
      }
      x += width + 4;
    }
  }
  for (let i = 0; i < 48; i++) {
    skylineContext.fillStyle = `rgba(112, 121, 126, ${0.012 + streetRandom() * 0.022})`;
    skylineContext.fillRect(streetRandom() * 1024, 180 + streetRandom() * 170, 2 + streetRandom() * 28, 1);
  }
  const skylineTexture = new THREE.CanvasTexture(skylineCanvas);
  skylineTexture.colorSpace = THREE.SRGBColorSpace;
  const skyline = new THREE.Mesh(
    new THREE.PlaneGeometry(76, 28),
    new THREE.MeshBasicMaterial({
      map: skylineTexture, fog: false, side: THREE.DoubleSide,
      transparent: true, depthWrite: false,
    }),
  );
  skyline.position.set(0, 14, 96);
  skyline.rotation.y = Math.PI;
  skyline.visible = false;
  group.add(skyline);

  const createSideCityTexture = (seed) => {
    const canvas = document.createElement('canvas');
    canvas.width = 1024;
    canvas.height = 384;
    const ctx = canvas.getContext('2d');
    let sideSeed = seed;
    const random = () => ((sideSeed = (Math.imul(sideSeed, 1664525) + 1013904223) >>> 0) / 4294967296);
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    for (const layer of [
      { base: 310, color: '#0a1013', width: 42, maxHeight: 100, windowAlpha: 0.06 },
      { base: 380, color: '#151816', width: 118, maxHeight: 140, windowAlpha: 0.09 },
    ]) {
      for (let x = -10; x < canvas.width;) {
        const width = layer.width * (0.65 + random() * 0.8);
        const height = 28 + random() * layer.maxHeight;
        const top = layer.base - height;
        ctx.fillStyle = layer.color;
        ctx.fillRect(x, top, width, height + 40);
        ctx.fillStyle = 'rgba(0,0,0,.48)';
        ctx.fillRect(x + width * 0.48, top, Math.max(3, width * 0.12), height);
        if (random() > 0.7) {
          ctx.fillStyle = '#171d20';
          ctx.fillRect(x + width * 0.2, top - 12, width * 0.6, 12);
        }

        const columns = Math.max(1, Math.floor(width / 18));
        const rows = Math.max(1, Math.floor(height / 22));
        for (let row = 0; row < rows; row++) {
          for (let column = 0; column < columns; column++) {
            const wx = x + 7 + column * (width - 13) / columns;
            const wy = top + 10 + row * (height - 16) / rows;
            if (random() > 0.86) {
              const glow = random() > 0.72 ? '158,105,66' : '122,139,143';
              ctx.fillStyle = `rgba(${glow},${layer.windowAlpha})`;
              ctx.fillRect(wx, wy, 4, 7);
            }
          }
        }
        if (random() > 0.48) {
          ctx.fillStyle = 'rgba(1,3,4,.86)';
          ctx.fillRect(
            x + width * (0.18 + random() * 0.52),
            top + 8 + random() * Math.max(1, height - 28),
            5 + random() * 14,
            10 + random() * 24,
          );
        }
        if (layer.base === 380 && random() > 0.45) {
          ctx.strokeStyle = 'rgba(3,5,5,.82)';
          ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.moveTo(x + width * 0.18, top + 12);
          ctx.lineTo(x + width * 0.18, layer.base - 4);
          ctx.moveTo(x + width * 0.18, top + 42);
          ctx.lineTo(x + width * 0.82, top + 42);
          ctx.stroke();
        }
        x += width + 3;
      }
    }

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
  };
  const urbanHorizon = new THREE.Mesh(
    new THREE.PlaneGeometry(144, 54),
    new THREE.MeshBasicMaterial({
      map: createSideCityTexture(0x38c25), fog: false, side: THREE.DoubleSide,
      transparent: true, depthWrite: false,
    }),
  );
  urbanHorizon.position.set(0, 27, 88);
  urbanHorizon.rotation.y = Math.PI;
  urbanHorizon.visible = false;
  group.add(urbanHorizon);

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
  for (const [asset, x] of [['large_building_a', -15.0], ['large_building_b', 15.0]]) {
    loadStreetModel(`/models/${asset}/${asset}.glb`, {
      height: 11.5, position: { x, y: 0, z: -13 }, rotationY: x < 0 ? Math.PI / 2 : -Math.PI / 2, tint: 0.42,
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
  const flameMaterial = (seed) => new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
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
      void main() {
        float y = vUv.y;
        float turbulence = sin(y * 19.0 + time * 8.0 + seed) * 0.025
          + sin(y * 41.0 - time * 12.0 + seed * 1.7) * 0.012;
        float sway = sin(time * 5.2 + seed + y * 7.0) * (0.055 + y * 0.09) + turbulence;
        float edge = abs(vUv.x - 0.5 - sway);
        float flicker = 0.78 + 0.22 * sin(time * 7.0 + seed + y * 5.0);
        float width = mix(0.36, 0.018, y) * flicker;
        float shape = 1.0 - smoothstep(width * 0.5, width, edge);
        float base = smoothstep(0.0, 0.12, y) * (1.0 - smoothstep(0.72, 1.0, y));
        float alpha = shape * base * flicker;
        if (alpha < 0.025) discard;
        vec3 outer = mix(vec3(1.0, 0.36, 0.025), vec3(0.76, 0.07, 0.008), smoothstep(0.36, 0.92, y));
        vec3 core = mix(vec3(1.0, 0.96, 0.58), vec3(1.0, 0.48, 0.06), smoothstep(0.0, 0.66, y));
        float center = 1.0 - smoothstep(0.0, width * 0.72, edge);
        vec3 color = mix(outer, core, center * (1.0 - smoothstep(0.68, 0.98, y)));
        gl_FragColor = vec4(color, alpha * 0.92);
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
  const addWreck = (asset, position, rotationY, height, tint) => {
    loadStreetModel(asset, { height, position, rotationY, tint }, (wreck) => {
      if (asset.includes('broken_car')) {
        car.visible = false;
        fire.position.set(position.x, 0, position.z);
        fire.rotation.y = rotationY;
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
  addWreck('/models/broken_car/broken_car.glb', { x: -3.2, y: 0, z: 9.3 }, -0.52, 1.9, 0.52);
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
  for (let i = 0; i < 10; i++) {
    const seed = i * 1.37;
    const flame = new THREE.Mesh(
      new THREE.PlaneGeometry(0.62 + (i % 3) * 0.22, 1.55 + (i % 2) * 0.52),
      flameMaterial(seed),
    );
    flame.position.set((i - 4.5) * 0.18, 1.12 + (i % 3) * 0.14, -0.86 + (i % 2) * 0.52);
    flame.userData.seed = seed;
    flame.userData.originX = flame.position.x;
    flames.push(flame);
    fire.add(flame);
    // Uma segunda lâmina cruzada dá volume ao fogo quando visto de lado,
    // sem depender de transparência volumétrica pesada.
    const crossFlame = new THREE.Mesh(flame.geometry, flameMaterial(seed + 0.73));
    crossFlame.position.copy(flame.position);
    crossFlame.rotation.y = Math.PI / 2;
    crossFlame.userData.seed = seed + 0.73;
    crossFlame.userData.originX = crossFlame.position.x;
    flames.push(crossFlame);
    fire.add(crossFlame);
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
  group.add(fire);
  fire.userData.noAO = true; // fogo/fumaça não devem virar oclusores do GTAO
  const fireLight = new THREE.PointLight(0xff6a24, 42, 14, 1.65);
  fireLight.position.set(0, 1.5, -0.35);
  fire.add(fireLight);
  const smokePuffs = [];
  for (let i = 0; i < 10; i++) {
    const smokeMaterial = new THREE.SpriteMaterial({
      map: smokeTexture, color: i % 3 === 0 ? 0x666d6a : 0x929896, transparent: true, opacity: 0.52,
      depthWrite: false, blending: THREE.NormalBlending,
    });
    const puff = new THREE.Sprite(smokeMaterial);
    puff.position.set((streetRandom() - 0.5) * 0.65, 1.7 + i * 0.3, -0.15 + streetRandom() * 0.55);
    puff.scale.set(1.0 + streetRandom() * 0.45, 1.3 + streetRandom() * 0.5, 1);
    puff.userData = { phase: i / 10, drift: streetRandom() * Math.PI * 2, originX: puff.position.x };
    smokePuffs.push(puff);
    fire.add(puff);
  }
  for (let i = 0; i < 14; i++) {
    const ember = new THREE.Mesh(
      new THREE.SphereGeometry(0.025 + streetRandom() * 0.025, 5, 4),
      new THREE.MeshBasicMaterial({ color: i % 3 ? 0xff8a30 : 0xffd26a }),
    );
    ember.userData = {
      phase: streetRandom(), drift: streetRandom() * Math.PI * 2,
      rise: 1.6 + streetRandom() * 2.2,
    };
    embers.push(ember);
    fire.add(ember);
  }
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
      loadStreetModel('/models/street_light/street_light.glb', {
        height: 7.4, position: { x, y: 0, z }, rotationY: side < 0 ? Math.PI : 0, tint: 0.68,
      });
      const lit = (index + (side < 0 ? 0 : 1)) % 3 !== 1;
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

  const collisions = new CollisionWorld();
  collisions.addFloor({ minX: -14.6, maxX: 14.6, minZ: -9.7, maxZ: 74.8, y: 0 });
  collisions.addBox(0, 75.2, 30, 0.5);
  collisions.addBox(0, -9.75, 10.4, 0.6);
  for (const side of [-1, 1]) {
    for (const [index, z] of [8, 22, 36, 50, 64, 78].entries()) {
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
      for (const wallOffset of [-4.6, 4.6]) {
        collisions.addBox(side * 17.8, z + wallOffset, 0.55, 5.2, { y0: 0, y1: 10.8 });
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
  collisions.addBox(-3.2, 9.3, 4.8, 3.8, { y0: 0, y1: 2.2 });
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
  const stars = new Float32Array(180);
  for (let i = 0; i < stars.length; i += 3) {
    stars[i] = (streetRandom() - 0.5) * 55;
    stars[i + 1] = 11 + streetRandom() * 20;
    stars[i + 2] = -9 + streetRandom() * 88;
  }
  const starField = new THREE.Points(
    new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(stars, 3)),
    new THREE.PointsMaterial({ color: 0x9caec6, size: 0.11, transparent: true, opacity: 0.72, sizeAttenuation: true }),
  );
  starField.visible = false;
  group.add(starField);
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
    [8, 22, 36, 50, 64, 78]
      .filter((_, index) => index % 2 === 0)
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
  let flashTimer = 4 + streetRandom() * 8;
  let flashStrength = 0;
  let elapsed = 0;
  group.traverse((object) => { if (object.isMesh) occluders.push(object); });

  return {
    collisions,
    occluders,
    props,
    update(timeOrDelta = 0, dt = timeOrDelta, cameraPosition = null) {
      elapsed += dt;
      rainMaterial.uniforms.time.value = elapsed;
      flashTimer -= dt;
      if (flashTimer <= 0) {
        flashTimer = 9 + streetRandom() * 18;
        flashStrength = 1;
      }
      flashStrength = Math.max(0, flashStrength - dt * 2.8);
      stormLight.intensity = flashStrength * 65;
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
      if (pendingDoorTransition) {
        pendingDoorTransition.seconds -= dt;
        if (pendingDoorTransition.seconds <= 0) {
          const transition = pendingDoorTransition.transition;
          pendingDoorTransition = null;
          transition();
        }
      }
      flames.forEach((flame) => {
        const phase = flame.userData.seed;
        flame.material.uniforms.time.value = elapsed;
        flame.scale.set(
          0.78 + Math.sin(elapsed * 12.5 + phase) * 0.22,
          0.82 + Math.sin(elapsed * 7.4 + phase * 1.3) * 0.24,
          1,
        );
        flame.rotation.z = Math.sin(elapsed * 4.1 + phase) * 0.14;
        flame.position.x = flame.userData.originX + Math.sin(elapsed * 5.8 + phase) * 0.045;
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
      if (streetDoorItem) streetDoorItem.label = 'Entrar na delegacia';
    },
    spawn: { x: 0, y: 0, z: 2, yaw: 0 },
  };
}
