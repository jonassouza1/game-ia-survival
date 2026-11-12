import * as THREE from 'three';
import { loadZombieModel, createZombieActor, raycastActor, ZONE_DAMAGE } from './zombieRig.js';
import { MODELS, LOCATIONS } from './roster.js';

const { clamp, lerp } = THREE.MathUtils;
const UP = new THREE.Vector3(0, 1, 0);
const angleDiff = (a, b) => ((b - a + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;

const TUNING = {
  hp: 100,
  radius: 0.38,
  speed: [0.62, 0.86],         // m/s — o clipe de caminhada é um arrastar lento (o jogador anda a 2.75; mirando, 1.18)
  attackRange: 1.15,
  attackReach: 1.5,
  attackStrike: 0.42,          // instante do contato dentro do clipe de ataque (1,05 s de 2,5 s)
  attackDamage: 20,            // 5 mordidas = morte (5 segmentos na vida)
  turnRate: 3.6,
  groanEvery: [3.2, 7.5],
  // Atordoamento (s) ao ser atingido, por zona
  stagger: { head: 0.7, neck: 0.6, chest: 0.5, abdomen: 0.45, arm: 0.25, leg: 0.4 },
  // Força da reação do corpo, por zona
  reaction: { head: 1.7, neck: 1.3, chest: 1.0, abdomen: 0.9, arm: 0.6, leg: 0.8 },
};

function makeBlotTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(64, 64, 4, 64, 64, 62);
  grad.addColorStop(0, 'rgba(70,4,4,0.95)'); grad.addColorStop(0.6, 'rgba(52,3,3,0.85)'); grad.addColorStop(1, 'rgba(30,2,2,0)');
  g.fillStyle = grad; g.beginPath(); g.arc(64, 64, 62, 0, Math.PI * 2); g.fill();
  // bordas irregulares e gotas
  for (let i = 0; i < 26; i++) {
    const a = Math.random() * Math.PI * 2, r = 36 + Math.random() * 24, s = 3 + Math.random() * 9;
    g.fillStyle = `rgba(${48 + Math.random() * 30},3,3,${0.5 + Math.random() * 0.4})`;
    g.beginPath(); g.arc(64 + Math.cos(a) * r, 64 + Math.sin(a) * r, s, 0, Math.PI * 2); g.fill();
  }
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
function makeDotTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 32;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(16, 16, 1, 16, 16, 15);
  grad.addColorStop(0, 'rgba(255,255,255,1)'); grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad; g.fillRect(0, 0, 32, 32);
  return new THREE.CanvasTexture(c);
}


// ── Pathfinding (A* em grade) — usado só quando o zumbi trava num obstáculo ──
function findPath(col, sx, sz, gx, gz, y, radius = 0.36) {
  const cell = 0.5;
  const pad = 9;
  const minX = Math.min(sx, gx) - pad, minZ = Math.min(sz, gz) - pad;
  const w = Math.ceil((Math.abs(gx - sx) + pad * 2) / cell), h = Math.ceil((Math.abs(gz - sz) + pad * 2) / cell);
  if (w * h > 6000) return null;
  const toCell = (x, z) => [clamp(Math.round((x - minX) / cell), 0, w - 1), clamp(Math.round((z - minZ) / cell), 0, h - 1)];
  const toWorld = (cx, cz) => ({ x: minX + cx * cell, z: minZ + cz * cell });
  const walk = new Int8Array(w * h);                       // 0 = desconhecido, 1 = livre, -1 = bloqueado
  const free = (cx, cz) => {
    if (cx < 0 || cz < 0 || cx >= w || cz >= h) return false;
    const k = cz * w + cx;
    if (walk[k]) return walk[k] > 0;
    const p = toWorld(cx, cz);
    const f = col.floorY(p.x, p.z, y);
    const ok = f !== null && f !== undefined && Math.abs(f - y) < 0.6 && !col.collides(p.x, p.z, radius, y);
    walk[k] = ok ? 1 : -1;
    return ok;
  };
  let [sxC, szC] = toCell(sx, sz), [gxC, gzC] = toCell(gx, gz);
  // objetivo bloqueado (ex.: dentro de um móvel): procura a célula livre mais próxima
  if (!free(gxC, gzC)) {
    let found = false;
    for (let r = 1; r < 8 && !found; r++) for (let dx = -r; dx <= r && !found; dx++) for (let dz = -r; dz <= r && !found; dz++) {
      if (Math.max(Math.abs(dx), Math.abs(dz)) === r && free(gxC + dx, gzC + dz)) { gxC += dx; gzC += dz; found = true; }
    }
    if (!found) return null;
  }
  const open = [[sxC, szC, 0, 0]];                         // x, z, g, f
  const g = new Float32Array(w * h).fill(Infinity), from = new Int32Array(w * h).fill(-1), closed = new Uint8Array(w * h);
  g[szC * w + sxC] = 0;
  const hFn = (x, z) => Math.hypot(x - gxC, z - gzC);
  const dirs = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, 1.414], [1, -1, 1.414], [-1, 1, 1.414], [-1, -1, 1.414]];
  let iterations = 0;
  while (open.length && iterations++ < 4000) {
    let bi = 0;
    for (let i = 1; i < open.length; i++) if (open[i][3] < open[bi][3]) bi = i;
    const [cx, cz, cg] = open.splice(bi, 1)[0];
    const ck = cz * w + cx;
    if (closed[ck]) continue;
    closed[ck] = 1;
    if (cx === gxC && cz === gzC) {
      const path = [];
      for (let k = ck; k !== -1; k = from[k]) path.push(toWorld(k % w, Math.floor(k / w)));
      path.reverse();
      // simplifica: remove pontos colineares
      const out = [];
      for (let i = 0; i < path.length; i++) {
        const a = out[out.length - 1], b = path[i], c = path[i + 1];
        if (a && c && Math.abs((b.x - a.x) * (c.z - b.z) - (b.z - a.z) * (c.x - b.x)) < 1e-4) continue;
        out.push(b);
      }
      out.shift();
      return out;
    }
    for (const [dx, dz, cost] of dirs) {
      const nx = cx + dx, nz = cz + dz;
      if (!free(nx, nz)) continue;
      if (dx && dz && (!free(cx + dx, cz) || !free(cx, cz + dz))) continue;   // sem cortar quinas
      const nk = nz * w + nx, ng = cg + cost;
      if (ng < g[nk]) { g[nk] = ng; from[nk] = ck; open.push([nx, nz, ng, ng + hFn(nx, nz)]); }
    }
  }
  return null;
}

