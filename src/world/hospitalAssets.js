/**
 * Assets opcionais do hospital (ex.: pacote "Hospital Wing" da Fab, GLB).
 *
 * Tudo que o hospital desenha de forma procedural (leitos, macas, soro, corpos...) tem um "encaixe" (slot).
 * Se o arquivo do encaixe existe em /models/hospital/, o hospital usa o modelo no lugar exato da peça
 * procedural (mesma posição, mesma colisão); se não existe, continua usando a peça procedural.
 * Ou seja: sem arquivos, o visual é exatamente o de antes.
 *
 * Os encaixes são configurados em public/models/hospital/manifest.json (sem mexer em código).
 */
const BASE = '/models/hospital/';

// Confere se o arquivo existe de verdade. Servidores com "fallback para index.html" respondem 200 a qualquer
// caminho, então o tipo do conteúdo também é verificado.
async function exists(url) {
  try {
    const res = await fetch(url, { method: 'HEAD' });
    const type = res.headers.get('content-type') ?? '';
    return res.ok && !type.includes('text/html');
  } catch {
    return false;
  }
}

/** @returns {Promise<Record<string, {url:string,height:number,rotationY:number,yOffset:number,tint:number|null,position?:number[],scale?:number,data?:object}>>} */
export async function loadHospitalAssets() {
  const found = {};
  let manifest;
  try {
    const res = await fetch(`${BASE}manifest.json`);
    if (!res.ok || (res.headers.get('content-type') ?? '').includes('text/html')) return found;
    manifest = await res.json();
  } catch {
    return found;
  }
  const entries = { ...(manifest.props ?? {}) };
  if (manifest.exterior) entries.exterior = manifest.exterior;
  await Promise.all(Object.entries(entries).map(async ([slot, cfg]) => {
    if (!cfg || !cfg.file) return;
    const url = cfg.file.startsWith('/') ? cfg.file : BASE + cfg.file;
    if (!(await exists(url))) {
      console.warn(`[hospital] "${slot}": arquivo não encontrado (${url}); usando a peça procedural.`);
      return;
    }
    found[slot] = {
      url, height: cfg.height ?? 1, rotationY: cfg.rotationY ?? 0, yOffset: cfg.yOffset ?? 0,
      tint: cfg.tint ?? null, position: cfg.position, scale: cfg.scale,
    };
    // Dados extras do modelo (ex.: colisão e entrada do prédio, gerados junto com o GLB)
    if (cfg.data) {
      try {
        const dataUrl = cfg.data.startsWith('/') ? cfg.data : BASE + cfg.data;
        const res = await fetch(dataUrl);
        if (res.ok && !(res.headers.get('content-type') ?? '').includes('text/html')) found[slot].data = await res.json();
      } catch { /* sem dados: usa os padrões */ }
    }
  }));
  return found;
}
