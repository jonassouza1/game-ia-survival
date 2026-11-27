import * as THREE from 'three';
import './style.css';
import { buildPoliceStation } from './world/policeStation.js';
import { buildCityStreet } from './world/cityStreet.js';
import { createPlayer } from './player/player.js';
import { createInteraction } from './systems/interaction.js';
import { createAudio } from './systems/audio.js';
import { createInventory } from './systems/inventory.js';
import { CollisionWorld } from './systems/collision.js';
import { createEnemies } from './enemies/zombieManager.js';
import { buildHospital } from './world/hospital.js';
import { loadHospitalAssets } from './world/hospitalAssets.js';
import { initPBR } from './render/pbr.js';
import { createEnvironment } from './render/environment.js';
import { createStorm } from './render/storm.js';
import { createPostFX } from './render/postfx.js';
import { resolveQuality, applyQuality, configureGroupShadows } from './render/quality.js';
import { setModelTextureLimit } from './render/loaders.js';
import { isTouchDevice } from './input/device.js';
import { createTouchControls, getStoredSensitivity } from './input/touchControls.js';

// Antes de medir o container: no celular o jogo ocupa a tela inteira (ver style.css).
document.documentElement.classList.toggle('touch', isTouchDevice);
const container = document.querySelector('#game');
const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0x14120d, 0.012);

const camera = new THREE.PerspectiveCamera(58, container.clientWidth / container.clientHeight, 0.1, 110);
const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
const quality = resolveQuality(renderer);
applyQuality(renderer, quality);
setModelTextureLimit(quality.name === 'low' ? 512 : 0);   // antes de qualquer GLB ser carregado
renderer.shadowMap.enabled = true;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
container.prepend(renderer.domElement);
renderer.setSize(container.clientWidth, container.clientHeight);
initPBR(renderer, quality);

const hallGroup = new THREE.Group();
const streetGroup = new THREE.Group();
const hospitalGroup = new THREE.Group();
hallGroup.name = 'RPDMainHall';
streetGroup.name = 'RaccoonCityStreet';
hospitalGroup.name = 'AbandonedHospital';
scene.add(hallGroup, streetGroup, hospitalGroup);
const hallWorld = buildPoliceStation(hallGroup);
// Quais assets opcionais do hospital existem em /models/hospital/ (ver manifest.json). Sem arquivos: tudo procedural.
const hospitalAssets = await loadHospitalAssets();
const hospitalDoor = hospitalAssets.doorLeafL && hospitalAssets.doorLeafR
  ? { left: hospitalAssets.doorLeafL, right: hospitalAssets.doorLeafR } : null;
