import * as THREE from 'three';

// ─────────────────────────────────────────────────────────────────────────────
// Aparência de zumbi aplicada em cima de QUALQUER personagem Mixamo.
//
// 1. bakeRestCoords(): grava em cada malha o atributo `aRest` = posição de cada
//    vértice na pose de repouso, em coordenadas do corpo (x = lado esquerdo,
//    y = altura 0..1 do pé à cabeça, z = frente). Assim o sangue fica "colado"
//    no corpo (boca, peito, mãos) mesmo com o personagem animado.
// 2. makeZombieMaterial(): clona o material do personagem e injeta no shader:
//    palidez/esverdeado, sujeira, tingimento só das roupas (pixels pouco
//    saturados), manchas de sangue seco e sangue molhado (menos rugoso).
// ─────────────────────────────────────────────────────────────────────────────

const _v = new THREE.Vector3();

function boneByName(root, name) {
  let found = null;
  root.traverse((o) => { if (!found && o.isBone && o.name === name) found = o; });
  return found;
}

// Base do corpo (esquerda / cima / frente) no espaço do `root` na pose de repouso.
export function computeBodyBasis(root) {
  root.updateMatrixWorld(true);
  const pos = (n) => boneByName(root, n)?.getWorldPosition(new THREE.Vector3());
  const hips = pos('mixamorigHips'), head = pos('mixamorigHead');
  const lLeg = pos('mixamorigLeftUpLeg'), rLeg = pos('mixamorigRightUpLeg');
  if (!hips || !head || !lLeg || !rLeg) return null;
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  [hips, head, lLeg, rLeg].forEach((p) => p.applyMatrix4(inv));
  const left = lLeg.clone().sub(rLeg).normalize();
  let up = head.clone().sub(hips).normalize();
  const forward = new THREE.Vector3().crossVectors(left, up).normalize();
  up = new THREE.Vector3().crossVectors(forward, left).normalize();
  return { left, up, forward, hips };
}

export function bakeRestCoords(root) {
  const skeletons = new Set();
  root.traverse((o) => { if (o.isSkinnedMesh && o.skeleton) skeletons.add(o.skeleton); });
  [...skeletons].sort((a, b) => a.bones.length - b.bones.length).forEach((s) => s.pose());
  root.updateMatrixWorld(true);
  const basis = computeBodyBasis(root);
  if (!basis) return null;
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const meshes = [];
  root.traverse((o) => { if (o.isSkinnedMesh) meshes.push(o); });

  // Primeiro passe: limites de altura do corpo inteiro.
  const raw = meshes.map((mesh) => {
    const count = mesh.geometry.attributes.position.count;
    const out = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      mesh.getVertexPosition(i, _v);
      _v.applyMatrix4(mesh.matrixWorld).applyMatrix4(inv);
      out[i * 3] = _v.dot(basis.left);
      out[i * 3 + 1] = _v.dot(basis.up);
      out[i * 3 + 2] = _v.dot(basis.forward);
    }
    return out;
  });
  let minY = Infinity, maxY = -Infinity;
  raw.forEach((a) => { for (let i = 1; i < a.length; i += 3) { minY = Math.min(minY, a[i]); maxY = Math.max(maxY, a[i]); } });
  const height = maxY - minY;
  const hipsX = basis.hips.dot(basis.left), hipsZ = basis.hips.dot(basis.forward);
  meshes.forEach((mesh, index) => {
    const a = raw[index];
    for (let i = 0; i < a.length; i += 3) {
      a[i] = (a[i] - hipsX) / height;
      a[i + 1] = (a[i + 1] - minY) / height;
      a[i + 2] = (a[i + 2] - hipsZ) / height;
    }
    mesh.geometry.setAttribute('aRest', new THREE.BufferAttribute(a, 3));
  });
  return { height, minY };
}

const NOISE_GLSL = /* glsl */`
  float zHue(vec3 c) {
    float mx = max(c.r, max(c.g, c.b)), mn = min(c.r, min(c.g, c.b)), d = mx - mn;
    if (d < 1e-4) return 0.5;
    float h = mx == c.r ? mod((c.g - c.b) / d, 6.0) : (mx == c.g ? (c.b - c.r) / d + 2.0 : (c.r - c.g) / d + 4.0);
    return h / 6.0;
  }
  float zHash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
  float zNoise(vec3 x) {
    vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(zHash(i), zHash(i + vec3(1,0,0)), f.x), mix(zHash(i + vec3(0,1,0)), zHash(i + vec3(1,1,0)), f.x), f.y),
               mix(mix(zHash(i + vec3(0,0,1)), zHash(i + vec3(1,0,1)), f.x), mix(zHash(i + vec3(0,1,1)), zHash(i + vec3(1,1,1)), f.x), f.y), f.z);
  }
  float zFbm(vec3 p) { return 0.55 * zNoise(p) + 0.3 * zNoise(p * 2.3) + 0.15 * zNoise(p * 5.1); }
`;

