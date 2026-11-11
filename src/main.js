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
import { initPBR } from './render/pbr.js';
import { createEnvironment } from './render/environment.js';
import { createPostFX } from './render/postfx.js';
import { resolveQuality, applyQuality, configureGroupShadows } from './render/quality.js';

const container = document.querySelector('#game');
const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0x14120d, 0.012);

const camera = new THREE.PerspectiveCamera(58, container.clientWidth / container.clientHeight, 0.1, 110);
const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
const quality = resolveQuality(renderer);
applyQuality(renderer, quality);
renderer.shadowMap.enabled = true;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
container.prepend(renderer.domElement);
renderer.setSize(container.clientWidth, container.clientHeight);
initPBR(renderer);

const hallGroup = new THREE.Group();
const streetGroup = new THREE.Group();
hallGroup.name = 'RPDMainHall';
streetGroup.name = 'RaccoonCityStreet';
scene.add(hallGroup, streetGroup);
const hallWorld = buildPoliceStation(hallGroup);
const streetWorld = buildCityStreet(streetGroup);
configureGroupShadows(hallGroup, quality);
configureGroupShadows(streetGroup, quality);
hallGroup.visible = true;
streetGroup.visible = false;
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
const locationLabel = document.querySelector('.location');
const sceneFade = document.createElement('div');
sceneFade.id = 'scene-fade';
container.append(sceneFade);
let sceneTransitionPending = false;
function switchScene(destination, spawn) {
  if (activeLocation === destination || sceneTransitionPending) return;
  sceneTransitionPending = true;
  sceneFade.classList.add('active');
  window.setTimeout(() => {
    const nextWorld = destination === 'street' ? streetWorld : hallWorld;
    hallWorld.resetEntrance();
    streetWorld.resetEntrance();
    activeLocation = destination;
    hallGroup.visible = destination === 'hall';
    streetGroup.visible = destination === 'street';
    copyCollisions(world.collisions, nextWorld.collisions);    world.occluders = nextWorld.occluders;
    world.update = nextWorld.update;
    world.props = nextWorld.props;
    player.teleport(spawn || nextWorld.spawn);
    interaction.setItems(nextWorld.props);
    locationLabel.textContent = destination === 'street'
      ? 'RACCOON CITY · RUA EM CHAMAS'
      : 'RACCOON POLICE DEPARTMENT · SAGUÃO PRINCIPAL';
    scene.fog.color.set(destination === 'street' ? 0x0d1114 : 0x14120d);
    scene.fog.density = destination === 'street' ? 0.008 : 0.012;
    environment.apply(destination);
    audio.setEnvironment(destination);
    interaction.toast(destination === 'street'
      ? 'Você chegou à rua. A porta do R.P.D. permanece aberta.'
      : 'Você voltou ao saguão principal do R.P.D.');
    requestAnimationFrame(() => {
      sceneFade.classList.remove('active');
      sceneTransitionPending = false;
    });
  }, 180);
}
const requestPointerLock = () => {
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
  damageFlash.classList.remove('hit'); void damageFlash.offsetWidth; damageFlash.classList.add('hit');
  renderHealth();
  if (health.hp <= 0) {
    health.dead = true;
    renderHealth();
    hasPointerLock = false;
    player.setActive(false);
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
  },
  getPlayer: () => player,
  getActiveCollisions: () => activeCollisions,
  audio,
  quality,
  onPlayerDamage: damagePlayer,
});
enemies.init().catch((error) => console.error('Falha ao carregar os zumbis:', error));
player.setShotHandler((shot) => enemies.onPlayerShot({ ...shot, location: activeLocation }));

interaction = createInteraction({
  promptEl: document.querySelector('#prompt'),
  toastEl: document.querySelector('#toast'),
  addAmmo: inventory.addAmmo,
  onTransition: switchScene,
});
interaction.setItems(world.props);
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
  if (started && !inventory.isOpen && document.pointerLockElement !== renderer.domElement) requestPointerLock();
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
  THREE, scene, camera, player, world, renderer, audio, inventory, postfx, environment, switchScene, quality,
  activeCollisions, hallWorld, streetWorld, enemies, health, damagePlayer,
  step: (dt = 1 / 60) => frame(dt),
};

const clock = new THREE.Clock();
let t = 0;
function frame(dt) {
  t += dt;
  player.update(dt);
  world.update(t, dt, camera.position);
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
  postfx.render(dt);
}
function animate() {
  requestAnimationFrame(animate);
  frame(Math.min(clock.getDelta(), 0.05));
}
// ?manual desliga o loop automático (usado em testes automatizados)
if (!new URLSearchParams(location.search).has('manual')) animate();