const streetWorld = buildCityStreet(streetGroup, { hospitalExterior: hospitalAssets.exterior ?? null, hospitalDoor });
const hospitalWorld = buildHospital(hospitalGroup, hospitalAssets);
configureGroupShadows(hallGroup, quality);
configureGroupShadows(streetGroup, quality);
configureGroupShadows(hospitalGroup, quality);
hallGroup.visible = true;
streetGroup.visible = false;
hospitalGroup.visible = false;
// O jogador mantém um CollisionWorld próprio. Antes, a troca de cena
// sobrescrevia os arrays do saguão com os da rua, e ao voltar a delegacia
// herdava as colisões erradas. Agora só copiamos de/para este objeto ativo.
const activeCollisions = new CollisionWorld();
function copyCollisions(target, source) {
  target.boxes.splice(0, target.boxes.length, ...source.boxes);
  target.ramps.splice(0, target.ramps.length, ...source.ramps);
  target.platforms.splice(0, target.platforms.length, ...source.platforms);
  target.floors.splice(0, target.floors.length, ...source.floors);
}
copyCollisions(activeCollisions, hallWorld.collisions);
const world = { ...hallWorld, collisions: activeCollisions };
let activeLocation = 'hall';
const environment = createEnvironment(renderer, scene);
const postfx = createPostFX(renderer, scene, camera, { quality });
const audio = createAudio();
const storm = createStorm({ scene, camera, environment, audio, quality });
const overlay = document.querySelector('#overlay');
const startButton = document.querySelector('#start');
for (const button of document.querySelectorAll('[data-quality]')) {
  button.classList.toggle('active', button.dataset.quality === quality.name);
  button.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    try { window.localStorage.setItem('rpd-quality', button.dataset.quality); } catch { /* sem storage */ }
    const url = new URL(window.location.href);
    url.searchParams.set('q', button.dataset.quality);
    window.location.href = url.toString();
  });
}
const reticle = document.querySelector('#reticle');
const ammoHud = document.querySelector('#ammo-hud');
let started = false;
let hasPointerLock = false;
let player;
let interaction;
let touchControls = null;
let keepAwake = () => {};   // celular: impede a tela de apagar durante o jogo (precisa de HTTPS)
const locationLabel = document.querySelector('.location');
const sceneFade = document.createElement('div');
sceneFade.id = 'scene-fade';
container.append(sceneFade);
let sceneTransitionPending = false;
// Cada cenário: mundo (colisão, props, update), grupo 3D, rótulo, neblina e aviso ao entrar.
const SCENES = {
  hall: {
    world: hallWorld, group: hallGroup, fog: [0x14120d, 0.012],
    label: 'RACCOON POLICE DEPARTMENT · SAGUÃO PRINCIPAL',
    toast: 'Você voltou ao saguão principal do R.P.D.',
  },
  street: {
    world: streetWorld, group: streetGroup, fog: [0x0d1114, 0.008],
    label: 'RACCOON CITY · RUA EM CHAMAS',
    toast: 'Você chegou à rua. A porta do R.P.D. permanece aberta.',
  },
  hospital: {
    world: hospitalWorld, group: hospitalGroup, fog: [0x070a09, 0.02],
    label: 'RACCOON CITY · HOSPITAL ABANDONADO',
    toast: 'O ar é pesado. O hospital foi evacuado às pressas — e ninguém voltou.',
  },
};
function switchScene(destination, spawn) {
  if (activeLocation === destination || sceneTransitionPending || !SCENES[destination]) return;
  sceneTransitionPending = true;
  sceneFade.classList.add('active');
  window.setTimeout(() => {
    const target = SCENES[destination];
    const nextWorld = target.world;
    for (const entry of Object.values(SCENES)) {
      entry.world.resetEntrance();
      entry.group.visible = entry === target;
    }
    activeLocation = destination;
    copyCollisions(world.collisions, nextWorld.collisions);    world.occluders = nextWorld.occluders;
    world.update = nextWorld.update;
    world.props = nextWorld.props;
    player.teleport(spawn || nextWorld.spawn);
    interaction.setItems(nextWorld.props);
    locationLabel.textContent = target.label;
    scene.fog.color.set(target.fog[0]);
    scene.fog.density = target.fog[1];
    environment.apply(destination);
    audio.setEnvironment(destination);
    interaction.toast(target.toast);
    requestAnimationFrame(() => {
      sceneFade.classList.remove('active');
      sceneTransitionPending = false;
    });
  }, 180);
}
const requestPointerLock = () => {
  if (isTouchDevice) return; // celular não tem pointer lock: a câmera é controlada pelo arrasto do dedo
  try { const request = renderer.domElement.requestPointerLock?.(); request?.catch?.(() => {}); } catch { /* mouse livre continua funcionando */ }
};
const inventory = createInventory({
  element: document.querySelector('#inventory'),
  onReload() {
    player?.startReload();
    audio.reload();
  },
  onToggle(open) {
    if (!player) return;
    touchControls?.reset();
    player.setPaused(open);
    player.setActive(started && !open);
    if (open) {
      if (document.pointerLockElement === renderer.domElement) document.exitPointerLock?.();
    } else if (started) requestPointerLock();
  },
});
player = createPlayer({
  scene, world, camera, dom: renderer.domElement, audio, inventory, quality,
});

