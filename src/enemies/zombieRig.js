import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { retargetMixamoClip } from '../player/retarget.js';
import { bakeRestCoords, makeZombieMaterial } from './zombieAppearance.js';

const { clamp, lerp, smoothstep } = THREE.MathUtils;
const TAU = Math.PI * 2;

// ─────────────────────────────────────────────────────────────────────────────
// 1. CARREGAMENTO
//    Qualquer GLB com esqueleto Mixamo vira zumbi: os clipes Idle/Walk do
//    Soldier.glb são retargetados para o esqueleto e, por cima, uma camada de
//    pose procedural (agachado comendo, levantar, cambalear, ataque, reação a
//    tiro, morte) é aplicada em espaço de corpo — por isso funciona em modelos
//    com eixos de osso diferentes (SWAT, Michelle, Soldier ou um zumbi Mixamo).
// ─────────────────────────────────────────────────────────────────────────────

const loader = new GLTFLoader();
const gltfCache = new Map();
function loadGLB(url) {
  if (!gltfCache.has(url)) gltfCache.set(url, loader.loadAsync(url));
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

const modelCache = new Map();

export function loadZombieModel(def, locomotionUrl = '/models/character/Soldier.glb') {
  if (modelCache.has(def.url)) return modelCache.get(def.url);
  const promise = (async () => {
    const [gltf, locomotion] = await Promise.all([loadGLB(def.url), loadGLB(locomotionUrl)]);
    // Cada definição usa uma cópia própria da cena (a base é só modelo).
    const scene = cloneSkinned(gltf.scene);
    const targetHeight = def.height ?? 1.78;
    // Altura medida pelos vértices na pose de repouso (Box3.setFromObject erra em malhas com skin).
    scene.updateMatrixWorld(true);
    normalizeSkinning(scene);
    const info = bakeRestCoords(scene);
    if (!info) throw new Error(`[zombie] ${def.url} não tem esqueleto Mixamo (mixamorig:Hips, ...)`);
    const k = targetHeight / info.height;
    scene.scale.setScalar(k);
    scene.updateMatrixWorld(true);
    const hips = scene.getObjectByName('mixamorigHips').getWorldPosition(new THREE.Vector3());
    scene.position.set(-hips.x, -info.minY * k, -hips.z);
    scene.updateMatrixWorld(true);

    // Retarget (o personagem precisa estar sem rotação extra, como no player.js).
    const clips = {};
    const speeds = {};
    for (const name of ['Idle', 'Walk']) {
      const source = locomotion.animations.find((c) => c.name === name);
      if (!source) continue;
      try {
        const result = retargetMixamoClip(locomotion.scene, scene, source);
        clips[name.toLowerCase()] = result.clip;
        speeds[name.toLowerCase()] = result.groundSpeed * scene.scale.x;
      } catch (error) {
        console.warn(`[zombie] retarget de ${name} falhou para ${def.url}`, error);
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
    return { def, scene, clips, speeds, facing };
  })();
  modelCache.set(def.url, promise);
  return promise;
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. POSES (espaço de corpo: x = esquerda, y = cima, z = frente)
//    Cada osso: [pitch, yaw, roll] em radianos, aplicados NESTA ordem em eixos
//    do corpo, por cima do que o clipe base estiver fazendo.
//      pitch + : inclina para a frente (coluna) / levanta o braço para trás
//      yaw   + : gira à esquerda
//      roll  + : tomba para a direita do corpo (braço esquerdo abre para fora)
// ─────────────────────────────────────────────────────────────────────────────

const BONES = ['Hips', 'Spine', 'Spine1', 'Spine2', 'Neck', 'Head',
  'LeftShoulder', 'LeftArm', 'LeftForeArm', 'LeftHand',
  'RightShoulder', 'RightArm', 'RightForeArm', 'RightHand',
  'LeftUpLeg', 'LeftLeg', 'LeftFoot', 'RightUpLeg', 'RightLeg', 'RightFoot'];

const pose = (bones = {}, hips = [0, 0, 0]) => ({ bones, hips });

const POSE = {
  neutral: pose(),
  // Em pé cambaleando, braços para a frente, tronco curvado, cabeça caída.
  shamble: pose({
    Spine: [0.13, 0, 0], Spine1: [0.10, 0, 0], Spine2: [0.10, 0, 0],
    Neck: [0.10, 0, 0], Head: [0.12, 0, 0.18],
    LeftShoulder: [0, 0, 0.0], RightShoulder: [0, 0, 0.0],
    LeftArm: [-1.30, 0.10, 0.0], LeftForeArm: [-0.25, 0, 0], LeftHand: [0.25, 0, 0],
    RightArm: [-1.05, -0.12, 0.0], RightForeArm: [-0.05, 0, 0], RightHand: [0.40, 0, 0],
  }),
  // Parado de pé, desligado: braços pendurados, ombros caídos.
  stand: pose({
    Spine: [0.10, 0, 0], Spine1: [0.08, 0, 0], Spine2: [0.08, 0, 0],
    Neck: [0.14, 0, 0], Head: [0.20, 0, -0.22],
    LeftArm: [-0.10, 0, 0.08], RightArm: [0.05, 0, -0.04],
    LeftForeArm: [-0.2, 0, 0], RightForeArm: [-0.1, 0, 0],
  }),
  // Agachado sobre a vítima.
  feed: pose({
    Spine: [0.40, 0, 0], Spine1: [0.34, 0, 0], Spine2: [0.28, 0, 0],
    Neck: [0.25, 0, 0], Head: [0.42, 0, 0],
    LeftUpLeg: [-1.55, 0.30, 0], RightUpLeg: [-1.55, -0.30, 0],
    LeftLeg: [1.75, 0, 0], RightLeg: [1.75, 0, 0],
    LeftFoot: [-0.25, 0, 0], RightFoot: [-0.25, 0, 0],
    LeftArm: [-0.75, 0.15, 0.1], RightArm: [-0.75, -0.15, -0.1],
    LeftForeArm: [-0.55, 0, 0], RightForeArm: [-0.55, 0, 0],
    LeftHand: [0.3, 0, 0], RightHand: [0.3, 0, 0],
  }, [0, -0.44, -0.36]),
  // Desmoronando (joelhos dobram).
  collapse: pose({
    Spine: [-0.15, 0, 0], Spine1: [-0.12, 0, 0], Spine2: [-0.10, 0, 0],
    Neck: [-0.10, 0, 0], Head: [-0.15, 0, 0],
    LeftUpLeg: [-1.0, 0.25, 0], RightUpLeg: [-0.7, -0.25, 0],
    LeftLeg: [1.4, 0, 0], RightLeg: [1.1, 0, 0],
    LeftArm: [-0.2, 0, 0.8], RightArm: [-0.1, 0, -0.9],
    LeftForeArm: [-0.4, 0, 0], RightForeArm: [-0.3, 0, 0],
  }, [0, -0.40, -0.10]),
  // Caído no chão, de costas.
  lying: pose({
    Spine: [-0.05, 0, 0], Head: [-0.1, 0.35, 0.1],
    LeftUpLeg: [-0.12, 0.28, 0.1], RightUpLeg: [-0.05, -0.22, -0.1],
    LeftLeg: [0.18, 0, 0], RightLeg: [0.34, 0, 0],
    LeftArm: [-0.15, 0, 1.15], RightArm: [0.1, 0, -1.0],
    LeftForeArm: [-0.2, 0, 0], RightForeArm: [-0.45, 0, 0],
  }, [0, 0, 0]),
};

const emptyBones = () => Object.fromEntries(BONES.map((b) => [b, [0, 0, 0]]));

function blendPoses(a, b, w) {
  const out = { bones: {}, hips: [0, 0, 0] };
  for (const name of BONES) {
    const pa = a.bones[name] || [0, 0, 0], pb = b.bones[name] || [0, 0, 0];
    out.bones[name] = [lerp(pa[0], pb[0], w), lerp(pa[1], pb[1], w), lerp(pa[2], pb[2], w)];
  }
  for (let i = 0; i < 3; i++) out.hips[i] = lerp(a.hips[i], b.hips[i], w);
  return out;
}

function addTo(target, name, p, y = 0, r = 0) {
  const t = target.bones[name] || (target.bones[name] = [0, 0, 0]);
  t[0] += p; t[1] += y; t[2] += r;
}

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
// ─────────────────────────────────────────────────────────────────────────────

export function createZombieActor(model, look = {}, { castShadow = true } = {}) {
  const root = new THREE.Group();     // posição + yaw (controlado pela IA)
  const pivot = new THREE.Group();    // queda (pitch/roll) ao morrer
  const character = cloneSkinned(model.scene);
  character.quaternion.copy(model.facing);
  root.add(pivot); pivot.add(character);
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

  const mixer = new THREE.AnimationMixer(character);
  const actions = {};
  for (const [name, clip] of Object.entries(model.clips)) {
    const action = mixer.clipAction(clip);
    action.play(); action.setEffectiveWeight(name === 'idle' ? 1 : 0);
    action.time = (look.seed ?? 0) * 0.37 % clip.duration;
    actions[name] = action;
  }
  const walkSpeed = model.speeds.walk || 1.4;

  const rnd = (() => { let s = ((look.seed ?? 1) * 2654435761) >>> 0; return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296); })();
  const style = {
    leftArm: lerp(-0.25, 0.2, rnd()), rightArm: lerp(-0.45, 0.15, rnd()),
    headTilt: lerp(-0.3, 0.3, rnd()), lurch: lerp(0.8, 1.2, rnd()),
    phase: rnd() * TAU, bobRate: lerp(2.0, 2.8, rnd()),
  };

  // Estado de animação
  const A = {
    mode: 'stand', time: 0, riseDuration: 2.0,
    cur: { bones: emptyBones(), hips: [0, 0, 0] },
    speed: 0, walkW: 0, lungeT: -1, attackTime: 0,
    hit: { p: 0, r: 0, y: 0, vp: 0, vr: 0, vy: 0, limb: null, limbV: 0, limbX: 0 },
    death: null, hipsHold: null, baseY: 0,
  };
  A.cur.bones = emptyBones();

  // Matemática de espaço de corpo → mundo
  const wq = new THREE.Quaternion(), wqi = new THREE.Quaternion();
  const qa = new THREE.Quaternion(), qb = new THREE.Quaternion(), qc = new THREE.Quaternion();
  const pm = new THREE.Matrix4(), pp = new THREE.Vector3(), ps = new THREE.Vector3();
  const pq = new THREE.Quaternion(), pqi = new THREE.Quaternion();
  const AX = new THREE.Vector3(1, 0, 0), AY = new THREE.Vector3(0, 1, 0), AZ = new THREE.Vector3(0, 0, 1);

  function applyPoseLayer(p) {
    root.updateMatrixWorld(true);
    root.getWorldQuaternion(wq); wqi.copy(wq).invert();
    const hipsBone = bones.Hips;
    // Deslocamento do quadril (corpo → mundo → local do pai)
    if (p.hips[0] || p.hips[1] || p.hips[2]) {
      hipsBone.parent.updateWorldMatrix(true, false);
      hipsBone.getWorldPosition(pp);
      pp.add(ps.set(p.hips[0], p.hips[1], p.hips[2]).applyQuaternion(wq));
      hipsBone.position.copy(hipsBone.parent.worldToLocal(pp));
    }
    for (const name of BONES) {
      const bone = bones[name];
      if (!bone) continue;
      const v = p.bones[name];
      if (!v || (!v[0] && !v[1] && !v[2])) continue;
      bone.parent.updateWorldMatrix(true, false);
      pm.copy(bone.parent.matrixWorld).decompose(pp, pq, ps);
      pqi.copy(pq).invert();
      // D = Ryaw * Rpitch * Rroll em eixos do corpo; convertido para mundo.
      qa.setFromAxisAngle(AZ, v[2]); qb.setFromAxisAngle(AX, v[0]); qc.setFromAxisAngle(AY, v[1]);
      qc.multiply(qb).multiply(qa);
      qc.premultiply(wq).multiply(wqi);                                  // wq * D * wq^-1
      qa.copy(pq).multiply(bone.quaternion);                             // orientação atual no mundo
      qa.premultiply(qc);                                                // nova orientação
      bone.quaternion.copy(pqi).multiply(qa);
    }
    root.updateMatrixWorld(true);
  }

  // ── Alvos de pose por modo ──
  const tmp = { bones: {}, hips: [0, 0, 0] };
  function targetPose(dt) {
    const t = A.time;
    let target, rate = 7;
    const m = A.mode;
    if (m === 'feed') {
      target = blendPoses(POSE.feed, POSE.feed, 0);
      // mastigando: cabeça sobe e desce, braços puxando a carne
      const bob = Math.sin(t * style.bobRate * TAU * 0.5 + style.phase);
      const jerk = Math.max(0, Math.sin(t * 5.3 + style.phase * 2)) ** 3;
      addTo(target, 'Head', 0.34 * bob - 0.15 * jerk, 0.18 * Math.sin(t * 3.1 + style.phase), 0.08 * Math.sin(t * 2.3));
      addTo(target, 'Neck', 0.12 * bob);
      addTo(target, 'Spine1', 0.07 * bob);
      addTo(target, 'Spine2', 0.05 * bob);
      const pull = Math.sin(t * 2.1 + style.phase);
      addTo(target, 'LeftArm', -0.25 * pull, 0.12 * pull);
      addTo(target, 'RightArm', 0.25 * pull, -0.1 * pull);
      addTo(target, 'LeftForeArm', -0.35 * pull);
      addTo(target, 'RightForeArm', 0.3 * pull);
      target.hips[1] += 0.012 * Math.sin(t * 2.6);
      rate = 10;
    } else if (m === 'rise') {
      const e = clamp(t / A.riseDuration, 0, 1);
      // 0..0.25 cabeça levanta e para; 0.2..0.8 sobe o corpo; 0.7..1 braços sobem
      const body = smoothstep(e, 0.18, 0.85);
      target = blendPoses(POSE.feed, POSE.shamble, body);
      // braços só sobem depois que o corpo já está de pé
      const arms = smoothstep(e, 0.55, 1.0);
      const armPose = blendPoses(POSE.feed, POSE.shamble, Math.max(body * 0.4, arms));
      for (const n of ['LeftArm', 'RightArm', 'LeftForeArm', 'RightForeArm', 'LeftHand', 'RightHand']) target.bones[n] = armPose.bones[n];
      const snap = Math.exp(-Math.pow((e - 0.1) / 0.07, 2));
      addTo(target, 'Head', -0.75 * snap, 0.35 * snap, 0.15 * snap);
      addTo(target, 'Spine2', -0.1 * snap);
      addTo(target, 'Head', 0, 0.12 * Math.sin(t * 6), 0.1 * Math.sin(t * 4.3));
      rate = 60;
    } else if (m === 'dead' || m === 'corpse') {
      const d = A.death;
      const collapse = smoothstep(d.t, 0.0, 0.35);
      const lie = smoothstep(d.t, 0.55, 1.4);
      target = blendPoses(POSE.neutral, POSE.collapse, collapse);
      target = blendPoses(target, POSE.lying, lie);
      if (d.headshot) addTo(target, 'Head', -0.9 * Math.exp(-d.t * 2.2), d.side * 0.4);
      addTo(target, 'Head', 0, d.side * 0.5 * lie);
      rate = 25;
    } else {
      // stand / walk / attack: base cambaleante
      const walking = A.walkW;
      target = blendPoses(POSE.stand, POSE.shamble, A.mode === 'stand' ? 0 : 1);
      const phase = (actions.walk ? (actions.walk.time / actions.walk.getClip().duration) : t) * TAU;
      const sway = Math.sin(phase + style.phase);
      addTo(target, 'Spine1', 0, 0.16 * sway * walking, 0.04 * sway * walking);
      addTo(target, 'Spine2', 0, 0.12 * sway * walking);
      addTo(target, 'Head', 0.06 * Math.sin(t * 1.7), 0.2 * Math.sin(t * 0.9 + style.phase) + 0.1 * sway * walking,
        style.headTilt * 0.5 + 0.12 * Math.sin(t * 2.3));
      addTo(target, 'LeftArm', style.leftArm * walking * 0.4, 0, 0);
      addTo(target, 'RightArm', style.rightArm * walking * 0.4, 0, 0);
      addTo(target, 'LeftForeArm', 0.12 * sway * walking);
      addTo(target, 'RightForeArm', -0.12 * sway * walking);
      target.hips[2] += 0.0;
      addTo(target, 'Hips', 0, 0, 0.05 * sway * walking);
      if (A.mode === 'stand') {
        // oscila parado, de vez em quando um espasmo
        const twitch = Math.max(0, Math.sin(t * 0.7 + style.phase * 3)) ** 12;
        addTo(target, 'Head', 0.08 * twitch, 0.35 * twitch, 0.2 * twitch);
        addTo(target, 'Hips', 0, 0.05 * Math.sin(t * 0.5 + style.phase), 0.04 * Math.sin(t * 0.8));
      }
      if (A.mode === 'attack') {
        const a = A.lungeT;  // 0..1 ciclo
        // armar (0-.4) → bote (.4-.6) → recuar (.6-1)
        const lunge = a < 0.4 ? smoothstep(a, 0, 0.4) * 0.35 : (a < 0.6 ? lerp(0.35, 1, smoothstep(a, 0.4, 0.55)) : lerp(1, 0, smoothstep(a, 0.6, 1.0)));
        addTo(target, 'Spine', 0.22 * lunge);
        addTo(target, 'Spine1', 0.18 * lunge);
        addTo(target, 'Neck', 0.5 * lunge);
        addTo(target, 'Head', 0.35 * lunge - 0.5 * (a < 0.4 ? smoothstep(a, 0, 0.4) : 0) * 0.6);
        addTo(target, 'LeftArm', -0.4 * lunge, -0.35 * lunge);
        addTo(target, 'RightArm', -0.5 * lunge, 0.35 * lunge);
        addTo(target, 'LeftForeArm', -0.3 * lunge);
        addTo(target, 'RightForeArm', -0.3 * lunge);
        target.hips[2] += 0.28 * lunge;
        A.lunge = lunge;
        rate = 16;
      }
    }
    return { target, rate };
  }

  function smoothPose(target, rate, dt) {
    const k = 1 - Math.exp(-rate * dt);
    for (const name of BONES) {
      const c = A.cur.bones[name], g = target.bones[name] || [0, 0, 0];
      c[0] += (g[0] - c[0]) * k; c[1] += (g[1] - c[1]) * k; c[2] += (g[2] - c[2]) * k;
    }
    for (let i = 0; i < 3; i++) A.cur.hips[i] += (target.hips[i] - A.cur.hips[i]) * k;
  }

  // Reação ao tiro: mola amortecida no tronco/cabeça (+ membro atingido)
  function updateHitSpring(dt) {
    const h = A.hit;
    const K = 120, C = 9;
    h.vp += (-K * h.p - C * h.vp) * dt; h.p += h.vp * dt;
    h.vr += (-K * h.r - C * h.vr) * dt; h.r += h.vr * dt;
    h.vy += (-K * h.y - C * h.vy) * dt; h.y += h.vy * dt;
    h.limbV += (-90 * h.limbX - 8 * h.limbV) * dt; h.limbX += h.limbV * dt;
  }
  function withHit(p) {
    const h = A.hit;
    const out = { bones: { ...p.bones }, hips: p.hips.slice() };
    const add = (name, a, b, c) => { const v = (out.bones[name] || [0, 0, 0]).slice(); v[0] += a; v[1] += b; v[2] += c; out.bones[name] = v; };
    add('Spine', h.p * 0.35, h.y * 0.3, h.r * 0.3);
    add('Spine1', h.p * 0.5, h.y * 0.4, h.r * 0.4);
    add('Spine2', h.p * 0.6, h.y * 0.5, h.r * 0.5);
    add('Neck', h.p * 0.5, h.y * 0.5, h.r * 0.4);
    add('Head', h.p * 0.9, h.y * 0.9, h.r * 0.7);
    if (h.limb) {
      const side = h.limb.side, kind = h.limb.kind;
      if (kind === 'arm') { add(`${side}Arm`, h.limbX * 0.7, 0, side === 'Left' ? h.limbX * 0.6 : -h.limbX * 0.6); add(`${side}ForeArm`, h.limbX * 0.5, 0, 0); }
      if (kind === 'leg') { add(`${side}UpLeg`, -h.limbX * 0.5, 0, 0); add(`${side}Leg`, h.limbX * 0.5, 0, 0); out.hips[1] -= Math.abs(h.limbX) * 0.05; }
    }
    return out;
  }

  // ── API pública ──
  const api = {
    root, character, bones, state: A, style,
    walkGroundSpeed: walkSpeed,
    get mode() { return A.mode; },
    setMode(mode, opts = {}) {
      A.mode = mode; A.time = 0;
      if (mode === 'rise') A.riseDuration = opts.duration ?? 2.0;
      if (mode === 'attack') A.lungeT = 0;
    },
    // speed em m/s (0 = parado): controla a mistura Idle/Walk e a cadência dos passos
    setLocomotion(speed) { A.speed = speed; },
    startDeath({ headshot = false, fromFront = true, side = (Math.random() < 0.5 ? -1 : 1), instant = false } = {}) {
      A.mode = 'dead'; A.time = 0;
      root.updateMatrixWorld(true);
      const hp = bones.Hips.getWorldPosition(new THREE.Vector3());
      A.death = { t: instant ? 5 : 0, headshot, side, dir: fromFront ? -1 : 1, hipsXZ: hp, ground: 0 };
      A.baseY = root.position.y;
      if (instant) A.time = 99;
    },
    // Dano recebido: direção do projétil em coordenadas do corpo (z = para onde o zumbi olha)
    hitReaction(dirLocal, strength, limb = null) {
      const h = A.hit;
      h.vp += dirLocal.z * 7 * strength;      // tiro de frente (bala indo para -z do corpo) → tronco vai para trás
      h.vr += dirLocal.x * 6 * strength;
      h.vy += dirLocal.x * 4 * strength * (Math.random() < 0.5 ? -1 : 1);
      if (limb) { h.limb = limb; h.limbV += 7 * strength; }
    },
    get lunge() { return A.lunge || 0; },
    get attackProgress() { return A.lungeT; },
    update(dt) {
      A.time += dt;
      if (A.mode === 'attack') {
        A.lungeT += dt / 1.35;
        if (A.lungeT >= 1) A.lungeT = 1;
      }
      // Base (idle ↔ walk)
      const dead = A.mode === 'dead' || A.mode === 'corpse';
      if (actions.walk && actions.idle) {
        const target = dead || A.mode === 'feed' || A.mode === 'rise' ? 0 : clamp(A.speed / 0.25, 0, 1);
        A.walkW += (target - A.walkW) * (1 - Math.exp(-8 * dt));
        actions.walk.setEffectiveWeight(A.walkW);
        actions.idle.setEffectiveWeight(1 - A.walkW);
        const lurch = 0.75 + 0.5 * Math.max(0, Math.sin(A.time * 1.9 * style.lurch + style.phase)) ** 2;
        actions.walk.timeScale = A.speed > 0.05 ? (A.speed / walkSpeed) * (A.mode === 'chase' ? 1 : lurch) : 0;
        actions.idle.timeScale = A.mode === 'feed' ? 0.2 : 0.55;
      }
      mixer.update(dead ? 0 : dt);

      let { target, rate } = targetPose(dt);
      if (!dead) {
        smoothPose(target, rate, dt);
        updateHitSpring(dt);
      } else {
        smoothPose(target, rate, dt);
      }
      const finalPose = withHit({ bones: A.cur.bones, hips: A.cur.hips });

      // Queda
      if (dead && A.death) {
        const d = A.death;
        d.t += dt;
        const fall = Math.pow(smoothstep(d.t, 0.18, 0.95), 1.6);
        pivot.rotation.set(d.dir * fall * Math.PI * 0.5, 0, d.side * fall * 0.3);
      }
      applyPoseLayer(finalPose);

      if (dead && A.death) {
        // mantém o quadril no lugar e apoia o corpo no chão
        const d = A.death;
        const hp = bones.Hips.getWorldPosition(pp);
        root.position.x += d.hipsXZ.x - hp.x; root.position.z += d.hipsXZ.z - hp.z;
        let minY = Infinity;
        for (const name of BONES) { const b = bones[name]; if (b) { b.getWorldPosition(ps); minY = Math.min(minY, ps.y); } }
        root.position.y += (A.baseY + 0.075 - minY);
        root.updateMatrixWorld(true);
      }
    },
  };
  return api;
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. HITBOXES
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

const _p = {};
const _tmpA = new THREE.Vector3(), _tmpB = new THREE.Vector3();
export function raycastActor(actor, origin, dir, maxDistance = 50) {
  const b = actor.bones;
  actor.root.updateMatrixWorld(true);
  const wp = (name) => (_p[name] = (_p[name] || new THREE.Vector3())).copy(b[name].getWorldPosition(_tmpA));
  const P = {};
  for (const name of ['Hips', 'Spine1', 'Spine2', 'Neck', 'Head', 'HeadTop_End',
    'LeftArm', 'LeftForeArm', 'LeftHand', 'RightArm', 'RightForeArm', 'RightHand',
    'LeftUpLeg', 'LeftLeg', 'LeftFoot', 'RightUpLeg', 'RightLeg', 'RightFoot']) {
    if (b[name]) P[name] = new THREE.Vector3().copy(b[name].getWorldPosition(_tmpA));
  }
  let best = null;
  const test = (t, zone, extra = {}) => {
    if (t >= 0 && t <= maxDistance && (!best || t < best.t)) best = { t, zone, ...extra };
  };
  if (P.Head) {
    // Centro do crânio: meio entre Head e HeadTop_End; sem esse osso, projeta ~10 cm na direção pescoço→cabeça.
    const c = P.HeadTop_End
      ? new THREE.Vector3().copy(P.Head).add(P.HeadTop_End).multiplyScalar(0.5)
      : new THREE.Vector3().copy(P.Head).addScaledVector((P.Neck ? new THREE.Vector3().subVectors(P.Head, P.Neck) : new THREE.Vector3(0, 1, 0)).normalize(), 0.10);
    const r = P.HeadTop_End ? Math.max(0.12, P.Head.distanceTo(P.HeadTop_End) * 0.5 + 0.035) : 0.145;
    test(raySphere(origin, dir, c, r), 'head');
  }
  if (P.Neck && P.Head) test(rayCapsule(origin, dir, P.Neck, P.Head, 0.058), 'neck');
  if (P.Spine1 && P.Neck) test(rayCapsule(origin, dir, P.Spine1, P.Neck, 0.17), 'chest');
  if (P.Hips && P.Spine1) test(rayCapsule(origin, dir, P.Hips, P.Spine1, 0.16), 'abdomen');
  for (const side of ['Left', 'Right']) {
    const limb = { kind: 'arm', side };
    if (P[`${side}Arm`] && P[`${side}ForeArm`]) test(rayCapsule(origin, dir, P[`${side}Arm`], P[`${side}ForeArm`], 0.065), 'arm', { limb });
    if (P[`${side}ForeArm`] && P[`${side}Hand`]) test(rayCapsule(origin, dir, P[`${side}ForeArm`], P[`${side}Hand`], 0.058), 'arm', { limb });
    const leg = { kind: 'leg', side };
    if (P[`${side}UpLeg`] && P[`${side}Leg`]) test(rayCapsule(origin, dir, P[`${side}UpLeg`], P[`${side}Leg`], 0.095), 'leg', { limb: leg });
    if (P[`${side}Leg`] && P[`${side}Foot`]) test(rayCapsule(origin, dir, P[`${side}Leg`], P[`${side}Foot`], 0.07), 'leg', { limb: leg });
  }
  if (!best) return null;
  best.point = origin.clone().addScaledVector(dir, best.t);
  return best;
}
