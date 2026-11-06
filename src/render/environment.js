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
    background: null,
    backgroundColor: 0x050604,
  },
  street: {
    environment: 'cobblestone_street_night',
    intensity: 0.26,
    background: 'qwantani_night_puresky',
    backgroundIntensity: 0.055,
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

  function apply(next) {
    location = next;
    const config = LOCATIONS[next];
    if (!config) return;
    const env = pmremMap.get(config.environment);
    scene.environment = env ?? null;
    scene.environmentIntensity = env ? config.intensity : 0;

    if (config.background) {
      const background = raw.get(config.background);
      const texture = background && typeof background.then !== 'function' ? background : null;
      scene.background = texture ?? new THREE.Color(config.backgroundColor);
      scene.backgroundIntensity = config.backgroundIntensity ?? 1;
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

  return { apply, get location() { return location; } };
}
