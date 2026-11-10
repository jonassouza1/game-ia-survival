import * as THREE from 'three';

// Pistola do coldre do próprio uniforme do SWAT (nó "Soldier_pistol" do swat.glb,
// extraído por tools/split-holster-pistol.mjs).
//
// Ideia central: a pistola vive no coldre, presa ao osso da coxa. Enquanto o jogador
// não mira, ela é só um filho do osso (anda e corre junto com a perna, sem nenhum
// cálculo). Ao mirar, o personagem SACA: a pistola vai para as mãos; ao parar de
// mirar, GUARDA de volta.
//
// Tudo é função de UM escalar, `draw` (0 = no coldre, 1 = mirando). Guardar é o mesmo
// movimento tocado ao contrário, então inverter no meio do saque funciona sem estados.
//
//   0.00 – 0.26  a mão direita alcança a coronha no coldre (IK entra, dedos fecham)
//   0.26 – 0.46  puxa a arma para fora do coldre, ao longo do próprio cano
//   0.46 – 0.72  gira o cano para a frente e traz ao peito (posição "pronta")
//   0.55 – 0.85  a mão esquerda chega à coronha (empunhadura de duas mãos)
//   0.66 – 1.00  estende os braços até a posição de mira
//
// A arma é presa RIGIDAMENTE à mão: quem sofre IK é a mão, e o punho gira para casar
// com a coronha. Por isso não existe mais "arma que não encaixa na mão".
//
// Referencial da pistola (unidades do rig): origem no centro da coronha,
// +Z = boca do cano, +Y = massa de mira (para cima), +X = lado esquerdo da arma.

const { clamp, lerp, smoothstep } = THREE.MathUtils;

// ── Ajustes ─────────────────────────────────────────────────────────────────────
export const SIDEARM = {
  drawTime: 0.50,      // s para sacar (0 → 1)
  holsterTime: 0.45,   // s para guardar (1 → 0)
  holdBeforeHolster: 0.18, // s com a arma fora depois de parar de mirar
  reloadTime: 2.15,
  pullOut: 0.19,       // m puxados ao longo do cano para sair do coldre
  muzzle: new THREE.Vector3(0, 0.09, 0.222),
  // Punho (osso da mão) no referencial da pistola.
  wristRight: new THREE.Vector3(-0.034, 0.015, -0.065),
  wristLeft: new THREE.Vector3(0.036, -0.005, -0.057),
  // Aperto da mão: rotação em torno do X local de cada falange (flexão), em rad.
  curlGrip: { Index: [0.30, 0.40, 0.20], Middle: [1.05, 1.55, 0.80], Ring: [1.10, 1.55, 0.80], Pinky: [1.15, 1.50, 0.80], Thumb: [0.0, 0.15, 0.15] },
  curlSupport: { Index: [1.00, 1.40, 0.70], Middle: [1.00, 1.50, 0.70], Ring: [1.05, 1.50, 0.70], Pinky: [1.10, 1.50, 0.70], Thumb: [0.0, 0.15, 0.15] },
};

const UP = new THREE.Vector3(0, 1, 0);
const AXIS_X = new THREE.Vector3(1, 0, 0);
const AXIS_Y = new THREE.Vector3(0, 1, 0);
const FINGERS = ['Index', 'Middle', 'Ring', 'Pinky', 'Thumb'];

// Orientação do osso da mão no referencial da pistola. Nos ossos Mixamo da mão, o
// eixo local Y vai ao longo dos dedos, Z sai da palma e X é o eixo de flexão.
// Mão direita: dedos para a frente, palma voltada para a pistola, polegar para cima.
const handQuat = (x, y, z) => new THREE.Quaternion().setFromRotationMatrix(
  new THREE.Matrix4().makeBasis(new THREE.Vector3(...x), new THREE.Vector3(...y), new THREE.Vector3(...z)),
);
const HAND_R_IN_GUN = handQuat([0, 1, 0], [0, 0, 1], [1, 0, 0]);
const HAND_L_IN_GUN = handQuat([0, -1, 0], [0, 0, 1], [-1, 0, 0]);
// Mão esquerda por baixo da coronha, palma para cima (trocar o carregador).
const HAND_L_MAGWELL = handQuat([-1, 0, 0], [0, 0, 1], [0, 1, 0]);

