// ─────────────────────────────────────────────────────────────────────────────
// Elenco de zumbis. Para trocar/adicionar personagens basta editar este arquivo.
//
// Qualquer GLB com esqueleto Mixamo ("mixamorig:Hips", ...) funciona: baixe um
// zumbi em https://www.mixamo.com (Characters → ex.: "Zombie", "Warzombie",
// "Skeletonzombie"), exporte como glTF/GLB com skin, coloque em
// public/models/zombies/ e aponte aqui. Os clipes de caminhada vêm do Soldier.glb
// e a animação de agachado/levantar/ataque/reação/morte é gerada por código.
// ─────────────────────────────────────────────────────────────────────────────

export const MODELS = {
  police: { url: '/models/character/swat.glb', height: 1.80 },
  woman: { url: '/models/zombies/Michelle.glb', height: 1.68 },
};

// look: decay (palidez 0..1) · blood (0..1) · cloth (tom das roupas) · skin · seed
const look = (o) => ({ decay: 0.7, blood: 0.85, skin: 0xb4bea0, ...o });

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
          { model: 'police', x: -3.7, z: -13.7, yaw: 2.7, look: look({ seed: 3, decay: 0.75, blood: 1.0, cloth: 0xffffff }) },
          { model: 'police', x: 3.5, z: -13.3, yaw: -2.2, look: look({ seed: 8, decay: 0.8, blood: 0.9, cloth: 0xe8e2d6 }) },
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
        victim: { model: 'police', yaw: 0.55, look: look({ seed: 21, decay: 0.2, blood: 1.0, cloth: 0xb9b2a0, skin: 0xcdb29c }) },
        members: [
          { model: 'woman', look: look({ seed: 11, decay: 0.8, blood: 1.0, cloth: 0xd9c9c2 }) },
          { model: 'police', look: look({ seed: 12, decay: 0.7, blood: 0.9, cloth: 0xb08a5c }) },
          { model: 'police', look: look({ seed: 13, decay: 0.85, blood: 1.0, cloth: 0x7d8a96 }) },
          { model: 'woman', look: look({ seed: 14, decay: 0.7, blood: 0.9, cloth: 0xa07070 }) },
          { model: 'police', look: look({ seed: 15, decay: 0.75, blood: 1.0, cloth: 0x8e9068 }) },
        ],
      },
    ],
  },
};
