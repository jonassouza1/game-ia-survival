import * as THREE from 'three';

/**
 * Tempestade: nuvens, raios, clarões e trovões ligados a um único controlador.
 *
 * Cada descarga sorteia uma direção e uma distância, e dela saem juntos:
 *  - o raio visível (faixas ramificadas, só quando cai perto),
 *  - o clarão em várias piscadas (céu, nuvens, luz ambiente e a luz da rua),
 *  - o trovão, que chega depois do clarão em proporção à distância.
 *
 * A cúpula de nuvens e os raios acompanham a câmera (são "céu"), com raio menor
 * que o far da câmera (110) e dentro do teste de profundidade: prédios os cobrem.
 */
const DOME_RADIUS = 100;
const MAX_QUADS = 200;

const CLOUD_VERT = /* glsl */`
  varying vec3 vDir;
  void main() {
    vDir = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const CLOUD_FRAG = /* glsl */`
  varying vec3 vDir;
  uniform float uTime;
  uniform float uFlash;
  uniform vec3 uFlashDir;

  float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
  float vnoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
               mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
  }
  float fbm(vec2 p) {
    float a = 0.5, s = 0.0;
    for (int i = 0; i < OCT; i++) { s += a * vnoise(p); p = p * 2.02 + vec2(11.7, 5.3); a *= 0.5; }
    return s;
  }

  void main() {
    vec3 d = normalize(vDir);
    if (d.y < 0.0) discard;
    // Projeta o céu num plano alto: as nuvens afinam em perspectiva rumo ao horizonte.
    vec2 uv = d.xz / (d.y + 0.25);
    vec2 wind = vec2(uTime * 0.020, uTime * 0.008);
    float broad = fbm(uv * 1.5 + wind);
    float detail = fbm(uv * 3.6 - wind * 1.7 + 7.3);
    float dens = broad * 0.75 + detail * 0.45;
    float cover = smoothstep(0.40, 0.80, dens);
    float fade = smoothstep(0.0, 0.10, d.y);

    vec3 dark = vec3(0.003, 0.004, 0.007);
    vec3 lit = vec3(0.072, 0.085, 0.110);
    float billow = smoothstep(0.30, 0.78, detail * 0.65 + broad * 0.35 + (1.0 - cover) * 0.25);
    vec3 col = mix(dark, lit, billow);
    col += vec3(0.07, 0.03, 0.012) * pow(1.0 - d.y, 6.0) * 0.5;      // brilho do incêndio no horizonte

    // Clarão: ilumina as nuvens perto do raio e, mais fraco, o céu todo.
    float near = pow(max(dot(d, normalize(uFlashDir)), 0.0), 5.0);
    float light = uFlash * (0.18 + 0.82 * near) * (0.35 + 0.65 * detail);
    col += vec3(0.62, 0.72, 1.0) * light * 1.25;

    float alpha = cover * fade * 0.9;
    alpha = clamp(alpha + uFlash * 0.45 * near * smoothstep(0.25, 0.7, dens) * fade, 0.0, 0.97);
    gl_FragColor = vec4(col, alpha);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

const rand = (a = 0, b = 1) => a + Math.random() * (b - a);

// Envelope do clarão: pulso principal + 2 piscadas de retorno, cada uma decaindo rápido.
function makePulses(strong) {
  return strong
    ? [{ t: 0, a: 1, tau: 0.06 }, { t: rand(0.10, 0.15), a: rand(0.65, 0.9), tau: 0.08 }, { t: rand(0.26, 0.36), a: rand(0.4, 0.65), tau: 0.14 }]
    : [{ t: 0, a: 1, tau: 0.12 }, { t: rand(0.18, 0.3), a: 0.6, tau: 0.2 }];
}
function envelope(pulses, t) {
  let v = 0;
  for (const p of pulses) if (t >= p.t) v = Math.max(v, p.a * Math.exp(-(t - p.t) / p.tau));
  return v;
}

// Caminho em zigue-zague por deslocamento do ponto médio.
function jaggedPath(a, b, iterations, spread) {
  let pts = [a.clone(), b.clone()];
  let amp = a.distanceTo(b) * spread;
  const dir = new THREE.Vector3(), r = new THREE.Vector3();
  for (let it = 0; it < iterations; it++) {
    const next = [];
    for (let i = 0; i < pts.length - 1; i++) {
      const p = pts[i], q = pts[i + 1];
      dir.subVectors(q, p);
      r.set(rand(-1, 1), rand(-1, 1) * 0.35, rand(-1, 1));
      r.addScaledVector(dir, -r.dot(dir) / Math.max(dir.lengthSq(), 1e-6));
      r.setLength(amp * rand(0.3, 1));
      next.push(p, p.clone().add(q).multiplyScalar(0.5).add(r));
    }
    next.push(pts[pts.length - 1]);
    pts = next;
    amp *= 0.52;
  }
  return pts;
}

function createRibbon(material) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(MAX_QUADS * 12), 3));
  const index = new Uint16Array(MAX_QUADS * 6);
  for (let q = 0; q < MAX_QUADS; q++) {
    const v = q * 4, i = q * 6;
    index.set([v, v + 1, v + 2, v + 2, v + 1, v + 3], i);
  }
  geometry.setIndex(new THREE.BufferAttribute(index, 1));
  geometry.setDrawRange(0, 0);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.userData.noAO = true;
  return mesh;
}

