import * as THREE from 'three';
import { loadZombieModel, createZombieActor } from '../enemies/zombieRig.js';
import { MODELS } from '../enemies/roster.js';

/**
 * Corpos do hospital feitos com os MESMOS personagens (e animações) dos zumbis do jogo, em vez de caixas.
 *
 *  - deitados: o último quadro dos clipes de morte do Mixamo (\"death\" = de costas, \"dying\" = desabou);
 *  - sentados: uma pose montada nos ossos do esqueleto Mixamo (pernas esticadas, cabeça caída).
 *
 * O corpo fica congelado na pose (o mixer nunca mais é atualizado) e é só decoração: a colisão e o sangue
 * continuam sendo registrados por quem chama (hospital.js).
 *
 * Convenção de orientação (igual à peça procedural antiga): a CABEÇA aponta para -Z local e `ry` gira o corpo
 * em torno do seu centro; sentado, as COSTAS ficam voltadas para -Z local e o corpo \"olha\" para +Z.
 */

// Quem veste o quê: as 3 malhas de zumbi do jogo, com a roupa repintada por pose/cor (ver zombieAppearance.js).
const CAST = ['prisoner', 'zombieGirl', 'copZombie'];
// Palidez e sangue de VÍTIMA (menos que um zumbi): o sangue se concentra em boca, peito e mãos.
const VICTIM_LOOK = { decay: 0.3, blood: 0.55, skin: 0xb4bea0 };

const _box = new THREE.Box3();
const _v = new THREE.Vector3();

// Gira `bone` por `deltas` = [pitch, yaw, roll] nos eixos do CORPO (x = esquerda, y = cima, z = frente),
// por cima da orientação atual — mesma convenção da camada de reação a tiro do zombieRig.
function poseBones(actor, deltas) {
  const { root, bones } = actor;
  const wq = new THREE.Quaternion(), wqi = new THREE.Quaternion();
  const pq = new THREE.Quaternion(), pqi = new THREE.Quaternion(), ps = new THREE.Vector3(), pp = new THREE.Vector3();
  const qa = new THREE.Quaternion(), qb = new THREE.Quaternion(), qc = new THREE.Quaternion(), qd = new THREE.Quaternion();
  const X = new THREE.Vector3(1, 0, 0), Y = new THREE.Vector3(0, 1, 0), Z = new THREE.Vector3(0, 0, 1);
  const bodyQ = new THREE.Quaternion();
  actor.character.getWorldQuaternion(bodyQ);          // o corpo olha para +Z do personagem
  root.updateMatrixWorld(true);
  wq.copy(bodyQ); wqi.copy(wq).invert();
  for (const [name, [pitch, yaw, roll]] of Object.entries(deltas)) {
    const bone = bones[name];
    if (!bone) continue;
    bone.parent.updateWorldMatrix(true, false);
    new THREE.Matrix4().copy(bone.parent.matrixWorld).decompose(pp, pq, ps);
    pqi.copy(pq).invert();
    qa.setFromAxisAngle(Z, roll); qb.setFromAxisAngle(X, pitch); qc.setFromAxisAngle(Y, yaw);
    qd.copy(qc).multiply(qb).multiply(qa);
    qd.premultiply(wq).multiply(wqi);
    qa.copy(pq).multiply(bone.quaternion);
    qa.premultiply(qd);
    bone.quaternion.copy(pqi).multiply(qa);
    root.updateMatrixWorld(true);
  }
}

// Devolve os ossos do ator à pose de repouso (T-pose) copiando a cena-base do modelo.
function restorePose(actor, model) {
  const source = new Map();
  model.scene.traverse((o) => { if (o.isBone) source.set(o.name, o); });
  actor.character.traverse((o) => {
    const s = o.isBone ? source.get(o.name) : null;
    if (s) { o.position.copy(s.position); o.quaternion.copy(s.quaternion); o.scale.copy(s.scale); }
  });
  actor.root.updateMatrixWorld(true);
}

// Caixa envolvente PRECISA (vértices já deformados pelos ossos). setFromObject(…, true) aplica o skin.
function preciseBounds(root) {
  root.updateMatrixWorld(true);
  root.traverse((o) => { if (o.isSkinnedMesh) { o.skeleton.update(); } });
  return _box.setFromObject(root, true).clone();
}

// Altura (y do mundo) abaixo da qual ficam `p` dos vértices já deformados pelos ossos. Serve para apoiar o corpo no chão
// pelo conjunto (costas, pélvis) e não só pelo ponto mais baixo (dedo, calcanhar), que deixava o tronco no ar.
function lowPercentileY(root, p) {
  root.updateMatrixWorld(true);
  const ys = [], v = new THREE.Vector3();
  root.traverse((m) => {
    if (!m.isSkinnedMesh) return;
    m.skeleton.update();
    const n = m.geometry.attributes.position.count;
    for (let i = 0; i < n; i += 2) { m.getVertexPosition(i, v); v.applyMatrix4(m.matrixWorld); ys.push(v.y); }
  });
  ys.sort((a, b) => a - b);
  return ys[Math.floor(p * (ys.length - 1))];
}

