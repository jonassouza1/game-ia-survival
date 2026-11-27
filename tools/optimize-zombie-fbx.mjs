// Reduz os FBX de zumbi (Mixamo): ~98% do peso eram PNGs 2048² embutidos.
//   • diffuse/normal → WebP em no máx. 1024 px (é o que o jogo já usava: zombieRig.js reduzia para 1024 ao carregar);
//   • specular (e qualquer outro mapa) → 4×4 px: o material do zumbi (zombieAppearance.js) só usa map + normalMap.
// Geometria, esqueleto e skin não são tocados. Uso: node tools/optimize-zombie-fbx.mjs [pasta]
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { parseFBX, serializeFBX, readProps, writeProps } from './fbx-lib.mjs';

const dir = process.argv[2] ?? 'public/models/zombies';
const MAX = 1024;
// PSNR em RGBA, ignorando o RGB de pixels totalmente transparentes (lixo que ninguém vê).
const psnr = (a, b, ch = 4) => {
  let se = 0, n = 0;
  for (let i = 0; i < a.length; i += ch) {
    if (ch === 4 && a[i + 3] === 0 && b[i + 3] === 0) continue;
    for (let c = 0; c < ch; c++) { const d = a[i + c] - b[i + c]; se += d * d; n++; }
  }
  return se && n ? 10 * Math.log10(65025 / (se / n)) : 99;
};

for (const file of fs.readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.fbx'))) {
  const full = path.join(dir, file);
  const buf = fs.readFileSync(full);
  const tree = parseFBX(buf);
  const objects = tree.roots.find((n) => n.name === 'Objects');
  const log = [];
  for (const video of objects.children.filter((n) => n.name === 'Video')) {
    const content = video.children.find((c) => c.name === 'Content');
    if (!content) continue;
    const cp = readProps(content);
    const original = cp[0]?.data;
    if (!original?.length) continue;
    const rel = video.children.find((c) => c.name === 'RelativeFilename');
    const abs = video.children.find((c) => c.name === 'Filename');
    const nameProps = rel ? readProps(rel) : abs ? readProps(abs) : null;
    const fileName = nameProps ? nameProps[0].data.toString('utf8') : '';
    const kind = /normal/i.test(fileName) ? 'normal' : /diffuse|albedo|color|body/i.test(fileName) ? 'diffuse' : 'unused';
    let out, note = '';
    const meta = await sharp(original).metadata();
    if (kind === 'unused') {
      out = await sharp({ create: { width: 4, height: 4, channels: 3, background: { r: 128, g: 128, b: 128 } } }).webp({ lossless: true }).toBuffer();
      note = '→ 4×4 (não usado pelo material)';
    } else {
      const scale = Math.min(1, MAX / Math.max(meta.width, meta.height));
      const w = Math.round(meta.width * scale), h = Math.round(meta.height * scale);
      const base = sharp(original).resize(w, h, { kernel: 'lanczos3' });
      const ensure4 = (img) => img.ensureAlpha();
      const refRGBA = await ensure4(base.clone()).raw().toBuffer();
      let p = 0;
      // normal maps: o WebP com perda usa croma 4:2:0 e mancha o detalhe → near-lossless; diffuse: qualidade alta.
      const tries = kind === 'normal' ? [{ nearLossless: true, quality: 60 }] : [{ quality: 90 }, { quality: 94 }, { quality: 97 }];
      for (const opts of tries) {
        out = await base.clone().webp({ ...opts, effort: 6, exact: meta.hasAlpha }).toBuffer();   // exact: guarda o RGB sob pixels transparentes
        p = psnr(refRGBA, await ensure4(sharp(out)).raw().toBuffer());
        if (p >= 42) break;
      }
      note = `→ ${w}×${h} WebP, PSNR ${p.toFixed(1)} dB`;
    }
    cp[0].data = out;
    writeProps(content, cp);
    for (const n of [rel, abs]) {
      if (!n) continue;
      const ps = readProps(n);
      ps[0].data = Buffer.from(ps[0].data.toString('utf8').replace(/\.[A-Za-z0-9]+$/, '.webp'), 'utf8');
      writeProps(n, ps);
    }
    log.push(`   ${kind.padEnd(7)} ${path.basename(fileName)}  ${(original.length / 1024).toFixed(0)} KB ${note}  (${(out.length / 1024).toFixed(0)} KB)`);
  }
  const result = serializeFBX(tree);
  fs.writeFileSync(full, result);
  console.log(`${file}: ${(buf.length / 1048576).toFixed(2)} MB → ${(result.length / 1048576).toFixed(2)} MB\n${log.join('\n')}`);
}
