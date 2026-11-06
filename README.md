# RPD Survival

Fan game de terror/survival em terceira pessoa ambientado na Delegacia de
Raccoon City (1998). O foco visual é **realismo de cenário**: superfícies PBR,
iluminação indireta por HDRI, props escaneados e pós-processamento
cinematográfico.

> Projeto em desenvolvimento. Todos os assets novos de cenário são **CC0**
> (Poly Haven) e funcionam offline.

## Como rodar

```bash
npm install
npm run assets     # baixa texturas PBR, HDRIs e modelos CC0 (uma vez)
npm run dev        # http://localhost:5173
```

Build de produção:

```bash
npm run build
npm run preview
```

## O que foi feito para sair do visual "Minecraft"

- **Materiais PBR reais**: mármore, pedra, reboco, madeira, tecido, metal,
  asfalto, concreto e tijolo com albedo + normal + mapa ARM (oclusão /
  rugosidade / metalicidade) em 1k. As texturas procedurais de 32–128 px com
  filtro *nearest* foram substituídas por mapas fotográficos com filtragem
  linear, mipmaps e anisotropia.
- **Iluminação baseada em HDRI**: ambiente PMREM para o saguão e para a rua,
  céu noturno, luzes de janela, pendentes, apliques e lanterna com sombras.
- **Props 3D escaneados**: busto de mármore, relógio de pé, estante com livros,
  cadeiras de couro, carteiras escolares, mesas, caixotes, plantas, luminária
  de mesa, relógio de parede, telefone público, hidrante, lixeira, barril e
  caixa de utilidades.
- **Pós-processamento**: GTAO (oclusão em espaço de tela), bloom, tone mapping
  ACES, gradação de cor, vinheta e grão de filme; MSAA no composer.
- **Chão de mármore com juntas reais** e medalhão de mosaico em alta resolução.
- **Sombras**: spotlight principal do saguão, sombra da lanterna e oclusão
  de contato do GTAO nas junções e nos móveis.
- **Céu e horizonte da rua** com prédios CC0 em escala real e névoa noturna.
- **Presets de qualidade** automáticos (alto/médio/baixo), com seletor na tela
  inicial.

## Qualidade gráfica

O renderer mede a GPU e escolhe um preset:

| Preset | Uso típico | O que muda |
| --- | --- | --- |
| **Alto** | GPU dedicada | MSAA 4x, GTAO 0.55, bloom, todas as sombras (spot 2048, point 512, lua 2048) |
| **Médio** | Intel/AMD integrada | resolução 0.8, MSAA 2x, GTAO 0.45, bloom, sombras reduzidas (spot 1024, sem point/direcional) |
| **Baixo** | GPU muito fraca / software | resolução 0.7, sem composer (render direto), só a sombra da lanterna |

Na tela inicial, os botões **ALTO / MÉDIO / BAIXO** gravam a escolha em
`localStorage` e recarregam a página. Também é possível forçar pela URL:
`?q=high`, `?q=medium` ou `?q=low`.

Na Intel HD 620 de referência: ~10 fps no alto, ~20 fps no médio e ~30 fps no
baixo em 1080×810. Em GPU dedicada, o alto fica confortável.

## Controles

`W A S D` mover · `mouse` virar · botão direito mirar · botão esquerdo atirar ·
`I`/`Tab` inventário · `R` recarregar · `E` usar · `F` lanterna.

## Assets e licenças

Os assets CC0 baixados ficam em:

```
public/textures/pbr/<id>/{diffuse,normal,arm}.jpg
public/hdri/<id>_1k.hdr
public/models/polyhaven/<id>/<id>.gltf
```

Catálogo, origem e licenças: **[public/ASSET-CREDITS.txt](public/ASSET-CREDITS.txt)**.

- `npm run assets` — baixa o que estiver faltando (Poly Haven, CC0 1.0).
- `npm run credits` — regenera a lista de créditos a partir de
  `public/assets-manifest.json`.

Nenhum asset é buscado em tempo de execução; o build é offline.

## Estrutura principal

```
src/
  main.js                 renderer, troca de cena, loop e presets
  render/
    pbr.js                texturas/materiais PBR + fallback
    environment.js        HDRIs → PMREM, céu e ambiente por cena
    postfx.js             composer (GTAO, bloom, ACES, grade)
    quality.js            detecção de GPU e presets
    lightPool.js          pool fixo de luzes pontuais
  world/
    builder.js            merge de geometria, UV de mundo, vertex AO
    policeStation.js      saguão da R.P.D.
    cityStreet.js         rua de Raccoon City
    textures.js           desenhos gráficos (vitral, medalhão, brasão)
    props.js              loader/clone/colisão dos props CC0
  player/player.js        personagem, câmera, lanterna e mira
tools/
  fetch-assets.mjs        download dos assets CC0
  write-credits.mjs       geração dos créditos
```

## Limitações conhecidas

- O modelo do personagem ainda é a malha PS1 de Leon fornecida no projeto
  original; ela foi reiluminada com material PBR, mas a geometria é antiga.
- O quarteirão da rua ainda usa várias caixas de fachada combinadas com
  modelos de prédio; o foco do realismo ficou no saguão e nos props.
- O céu noturno é um HDRI 1k escurecido; em telas muito grandes pode faltar
  resolução nas estrelas.
