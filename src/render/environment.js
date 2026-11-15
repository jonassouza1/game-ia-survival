import * as THREE from 'three';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';

/**
 * Iluminação indireta real: HDRIs CC0 da Poly Haven convertidos para PMREM.
 * O ambiente muda junto com o cenário (saguão x rua) e o céu da rua é o mesmo
 * HDRI nublado, bem escurecido e desfocado, para ler como tempestade noturna.
 */
const LOCATIONS = {
  hall: {
    environment: 'abandoned_hall_01',
    intensity: 0.45,
    flashEnv: 0.1,          // clarão que entra pelas janelas do saguão
    background: null,
    backgroundColor: 0x050604,
  },
  // Hospital abandonado: quase só luz dinâmica (fluorescentes falhando, emergência vermelha) e a lanterna.
  hospital: {
    environment: 'abandoned_hall_01',
    intensity: 0.17,
    flashEnv: 0.04,
    background: null,
    backgroundColor: 0x020303,
  },
  street: {
    environment: 'cobblestone_street_night',
    intensity: 0.26,
    flashEnv: 1.1,
    background: 'qwantani_night_puresky',
    backgroundIntensity: 0.055,
    flashBg: 0.5,
    backgroundColor: 0x03070b,
  },
};

export function createEnvironment(renderer, scene) {
  const pmrem = new THREE.PMREMGenerator(renderer);
  pmrem.compileEquirectangularShader();
  const rgbe = new HDRLoader();
  const raw = new Map();
  const pmremMap = new Map();
  let location = 'hall';
  let flash = 0;

  function load(id) {
    if (raw.has(id)) return raw.get(id);
    const promise = rgbe.loadAsync(`/hdri/${id}_1k.hdr`).then((texture) => {
      texture.mapping = THREE.EquirectangularReflectionMapping;
      const target = pmrem.fromEquirectangular(texture);
      pmremMap.set(id, target.texture);
      raw.set(id, texture);
      if (LOCATIONS[location].environment === id || LOCATIONS[location].background === id) apply(location);
      return texture;
    }).catch((error) => {
      console.warn(`HDRI indisponível (${id}):`, error);
      return null;
    });
    raw.set(id, promise);
    return promise;
  }

  // Soma o clarão (0..1) de um relâmpago à intensidade-base do ambiente e do céu.
  function setFlash(amount) {
    flash = amount;
    const config = LOCATIONS[location];
    if (scene.environment) scene.environmentIntensity = config.intensity + amount * (config.flashEnv ?? 0);
    if (config.background) scene.backgroundIntensity = (config.backgroundIntensity ?? 1) + amount * (config.flashBg ?? 0);
  }

  function apply(next) {
    location = next;
    const config = LOCATIONS[next];
    if (!config) return;
    const env = pmremMap.get(config.environment);
    scene.environment = env ?? null;
    scene.environmentIntensity = env ? config.intensity + flash * (config.flashEnv ?? 0) : 0;

    if (config.background) {
      const background = raw.get(config.background);
      const texture = background && typeof background.then !== 'function' ? background : null;
      scene.background = texture ?? new THREE.Color(config.backgroundColor);
      scene.backgroundIntensity = (config.backgroundIntensity ?? 1) + flash * (config.flashBg ?? 0);
      scene.backgroundBlurriness = 0;
    } else {
      scene.background = new THREE.Color(config.backgroundColor);
      scene.backgroundIntensity = 1;
      scene.backgroundBlurriness = 0;
    }
    load(config.environment);
    if (config.background) load(config.background);
  }

  // Começa carregando os dois ambientes e o céu para evitar atraso na troca.
  load(LOCATIONS.hall.environment);
  load(LOCATIONS.street.environment);
  load(LOCATIONS.street.background);
  apply('hall');

  return { apply, setFlash, get location() { return location; } };
}