// Roteiro da mão esquerda na recarga: [progresso, pose-chave].
const RELOAD_LEFT = [
  [0.00, 'support'], [0.12, 'magwell'], [0.28, 'magwell'], [0.46, 'pouch'], [0.54, 'pouch'],
  [0.72, 'magwell'], [0.80, 'magwellIn'], [0.86, 'magwell'], [0.96, 'support'], [1.00, 'support'],
];

const smooth = (t) => t * t * (3 - 2 * t);

export function createSidearm({ character, bones, pistol, mixerClips = [] }) {
  const socketBone = pistol.parent;
  const socketPos = pistol.position.clone();
  const socketQuat = pistol.quaternion.clone();
  const unit = new THREE.Vector3();
  character.getWorldScale(unit);

  pistol.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; o.frustumCulled = false; } });

  // Clarão do tiro, na boca do cano.
  const muzzleFlash = new THREE.Mesh(
    new THREE.ConeGeometry(0.026, 0.11, 5),
    new THREE.MeshBasicMaterial({ color: 0xffc35a }),
  );
  muzzleFlash.rotation.x = Math.PI / 2;
  muzzleFlash.position.copy(SIDEARM.muzzle).add(new THREE.Vector3(0, 0, 0.055));
  muzzleFlash.visible = false;
  pistol.add(muzzleFlash);

  // Carregador na mão esquerda durante a recarga.
  const magazine = new THREE.Mesh(
    new THREE.BoxGeometry(0.09, 0.028, 0.032),
    new THREE.MeshLambertMaterial({ color: 0x23272a }),
  );
  magazine.position.set(0.0, 0.07, 0.03);
  magazine.visible = false;
  bones.mixamorigLeftHand?.add(magazine);

  // Dedos: pose de repouso (bind) guardada antes de qualquer animação.
  const fingerBones = { Right: {}, Left: {} };
  const fingerRest = new Map();
  for (const side of ['Right', 'Left']) {
    for (const finger of FINGERS) {
      fingerBones[side][finger] = [1, 2, 3].map((i) => bones[`mixamorig${side}Hand${finger}${i}`]).filter(Boolean);
      fingerBones[side][finger].forEach((bone) => fingerRest.set(bone, bone.quaternion.clone()));
    }
  }

  const state = {
    draw: 0,
    hold: 0,
    attached: 'holster', // 'holster' | 'free'
    reloadMag: false,
  };

  // ── Temporários ───────────────────────────────────────────────────────────────
  const v1 = new THREE.Vector3(); const v2 = new THREE.Vector3(); const v3 = new THREE.Vector3();
  const fwdB = new THREE.Vector3(); const rightB = new THREE.Vector3(); const aimDir = new THREE.Vector3();
  const shoulderMid = new THREE.Vector3();
  const qa = new THREE.Quaternion(); const qb = new THREE.Quaternion(); const qc = new THREE.Quaternion();
  const m4 = new THREE.Matrix4();
  const charQuat = new THREE.Quaternion(); const charQuatInv = new THREE.Quaternion();
  const socketWorldPos = new THREE.Vector3(); const socketWorldQuat = new THREE.Quaternion();
  const boneQuat = new THREE.Quaternion();

  const makePose = () => ({ p: new THREE.Vector3(), q: new THREE.Quaternion() });
  const gun = makePose(); const stage = makePose(); const ready = makePose(); const aim = makePose();
  const reloadPose = makePose(); const outPose = makePose();
  const keys = { support: makePose(), magwell: makePose(), magwellIn: makePose(), pouch: makePose() };
  const handTarget = makePose();

  // Orientação com +Z = dir, +Y para cima (com rolagem opcional em torno de dir).
  function orient(out, dir, roll = 0) {
    v1.crossVectors(UP, dir);
    if (v1.lengthSq() < 1e-6) v1.set(1, 0, 0);
    v1.normalize();
    v2.crossVectors(dir, v1).normalize();
    m4.makeBasis(v1, v2, dir);
    out.setFromRotationMatrix(m4);
    if (roll) out.multiply(qc.setFromAxisAngle(AXIS_Z_LOCAL, roll));
    return out;
  }
  const AXIS_Z_LOCAL = new THREE.Vector3(0, 0, 1);

  const rotateOnWorldAxis = (() => {
    const axisLocal = new THREE.Vector3(); const qp = new THREE.Quaternion(); const qr = new THREE.Quaternion();
    return (bone, axis, angle) => {
      bone.parent.getWorldQuaternion(qp).invert();
      axisLocal.copy(axis).applyQuaternion(qp);
      bone.quaternion.premultiply(qr.setFromAxisAngle(axisLocal, angle));
    };
  })();

  // Gira `bone` para que o osso filho aponte para o alvo.
  const aimBoneAt = (() => {
    const bp = new THREE.Vector3(); const cp = new THREE.Vector3(); const cur = new THREE.Vector3(); const des = new THREE.Vector3();
    const qd = new THREE.Quaternion(); const qw = new THREE.Quaternion(); const qpar = new THREE.Quaternion();
    return (bone, child, target) => {
      bone.getWorldPosition(bp); child.getWorldPosition(cp);
      cur.copy(cp).sub(bp).normalize();
      des.copy(target).sub(bp).normalize();
      qd.setFromUnitVectors(cur, des);
      bone.getWorldQuaternion(qw).premultiply(qd);
      bone.parent.getWorldQuaternion(qpar).invert();
      bone.quaternion.copy(qpar.multiply(qw));
      bone.updateWorldMatrix(true, true);
    };
  })();

  // IK de dois ossos: leva o punho a `target` com o cotovelo para o lado de `pole`,
  // depois gira a mão para `handWorldQ` repartindo a torção entre antebraço e mão
  // (evita o "efeito bala de caramelo" no punho).
  const solveArm = (() => {
    const sh = new THREE.Vector3(); const el = new THREE.Vector3(); const hd = new THREE.Vector3();
    const dir = new THREE.Vector3(); const perp = new THREE.Vector3(); const elbowTarget = new THREE.Vector3();
    const qFore = new THREE.Quaternion(); const rel = new THREE.Quaternion(); const twist = new THREE.Quaternion();
    const qPar = new THREE.Quaternion();
    return (side, target, handWorldQ, pole, weight) => {
      const arm = bones[`mixamorig${side}Arm`]; const fore = bones[`mixamorig${side}ForeArm`]; const hand = bones[`mixamorig${side}Hand`];
      if (!arm || !fore || !hand || weight <= 0.001) return;
      const s0 = arm.quaternion.clone(); const f0 = fore.quaternion.clone(); const h0 = hand.quaternion.clone();
      arm.getWorldPosition(sh); fore.getWorldPosition(el); hand.getWorldPosition(hd);
      const upper = sh.distanceTo(el); const lower = el.distanceTo(hd);
      dir.copy(target).sub(sh);
      const reach = clamp(dir.length(), Math.abs(upper - lower) + 0.002, upper + lower - 0.002);
      dir.normalize();
      const along = (reach * reach + upper * upper - lower * lower) / (2 * reach);
      const height = Math.sqrt(Math.max(1e-4, upper * upper - along * along));
      perp.copy(pole).addScaledVector(dir, -pole.dot(dir));
      if (perp.lengthSq() < 1e-4) perp.set(0, -1, 0);
      perp.normalize();
      elbowTarget.copy(sh).addScaledVector(dir, along).addScaledVector(perp, height);
      aimBoneAt(arm, fore, elbowTarget);
      aimBoneAt(fore, hand, target);
      // Torção do punho: metade no antebraço (eixo Y local), resto na mão.
      fore.getWorldQuaternion(qFore);
      rel.copy(qFore).invert().multiply(handWorldQ);
      if (rel.w < 0) rel.set(-rel.x, -rel.y, -rel.z, -rel.w);
      const angle = 2 * Math.atan2(rel.y, rel.w);
      twist.setFromAxisAngle(AXIS_Y, angle * 0.5);
      fore.quaternion.multiply(twist);
      fore.updateWorldMatrix(true, false);
      hand.parent.getWorldQuaternion(qPar).invert();
      hand.quaternion.copy(qPar.multiply(handWorldQ));
      if (weight < 0.999) {
        arm.quaternion.slerpQuaternions(s0, arm.quaternion.clone(), weight);
        fore.quaternion.slerpQuaternions(f0, fore.quaternion.clone(), weight);
        hand.quaternion.slerpQuaternions(h0, hand.quaternion.clone(), weight);
      }
      arm.updateWorldMatrix(true, true);
    };
  })();

  const curlQ = new THREE.Quaternion();
  function applyFingers(side, pose, weight) {
    if (weight <= 0.001) return;
    for (const finger of FINGERS) {
      fingerBones[side][finger].forEach((bone, i) => {
        curlQ.setFromAxisAngle(AXIS_X, pose[finger][i] ?? 0);
        const target = fingerRest.get(bone).clone().multiply(curlQ);
        bone.quaternion.slerp(target, weight);
      });
    }
  }

  // ── Poses da arma ─────────────────────────────────────────────────────────────
  // ctx: { x, y, z, bodyYaw, yaw, pitch, aimT, recoil, reloadTime }
  function computeKeyPoses(ctx, wristLeftOffset) {
    // Posição de mira: braços à frente, arma na linha do esterno, um pouco à direita.
    aim.p.copy(shoulderMid).addScaledVector(aimDir, 0.47).addScaledVector(rightB, 0.055).addScaledVector(UP, -0.085);
    orient(aim.q, aimDir);
    // Pronta: junto ao peito, cano para a frente e um pouco para cima.
    v3.copy(fwdB).multiplyScalar(Math.cos(0.42)).addScaledVector(UP, Math.sin(0.42)).normalize();
    ready.p.copy(shoulderMid).addScaledVector(fwdB, 0.29).addScaledVector(rightB, 0.09).addScaledVector(UP, -0.27);
    orient(ready.q, v3);
    // Recarga: cano inclinado para cima e levemente girado, na frente do peito.
    v3.copy(fwdB).multiplyScalar(Math.cos(0.62)).addScaledVector(UP, Math.sin(0.62)).normalize();
    reloadPose.p.copy(shoulderMid).addScaledVector(fwdB, 0.30).addScaledVector(rightB, 0.07).addScaledVector(UP, -0.25);
    orient(reloadPose.q, v3, -0.28);
  }

  function holsterWorldPose() {
    socketBone.updateWorldMatrix(true, false);
    socketBone.getWorldQuaternion(boneQuat);
    socketWorldPos.copy(socketPos).applyMatrix4(socketBone.matrixWorld);
    socketWorldQuat.copy(boneQuat).multiply(socketQuat);
  }

  function place(p, q) {
    if (state.attached !== 'free') { character.add(pistol); state.attached = 'free'; }
    character.updateWorldMatrix(true, false);
    character.getWorldQuaternion(charQuat);
    charQuatInv.copy(charQuat).invert();
    pistol.position.copy(character.worldToLocal(v1.copy(p)));
    pistol.quaternion.copy(charQuatInv).multiply(q);
    pistol.scale.setScalar(1);
    pistol.updateMatrixWorld(true);
  }

  function holsterBack() {
    if (state.attached === 'holster') return;
    socketBone.add(pistol);
    pistol.position.copy(socketPos);
    pistol.quaternion.copy(socketQuat);
    pistol.scale.setScalar(1);
    state.attached = 'holster';
    magazine.visible = false;
  }

  const wristWorld = (out, pose, offset, quatInGun, outQ) => {
    out.copy(offset).multiplyScalar(unit.x).applyQuaternion(pose.q).add(pose.p);
    if (outQ) outQ.copy(pose.q).multiply(quatInGun);
    return out;
  };

  // Poses-chave da mão esquerda (punho), em mundo.
  const leftKey = { support: { p: new THREE.Vector3(), q: new THREE.Quaternion() },
    magwell: { p: new THREE.Vector3(), q: new THREE.Quaternion() },
    magwellIn: { p: new THREE.Vector3(), q: new THREE.Quaternion() },
    pouch: { p: new THREE.Vector3(), q: new THREE.Quaternion() } };
  const MAGWELL_OFFSET = new THREE.Vector3(0.0, -0.115, -0.045);
  const MAGWELL_IN = new THREE.Vector3(0.0, -0.085, -0.045);

  function leftTarget(ctx, reloadProgress, outP, outQ) {
    wristWorld(leftKey.support.p, gun, SIDEARM.wristLeft, HAND_L_IN_GUN, leftKey.support.q);
    if (reloadProgress < 0) { outP.copy(leftKey.support.p); outQ.copy(leftKey.support.q); return; }
    wristWorld(leftKey.magwell.p, gun, MAGWELL_OFFSET, HAND_L_MAGWELL, leftKey.magwell.q);
    wristWorld(leftKey.magwellIn.p, gun, MAGWELL_IN, HAND_L_MAGWELL, leftKey.magwellIn.q);
    // Bolsa de carregadores no colete, lado esquerdo.
    leftKey.pouch.p.set(ctx.x, ctx.y + 1.12, ctx.z)
      .addScaledVector(rightB, -0.16).addScaledVector(fwdB, 0.19);
    qa.setFromAxisAngle(AXIS_Y, ctx.bodyYaw);
    leftKey.pouch.q.copy(qa).multiply(HAND_POUCH);
    let i = 0;
    while (i < RELOAD_LEFT.length - 2 && reloadProgress > RELOAD_LEFT[i + 1][0]) i++;
    const [t0, k0] = RELOAD_LEFT[i]; const [t1, k1] = RELOAD_LEFT[i + 1];
    const f = smooth(clamp((reloadProgress - t0) / Math.max(1e-4, t1 - t0), 0, 1));
    outP.lerpVectors(leftKey[k0].p, leftKey[k1].p, f);
    outQ.slerpQuaternions(leftKey[k0].q, leftKey[k1].q, f);
  }
  // Mão no colete: palma para cima, dedos para a frente.
  const HAND_POUCH = handQuat([-1, 0, 0], [0, 0, 1], [0, 1, 0]);

  const poleRight = new THREE.Vector3(); const poleLeft = new THREE.Vector3();

  // ── Atualização por frame (depois do mixer) ──────────────────────────────────
  function update(dt, ctx, wantDrawn) {
    // Progresso do saque.
    if (wantDrawn) { state.hold = 0; state.draw = Math.min(1, state.draw + dt / SIDEARM.drawTime); }
    else if (state.draw > 0) {
      state.hold += dt;
      if (state.hold >= SIDEARM.holdBeforeHolster) state.draw = Math.max(0, state.draw - dt / SIDEARM.holsterTime);
    }
    const u = state.draw;
    if (u <= 0) { holsterBack(); return; }

    character.updateWorldMatrix(true, true);
    character.getWorldScale(unit);

    fwdB.set(Math.sin(ctx.bodyYaw), 0, Math.cos(ctx.bodyYaw));
    rightB.set(-Math.cos(ctx.bodyYaw), 0, Math.sin(ctx.bodyYaw));
    const cp = Math.cos(ctx.pitch);
    aimDir.set(Math.sin(ctx.yaw) * cp, Math.sin(ctx.pitch), Math.cos(ctx.yaw) * cp);
    aimDir.lerpVectors(fwdB, aimDir, ctx.aimT).normalize();

    // Inclinação do tronco e da cabeça acompanhando a mira.
    const body = smoothstep(u, 0.3, 0.9);
    const lean = ctx.pitch * ctx.aimT * body;
    if (bones.mixamorigSpine1) rotateOnWorldAxis(bones.mixamorigSpine1, rightB, 0.14 * lean);
    if (bones.mixamorigSpine2) rotateOnWorldAxis(bones.mixamorigSpine2, rightB, 0.14 * lean);
    if (bones.mixamorigHead) rotateOnWorldAxis(bones.mixamorigHead, rightB, 0.35 * lean);
    bones.mixamorigSpine.updateWorldMatrix(true, true);

    bones.mixamorigRightArm.getWorldPosition(v1);
    bones.mixamorigLeftArm.getWorldPosition(v2);
    shoulderMid.addVectors(v1, v2).multiplyScalar(0.5);

    computeKeyPoses(ctx);

    // Estágio (pronta → mira → recarga) com coice.
    const reloadProgress = ctx.reloadTime > 0 ? 1 - ctx.reloadTime / SIDEARM.reloadTime : -1;
    const aimBlend = smoothstep(u, 0.66, 1.0) * ctx.aimT;
    stage.p.lerpVectors(ready.p, aim.p, aimBlend);
    stage.q.slerpQuaternions(ready.q, aim.q, aimBlend);
    if (reloadProgress >= 0) {
      const rb = smoothstep(reloadProgress, 0, 0.12) * (1 - smoothstep(reloadProgress, 0.88, 1));
      stage.p.lerp(reloadPose.p, rb);
      stage.q.slerp(reloadPose.q, rb);
    }
    if (ctx.recoil > 0) {
      stage.q.multiply(qa.setFromAxisAngle(AXIS_X, -0.13 * ctx.recoil));
      stage.p.addScaledVector(aimDir, -0.028 * ctx.recoil);
    }

    // Trajetória do saque: coldre → para fora → estágio.
    holsterWorldPose();
    const out = smoothstep(u, 0.26, 0.46);
    const toStage = smoothstep(u, 0.46, 0.72);
    outPose.p.copy(v1.set(0, 0, -1).applyQuaternion(socketWorldQuat)).multiplyScalar(SIDEARM.pullOut * unit.x).add(socketWorldPos);
    gun.p.lerpVectors(socketWorldPos, outPose.p, out).lerp(stage.p, toStage);
    gun.q.slerpQuaternions(socketWorldQuat, stage.q, toStage);
    place(gun.p, gun.q);

    // Braço direito: alcança a coronha e acompanha a arma.
    const wR = smoothstep(u, 0.0, 0.26);
    poleRight.copy(rightB).multiplyScalar(0.6).addScaledVector(fwdB, -0.5 * (1 - body)).addScaledVector(UP, -1);
    wristWorld(handTarget.p, gun, SIDEARM.wristRight, HAND_R_IN_GUN, handTarget.q);
    solveArm('Right', handTarget.p, handTarget.q, poleRight, wR);
    applyFingers('Right', SIDEARM.curlGrip, smoothstep(u, 0.16, 0.30));

    // Braço esquerdo: chega ao apoio da coronha (e faz a recarga).
    const wL = smoothstep(u, 0.55, 0.85);
    leftTarget(ctx, reloadProgress, handTarget.p, handTarget.q);
    poleLeft.copy(rightB).multiplyScalar(-0.6).addScaledVector(UP, -1);
    solveArm('Left', handTarget.p, handTarget.q, poleLeft, wL);
    applyFingers('Left', SIDEARM.curlSupport, smoothstep(u, 0.70, 0.88));

    magazine.visible = reloadProgress > 0.5 && reloadProgress < 0.78;
  }

  function muzzleWorld(out) {
    pistol.updateWorldMatrix(true, false);
    return pistol.localToWorld(out.copy(SIDEARM.muzzle));
  }

  return {
    update,
    muzzleWorld,
    muzzleFlash,
    pistol,
    get draw() { return state.draw; },
    get drawn() { return state.draw >= 0.97; },
    reset() { state.draw = 0; state.hold = 0; holsterBack(); },
  };
}
