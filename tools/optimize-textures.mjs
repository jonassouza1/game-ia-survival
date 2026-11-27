// Recodifica public/textures/pbr/<id>/{diffuse,normal,arm}.jpg:
//   • <mapa>.webp       mesma resolução (1k), menor qualidade WebP que atinja PSNR >= 40 dB contra o JPG original
//                       (se nem q99 chegar a 36 dB — normal maps ruidosos —, o JPG original é mantido, sem perda);
//   • <mapa>_512.webp   variante 512 px, usada pelo preset BAIXO (1/4 da memória de vídeo).
// Gera também src/render/pbrFormats.js (extensão de cada mapa). Uso: node tools/optimize-textures.mjs
import sharp from 'sharp';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = 'public/textures/pbr';
const TARGET_PSNR = 40, KEEP_JPG_BELOW = 36;
const START_Q = { diffuse: 90, normal: 92, arm: 90 };
let before = 0, after = 0;
const formats = {};

function psnr(a, b) {
  let se = 0;
  for (let i = 0; i < a.length; i++) { const d = a[i] - b[i]; se += d * d; }
  const mse = se / a.length;
  return mse === 0 ? 99 : 10 * Math.log10(255 * 255 / mse);
}

for (const id of fs.readdirSync(ROOT).sort()) {
  formats[id] = {};
  for (const kind of ['diffuse', 'normal', 'arm']) {
    const src = path.join(ROOT, id, `${kind}.jpg`);
    if (!fs.existsSync(src)) continue;
    const srcSize = fs.statSync(src).size;
    before += srcSize;
    const meta = await sharp(src).metadata();
    const a = await sharp(src).raw().toBuffer();
    let p = 0, chosen = null;
    for (const q of [START_Q[kind], 94, 97, 99]) {
      const buf = await sharp(src).webp({ quality: q, effort: 6 }).toBuffer();
      p = psnr(a, await sharp(buf).raw().toBuffer());
      chosen = buf;
      if (p >= TARGET_PSNR) break;
    }
    if (p < KEEP_JPG_BELOW || chosen.length >= srcSize) {
      formats[id][kind] = 'jpg';           // mantém o original
      after += srcSize;
      console.log(`  ${id}/${kind}: mantido em JPG (WebP daria ${p.toFixed(1)} dB)`);
    } else {
      formats[id][kind] = 'webp';
      fs.writeFileSync(path.join(ROOT, id, `${kind}.webp`), chosen);
      after += chosen.length;
      fs.unlinkSync(src);
    }
    const size = Math.max(meta.width, meta.height);
    const low = await sharp(path.join(ROOT, id, formats[id][kind] === 'jpg' ? `${kind}.jpg` : `${kind}.webp`))
      .resize(Math.min(512, size), Math.min(512, size), { kernel: 'lanczos3', fit: 'fill' })
      .webp({ quality: 92, effort: 6 }).toBuffer();
    fs.writeFileSync(path.join(ROOT, id, `${kind}_512.webp`), low);
    after += low.length;
  }
}
fs.writeFileSync('src/render/pbrFormats.js',
  `// GERADO por tools/optimize-textures.mjs — extensão de cada mapa PBR (webp, ou jpg quando o WebP perderia detalhe).\nexport const PBR_FORMATS = ${JSON.stringify(formats, null, 1)};\n`);
console.log(`PBR: ${(before / 1048576).toFixed(1)} MB (jpg) → ${(after / 1048576).toFixed(1)} MB (1k + variante 512)`);
