import * as THREE from 'three';

// Texturas procedurais pequenas, com paleta e desenho pensados para o saguão da R.P.D.

function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
}

function canvasTex(size, seed, draw) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  g.imageSmoothingEnabled = false;
  draw(g, size, rng(seed));
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.NearestFilter;                 // pixels visíveis, como no PS1
  t.minFilter = THREE.NearestMipmapNearestFilter;    // níveis de detalhe discretos, sem blur
  t.anisotropy = 1;
  return t;
}

function speckle(g, n, r, size, dark = 0.14, light = 0.08) {
  for (let i = 0; i < n; i++) {
    const x = (r() * size) | 0, y = (r() * size) | 0;
    g.fillStyle = r() < 0.62 ? `rgba(0,0,0,${dark * r()})` : `rgba(255,240,210,${light * r()})`;
    g.fillRect(x, y, 1, 1);
  }
}

export function makeTextures() {
  // Mármore em losangos, com juntas escuras, lascas e luz envelhecida.
  const marble = canvasTex(128, 11, (g, s, r) => {
    g.fillStyle = '#4b4d47'; g.fillRect(0, 0, s, s);
    let row = 0;
    for (let cy = -16; cy < s + 24; cy += 32, row++) {
      for (let cx = -32 + (row % 2) * 16; cx < s + 32; cx += 32) {
        const light = (Math.round(cx / 32) + row) % 2 === 0;
        g.beginPath(); g.moveTo(cx, cy - 16); g.lineTo(cx + 16, cy);
        g.lineTo(cx, cy + 16); g.lineTo(cx - 16, cy); g.closePath();
        g.fillStyle = light ? '#aaa692' : '#555951'; g.fill();
        g.strokeStyle = 'rgba(20,23,20,.72)'; g.lineWidth = 1; g.stroke();
        g.strokeStyle = light ? 'rgba(238,229,202,.2)' : 'rgba(172,176,159,.12)';
        g.beginPath(); g.moveTo(cx - 14, cy - 2); g.lineTo(cx - 3, cy - 7);
        g.lineTo(cx + 9, cy - 2); g.stroke();
        if (r() < 0.42) {
          g.fillStyle = 'rgba(28,30,27,.28)';
          g.fillRect(cx + (r() * 12 | 0) - 6, cy + (r() * 12 | 0) - 6, 2 + (r() * 3 | 0), 1);
        }
      }
    }
    speckle(g, 500, r, s, 0.16, 0.06);
  });

  // Placas quadradas de pedra escura, com juntas e desgaste discreto para o piso do saguão.
  const floor = canvasTex(128, 18, (g, s, r) => {
    const palette = ['#656458', '#706e5f', '#55574f', '#626255'];
    g.fillStyle = '#282b26'; g.fillRect(0, 0, s, s);
    for (let y = 0; y < s; y += 32) for (let x = 0; x < s; x += 32) {
      const shade = palette[(x / 32 + y / 32 * 2) % palette.length];
      g.fillStyle = shade; g.fillRect(x + 1, y + 1, 30, 30);
      g.fillStyle = 'rgba(217,207,177,.13)';
      g.fillRect(x + 2, y + 2, 28, 1); g.fillRect(x + 2, y + 2, 1, 28);
      g.fillStyle = 'rgba(19,21,19,.25)';
      g.fillRect(x + 2, y + 29, 28, 1); g.fillRect(x + 29, y + 2, 1, 28);
      if (r() < 0.72) {
        g.fillStyle = 'rgba(32,31,26,.18)';
        g.fillRect(x + 4 + (r() * 18 | 0), y + 5 + (r() * 20 | 0), 2 + (r() * 5 | 0), 1);
      }
    }
    speckle(g, 420, r, s, 0.12, 0.055);
  });

  // Painéis internos verde-cinza, com molduras antigas e sombras já pintadas no albedo.
  const panel = canvasTex(128, 29, (g, s, r) => {
    g.fillStyle = '#777967'; g.fillRect(0, 0, s, s);
    for (let y = -2; y < s; y += 64) for (let x = -2; x < s; x += 64) {
      g.fillStyle = 'rgba(25,29,25,.52)'; g.fillRect(x, y, 64, 64);
      g.fillStyle = '#8f907a'; g.fillRect(x + 3, y + 3, 58, 58);
      g.fillStyle = 'rgba(213,210,183,.28)'; g.fillRect(x + 6, y + 6, 52, 2); g.fillRect(x + 6, y + 6, 2, 52);
      g.fillStyle = 'rgba(33,38,32,.38)'; g.fillRect(x + 6, y + 56, 52, 2); g.fillRect(x + 56, y + 6, 2, 52);
      g.fillStyle = 'rgba(107,111,94,.58)'; g.fillRect(x + 11, y + 12, 42, 40);
      g.fillStyle = 'rgba(182,180,153,.18)'; g.fillRect(x + 13, y + 14, 38, 2); g.fillRect(x + 13, y + 14, 2, 34);
      for (let i = 0; i < 3; i++) {
        const sx = x + 12 + (r() * 39 | 0), sy = y + 28 + (r() * 24 | 0);
        g.fillStyle = `rgba(35,42,36,${0.08 + r() * 0.13})`; g.fillRect(sx, sy, 1, 2 + (r() * 12 | 0));
      }
    }
    speckle(g, 640, r, s, 0.13, 0.07);
  });

  const wallStone = canvasTex(128, 31, (g, s, r) => {
    g.fillStyle = '#343932'; g.fillRect(0, 0, s, s);
    for (let row = 0; row < 4; row++) {
      const y = row * 32;
      const offset = row % 2 ? 16 : 0;
      for (let x = -offset; x < s; x += 32) {
        const base = 91 + (r() * 28 | 0);
        g.fillStyle = `rgb(${base - 7},${base - 5},${base - 14})`;
        g.fillRect(x + 1, y + 1, 30, 30);
        g.fillStyle = 'rgba(217,215,193,.16)';
        g.fillRect(x + 2, y + 2, 28, 1);
        g.fillStyle = 'rgba(17,21,18,.3)';
        g.fillRect(x + 2, y + 29, 28, 1);
        for (let i = 0; i < 10; i++) {
          const sx = x + 3 + (r() * 25 | 0), sy = y + 3 + (r() * 24 | 0);
          g.fillStyle = r() < 0.6 ? 'rgba(27,31,27,.16)' : 'rgba(218,212,187,.09)';
          g.fillRect(sx, sy, 1 + (r() * 3 | 0), 1);
        }
      }
    }
    speckle(g, 700, r, s, 0.17, 0.08);
  });

  const wainscot = canvasTex(128, 35, (g, s, r) => {
    g.fillStyle = '#55584f'; g.fillRect(0, 0, s, s);
    for (let row = 0; row < 2; row++) for (let col = 0; col < 2; col++) {
      const x = col * 64, y = row * 64;
      const shade = 126 + (r() * 18 | 0);
      g.fillStyle = `rgb(${shade - 4},${shade},${shade - 9})`;
      g.fillRect(x + 3, y + 3, 58, 58);
      g.fillStyle = 'rgba(230,225,207,.32)';
      g.fillRect(x + 6, y + 6, 52, 2); g.fillRect(x + 6, y + 6, 2, 52);
      g.fillStyle = 'rgba(28,32,28,.48)';
      g.fillRect(x + 6, y + 56, 52, 2); g.fillRect(x + 56, y + 6, 2, 52);
      g.fillStyle = 'rgba(69,75,67,.28)';
      g.fillRect(x + 12, y + 14, 40, 37);
      g.fillStyle = 'rgba(217,214,199,.16)';
      g.fillRect(x + 14, y + 16, 36, 1); g.fillRect(x + 14, y + 16, 1, 33);
      for (let i = 0; i < 8; i++) {
        g.fillStyle = r() < 0.5 ? 'rgba(41,43,36,.12)' : 'rgba(230,222,193,.1)';
        g.fillRect(x + 8 + (r() * 47 | 0), y + 8 + (r() * 47 | 0), 1, 1);
      }
    }
    speckle(g, 500, r, s, 0.12, 0.06);
  });

  const plaster = canvasTex(64, 22, (g, s, r) => {
    g.fillStyle = '#96917d'; g.fillRect(0, 0, s, s);
    // Reboco envelhecido com ornamento discreto de prédio público antigo.
    g.strokeStyle = 'rgba(105,79,53,.12)'; g.lineWidth = 1;
    for (const [cx, cy] of [[16, 16], [48, 48], [16, 48], [48, 16]]) {
      g.beginPath(); g.moveTo(cx, cy - 7); g.lineTo(cx + 5, cy); g.lineTo(cx, cy + 7);
      g.lineTo(cx - 5, cy); g.closePath(); g.stroke();
      g.fillStyle = 'rgba(119,87,56,.14)'; g.fillRect(cx - 1, cy - 1, 2, 2);
    }
    g.fillStyle = 'rgba(237,224,193,.16)'; g.fillRect(0, 0, s, 2);
    // Umidade e tinta descascada em manchas irregulares, com escorridos verticais.
    for (let i = 0; i < 7; i++) {
      const cx = 4 + r() * 56, cy = 14 + r() * 45;
      g.fillStyle = `rgba(37,43,37,${0.09 + r() * 0.13})`;
      g.beginPath(); g.ellipse(cx, cy, 3 + r() * 7, 2 + r() * 5, r() * 0.5, 0, Math.PI * 2); g.fill();
      g.fillRect(cx - 1, cy, 1 + (r() * 2 | 0), 3 + (r() * 9 | 0));
      g.fillStyle = `rgba(213,202,174,${0.06 + r() * 0.10})`;
      g.fillRect(cx + 2, cy + 2, 2 + (r() * 4 | 0), 1 + (r() * 3 | 0));
    }
    // Fissuras curtas e escuras, desenhadas em poucos segmentos para sobreviver à escala.
    g.strokeStyle = 'rgba(38,39,33,.28)'; g.lineWidth = 1;
    for (let i = 0; i < 5; i++) {
      let x = r() * s, y = r() * s;
      g.beginPath(); g.moveTo(x, y);
      for (let j = 0; j < 3; j++) { x += (r() - .5) * 5; y += 2 + r() * 4; g.lineTo(x, y); }
      g.stroke();
    }
    // Manchas grandes, como tinta antiga, em vez de ruído uniforme.
    for (let i = 0; i < 18; i++) {
      const x = (r() * s) | 0, y = (r() * s) | 0, w = 2 + (r() * 8 | 0), h = 5 + (r() * 24 | 0);
      g.fillStyle = r() < .55 ? 'rgba(53,47,37,.10)' : 'rgba(226,215,187,.12)';
      g.fillRect(x, y, w, h);
    }
    g.fillStyle = 'rgba(45,39,32,.18)'; g.fillRect(0, 61, s, 3);
    speckle(g, 180, r, s, 0.14, 0.06);
  });

  const woodTex = (base, seed) => canvasTex(64, seed, (g, s, r) => {
    g.fillStyle = base; g.fillRect(0, 0, s, s);
    for (let x = 0; x < s; x++) {
      g.fillStyle = r() < 0.55 ? `rgba(0,0,0,${0.05 + r() * 0.13})` : `rgba(255,220,170,${r() * 0.08})`;
      g.fillRect(x, 0, 1, s);
    }
    // Painéis talhados: sombra do friso, borda interna e veios discretos.
    for (let x = 0; x < s; x += 16) {
      g.fillStyle = 'rgba(20,12,8,.42)'; g.fillRect(x, 0, 2, s);
      g.fillStyle = 'rgba(211,166,117,.23)'; g.fillRect(x + 2, 1, 1, s - 2);
      g.fillStyle = 'rgba(20,12,8,.25)'; g.fillRect(x + 5, 8, 1, 48); g.fillRect(x + 12, 8, 1, 48);
      g.fillStyle = 'rgba(211,166,117,.16)'; g.fillRect(x + 6, 9, 6, 1); g.fillRect(x + 6, 54, 6, 1);
    }
    g.fillStyle = 'rgba(15,10,7,.35)'; g.fillRect(0, 5, s, 2); g.fillRect(0, 57, s, 2);
    g.fillStyle = 'rgba(215,176,130,.17)'; g.fillRect(0, 7, s, 1); g.fillRect(0, 55, s, 1);
    // Nós de madeira em poucos pixels para sobreviver ao filtro de escala.
    for (let i = 0; i < 3; i++) {
      const x = 5 + (r() * 54 | 0), y = 5 + (r() * 54 | 0);
      g.fillStyle = 'rgba(25,15,10,.24)'; g.fillRect(x, y, 4, 2);
      g.fillStyle = 'rgba(195,148,103,.16)'; g.fillRect(x + 1, y + 1, 2, 1);
    }
    speckle(g, 90, r, s, 0.16, 0.05);
  });
  const wood = woodTex('#4c3022', 33);
  const woodLt = woodTex('#76523a', 34);

  const greenDoor = canvasTex(64, 39, (g, s, r) => {
    g.fillStyle = '#35463d'; g.fillRect(0, 0, s, s);
    for (let x = 0; x < s; x++) {
      g.fillStyle = r() < 0.55 ? 'rgba(0,0,0,.12)' : 'rgba(190,190,155,.05)';
      g.fillRect(x, 0, 1, s);
    }
    for (const x of [3, 30, 33, 60]) {
      g.fillStyle = 'rgba(12,19,17,.72)'; g.fillRect(x, 0, 2, s);
      g.fillStyle = 'rgba(169,162,127,.23)'; g.fillRect(x + 2, 1, 1, s - 2);
    }
    for (const y of [5, 58]) {
      g.fillStyle = 'rgba(15,21,18,.62)'; g.fillRect(4, y, 56, 2);
      g.fillStyle = 'rgba(187,177,139,.24)'; g.fillRect(5, y + 2, 54, 1);
    }
    for (const x of [7, 36]) {
      g.fillStyle = 'rgba(14,20,17,.55)'; g.fillRect(x, 10, 21, 39);
      g.fillStyle = 'rgba(164,158,126,.25)'; g.fillRect(x + 2, 12, 17, 1);
      g.fillRect(x + 2, 12, 1, 35);
      g.fillStyle = 'rgba(18,24,20,.32)'; g.fillRect(x + 4, 15, 13, 29);
      g.fillStyle = 'rgba(152,143,111,.18)'; g.fillRect(x + 5, 16, 1, 27);
    }
    speckle(g, 140, r, s, 0.14, 0.05);
  });

  const stairCarpet = canvasTex(64, 68, (g, s, r) => {
    g.fillStyle = '#482321'; g.fillRect(0, 0, s, s);
    g.fillStyle = '#71352b'; g.fillRect(5, 0, s - 10, s);
    g.fillStyle = '#a27e4e'; g.fillRect(7, 0, 2, s); g.fillRect(s - 9, 0, 2, s);
    g.fillStyle = 'rgba(25,15,13,.44)'; g.fillRect(12, 0, 1, s); g.fillRect(s - 13, 0, 1, s);
    g.fillStyle = 'rgba(199,166,108,.34)';
    for (let y = 2; y < s; y += 8) {
      g.fillRect(16, y, s - 32, 1);
      g.fillRect(20, y + 3, s - 40, 1);
    }
    for (let i = 0; i < 170; i++) {
      g.fillStyle = r() < 0.62 ? 'rgba(19,13,12,.18)' : 'rgba(225,193,142,.09)';
      g.fillRect((r() * s) | 0, (r() * s) | 0, 1, 1);
    }
  });

  const stone = canvasTex(64, 44, (g, s, r) => {
    g.fillStyle = '#85826f'; g.fillRect(0, 0, s, s);
    const bh = 16;
    for (let row = 0; row < s / bh; row++) {
      const off = row % 2 ? 16 : 0;
      for (let x = -off; x < s; x += 32) {
        g.fillStyle = `rgba(${r() < 0.5 ? '0,0,0' : '255,245,220'},${0.04 + r() * 0.08})`;
        g.fillRect(x, row * bh, 32, bh);
        g.fillStyle = 'rgba(30,28,22,.56)'; g.fillRect(x, row * bh, 1, bh);
        g.fillStyle = 'rgba(224,216,190,.18)'; g.fillRect(x + 1, row * bh + 1, 30, 1);
      }
      g.fillStyle = 'rgba(30,28,22,.5)'; g.fillRect(0, row * bh, s, 1);
    }
    speckle(g, 420, r, s, 0.25, 0.1);
  });

  const statuary = canvasTex(64, 83, (g, s, r) => {
    g.fillStyle = '#77766b'; g.fillRect(0, 0, s, s);
    for (let i = 0; i < 12; i++) {
      const x = r() * s, y = r() * s;
      g.fillStyle = r() < 0.5 ? 'rgba(29,31,29,.16)' : 'rgba(223,216,193,.13)';
      g.beginPath(); g.ellipse(x, y, 2 + r() * 8, 1 + r() * 4, r() * Math.PI, 0, Math.PI * 2); g.fill();
    }
    g.strokeStyle = 'rgba(35,34,30,.28)'; g.lineWidth = 1;
    for (let i = 0; i < 6; i++) {
      let x = r() * s, y = r() * s;
      g.beginPath(); g.moveTo(x, y);
      for (let j = 0; j < 3; j++) { x += (r() - 0.5) * 7; y += 2 + r() * 4; g.lineTo(x, y); }
      g.stroke();
    }
    speckle(g, 360, r, s, 0.2, 0.09);
  });

  const ceiling = canvasTex(64, 55, (g, s, r) => {
    g.fillStyle = '#524e42'; g.fillRect(0, 0, s, s);
    g.fillStyle = 'rgba(0,0,0,.28)';
    for (let i = 0; i < 4; i++) { g.fillRect(i * 16, 0, 1, s); g.fillRect(0, i * 16, s, 1); }
    speckle(g, 320, r, s, 0.25, 0.06);
  });

  const carpet = canvasTex(32, 66, (g, s, r) => {
    g.fillStyle = '#55231f'; g.fillRect(0, 0, s, s);
    g.fillStyle = '#9a7848'; g.fillRect(0, 0, s, 2); g.fillRect(0, s - 2, s, 2);
    g.fillStyle = '#7e4d36'; g.fillRect(3, 3, s - 6, s - 6);
    g.fillStyle = '#bd9a5d'; g.fillRect(5, 5, s - 10, 1); g.fillRect(5, s - 6, s - 10, 1);
    // Medalhão geométrico simplificado, padrão central do tapete do saguão.
    g.fillStyle = '#6b2922'; g.fillRect(11, 10, 10, 12);
    g.fillStyle = '#c2a063'; g.fillRect(14, 11, 4, 2); g.fillRect(13, 13, 6, 6); g.fillRect(14, 19, 4, 2);
    g.fillStyle = '#e1c17a'; g.fillRect(15, 14, 2, 4);
    speckle(g, 55, r, s, 0.18, 0.05);
  });

  const metal = canvasTex(32, 77, (g, s, r) => {
    g.fillStyle = '#34372f'; g.fillRect(0, 0, s, s);
    speckle(g, 140, r, s, 0.35, 0.12);
  });

  // Vidro de tempestade (azul-acinzentado com chuva escorrendo).
  const glass = canvasTex(64, 88, (g, s, r) => {
    const gr = g.createLinearGradient(0, 0, 0, s);
    gr.addColorStop(0, '#1a2634'); gr.addColorStop(1, '#4b6379');
    g.fillStyle = gr; g.fillRect(0, 0, s, s);
    for (let i = 0; i < 30; i++) {
      g.fillStyle = `rgba(190,215,235,${0.1 + r() * 0.22})`;
      g.fillRect((r() * s) | 0, (r() * s) | 0, 1, 3 + ((r() * 9) | 0));
    }
  });

  const upholstery = canvasTex(64, 99, (g, s, r) => {
    const shade = g.createLinearGradient(0, 0, s, s);
    shade.addColorStop(0, '#566054'); shade.addColorStop(0.52, '#39463e'); shade.addColorStop(1, '#28372f');
    g.fillStyle = shade; g.fillRect(0, 0, s, s);
    for (let offset = -s; offset < s * 2; offset += 16) {
      g.beginPath(); g.moveTo(offset, 0); g.lineTo(offset + s, s);
      g.strokeStyle = 'rgba(12,20,16,.48)'; g.lineWidth = 2; g.stroke();
      g.beginPath(); g.moveTo(offset + 1, 0); g.lineTo(offset + s + 1, s);
      g.strokeStyle = 'rgba(197,184,147,.18)'; g.lineWidth = 1; g.stroke();
      g.beginPath(); g.moveTo(offset, s); g.lineTo(offset + s, 0);
      g.strokeStyle = 'rgba(12,20,16,.42)'; g.lineWidth = 2; g.stroke();
      g.beginPath(); g.moveTo(offset + 1, s); g.lineTo(offset + s + 1, 0);
      g.strokeStyle = 'rgba(197,184,147,.14)'; g.lineWidth = 1; g.stroke();
    }
    for (const [x, y] of [[0, 0], [32, 0], [0, 32], [32, 32]]) {
      g.fillStyle = 'rgba(13,21,17,.62)';
      g.beginPath(); g.arc(x, y, 2.5, 0, Math.PI * 2); g.fill();
      g.fillStyle = 'rgba(208,192,151,.40)';
      g.fillRect(x - 0.5, y - 1, 1, 1);
    }
    for (let i = 0; i < 8; i++) {
      const x = (r() * s) | 0, y = (r() * s) | 0;
      g.fillStyle = `rgba(14,20,17,${0.08 + r() * 0.16})`;
      g.fillRect(x, y, 1 + (r() * 3 | 0), 1 + (r() * 2 | 0));
    }
    g.strokeStyle = 'rgba(218,203,167,.38)'; g.lineWidth = 1;
    g.strokeRect(3.5, 3.5, 57, 57);
    g.strokeStyle = 'rgba(10,17,14,.68)';
    g.strokeRect(5.5, 5.5, 53, 53);
    speckle(g, 300, r, s, 0.16, 0.07);
  });

  const lion = canvasTex(64, 117, (g, s, r) => {
    g.fillStyle = '#82765c'; g.fillRect(0, 0, s, s);
    for (let i = 0; i < 20; i++) {
      const x = r() * s, y = r() * s;
      g.strokeStyle = r() < 0.5 ? 'rgba(34,30,23,.18)' : 'rgba(228,211,174,.16)';
      g.lineWidth = 1;
      g.beginPath(); g.arc(x, y, 2 + r() * 5, r() * Math.PI, r() * Math.PI * 2); g.stroke();
    }
    g.strokeStyle = 'rgba(40,34,25,.22)'; g.lineWidth = 1;
    for (let i = 0; i < 7; i++) {
      const x = 4 + i * 9;
      g.beginPath(); g.moveTo(x, 4); g.lineTo(x + 4, 18); g.lineTo(x - 2, 33);
      g.lineTo(x + 3, 49); g.lineTo(x, 61); g.stroke();
    }
    speckle(g, 360, r, s, 0.24, 0.1);
  });

  const stainedGlass = canvasTex(128, 131, (g, s) => {
    const pane = (points, color) => {
      g.beginPath();
      points.forEach(([x, y], i) => i ? g.lineTo(x, y) : g.moveTo(x, y));
      g.closePath(); g.fillStyle = color; g.fill();
      g.strokeStyle = 'rgba(20,25,25,.94)'; g.lineWidth = 3; g.stroke();
    };
    g.fillStyle = '#172328'; g.fillRect(0, 0, s, s);
    const colors = ['#516b64', '#b28a50', '#405a70', '#79644a'];
    for (let i = 0; i < 4; i++) {
      const a = i * Math.PI / 2;
      const point = (radius, offset = 0) => [
        64 + Math.cos(a + offset) * radius,
        64 + Math.sin(a + offset) * radius,
      ];
      pane([point(8), point(58, -0.55), point(58, 0.55)], colors[i]);
      pane([point(10), point(61, 0.58), point(61, 0.99)], colors[(i + 1) % colors.length]);
    }
    g.beginPath(); g.arc(64, 64, 42, 0, Math.PI * 2);
    g.strokeStyle = '#1b2425'; g.lineWidth = 4; g.stroke();
    g.beginPath(); g.arc(64, 64, 19, 0, Math.PI * 2);
    g.fillStyle = '#b08b51'; g.fill();
    g.strokeStyle = '#1b2425'; g.lineWidth = 3; g.stroke();
    pane([[64, 49], [77, 64], [64, 79], [51, 64]], '#d0b77a');
    pane([[64, 56], [71, 64], [64, 72], [57, 64]], '#41584c');
    g.fillStyle = 'rgba(226,213,173,.34)';
    g.fillRect(62, 0, 2, 44); g.fillRect(62, 84, 2, 44);
    g.fillRect(0, 63, 44, 2); g.fillRect(84, 63, 44, 2);
  });

  const medallion = canvasTex(128, 143, (g) => {
    const cx = 64, cy = 64;
    g.fillStyle = 'rgba(18,23,21,.78)';
    g.beginPath(); g.arc(cx, cy, 60, 0, Math.PI * 2); g.fill();
    for (const [radius, color, width] of [[57, '#b39a65', 3], [50, '#293b36', 5], [43, '#9d8353', 2], [35, '#263632', 3]]) {
      g.beginPath(); g.arc(cx, cy, radius, 0, Math.PI * 2);
      g.strokeStyle = color; g.lineWidth = width; g.stroke();
    }
    g.fillStyle = '#82734c';
    for (let i = 0; i < 8; i++) {
      const a = i * Math.PI / 4;
      const x = cx + Math.cos(a) * 28, y = cy + Math.sin(a) * 28;
      g.save(); g.translate(x, y); g.rotate(a);
      g.beginPath(); g.moveTo(0, -13); g.lineTo(7, 0); g.lineTo(0, 13); g.lineTo(-7, 0); g.closePath(); g.fill();
      g.restore();
    }
    g.beginPath(); g.arc(cx, cy, 19, 0, Math.PI * 2);
    g.fillStyle = '#b29a66'; g.fill();
    g.strokeStyle = '#24322e'; g.lineWidth = 3; g.stroke();
    g.beginPath(); g.moveTo(cx, cy - 13); g.lineTo(cx + 11, cy);
    g.lineTo(cx, cy + 13); g.lineTo(cx - 11, cy); g.closePath();
    g.fillStyle = '#35483f'; g.fill();
    g.strokeStyle = '#d1b779'; g.lineWidth = 2; g.stroke();
    g.fillStyle = '#d1b779'; g.fillRect(cx - 1, cy - 7, 2, 14); g.fillRect(cx - 7, cy - 1, 14, 2);
  });

  const lionEmblem = canvasTex(128, 157, (g) => {
    g.fillStyle = 'rgba(24,33,30,.92)';
    g.beginPath();
    g.moveTo(64, 8); g.lineTo(111, 23); g.lineTo(105, 78);
    g.quadraticCurveTo(98, 105, 64, 120); g.quadraticCurveTo(30, 105, 23, 78);
    g.lineTo(17, 23); g.closePath(); g.fill();
    g.strokeStyle = '#b79a5e'; g.lineWidth = 4; g.stroke();
    g.strokeStyle = 'rgba(213,188,128,.78)'; g.lineWidth = 2;
    g.beginPath(); g.moveTo(39, 78); g.lineTo(64, 45); g.lineTo(89, 78); g.stroke();
    g.fillStyle = '#b79a5e'; g.fillRect(45, 70, 38, 25);
    g.fillStyle = '#283831'; g.fillRect(51, 76, 8, 19); g.fillRect(69, 76, 8, 19);
    g.beginPath(); g.arc(64, 42, 6, 0, Math.PI * 2); g.fill();
    g.strokeStyle = '#b79a5e'; g.lineWidth = 2;
    for (const side of [-1, 1]) {
      g.beginPath(); g.moveTo(35, 91); g.quadraticCurveTo(25, 77, 34, 62); g.stroke();
      g.beginPath(); g.moveTo(93, 91); g.quadraticCurveTo(103, 77, 94, 62); g.stroke();
      g.fillStyle = '#b79a5e';
      g.fillRect(side < 0 ? 31 : 94, 72, 4, 2);
      g.fillRect(side < 0 ? 29 : 96, 65, 4, 2);
    }
  });

  return {
    marble, floor, panel, wallStone, wainscot, plaster, wood, woodLt, greenDoor, stairCarpet, stone, statuary,
    ceiling, carpet, metal, glass, upholstery, lion, stainedGlass, medallion, lionEmblem,
  };
}
