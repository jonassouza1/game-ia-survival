import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

/**
 * Fábrica única de GLTFLoader.
 *  • Os modelos de public/models usam compressão meshopt (tools/optimize-models.mjs) → precisam do MeshoptDecoder.
 *  • No preset BAIXO as texturas embutidas nos GLB são limitadas a 512 px logo após o carregamento
 *    (1/4 da memória de vídeo e do tempo de envio à GPU; com a tela a 0,7× não há ganho visível em resoluções maiores).
 */
let textureLimit = Infinity;
export function setModelTextureLimit(size) { textureLimit = size || Infinity; }

function capTexture(texture) {
  const image = texture?.image;
  if (!image?.width || Math.max(image.width, image.height) <= textureLimit || texture.userData.capped) return;
  const k = textureLimit / Math.max(image.width, image.height);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(image.width * k));
  canvas.height = Math.max(1, Math.round(image.height * k));
  canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
  image.close?.();                         // ImageBitmap: libera a cópia em tamanho original
  texture.image = canvas;
  texture.userData.capped = true;
  texture.needsUpdate = true;
}

function textureLimitPlugin() {
  return {
    name: 'RPD_texture_limit',
    afterRoot(gltf) {
      if (!Number.isFinite(textureLimit)) return null;
      const seen = new Set();
      gltf.scene.traverse((object) => {
        if (!object.isMesh) return;
        for (const material of [].concat(object.material)) {
          for (const key in material) {
            const value = material[key];
            if (value?.isTexture && !seen.has(value)) { seen.add(value); capTexture(value); }
          }
        }
      });
      return null;
    },
  };
}

export function createGLTFLoader() {
  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  loader.register(textureLimitPlugin);
  return loader;
}
