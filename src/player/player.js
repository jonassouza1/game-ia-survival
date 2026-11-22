import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { retargetMixamoClip } from './retarget.js';
import { createGait } from './locomotion.js';
import { createSidearm, SIDEARM } from './sidearm.js';

const clamp = THREE.MathUtils.clamp;

// Câmera sobre o ombro e parâmetros de movimentação no estilo do remake.
const CAM = { distFree: 3.1, distAim: 2.4, shoulderFree: 0.8, shoulderAim: 0.72,
  height: 1.62, fovFree: 58, fovAim: 38, pitchMin: -0.62, pitchMax: 0.5 };
const SPEED = { jog: 2.75, walk: 1.42, run: 4.35, aim: 1.18, accel: 4.7, brake: 7.8, turn: 5.1 };
const angleDiff = (a, b) => ((b - a + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;

export function createPlayer({ scene, world, camera, dom, audio, inventory, quality }) {
  const col = world.collisions;
  // `model.root` é o grupo do SWAT animado (preenchido quando o GLB termina de carregar).
  const model = { root: null, skinned: null, muzzleTime: 0, muzzleFlash: null };

  // ── Personagem real (SWAT Mixamo) + clips de caminhada do mesmo rig ──
  const skinned = {
    root: new THREE.Group(),
    mixer: null,
    actions: {},
    bones: {},
    ready: false,
  };
  skinned.root.name = 'PlayerSkinnedCharacter';
  skinned.root.visible = false;
  scene.add(skinned.root);
  model.skinned = skinned;
  model.root = skinned.root;

  new GLTFLoader().load('/models/character/swat.glb', (gltf) => {
    const character = gltf.scene;
    const bounds = new THREE.Box3().setFromObject(character);
    const size = bounds.getSize(new THREE.Vector3());
    if (!Number.isFinite(size.y) || size.y <= 0.001) {
      console.error('Personagem SWAT com dimensões inválidas.');
      return;
    }
    character.scale.setScalar(1.82 / size.y);
    character.updateMatrixWorld(true);
    const scaled = new THREE.Box3().setFromObject(character);
    const center = scaled.getCenter(new THREE.Vector3());
    character.position.set(-center.x, -scaled.min.y, -center.z);
    character.traverse((object) => {
      if (object.isMesh) {
        object.castShadow = true;
        object.receiveShadow = true;
        object.frustumCulled = false; // o bounding box da malha com skin é impreciso
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        for (const material of materials) {
          if (!material) continue;
          material.envMapIntensity = 1.1;
          if ('roughness' in material) material.roughness = Math.min(material.roughness ?? 1, 0.95);
        }
      }
      if (object.isBone) skinned.bones[object.name] = object;
    });
    skinned.root.add(character);
    skinned.mixer = new THREE.AnimationMixer(character);
    if (gltf.animations[0]) {
      const idle = skinned.mixer.clipAction(gltf.animations[0]);
      idle.play();
      skinned.actions.idle = idle;
    }
    // Pistola do coldre (nó separado pelo tools/split-holster-pistol.mjs).
    const holsterPistol = character.getObjectByName('Soldier_pistol');
    if (holsterPistol) {
      skinned.sidearm = createSidearm({ character, bones: skinned.bones, pistol: holsterPistol });
      model.muzzleFlash = skinned.sidearm.muzzleFlash;
    } else {
      console.warn('swat.glb sem o nó Soldier_pistol: rode `npm run split-pistol`.');
    }
    skinned.root.visible = true;
    skinned.ready = true;
    character.userData.character = 'swat';

    // Os clipes Walk/Run vêm do Soldier.glb (também Mixamo, mas com outra orientação
    // de ossos, outra escala e olhando para o lado oposto). Ver retarget.js: o
    // movimento é convertido osso a osso para o esqueleto do SWAT, incluindo a
    // rotação e o deslocamento do quadril (Hips).
    new GLTFLoader().load('/models/character/Soldier.glb', (soldier) => {
      const locomotion = {};
      for (const name of ['Walk', 'Run']) {
        const source = soldier.animations.find((clip) => clip.name === name);
        if (!source) continue;
        try {
          const result = retargetMixamoClip(soldier.scene, character, source);
          const action = skinned.mixer.clipAction(result.clip);
          action.timeScale = 0; // a fase é definida pela distância percorrida (locomotion.js)
          action.play();
          action.setEffectiveWeight(0);
          skinned.actions[name.toLowerCase()] = action;
          locomotion[name.toLowerCase()] = {
            duration: result.clip.duration,
            strike: result.strikePhase,
            // velocidade (m/s no mundo do jogo) em que o pé de apoio não escorrega
            speed: result.groundSpeed * character.scale.x,
          };
        } catch (error) {
          console.warn(`Não foi possível adaptar o clipe ${name}.`, error);
        }
      }
      if (locomotion.walk && locomotion.run) skinned.gait = createGait(locomotion);
    }, undefined, (error) => {
      console.warn('Clipes de caminhada indisponíveis; mantendo idle.', error);
    });
  }, undefined, (error) => {
    console.error('Não foi possível carregar o personagem SWAT.', error);
  });

  const S = {
    x: world.spawn.x, z: world.spawn.z, y: world.spawn.y,
    yaw: world.spawn.yaw, pitch: -0.1, bodyYaw: world.spawn.yaw,
    vx: 0, vz: 0, speed: 0, aimT: 0, aiming: false, flash: true, phase: 0, camFrac: 1, active: false,
    paused: false, recoil: 0, reloadTime: 0, gaitLean: 0,
  };
  const keys = {};
  // 'fired' = atirou · 'empty' = carregador vazio (clique seco) · 'blocked' = ainda não pode (sacando, recarregando...)
  function shoot() {
    if (!S.active || S.paused || !S.aiming || S.reloadTime > 0) return 'blocked';
    const sidearm = model.skinned?.sidearm;
    if (sidearm && (!sidearm.drawn || S.aimT < 0.8)) return 'blocked'; // ainda sacando a arma
    if (!inventory?.consumeRound()) { audio?.emptyGun?.(); return 'empty'; }
    S.recoil = 1;
    model.muzzleTime = 0.075;
    if (model.muzzleFlash) model.muzzleFlash.visible = true;
    fireProjectile();
    audio?.gunshot?.();
    return 'fired';
  }

  // ── Entrada por toque (celular/tablet) ──
  // Preenchida por src/input/touchControls.js. `moveX/moveY` vêm do joystick (−1…1, y<0 = frente).
  const FIRE_INTERVAL = 0.42;   // segurar FOGO repete o tiro (pistola semiautomática)
  const FIRE_QUEUE = 0.9;       // um toque rápido ainda atira quando a arma terminar de ser sacada
  const AIM_LINGER = 0.7;       // mantém a mira erguida um instante depois do último tiro
  const touch = {
    moveX: 0, moveY: 0, run: false, aim: false,
    fireHeld: false, fireQueue: 0, fireCooldown: 0, aimLinger: 0, dry: false,
    setFire(down) {
      if (down) { this.fireHeld = true; this.fireQueue = FIRE_QUEUE; this.dry = false; }
      else { this.fireHeld = false; this.dry = false; }
    },
    get wantsAim() { return this.aim || this.fireHeld || this.fireQueue > 0 || this.aimLinger > 0; },
    get driving() { return Math.hypot(this.moveX, this.moveY) > 0.01; },
  };
  let touchAimApplied = false;
  function updateTouchActions(dt) {
    if (S.paused || !S.active) {
      if (touchAimApplied) { S.aiming = false; touchAimApplied = false; }
      return;
    }
    touch.aimLinger = Math.max(0, touch.aimLinger - dt);
    touch.fireCooldown = Math.max(0, touch.fireCooldown - dt);
    if (!touch.fireHeld) touch.fireQueue = Math.max(0, touch.fireQueue - dt);
    if (touch.wantsAim) { S.aiming = true; touchAimApplied = true; }
    else if (touchAimApplied) { S.aiming = false; touchAimApplied = false; }
    if ((touch.fireHeld || touch.fireQueue > 0) && touch.fireCooldown <= 0 && !touch.dry) {
      const result = shoot();
      if (result === 'fired') {
        touch.fireCooldown = FIRE_INTERVAL;
        touch.fireQueue = 0;
        touch.aimLinger = AIM_LINGER;
      } else if (result === 'empty') {
        touch.dry = true;          // um clique seco por toque, sem metralhar o som
        touch.fireQueue = 0;
      }
    }
  }
  function toggleFlashlight() { S.flash = !S.flash; audio?.toggleFlashlight(S.flash); return S.flash; }

  // ── Entrada ──
  const onKey = (e) => {
    keys[e.code] = e.type === 'keydown';
    if (e.type === 'keydown' && e.code === 'KeyF' && !e.repeat) toggleFlashlight();
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
  };
  window.addEventListener('keydown', onKey);
  window.addEventListener('keyup', onKey);
  window.addEventListener('blur', () => { for (const k in keys) keys[k] = false; S.aiming = false; });
  dom.addEventListener('mousedown', (e) => {
    if (e.sourceCapabilities?.firesTouchEvents) return; // "mouse" sintético de um toque: quem cuida é o touchControls
    if (e.button === 2 && !S.paused) S.aiming = true;
    if (e.button === 0) shoot();
  });
  window.addEventListener('mouseup', (e) => { if (e.button === 2) S.aiming = false; });
  window.addEventListener('contextmenu', (e) => e.preventDefault());
  // `dx`/`dy` em radianos (já com a sensibilidade base de cada dispositivo). Mirando, a câmera fica mais lenta.
  function look(dx, dy) {
    const sensitivity = THREE.MathUtils.lerp(1, 0.55, S.aimT);
    S.yaw -= dx * sensitivity;
    S.pitch = clamp(S.pitch - dy * sensitivity, CAM.pitchMin, CAM.pitchMax);
  }
  document.addEventListener('mousemove', (e) => {
    if (!S.active) return;
    if (document.pointerLockElement !== dom) {
      const bounds = dom.getBoundingClientRect();
      if (e.clientX < bounds.left || e.clientX > bounds.right || e.clientY < bounds.top || e.clientY > bounds.bottom) return;
    }
    look(e.movementX * 0.0022, e.movementY * 0.002);
  });
  // Lanterna presa ao colete
  const flash = new THREE.SpotLight(0xfff0d0, 62, 22, 0.5, 0.68, 2);
  flash.castShadow = true;
  const flashShadowSize = quality?.shadows === 'flashlight' ? 256 : 512;
  flash.shadow.mapSize.set(flashShadowSize, flashShadowSize);
  flash.shadow.bias = -0.0008;
  scene.add(flash, flash.target);

  // Preenchimento suave preso à câmera: revela o personagem e o chão imediato
  // sem apagar o contraste das fontes de luz da cena.
  const cameraFill = new THREE.PointLight(0xa8bdd4, 0.9, 4.2, 2);
  cameraFill.castShadow = false;
  scene.add(cameraFill);

  const raycaster = new THREE.Raycaster();
  const dir = new THREE.Vector3(), right = new THREE.Vector3(), pivot = new THREE.Vector3();
  const rayDir = new THREE.Vector3(), camPos = new THREE.Vector3(), tmp = new THREE.Vector3();
  const muzzlePoint = new THREE.Vector3();
  const shots = [];
  // Inimigos: o gerenciador recebe {origin, dir, maxDistance} e devolve o ponto atingido (ou null).
  let shotHandler = null;

  function getMuzzlePoint() {
    model.root.position.set(S.x, S.y, S.z);
    model.root.scale.setScalar(1);
    model.root.updateMatrixWorld(true);
    const sidearm = model.skinned?.sidearm;
    if (sidearm) sidearm.muzzleWorld(muzzlePoint);
    else muzzlePoint.set(S.x, S.y + 1.4, S.z);
    return muzzlePoint;
  }

  // ── Mira convergente ────────────────────────────────────────────────────────────────────
  // A câmera fica sobre o ombro (≈0,7 m à direita e 2,4 m atrás), mas o cano da arma está noutro
  // ponto: antes a bala saía do cano PARALELA ao eixo da câmera, ficando sempre ~0,5 m deslocada do
  // que o retículo mostrava — num zumbi a 5 m isso é a largura do tronco inteiro. Agora o alvo é o
  // que o centro da tela enxerga (parede ou zumbi) e a bala parte do cano em direção a esse ponto.
  const aimRay = new THREE.Raycaster();
  const baseDir = new THREE.Vector3(), aimPoint = new THREE.Vector3(), camOrigin = new THREE.Vector3();
  let shotProbe = null;     // ({origin, dir, maxDistance}) → {t} | null — inimigo no caminho, sem dano
  function computeShotDir(origin, out) {
    const cp = Math.cos(S.pitch);
    baseDir.set(Math.sin(S.yaw) * cp, Math.sin(S.pitch), Math.cos(S.yaw) * cp).normalize();
    out.copy(baseDir);
    camOrigin.copy(camera.position);
    aimRay.set(camOrigin, baseDir);
    aimRay.far = 60;
    const wall = aimRay.intersectObjects(world.occluders, false)[0];
    let dist = wall ? wall.distance : 60;
    const enemy = shotProbe?.({ origin: camOrigin.clone(), dir: baseDir.clone(), maxDistance: dist });
    if (enemy) dist = Math.min(dist, enemy.t);
    aimPoint.copy(camOrigin).addScaledVector(baseDir, dist);
    out.copy(aimPoint).sub(origin);
    const len = out.length();
    // alvo colado na arma ou muito de lado: não converge (evita tiros tortos)
    if (len < 1.5 || out.dot(baseDir) < len * 0.5) return out.copy(baseDir);
    return out.divideScalar(len);
  }

  function aimScreenPosition() {
    const origin = getMuzzlePoint().clone();
    computeShotDir(origin, dir);
    raycaster.set(origin, dir);
    raycaster.far = 36;
    const hit = raycaster.intersectObjects(world.occluders, false)[0];
    let reach = hit ? hit.distance : 24;
    // o retículo para sobre o zumbi quando o tiro o acertaria
    const enemy = S.aimT > 0.5 ? shotProbe?.({ origin: origin.clone(), dir: dir.clone(), maxDistance: reach }) : null;
    if (enemy) reach = Math.min(reach, enemy.t);
    const target = origin.clone().addScaledVector(dir, reach);
    target.project(camera);
    if (target.z < -1 || target.z > 1) return null;
    return { x: target.x, y: target.y };
  }

  function addImpact(hit) {
    const normal = hit.face?.normal.clone().transformDirection(hit.object.matrixWorld) || new THREE.Vector3(0, 1, 0);
    const mark = new THREE.Mesh(
      new THREE.CircleGeometry(0.055, 7),
      new THREE.MeshBasicMaterial({ color: 0x221b13, transparent: true, opacity: 0.82, depthWrite: false }),
    );
    mark.position.copy(hit.point).addScaledVector(normal, 0.004);
    mark.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal);
    scene.add(mark);
    const sparks = [];
    for (let i = 0; i < 7; i++) {
      const velocity = new THREE.Vector3((Math.random() - 0.5) * 1.8, Math.random() * 1.5, (Math.random() - 0.5) * 1.8)
        .addScaledVector(normal, 0.75 + Math.random() * 0.55);
      const geometry = new THREE.BufferGeometry().setFromPoints([hit.point, hit.point]);
      const material = new THREE.LineBasicMaterial({ color: i % 2 ? 0xffc56a : 0xe9e0c3, transparent: true });
      const spark = new THREE.Line(geometry, material);
      scene.add(spark);
      sparks.push({ object: spark, velocity });
    }
    shots.push({ mark, sparks, point: hit.point.clone(), age: 0, duration: 4.5, impact: true });
  }

  function fireProjectile() {
    const start = getMuzzlePoint().clone();
    computeShotDir(start, dir);
    raycaster.set(start, dir);
    raycaster.far = 36;
    let hit = raycaster.intersectObjects(world.occluders, false)[0];
    let end = hit ? hit.point.clone() : start.clone().addScaledVector(dir, 36);
    // Inimigo na linha de tiro (antes da parede)? O projétil termina nele e não marca a parede.
    const enemyHit = shotHandler?.({ origin: start.clone(), dir: dir.clone(), maxDistance: hit ? hit.distance : 36 });
    if (enemyHit) { end = enemyHit.point.clone(); hit = null; }
    const geometry = new THREE.BufferGeometry().setFromPoints([start, start]);
    const material = new THREE.LineBasicMaterial({ color: 0xffe6a1, transparent: true, opacity: 0.95 });
    const tracer = new THREE.Line(geometry, material);
    tracer.frustumCulled = false;
    scene.add(tracer);
    shots.push({ tracer, start, end, age: 0, duration: 0.11, impact: false });
    if (hit) addImpact(hit);
  }

  function updateShots(dt) {
    for (let i = shots.length - 1; i >= 0; i--) {
      const shot = shots[i];
      shot.age += dt;
      const progress = clamp(shot.age / shot.duration, 0, 1);
      if (shot.impact) {
        const sparkProgress = clamp(shot.age / 0.42, 0, 1);
        shot.sparks.forEach(({ object, velocity }) => {
          const from = shot.point.clone().addScaledVector(velocity, sparkProgress * 0.30);
          const to = from.clone().addScaledVector(velocity, (1 - sparkProgress) * 0.34);
          object.geometry.setFromPoints([from, to]);
          object.material.opacity = 1 - sparkProgress;
        });
        shot.mark.material.opacity = 0.82 * (1 - clamp((shot.age - 1) / 3.5, 0, 1));
      } else {
        const current = shot.start.clone().lerp(shot.end, progress);
        shot.tracer.geometry.setFromPoints([shot.start, current]);
        shot.tracer.material.opacity = 1 - progress * 0.75;
      }
      if (progress >= 1) {
        if (shot.tracer) {
          scene.remove(shot.tracer); shot.tracer.geometry.dispose(); shot.tracer.material.dispose();
        }
        if (shot.mark) {
          scene.remove(shot.mark); shot.mark.geometry.dispose(); shot.mark.material.dispose();
          shot.sparks.forEach(({ object }) => {
            scene.remove(object); object.geometry.dispose(); object.material.dispose();
          });
        }
        shots.splice(i, 1);
      }
    }
  }

  function updateMovement(dt) {
    if (S.paused) {
      S.vx = 0; S.vz = 0; S.speed = 0; S.aiming = false;
      S.aimT += (0 - S.aimT) * Math.min(1, dt * 14);
      return;
    }
    let f = (keys.KeyW || keys.ArrowUp ? 1 : 0) - (keys.KeyS || keys.ArrowDown ? 1 : 0);
    let s = (keys.KeyD || keys.ArrowRight ? 1 : 0) - (keys.KeyA || keys.ArrowLeft ? 1 : 0);
    // Joystick virtual: só vale quando o teclado está parado. O joystick usa y<0 = frente.
    const stick = f === 0 && s === 0 && touch.driving;
    if (stick) { f = -touch.moveY; s = touch.moveX; }
    const fx = Math.sin(S.yaw), fz = Math.cos(S.yaw), rx = -Math.cos(S.yaw), rz = Math.sin(S.yaw);
    let wx = fx * f + rx * s, wz = fz * f + rz * s;
    const len = Math.hypot(wx, wz);
    if (len > 0) { wx /= len; wz /= len; }
    const sprinting = !S.aiming && (keys.ShiftLeft || keys.ShiftRight);
    const walking = !S.aiming && keys.KeyC;
    let max = S.aiming ? SPEED.aim : (walking ? SPEED.walk : (sprinting ? SPEED.run : SPEED.jog));
    if (stick && !S.aiming) {
      // Analógico: joystick no meio = andar, quase todo = trotar, além do anel = correr.
      const mag = Math.hypot(touch.moveX, touch.moveY);
      max = touch.run ? SPEED.run : THREE.MathUtils.lerp(SPEED.walk, SPEED.jog, clamp((mag - 0.35) / 0.5, 0, 1));
    }
    if (S.aiming && f < 0) max *= 0.8;
    const hasInput = len > 0;
    const targetX = wx * max * (hasInput ? 1 : 0);
    const targetZ = wz * max * (hasInput ? 1 : 0);
    const reversing = (S.vx * targetX + S.vz * targetZ) < -0.15;
    const response = hasInput ? (reversing ? SPEED.brake : SPEED.accel) : SPEED.brake;
    const k = 1 - Math.exp(-dt * response);
    S.vx += (targetX - S.vx) * k;
    S.vz += (targetZ - S.vz) * k;
    S.speed = Math.hypot(S.vx, S.vz);
    if (S.speed > 0.01) {
      const p = col.move(S.x, S.z, S.vx * dt, S.vz * dt, 0.36, S.y);
      if (p.x === S.x) S.vx = 0;
      if (p.z === S.z) S.vz = 0;
      S.x = p.x; S.z = p.z;
    }
    S.speed = Math.hypot(S.vx, S.vz);
    S.y = col.floorY(S.x, S.z, S.y) ?? S.y;
    const wantYaw = S.aiming ? S.yaw : (S.speed > 0.35 ? Math.atan2(S.vx, S.vz) : S.bodyYaw);
    S.bodyYaw += angleDiff(S.bodyYaw, wantYaw) * (1 - Math.exp(-dt * (S.aiming ? 15 : SPEED.turn)));
    const lateral = Math.cos(S.bodyYaw) * S.vx - Math.sin(S.bodyYaw) * S.vz;
    S.gaitLean += (clamp(-lateral * 0.045, -0.075, 0.075) - S.gaitLean) * (1 - Math.exp(-dt * 5));
    S.aimT += ((S.aiming ? 1 : 0) - S.aimT) * (1 - Math.exp(-dt * 11));
  }


  function updateSkinnedCharacter(dt, amp) {
    const sk = model.skinned;
    const root = model.root;
    // A oscilação vertical do corpo vem do próprio clipe (Hips), então não se soma strideBob.
    root.position.set(S.x, S.y, S.z);
    root.rotation.set(-0.018 * amp - 0.012 * S.aimT, S.bodyYaw, S.gaitLean * 0.5);

    const actions = sk.actions;
    if (sk.gait) {
      // Velocidade na direção em que o corpo olha (negativa = de costas, ex.: mirando).
      const along = S.vx * Math.sin(S.bodyYaw) + S.vz * Math.cos(S.bodyYaw);
      const gait = sk.gait.update(dt, S.speed, along);
      if (actions.idle) actions.idle.setEffectiveWeight(gait.idle);
      actions.walk.setEffectiveWeight(gait.walk);
      actions.run.setEffectiveWeight(gait.run);
      actions.walk.time = gait.walkTime;
      actions.run.time = gait.runTime;
      // Câmera acompanha o mesmo passo (o balanço é mais baixo no apoio do pé esquerdo).
      S.phase = gait.phase * Math.PI * 2 - Math.PI / 4;
    } else if (actions.idle) {
      actions.idle.setEffectiveWeight(1);
    }
    sk.mixer.update(dt);

    if (sk.sidearm) {
      sk.sidearm.update(dt, {
        x: S.x, y: S.y, z: S.z, bodyYaw: S.bodyYaw, yaw: S.yaw, pitch: S.pitch,
        aimT: S.aimT, recoil: S.recoil, reloadTime: S.reloadTime,
      }, S.aiming || S.reloadTime > 0);
    }
  }

  function animateModel(dt) {
    const m = model;
    S.recoil = Math.max(0, S.recoil - dt * 4.8);
    S.reloadTime = Math.max(0, S.reloadTime - dt);
    if (m.muzzleTime > 0) {
      m.muzzleTime -= dt;
      if (m.muzzleTime <= 0 && m.muzzleFlash) m.muzzleFlash.visible = false;
    }
    S.phase += S.speed * dt * 2.55;
    if (m.skinned.ready && m.skinned.mixer) {
      updateSkinnedCharacter(dt, clamp(S.speed / SPEED.jog, 0, 1));
    }
  }

  function updateFlashlight() {
    flash.visible = S.flash;
    flash.position.set(S.x + Math.sin(S.bodyYaw) * 0.25 + Math.cos(S.bodyYaw) * 0.17, S.y + 1.42, S.z + Math.cos(S.bodyYaw) * 0.25 - Math.sin(S.bodyYaw) * 0.17);
    const a = S.aimT, cp = Math.cos(S.pitch);
    tmp.set(THREE.MathUtils.lerp(Math.sin(S.bodyYaw), Math.sin(S.yaw) * cp, a),
      THREE.MathUtils.lerp(-0.06, Math.sin(S.pitch), a),
      THREE.MathUtils.lerp(Math.cos(S.bodyYaw), Math.cos(S.yaw) * cp, a)).normalize();
    flash.target.position.copy(flash.position).addScaledVector(tmp, 10);
  }

  function updateCamera(dt) {
    const a = S.aimT, dist = THREE.MathUtils.lerp(CAM.distFree, CAM.distAim, a);
    const shoulder = THREE.MathUtils.lerp(CAM.shoulderFree, CAM.shoulderAim, a);
    const cp = Math.cos(S.pitch), sp = Math.sin(S.pitch);
    dir.set(Math.sin(S.yaw) * cp, sp, Math.cos(S.yaw) * cp);
    right.set(-Math.cos(S.yaw), 0, Math.sin(S.yaw));
    const bob = Math.sin(S.phase * 2) * 0.018 * Math.min(1, S.speed / 3) + Math.sin(performance.now() * 0.0016) * 0.004;
    pivot.set(S.x, S.y + CAM.height + bob, S.z);
    pivot.addScaledVector(right, Math.sin(S.phase) * 0.012 * Math.min(1, S.speed / 3));
    camPos.copy(pivot).addScaledVector(right, shoulder).addScaledVector(dir, -dist);
    rayDir.copy(camPos).sub(pivot);
    const full = rayDir.length(); rayDir.divideScalar(full);
    raycaster.set(pivot, rayDir); raycaster.far = full;
    const hit = raycaster.intersectObjects(world.occluders, false)[0];
    const frac = hit ? clamp((hit.distance - 0.18) / full, 0.1, 1) : 1;
    if (frac < S.camFrac) S.camFrac = frac;
    else S.camFrac += (frac - S.camFrac) * Math.min(1, dt * 5);
    camera.position.copy(pivot).addScaledVector(rayDir, full * S.camFrac);
    camera.lookAt(tmp.copy(camera.position).addScaledVector(dir, 10));
    tmp.y += S.recoil * 0.42 * a;
    camera.lookAt(tmp);
    cameraFill.position.copy(camera.position).addScaledVector(dir, 0.45);
    cameraFill.position.y += 0.15;
    camera.rotateZ(S.gaitLean * 0.55 + Math.sin(S.phase * 2) * S.speed * 0.0022);
    const sprintFov = clamp((S.speed - 2.9) * 0.9, 0, 3.2);
    const fov = THREE.MathUtils.lerp(CAM.fovFree, CAM.fovAim, a) + sprintFov;
    if (Math.abs(camera.fov - fov) > 0.01) { camera.fov = fov; camera.updateProjectionMatrix(); }
    model.root.visible = full * S.camFrac > 0.75;
  }

  function update(dt) {
    updateTouchActions(dt);
    updateMovement(dt);
    animateModel(dt);
    updateShots(dt);
    updateFlashlight();
    updateCamera(dt);
    audio?.update(dt, S.speed);
  }

  return {
    state: S, update,
    touch, look, toggleFlashlight,
    aimScreenPosition,
    setShotHandler(fn) { shotHandler = fn; },
    setShotProbe(fn) { shotProbe = fn; },
    setActive: (active) => { S.active = active; },
    setPaused: (paused) => {
      S.paused = paused;
      if (paused) { S.aiming = false; S.vx = 0; S.vz = 0; S.speed = 0; }
    },
    startReload() { S.reloadTime = SIDEARM.reloadTime; },
    teleport(spawn) {
      S.x = spawn.x; S.y = spawn.y; S.z = spawn.z;
      S.yaw = spawn.yaw; S.bodyYaw = spawn.yaw; S.pitch = 0;
      S.vx = 0; S.vz = 0; S.speed = 0; S.aiming = false; S.aimT = 0; S.camFrac = 1;
      model.skinned?.sidearm?.reset();
    },
  };
}
