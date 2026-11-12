import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';

// ─────────────────────────────────────────────────────────────────────────────
// Biblioteca de animações de zumbi (Mixamo, FBX "without skin").
// Para trocar/adicionar: coloque o FBX em public/animations/zombie/ e liste aqui.
// Cada arquivo traz só o esqueleto + 1 clipe; é retargetado para cada personagem.
// ─────────────────────────────────────────────────────────────────────────────
export const CLIP_FILES = {
  idle: 'idle.fbx',
  walk: 'walk.fbx',
  run: 'run.fbx',
  attack: 'attack.fbx',
  scream: 'scream.fbx',
  death: 'death.fbx',
  dying: 'dying.fbx',
  neckBite: 'neck_bite.fbx',
  biting: 'biting.fbx',
  biting2: 'biting2.fbx',
  crawl: 'crawl.fbx',
  runningCrawl: 'running_crawl.fbx',
};

// Opções de retarget por clipe: morte/"dying" mantêm o deslocamento da raiz (a queda precisa dele).
export const CLIP_OPTIONS = { death: { inPlace: false }, dying: { inPlace: false } };

const BASE = '/animations/zombie/';
const fbx = new FBXLoader();
const cache = new Map();

// → { nome: { scene (esqueleto-fonte), clip } }
export async function loadClipLibrary(names = Object.keys(CLIP_FILES)) {
  for (const name of names) {
    if (cache.has(name)) continue;
    cache.set(name, fbx.loadAsync(BASE + CLIP_FILES[name]).then((scene) => {
      const clip = scene.animations.find((c) => c.tracks.length) || scene.animations[0];
      clip.name = name;
      return { scene, clip };
    }));
  }
  const out = {};
  for (const name of names) out[name] = await cache.get(name);
  return out;
}
