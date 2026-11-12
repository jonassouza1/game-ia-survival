import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { retargetMixamoClip } from '../player/retarget.js';
import { loadClipLibrary, CLIP_OPTIONS } from './zombieClips.js';
import { bakeRestCoords, makeZombieMaterial } from './zombieAppearance.js';

const { clamp, lerp, smoothstep } = THREE.MathUtils;
const TAU = Math.PI * 2;

// ─────────────────────────────────────────────────────────────────────────────
// 1. CARREGAMENTO
//    Qualquer GLB/GLTF ou FBX com esqueleto Mixamo vira zumbi. As animações de zumbi
//    (FBX do Mixamo em public/animations/zombie/) são retargetadas para o esqueleto de
//    cada personagem; modelos em cm (FBX) são convertidos para metros no carregamento.
// ─────────────────────────────────────────────────────────────────────────────

const loader = new GLTFLoader();
const gltfCache = new Map();

// FBX do Mixamo referencia as texturas (.png) por nome de arquivo, na mesma pasta do .fbx.
// Esperamos TODAS as texturas terminarem de carregar; as que não existirem são descartadas e o
// material cai numa cor lisa (em vez de ficar PRETO) — e avisamos no console quais faltam.
const MISSING_TEXTURE_TINT = 0x8a9478;
// Os FBX trazem texturas 2048×2048 embutidas; reduzimos para economizar memória de vídeo (placas integradas).
const MAX_TEXTURE_SIZE = 1024;
function shrinkTexture(tex) {
  const img = tex?.image;
  if (!img || !img.width || Math.max(img.width, img.height) <= MAX_TEXTURE_SIZE || typeof document === 'undefined') return;
  const k = MAX_TEXTURE_SIZE / Math.max(img.width, img.height);
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(img.width * k)); c.height = Math.max(1, Math.round(img.height * k));
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  tex.image = c; tex.needsUpdate = true;
}
function loadFBX(url) {
  return new Promise((resolve, reject) => {
    const failed = [];
    const manager = new THREE.LoadingManager();
    manager.onError = (u) => failed.push(u);
    let object = null;
    manager.onLoad = () => {
      if (!object) return;
      const slots = ['map', 'normalMap', 'specularMap', 'bumpMap', 'alphaMap', 'emissiveMap'];
      const lost = new Set();
      object.traverse((o) => {
        if (!o.isMesh) return;
        for (const m of [].concat(o.material)) {
          for (const slot of slots) {
            if (m[slot] && !m[slot].image) {
              if (slot === 'map') m.color?.set(MISSING_TEXTURE_TINT);
              m[slot] = null; m.needsUpdate = true;
            }
          }
          shrinkTexture(m.map); shrinkTexture(m.normalMap);
        }
      });
      failed.forEach((u) => lost.add(u.startsWith('blob:') ? '(textura embutida ilegível)' : decodeURIComponent(u.split('/').pop())));
      if (lost.size) console.warn(`[zumbis] ${url}: textura(s) não carregaram: ${[...lost].join(', ')}`);
      resolve({ scene: object, animations: object.animations });
    };
    new FBXLoader(manager).load(url, (obj) => { object = obj; }, undefined, reject);
  });
}

// Aceita .glb/.gltf e .fbx (formato que o Mixamo entrega); o resto do pipeline é igual.
function loadGLB(url) {
  if (!gltfCache.has(url)) {
    gltfCache.set(url, /\.fbx(\?|$)/i.test(url) ? loadFBX(url) : loader.loadAsync(url));
  }
  return gltfCache.get(url);
}