export function createEnemies({ scene, locations, getPlayer, getActiveCollisions, audio, onPlayerDamage, quality }) {
  const zombies = [];
  const groups = [];
  const victims = [];
  let ready = false;
  let active = 'hall';
  let clock = 0;

  // ── Sangue ──────────────────────────────────────────────────────────────
  const blotTexture = makeBlotTexture();
  const blotMaterial = new THREE.MeshBasicMaterial({
    map: blotTexture, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2,
    color: 0xffffff, fog: true,
  });
  const blotGeometry = new THREE.CircleGeometry(0.5, 20).rotateX(-Math.PI / 2);
  const decals = [];
  let decalCursor = 0;
  function addDecal(loc, x, y, z, size) {
    let d = decals[decalCursor];
    if (!d) { d = new THREE.Mesh(blotGeometry, blotMaterial); d.renderOrder = 2; decals[decalCursor] = d; }
    decalCursor = (decalCursor + 1) % 70;
    locations[loc].group.add(d);
    d.position.set(x, y + 0.012 + (decalCursor % 7) * 0.0006, z);
    d.rotation.y = Math.random() * Math.PI * 2;
    d.scale.setScalar(size);
    return d;
  }

  const MAX_PARTICLES = 320;
  const pPos = new Float32Array(MAX_PARTICLES * 3).fill(-999);
  const pVel = new Float32Array(MAX_PARTICLES * 3);
  const pLife = new Float32Array(MAX_PARTICLES);
  const pLoc = new Array(MAX_PARTICLES).fill('street');
  const pGeo = new THREE.BufferGeometry();
  pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3));
  const pMat = new THREE.PointsMaterial({
    color: 0x7a0b09, size: 0.07, sizeAttenuation: true, transparent: true, opacity: 0.95,
    depthWrite: false, map: makeDotTexture(), alphaTest: 0.02,
  });
  const particles = new THREE.Points(pGeo, pMat);
  particles.frustumCulled = false;
  particles.renderOrder = 5;
  scene.add(particles);
  let pCursor = 0;
  function spray(loc, point, dir, count, speed = 2.2, spread = 0.9) {
    for (let i = 0; i < count; i++) {
      const k = pCursor; pCursor = (pCursor + 1) % MAX_PARTICLES;
      pPos[k * 3] = point.x; pPos[k * 3 + 1] = point.y; pPos[k * 3 + 2] = point.z;
      const s = speed * (0.35 + Math.random() * 0.9);
      pVel[k * 3] = dir.x * s + (Math.random() - 0.5) * spread * 2.2;
      pVel[k * 3 + 1] = dir.y * s + Math.random() * 1.6 + 0.3;
      pVel[k * 3 + 2] = dir.z * s + (Math.random() - 0.5) * spread * 2.2;
      pLife[k] = 0.5 + Math.random() * 0.9;
      pLoc[k] = loc;
    }
  }
  function updateParticles(dt) {
    const col = (loc) => locations[loc].collisions;
    for (let k = 0; k < MAX_PARTICLES; k++) {
      if (pLife[k] <= 0) continue;
      pLife[k] -= dt;
      pVel[k * 3 + 1] -= 9.2 * dt;
      pPos[k * 3] += pVel[k * 3] * dt; pPos[k * 3 + 1] += pVel[k * 3 + 1] * dt; pPos[k * 3 + 2] += pVel[k * 3 + 2] * dt;
      const floor = col(pLoc[k]).floorY(pPos[k * 3], pPos[k * 3 + 2], pPos[k * 3 + 1] + 0.3);
      const groundY = floor ?? 0;
      if (pPos[k * 3 + 1] <= groundY + 0.02) {
        if (Math.random() < 0.3) addDecal(pLoc[k], pPos[k * 3], groundY, pPos[k * 3 + 2], 0.12 + Math.random() * 0.22);
        pLife[k] = 0;
      }
      if (pLife[k] <= 0) { pPos[k * 3 + 1] = -999; }
    }
    pGeo.attributes.position.needsUpdate = true;
    // só mostra partículas do cenário ativo (o resto some em <1 s de qualquer forma)
  }

  function bloodPool(loc, x, y, z, finalSize, growSeconds, startAge = 0) {
    const mesh = new THREE.Mesh(blotGeometry, blotMaterial);
    mesh.renderOrder = 1;
    mesh.position.set(x, y + 0.008, z);
    mesh.rotation.y = Math.random() * Math.PI * 2;
    locations[loc].group.add(mesh);
    const pool = { mesh, size: finalSize, grow: growSeconds, age: startAge };
    mesh.scale.setScalar(Math.max(0.05, finalSize * clamp(startAge / growSeconds, 0, 1)));
    victims.push(pool);
    return pool;
  }

  // ── Criação ────────────────────────────────────────────────────────────
  // Se um modelo não carregar (arquivo ausente / nome errado), usa o SWAT no lugar e avisa no console:
  // um modelo com problema não pode derrubar o carregamento de todos os zumbis.
  async function loadModelSafe(name) {
    try {
      return await loadZombieModel(MODELS[name]);
    } catch (error) {
      console.warn(`[zumbis] modelo "${name}" (${MODELS[name]?.url}) não carregou — usando o SWAT no lugar. Confira o nome do arquivo em public/models/zombies/.`, error);
      return loadZombieModel(MODELS.swat);
    }
  }

  async function spawnZombie(loc, group, member, x, z, yaw, y, place = null) {
    const model = await loadModelSafe(member.model);
    const actor = createZombieActor(model, member.look, { castShadow: quality?.shadows !== 'none' });
    if (place) ({ x, z, yaw } = place(actor));
    const rand = Math.random;
    const z0 = {
      id: zombies.length, loc, group, actor, x, z, y, yaw, modelName: member.model,
      hp: TUNING.hp, state: group.kind === 'feed' ? 'feed' : 'idle',
      speed: lerp(TUNING.speed[0], TUNING.speed[1], rand()), stagger: 0, knock: new THREE.Vector3(),
      wakeAt: 0, groanTimer: 1 + rand() * 4, attackCooldown: 0, attackHitDone: false,
      stuck: 0, detour: 0, detourSign: rand() < 0.5 ? -1 : 1, lastX: x, lastZ: z, frozen: false,
    };
    actor.setMode(z0.state === 'feed' ? 'feed' : 'stand');
    actor.root.position.set(x, y, z);
    actor.root.rotation.y = yaw;
    locations[loc].group.add(actor.root);
    zombies.push(z0);
    group.zombies.push(z0);
    return z0;
  }


  // Vítima caída no centro + zumbis de bruços ao redor, com a cabeça sobre o corpo dela.
  async function setupFeast(loc, group, g, floorY) {
    const { x: cx, z: cz } = g.center;
    const model = await loadModelSafe(g.victim.model);
    const victim = createZombieActor(model, g.victim.look, { castShadow: true });
    victim.startDeath({ instant: true });
    const yaw = g.victim.yaw, c = Math.cos(yaw), s = Math.sin(yaw);
    const rot = (x, z) => [x * c + z * s, -x * s + z * c];                      // local → mundo (yaw)
    const lp = victim.lyingPose;
    const [hx, hz] = rot(lp.hips[0], lp.hips[1]);
    victim.root.position.set(cx - hx, floorY, cz - hz);                          // quadril da vítima no centro
    victim.root.rotation.y = yaw;
    locations[loc].group.add(victim.root);
    victim.root.updateMatrixWorld(true);
    group.victim = victim;
    // eixo da vítima (quadril → cabeça) no mundo
    const [ax0, az0] = rot(lp.head[0] - lp.hips[0], lp.head[1] - lp.hips[1]);
    const al = Math.hypot(ax0, az0), ax = ax0 / al, az = az0 / al, px = az, pz = -ax;
    bloodPool(loc, cx, floorY, cz, 2.7, 1, 1);
    bloodPool(loc, cx + ax * 0.5, floorY, cz + az * 0.5, 1.7, 1, 1);

    // posições (s ao longo do corpo: + cabeça; l lateral) de onde cada zumbi come
    const slots = [{ s: 0.5, l: 0.42 }, { s: 1.0, l: -0.45 }, { s: -0.25, l: -0.45 }, { s: -0.85, l: 0.42 }, { s: -1.6, l: 0 }];
    const jobs = g.members.map(async (m, i) => {
      const slot = slots[i % slots.length];
      const place = (actor) => {
        const fp = actor.feedPose;
        const phi = Math.atan2(fp.head[0] - fp.hips[0], fp.head[1] - fp.hips[1]);   // para onde o corpo aponta (local)
        const hxw = cx + ax * slot.s + px * slot.l, hzw = cz + az * slot.s + pz * slot.l;
        // direção "do corpo para a cabeça": rumo ao centro da vítima
        const tx = slot.l === 0 ? ax : -Math.sign(slot.l) * px, tz = slot.l === 0 ? az : -Math.sign(slot.l) * pz;
        const zYaw = Math.atan2(tx, tz) - phi + (Math.random() - 0.5) * 0.25;
        const zc = Math.cos(zYaw), zs = Math.sin(zYaw);
        return { yaw: zYaw, x: hxw - (fp.head[0] * zc + fp.head[1] * zs), z: hzw - (-fp.head[0] * zs + fp.head[1] * zc) };
      };
      return spawnZombie(loc, group, m, 0, 0, 0, floorY, place);
    });
    await Promise.all(jobs);
  }

  async function init() {
    const tasks = [];
    for (const [loc, cfg] of Object.entries(LOCATIONS)) {
      for (const g of cfg.groups) {
        const group = { ...g, loc, zombies: [], awake: false };
        groups.push(group);
        const floorY = cfg.floorY ?? 0;
        if (g.kind === 'feed') {
          tasks.push(setupFeast(loc, group, g, floorY));
        } else {
          g.members.forEach((m) => tasks.push(spawnZombie(loc, group, m, m.x, m.z, m.yaw, floorY)));
        }
      }
    }
    const results = await Promise.allSettled(tasks);
    results.filter((r) => r.status === 'rejected').forEach((r) => console.error('Falha ao montar um grupo de zumbis:', r.reason));
    ready = true;
    for (const [loc, cfg] of Object.entries(LOCATIONS)) {
      for (const z of zombies) if (z.loc === loc) z.actor.root.visible = true;
    }
  }

  // ── Percepção / despertar ──────────────────────────────────────────────
  function wakeGroup(group, quick = false, culprit = null) {
    if (group.awake) return;
    group.awake = true;
    group.zombies.forEach((z, i) => {
      if (z.state === 'dead') return;
      z.wakeAt = clock + (quick ? (z === culprit ? 0 : 0.15 + Math.random() * 0.45) : Math.random() * 0.9);
      z.waking = true;
    });
  }

  function beginRise(z) {
    z.waking = false;
    if (z.state === 'feed') {
      // desloca a raiz para o ponto em que o clipe "levantar" começa (ver riseShift)
      const [sx, sz] = z.actor.feedPose.riseShift, c = Math.cos(z.yaw), s = Math.sin(z.yaw);
      z.x += sx * c + sz * s; z.z += -sx * s + sz * c;
      z.state = 'rising';
      z.actor.setMode('rise', { timeScale: z.quickRise ? 1.5 : 1.1 + Math.random() * 0.2 });
      audio?.zombieGroan?.({ volume: 0.7, rate: 0.9 + Math.random() * 0.2 });
    } else {
      // em pé: primeiro um grito ao notar o jogador, depois persegue
      z.state = 'screaming';
      z.actor.setMode('scream', { timeScale: 1.45 + Math.random() * 0.2 });
      audio?.zombieGroan?.({ volume: 0.9, rate: 0.8 + Math.random() * 0.1 });
    }
  }

  // Largura útil da escada para o CORPO do zumbi (meia-largura): degraus têm 3 m (±1,5) e o corrimão fica
  // em ±1,38; com raio 0,38 o centro precisa ficar a ≤ 1,0 m do eixo. (A rampa de colisão aceita ±1,92,
  // folga pensada para o jogador, que deixava o zumbi andar no ar, do lado de fora da escada.)
  const STAIR_BODY_HALF = 1.0;

  function stairParam(r, zPos) {
    const span = r.zTo - r.zFrom;
    return clamp((zPos - r.zFrom) / (Math.abs(span) < 1e-6 ? 1 : span), 0, 1);
  }
  function followStairAxis(r, z, goingDown, far) {
    const up = r.yTo > r.yFrom;                       // t crescente sobe?
    const tEnd = goingDown ? (up ? 0 : 1) : (up ? 1 : 0);
    const t = stairParam(r, z.z);
    if (Math.abs(tEnd - t) < 0.14) return far;
    const t2 = clamp(t + Math.sign(tEnd - t) * 0.14, 0, 1);
    const cx = r.centerXAt ? r.centerXAt(t2) : (r.centerXFrom + (r.centerXTo - r.centerXFrom) * t2);
    return { x: cx, z: r.zFrom + (r.zTo - r.zFrom) * t2 };
  }
  // Mantém o zumbi sobre os degraus: qualquer empurrão (colisão, separação, knockback, desvio) é
  // limitado ao corredor útil da escada.
  function keepOnStairs(z, col) {
    for (const r of col.ramps) {
      if (Math.abs(r.yTo - r.yFrom) < 2) continue;
      const lo = Math.min(r.yFrom, r.yTo), zMin = Math.min(r.zFrom, r.zTo), zMax = Math.max(r.zFrom, r.zTo);
      if (z.y <= lo + 0.05 || z.z <= zMin || z.z >= zMax) continue;
      const cx = r.centerXAt ? r.centerXAt(stairParam(r, z.z)) : (r.centerXFrom + (r.centerXTo - r.centerXFrom) * stairParam(r, z.z));
      const off = z.x - cx;
      if (Math.abs(off) > r.halfWidth + 0.3) continue;          // não é desta escada
      if (Math.abs(off) > STAIR_BODY_HALF) {
        z.x = cx + Math.sign(off) * STAIR_BODY_HALF;
        z.y = col.floorY(z.x, z.z, z.y) ?? z.y;
      }
      return;
    }
  }

  // Escadas: se jogador e zumbi estão em andares diferentes, passa pelo lance de escada mais próximo.
  function stairWaypoint(z, col, py) {
    const stairs = col.ramps.filter((r) => Math.abs(r.yTo - r.yFrom) > 2);
    if (!stairs.length || Math.abs(py - z.y) < 1.6) return null;
    const endOf = (r, high) => {
      const t = high ? 1 : 0;
      const cx = r.centerXAt ? r.centerXAt(t) : (r.centerXFrom !== undefined ? r.centerXFrom + (r.centerXTo - r.centerXFrom) * t : (r.minX + r.maxX) / 2);
      return { x: cx, z: high ? r.zTo : r.zFrom };
    };
    const goingDown = z.y > py;
    let best = null, bestD = Infinity;
    for (const r of stairs) {
      const hi = Math.max(r.yFrom, r.yTo), lo = Math.min(r.yFrom, r.yTo);
      const highEnd = endOf(r, r.yTo > r.yFrom), lowEnd = endOf(r, r.yTo < r.yFrom);
      const near = goingDown ? highEnd : lowEnd, far = goingDown ? lowEnd : highEnd;
      const dNear = Math.hypot(near.x - z.x, near.z - z.z);
      // "Na escada" = na altura certa E dentro do corredor desta escada (são duas: esquerda e direita).
      const tHere = stairParam(r, z.z), cxHere = r.centerXAt ? r.centerXAt(tHere) : (r.centerXFrom + (r.centerXTo - r.centerXFrom) * tHere);
      const onRamp = z.y > lo + 0.25 && z.y < hi - 0.25 && Math.abs(z.x - cxHere) < r.halfWidth + 0.3
        && z.z > Math.min(r.zFrom, r.zTo) - 0.3 && z.z < Math.max(r.zFrom, r.zTo) + 0.3;
      // Já na escada, ou chegou na entrada dela: segue o EIXO da escada (que é curvo) com um pouco de
      // antecedência, em vez de cortar reto até a outra ponta — assim não sai pela lateral/corrimão.
      if (onRamp || dNear < 1.1) return followStairAxis(r, z, goingDown, far);
      if (dNear < bestD) { best = near; bestD = dNear; }
    }
    return best;
  }

  // ── Movimento com colisão e desvio simples ─────────────────────────────
  function moveZombie(z, col, dirX, dirZ, speed, dt) {
    const step = speed * dt;
    const tryMove = (angle) => {
      const c = Math.cos(angle), s = Math.sin(angle);
      const dx = (dirX * c - dirZ * s) * step, dz = (dirX * s + dirZ * c) * step;
      return { r: col.move(z.x, z.z, dx, dz, TUNING.radius, z.y), dx, dz };
    };
    let res = tryMove(z.detour * z.detourSign);
    const progressed = Math.hypot(res.r.x - z.x, res.r.z - z.z) / Math.max(1e-5, step);
    if (progressed < 0.35) {
      z.stuck += dt;
      if (z.stuck > 0.45 && !z.path) z.needPath = true;
      if (z.stuck > 0.25) { z.detour = z.detour > 1.3 ? 0.6 : z.detour + 0.55; z.stuck = 0; if (Math.random() < 0.3) z.detourSign *= -1; }
    } else {
      z.stuck = Math.max(0, z.stuck - dt);
      if (progressed > 0.9) z.detour = Math.max(0, z.detour - dt * 0.8);
    }
    z.x = res.r.x; z.z = res.r.z;
    z.y = col.floorY(z.x, z.z, z.y) ?? z.y;
  }

  function separate(z, col, dt) {
    for (const o of zombies) {
      if (o === z || o.loc !== z.loc || o.state === 'dead' || o.state === 'feed') continue;
      const dx = z.x - o.x, dz = z.z - o.z, d = Math.hypot(dx, dz);
      if (d > 0 && d < 0.78 && Math.abs(o.y - z.y) < 1.5) {
        const push = (0.78 - d) * 2.2 * dt;
        const r = col.move(z.x, z.z, (dx / d) * push, (dz / d) * push, TUNING.radius, z.y);
        z.x = r.x; z.z = r.z;
      }
    }
  }

  // ── Dano ───────────────────────────────────────────────────────────────
  function die(z, hit, dirLocal) {
    z.state = 'dead'; z.waking = false;
    z.actor.setLocomotion(0);
    z.actor.startDeath({ headshot: hit.zone === 'head', fromFront: dirLocal.z < 0 });
    z.deathAge = 0;
    audio?.zombieGroan?.({ volume: 0.55, rate: 0.7 + Math.random() * 0.15, dying: true });
    const deathPos = z.actor.root.position;
    z.poolAt = 1.6;
  }

  function applyHit(z, hit, dir) {
    const damage = ZONE_DAMAGE[hit.zone] ?? 20;
    z.hp -= damage;
    // Qualquer tiro acorda o grupo imediatamente
    if (!z.group.awake) { z.quickRise = true; wakeGroup(z.group, true, z); z.wakeAt = clock; }
    const dirLocal = dir.clone().applyAxisAngle(UP, -z.yaw);
    const mist = hit.zone === 'head' ? 26 : hit.zone === 'neck' ? 18 : 12;
    spray(z.loc, hit.point, dir.clone().multiplyScalar(0.6), mist, hit.zone === 'head' ? 3.4 : 2.2);
    audio?.fleshHit?.({ head: hit.zone === 'head' });
    if (z.hp <= 0) { die(z, hit, dirLocal); return true; }
    z.actor.hitReaction(dirLocal, TUNING.reaction[hit.zone] ?? 1, hit.limb ?? null);
    z.stagger = Math.max(z.stagger, TUNING.stagger[hit.zone] ?? 0.3);
    if (hit.zone === 'chest' || hit.zone === 'abdomen' || hit.zone === 'neck') z.knock.addScaledVector(dir.clone().setY(0).normalize(), 1.1);
    audio?.zombieGroan?.({ volume: 0.4, rate: 1.0 + Math.random() * 0.25 });
    return false;
  }

  // Primeiro zumbi vivo atingido pelo raio (sem aplicar dano) → { hit, zombie } ou null.
  function findHit({ origin, dir, maxDistance, location }) {
    if (!ready) return null;
    let best = null, bestZ = null;
    for (const z of zombies) {
      if (z.loc !== location || z.state === 'dead') continue;
      // descarte rápido por distância do raio ao zumbi
      const to = new THREE.Vector3(z.x - origin.x, 0.9 + z.y - origin.y, z.z - origin.z);
      const along = to.dot(dir);
      if (along < -1 || along > maxDistance + 1) continue;
      const perp = to.sub(dir.clone().multiplyScalar(along)).length();
      if (perp > 2.3) continue;
      const hit = raycastActor(z.actor, origin, dir, maxDistance);
      if (hit && (!best || hit.t < best.t)) { best = hit; bestZ = z; }
    }
    return best ? { hit: best, zombie: bestZ } : null;
  }

  // Consulta sem efeitos: onde o raio bateria num zumbi? (a mira usa isso para o retículo e para convergir o tiro)
  function probe(shot) {
    const f = findHit(shot);
    return f ? { t: f.hit.t, point: f.hit.point, zone: f.hit.zone } : null;
  }

  function onPlayerShot({ origin, dir, maxDistance, location }) {
    // Ruído do disparo acorda quem está por perto
    noise(origin.x, origin.z, origin.y, location, 26);
    const found = findHit({ origin, dir, maxDistance, location });
    if (!found) return null;
    const { hit: best, zombie: bestZ } = found;
    const killed = applyHit(bestZ, best, dir);
    return { point: best.point, zone: best.zone, killed, zombie: bestZ };
  }

  function noise(x, z, y, location, radius) {
    for (const g of groups) {
      if (g.loc !== location || g.awake) continue;
      for (const m of g.zombies) {
        if (m.state === 'dead') continue;
        if (Math.hypot(m.x - x, m.z - z) < radius && Math.abs(m.y - y) < 6) { wakeGroup(g); break; }
      }
    }
  }

  // ── Loop ───────────────────────────────────────────────────────────────
  function update(dt, activeLocation) {
    clock += dt;
    active = activeLocation;
    updateParticles(dt);
    for (const pool of victims) {
      pool.age += dt;
      pool.mesh.scale.setScalar(Math.max(0.05, pool.size * (1 - Math.pow(1 - clamp(pool.age / pool.grow, 0, 1), 2.2))));
    }
    if (!ready) return;
    const player = getPlayer();
    const S = player.state;
    const col = locations[active].collisions;

    // vítima do banquete nunca "acorda": só atualiza pose uma vez (já feita)

    // Gatilhos de despertar
    for (const g of groups) {
      if (g.loc !== active || g.awake) continue;
      if (g.kind === 'feed') {
        if (Math.hypot(S.x - g.center.x, S.z - g.center.z) < g.triggerRadius) wakeGroup(g);
      } else {
        for (const z of g.zombies) {
          if (Math.hypot(S.x - z.x, S.z - z.z) < g.wakeRadius && Math.abs(S.y - z.y) < 2.6) { wakeGroup(g); break; }
        }
      }
    }

    for (const z of zombies) {
      if (z.loc !== active) continue;
      const a = z.actor;

      if (z.state === 'dead') {
        z.deathAge += dt;
        if (z.poolAt !== undefined && z.deathAge > z.poolAt) {
          z.poolAt = undefined;
          const p = a.root.position;
          const hp = a.bones.Hips.getWorldPosition(new THREE.Vector3());
          z.pool = bloodPool(z.loc, hp.x, z.y, hp.z, 1.5 + Math.random() * 0.5, 7);
        }
        if (!z.frozen) { a.update(dt); if (a.settled && z.deathAge > 1) z.frozen = true; }
        continue;
      }

      // Despertar escalonado
      if (z.waking && clock >= z.wakeAt) beginRise(z);

      const dx = S.x - z.x, dz = S.z - z.z;
      const dist = Math.hypot(dx, dz);
      let speed = 0;
      z.stagger = Math.max(0, z.stagger - dt);

      if (z.state === 'rising' || z.state === 'screaming') {
        // encara o jogador enquanto levanta / grita
        z.yaw += clamp(angleDiff(z.yaw, Math.atan2(dx, dz)), -1.6 * dt, 1.6 * dt);
        if (z.state === 'rising' ? a.riseDone : a.screamDone) { z.state = 'chase'; a.setMode('walk'); }
      } else if (z.state === 'chase' || z.state === 'attack') {
        const desired = Math.atan2(dx, dz);
        let turn = TUNING.turnRate * (z.stagger > 0 ? 0.3 : 1);
        z.yaw += clamp(angleDiff(z.yaw, desired), -turn * dt, turn * dt);

        if (z.state === 'chase') {
          z.attackCooldown = Math.max(0, z.attackCooldown - dt);
          const sameFloor = Math.abs(S.y - z.y) < 1.6;
          if (dist < TUNING.attackRange && sameFloor && z.attackCooldown <= 0 && Math.abs(angleDiff(z.yaw, desired)) < 0.7 && z.stagger <= 0) {
            z.state = 'attack'; z.attackHitDone = false; a.setMode('attack');
          } else if (!(dist < TUNING.attackRange * 0.8 && sameFloor)) {
            // alvo de navegação: jogador ou lance de escada
            const wp = stairWaypoint(z, col, S.y);
            let tx = wp ? wp.x : S.x, tz = wp ? wp.z : S.z;
            if (z.needPath) {
              z.needPath = false;
              z.path = findPath(col, z.x, z.z, tx, tz, z.y);
              z.pathExpire = clock + 3.5;
            }
            if (z.path && clock < z.pathExpire) {
              while (z.path.length && Math.hypot(z.path[0].x - z.x, z.path[0].z - z.z) < 0.5) z.path.shift();
              if (z.path.length) { tx = z.path[0].x; tz = z.path[0].z; z.detour = 0; } else z.path = null;
            } else z.path = null;
            let mx = tx - z.x, mz = tz - z.z; const md = Math.hypot(mx, mz) || 1;
            mx /= md; mz /= md;
            const slow = z.stagger > 0 ? 0.25 : 1;
            speed = z.speed * slow;
            moveZombie(z, col, mx, mz, speed, dt);
          }
          if (z.state === 'chase') {
            // gemido periódico
            z.groanTimer -= dt;
            if (z.groanTimer <= 0) {
              z.groanTimer = lerp(TUNING.groanEvery[0], TUNING.groanEvery[1], Math.random());
              const right = new THREE.Vector3(-Math.cos(S.yaw), 0, Math.sin(S.yaw));
              const pan = dist > 0.1 ? clamp((dx * right.x + dz * right.z) / dist, -1, 1) : 0;
              audio?.zombieGroan?.({ volume: clamp(1.1 - dist / 24, 0.08, 0.8), pan, rate: 0.85 + Math.random() * 0.3 });
            }
          }
        } else { // attack
          if (a.attackProgress >= TUNING.attackStrike && !z.attackHitDone) {
            z.attackHitDone = true;
            if (dist < TUNING.attackReach && Math.abs(S.y - z.y) < 1.6) onPlayerDamage?.(TUNING.attackDamage, z);
          }
          if (a.attackProgress >= 0.97) {
            z.state = 'chase'; z.attackCooldown = 0.35 + Math.random() * 0.4; a.setMode('walk');
          }
        }
      } else if (z.state === 'idle') {
        // parado: leve rotação para o lado do jogador quando está perto
      }

      // Knockback do impacto
      if (z.knock.lengthSq() > 1e-4) {
        const r = col.move(z.x, z.z, z.knock.x * dt, z.knock.z * dt, TUNING.radius, z.y);
        z.x = r.x; z.z = r.z;
        z.knock.multiplyScalar(Math.exp(-7 * dt));
      }
      if (z.state !== 'feed') separate(z, col, dt);

      // Empurra o jogador: zumbis não são atravessáveis
      if (z.state !== 'feed' && z.state !== 'rising' && dist < 0.62 && Math.abs(S.y - z.y) < 1.5) {
        const pc = getActiveCollisions();
        const k = (0.62 - dist) * 0.6;
        const r = pc.move(S.x, S.z, (dx / (dist || 1)) * k, (dz / (dist || 1)) * k, 0.36, S.y);
        S.x = r.x; S.z = r.z;
      }

      keepOnStairs(z, col);
      a.setLocomotion(speed);
      a.root.position.set(z.x, z.y, z.z);
      a.root.rotation.y = z.yaw;
      a.update(dt);
    }
  }

  return {
    init, update, onPlayerShot, probe, noise, zombies, groups,
    get ready() { return ready; },
    stats() { return zombies.map((z) => ({ id: z.id, loc: z.loc, state: z.state, hp: z.hp, x: +z.x.toFixed(2), z: +z.z.toFixed(2) })); },
  };
}
