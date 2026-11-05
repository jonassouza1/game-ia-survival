import * as THREE from 'three';

/**
 * Pipeline de render inspirado no PS1: quadro 4:3 ampliado sem suavização,
 * com tone mapping filmico, cor quantizada em 5 bits por canal e dithering ordenado 4x4.
 */
export function createPS1(renderer, { width = 320, height = 240 } = {}) {
  const rt = new THREE.WebGLRenderTarget(2, 2, {
    // Framebuffer de 8 bits por canal: evita precisão excessiva de GPUs modernas.
    type: THREE.UnsignedByteType,
    magFilter: THREE.NearestFilter,
    minFilter: THREE.NearestFilter,
    depthBuffer: true,
  });

  const material = new THREE.ShaderMaterial({
    uniforms: { tDiffuse: { value: rt.texture }, uRes: { value: new THREE.Vector2(2, 2) } },
    vertexShader: /* glsl */`
      varying vec2 vUv;
      void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
    fragmentShader: /* glsl */`
      precision highp float;
      uniform sampler2D tDiffuse;
      uniform vec2 uRes;
      varying vec2 vUv;
      const float B[16] = float[16](0.,8.,2.,10., 12.,4.,14.,6., 3.,11.,1.,9., 15.,7.,13.,5.);
      vec3 aces(vec3 x){ return clamp((x*(2.51*x+0.03))/(x*(2.43*x+0.59)+0.14), 0.0, 1.0); }
      void main(){
        vec3 c = texture2D(tDiffuse, vUv).rgb;
        c = aces(c * 1.12);
        float l = dot(c, vec3(0.299, 0.587, 0.114));
        c = mix(vec3(l), c, 0.86) * vec3(1.05, 1.0, 0.92);       // levemente dessaturado e quente
        c = pow(c, vec3(1.0/2.2));
        vec2 d = vUv - 0.5;
        c *= smoothstep(0.95, 0.32, length(d * vec2(1.15, 1.0)));  // vinheta
        vec2 px = floor(vUv * uRes);
        float t = B[int(mod(px.y,4.0))*4 + int(mod(px.x,4.0))] / 16.0 - 0.5;
        // Dither bem sutil: mantém a paleta 5-bit sem cobrir a imagem com uma grade.
        c = floor((c + t * 0.24 / 31.0) * 31.0 + 0.5) / 31.0;
        gl_FragColor = vec4(c, 1.0);
      }`,
    depthTest: false, depthWrite: false,
  });

  const quadScene = new THREE.Scene();
  const quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  quadScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material));
  function setSize(w, h) {
    renderer.setSize(w, h);
    // A imagem original era 320x240 (4:3); o quadro CSS também preserva essa proporção.
    rt.setSize(width, height);
    material.uniforms.uRes.value.set(width, height);
  }

  function render(scene, camera) {
    renderer.setRenderTarget(rt);
    renderer.render(scene, camera);
    renderer.setRenderTarget(null);
    renderer.render(quadScene, quadCam);
  }

  return { setSize, render };
}