// Alguns GLBs (ex.: Michelle) trazem matrizes de bind inconsistentes com a pose em repouso
// dos ossos: skeleton.pose() — usado pelo retarget — "encolhe" o corpo. Detectamos isso e
// recalculamos o bind a partir da pose natural, com a malha na raiz (sem transformação).
function normalizeSkinning(scene) {
  const skeletons = new Set(), meshes = [], bones = [];
  scene.traverse((o) => { if (o.isSkinnedMesh) { meshes.push(o); skeletons.add(o.skeleton); } if (o.isBone) bones.push(o); });
  const saved = bones.map((b) => [b, b.position.clone(), b.quaternion.clone(), b.scale.clone()]);
  const restore = () => { saved.forEach(([b, p, q, sc]) => { b.position.copy(p); b.quaternion.copy(q); b.scale.copy(sc); }); scene.updateMatrixWorld(true); };
  const headY = () => scene.getObjectByName('mixamorigHead').getWorldPosition(new THREE.Vector3()).y;
  scene.updateMatrixWorld(true);
  const natural = headY();
  [...skeletons].sort((a, b) => a.bones.length - b.bones.length).forEach((sk) => sk.pose());
  scene.updateMatrixWorld(true);
  const posed = headY();
  restore();
  if (Math.abs(posed - natural) <= 0.08 * Math.abs(natural)) return;     // consistente: nada a fazer
  // osso raiz sob um pai com escala/rotação (ex.: "Character" 0.01 × 90°): leva a transformação
  // para o próprio osso, já que skeleton.pose() trata a matriz do osso raiz como mundial.
  bones.filter((b) => !b.parent?.isBone && b.parent !== scene).forEach((b) => scene.attach(b));
  scene.updateMatrixWorld(true);
  meshes.forEach((mesh) => {
    scene.add(mesh);
    mesh.position.set(0, 0, 0); mesh.quaternion.identity(); mesh.scale.set(1, 1, 1);
    mesh.updateMatrixWorld(true);
  });
  skeletons.forEach((sk) => sk.calculateInverses());
  meshes.forEach((mesh) => mesh.bind(mesh.skeleton, new THREE.Matrix4()));
  scene.updateMatrixWorld(true);
}

// Modelos em cm (típico de FBX do Mixamo) ou noutra unidade: em vez de escalar a cena (o que deixa
// ossos/retarget em unidades erradas), aplica a escala na geometria, nos ossos e no bind → tudo em metros.
function bakeScale(scene, k) {
  scene.updateMatrixWorld(true);
  const skinned = [], bones = [], skeletons = new Set();
  scene.traverse((o) => { if (o.isSkinnedMesh) { skinned.push(o); skeletons.add(o.skeleton); } if (o.isBone) bones.push(o); });
  bones.forEach((b) => b.position.multiplyScalar(k));
  skinned.forEach((m) => { m.geometry = m.geometry.clone(); m.geometry.scale(k, k, k); });
  scene.updateMatrixWorld(true);
  skeletons.forEach((sk) => sk.calculateInverses());
  skinned.forEach((m) => m.bind(m.skeleton, new THREE.Matrix4()));
  scene.updateMatrixWorld(true);
}

// Alguns FBX do Mixamo trazem dois ossos com o mesmo nome (ex.: um "mixamorigHips" vazio dentro do
// "mixamorigHips" real). Renomeia as repetições para o retarget e as animações acharem o osso certo.
function dedupeBoneNames(root) {
  const seen = new Set();
  root.traverse((o) => {
    if (!o.isBone) return;
    if (seen.has(o.name)) o.name = `${o.name}_dup${seen.size}`; else seen.add(o.name);
  });
}

const modelCache = new Map();

