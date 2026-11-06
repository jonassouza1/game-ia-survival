import * as THREE from 'three';
import './style.css';
import { buildPoliceStation } from './world/policeStation.js';
import { buildCityStreet } from './world/cityStreet.js';
import { createPlayer } from './player/player.js';
import { createInteraction } from './systems/interaction.js';
import { createAudio } from './systems/audio.js';
import { createInventory } from './systems/inventory.js';
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
const world = { ...hallWorld };
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
    world.collisions.boxes.splice(0, world.collisions.boxes.length, ...nextWorld.collisions.boxes);
    world.collisions.ramps.splice(0, world.collisions.ramps.length, ...nextWorld.collisions.ramps);
    world.collisions.platforms.splice(0, world.collisions.platforms.length, ...nextWorld.collisions.platforms);
    world.collisions.floors.splice(0, world.collisions.floors.length, ...nextWorld.collisions.floors);
    world.occluders = nextWorld.occluders;
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
  if (!started) return;
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
  step: (dt = 1 / 60) => frame(dt),
};

const clock = new THREE.Clock();
let t = 0;
function frame(dt) {
  t += dt;
  player.update(dt);
  world.update(t, dt, camera.position);
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