const POSES = {
  // Sentado no chão, de costas para a parede: pernas esticadas à frente, tronco caído, cabeça no peito.
  sitting: {
    Hips: [0, 0, 0],
    // Coxas e canelas na HORIZONTAL (-π/2): assim a pélvis e os calcanhares apoiam no chão ao mesmo tempo.
    // (Antes as coxas desciam ~7° e as canelas mais 14°, e a pélvis ficava ~20 cm no ar.)
    LeftUpLeg: [-1.5708, -0.12, 0], RightUpLeg: [-1.5708, 0.12, 0],
    LeftLeg: [0.03, 0, 0], RightLeg: [0.06, 0, 0],
    LeftFoot: [0.35, 0, 0], RightFoot: [0.3, 0, 0],
    Spine: [0.05, 0, 0.05], Spine1: [0.07, 0, 0.05], Spine2: [0.06, 0, 0.04],
    Neck: [0.35, 0, 0.12], Head: [0.45, 0, 0.18],
    LeftArm: [0.1, 0, -1.32], RightArm: [0.1, 0, 1.32],
    LeftForeArm: [0.55, 0, 0], RightForeArm: [0.35, 0, 0],
  },
};

export function createBodyKit(parent) {
  let counter = 0;
  const models = new Map();
  const loadModel = (key) => {
    if (!models.has(key)) models.set(key, loadZombieModel(MODELS[key]));
    return models.get(key);
  };

  /**
   * @param {object} o
   *   x, y, z  : posição do centro do corpo (y = altura da superfície onde ele fica)
   *   ry       : giro (veja a convenção no topo)
   *   pose     : 'back' (de costas) | 'slumped' (desabado) | 'sitting'
   *   cloth    : cor (hex) da roupa; omitido = roupa original do personagem
   *   model    : 'prisoner' | 'zombieGirl' | 'copZombie' (omitido = revezamento)
   *   seed     : variação do sangue/sujeira
   * @returns {Promise<THREE.Group|null>}
   */
  async function add(o) {
    const n = counter++;
    const key = o.model ?? CAST[n % CAST.length];
    const model = await loadModel(key);
    const look = { ...VICTIM_LOOK, seed: 40 + n * 7 + (o.seed ?? 0) };
    if (o.cloth !== undefined) look.cloth = o.cloth;
    const actor = createZombieActor(model, look, { castShadow: true });

    if (o.pose === 'sitting') {
      // Parte do T-pose de repouso: a cena-base do modelo nunca é animada, então os ossos dela são a referência
      // (o ator termina de ser criado com os ossos numa pose de medição qualquer).
      // O ângulo certo das coxas depende do esqueleto de cada modelo. Procura (bisseção) a inclinação em que o tornozelo
      // fica na mesma altura do quadril: assim a pélvis e os calcanhares apoiam juntos no chão, sem o corpo pairar.
      const sit = (lift) => {
        restorePose(actor, model);
        poseBones(actor, { ...POSES.sitting, LeftUpLeg: [-1.5708 + lift, -0.12, 0], RightUpLeg: [-1.5708 + lift, 0.12, 0] });
        const y = (name) => actor.bones[name].getWorldPosition(_v).y;
        return (y('LeftFoot') + y('RightFoot')) / 2 - y('Hips');
      };
      let lo = -0.6, hi = 0.6;
      for (let i = 0; i < 16; i++) { const mid = (lo + hi) / 2; if (sit(mid) > 0) lo = mid; else hi = mid; }
      sit((lo + hi) / 2);
    } else {
      actor.startDeath({ headshot: o.pose === 'back', fromFront: false, instant: true });
    }

    // Normaliza: cabeça para -Z (deitado) e o centro do corpo na origem do `holder`, apoiado em y = 0.
    actor.root.updateMatrixWorld(true);
    if (o.pose !== 'sitting') {
      const hips = actor.bones.Hips.getWorldPosition(new THREE.Vector3());
      const head = actor.bones.Head.getWorldPosition(new THREE.Vector3());
      const angle = Math.atan2(head.x - hips.x, head.z - hips.z);     // direção quadril → cabeça, medida a partir de +Z
      actor.root.rotation.y = Math.PI - angle;                          // gira até a cabeça apontar para -Z
    }
    const b = preciseBounds(actor.root);
    const c = b.getCenter(new THREE.Vector3());
    // Chão: percentil baixo dos vértices (no máximo 8 cm acima do ponto mais baixo; o resto afunda no piso/colchão).
    const ground = Math.min(lowPercentileY(actor.root, 0.04), b.min.y + 0.08);
    actor.root.position.x -= c.x; actor.root.position.y -= ground;
    // Deitado: o centro do corpo fica na origem. Sentado: as COSTAS ficam na origem (z = 0), o corpo se estende
    // para +Z — assim basta posicionar na parede e girar para ela.
    actor.root.position.z -= o.pose === 'sitting' ? b.min.z : c.z;

    const holder = new THREE.Group();
    holder.name = `corpo_${o.pose}`;
    holder.position.set(o.x, o.y ?? 0, o.z);
    holder.rotation.y = o.ry ?? 0;
    holder.add(actor.root);
    holder.updateMatrixWorld(true);
    actor.root.traverse((m) => {
      if (!m.isMesh) return;
      m.castShadow = true; m.receiveShadow = true;
      // O corpo é estático: com a pose final já calculada, a esfera de culling vale e poupa desenho fora da tela.
      m.frustumCulled = true;
      if (m.isSkinnedMesh) { m.boundingSphere = null; m.boundingBox = null; m.computeBoundingSphere(); m.computeBoundingBox(); }
    });
    holder.matrixAutoUpdate = false; holder.updateMatrix();
    parent.add(holder);
    return holder;
  }

  return { add };
}
