# Refatoração, performance e tempestade

## Removido (código/arquivos mortos)
- `src/render/ps1.js`, `src/world/fixedViews.js` — módulos nunca importados.
- `inspect2.mjs` — script de debug solto na raiz.
- Boneco procedural de reserva e pistola `service_pistol` (+ `public/models/service_pistol/`).
- Sistema de câmeras fixas em `player.js` (`getFixedView`, `displayCamera`, oclusão, `positionInView`…). `player.js`: 1.100 → ~460 linhas.
- Céu morto da rua (`skyline`, `urbanHorizon`, `starField`), que ficava sempre `visible = false`. O gerador aleatório
  com semente continua avançando o mesmo número de passos (1.168 + 180), então chuva, fogo e props não mudam.
- Animações de zumbi sem uso: `run`, `crawl`, `runningCrawl`, `neckBite` (entradas de `CLIP_FILES`).
- Assets sem uso em tempo de execução, retirados das listas de download/manifesto/créditos:
  `stone_tiles`, `wasteland_clouds`, `metal_office_desk`, `antique_ceramic_vase_01`, `utility_box_01`, `street_lamp_01`.
- Variáveis/imports/funções sem uso (ESLint: 25 avisos → 0), `preloadPBR`, timers e nós de áudio nunca lidos.

## Performance
- Rua: caixas estáticas fundidas por material e célula de 16 m (`mergeStaticBoxes`). Draw calls 1.197 → ~790–820,
  objetos 1.300 → 785, objetos que lançam sombra 1.048 → 533. As caixas originais continuam como alvos de raycast
  (câmera, tiros, mira), então a colisão é idêntica.
- Contrapartida: os blocos fundidos são descartados em grupo, então ~7% mais triângulos entram no desenho.

## Novo: tempestade (`src/render/storm.js`)
Nuvens em shader, raios ramificados, clarões em várias piscadas e trovão sincronizado por distância.
Veja a seção "Tempestade" do README.

## Novo: hospital abandonado (`src/world/hospital.js`)
Cenário completo no fim da rua, com porta de entrada na fachada e porta de saída de volta à rua. `main.js` passou a
usar uma tabela de cenários (`SCENES`), então novos locais entram sem mexer no resto. Também: ambiente próprio em
`environment.js`, 4 zumbis em `roster.js`, colisão na fachada do prédio (antes dava para atravessá-lo) e música
silenciada dentro do hospital (`audio.js`). Interior procedural, sem assets novos.

## Verificação feita (Chromium sem GPU)
- Build e lint limpos; nenhum módulo órfão.
- Teste de jogabilidade em CPU (andar, mirar, atirar, recarregar, trocar de cena, zumbis): resultados numéricos
  idênticos aos do projeto original.
- Delegacia: mesmas contagens do original. Rua: sem erros; hashes de chuva e fogo idênticos ao original.
- Hospital: vistas de todas as salas em qualidade baixa e média; teste funcional rua → hospital → rua, colisões nas
  paredes e vãos, loot e zumbis; saguão e rua seguem com resultados idênticos aos de antes.
- Tempestade vista em qualidade baixa e média; trovão medido no mixer (rua ~4× a energia do ambiente).

## Não verificado
- FPS real em GPU; o som do trovão aos ouvidos; a primeira troca de cena para a rua em GPU real.
