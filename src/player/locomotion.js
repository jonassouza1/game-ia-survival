import * as THREE from 'three';

const { clamp, lerp, smoothstep } = THREE.MathUtils;

// Controla o ciclo de passos do personagem.
//
// Em vez de misturar caminhada e corrida com relógios independentes (o que gera
// pernas "borradas" e pés deslizando), existe UMA fase de passo [0..1) que avança
// conforme a distância percorrida. Caminhada e corrida são lidas na mesma fase
// (alinhadas pelo instante em que o pé esquerdo está à frente), então qualquer
// mistura entre as duas continua sendo uma passada coerente.
//
//   walk / run: { duration (s), speed (m/s em que o pé não desliza), strike (0..1) }
export function createGait({ walk, run }) {
  const walkStride = walk.speed * walk.duration; // distância por ciclo completo
  const runStride = run.speed * run.duration;
  let phase = 0;

  return {
    get phase() { return phase; },
    reset() { phase = 0; },
    // speed: velocidade horizontal (m/s). along: componente da velocidade na
    // direção para onde o corpo olha (negativa = andando de costas).
    update(dt, speed, along = speed) {
      const runBlend = clamp((speed - walk.speed) / (run.speed - walk.speed), 0, 1);
      const moving = smoothstep(speed, 0.05, walk.speed * 0.5);
      const stride = lerp(walkStride, runStride, runBlend);
      const direction = along < -0.25 * speed ? -1 : 1;
      phase = (((phase + direction * speed * dt / stride) % 1) + 1) % 1;
      return {
        idle: 1 - moving,
        walk: moving * (1 - runBlend),
        run: moving * runBlend,
        walkTime: ((phase + walk.strike) % 1) * walk.duration,
        runTime: ((phase + run.strike) % 1) * run.duration,
        phase,
      };
    },
  };
}
