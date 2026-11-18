import * as THREE from 'three';

/**
 * Prédio do hospital no fim da rua (modelo "Jejungwon Hospital", já tratado: janelas tapadas com tábuas, vidro
 * quebrado, tijolo sujo, placa "RACCOON HOSPITAL"; ver public/models/hospital/building.glb).
 *
 * - Escala e posição vêm do manifesto (`exterior`); o prédio é virado para a rua (rotationY = π, frente para -z).
 * - A colisão usa a planta real do modelo (`building.json`), deixando o pórtico livre até a porta.
 *   Para a câmera e os tiros usam-se as mesmas caixas simples: o modelo tem ~54 mil triângulos e testar raios
 *   contra ele a cada quadro seria caro.
 * - A porta de entrada é feita de duas folhas (asset `doorLeafL/R`) com dobradiças; se não houver asset,
 *   usa-se uma porta simples de caixas.
 */
export function placeHospitalBuilding({ group, loader, collisions, occluders, exterior, doorLeaves }) {
  const s = exterior.scale ?? 0.85;
  const [px, py, pz] = exterior.position ?? [0, 0, 73.7];
  const rotationY = exterior.rotationY ?? Math.PI;
  const tint = exterior.tint ?? 0.8;
  const data = exterior.data;

  const root = new THREE.Group();
  root.name = 'HospitalBuilding';
  root.scale.setScalar(s);
  root.position.set(px, py, pz);
  root.rotation.y = rotationY;
  group.add(root);

  // ── Modelo ──
  loader.load(exterior.url, ({ scene: model }) => {
    model.traverse((object) => {
      if (!object.isMesh) return;
      object.castShadow = true;
      object.receiveShadow = true;
      const tintMaterial = (material) => {
        const copy = material.clone();
        if (copy.color) copy.color.multiplyScalar(tint);
        return copy;
      };
      object.material = Array.isArray(object.material) ? object.material.map(tintMaterial) : tintMaterial(object.material);
    });
    root.add(model);
  }, undefined, (error) => console.error('Não foi possível carregar o prédio do hospital:', error));

  // ── Colisão (planta do modelo → mundo) ──
  const cos = Math.cos(rotationY), sin = Math.sin(rotationY);
  const toWorld = (mx, mz) => [px + s * (mx * cos + mz * sin), pz + s * (-mx * sin + mz * cos)];
  const swap = Math.abs(sin) > 0.5;                           // giros de ±90° trocam largura e profundidade
  const height = (data?.bounds?.height ?? 12.3) * s;
  for (const box of data?.collision ?? []) {
    const [wx, wz] = toWorld(box.cx, box.cz);
    const w = (swap ? box.d : box.w) * s, d = (swap ? box.w : box.d) * s;
    collisions.addBox(wx, wz, w, d, { y0: 0, y1: height });
    // Alvo de raycast invisível (fora da cena) com a mesma forma: leve para câmera, tiros e mira.
    const proxy = new THREE.Mesh(new THREE.BoxGeometry(w, height, d), new THREE.MeshBasicMaterial());
    proxy.position.set(wx, height / 2, wz);
    proxy.updateMatrixWorld(true);
    occluders.push(proxy);
  }

  // ── Porta de entrada (no espaço do modelo, para acompanhar a escala) ──
  const ent = data?.entrance ?? { x: 0, z: 4.92, width: 2.82, height: 2.64 };
  const halfW = ent.width / 2;
  const leafZ = ent.z + 0.06;
  // Vão escuro atrás das folhas: esconde as portas brancas do modelo quando a porta se abre.
  const recess = new THREE.Mesh(new THREE.BoxGeometry(ent.width, ent.height, 0.04), new THREE.MeshBasicMaterial({ color: 0x020303 }));
  recess.position.set(ent.x, ent.height / 2, ent.z + 0.025);
  root.add(recess);

  const leaves = [];
  for (const side of [-1, 1]) {                                // -1 = folha esquerda (dobradiça em x = -halfW)
    const hinge = new THREE.Group();
    hinge.position.set(ent.x + side * halfW, 0, leafZ);
    root.add(hinge);
    leaves.push({ hinge, side });
    const asset = side < 0 ? doorLeaves?.left : doorLeaves?.right;
    if (asset) {
      loader.load(asset.url, ({ scene: leaf }) => {
        // O asset mede ~0,98 × 2,33 m por folha: estica até o tamanho do vão.
        leaf.scale.set(halfW / 0.978, ent.height / 2.328, 1.4);
        leaf.traverse((object) => {
          if (!object.isMesh) return;
          object.castShadow = true;
          object.receiveShadow = true;
          const copy = object.material.clone();
          copy.color?.multiplyScalar(asset.tint ?? 0.8);
          object.material = copy;
        });
        hinge.add(leaf);
      }, undefined, (error) => console.error('Não foi possível carregar a folha da porta:', error));
    } else {
      const wood = new THREE.MeshStandardMaterial({ color: 0x3b362d, roughness: 0.95 });
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(halfW, ent.height * 0.95, 0.08), wood);
      mesh.position.set(-side * halfW / 2, ent.height * 0.475, 0);
      mesh.castShadow = true;
      hinge.add(mesh);
    }
  }

  // Posição da interação, em frente à porta (sob o pórtico), em coordenadas do mundo.
  const [dx, dz] = toWorld(ent.x, ent.z + 1.3);
  return { root, leaves, doorPosition: new THREE.Vector3(dx, 0, dz), scale: s };
}
