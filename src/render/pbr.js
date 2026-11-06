import * as THREE from 'three';

/**
 * Biblioteca de materiais PBR baseada nos assets CC0 da Poly Haven.
 *
 * Cada conjunto em /textures/pbr/<id>/ traz três mapas de 1k:
 *   diffuse.jpg  — albedo sRGB
 *   normal.jpg   — normal map de espaço tangente
 *   arm.jpg      — R = oclusão, G = rugosidade, B = metalicidade (mapa empacotado)
 *
 * O jogo continua usando UV de mundo (ver Builder), então a textura repete pelo
 * cenário em vez de esticar uma única imagem por parede inteira.
 */

let anisotropy = 4;
const loader = new THREE.TextureLoader();
const sets = new Map();

function fallbackCanvas(color) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 4;
  const context = canvas.getContext('2d');
  context.fillStyle = color;
  context.fillRect(0, 0, 4, 4);
  return canvas;
}

const FALLBACK = {
  diffuse: fallbackCanvas('#808080'),
  normal: fallbackCanvas('#8080ff'),
  arm: fallbackCanvas('#ffc800'),
};

export function initPBR(renderer) {
  anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
}

function prepare(texture, colorSpace) {
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.anisotropy = anisotropy;
  texture.colorSpace = colorSpace;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  return texture;
}

function loadMap(url, kind) {
  const texture = new THREE.Texture();
  prepare(texture, kind === 'diffuse' ? THREE.SRGBColorSpace : THREE.NoColorSpace);
  const ready = new Promise((resolve) => {
    loader.load(url, (loaded) => {
      texture.image = loaded.image;
      texture.needsUpdate = true;
      loaded.dispose();
      resolve(texture);
    }, undefined, () => {
      texture.image = FALLBACK[kind];
      texture.needsUpdate = true;
      console.warn(`Textura PBR ausente: ${url} — usando fallback.`);
      resolve(texture);
    });
  });
  texture.userData.ready = ready;
  return texture;
}

/** Carrega (uma vez) o conjunto de mapas de um material. */
export function getTextureSet(id) {
  let set = sets.get(id);
  if (set) return set;
  const base = `/textures/pbr/${id}`;
  const diffuse = loadMap(`${base}/diffuse.jpg`, 'diffuse');
  const normal = loadMap(`${base}/normal.jpg`, 'normal');
  const arm = loadMap(`${base}/arm.jpg`, 'arm');
  set = {
    id, diffuse, normal, arm,
    ready: Promise.all([
      diffuse.userData.ready, normal.userData.ready, arm.userData.ready,
    ]),
  };
  sets.set(id, set);
  return set;
}

/**
 * Material standard com mapas reais.
 *
 * @param {string} id       id da textura em /public/textures/pbr
 * @param {object} options  tile (metros por repetição), cor, rugosidade etc.
 */
export function pbr(id, options = {}) {
  const {
    tile = 2,
    color = 0xffffff,
    roughness = 1,
    metalness = 1,
    normalScale = 1,
    aoIntensity = 0.85,
    envMapIntensity = 1,
    uv = 'world',
    side = THREE.FrontSide,
    transparent = false,
    opacity = 1,
    depthWrite = true,
    emissive = 0x000000,
    emissiveIntensity = 0,
    polygonOffset = false,
    polygonOffsetFactor = 0,
    flatShading = false,
    ...rest
  } = options;

  const set = getTextureSet(id);
  const material = new THREE.MeshStandardMaterial({
    map: set.diffuse,
    normalMap: set.normal,
    roughnessMap: set.arm,
    metalnessMap: set.arm,
    aoMap: set.arm,
    roughness,
    metalness,
    color,
    side,
    transparent,
    opacity,
    depthWrite,
    emissive,
    emissiveIntensity,
    polygonOffset,
    polygonOffsetFactor,
    flatShading,
    dithering: true,
    ...rest,
  });
  material.normalScale.set(normalScale, normalScale);
  material.aoMapIntensity = aoIntensity;
  material.envMapIntensity = envMapIntensity;
  material.userData.tile = tile;
  material.userData.uv = uv;
  material.userData.pbr = id;
  return material;
}

/** Material metálico/pintado simples, sem textura (ferragens, papel, plástico). */
export function solid({
  color = 0xffffff, roughness = 0.6, metalness = 0, tile = 2, uv = 'world',
  emissive = 0x000000, emissiveIntensity = 1, ...rest
} = {}) {
  const material = new THREE.MeshStandardMaterial({
    color, roughness, metalness, emissive, emissiveIntensity, dithering: true, ...rest,
  });
  material.userData.tile = tile;
  material.userData.uv = uv;
  return material;
}

/** Atalho para peças que devem brilhar (lâmpadas, telas) e alimentar o bloom. */
export function glow(color, intensity = 2, options = {}) {
  return solid({
    color: 0x000000, emissive: color, emissiveIntensity: intensity, roughness: 1, metalness: 0,
    ...options,
  });
}

/** Pré-carrega os conjuntos para evitar pop-in durante o primeiro frame. */
export function preloadPBR(ids) {
  return Promise.all(ids.map((id) => getTextureSet(id).ready));
}
