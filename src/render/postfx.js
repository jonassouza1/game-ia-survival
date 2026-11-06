import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

/**
 * Pós-processamento cinematográfico:
 *   GTAO (oclusão em espaço de tela) → bloom → tone mapping ACES → grade final.
 * O alvo usa HalfFloat + MSAA 4x, então o resultado tem HDR e bordas suaves.
 */

const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uResolution: { value: new THREE.Vector2(1, 1) },
    uVignette: { value: 0.62 },
    uGrain: { value: 0.03 },
    uSaturation: { value: 0.98 },
    uContrast: { value: 1.08 },
    uChromatic: { value: 1 },
    uLift: { value: new THREE.Vector3(0.004, 0.006, 0.012) },
    uGain: { value: new THREE.Vector3(1.04, 1.0, 0.94) },
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
  fragmentShader: /* glsl */`
    precision highp float;
    uniform sampler2D tDiffuse;
    uniform float uTime;
    uniform vec2 uResolution;
    uniform float uVignette;
    uniform float uGrain;
    uniform float uSaturation;
    uniform float uContrast;
    uniform float uChromatic;
    uniform vec3 uLift;
    uniform vec3 uGain;
    varying vec2 vUv;

    float hash(vec2 p) {
      p = fract(p * vec2(443.897, 441.423));
      p += dot(p, p.yx + 19.19);
      return fract((p.x + p.y) * p.x);
    }

    void main() {
      vec2 centered = vUv - 0.5;
      float radius = length(centered * vec2(1.0, 1.25));

      // Abberação cromática mínima: só nas bordas, como numa lente real.
      vec2 shift = centered * radius * 0.0022 * uChromatic;
      vec3 color;
      color.r = texture2D(tDiffuse, vUv + shift).r;
      color.g = texture2D(tDiffuse, vUv).g;
      color.b = texture2D(tDiffuse, vUv - shift).b;

      float luma = dot(color, vec3(0.2126, 0.7152, 0.0722));
      color = mix(vec3(luma), color, uSaturation);

      // Contraste em S mantém o preto fosco e evita realces estourados.
      color = (color - 0.5) * uContrast + 0.5;
      color = color * uGain + uLift * (1.0 - color);

      float vignette = smoothstep(0.95, 0.28, radius);
      color *= mix(1.0, vignette, uVignette);

      // Grão de filme animado, mais visível nas sombras.
      float grain = hash(vUv * uResolution + fract(uTime) * 917.0) - 0.5;
      color += grain * uGrain * mix(0.55, 1.0, 1.0 - luma);

      gl_FragColor = vec4(clamp(color, 0.0, 1.0), 1.0);
    }`,
};

export function createPostFX(renderer, scene, camera, { width, height, quality } = {}) {
  // Preset baixo: render direto, sem composer. Mantém o tone mapping ACES do
  // renderer e economiza os passes de tela cheia em GPUs integradas.
  if (quality?.postfx === 'off') {
    return {
      render: () => renderer.render(scene, camera),
      setSize: () => {},
      composer: null,
      passes: {},
    };
  }

  const cssSize = renderer.getSize(new THREE.Vector2());
  const size = renderer.getDrawingBufferSize(new THREE.Vector2());
  const w = width ?? size.x;
  const h = height ?? size.y;
  const aoScale = quality?.gtaoScale ?? 0.55;

  const target = new THREE.WebGLRenderTarget(w, h, {
    type: THREE.HalfFloatType,
    samples: quality?.antialias ?? 4,
  });
  const composer = new EffectComposer(renderer, target);
  composer.setSize(cssSize.x, cssSize.y);

  const renderPass = new RenderPass(scene, camera);
  composer.addPass(renderPass);

  const aoWidth = Math.max(2, Math.round(w * aoScale));
  const aoHeight = Math.max(2, Math.round(h * aoScale));
  const gtao = new GTAOPass(scene, camera, aoWidth, aoHeight);
  gtao.output = GTAOPass.OUTPUT.Default;
  gtao.blendIntensity = quality?.gtaoBlend ?? 0.95;
  gtao.updateGtaoMaterial({
    radius: 0.7,
    distanceExponent: 1.1,
    thickness: 0.9,
    scale: 1.0,
    samples: quality?.postfx === 'high' ? 16 : 12,
    distanceFallOff: 1.0,
    screenSpaceRadius: false,
  });
  gtao.updatePdMaterial({
    lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 12,
  });

  // Resolução reduzida do AO: o denoise suaviza e o custo cai bastante.
  const gtaoSetSize = gtao.setSize.bind(gtao);
  gtao.setSize = (targetWidth, targetHeight) => {
    gtaoSetSize(
      Math.max(2, Math.round(targetWidth * aoScale)),
      Math.max(2, Math.round(targetHeight * aoScale)),
    );
  };

  // Objetos transparentes/efeitos (fogo, fumaça, chuva) não devem virar
  // oclusores no depth/normal do GTAO.
  const gtaoRender = gtao.render.bind(gtao);
  gtao.render = (targetRenderer, writeBuffer, readBuffer, deltaTime, maskActive) => {
    const hidden = [];
    scene.traverse((object) => {
      if (object.userData.noAO && object.visible) {
        object.visible = false;
        hidden.push(object);
      }
    });
    gtaoRender(targetRenderer, writeBuffer, readBuffer, deltaTime, maskActive);
    for (const object of hidden) object.visible = true;
  };
  composer.addPass(gtao);

  const bloom = new UnrealBloomPass(
    new THREE.Vector2(w, h),
    quality?.bloomStrength ?? 0.28,
    0.65,
    0.82,
  );
  composer.addPass(bloom);

  composer.addPass(new OutputPass());

  const grade = new ShaderPass(GradeShader);
  grade.uniforms.uResolution.value.set(w, h);
  grade.uniforms.uChromatic.value = quality?.chromatic ?? 1;
  composer.addPass(grade);

  let elapsed = 0;
  return {
    render(dt = 0) {
      elapsed += dt;
      grade.uniforms.uTime.value = elapsed;
      composer.render(dt);
    },
    setSize(cssWidth, cssHeight) {
      const ratio = renderer.getPixelRatio();
      composer.setPixelRatio(ratio);
      composer.setSize(cssWidth, cssHeight);
      const buffer = renderer.getDrawingBufferSize(new THREE.Vector2());
      grade.uniforms.uResolution.value.set(buffer.x, buffer.y);
    },
    composer,
    passes: { renderPass, gtao, bloom, grade },
  };
}
