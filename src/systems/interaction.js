/**
 * Interações contextuais: mostra "[E] Ação" perto de objetos e dispara onUse().
 * Só considera objetos do mesmo andar, dentro do raio e à frente da câmera.
 */
export function createInteraction({ promptEl, toastEl, addAmmo = () => {}, onTransition = () => {} }) {
  const items = [];
  let current = null;
  let toastTimer = 0;

  function toast(msg, seconds = 4.2) {
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    toastTimer = seconds;
  }
  const ctx = { toast, addAmmo, transition: onTransition };

  function update(dt, state) {
    if (toastTimer > 0) {
      toastTimer -= dt;
      if (toastTimer <= 0) toastEl.classList.remove('show');
    }
    const fx = Math.sin(state.yaw), fz = Math.cos(state.yaw);
    let best = null, bestD = Infinity;
    for (const it of items) {
      if (it.enabled && !it.enabled()) continue;
      if (Math.abs(it.y - state.y) > 2.5) continue;
      const dx = it.pos.x - state.x, dz = it.pos.z - state.z;
      const d = Math.hypot(dx, dz);
      if (d > it.radius) continue;
      if (d > 0.8 && (dx * fx + dz * fz) / d < 0.15) continue;   // precisa estar à frente da câmera
      if (d < bestD) { best = it; bestD = d; }
    }
    current = best;
    if (current) { promptEl.innerHTML = `<b>E</b> ${current.label}`; promptEl.classList.add('show'); }
    else promptEl.classList.remove('show');
  }

  return {
    add: (it) => items.push(it),
    setItems(nextItems) { items.splice(0, items.length, ...nextItems); current = null; promptEl.classList.remove('show'); },
    update,
    use() { if (current) current.onUse(ctx); },
    toast,
  };
}
