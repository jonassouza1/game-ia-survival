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
- **Personagem real e animado**: SWAT Mixamo (malha, esqueleto e texturas
  reais), clipes Mixamo de idle/walk/run retargetados para o esqueleto do SWAT,
  mira de pistola por IK de dois ossos e pistola CC0 presa à mão.
- **Movimento mais natural**: aceleração/desaceleração, andar (`C`), correr
  (`Shift`), inclinação lateral da câmera, balanço e FOV de corrida.
- **Props 3D escaneados**: busto de mármore, relógio de pé, estante com livros,
  cadeiras de couro, carteiras escolares, mesas, caixotes, plantas, luminária
  de mesa, relógio de parede, telefone público no saguão, hidrante, lixeira,
  barril e caixa de utilidades.
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

Na Intel HD 620 de referência: ~10 fps no alto, ~20 fps no médio e ~50 fps no
baixo em 1080×810. Em GPU dedicada, o alto fica confortável.

## Controles

`W A S D` mover · `Shift` correr · `C` andar · `mouse` virar · botão direito
mirar · botão esquerdo atirar · `I`/`Tab` inventário · `R` recarregar · `E` usar
· `F` lanterna.

## Assets e licenças

Os assets CC0 baixados ficam em:

```
public/textures/pbr/<id>/{diffuse,normal,arm}.jpg
public/hdri/<id>_1k.hdr
public/models/polyhaven/<id>/<id>.gltf
public/models/character/{swat,Soldier}.glb
```

Catálogo, origem e licenças: **[public/ASSET-CREDITS.txt](public/ASSET-CREDITS.txt)**.

- `npm run assets` — baixa o que estiver faltando (Poly Haven CC0 + personagem
  Mixamo).
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
    storm.js              nuvens, raios, clarões e trovões da rua (um controlador só)
  world/
    builder.js            merge de geometria, UV de mundo, vertex AO
    policeStation.js      saguão da R.P.D.
    cityStreet.js         rua de Raccoon City
    hospital.js            hospital abandonado (interior procedural, estilo The Last of Us)
    textures.js           desenhos gráficos (vitral, medalhão, brasão)
    props.js              loader/clone/colisão dos props CC0
  player/player.js        personagem SWAT/Mixamo, IK de mira, câmera e lanternas
tools/
  fetch-assets.mjs        download dos assets CC0 e do personagem Mixamo
  write-credits.mjs       geração dos créditos
```

## Limitações conhecidas

- O personagem é um SWAT do Mixamo (licença Mixamo/Adobe, não CC0). A mira usa
  IK procedural; em alguns ângulos a mão pode não encaixar perfeitamente na
  pistola.
- O quarteirão da rua ainda usa várias caixas de fachada combinadas com
  modelos de prédio; o foco do realismo ficou no saguão e nos props.
- O céu noturno é um HDRI 1k escurecido, coberto por uma cúpula de nuvens em
  shader (`storm.js`); em telas muito grandes pode faltar resolução nas estrelas.

## Hospital abandonado

Fica no fim da rua: as portas duplas da fachada (z ≈ 67) levam ao interior, em `src/world/hospital.js`, que segue o
mesmo contrato do saguão do RPD (`collisions`, `occluders`, `props`, `update`, `resetEntrance`, `spawn`). Planta: saguão e
recepção, corredor central, enfermaria (oeste), cirurgia (leste), necrotério (noroeste), UTI (nordeste) e uma saída de
emergência acorrentada. Há 4 zumbis parados no escuro (`roster.js`, local `hospital`), 2 pacotes de munição e 8 itens
examináveis. A música é cortada ali; só chuva e vento distantes.

Não há assets externos de hospital: macas, leitos, soro, cadeiras de rodas, corpos, sangue, escombros e placas são
geometria procedural (fundida pelo `Builder` em poucos draw calls) com as texturas PBR e os props que o projeto já tem.
Para trocar por modelos prontos (GLB), carregue-os com `createProps` e posicione no lugar das peças procedurais.
Para adicionar outro cenário, siga o mesmo caminho: um arquivo `src/world/<nome>.js`, uma entrada em `SCENES`
(`main.js`), em `LOCATIONS` (`environment.js` e `roster.js`) e uma porta de acesso no mundo de origem.

## Tempestade (rua)

`src/render/storm.js` controla tudo num só lugar: cada descarga sorteia direção e distância, e dela saem juntos o
**raio** (faixas ramificadas com halo; só nas descargas próximas), o **clarão** (várias piscadas, que acendem o céu, as
nuvens, a luz ambiente e a `stormLight` da rua) e o **trovão** (`audio.thunder(atraso, potência)`), que chega depois do
clarão em proporção à distância e fica abafado dentro do saguão. As nuvens são uma cúpula de shader que acompanha a câmera
(raio 100, abaixo do `far` de 110); o número de oitavas de ruído depende do preset de qualidade.

Ajustes rápidos, em `createStorm` e `strike` (`storm.js`): intervalo entre descargas (`nextStrike = rand(7, 19)`), proporção de descargas
próximas (`near = Math.random() < 0.7`), chance de descarga dupla (`0.25`) e distâncias (`R`). Para testar sem esperar,
no console: `__rpd.storm.strike({ near: true })`.

## Zumbis (inimigos)

Código em `src/enemies/`:

| Arquivo | O que faz |
|---|---|
| `roster.js` | **Edite aqui**: modelos, aparência de cada zumbi e onde eles ficam (RPD e rua). |
| `zombieManager.js` | IA (acordar, levantar, gritar, perseguir, escada, A* quando trava, ataque), tiro/dano por zona, sangue, dano no jogador. |
| `zombieRig.js` | Carregamento de GLB/FBX, retarget das animações, mistura de clipes, reação a tiro e hitboxes por osso. |
| `zombieClips.js` | Lista das animações Mixamo de zumbi (`public/animations/zombie/*.fbx`). |
| `zombieAppearance.js` | Shader de zumbi: palidez, sujeira, roupas recoloridas e sangue colado no corpo. |

**Animações usadas** (Mixamo): `idle` (policiais parados) · `scream` (policiais notam você) · `biting2` (comendo a vítima) ·
`biting` (trecho final: levantar) · `walk` (perseguição) · `attack` (mordida; o dano cai no contato) ·
`death` (headshot, cai de costas) · `dying` (tiros no corpo, ajoelha e desaba). Para usar outra animação Mixamo,
baixe o FBX em `public/animations/zombie/` e acrescente a entrada em `CLIP_FILES` (`zombieClips.js`).

**Dano por zona** (vida 100): cabeça 100 (1 tiro) · pescoço 50 · peito 34 (3 tiros) · abdômen 30 · braço 12 · perna 20.
Se a bala passa pelo braço e continua para o tronco, conta como peito/abdômen.
**Mordida**: 20 de dano (5 mordidas = morte). Velocidade de perseguição, dano e tempos: `TUNING` em `zombieManager.js`.

### Trocando por zumbis mais realistas
Veja o cabeçalho de `roster.js`: baixe um personagem zumbi no [mixamo.com](https://www.mixamo.com) como **FBX Binary, T-pose**,
coloque em `public/models/zombies/` (com as texturas na mesma pasta) e aponte em `MODELS`. Não precisa baixar animações:
as de `public/animations/zombie/` são retargetadas automaticamente para qualquer esqueleto Mixamo.
