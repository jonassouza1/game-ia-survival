import * as THREE from 'three';

// Retarget de clipes Mixamo entre dois esqueletos com nomes iguais, mas com
// orientações de osso (rest pose) e escala diferentes.
//
// Por que não basta copiar os quaternions locais:
//   um quaternion local de animação é "rotação de repouso do osso + movimento".
//   Se o esqueleto de origem tem outro eixo local (ex.: Soldier.glb é Z-up, em
//   centímetros, e olha para -Z; o SWAT é Y-up, em metros, e olha para +Z), o
//   mesmo número gira o osso do alvo em torno de um eixo errado. Nas pernas isso
//   vira uma torção de 180° em relação à pelve e o quadril "afina" e distorce.
//
// O que fazemos aqui:
//   1. Para cada osso, calculamos o movimento da origem em ESPAÇO-MUNDO relativo
//      ao repouso:   delta = mundo(t) * mundo(repouso)^-1
//   2. Giramos esse delta para o referencial do alvo (correção de 180° quando
//      os dois olham para lados opostos).
//   3. Aplicamos no repouso do alvo e convertemos de volta para rotação local.
//   4. O deslocamento do quadril (Hips) é convertido de cm→m e escalado pela
//      proporção de altura entre os dois personagens.
//
// Premissa: os dois esqueletos têm a mesma pose de repouso (T-pose Mixamo).

const HIPS = 'mixamorigHips';
const UPLEG_L = 'mixamorigLeftUpLeg';
const UPLEG_R = 'mixamorigRightUpLeg';
const FOOT_L = 'mixamorigLeftFoot';
const FOOT_R = 'mixamorigRightFoot';

const UP = new THREE.Vector3(0, 1, 0);

// O retarget precisa partir da pose de bind (T-pose). Se o mixer já animou o
// personagem (o Soldier.glb carrega depois do SWAT), os ossos estariam no idle.
function toBindPose(root) {
  // O SWAT tem skins separados (cabeça com 7 ossos, corpo com 51): os menores vão
  // primeiro para o skin do corpo, que contém a coluna inteira, ter a palavra final.
  const skeletons = new Set();
  root.traverse((object) => { if (object.isSkinnedMesh && object.skeleton) skeletons.add(object.skeleton); });
  [...skeletons].sort((a, b) => a.bones.length - b.bones.length).forEach((skeleton) => skeleton.pose());
  root.updateMatrixWorld(true);
}

function bonesByName(root) {
  const out = {};
  root.traverse((object) => { if (object.isBone) out[object.name] = object; });
  return out;
}

// Transformação de cada osso relativa à raiz do modelo (ignora a escala/posição
// que o jogo aplica depois no personagem).
function snapshot(root, bones) {
  root.updateMatrixWorld(true);
  const inverse = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const matrix = new THREE.Matrix4();
  const scale = new THREE.Vector3();
  const state = {};
  for (const [name, bone] of Object.entries(bones)) {
    matrix.multiplyMatrices(inverse, bone.matrixWorld);
    const entry = { q: new THREE.Quaternion(), p: new THREE.Vector3() };
    matrix.decompose(entry.p, entry.q, scale);
    state[name] = entry;
  }
  return state;
}

function relativeMatrix(root, object) {
  root.updateMatrixWorld(true);
  return new THREE.Matrix4()
    .copy(root.matrixWorld).invert()
    .multiply(object.matrixWorld);
}

function lateralYaw(rest) {
  const v = rest[UPLEG_L].p.clone().sub(rest[UPLEG_R].p);
  return Math.atan2(v.x, v.z);
}

