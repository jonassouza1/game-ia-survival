/**
 * Detecção de dispositivo de toque.
 *
 * Considera "celular/tablet" quando o ponteiro principal é impreciso (dedo) e não há hover.
 * Dá para forçar na URL, útil para testar no PC: ?touch=1 (liga) ou ?touch=0 (desliga).
 */
function detect() {
  const forced = new URLSearchParams(window.location.search).get('touch');
  if (forced === '1') return true;
  if (forced === '0') return false;
  const coarse = window.matchMedia?.('(pointer: coarse)').matches ?? false;
  const noHover = window.matchMedia?.('(hover: none)').matches ?? false;
  const hasTouch = (navigator.maxTouchPoints || 0) > 0 || 'ontouchstart' in window;
  return hasTouch && (coarse || noHover);
}

export const isTouchDevice = detect();