// ── Vida do jogador ──
const health = { hp: 100, max: 100, dead: false };
const healthSegments = [...document.querySelectorAll('#hud .health span')];
const hudValue = document.querySelector('#hud .hud-value');
const damageFlash = document.querySelector('#damage-flash');
const deathScreen = document.querySelector('#death');
function renderHealth() {
  const lit = Math.ceil((health.hp / health.max) * healthSegments.length);
  const tier = health.hp > 60 ? 'fine' : health.hp > 30 ? 'caution' : 'danger';
  healthSegments.forEach((segment, index) => { segment.style.opacity = index < lit ? '1' : '0.14'; });
  hudValue.textContent = health.dead ? 'DEAD' : tier.toUpperCase();
  const color = { fine: '#7e9b65', caution: '#c7a73c', danger: '#b8352b' }[tier];
  healthSegments.forEach((segment) => { segment.style.background = color; segment.style.boxShadow = `0 0 5px ${color}88`; });
  hudValue.style.color = color;
}
function damagePlayer(amount) {
  if (health.dead) return;
  health.hp = Math.max(0, health.hp - amount);
  audio.playerHurt();
  if (isTouchDevice) { try { navigator.vibrate?.(health.hp <= 0 ? [160, 60, 260] : 90); } catch { /* sem vibração */ } }
  damageFlash.classList.remove('hit'); void damageFlash.offsetWidth; damageFlash.classList.add('hit');
  renderHealth();
  if (health.hp <= 0) {
    health.dead = true;
    renderHealth();
    hasPointerLock = false;
    player.setActive(false);
    touchControls?.hide();
    document.exitPointerLock?.();
    window.setTimeout(() => deathScreen.classList.add('show'), 900);
  }
}
document.querySelector('#retry')?.addEventListener('click', () => window.location.reload());
renderHealth();

// ── Inimigos (zumbis) ──
const enemies = createEnemies({
  scene,
  locations: {
    hall: { group: hallGroup, collisions: hallWorld.collisions },
    street: { group: streetGroup, collisions: streetWorld.collisions },
    hospital: { group: hospitalGroup, collisions: hospitalWorld.collisions },
  },
  getPlayer: () => player,
  getActiveCollisions: () => activeCollisions,
  audio,
  quality,
  onPlayerDamage: damagePlayer,
});
enemies.init().catch((error) => console.error('Falha ao carregar os zumbis:', error));
player.setShotHandler((shot) => enemies.onPlayerShot({ ...shot, location: activeLocation }));
player.setShotProbe((shot) => enemies.probe({ ...shot, location: activeLocation }));

interaction = createInteraction({
  promptEl: document.querySelector('#prompt'),
  toastEl: document.querySelector('#toast'),
  addAmmo: inventory.addAmmo,
  onTransition: switchScene,
});
interaction.setItems(world.props);

// ── Celular / tablet ──
function pauseGame() {
  if (!started || health.dead || inventory.isOpen) return;
  player.setActive(false);
  touchControls?.reset();
  touchControls?.hide();
  overlay.style.display = 'flex';
  startButton.textContent = 'RETOMAR';
}
if (isTouchDevice) {
  touchControls = createTouchControls({
    container,
    player,
    actions: {
      reload: () => inventory.reload(),
      use: () => { interaction.use(); audio.interaction(); },
      flash: () => player.toggleFlashlight(),
      items: () => inventory.open(),
      pause: pauseGame,
    },
  });
  // Sensibilidade da câmera (tela inicial)
  const sensButtons = [...document.querySelectorAll('[data-sens]')];
  const markSens = (step) => sensButtons.forEach((b) => b.classList.toggle('active', b.dataset.sens === step));
  markSens(getStoredSensitivity());
  for (const button of sensButtons) {
    button.addEventListener('click', (event) => {
      event.preventDefault();
      touchControls.setSensitivity(button.dataset.sens);
      markSens(button.dataset.sens);
    });
  }
  // Pausa sozinho se o jogador girar para retrato ou sair do navegador
  window.matchMedia('(orientation: portrait)').addEventListener?.('change', (event) => { if (event.matches) pauseGame(); });
  keepAwake = async () => {
    try { await navigator.wakeLock?.request('screen'); } catch { /* sem wake lock */ }
  };
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) pauseGame();
    else if (started) keepAwake();
  });
}