export function createStorm({ scene, camera, environment, audio, quality }) {
  const octaves = quality?.name === 'high' ? 5 : quality?.name === 'medium' ? 4 : 3;
  const root = new THREE.Group();
  root.name = 'Storm';
  root.userData.noAO = true;       // nuvens e raios não entram no GTAO
  root.visible = false;
  scene.add(root);

  const domeMaterial = new THREE.ShaderMaterial({
    vertexShader: CLOUD_VERT,
    fragmentShader: CLOUD_FRAG,
    defines: { OCT: octaves },
    uniforms: {
      uTime: { value: 0 }, uFlash: { value: 0 }, uFlashDir: { value: new THREE.Vector3(0, 0.5, 1) },
    },
    transparent: true, depthWrite: false, depthTest: true, fog: false, side: THREE.BackSide,
  });
  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(DOME_RADIUS, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), domeMaterial);
  dome.frustumCulled = false;
  dome.userData.noAO = true;
  root.add(dome);

  // Raios: duas "vagas" reaproveitadas (faixa fina e brilhante + halo mais largo).
  const bolts = [0, 1].map(() => {
    const coreMat = new THREE.MeshBasicMaterial({
      color: 0xe6efff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending,
      depthWrite: false, fog: false, side: THREE.DoubleSide,
    });
    const glowMat = new THREE.MeshBasicMaterial({
      color: 0x6a88ff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending,
      depthWrite: false, fog: false, side: THREE.DoubleSide,
    });
    const glow = createRibbon(glowMat), core = createRibbon(coreMat);
    glow.visible = core.visible = false;
    root.add(glow, core);
    return { core, glow, coreMat, glowMat, strike: null };
  });

  function fillRibbon(mesh, segments, widthScale) {
    const pos = mesh.geometry.attributes.position.array;
    const view = new THREE.Vector3(), side = new THREE.Vector3(), dir = new THREE.Vector3();
    let q = 0;
    for (const { a, b, w } of segments) {
      if (q >= MAX_QUADS) break;
      dir.subVectors(b, a);
      view.copy(a).add(b).multiplyScalar(0.5);                    // câmera na origem
      const dist = view.length();
      side.crossVectors(dir, view.normalize()).normalize().multiplyScalar(0.5 * w * widthScale * dist);
      const o = q * 12;
      pos[o] = a.x - side.x; pos[o + 1] = a.y - side.y; pos[o + 2] = a.z - side.z;
      pos[o + 3] = a.x + side.x; pos[o + 4] = a.y + side.y; pos[o + 5] = a.z + side.z;
      pos[o + 6] = b.x - side.x; pos[o + 7] = b.y - side.y; pos[o + 8] = b.z - side.z;
      pos[o + 9] = b.x + side.x; pos[o + 10] = b.y + side.y; pos[o + 11] = b.z + side.z;
      q++;
    }
    mesh.geometry.attributes.position.needsUpdate = true;
    mesh.geometry.setDrawRange(0, q * 6);
  }

  function buildBolt(bolt, start, end) {
    const main = jaggedPath(start, end, 6, 0.2);
    const segments = [];
    for (let i = 0; i < main.length - 1; i++) {
      segments.push({ a: main[i], b: main[i + 1], w: 1 - 0.55 * (i / main.length) });
    }
    const branches = Math.floor(rand(2, 5));
    const dir = new THREE.Vector3(), side = new THREE.Vector3();
    for (let n = 0; n < branches; n++) {
      const k = Math.floor(rand(0.2, 0.85) * (main.length - 2));
      dir.subVectors(main[k + 1], main[k]).normalize();
      side.set(rand(-1, 1), rand(-0.6, -0.1), rand(-1, 1)).normalize();
      dir.addScaledVector(side, 0.9).normalize();
      const tip = main[k].clone().addScaledVector(dir, start.distanceTo(end) * rand(0.12, 0.28));
      const sub = jaggedPath(main[k], tip, 3, 0.3);
      for (let i = 0; i < sub.length - 1; i++) segments.push({ a: sub[i], b: sub[i + 1], w: 0.45 * (1 - i / sub.length) });
    }
    fillRibbon(bolt.core, segments, 0.0046);
    fillRibbon(bolt.glow, segments, 0.013);
  }

  // ── Controle das descargas ──────────────────────────────────────────────────────
  const strikes = [];
  let nextStrike = rand(4, 7);
  let lastFlash = -1;
  const forward = new THREE.Vector3();
  const dirOut = new THREE.Vector3();
  const mid = new THREE.Vector3();

  function strike({ near = Math.random() < 0.7, azimuth } = {}) {
    // Mais da metade cai na direção que o jogador está olhando, para ele ver.
    let az = azimuth;
    if (az === undefined) {
      camera.getWorldDirection(forward);
      az = Math.random() < 0.65 ? Math.atan2(forward.x, forward.z) + rand(-0.95, 0.95) : rand(0, Math.PI * 2);
    }
    const R = near ? rand(60, 78) : rand(80, 95);
    const top = rand(34, 52);
    const start = new THREE.Vector3(Math.sin(az) * R + rand(-6, 6), top, Math.cos(az) * R + rand(-6, 6));
    const az2 = az + rand(-0.06, 0.06);
    const R2 = R + rand(-6, 6);
    const end = new THREE.Vector3(Math.sin(az2) * R2, -1.4, Math.cos(az2) * R2);
    mid.copy(start).multiplyScalar(0.55).add(end.clone().multiplyScalar(0.45));
    const dir = mid.clone().normalize();

    const s = {
      t: 0, near, dir, amp: near ? rand(0.8, 1) : rand(0.3, 0.45),
      pulses: makePulses(near), bolt: null,
    };
    if (near) {
      const bolt = bolts.find((b) => !b.strike) ?? bolts[0];
      bolt.strike = s; s.bolt = bolt;
      buildBolt(bolt, start, end);
      bolt.core.visible = bolt.glow.visible = true;
    }
    strikes.push(s);

    // Trovão: o som chega depois do clarão; quanto mais longe, mais tarde e mais fraco.
    const delay = near ? 0.35 + ((R - 60) / 18) * 0.9 + rand(0, 0.4) : rand(2.2, 5.5);
    const power = near ? Math.min(1, 1.05 - (R - 60) / 70 + rand(-0.05, 0.05)) : rand(0.25, 0.5);
    audio?.thunder?.(delay, power);
    return s;
  }

  function update(dt, location, world) {
    const outdoors = location === 'street';
    root.visible = outdoors;
    domeMaterial.uniforms.uTime.value += dt;
    if (outdoors) root.position.copy(camera.position);

    nextStrike -= dt;
    if (nextStrike <= 0) {
      const first = strike();
      // Às vezes cai uma segunda descarga logo depois, na mesma região.
      if (Math.random() < 0.25) {
        const az = Math.atan2(first.dir.x, first.dir.z);
        window.setTimeout(() => strike({ near: first.near, azimuth: az + rand(-0.15, 0.15) }), rand(500, 1400));
      }
      nextStrike = rand(7, 19);
    }

    let flash = 0;
    let strongest = null;
    for (let i = strikes.length - 1; i >= 0; i--) {
      const s = strikes[i];
      s.t += dt;
      const e = envelope(s.pulses, s.t);
      if (s.bolt) {
        s.bolt.coreMat.opacity = e;
        s.bolt.glowMat.opacity = e * 0.45;
      }
      const f = e * s.amp;
      if (f > flash) { flash = f; strongest = s; }
      if (s.t > 1.1) {
        if (s.bolt) { s.bolt.core.visible = s.bolt.glow.visible = false; s.bolt.strike = null; }
        strikes.splice(i, 1);
      }
    }

    if (strongest) domeMaterial.uniforms.uFlashDir.value.copy(strongest.dir);
    domeMaterial.uniforms.uFlash.value = flash;
    if (flash !== lastFlash) {
      environment?.setFlash?.(flash);
      if (world?.setStormFlash) {
        const d = strongest ? strongest.dir : dirOut.set(0, 0.5, 1);
        world.setStormFlash(flash, camera.position.x + d.x * 30, camera.position.y + 18, camera.position.z + d.z * 30);
      }
      lastFlash = flash;
    }
  }

  return { update, strike, root, get flash() { return Math.max(0, lastFlash); } };
}
