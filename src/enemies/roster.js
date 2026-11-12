// ─────────────────────────────────────────────────────────────────────────────
// Elenco de zumbis. Para trocar/adicionar personagens basta editar este arquivo.
//
// Aceita .glb/.gltf e .fbx com esqueleto Mixamo ("mixamorig:Hips", ...).
// Como usar um zumbi do Mixamo (https://www.mixamo.com → aba Characters):
//   1. escolha um personagem zumbi e clique em Download: Format = FBX Binary (.fbx), Pose = T-pose;
//   2. coloque o .fbx em public/models/zombies/ — e, se o download trouxe texturas
//      (pasta *.fbm ou imagens .png/.jpg), coloque-as NA MESMA PASTA do .fbx;
//   3. adicione abaixo em MODELS, ex.:  zombieA: { url: '/models/zombies/Zombie_A.fbx', height: 1.8 },
//      e use  model: 'zombieA'  nos membros dos grupos mais abaixo.
// As animações (andar, atacar, comer, levantar, morrer…) vêm de public/animations/zombie/.
// ─────────────────────────────────────────────────────────────────────────────

export const MODELS = {
  // Zumbis do Mixamo (FBX). As texturas .png precisam estar na MESMA pasta do .fbx, com o nome original.
  copZombie: { url: '/models/zombies/copzombie_l_actisdato.fbx', height: 1.82 },
  prisoner: { url: '/models/zombies/Prisoner%20B%20Styperek.fbx', height: 1.78 },
  zombieGirl: { url: '/models/zombies/Zombiegirl%20W%20Kurniawan.fbx', height: 1.66 },
  // Corpo humano (vítima do banquete): continua o SWAT.
  swat: { url: '/models/character/swat.glb', height: 1.80 },
};

// look: decay (palidez 0..1) · blood (0..1) · cloth (tom das roupas) · skin · seed
const look = (o) => ({ decay: 0.7, blood: 0.85, skin: 0xb4bea0, ...o });
// Zumbis que já vêm com textura própria: sem repintar roupa/pele (só um pouco de sujeira e sangue por cima).
const textured = (o) => ({ decay: 0.12, blood: 0.5, skin: 0xb4bea0, ...o });

export const LOCATIONS = {
  // ── RPD: 2 policiais zumbi na galeria, no alto das escadas ──
  hall: {
    floorY: 4.6,
    groups: [
      {
        name: 'policiais',
        kind: 'idle',          // parados de pé até perceberem o jogador
        wakeRadius: 6.5,
        members: [
          { model: 'copZombie', x: -3.7, z: -13.7, yaw: 2.7, look: textured({ seed: 3, blood: 0.7 }) },
          { model: 'copZombie', x: 3.5, z: -13.3, yaw: -2.2, look: textured({ seed: 8, blood: 0.6 }) },
        ],
      },
    ],
  },

  // ── Rua: 5 zumbis agachados comendo uma vítima, à frente do carro em chamas ──
  street: {
    groups: [
      {
        name: 'banquete',
        kind: 'feed',
        center: { x: 1.6, z: 16.4 },
        triggerRadius: 7.8,    // o carro fica a ~7.5 m do grupo: ao chegar nele, eles levantam
        victim: { model: 'swat', yaw: 0.55, look: look({ seed: 21, decay: 0.2, blood: 1.0, cloth: 0xb9b2a0, skin: 0xcdb29c }) },
        members: [
          { model: 'zombieGirl', look: textured({ seed: 11, blood: 0.7 }) },
          { model: 'prisoner', look: textured({ seed: 12, blood: 0.6 }) },
          { model: 'copZombie', look: textured({ seed: 13, blood: 0.7 }) },
          { model: 'zombieGirl', look: textured({ seed: 14, blood: 0.6 }) },
          { model: 'prisoner', look: textured({ seed: 15, blood: 0.7 }) },
        ],
      },
    ],
  },
};
