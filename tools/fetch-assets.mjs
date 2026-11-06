#!/usr/bin/env node
/**
 * Baixa os assets CC0 da Poly Haven usados pelo RPD Survival.
 *
 * Uso:
 *   node tools/fetch-assets.mjs            # baixa tudo que ainda não existe
 *   node tools/fetch-assets.mjs --force    # rebaixa tudo
 *   node tools/fetch-assets.mjs textures   # só uma categoria
 *
 * Tudo vai para public/ (texturas PBR, HDRIs e modelos), então o jogo roda
 * offline. A Poly Haven libera esses assets em CC0 1.0 (domínio público).
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC = path.join(ROOT, 'public');
const API = 'https://api.polyhaven.com';

const FORCE = process.argv.includes('--force');
const ONLY = process.argv.slice(2).filter((arg) => !arg.startsWith('--'));

// ─────────────────────────────── Catálogo ───────────────────────────────
// Texturas de superfície: 3 mapas (albedo, normal, ARM = AO/Rough/Metal).
const TEXTURES = [
  // Saguão
  'marble_tiles',              // piso do saguão
  'marble_01',                 // mármore liso (estátuas, guarnições)
  'granite_tile',              // pedestais e base das escadas
  'stone_tiles',               // paredes de pedra lascada
  'large_grey_tiles',          // paredes de pedra lisa (ashlar)
  'wooden_panels',             // lambri e balcão da recepção
  'dark_wooden_planks',        // madeira escura (vigas, portas)
  'wood_floor_worn',           // piso de madeira desgastado
  'painted_plaster_wall',      // reboco pintado (paredes superiores)
  'worn_plaster_wall',         // reboco descascado (recessos)
  'white_plaster_02',          // teto
  'quatrefoil_jacquard_fabric',// tapete e passadeira das escadas
  'fabric_leather_01',         // estofados
  'metal_plate_02',            // metais escuros
  'rusty_metal',               // ferragens e metal enferrujado
  // Rua
  'asphalt_02',
  'concrete_pavement',
  'red_brick',
  'brick_wall_10',
];

// HDRIs equiretangulares (1k) para iluminação indireta e reflexos.
const HDRIS = [
  'abandoned_hall_01',         // ambiente do saguão
  'cobblestone_street_night',  // ambiente da rua
  'qwantani_night_puresky',    // céu noturno da rua
  'wasteland_clouds',          // céu carregado (reserva)
];

// Modelos CC0 (glTF 1k com texturas). `height` em metros só documenta a escala
// pretendida; o posicionamento fica no código da cena.
const MODELS = [
  'GreenChair_01',
  'painted_wooden_bench',
  'vintage_grandfather_clock_01',
  'wooden_bookshelf_worn',
  'book_encyclopedia_set_01',
  'marble_bust_01',
  'potted_plant_02',
  'wooden_crate_01',
  'ammo_box',
  'mantel_clock_01',
  'desk_lamp_arm_01',
  'metal_office_desk',
  'SchoolDesk_01',
  'WoodenTable_02',
  'vintage_oil_lamp',
  'antique_ceramic_vase_01',
  'vintage_telephone_wall_clock',
  'folding_wooden_stool',
  'fire_hydrant',
  'metal_trash_can',
  'trashbag',
  'korean_public_payphone_01',
  'Barrel_01',
  'utility_box_01',
  'street_lamp_01',
];

const CONCURRENCY = 4;

// ─────────────────────────────── Helpers ───────────────────────────────
async function getJSON(url, attempt = 1) {
  try {
    const response = await fetch(url, { headers: { 'User-Agent': 'rpd-survival-asset-fetcher' } });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } catch (error) {
    if (attempt >= 4) throw error;
    await new Promise((resolve) => setTimeout(resolve, 400 * attempt));
    return getJSON(url, attempt + 1);
  }
}

async function download(url, destination, attempt = 1) {
  try {
    const response = await fetch(url, { headers: { 'User-Agent': 'rpd-survival-asset-fetcher' } });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const buffer = Buffer.from(await response.arrayBuffer());
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.writeFile(destination, buffer);
    return buffer.length;
  } catch (error) {
    if (attempt >= 4) throw error;
    await new Promise((resolve) => setTimeout(resolve, 500 * attempt));
    return download(url, destination, attempt + 1);
  }
}

async function exists(file) {
  try { await fs.access(file); return true; } catch { return false; }
}

async function pool(items, worker) {
  let index = 0;
  let failures = 0;
  const runners = Array.from({ length: Math.min(CONCURRENCY, items.length) }, async () => {
    while (index < items.length) {
      const item = items[index++];
      try {
        await worker(item);
      } catch (error) {
        failures++;
        console.error(`  ✗ ${item}: ${error.message}`);
      }
    }
  });
  await Promise.all(runners);
  return failures;
}

const bytes = (n) => `${(n / 1024 / 1024).toFixed(1)} MB`;

// ─────────────────────────────── Texturas ───────────────────────────────
async function fetchTexture(id) {
  const folder = path.join(PUBLIC, 'textures', 'pbr', id);
  const target = {
    diffuse: path.join(folder, 'diffuse.jpg'),
    normal: path.join(folder, 'normal.jpg'),
    arm: path.join(folder, 'arm.jpg'),
  };
  if (!FORCE && await exists(target.arm) && await exists(target.diffuse) && await exists(target.normal)) {
    console.log(`  · ${id} (já existe)`);
    return;
  }
  const files = await getJSON(`${API}/files/${id}`);
  const maps = [
    ['Diffuse', target.diffuse],
    ['nor_gl', target.normal],
    ['arm', target.arm],
  ];
  let total = 0;
  for (const [key, file] of maps) {
    const entry = files[key]?.['1k']?.jpg ?? files[key]?.['1k']?.png;
    if (!entry) throw new Error(`mapa ${key} 1k indisponível`);
    total += await download(entry.url, file);
  }
  console.log(`  ✓ ${id} — ${bytes(total)}`);
}

// ───────────────────────────────── HDRIs ─────────────────────────────────
async function fetchHdri(id) {
  const file = path.join(PUBLIC, 'hdri', `${id}_1k.hdr`);
  if (!FORCE && await exists(file)) {
    console.log(`  · ${id} (já existe)`);
    return;
  }
  const files = await getJSON(`${API}/files/${id}`);
  const entry = files.hdri?.['1k']?.hdr;
  if (!entry) throw new Error('HDR 1k indisponível');
  const size = await download(entry.url, file);
  console.log(`  ✓ ${id} — ${bytes(size)}`);
}

// ───────────────────────────────── Modelos ─────────────────────────────────
async function fetchModel(id) {
  const folder = path.join(PUBLIC, 'models', 'polyhaven', id);
  const mainFile = path.join(folder, `${id}.gltf`);
  if (!FORCE && await exists(mainFile)) {
    console.log(`  · ${id} (já existe)`);
    return;
  }
  const files = await getJSON(`${API}/files/${id}`);
  const gltf = files.gltf?.['1k']?.gltf;
  if (!gltf) throw new Error('glTF 1k indisponível');
  let total = await download(gltf.url, mainFile);
  const entries = Object.entries(gltf.include ?? {});
  for (const [relative, entry] of entries) {
    const destination = path.join(folder, relative.replaceAll('/', path.sep));
    total += await download(entry.url, destination);
  }
  console.log(`  ✓ ${id} — ${bytes(total)} (${entries.length + 1} arquivos)`);
}

// ───────────────────────────────── Catálogo de créditos ─────────────────
async function writeManifest() {
  const manifest = {
    generatedBy: 'tools/fetch-assets.mjs',
    source: 'Poly Haven — https://polyhaven.com',
    license: 'CC0 1.0 Universal (https://creativecommons.org/publicdomain/zero/1.0/)',
    textures: TEXTURES.map((id) => ({ id, path: `/textures/pbr/${id}/` })),
    hdris: HDRIS.map((id) => ({ id, path: `/hdri/${id}_1k.hdr` })),
    models: MODELS.map((id) => ({ id, path: `/models/polyhaven/${id}/${id}.gltf` })),
  };
  await fs.writeFile(
    path.join(PUBLIC, 'assets-manifest.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
}

// ─────────────────────────────────── main ───────────────────────────────────
const categories = ONLY.length ? ONLY : ['textures', 'hdris', 'models'];
console.log(`Poly Haven → ${path.relative(ROOT, PUBLIC)} (${categories.join(', ')})`);
let failures = 0;

if (categories.includes('textures')) {
  console.log('\nTexturas PBR');
  failures += await pool(TEXTURES, fetchTexture);
}
if (categories.includes('hdris')) {
  console.log('\nHDRIs');
  failures += await pool(HDRIS, fetchHdri);
}
if (categories.includes('models')) {
  console.log('\nModelos');
  failures += await pool(MODELS, fetchModel);
}

await writeManifest();
console.log(failures ? `\n${failures} falha(s). Rode de novo para tentar só o que faltou.` : '\nTudo pronto.');
process.exit(failures ? 1 : 0);