window.addEventListener('keydown', (e) => {
  if (inventory.isOpen) {
    if (['Escape', 'KeyI', 'Tab'].includes(e.code)) { e.preventDefault(); inventory.close(); }
    else if (e.code === 'KeyR' && !e.repeat) {
      e.preventDefault();
      inventory.reload();
    }
    return;
  }
  if (!started || health.dead) return;
  if (e.code === 'KeyI' || e.code === 'Tab') { e.preventDefault(); inventory.open(); return; }
  if (e.code === 'KeyR' && !e.repeat) {
    inventory.reload();
    return;
  }
  if (e.code === 'KeyE' && !e.repeat) { interaction.use(); audio.interaction(); }
});

// ── Início / pausa com pointer lock para controlar a mira ──
startButton.addEventListener('click', () => {
  started = true;
  player.setActive(true);
  overlay.style.display = 'none';
  try { audio.start(); } catch (error) { console.warn('Áudio indisponível neste navegador:', error); }
  requestPointerLock();
  if (touchControls && !health.dead) {
    touchControls.show();
    keepAwake();
    // Tela cheia + paisagem (Android/iPad). No iPhone o Safari não permite: use "Adicionar à Tela de Início".
    const enter = container.requestFullscreen?.bind(container) ?? container.webkitRequestFullscreen?.bind(container);
    if (enter && !document.fullscreenElement && !document.webkitFullscreenElement) {
      Promise.resolve(enter()).then(() => screen.orientation?.lock?.('landscape')).catch(() => {});
    }
  }
});
document.addEventListener('pointerlockchange', () => {
  if (document.pointerLockElement === renderer.domElement) {
    hasPointerLock = true;
    if (started && !inventory.isOpen) player.setActive(true);
  } else if (inventory.isOpen) {
    hasPointerLock = false;
  } else if (started && hasPointerLock) {
    player.setActive(false);
    overlay.style.display = 'flex';
    startButton.textContent = 'RETOMAR';
    hasPointerLock = false;
  }
});
renderer.domElement.addEventListener('click', () => {
  if (!isTouchDevice && started && !inventory.isOpen && document.pointerLockElement !== renderer.domElement) requestPointerLock();
});

window.addEventListener('resize', () => {
  const aspect = container.clientWidth / container.clientHeight;
  camera.aspect = aspect;
  camera.updateProjectionMatrix();
  renderer.setSize(container.clientWidth, container.clientHeight);
  postfx.setSize(container.clientWidth, container.clientHeight);
});

// Gancho de depuração (console: __rpd.player.state)
window.__rpd = {
  // THREE só em desenvolvimento: expor o namespace inteiro impede o tree-shaking e infla o bundle de produção.
  ...(import.meta.env.DEV ? { THREE } : {}),
  scene, camera, player, world, renderer, audio, inventory, postfx, environment, switchScene, quality, storm,
  activeCollisions, hallWorld, streetWorld, hospitalWorld, enemies, health, damagePlayer,
  touchControls, isTouchDevice,
  step: (dt = 1 / 60) => frame(dt),
};

const clock = new THREE.Clock();
let t = 0;
function frame(dt) {
  t += dt;
  player.update(dt);
  world.update(t, dt, camera.position);
  storm.update(dt, activeLocation, streetWorld);
  if (player.state.active && !player.state.paused) enemies.update(dt, activeLocation);
  interaction.update(dt, player.state);
  reticle.classList.toggle('on', player.state.aimT > 0.5);
  const aimPoint = player.aimScreenPosition();
  if (aimPoint) {
    reticle.style.left = `${(aimPoint.x + 1) * 50}%`;
    reticle.style.top = `${(1 - aimPoint.y) * 50}%`;
  }
  const ammo = inventory.ammo;
  ammoHud.textContent = `${ammo.magazine} / ${ammo.reserve}`;
  if (touchControls) {
    touchControls.setUseTarget(interaction.target?.label ?? null);
    touchControls.setAmmoEmpty(ammo.magazine <= 0);
  }
  postfx.render(dt);
}
function animate() {
  requestAnimationFrame(animate);
  frame(Math.min(clock.getDelta(), 0.05));
}
// ?manual desliga o loop automático (usado em testes automatizados)
if (!new URLSearchParams(location.search).has('manual')) animate();
