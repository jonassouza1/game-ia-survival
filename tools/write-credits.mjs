#!/usr/bin/env node
/**
 * Gera public/ASSET-CREDITS.txt a partir do manifesto baixado da Poly Haven.
 * Rode depois de tools/fetch-assets.mjs.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'public/assets-manifest.json'), 'utf8'));

const list = (items) => items.map((item) => `- ${item.id}`).join('\n');

const credits = `RPD SURVIVAL — CRÉDITOS E LICENÇAS DE ASSETS
=================================================

Assets CC0 da Poly Haven
------------------------
Os assets abaixo foram baixados da Poly Haven (https://polyhaven.com) e são
licenciados em CC0 1.0 Universal (domínio público):
https://creativecommons.org/publicdomain/zero/1.0/

Texturas PBR (albedo + normal + ARM/oclusão-rugosidade-metal):
${list(manifest.textures)}

HDRIs (iluminação indireta, reflexos e céu):
${list(manifest.hdris)}

Modelos 3D (props de cenário):
${list(manifest.models)}

Personagem e animações (Mixamo/Adobe, não CC0)
--------------------------------------------
- public/models/character/swat.glb — "SWAT" — Mixamo, via biblioteca de
  personagens three.ws (https://three.ws/character-library). Licença Mixamo
  (Adobe): uso gratuito em projetos, mas consulte os termos da Adobe antes de
  redistribuir o arquivo isoladamente.
- public/models/character/Soldier.glb — "Soldier" — Mixamo, via exemplos do
  three.js (https://github.com/mrdoob/three.js). Usado apenas como fonte dos
  clipes Idle/Walk/Run, retargetados para o esqueleto do SWAT.
- O personagem antigo em public/models/leon foi removido; o modelo procedural
  de fallback continua no código, sem depender de assets externos.

Os arquivos ficam em public/textures/pbr/, public/hdri/,
public/models/polyhaven/ e public/models/character/. O script
tools/fetch-assets.mjs baixa novamente qualquer arquivo ausente;
tools/write-credits.mjs regenera esta lista.

Assets CC0 já presentes no projeto
----------------------------------
- public/models/service_pistol/ — Poly Haven, https://polyhaven.com/a/service_pistol — CC0 1.0
- public/models/covered_car/ — Poly Haven — CC0 1.0 (atribuição em ASSET.txt)
- public/audio/beretta-m9-shot.mp3 — SoundBible, "Barreta M9" — domínio público
  https://soundbible.com/1906-Barreta-M9.html

Áudio com atribuição Creative Commons
-------------------------------------
- "Zombie Moan" — Mike Koenig, SoundBible — CC BY 3.0
  https://soundbible.com/1035-Zombie-Moan.html
- "Zombie Horde" — Mike Koenig, SoundBible — CC BY 3.0
  https://soundbible.com/1833-Zombie-Horde.html
  O jogo varia velocidade, posição estéreo, volume e filtros na reprodução.

Áudio original deste projeto
----------------------------
- public/audio/pistol-reload-original.wav — efeito sintetizado para o RPD
  Survival, com cliques, raspagem metálica e impactos mecânicos. Não é uma
  gravação retirada de Resident Evil.

Modelos e texturas pré-existentes
---------------------------------
- Os modelos de prédios/carros em public/models/*.glb já faziam parte do projeto
  original. A licença deles não é reivindicada aqui; verifique a origem antes de
  redistribuir o jogo.
- Os desenhos gráficos do vitral, medalhão, brasão e placas são gerados por
  canvas no código do jogo.

Como os assets são usados
-------------------------
- As texturas PBR são aplicadas com UV de mundo no Builder e no cenário da rua.
- Os HDRIs são convertidos em PMREM para iluminação indireta e usados como céu.
- Os modelos são normalizados em metros, recebem sombra e têm colisão simples.
- Nenhum asset é baixado em tempo de execução: o jogo funciona offline.

Este arquivo foi gerado por tools/write-credits.mjs.
`;

fs.writeFileSync(path.join(ROOT, 'public/ASSET-CREDITS.txt'), credits);
console.log('Créditos atualizados.');
