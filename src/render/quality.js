import * as THREE from 'three';

/**
 * Presets de qualidade gráfica.
 *
 * O jogo usa PBR + HDRI + GTAO; num Intel HD isso pesa. O preset é escolhido
 * automaticamente pela GPU, pode ser forçado com ?q=high|medium|low e fica
 * salvo em localStorage quando o jogador escolhe na tela inicial.
 */
const PRESETS = {
  high: {
    name: 'high',
    label: 'ALTO',
    pixelRatio: 1.5,
    antialias: 4,
    shadowMapType: 'PCFSoftShadowMap',
    shadows: 'full',
    postfx: 'high',
    gtaoScale: 0.55,
    gtaoBlend: 0.95,
    bloomStrength: 0.28,
    chromatic: 1,
  },
  medium: {
    name: 'medium',
    label: 'MÉDIO',
    pixelRatio: 0.8,
    antialias: 2,
    shadowMapType: 'PCFShadowMap',
    shadows: 'reduced',
    postfx: 'medium',
    gtaoScale: 0.45,
    gtaoBlend: 0.9,
    bloomStrength: 0.22,
    chromatic: 0.35,
  },
  low: {
    name: 'low',
    label: 'BAIXO',
    pixelRatio: 0.7,
    antialias: 0,
    shadowMapType: 'PCFShadowMap',
    shadows: 'flashlight',
    postfx: 'off',
    gtaoScale: 0.4,
    gtaoBlend: 0.85,
    bloomStrength: 0.2,
    chromatic: 0,
  },
};

function detectGPU(renderer) {
  try {
    const gl = renderer.getContext();
    const debug = gl.getExtension('WEBGL_debug_renderer_info');
    return debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : '';
  } catch {
    return '';
  }
}

export function resolveQuality(renderer) {
  const preset = new URLSearchParams(window.location.search).get('q');
  if (PRESETS[preset]) return PRESETS[preset];
  try {
    const stored = window.localStorage.getItem('rpd-quality');
    if (PRESETS[stored]) return PRESETS[stored];
  } catch { /* localStorage bloqueado: segue a detecção */ }

  const gpu = detectGPU(renderer);
  if (/swiftshader|llvmpipe|software|basic render/i.test(gpu)) return PRESETS.low;
  if (/intel/i.test(gpu)) return PRESETS.medium;
  return PRESETS.high;
}

const SHADOW_TYPES = {
  BasicShadowMap: THREE.BasicShadowMap,
  PCFShadowMap: THREE.PCFShadowMap,
  PCFSoftShadowMap: THREE.PCFSoftShadowMap,
};

/** Ajusta o renderer antes de criar os materiais/luzes. */
export function applyQuality(renderer, quality) {
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, quality.pixelRatio));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = SHADOW_TYPES[quality.shadowMapType] ?? THREE.PCFShadowMap;
}

/** Configura as sombras de uma cena de acordo com o preset. */
export function configureGroupShadows(group, quality) {
  group.traverse((object) => {
    if (!object.isLight) return;
    if (quality.shadows === 'full') return;
    if (quality.shadows === 'reduced') {
      if (object.isPointLight || object.isDirectionalLight) object.castShadow = false;
      if (object.isSpotLight && object.shadow?.mapSize) object.shadow.mapSize.set(1024, 1024);
      return;
    }
    // flashlight: só a lanterna do jogador projeta sombra.
    object.castShadow = false;
  });
}