// opts: decay 0..1 (palidez), blood 0..1, cloth (THREE.Color) tinge das roupas,
//       skin (THREE.Color) tom da pele, seed
export function makeZombieMaterial(original, opts = {}) {
  // FBX costuma trazer MeshPhongMaterial: converte para o material PBR usado no resto do jogo.
  let source = original;
  if (!original.isMeshStandardMaterial) {
    const params = { name: original.name, color: original.color?.clone() ?? new THREE.Color(0xffffff), roughness: 0.85, metalness: 0,
      transparent: original.transparent, opacity: original.opacity, alphaTest: original.alphaTest, side: original.side };
    if (original.map) params.map = original.map;
    if (original.normalMap) params.normalMap = original.normalMap;
    source = new THREE.MeshStandardMaterial(params);
  }
  const material = source.clone();
  const u = {
    uDecay: { value: opts.decay ?? 0.6 },
    uBlood: { value: opts.blood ?? 0.8 },
    uSeed: { value: opts.seed ?? 1 },
    uCloth: { value: opts.cloth ? new THREE.Color(opts.cloth) : new THREE.Color(1, 1, 1) },
    uSkin: { value: new THREE.Color(opts.skin ?? 0xb9c2a6) },
    uClothMix: { value: opts.cloth ? (opts.clothMix ?? 0.85) : 0 },
  };
  material.userData.zombie = u;
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, u);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec3 aRest;\nvarying vec3 vRest;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvRest = aRest;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vRest;
        uniform float uDecay, uBlood, uSeed;
        uniform vec3 uCloth, uSkin;
        uniform float uClothMix;
        ${NOISE_GLSL}`)
      .replace('#include <map_fragment>', `#include <map_fragment>
        float zBlood = 0.0;
        {
          vec3 rc = vRest;
          float mx = max(diffuseColor.r, max(diffuseColor.g, diffuseColor.b));
          float mn = min(diffuseColor.r, min(diffuseColor.g, diffuseColor.b));
          float sat = (mx - mn) / max(mx, 0.001);
          // pele = matiz alaranjado/avermelhado com alguma saturação (azul/cinza/preto = roupa)
          float hue = zHue(diffuseColor.rgb);
          float hueOK = hue < 0.5 ? 1.0 - smoothstep(0.085, 0.15, hue) : smoothstep(0.93, 0.985, hue);
          float skinMask = hueOK * smoothstep(0.10, 0.22, sat);
          float lum = dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114));
          // roupa: recolore pela luminância (mantém dobras e costuras)
          vec3 clothed = uCloth * (lum * 1.7 + 0.04);
          diffuseColor.rgb = mix(diffuseColor.rgb, clothed, uClothMix * (1.0 - skinMask));
          // pele: palidez esverdeada
          vec3 dead = uSkin * (0.45 + lum * 0.9);
          diffuseColor.rgb = mix(diffuseColor.rgb, dead, skinMask * uDecay * 0.85);
          // sujeira geral, mais forte embaixo
          float grime = zFbm(rc * 7.0 + uSeed) * (1.15 - rc.y);
          diffuseColor.rgb *= 1.0 - grime * 0.55 * uDecay;
          // sangue: boca/queixo, peito, mãos e antebraços + respingos
          float front = smoothstep(-0.02, 0.05, rc.z);
          float n1 = zFbm(rc * 11.0 + uSeed * 3.1);
          float n2 = zFbm(rc * 26.0 + uSeed * 7.7);
          float mouth = smoothstep(0.855, 0.875, rc.y) * (1.0 - smoothstep(0.90, 0.925, rc.y)) * front;
          float chest = smoothstep(0.50, 0.58, rc.y) * (1.0 - smoothstep(0.76, 0.84, rc.y)) * front;
          float hands = smoothstep(0.26, 0.36, abs(rc.x));
          float fore = smoothstep(0.18, 0.28, abs(rc.x));
          float drip = smoothstep(0.35, 0.8, rc.y) * front;
          float b = mouth * smoothstep(0.42, 0.6, n1 + 0.2)
                  + chest * smoothstep(0.50, 0.66, n1) * 0.9
                  + hands * smoothstep(0.42, 0.58, n2 + 0.05) * 0.85
                  + fore * smoothstep(0.55, 0.7, n1) * 0.6
                  + drip * smoothstep(0.66, 0.78, n2) * 0.5;
          zBlood = clamp(b * uBlood, 0.0, 1.0);
          vec3 fresh = vec3(0.20, 0.010, 0.008), dried = vec3(0.075, 0.012, 0.010);
          diffuseColor.rgb = mix(diffuseColor.rgb, mix(fresh, dried, smoothstep(0.35, 0.7, n2)), zBlood * 0.92);
        }`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = mix(max(roughnessFactor, 0.55), 0.26, zBlood);`)
      .replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>
        metalnessFactor *= 0.12;`);
  };
  material.customProgramCacheKey = () => 'rpd-zombie-v1';
  return material;
}
