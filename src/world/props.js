import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

/**
 * Carrega os props CC0 da Poly Haven, normaliza a escala em metros e clona
 * instâncias compartilhando geometria/materiais. Os assets ficam em
 * /models/polyhaven/<id>/<id>.gltf (baixados por tools/fetch-assets.mjs).
 */
export function createProps({ parent, collisions, anisotropy = 4 }) {
  const loader = new GLTFLoader();
  const cache = new Map();

  async function load(id) {
    if (cache.has(id)) return cache.get(id);
    const promise = loader.loadAsync(`/models/polyhaven/${id}/${id}.gltf`).then(({ scene }) => {
      scene.traverse((object) => {
        if (!object.isMesh) return;
        object.castShadow = true;
        object.receiveShadow = true;
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        for (const material of materials) {
          if (!material) continue;
          material.envMapIntensity = 1.1;
          if ('metalness' in material) material.metalness = Math.min(material.metalness ?? 0, 0.9);
          for (const key of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap', 'alphaMap']) {
            const texture = material[key];
            if (!texture) continue;
            texture.anisotropy = anisotropy;
            texture.needsUpdate = true;
          }
        }
      });
      return scene;
    }).catch((error) => {
      console.error(`Prop CC0 indisponível: ${id}`, error);
      return null;
    });
    cache.set(id, promise);
    return promise;
  }

  /**
   * @param {string} id
   * @param {object} placement
   *   { position: [x,y,z], height, rotationY, tint, collider: {w,d,h}, name }
   */
  async function place(id, placement) {
    const {
      position = [0, 0, 0], height = 1, rotationY = 0, tint = null,
      collider = null, name = id,
    } = placement;

    if (collider) {
      const [x, y, z] = position;
      collisions?.addBox(x, z, collider.w, collider.d, { y0: y, y1: y + (collider.h ?? height) });
    }

    const template = await load(id);
    if (!template) return null;

    const model = template.clone(true);
    model.name = name;
    model.rotation.y = rotationY;

    const initialBounds = new THREE.Box3().setFromObject(model);
    const initialSize = initialBounds.getSize(new THREE.Vector3());
    if (!Number.isFinite(initialSize.y) || initialSize.y <= 0.001) return null;
    model.scale.setScalar(height / initialSize.y);
    model.updateMatrixWorld(true);

    const bounds = new THREE.Box3().setFromObject(model);
    const center = bounds.getCenter(new THREE.Vector3());
    model.position.set(
      position[0] - center.x,
      position[1] - bounds.min.y,
      position[2] - center.z,
    );

    if (tint !== null) {
      model.traverse((object) => {
        if (!object.isMesh) return;
        const apply = (material) => {
          const copy = material.clone();
          if (copy.color) copy.color.multiplyScalar(tint);
          return copy;
        };
        object.material = Array.isArray(object.material)
          ? object.material.map(apply)
          : apply(object.material);
      });
    }

    parent.add(model);
    return model;
  }

  return { place, load, cache };
}
