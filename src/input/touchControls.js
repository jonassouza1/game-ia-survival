/**
 * Controles de toque (celular/tablet) para o jogo em terceira pessoa.
 *
 *   • Metade esquerda da tela  → joystick flutuante (aparece onde o dedo toca).
 *                                 Dentro do anel = andar/trotar (velocidade analógica);
 *                                 além do anel = correr.
 *   • Metade direita da tela   → arrastar o dedo gira a câmera (como o mouse).
 *   • FOGO                     → mira sozinho e atira; segurar repete o tiro, e dá para
 *                                 arrastar o dedo sobre o botão para ajustar a mira.
 *   • MIRAR                    → liga/desliga a mira (botão de alternar).
 *   • RECARREGAR / USAR / LUZ / ITENS / pausa → botões de toque.
 *
 * Os eventos são tratados por `identifier`, então vários dedos funcionam ao mesmo tempo
 * (andar + olhar + atirar). Este módulo só conversa com o jogo por `player.touch` e `actions`.
 */

const SENS_KEY = 'rpd-touch-sens';
const SENS_STEPS = { low: 0.7, mid: 1, high: 1.5 };

export function getStoredSensitivity() {
  try {
    const stored = window.localStorage.getItem(SENS_KEY);
    if (SENS_STEPS[stored]) return stored;
  } catch { /* sem storage */ }
  return 'mid';
}

