// Ambiência e música sintetizadas localmente; não dependem de arquivos externos.
export function createAudio() {
  let ctx, master, shotBus, musicGainNode, streetMusicGainNode, started = false, stepClock = 0;
  let musicTimer, streetMusicTimer, thunderTimer, zombieTimer;
  let rainLayerGainNode, rainDetailGainNode;
  let gunshotBuffer, zombieMoanBuffer, zombieHordeBuffer;
  const zombieVoices = new Set();
  let environment = 'hall', rainGainNode, windGainNode;

  function noiseBuffer(seconds) {
    const buffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * seconds), ctx.sampleRate);
    const data = buffer.getChannelData(0);
    let last = 0;
    for (let i = 0; i < data.length; i++) {
      // Ruído rosa aproximado, menos áspero que ruído branco para chuva distante.
      const white = Math.random() * 2 - 1;
      last = last * 0.985 + white * 0.015;
      data[i] = last * 3.2;
    }
    return buffer;
  }

  function tone(freq, duration, type = 'sine', gain = 0.08, endFreq = freq, destination = master) {
    if (!started) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator(), amp = ctx.createGain();
    osc.type = type; osc.frequency.setValueAtTime(freq, now);
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, endFreq), now + duration);
    amp.gain.setValueAtTime(0.0001, now);
    amp.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), now + Math.min(0.04, duration * 0.2));
    amp.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    osc.connect(amp).connect(destination); osc.start(now); osc.stop(now + duration + 0.02);
  }

  function startMusic() {
    musicGainNode = ctx.createGain();
    musicGainNode.gain.value = environment === 'hall' ? 0.82 : 0;
    musicGainNode.connect(master);
    streetMusicGainNode = ctx.createGain();
    streetMusicGainNode.gain.value = environment === 'street' ? 0.46 : 0;
    streetMusicGainNode.connect(master);
    const music = ctx.createGain(); music.gain.value = 0.94; music.connect(musicGainNode);
    // Eco curto dá profundidade de sala grande sem esconder a chuva.
    const echo = ctx.createDelay(1.5), feedback = ctx.createGain(), wet = ctx.createGain();
    echo.delayTime.value = 0.62; feedback.gain.value = 0.18; wet.gain.value = 0.20;
    music.connect(echo); echo.connect(feedback).connect(echo); echo.connect(wet).connect(musicGainNode);
    const padFilter = ctx.createBiquadFilter(); padFilter.type = 'lowpass'; padFilter.frequency.value = 950;
    const pad = ctx.createGain(); pad.gain.value = 0.0001; padFilter.connect(pad).connect(music);
    // Progressão original de suspense: Ré menor, Si bemol, Sol menor e Lá maior.
    const chords = [[146.83, 174.61, 220.00], [116.54, 146.83, 174.61], [98.00, 116.54, 146.83], [110.00, 138.59, 164.81]];
    let bar = 0;
    const playBar = () => {
      if (!started) return;
      const now = ctx.currentTime, chord = chords[bar % chords.length];
      pad.gain.cancelScheduledValues(now); pad.gain.setValueAtTime(Math.max(0.0001, pad.gain.value), now);
      pad.gain.linearRampToValueAtTime(0.25, now + 1.8);
      pad.gain.setTargetAtTime(0.0001, now + 6.2, 1.4);
      chord.forEach((freq, i) => {
        const osc = ctx.createOscillator(), gain = ctx.createGain();
        osc.type = i === 0 ? 'triangle' : 'sine'; osc.frequency.value = freq / 2;
        gain.gain.value = i === 0 ? 0.38 : 0.21;
        osc.connect(gain).connect(padFilter); osc.start(now); osc.stop(now + 8.1);
      });
      // Notas esparsas, com ataque lento, sem citar a melodia original do jogo.
      const notes = [293.66, 261.63, 220, 196, 220, 174.61, 196, 164.81];
      const noteIndex = (bar * 2) % notes.length;
      const playPiano = (note, at) => {
        // Ataque macio, cauda longa e harmônico agudo: piano distante, mas audível.
        for (const [hz, level] of [[note, 0.105], [note * 2, 0.022], [note * 0.5, 0.027]]) {
          const osc = ctx.createOscillator(), env = ctx.createGain();
          osc.type = 'sine'; osc.frequency.value = hz;
          env.gain.setValueAtTime(0.0001, at);
          env.gain.linearRampToValueAtTime(level, at + 0.12);
          env.gain.exponentialRampToValueAtTime(0.0001, at + 3.6);
          osc.connect(env).connect(music); osc.start(at); osc.stop(at + 3.7);
        }
      };
      playPiano(notes[noteIndex], now);
      playPiano(notes[(noteIndex + 1) % notes.length], now + 3.3);
      bar++;
    };
    const streetFilter = ctx.createBiquadFilter();
    streetFilter.type = 'lowpass';
    streetFilter.frequency.value = 370;
    const streetPad = ctx.createGain();
    streetPad.gain.value = 0.22;
    streetPad.connect(streetFilter).connect(streetMusicGainNode);
    for (const [frequency, level] of [[55, 0.11], [65.41, 0.055], [82.41, 0.035]]) {
      const drone = ctx.createOscillator(), voice = ctx.createGain();
      drone.type = 'sine';
      drone.frequency.value = frequency;
      voice.gain.value = level;
      drone.connect(voice).connect(streetPad);
      drone.start();
    }
    const streetNotes = [73.42, 65.41, 77.78, 58.27, 69.3];
    let streetNote = 0;
    const playStreetCue = () => {
      if (!started || environment !== 'street') return;
      const now = ctx.currentTime;
      const note = ctx.createOscillator(), envelope = ctx.createGain(), filter = ctx.createBiquadFilter();
      note.type = 'triangle';
      note.frequency.setValueAtTime(streetNotes[streetNote++ % streetNotes.length], now);
      note.frequency.exponentialRampToValueAtTime(38, now + 5.2);
      filter.type = 'lowpass';
      filter.frequency.value = 190;
      envelope.gain.setValueAtTime(0.0001, now);
      envelope.gain.linearRampToValueAtTime(0.055, now + 1.1);
      envelope.gain.exponentialRampToValueAtTime(0.0001, now + 5.5);
      note.connect(filter).connect(envelope).connect(streetMusicGainNode);
      note.start(now);
      note.stop(now + 5.6);
    };
    playBar(); musicTimer = setInterval(playBar, 8000);
    streetMusicTimer = setInterval(playStreetCue, 16000);
  }

  async function loadAudioAsset(path) {
    try {
      const response = await fetch(path);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await ctx.decodeAudioData(await response.arrayBuffer());
    } catch (error) {
      console.error(`Nao foi possivel carregar o audio ${path}.`, error);
      return null;
    }
  }

  function playZombieAmbience() {
    if (!started || environment !== 'street') return;
    const useHorde = zombieHordeBuffer && Math.random() < 0.24;
    const buffer = useHorde ? zombieHordeBuffer : zombieMoanBuffer;
    if (!buffer) return;
    const now = ctx.currentTime;
    const source = ctx.createBufferSource(), filter = ctx.createBiquadFilter();
    const gain = ctx.createGain(), panner = ctx.createStereoPanner();
    source.buffer = buffer;
    source.playbackRate.value = 0.92 + Math.random() * 0.16;
    filter.type = 'lowpass';
    filter.frequency.value = useHorde ? 850 + Math.random() * 650 : 1250 + Math.random() * 1250;
    filter.Q.value = 0.55;
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(useHorde ? 0.19 : 0.25, now + 0.5);
    gain.gain.setTargetAtTime(useHorde ? 0.14 : 0.19, now + 0.5, 0.8);
    gain.gain.setTargetAtTime(0.0001, now + Math.max(0.5, buffer.duration - 0.45), 0.22);
    panner.pan.value = (Math.random() * 1.7) - 0.85;
    const voice = { source, gain };
    zombieVoices.add(voice);
    source.connect(filter).connect(gain).connect(panner);
    panner.connect(master);

    const reflection = ctx.createDelay(0.5), reflectionFilter = ctx.createBiquadFilter();
    const reflectionGain = ctx.createGain();
    reflection.delayTime.value = 0.19 + Math.random() * 0.11;
    reflectionFilter.type = 'lowpass';
    reflectionFilter.frequency.value = 1050;
    reflectionGain.gain.value = useHorde ? 0.22 : 0.12;
    panner.connect(reflection).connect(reflectionFilter).connect(reflectionGain).connect(master);
    source.onended = () => {
      source.disconnect();
      filter.disconnect();
      gain.disconnect();
      panner.disconnect();
      reflection.disconnect();
      reflectionFilter.disconnect();
      reflectionGain.disconnect();
      zombieVoices.delete(voice);
    };
    source.start(now);
  }

  function scheduleZombie(delay) {
    if (!started) return;
    zombieTimer = setTimeout(() => {
      if (environment === 'street') playZombieAmbience();
      scheduleZombie();
    }, delay ?? (environment === 'street' ? 2300 + Math.random() * 3300 : 15000 + Math.random() * 12000));
  }

  function start() {
    if (started) { if (ctx.state === 'suspended') ctx.resume(); return; }
    ctx = new AudioContext(); master = ctx.createGain(); master.gain.value = 0.62; master.connect(ctx.destination);
    const shotCompressor = ctx.createDynamicsCompressor();
    shotCompressor.threshold.value = -12;
    shotCompressor.knee.value = 8;
    shotCompressor.ratio.value = 5;
    shotCompressor.attack.value = 0.002;
    shotCompressor.release.value = 0.16;
    shotBus = ctx.createGain();
    shotBus.gain.value = 1.5;
    shotBus.connect(shotCompressor).connect(master);

    // Chuva contínua abafada pelas paredes, com vento grave atravessando as janelas.
    const rain = ctx.createBufferSource(); rain.buffer = noiseBuffer(4); rain.loop = true;
    const rainBand = ctx.createBiquadFilter(); rainBand.type = 'bandpass'; rainBand.frequency.value = 1150; rainBand.Q.value = 0.42;
    rainGainNode = ctx.createGain(); rainGainNode.gain.value = environment === 'street' ? 0.28 : 0.035;
    rain.connect(rainBand).connect(rainGainNode).connect(master); rain.start();
    // Camada de gotas finas e impacto no asfalto: dá escala de chuva aberta sem virar ruído branco.
    const rainDetail = ctx.createBufferSource(); rainDetail.buffer = noiseBuffer(2.7); rainDetail.loop = true;
    const rainHigh = ctx.createBiquadFilter(); rainHigh.type = 'highpass'; rainHigh.frequency.value = 2400;
    const rainPulse = ctx.createBiquadFilter(); rainPulse.type = 'lowpass'; rainPulse.frequency.value = 7200;
    rainDetailGainNode = ctx.createGain(); rainDetailGainNode.gain.value = environment === 'street' ? 0.105 : 0.012;
    rainDetail.connect(rainHigh).connect(rainPulse).connect(rainDetailGainNode).connect(master); rainDetail.start();
    const wind = ctx.createBufferSource(); wind.buffer = noiseBuffer(5); wind.loop = true;
    const low = ctx.createBiquadFilter(); low.type = 'lowpass'; low.frequency.value = 310;
    windGainNode = ctx.createGain(); windGainNode.gain.value = environment === 'street' ? 0.19 : 0.10;
    const lfo = ctx.createOscillator(), lfoGain = ctx.createGain();
    lfo.frequency.value = 0.09; lfoGain.gain.value = environment === 'street' ? 0.055 : 0.035;
    lfo.connect(lfoGain).connect(windGainNode.gain); lfo.start();
    wind.connect(low).connect(windGainNode).connect(master); wind.start();
    const hum = ctx.createOscillator(), humGain = ctx.createGain();
    hum.type = 'sine'; hum.frequency.value = 54; humGain.gain.value = 0.012;
    hum.connect(humGain).connect(master); hum.start();
    started = true;
    startMusic();
    Promise.all([
      loadAudioAsset('/audio/beretta-m9-shot.mp3'),
      loadAudioAsset('/audio/zombie-moan.mp3'),
      loadAudioAsset('/audio/zombie-horde.mp3'),
    ]).then(([shot, moan, horde]) => {
      gunshotBuffer = shot;
      zombieMoanBuffer = moan;
      zombieHordeBuffer = horde;
      if (environment === 'street') playZombieAmbience();
    });

    // Trovões distantes e irregulares, construídos com ruído filtrado e subgrave.
    const thunder = () => {
      if (!started) return;
      thunderTimer = setTimeout(() => {
        if (!started) return;
        const now = ctx.currentTime;
        const outdoors = environment === 'street';
        const src = ctx.createBufferSource(), filter = ctx.createBiquadFilter(), amp = ctx.createGain();
        src.buffer = noiseBuffer(outdoors ? 5 : 3.5); filter.type = 'lowpass'; filter.frequency.value = outdoors ? 240 + Math.random() * 180 : 180 + Math.random() * 120;
        amp.gain.setValueAtTime(0.0001, now);
        amp.gain.linearRampToValueAtTime(outdoors ? 0.72 : 0.045, now + (outdoors ? 0.42 : 0.22));
        amp.gain.setValueAtTime(outdoors ? 0.52 : 0.028, now + (outdoors ? 0.9 : 0.55));
        amp.gain.exponentialRampToValueAtTime(0.0001, now + (outdoors ? 7.2 : 4.2));
        src.connect(filter).connect(amp).connect(master); src.start(now); src.stop(now + (outdoors ? 4.9 : 3.4));
        tone(42 + Math.random() * 16, outdoors ? 5.6 : 3.4, 'sine', outdoors ? 0.48 : 0.035, 24);
        thunder();
      }, 12000 + Math.random() * 20000);
    };
    thunder();
    scheduleZombie();
  }
  function setEnvironment(location) {
    environment = location === 'street' ? 'street' : 'hall';
    if (!started || !ctx) return;
    const now = ctx.currentTime;
    rainGainNode.gain.setTargetAtTime(environment === 'street' ? 0.28 : 0.035, now, 0.7);
    rainDetailGainNode.gain.setTargetAtTime(environment === 'street' ? 0.105 : 0.012, now, 0.8);
    windGainNode.gain.setTargetAtTime(environment === 'street' ? 0.19 : 0.10, now, 0.9);
    musicGainNode.gain.setTargetAtTime(environment === 'street' ? 0 : 0.82, now, 1.8);
    streetMusicGainNode.gain.setTargetAtTime(environment === 'street' ? 0.46 : 0, now, 1.8);
    if (environment === 'hall') {
      zombieVoices.forEach(({ source, gain }) => {
        gain.gain.setTargetAtTime(0.0001, now, 0.08);
        source.stop(now + 0.35);
      });
    }
    clearTimeout(zombieTimer);
    scheduleZombie(environment === 'street' ? 650 : 15000 + Math.random() * 12000);
  }

  function footstep(speed = 2) {
    if (!started) return;
    const now = ctx.currentTime;
    const src = ctx.createBufferSource(), filter = ctx.createBiquadFilter(), amp = ctx.createGain();
    src.buffer = noiseBuffer(0.09); filter.type = 'lowpass'; filter.frequency.value = 210;
    amp.gain.setValueAtTime(0.0001, now); amp.gain.exponentialRampToValueAtTime(0.16, now + 0.012);
    amp.gain.exponentialRampToValueAtTime(0.001, now + 0.09);
    src.connect(filter).connect(amp).connect(master); src.start(now);
    tone(82, 0.07, 'triangle', 0.045, 48);
  }
  function update(dt, speed) {
    if (speed < 0.35) { stepClock = 0; return; }
    stepClock -= dt;
    if (stepClock <= 0) { footstep(speed); stepClock = Math.max(0.42, 0.78 - speed * 0.1); }
  }
  function toggleFlashlight(on) { if (started) tone(on ? 740 : 520, 0.055, 'square', 0.025, on ? 420 : 300); }
  function interaction() { tone(680, 0.08, 'square', 0.035, 460); }
  function gunshot() {
    if (!started) return;
    const now = ctx.currentTime;
    if (gunshotBuffer) {
      const source = ctx.createBufferSource(), gain = ctx.createGain();
      source.buffer = gunshotBuffer;
      source.playbackRate.value = 0.98 + Math.random() * 0.04;
      gain.gain.value = 1.2;
      source.connect(gain).connect(shotBus);
      const echo = ctx.createDelay(0.55), filter = ctx.createBiquadFilter(), echoGain = ctx.createGain();
      echo.delayTime.value = environment === 'hall' ? 0.12 : 0.21;
      filter.type = 'lowpass';
      filter.frequency.value = environment === 'hall' ? 1200 : 850;
      echoGain.gain.value = environment === 'hall' ? 0.24 : 0.16;
      gain.connect(echo).connect(filter).connect(echoGain).connect(shotBus);
      source.start(now);
      source.onended = () => {
        source.disconnect();
        gain.disconnect();
        echo.disconnect();
        filter.disconnect();
        echoGain.disconnect();
      };
      return;
    }
    const buffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.22), ctx.sampleRate);
    const samples = buffer.getChannelData(0);
    for (let i = 0; i < samples.length; i++) samples[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource(), body = ctx.createBiquadFilter(), bodyGain = ctx.createGain();
    src.buffer = buffer;
    body.type = 'bandpass'; body.frequency.setValueAtTime(1050, now);
    body.frequency.exponentialRampToValueAtTime(280, now + 0.14); body.Q.value = 0.72;
    bodyGain.gain.setValueAtTime(0.0001, now);
    bodyGain.gain.exponentialRampToValueAtTime(1.8, now + 0.003);
    bodyGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.15);
    src.connect(body).connect(bodyGain).connect(shotBus);

    const crack = ctx.createBiquadFilter(), crackGain = ctx.createGain();
    crack.type = 'highpass'; crack.frequency.value = 2400;
    crackGain.gain.setValueAtTime(0.0001, now);
    crackGain.gain.exponentialRampToValueAtTime(1.6, now + 0.001);
    crackGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.035);
    src.connect(crack).connect(crackGain).connect(shotBus);

    const echo = ctx.createDelay(0.3), echoFilter = ctx.createBiquadFilter(), echoGain = ctx.createGain();
    echo.delayTime.value = 0.105; echoFilter.type = 'lowpass'; echoFilter.frequency.value = 1050;
    echoGain.gain.setValueAtTime(0.0001, now);
    echoGain.gain.exponentialRampToValueAtTime(environment === 'hall' ? 0.42 : 0.3, now + 0.11);
    echoGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.36);
    bodyGain.connect(echo).connect(echoFilter).connect(echoGain).connect(shotBus);
    src.start(now); src.stop(now + 0.22);
    tone(125, 0.16, 'triangle', 0.7, 42, shotBus);
    tone(1850, 0.045, 'square', 0.18, 780, shotBus);
  }
  function emptyGun() { tone(380, 0.035, 'square', 0.026, 250); }
  function reload() {
    if (!started) return;
    const now = ctx.currentTime;
    // Sequência mecânica: soltar carregador, retirar, inserir, travar e puxar o ferrolho.
    // Cada evento usa ruído filtrado + ressonância curta, em vez de bipes tonais.
    const click = (offset, duration, center, level, resonance = 0.16) => {
      const at = now + offset;
      const source = ctx.createBufferSource();
      const buffer = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * duration), ctx.sampleRate);
      const data = buffer.getChannelData(0);
      let previous = 0;
      for (let i = 0; i < data.length; i++) {
        const white = Math.random() * 2 - 1;
        previous = previous * 0.35 + white * 0.65;
        data[i] = previous;
      }
      source.buffer = buffer;
      const filter = ctx.createBiquadFilter(); filter.type = 'bandpass';
      filter.frequency.setValueAtTime(center, at); filter.Q.value = 1.1;
      const amp = ctx.createGain();
      amp.gain.setValueAtTime(0.0001, at);
      amp.gain.exponentialRampToValueAtTime(level, at + 0.004);
      amp.gain.exponentialRampToValueAtTime(0.0001, at + duration);
      source.connect(filter).connect(amp).connect(master);
      source.start(at); source.stop(at + duration + 0.01);
      source.onended = () => { source.disconnect(); filter.disconnect(); amp.disconnect(); };
      const body = ctx.createOscillator(), bodyAmp = ctx.createGain();
      body.type = 'triangle'; body.frequency.setValueAtTime(center * 0.42, at);
      body.frequency.exponentialRampToValueAtTime(Math.max(35, center * 0.24), at + duration);
      bodyAmp.gain.setValueAtTime(0.0001, at);
      bodyAmp.gain.exponentialRampToValueAtTime(level * resonance, at + 0.006);
      bodyAmp.gain.exponentialRampToValueAtTime(0.0001, at + duration * 1.5);
      body.connect(bodyAmp).connect(master); body.start(at); body.stop(at + duration * 1.5 + 0.01);
      body.onended = () => { body.disconnect(); bodyAmp.disconnect(); };
    };
    click(0.02, 0.075, 1450, 0.16, 0.12);  // trava do carregador
    click(0.22, 0.16, 720, 0.20, 0.28);    // carregador sendo retirado
    click(0.78, 0.11, 980, 0.17, 0.2);     // carregador novo encaixando
    click(1.02, 0.085, 1850, 0.22, 0.13);  // batida na base
    click(1.31, 0.13, 1250, 0.19, 0.22);   // ferrolho puxado
    click(1.52, 0.07, 2100, 0.14, 0.12);   // ferrolho retornando
  }

  return { start, setEnvironment, update, toggleFlashlight, interaction, gunshot, emptyGun, reload };
}