export function loadZombieModel(def) {
  if (modelCache.has(def.url)) return modelCache.get(def.url);
  const promise = (async () => {
    const gltf = await loadGLB(def.url);
    // Cada definição usa uma cópia própria da cena (a base é só modelo).
    dedupeBoneNames(gltf.scene);
    const scene = cloneSkinned(gltf.scene);
    const targetHeight = def.height ?? 1.78;
    // Altura medida pelos vértices na pose de repouso (Box3.setFromObject erra em malhas com skin).
    scene.updateMatrixWorld(true);
    normalizeSkinning(scene);
    const info = bakeRestCoords(scene);
    if (!info) throw new Error(`[zombie] ${def.url} não tem esqueleto Mixamo (mixamorig:Hips, ...)`);
    const k = targetHeight / info.height;
    let minY = info.minY * k;
    if (k < 0.2 || k > 5) {
      bakeScale(scene, k);                 // cm → m: escala embutida; a cena fica em escala 1
    } else {
      scene.scale.setScalar(k);
    }
    scene.updateMatrixWorld(true);
    const hips = scene.getObjectByName('mixamorigHips').getWorldPosition(new THREE.Vector3());
    scene.position.set(-hips.x, -minY, -hips.z);
    scene.updateMatrixWorld(true);

    // Hitboxes ajustadas à malha real deste personagem (pose de repouso, antes de qualquer animação).
    const hit = fitHitParts(scene);

    // Retarget das animações Mixamo de zumbi (FBX) para este esqueleto.
    const clips = {};
    const speeds = {};
    const rootSpeeds = {};
    const library = await loadClipLibrary();
    for (const [name, { scene: source, clip }] of Object.entries(library)) {
      try {
        const result = retargetMixamoClip(source, scene, clip, { inPlace: true, ...CLIP_OPTIONS[name] });
        clips[name] = result.clip;
        speeds[name] = result.groundSpeed * scene.scale.x;
        rootSpeeds[name] = result.info.rootSpeed * scene.scale.x;
      } catch (error) {
        console.warn(`[zombie] retarget de "${name}" falhou para ${def.url}`, error);
      }
    }

    // Quem olha para onde? (Soldier/Michelle podem olhar para -Z): alinha a frente do corpo a +Z.
    const flat = new THREE.Vector3();
    {
      const l = scene.getObjectByName('mixamorigLeftUpLeg').getWorldPosition(new THREE.Vector3());
      const r = scene.getObjectByName('mixamorigRightUpLeg').getWorldPosition(new THREE.Vector3());
      const left = l.sub(r).setY(0).normalize();
      flat.crossVectors(left, new THREE.Vector3(0, 1, 0)).normalize();     // frente
    }
    const facing = new THREE.Quaternion().setFromUnitVectors(flat, new THREE.Vector3(0, 0, 1));
    return { def, scene, clips, speeds, rootSpeeds, facing, hit };
  })();
  modelCache.set(def.url, promise);
  return promise;
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. OSSOS usados pela camada de reação a tiro (espaço de corpo: x = esquerda, y = cima, z = frente)
//    Cada osso: [pitch, yaw, roll] em radianos, em eixos do corpo, por cima da animação.
// ─────────────────────────────────────────────────────────────────────────────

const BONES = ['Hips', 'Spine', 'Spine1', 'Spine2', 'Neck', 'Head',
  'LeftShoulder', 'LeftArm', 'LeftForeArm', 'LeftHand',
  'RightShoulder', 'RightArm', 'RightForeArm', 'RightHand',
  'LeftUpLeg', 'LeftLeg', 'LeftFoot', 'RightUpLeg', 'RightLeg', 'RightFoot'];

// ─────────────────────────────────────────────────────────────────────────────
// 3. HITBOXES (cápsulas entre ossos, em metros)
// ─────────────────────────────────────────────────────────────────────────────

const _oa = new THREE.Vector3(), _ba = new THREE.Vector3(), _oc = new THREE.Vector3();
function raySphere(ro, rd, c, r) {
  _oc.copy(ro).sub(c);
  const b = _oc.dot(rd), cc = _oc.dot(_oc) - r * r, h = b * b - cc;
  if (h < 0) return -1;
  const t = -b - Math.sqrt(h);
  return t >= 0 ? t : -1;
}
function rayCapsule(ro, rd, pa, pb, r) {
  _ba.copy(pb).sub(pa);
  const baba = _ba.dot(_ba);
  if (baba < 1e-6) return raySphere(ro, rd, pa, r);
  _oa.copy(ro).sub(pa);
  const bard = _ba.dot(rd), baoa = _ba.dot(_oa), rdoa = rd.dot(_oa), oaoa = _oa.dot(_oa);
  const a = baba - bard * bard;
  if (a < 1e-8) {                                   // raio paralelo ao eixo: testa as duas pontas
    const t1 = raySphere(ro, rd, pa, r), t2 = raySphere(ro, rd, pb, r);
    if (t1 < 0) return t2;
    if (t2 < 0) return t1;
    return Math.min(t1, t2);
  }
  let b = baba * rdoa - baoa * bard;
  let c = baba * oaoa - baoa * baoa - r * r * baba;
  let h = b * b - a * c;
  if (h < 0) return -1;
  let t = (-b - Math.sqrt(h)) / a;
  const y = baoa + t * bard;
  if (y > 0 && y < baba) return t >= 0 ? t : -1;
  const oc = y <= 0 ? _oa : _oc.copy(ro).sub(pb);
  b = rd.dot(oc); c = oc.dot(oc) - r * r; h = b * b - c;
  if (h > 0) { t = -b - Math.sqrt(h); return t >= 0 ? t : -1; }
  return -1;
}


// ─────────────────────────────────────────────────────────────────────────────
// 4. ATOR
//    Animação base = clipes REAIS do Mixamo (idle, walk, attack, scream, biting,
//    death, dying…) retargetados. Por cima, só uma mola amortecida para a reação
//    a cada tiro (tronco/cabeça/membro atingido).
// ─────────────────────────────────────────────────────────────────────────────

const ONCE = new Set(['attack', 'scream', 'biting', 'death', 'dying', 'neckBite']);
const RISE_START = 4.0;        // dentro do clipe "biting": a partir daqui ele se apoia e levanta

export function createZombieActor(model, look = {}, { castShadow = true } = {}) {
  const root = new THREE.Group();     // posição + yaw (controlado pela IA)
  const character = cloneSkinned(model.scene);
  character.quaternion.copy(model.facing);
  root.add(character);
  root.userData.zombie = true;

  const bones = {};
  character.traverse((o) => {
    if (o.isBone) bones[o.name.replace('mixamorig', '')] = o;
    if (o.isMesh) {
      o.castShadow = castShadow; o.receiveShadow = true; o.frustumCulled = false;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      const out = mats.map((m) => makeZombieMaterial(m, look));
      o.material = Array.isArray(o.material) ? out : out[0];
    }
  });

  const rnd = (() => { let s = ((look.seed ?? 1) * 2654435761) >>> 0; return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296); })();

  // ── Clipes e mistura (crossfade manual por peso) ──
  const mixer = new THREE.AnimationMixer(character);
  const actions = {}, fades = {};
  for (const [name, clip] of Object.entries(model.clips)) {
    const action = mixer.clipAction(clip);
    action.setLoop(ONCE.has(name) ? THREE.LoopOnce : THREE.LoopRepeat, ONCE.has(name) ? 1 : Infinity);
    action.clampWhenFinished = true;
    action.setEffectiveWeight(0);
    action.play();
    actions[name] = action;
    fades[name] = { w: 0, t: 0, rate: 4 };
  }
  const walkSpeed = model.speeds.walk > 0.1 ? model.speeds.walk : (model.rootSpeeds?.walk || 0.35);
  const A = {
    mode: 'stand', time: 0, speed: 0, loco: null, clip: null,
    hit: { p: 0, r: 0, y: 0, vp: 0, vr: 0, vy: 0, limb: null, limbV: 0, limbX: 0 },
    death: null, settled: false, feedScale: 0.85 + rnd() * 0.3,
  };

  function play(name, { fade = 0.25, time, timeScale = 1, restart = false } = {}) {
    const action = actions[name];
    if (!action) return null;
    if (restart || time !== undefined) { action.reset(); action.time = time ?? 0; }
    action.timeScale = timeScale;
    for (const [n, f] of Object.entries(fades)) { f.t = n === name ? 1 : 0; f.rate = 1 / Math.max(0.01, fade); }
    A.clip = name;
    return action;
  }
  function updateFades(dt) {
    for (const [n, f] of Object.entries(fades)) {
      const d = f.t - f.w, step = f.rate * dt;
      f.w += Math.abs(d) <= step ? d : Math.sign(d) * step;
      actions[n].setEffectiveWeight(f.w);
    }
  }

  // ── Reação a tiro: mola amortecida aplicada por cima da animação ──
  const wq = new THREE.Quaternion(), wqi = new THREE.Quaternion();
  const qa = new THREE.Quaternion(), qb = new THREE.Quaternion(), qc = new THREE.Quaternion();
  const pm = new THREE.Matrix4(), pp = new THREE.Vector3(), ps = new THREE.Vector3();
  const pq = new THREE.Quaternion(), pqi = new THREE.Quaternion();
  const AX = new THREE.Vector3(1, 0, 0), AY = new THREE.Vector3(0, 1, 0), AZ = new THREE.Vector3(0, 0, 1);

  function applyPoseLayer(p) {
    root.updateMatrixWorld(true);
    root.getWorldQuaternion(wq); wqi.copy(wq).invert();
    for (const name of BONES) {
      const bone = bones[name];
      const v = p[name];
      if (!bone || !v) continue;
      bone.parent.updateWorldMatrix(true, false);
      pm.copy(bone.parent.matrixWorld).decompose(pp, pq, ps);
      pqi.copy(pq).invert();
      // D = Ryaw * Rpitch * Rroll em eixos do corpo; convertido para mundo (wq * D * wq^-1).
      qa.setFromAxisAngle(AZ, v[2]); qb.setFromAxisAngle(AX, v[0]); qc.setFromAxisAngle(AY, v[1]);
      qc.multiply(qb).multiply(qa);
      qc.premultiply(wq).multiply(wqi);
      qa.copy(pq).multiply(bone.quaternion);
      qa.premultiply(qc);
      bone.quaternion.copy(pqi).multiply(qa);
    }
    root.updateMatrixWorld(true);
  }
  function updateHitSpring(dt) {
    const h = A.hit, K = 120, C = 9;
    h.vp += (-K * h.p - C * h.vp) * dt; h.p += h.vp * dt;
    h.vr += (-K * h.r - C * h.vr) * dt; h.r += h.vr * dt;
    h.vy += (-K * h.y - C * h.vy) * dt; h.y += h.vy * dt;
    h.limbV += (-90 * h.limbX - 8 * h.limbV) * dt; h.limbX += h.limbV * dt;
  }
  function hitPose() {
    const h = A.hit;
    const p = {
      Spine: [h.p * 0.35, h.y * 0.3, h.r * 0.3], Spine1: [h.p * 0.5, h.y * 0.4, h.r * 0.4],
      Spine2: [h.p * 0.6, h.y * 0.5, h.r * 0.5], Neck: [h.p * 0.5, h.y * 0.5, h.r * 0.4],
      Head: [h.p * 0.9, h.y * 0.9, h.r * 0.7],
    };
    if (h.limb) {
      const { side, kind } = h.limb;
      if (kind === 'arm') { p[`${side}Arm`] = [h.limbX * 0.7, 0, (side === 'Left' ? 1 : -1) * h.limbX * 0.6]; p[`${side}ForeArm`] = [h.limbX * 0.5, 0, 0]; }
      if (kind === 'leg') { p[`${side}UpLeg`] = [-h.limbX * 0.5, 0, 0]; p[`${side}Leg`] = [h.limbX * 0.5, 0, 0]; }
    }
    return p;
  }

  // ── API ──
  const api = {
    root, character, bones, mixer, actions, hit: model.hit,
    walkGroundSpeed: walkSpeed,
    get mode() { return A.mode; },
    get settled() { return A.settled; },

    // Modos: stand · feed · rise · scream · walk · attack · dead (via startDeath)
    setMode(mode, opts = {}) {
      A.mode = mode; A.time = 0; A.loco = null;
      switch (mode) {
        case 'stand': play('idle', { fade: 0.4, timeScale: 0.9 + rnd() * 0.2, time: rnd() * 4 }); break;
        case 'feed': play('biting2', { fade: 0.3, time: rnd() * 2.3, timeScale: A.feedScale }); break;
        case 'rise': play('biting', { fade: 0.3, restart: true, time: RISE_START, timeScale: opts.timeScale ?? 1.15 }); break;
        case 'scream': play('scream', { fade: 0.25, restart: true, timeScale: opts.timeScale ?? 1.5 }); break;
        case 'attack': play('attack', { fade: 0.2, restart: true, timeScale: opts.timeScale ?? 1.3 }); break;
        case 'walk': A.loco = null; break;     // escolhido a cada frame em função da velocidade
        default: break;
      }
    },
    // Velocidade (m/s) da perseguição: define idle↔walk e a cadência dos passos (sem escorregar).
    setLocomotion(speed) { A.speed = speed; },
    // progresso (0..1) do clipe de ataque / levantar / grito
    get attackProgress() { return A.mode === 'attack' ? actions.attack.time / actions.attack.getClip().duration : 0; },
    get riseDone() { const a = actions.biting; return A.mode === 'rise' && a.time >= a.getClip().duration - 0.04; },
    get screamDone() { const a = actions.scream; return A.mode === 'scream' && a.time >= a.getClip().duration - 0.04; },
    get riseDuration() { const a = actions.biting; return (a.getClip().duration - RISE_START) / (a.timeScale || 1.15); },

    // Morte: headshot → "death" (cai de costas); outros → sorteio, preferindo "dying" (ajoelha e desaba)
    startDeath({ headshot = false, fromFront = true, instant = false } = {}) {
      const name = headshot ? 'death' : (fromFront ? (Math.random() < 0.55 ? 'dying' : 'death') : 'dying');
      A.mode = 'dead'; A.time = 0; A.death = { name };
      const action = play(name, { fade: instant ? 0.01 : 0.12, restart: true, timeScale: headshot ? 1.4 : 1 });
      if (instant) {
        action.time = action.getClip().duration;
        for (const [n, f] of Object.entries(fades)) { f.w = f.t = n === name ? 1 : 0; actions[n].setEffectiveWeight(f.w); }
        mixer.update(0);
        A.settled = true;
      }
    },
    // Dano recebido: direção do projétil em coordenadas do corpo (z = para onde o zumbi olha)
    hitReaction(dirLocal, strength, limb = null) {
      const h = A.hit;
      h.vp += dirLocal.z * 7 * strength;      // tiro de frente (bala indo para -z do corpo) → tronco vai para trás
      h.vr += dirLocal.x * 6 * strength;
      h.vy += dirLocal.x * 4 * strength * (Math.random() < 0.5 ? -1 : 1);
      if (limb) { h.limb = limb; h.limbV += 7 * strength; }
    },
    // Depuração: mostra o clipe `name` no instante `t` (sem a mola de reação).
    preview(name, t) {
      for (const [n, a] of Object.entries(actions)) { a.enabled = true; a.paused = false; a.setEffectiveWeight(n === name ? 1 : 0); if (n === name) a.time = t; }
      mixer.update(0);
      root.updateMatrixWorld(true);
    },
    update(dt) {
      A.time += dt;
      const dead = A.mode === 'dead';
      // idle ↔ walk em função da velocidade
      if (A.mode === 'walk') {
        const want = A.speed < 0.08 ? 'idle' : 'walk';
        if (want !== A.loco) { A.loco = want; play(want, { fade: 0.35, timeScale: 1 }); }
        if (want === 'walk') actions.walk.timeScale = A.speed / walkSpeed;
      }
      updateFades(dt);
      mixer.update(dt);
      if (dead) {
        const a = actions[A.death.name];
        if (a.time >= a.getClip().duration - 0.02) A.settled = true;
      } else {
        updateHitSpring(dt);
        const h = A.hit;
        if (Math.abs(h.p) + Math.abs(h.r) + Math.abs(h.y) + Math.abs(h.limbX) + Math.abs(h.vp) + Math.abs(h.vr) > 2e-3) applyPoseLayer(hitPose());
      }
    },
  };

  // ── Medidas do clipe de "comer" / queda, no espaço do ator (root ainda na origem) ──
  const where = (name, t) => {
    api.preview(name, t);
    const hips = bones.Hips.getWorldPosition(new THREE.Vector3()), head = bones.Head.getWorldPosition(new THREE.Vector3());
    return { hips: [hips.x, hips.z], head: [head.x, head.z] };
  };
  if (actions.biting2 && actions.biting) {
    const f = where('biting2', 0.6), r = where('biting', RISE_START);
    api.feedPose = {
      hips: f.hips, head: f.head,
      // diferença de posição entre o "comer" (biting2) e o início do "levantar" (biting)
      riseShift: [f.hips[0] - r.hips[0], f.hips[1] - r.hips[1]],
    };
  }
  if (actions.death) {
    const l = where('death', actions.death.getClip().duration);
    api.lyingPose = { hips: l.hips, head: l.head };
  }
  for (const f of Object.values(fades)) f.w = f.t = 0;
  for (const a of Object.values(actions)) a.setEffectiveWeight(0);
  return api;
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. HITBOXES AJUSTADAS À MALHA
//    Cada parte é uma cápsula entre dois pontos presos a ossos (por isso acompanha a animação).
//    O RAIO de cada cápsula é medido nos vértices reais do personagem (pele pelos pesos dos ossos),
//    então a área acertável cobre o corpo que o jogador vê — com qualquer modelo Mixamo.
// ─────────────────────────────────────────────────────────────────────────────

const ZONES = {
  head: { damage: 100 },
  neck: { damage: 50 },
  chest: { damage: 34 },
  abdomen: { damage: 30 },
  arm: { damage: 12 },
  leg: { damage: 20 },
};
export const ZONE_DAMAGE = Object.fromEntries(Object.entries(ZONES).map(([k, v]) => [k, v.damage]));

// a/b: ossos das pontas · groups: ossos cujos vértices definem o raio · min/max: limites do raio (m)
// extendB: prolonga a ponta b (m) na direção a→b (mãos). Raios mínimos = os valores antigos.
function partTable() {
  const parts = [
    { id: 'neck', zone: 'neck', a: 'Neck', b: 'Head', groups: /^Neck\d*$/, min: 0.06, max: 0.11 },
    { id: 'chest', zone: 'chest', a: 'Spine1', b: 'Neck', groups: /^(Spine1|Spine2)$/, min: 0.15, max: 0.24 },
    { id: 'abdomen', zone: 'abdomen', a: 'Hips', b: 'Spine1', groups: /^Spine$/, min: 0.14, max: 0.24 },
    // pélvis: de uma articulação de quadril à outra (cobre a largura dos quadris, que a cápsula do abdômen não cobre)
    { id: 'pelvis', zone: 'abdomen', a: 'LeftUpLeg', b: 'RightUpLeg', groups: /^Hips$/, min: 0.10, max: 0.15 },
  ];
  for (const side of ['Left', 'Right']) {
    const arm = { kind: 'arm', side }, leg = { kind: 'leg', side };
    parts.push(
      // ombro (clavícula → articulação do ombro): conta como peito
      { id: `${side}Shoulder`, zone: 'chest', a: `${side}Shoulder`, b: `${side}Arm`, groups: new RegExp(`^${side}Shoulder$`), min: 0.06, max: 0.13 },
      { id: `${side}UpperArm`, zone: 'arm', limb: arm, a: `${side}Arm`, b: `${side}ForeArm`, groups: new RegExp(`^${side}Arm$`), min: 0.065, max: 0.14 },
      { id: `${side}ForeArm`, zone: 'arm', limb: arm, a: `${side}ForeArm`, b: `${side}Hand`, extendB: 0.09, groups: new RegExp(`^(${side}ForeArm|${side}Hand.*)$`), min: 0.058, max: 0.09 },
      { id: `${side}Thigh`, zone: 'leg', limb: leg, a: `${side}UpLeg`, b: `${side}Leg`, groups: new RegExp(`^${side}UpLeg$`), min: 0.095, max: 0.20 },
      { id: `${side}Shin`, zone: 'leg', limb: leg, a: `${side}Leg`, b: `${side}Foot`, groups: new RegExp(`^${side}Leg$`), min: 0.07, max: 0.14 },
      { id: `${side}Foot`, zone: 'leg', limb: leg, a: `${side}Foot`, b: `${side}ToeBase`, extendB: 0.05, groups: new RegExp(`^${side}(Foot|ToeBase|Toe_End)$`), min: 0.055, max: 0.095 },
    );
  }
  return parts;
}
// Percentil das distâncias dos vértices ao eixo da cápsula usado como raio: 0.70 cobre ~96% do corpo visível
// com pouca folga no ar; a cabeça (1 tiro = morte) usa 0.95 para não parecer que o tiro "atravessa" o crânio.
const BODY_PCT = 0.70, HEAD_PCT = 0.95;
const HEAD_GROUPS = /^(Head|HeadTop_End|.*Eye.*|.*Jaw.*|.*Hair.*)$/;

const percentile = (arr, p) => { if (!arr.length) return 0; arr.sort((x, y) => x - y); return arr[Math.min(arr.length - 1, Math.floor(arr.length * p))]; };

function distToSegment(p, a, b, tmp) {
  tmp.copy(b).sub(a);
  const l2 = tmp.lengthSq();
  const t = l2 < 1e-8 ? 0 : clamp(p.clone().sub(a).dot(tmp) / l2, 0, 1);
  return p.distanceTo(a.clone().addScaledVector(tmp, t));
}

// Roda uma vez por modelo, na pose de repouso. Guarda pontos em coordenadas LOCAIS de cada osso.
function fitHitParts(scene) {
  scene.updateMatrixWorld(true);
  const bone = {};
  scene.traverse((o) => { if (o.isBone) bone[o.name.replace('mixamorig', '')] = o; });
  const wp = (name) => bone[name]?.getWorldPosition(new THREE.Vector3());
  // vértices (mundo, repouso) agrupados pelo osso de maior peso
  const byBone = {};
  const v = new THREE.Vector3();
  scene.traverse((m) => {
    if (!m.isSkinnedMesh) return;
    m.skeleton.update();
    const si = m.geometry.attributes.skinIndex, sw = m.geometry.attributes.skinWeight, n = m.geometry.attributes.position.count;
    // malhas muito densas: usa no máximo ~40 mil amostras
    const stride = Math.max(1, Math.floor(n / 40000));
    for (let i = 0; i < n; i += stride) {
      let best = 0, bw = -1;
      for (let k = 0; k < 4; k++) { const w = sw.getComponent(i, k); if (w > bw) { bw = w; best = si.getComponent(i, k); } }
      const name = m.skeleton.bones[best]?.name.replace('mixamorig', '').replace(/_dup\d+$/, '');
      if (!name) continue;
      m.getVertexPosition(i, v).applyMatrix4(m.matrixWorld);
      (byBone[name] ||= []).push(v.x, v.y, v.z);
    }
  });
  const vertsOf = (re) => { const out = []; for (const [name, arr] of Object.entries(byBone)) if (re.test(name)) for (let i = 0; i < arr.length; i += 3) out.push(new THREE.Vector3(arr[i], arr[i + 1], arr[i + 2])); return out; };
  const local = (name, point) => bone[name].worldToLocal(point.clone()).toArray();

  const parts = [];
  const tmp = new THREE.Vector3();
  for (const def of partTable()) {
    const A = wp(def.a); let B = wp(def.b);
    if (!A || (!B && !def.extendB)) continue;
    let bName = def.b;
    if (!B) { bName = def.a; B = A.clone().add(new THREE.Vector3(0, 0, 0)); }
    if (def.extendB) {
      const dirAB = B.clone().sub(A); if (dirAB.lengthSq() < 1e-8) dirAB.set(0, -1, 0);
      B.addScaledVector(dirAB.normalize(), def.extendB);
    }
    const pts = vertsOf(def.groups);
    const dists = pts.map((p) => distToSegment(p, A, B, tmp));
    const r = clamp(percentile(dists, BODY_PCT) + 0.004, def.min, def.max);
    parts.push({ id: def.id, zone: def.zone, limb: def.limb ?? null, aBone: def.a, bBone: bName, a: local(def.a, A), b: local(bName, B), r, samples: pts.length });
  }
  // cabeça: esfera centrada nos vértices da cabeça
  const head = vertsOf(HEAD_GROUPS);
  let headPart = null;
  if (bone.Head) {
    let c = wp('Head');
    if (head.length > 20) { c = new THREE.Vector3(); head.forEach((p) => c.add(p)); c.divideScalar(head.length); }
    else if (wp('HeadTop_End')) c = c.add(wp('HeadTop_End')).multiplyScalar(0.5);
    const r = head.length > 20 ? clamp(percentile(head.map((p) => p.distanceTo(c)), HEAD_PCT) + 0.006, 0.115, 0.19) : 0.145;
    headPart = { bone: 'Head', c: local('Head', c), r };
  }
  return { parts, head: headPart };
}

const _tmpA = new THREE.Vector3();
const _pa = new THREE.Vector3(), _pb = new THREE.Vector3(), _hc = new THREE.Vector3();
const _w = new Map();   // pontos de mundo reutilizados por parte
export function raycastActor(actor, origin, dir, maxDistance = 50) {
  const fit = actor.hit;
  if (!fit) return null;
  const b = actor.bones;
  actor.root.updateMatrixWorld(true);
  let best = null;
  const test = (t, zone, extra = {}) => {
    if (t >= 0 && t <= maxDistance && (!best || t < best.t)) best = { t, zone, ...extra };
  };
  const ends = {};
  for (const part of fit.parts) {
    const A = b[part.aBone], B = b[part.bBone];
    if (!A || !B) continue;
    const pa = new THREE.Vector3().fromArray(part.a), pb = new THREE.Vector3().fromArray(part.b);
    A.localToWorld(pa); B.localToWorld(pb);
    ends[part.id] = [pa, pb, part.r];
    test(rayCapsule(origin, dir, pa, pb, part.r), part.zone, { part: part.id, ...(part.limb ? { limb: part.limb } : {}) });
  }
  if (fit.head && b[fit.head.bone]) {
    const c = new THREE.Vector3().fromArray(fit.head.c);
    b[fit.head.bone].localToWorld(c);
    test(raySphere(origin, dir, c, fit.head.r), 'head', { part: 'head' });
  }
  if (!best) return null;
  // Braço na frente do tronco (comum na caminhada de zumbi): a bala atravessa o braço e atinge o tronco,
  // então o dano é o do peito/abdômen (a reação continua sendo a do braço).
  if (best.zone === 'arm') {
    const ch = ends.chest, ab = ends.abdomen, pv = ends.pelvis;
    if (ch && rayCapsule(origin, dir, ch[0], ch[1], ch[2]) >= 0) best.zone = 'chest';
    else if (ab && rayCapsule(origin, dir, ab[0], ab[1], ab[2]) >= 0) best.zone = 'abdomen';
    else if (pv && rayCapsule(origin, dir, pv[0], pv[1], pv[2]) >= 0) best.zone = 'abdomen';
  }
  best.point = origin.clone().addScaledVector(dir, best.t);
  return best;
}