export function createTouchControls({ container, player, actions }) {
  const root = document.createElement('div');
  root.id = 'touch-ui';
  root.className = 'tc-hidden';
  root.innerHTML = `
    <div class="tc-stick" aria-hidden="true"><div class="tc-knob"></div></div>
    <div class="tc-top">
      <div class="tc-chip" data-act="flash"><span>LUZ</span></div>
      <div class="tc-chip" data-act="items"><span>ITENS</span></div>
      <div class="tc-chip" data-act="pause"><span>II</span></div>
    </div>
    <div class="tc-actions">
      <div class="tc-btn tc-use" data-act="use" hidden><span>USAR</span><small></small></div>
      <div class="tc-btn tc-reload" data-act="reload"><span>RECARR.</span></div>
      <div class="tc-btn tc-aim" data-act="aim"><span>MIRAR</span></div>
      <div class="tc-btn tc-fire" data-act="fire"><span>FOGO</span></div>
    </div>`;
  container.append(root);

  const stick = root.querySelector('.tc-stick');
  const knob = root.querySelector('.tc-knob');
  const useButton = root.querySelector('.tc-use');
  const useLabel = useButton.querySelector('small');
  const aimButton = root.querySelector('.tc-aim');
  const fireButton = root.querySelector('.tc-fire');

  let sensitivity = SENS_STEPS[getStoredSensitivity()];
  // radianos por pixel CSS (o mouse usa 0.0022 / 0.002, mas o dedo precisa de mais alcance)
  const LOOK = { yaw: 0.0056, pitch: 0.0048 };
  const DEADZONE = 0.14;
  const RUN_ON = 1.3, RUN_OFF = 1.05;   // múltiplos do raio do joystick
  const FOLLOW = 1.55;                  // além disso, a base do joystick acompanha o dedo

  /** id do toque → { kind: 'stick'|'look'|'fire'|'button', ... } */
  const active = new Map();
  let usable = false;

  function rect() { return root.getBoundingClientRect(); }
  function stickRadius() { const r = rect(); return Math.max(44, Math.min(78, Math.min(r.width, r.height) * 0.13)); }
  const vibrate = (ms) => { try { navigator.vibrate?.(ms); } catch { /* sem vibração */ } };

  // ── Joystick ────────────────────────────────────────────────────────────────────────────
  function stickStart(t, entry) {
    const r = rect();
    entry.kind = 'stick';
    entry.cx = t.clientX - r.left;
    entry.cy = t.clientY - r.top;
    entry.radius = stickRadius();
    stick.style.setProperty('--r', `${entry.radius}px`);
    stick.style.left = `${entry.cx}px`;
    stick.style.top = `${entry.cy}px`;
    stick.classList.add('on');
    stickMove(t, entry);
  }
  function stickMove(t, entry) {
    const r = rect();
    let dx = t.clientX - r.left - entry.cx;
    let dy = t.clientY - r.top - entry.cy;
    let raw = Math.hypot(dx, dy) / entry.radius;
    if (raw > FOLLOW) {                      // arrasta a base junto, para o dedo não "fugir"
      const k = (raw - FOLLOW) / raw;
      entry.cx += dx * k; entry.cy += dy * k;
      stick.style.left = `${entry.cx}px`; stick.style.top = `${entry.cy}px`;
      dx -= dx * k; dy -= dy * k;
      raw = FOLLOW;
    }
    const mag = Math.min(raw, 1);
    const nx = raw > 0 ? dx / (raw * entry.radius) : 0;   // direção unitária
    const ny = raw > 0 ? dy / (raw * entry.radius) : 0;
    const live = raw >= DEADZONE;
    player.touch.moveX = live ? nx * mag : 0;
    player.touch.moveY = live ? ny * mag : 0;
    if (!player.touch.run && raw > RUN_ON) player.touch.run = true;
    else if (player.touch.run && raw < RUN_OFF) player.touch.run = false;
    const shown = Math.min(raw, 1) * entry.radius;
    knob.style.transform = `translate(${nx * shown}px, ${ny * shown}px)`;
    stick.classList.toggle('run', player.touch.run);
  }
  function stickEnd() {
    player.touch.moveX = 0; player.touch.moveY = 0; player.touch.run = false;
    stick.classList.remove('on', 'run');
    knob.style.transform = 'translate(0px, 0px)';
  }

  // ── Botões ──────────────────────────────────────────────────────────────────────────────
  function buttonDown(el, entry) {
    const act = el.dataset.act;
    entry.kind = 'button'; entry.el = el; entry.act = act;
    el.classList.add('down');
    switch (act) {
      case 'fire':
        entry.kind = 'fire';
        player.touch.setFire(true);
        vibrate(10);
        break;
      case 'aim': {
        const on = !player.touch.aim;
        player.touch.aim = on;
        aimButton.classList.toggle('on', on);
        break;
      }
      case 'reload': actions.reload(); vibrate(8); break;
      case 'use': actions.use(); vibrate(12); break;
      case 'flash': actions.flash(); break;
      case 'items': actions.items(); break;
      case 'pause': actions.pause(); break;
      default: break;
    }
  }
  function buttonUp(entry) {
    entry.el?.classList.remove('down');
    if (entry.kind === 'fire') player.touch.setFire(false);
  }

  // ── Câmera ──────────────────────────────────────────────────────────────────────────────
  function look(dx, dy) { player.look(dx * LOOK.yaw * sensitivity, dy * LOOK.pitch * sensitivity); }

  // ── Eventos ─────────────────────────────────────────────────────────────────────────────
  function onStart(event) {
    event.preventDefault();
    if (!usable) return;
    const r = rect();
    for (const t of event.changedTouches) {
      const entry = { x: t.clientX, y: t.clientY };
      const el = t.target instanceof Element ? t.target.closest('[data-act]') : null;
      if (el && !el.hidden) buttonDown(el, entry);
      else if (t.clientX - r.left < r.width * 0.46) stickStart(t, entry);
      else entry.kind = 'look';
      active.set(t.identifier, entry);
    }
  }
  function onMove(event) {
    event.preventDefault();
    for (const t of event.changedTouches) {
      const entry = active.get(t.identifier);
      if (!entry) continue;
      if (entry.kind === 'stick') stickMove(t, entry);
      else if (entry.kind === 'look' || entry.kind === 'fire') look(t.clientX - entry.x, t.clientY - entry.y);
      entry.x = t.clientX; entry.y = t.clientY;
    }
  }
  function onEnd(event) {
    event.preventDefault();
    for (const t of event.changedTouches) {
      const entry = active.get(t.identifier);
      if (!entry) continue;
      if (entry.kind === 'stick') stickEnd();
      else buttonUp(entry);
      active.delete(t.identifier);
    }
    if (event.touches.length === 0 && active.size) reset(false);   // segurança: nenhum dedo, nenhum estado preso
  }
  const opts = { passive: false };
  root.addEventListener('touchstart', onStart, opts);
  root.addEventListener('touchmove', onMove, opts);
  root.addEventListener('touchend', onEnd, opts);
  root.addEventListener('touchcancel', onEnd, opts);
  // Pinça/zoom do iOS e menu de contexto (toque longo)
  document.addEventListener('gesturestart', (e) => e.preventDefault());
  root.addEventListener('contextmenu', (e) => e.preventDefault());

  /** Solta tudo (pausa, inventário, troca de aba). `clearAim` também desliga o botão MIRAR. */
  function reset(clearAim = true) {
    for (const entry of active.values()) { if (entry.kind === 'button' || entry.kind === 'fire') entry.el?.classList.remove('down'); }
    active.clear();
    stickEnd();
    player.touch.setFire(false);
    if (clearAim) { player.touch.aim = false; aimButton.classList.remove('on'); }
  }
  window.addEventListener('blur', () => reset(true));

  return {
    element: root,
    show() { usable = true; root.classList.remove('tc-hidden'); },
    hide() { usable = false; reset(true); root.classList.add('tc-hidden'); },
    reset,
    /** Mostra o botão USAR com o texto da ação contextual; `null` esconde. */
    setUseTarget(label) {
      if (label) {
        useLabel.textContent = label;
        useButton.hidden = false;
      } else useButton.hidden = true;
    },
    setSensitivity(step) {
      if (!SENS_STEPS[step]) return;
      sensitivity = SENS_STEPS[step];
      try { window.localStorage.setItem(SENS_KEY, step); } catch { /* sem storage */ }
    },
    setAmmoEmpty(empty) { fireButton.classList.toggle('empty', empty); },
  };
}