function median(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

/**
 * @param {THREE.Object3D} sourceRoot  cena do GLB de origem (ex.: Soldier.glb)
 * @param {THREE.Object3D} targetRoot  cena do GLB do personagem (ex.: swat.glb)
 * @param {THREE.AnimationClip} clip   clipe da origem
 * @param {boolean} [opts.inPlace] remove o avanço linear do quadril (clipes exportados com "root motion")
 * @returns {{ clip: THREE.AnimationClip, groundSpeed: number, strikePhase: number, info: object }}
 *   groundSpeed: velocidade (unidades do rig do alvo / s) em que os pés não escorregam
 *   strikePhase: fase [0..1) do ciclo em que o pé esquerdo está mais à frente
 */
export function retargetMixamoClip(sourceRoot, targetRoot, clip, { fps = 30, groundFix = true, inPlace = false } = {}) {
  toBindPose(sourceRoot);
  toBindPose(targetRoot);
  const sBones = bonesByName(sourceRoot);
  const tBones = bonesByName(targetRoot);
  if (!sBones[HIPS] || !tBones[HIPS]) throw new Error('retarget: esqueleto Mixamo sem Hips.');

  const sRest = snapshot(sourceRoot, sBones);
  const tRest = snapshot(targetRoot, tBones);

  // Guarda o repouso local para restaurar no fim (os dois rigs são usados só como dados).
  const saveLocal = (bones) => Object.fromEntries(Object.entries(bones).map(([n, b]) =>
    [n, { q: b.quaternion.clone(), p: b.position.clone() }]));
  const sLocal = saveLocal(sBones);
  const tLocal = saveLocal(tBones);

  // Correção de orientação entre os dois rigs (rotação em Y).
  const qC = new THREE.Quaternion().setFromAxisAngle(UP, lateralYaw(tRest) - lateralYaw(sRest));
  const qCInv = qC.clone().invert();
  // Proporção do quadril: converte o deslocamento do Hips da origem para o alvo.
  const hipsScale = tRest[HIPS].p.y / sRest[HIPS].p.y;
  // "Frente" do alvo no plano horizontal.
  const forward = new THREE.Vector3().subVectors(tRest[UPLEG_L].p, tRest[UPLEG_R].p);
  forward.y = 0; forward.normalize().cross(UP);

  // Interpoladores do clipe de origem (rotação de todos os ossos + posição do Hips).
  const quatSamplers = {};
  let hipsSampler = null;
  for (const track of clip.tracks) {
    const dot = track.name.lastIndexOf('.');
    if (dot < 0) continue;
    const node = track.name.slice(0, dot);
    const property = track.name.slice(dot + 1);
    if (property === 'quaternion' && sBones[node]) quatSamplers[node] = track.createInterpolant();
    else if (property === 'position' && node === HIPS) hipsSampler = track.createInterpolant();
  }

  // Ossos do alvo em ordem pai→filho.
  const order = [];
  targetRoot.traverse((object) => { if (object.isBone) order.push(object); });
  const mapped = new Set(order.filter((bone) => sBones[bone.name]).map((bone) => bone.name));

  const hipsParent = tBones[HIPS].parent;
  const hipsParentRel = relativeMatrix(targetRoot, hipsParent);
  const hipsParentInv = hipsParentRel.clone().invert();
  const parentRestQ = new Map();
  for (const bone of order) {
    if (bone.parent && !bone.parent.isBone) {
      const rel = relativeMatrix(targetRoot, bone.parent);
      parentRestQ.set(bone.parent, new THREE.Quaternion().setFromRotationMatrix(rel));
    }
  }

  const frames = Math.max(1, Math.round(clip.duration * fps));
  const times = new Float32Array(frames + 1);

  // inPlace: deslocamento horizontal total do quadril ao longo do clipe (será removido de forma linear).
  const travel = new THREE.Vector3();
  if (inPlace && hipsSampler) {
    const at = (t) => {
      sBones[HIPS].position.fromArray(hipsSampler.evaluate(t));
      sourceRoot.updateMatrixWorld(true);
      return new THREE.Vector3().setFromMatrixPosition(new THREE.Matrix4().multiplyMatrices(new THREE.Matrix4().copy(sourceRoot.matrixWorld).invert(), sBones[HIPS].matrixWorld));
    };
    travel.copy(at(clip.duration)).sub(at(0));
    travel.y = 0;
    sBones[HIPS].position.copy(sLocal[HIPS].p);
  }
  const quatValues = {};
  for (const name of mapped) quatValues[name] = new Float32Array((frames + 1) * 4);
  const hipsWorld = [];
  const footL = [];
  const footR = [];

  const sInv = new THREE.Matrix4().copy(sourceRoot.matrixWorld).invert();
  const matrix = new THREE.Matrix4();
  const scale = new THREE.Vector3();
  const sQ = new THREE.Quaternion();
  const sP = new THREE.Vector3();
  const delta = new THREE.Quaternion();
  const world = new THREE.Quaternion();
  const local = new THREE.Quaternion();
  const parentInv = new THREE.Quaternion();
  const tWorldQ = {};
  const previous = {};

  for (let i = 0; i <= frames; i++) {
    const t = (i / frames) * clip.duration;
    times[i] = t;

    // Pose da origem neste instante.
    for (const [name, sampler] of Object.entries(quatSamplers)) {
      sBones[name].quaternion.fromArray(sampler.evaluate(t));
    }
    if (hipsSampler) sBones[HIPS].position.fromArray(hipsSampler.evaluate(t));
    sourceRoot.updateMatrixWorld(true);

    // Alvo: rotação mundial = (delta da origem girado para o alvo) * repouso do alvo.
    for (const bone of order) {
      const parentQ = tWorldQ[bone.parent?.name] ?? parentRestQ.get(bone.parent) ?? new THREE.Quaternion();
      if (mapped.has(bone.name)) {
        matrix.multiplyMatrices(sInv, sBones[bone.name].matrixWorld);
        matrix.decompose(sP, sQ, scale);
        delta.copy(sRest[bone.name].q).invert().premultiply(sQ);   // Ws * Ws0^-1
        delta.premultiply(qC).multiply(qCInv);                      // C * delta * C^-1
        world.copy(tRest[bone.name].q).premultiply(delta);          // delta * Wt0
        parentInv.copy(parentQ).invert();
        local.copy(world).premultiply(parentInv);
        const prev = previous[bone.name];
        if (prev && prev.dot(local) < 0) { local.x *= -1; local.y *= -1; local.z *= -1; local.w *= -1; }
        previous[bone.name] = (prev ?? new THREE.Quaternion()).copy(local);
        local.toArray(quatValues[bone.name], i * 4);
        tWorldQ[bone.name] = world.clone();
      } else {
        tWorldQ[bone.name] = parentQ.clone().multiply(bone.quaternion);
      }
    }

    // Quadril: deslocamento da origem (cm→m via escala do rig) * proporção, girado para o alvo.
    matrix.multiplyMatrices(sInv, sBones[HIPS].matrixWorld);
    matrix.decompose(sP, sQ, scale);
    sP.sub(sRest[HIPS].p);
    if (inPlace) sP.addScaledVector(travel, -(i / frames));        // tira o avanço linear, mantém o balanço
    const offset = sP.applyQuaternion(qC).multiplyScalar(hipsScale);
    hipsWorld.push(tRest[HIPS].p.clone().add(offset));

    // Aplica a pose calculada no alvo só para medir posição dos pés (FK exata).
    for (const name of mapped) tBones[name].quaternion.fromArray(quatValues[name], i * 4);
    tBones[HIPS].position.copy(hipsWorld[i]).applyMatrix4(hipsParentInv);
    targetRoot.updateMatrixWorld(true);
    const foot = (name, list) => {
      matrix.multiplyMatrices(new THREE.Matrix4().copy(targetRoot.matrixWorld).invert(), tBones[name].matrixWorld);
      list.push(new THREE.Vector3().setFromMatrixPosition(matrix));
    };
    foot(FOOT_L, footL);
    foot(FOOT_R, footR);
  }

  // Altura: garante que o pé de apoio toque o chão (compensa diferença de proporção das pernas).
  let groundShift = 0;
  if (groundFix) {
    const restFoot = Math.min(tRest[FOOT_L].p.y, tRest[FOOT_R].p.y);
    const lowest = Math.min(...footL.map((p) => p.y), ...footR.map((p) => p.y));
    groundShift = restFoot - lowest;
    for (let i = 0; i <= frames; i++) {
      hipsWorld[i].y += groundShift;
      footL[i].y += groundShift;
      footR[i].y += groundShift;
    }
  }

  const hipsValues = new Float32Array((frames + 1) * 3);
  const tmp = new THREE.Vector3();
  for (let i = 0; i <= frames; i++) tmp.copy(hipsWorld[i]).applyMatrix4(hipsParentInv).toArray(hipsValues, i * 3);

  // Velocidade em que o pé de apoio fica parado no chão: v = -d(posição do pé)/dt durante o apoio.
  const dt = clip.duration / frames;
  const restHeight = tRest[HIPS].p.y;
  const minL = Math.min(...footL.map((p) => p.y));
  const minR = Math.min(...footR.map((p) => p.y));
  const samples = [];
  for (let i = 0; i < frames; i++) {
    for (const [feet, min] of [[footL, minL], [footR, minR]]) {
      const height = Math.max(feet[i].y, feet[i + 1].y) - min;
      if (height > restHeight * 0.04) continue; // fora do apoio
      samples.push(-(feet[i + 1].clone().sub(feet[i]).dot(forward)) / dt);
    }
  }
  const groundSpeed = median(samples);

  // Fase em que o pé esquerdo está mais à frente (para sincronizar caminhada e corrida).
  const reach = footL.slice(0, frames).map((p) => p.dot(forward));
  let best = 0;
  reach.forEach((value, i) => { if (value > reach[best]) best = i; });
  const a = reach[(best - 1 + frames) % frames];
  const b = reach[best];
  const c = reach[(best + 1) % frames];
  const curvature = a - 2 * b + c;
  const refine = Math.abs(curvature) > 1e-9 ? 0.5 * (a - c) / curvature : 0;
  const strikePhase = (((best + refine) / frames) % 1 + 1) % 1;

  // Restaura os dois rigs.
  for (const [name, saved] of Object.entries(sLocal)) { sBones[name].quaternion.copy(saved.q); sBones[name].position.copy(saved.p); }
  for (const [name, saved] of Object.entries(tLocal)) { tBones[name].quaternion.copy(saved.q); tBones[name].position.copy(saved.p); }
  sourceRoot.updateMatrixWorld(true);
  targetRoot.updateMatrixWorld(true);

  const tracks = [];
  for (const name of mapped) tracks.push(new THREE.QuaternionKeyframeTrack(`${name}.quaternion`, times, quatValues[name]));
  tracks.push(new THREE.VectorKeyframeTrack(`${HIPS}.position`, times, hipsValues));

  return {
    clip: new THREE.AnimationClip(clip.name, clip.duration, tracks),
    groundSpeed,
    strikePhase,
    info: { frames, hipsScale, rootSpeed: travel.clone().applyQuaternion(qC).length() * hipsScale / clip.duration, groundShift, yawCorrection: THREE.MathUtils.radToDeg(lateralYaw(tRest) - lateralYaw(sRest)) },
  };
}
