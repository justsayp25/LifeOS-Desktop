/* R.E.N.E.E. voice (v1.2)
 * Listening: Whisper in the browser (WebGPU when there is one, else tiny.en on wasm), with a simple silence detector.
 * Speaking: Kokoro-82M on WebGPU only (on wasm it runs slower than real time, so the browser voice is used instead).
 * Answers stream from /api/voice/ask and are spoken sentence by sentence while the rest is still being written.
 * Models download once from the CDN / Hugging Face, then the browser caches them.
 * If anything fails to load, window.reneeVoice.<engine>.failed is set and the page
 * falls back to the browser's own voice. */
(function () {
  const TJS = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.5.1/+esm';
  const KOKORO = 'https://cdn.jsdelivr.net/npm/kokoro-js@1.2.1/+esm';
  const WHISPER_GPU = 'Xenova/whisper-base.en';
  const WHISPER_CPU = 'Xenova/whisper-tiny.en';
  const SILENCE_MS = 700;
  const KOKORO_MODEL = 'onnx-community/Kokoro-82M-v1.0-ONNX';
  let VOICES = ['af_heart', 'af_bella', 'af_nicole', 'af_sarah', 'bf_emma', 'am_michael'];

  const stt = { state: 'idle', pipe: null, promise: null, failed: false, progress: 0, device: '' };
  const tts = { state: 'idle', engine: null, promise: null, failed: false, progress: 0, device: '' };
  const timing = {};
  // Some GPU/dtype combinations (q4f16 on this PC's RTX 3050) return all-NaN audio: silent speech. Always check.
  const valid = (raw) => { try { const a = raw && raw.audio; if (!a || !a.length) return false; let mx = 0; for (let i = 0; i < a.length; i += 7) { const v = a[i]; if (v !== v) return false; if (v > mx) mx = v; else if (-v > mx) mx = -v; } return mx > 0.01; } catch (e) { return false; } };
  // WebGPU only in Chrome/Edge (userAgentData is Chromium-only). Firefox reports navigator.gpu but the models hang there,
  // so Firefox uses Whisper tiny on wasm and the browser's own voice.
  const hasGpu = async () => { try { return !!(navigator.userAgentData && navigator.gpu && await navigator.gpu.requestAdapter()); } catch (e) { return false; } };
  let ctx = null;
  let player = { gen: 0, src: null };
  let mic = null;
  let listenGen = 0;

  // Playback has its own audio context (steady, larger buffers) and is kept awake with an inaudible signal while a conversation is
  // running: otherwise the sound card or Bluetooth link goes to sleep between sentences and wakes up with a cut-off, quiet start.
  let pctx = null, keepAlive = null, awakeTimer = null;
  const playCtx = () => { if (!pctx) { const A = window.AudioContext || window.webkitAudioContext; try { pctx = new A({ latencyHint: 'playback' }); } catch (e) { pctx = new A(); } } return pctx; };
  function outSleep() { clearTimeout(awakeTimer); awakeTimer = null; try { keepAlive && keepAlive.stop(); } catch (e) {} keepAlive = null; }
  function outAwake() {
    try {
      const c = playCtx(); c.resume();
      if (!keepAlive) { const b = c.createBuffer(1, c.sampleRate, c.sampleRate), d = b.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = 0.00004; const n = c.createBufferSource(); n.buffer = b; n.loop = true; n.connect(c.destination); n.start(); keepAlive = n; }
      clearTimeout(awakeTimer); awakeTimer = setTimeout(outSleep, 25000);
    } catch (e) {}
  }
  let cctx = null;
  const capCtx = () => {
    if (!cctx) { const A = window.AudioContext || window.webkitAudioContext; try { cctx = new A({ sinkId: { type: 'none' } }); } catch (e) { cctx = new A(); } }
    return cctx;
  };
  const audioCtx = () => { if (!ctx) { const A = window.AudioContext || window.webkitAudioContext; ctx = new A(); } return ctx; };
  const prog = (o) => (p) => { if (p && typeof p.progress === 'number') o.progress = Math.round(p.progress); };

  // The first run on WebGPU compiles shaders (15-20 s), so each loader finishes with a dummy run:
  // "ready" then really means ready.
  // ---- native engine (optional, runs in the LifeOS server / phone helper; same on every browser and device) ----
  // Whisper + Piper through sherpa-onnx. Used whenever the server has it installed (setup-voice.bat); it is much faster than
  // anything that runs inside the page, and identical on the PC and the phone.
  let nativeP = null;
  function detectNative() {
    if (nativeP) return nativeP;
    let saved = ''; try { saved = localStorage.getItem('lifeos.voiceEngine') || ''; } catch (e) {}
    nativeP = saved === 'browser' ? Promise.resolve(false)
      : fetch('/api/voice/native').then((r) => r.json()).then((j) => { if (j && j.ok && j.voices && j.voices.length) { VOICES = j.voices.map((v) => v.id); return true; } return false; }).catch(() => false);
    return nativeP;
  }
  const nativeStt = async (samples) => {
    const r = await fetch('/api/voice/stt', { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: samples.buffer.slice(samples.byteOffset, samples.byteOffset + samples.byteLength) });
    if (!r.ok) throw new Error('native stt ' + r.status);
    return await r.json();
  };
  const nativeTts = {
    async generate(text, o) {
      const r = await fetch('/api/voice/tts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text, voice: (o && o.voice) || '' }) });
      if (!r.ok) throw new Error('native tts ' + r.status);
      const ab = await r.arrayBuffer();
      return { audio: new Float32Array(ab), sampling_rate: Number(r.headers.get('X-Sample-Rate')) || 22050 };
    },
  };

  function loadStt() {
    if (stt.promise) return stt.promise;
    stt.state = 'loading';
    stt.promise = (async () => {
      if (await detectNative()) { timing.sttLoad = 0; stt.device = 'native'; return nativeStt; }
      const m = await import(TJS);
      const t0 = performance.now();
      let p = null;
      console.info('[renee] whisper: checking WebGPU');
      if (await hasGpu()) {
        try {
          const gpu = (async () => {
            const q = await m.pipeline('automatic-speech-recognition', WHISPER_GPU, { device: 'webgpu', dtype: { encoder_model: 'fp32', decoder_model_merged: 'q4' }, progress_callback: prog(stt) });
            console.info('[renee] whisper downloaded, warming up WebGPU');
            await q(new Float32Array(16000), { chunk_length_s: 30 });
            return q;
          })();
          gpu.catch(() => {});
          p = await Promise.race([gpu, new Promise((_, rej) => setTimeout(() => rej(new Error('WebGPU setup took over 75 s')), 75000))]);
          stt.device = 'webgpu';
        } catch (e) { console.warn('whisper webgpu failed, using wasm:', e && e.message); p = null; }
      } else console.info('[renee] no WebGPU adapter, whisper will use wasm');
      if (!p) {
        p = await m.pipeline('automatic-speech-recognition', WHISPER_CPU, { dtype: 'q8', device: 'wasm', progress_callback: prog(stt) });
        stt.device = 'wasm';
      }
      timing.sttLoad = Math.round(performance.now() - t0);
      return p;
    })()
      .then((p) => { stt.pipe = p; stt.state = 'ready'; console.info('[renee] whisper ready on', stt.device, timing.sttLoad + 'ms'); return p; })
      .catch((e) => { stt.failed = true; stt.state = 'failed'; stt.promise = null; console.warn('whisper failed', e && e.message); throw e; });
    return stt.promise;
  }
  function loadTts() {
    if (tts.promise) return tts.promise;
    tts.state = 'loading';
    tts.promise = (async () => {
      if (await detectNative()) { tts.device = 'native'; timing.ttsLoad = 0; return nativeTts; }
      const m = await import(KOKORO);
      const t0 = performance.now();
      const gpu = await hasGpu();
      // Pick the best engine this browser can run: WebGPU (Chrome/Edge), else wasm (any browser, several threads when the
      // page is cross-origin isolated). The wasm engine must pass a speed check, otherwise the browser's own voice is used.
      const plans = gpu ? [['webgpu', 'fp32'], ['webgpu', 'q4f16'], ['wasm', 'q8']] : [['wasm', 'q8']];
      let e = null, last = null;
      for (const [device, dtype] of plans) {
        try {
          e = await m.KokoroTTS.from_pretrained(KOKORO_MODEL, { dtype, device, progress_callback: prog(tts) });
          const g0 = performance.now();
          const raw = await e.generate('Ready to go, one two three.', { voice: VOICES[0] });
          if (!valid(raw)) throw new Error('silent (NaN) audio with ' + device + ' ' + dtype);
          const rtf = (performance.now() - g0) / ((raw.audio.length / raw.sampling_rate) * 1000);
          if (device === 'wasm' && rtf > 2.2) throw new Error('too slow on wasm (' + rtf.toFixed(1) + 'x real time), using the browser voice');
          tts.device = device + ' ' + dtype; tts.rtf = rtf; break;
        } catch (err) { console.warn('kokoro', device, dtype, 'failed:', err && err.message); last = err; e = null; }
      }
      if (!e) throw last || new Error('kokoro failed');
      timing.ttsLoad = Math.round(performance.now() - t0);
      return e;
    })()
      .then((e) => { tts.engine = e; tts.state = 'ready'; console.info('[renee] voice ready on', tts.device, timing.ttsLoad + 'ms'); return e; })
      .catch((e) => { tts.failed = true; tts.state = 'failed'; tts.promise = null; console.warn('kokoro failed', e && e.message); throw e; });
    return tts.promise;
  }

  function downsample(buf, from, to) {
    if (from === to) return buf;
    const ratio = from / to, n = Math.floor(buf.length / ratio), out = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const a = Math.floor(i * ratio), b = Math.min(buf.length, Math.floor((i + 1) * ratio));
      let s = 0; for (let j = a; j < b; j++) s += buf[j];
      out[i] = s / Math.max(1, b - a);
    }
    return out;
  }

  // Strip markdown and links so the voice reads clean sentences.
  function clean(text) {
    return String(text || '')
      .replace(/\bR\.?\s?E\.?\s?N\.?\s?E\.?\s?E\b\.?/gi, 'Renay') // her name is pronounced Renay, not spelled out
      .replace(/```[\s\S]*?```/g, ' ')
      .replace(/`([^`]*)`/g, '$1')
      .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/https?:\/\/\S+/g, '')
      .replace(/^\s{0,3}#{1,6}\s*/gm, '')
      .replace(/^\s*[-*•]\s+/gm, '')
      .replace(/[*_~>|]/g, '')
      .replace(/\s+/g, ' ').trim();
  }
  function sentences(text) {
    const parts = clean(text).match(/[^.!?\n]+[.!?]*/g) || [];
    const out = [];
    for (const p of parts) { const t = p.trim(); if (!t) continue; if (out.length && out[out.length - 1].length < 25) out[out.length - 1] += ' ' + t; else out.push(t); }
    return out;
  }

  // ---- speaking ----
  let current = null; // the streaming answer in flight (so Interrupt can cancel it)
  function stopSpeak() { stopAudio(); if (current) { const c = current; current = null; try { c.abort(); } catch (e) {} } }
  function stopAudio() {
    player.gen++;
    try { if (player.src) { player.src.onended = null; player.src.stop(); } } catch (e) {}
    player.src = null;
    try { if (window.speechSynthesis) window.speechSynthesis.cancel(); } catch (e) {}
  }
  function playBuffer(raw, gen) {
    return new Promise((resolve) => {
      if (gen !== player.gen) return resolve();
      outAwake();
      const c = playCtx();
      // Every sentence is brought to the same loudness (the voices differ from sentence to sentence), starts and ends with a short
      // fade so there are no clicks, and has a little silence in front so the first word is not clipped when the output wakes up.
      const a = raw.audio; let sum = 0, pk = 0;
      for (let i = 0; i < a.length; i++) { const v = a[i]; sum += v * v; const w = v < 0 ? -v : v; if (w > pk) pk = w; }
      const rms = Math.sqrt(sum / Math.max(1, a.length)) || 1e-6;
      let gain = Math.min(3, 0.09 / rms); if (pk * gain > 0.92) gain = 0.92 / (pk || 1);
      const pad = Math.round(raw.sampling_rate * 0.06), tailPad = Math.round(raw.sampling_rate * 0.05), fade = Math.round(raw.sampling_rate * 0.008);
      const out = new Float32Array(pad + a.length + tailPad);
      for (let i = 0; i < a.length; i++) { let g = gain; if (i < fade) g *= i / fade; else if (i > a.length - fade) g *= (a.length - i) / fade; out[pad + i] = a[i] * g; }
      const b = c.createBuffer(1, out.length, raw.sampling_rate);
      b.copyToChannel(out, 0);
      const s = c.createBufferSource(); s.buffer = b; s.connect(c.destination);
      s.onended = () => { if (player.src === s) player.src = null; resolve(); };
      player.src = s;
      try { s.start(); } catch (e) { resolve(); }
    });
  }
  // Browser voice, one sentence. Same ranking and saved choice as the pages use.
  function nativeVoice() {
    try {
      const sc = (v) => (/natural|neural/i.test(v.name) ? 6 : 0) + (/online/i.test(v.name) ? 3 : 0) + (/google/i.test(v.name) ? 2 : 0) + (/en[-_]US/i.test(v.lang) ? 1 : 0) + (v.localService ? 0 : 1);
      const r = (window.speechSynthesis.getVoices() || []).filter((v) => /^en/i.test(v.lang)).sort((a, b) => sc(b) - sc(a));
      let saved = ''; try { saved = localStorage.getItem('lifeos.voice') || ''; } catch (e) {}
      return r.find((v) => v.name === saved) || r[0] || null;
    } catch (e) { return null; }
  }
  function nativeSpeak(text, gen) {
    return new Promise((resolve) => {
      if (gen != null && gen !== player.gen) return resolve();
      try {
        const u = new SpeechSynthesisUtterance(text); const v = nativeVoice(); if (v) u.voice = v; u.rate = 1.05;
        let done = false; const fin = () => { if (!done) { done = true; clearTimeout(guard); resolve(); } };
        const guard = setTimeout(fin, 4000 + text.length * 120); // some engines never fire onend
        u.onend = fin; u.onerror = fin;
        window.speechSynthesis.speak(u);
      } catch (e) { resolve(); }
    });
  }
  // Incremental speaker: feed(text) as it streams in, end() when the answer is complete.
  // Sentences are synthesised one after another (the model can only run one job at a time) while the
  // previous one plays, so the voice starts after the first sentence and then keeps going.
  function speaker(onend, mark) {
    stopAudio();
    const gen = player.gen;
    const useK = !!tts.engine && !tts.failed;
    const voice = voiceId();
    let buf = '', synth = Promise.resolve(), play = Promise.resolve(), count = 0, ended = false, fin = false;
    const emit = (raw) => {
      const sent = clean(raw); if (!sent) return;
      count++;
      let au = null;
      if (useK) { au = synth.then(() => (gen === player.gen ? tts.engine.generate(sent, { voice, speed: 1.0 }) : null)); synth = au.catch(() => {}); }
      play = play.then(async () => {
        if (gen !== player.gen) return;
        try {
          if (useK) { const raw2 = await au; if (gen !== player.gen || !raw2) return; if (!valid(raw2)) { tts.failed = true; throw new Error('kokoro returned silence'); } mark && mark(); await playBuffer(raw2, gen); }
          else { mark && mark(); await nativeSpeak(sent, gen); }
        } catch (e) { console.warn('speak failed, using browser voice', e && e.message); if (gen === player.gen) await nativeSpeak(sent, gen); }
      });
    };
    const flush = (all) => {
      for (;;) {
        const m = buf.match(/^([\s\S]*?[.!?:;])(\s+)/);
        if (!m) break;
        // keep very short fragments ("Yes.") together with the next sentence
        if (m[1].length < 18 && !all) { const rest = buf.slice(m[0].length); const m2 = rest.match(/^([\s\S]*?[.!?:;])(\s+)/); if (!m2) break; buf = rest.slice(m2[0].length); emit(m[1] + ' ' + m2[1]); continue; }
        buf = buf.slice(m[0].length); emit(m[1]);
      }
      if (all && buf.trim()) { emit(buf); buf = ''; }
    };
    const finish = () => { if (fin) return; fin = true; play.then(() => { if (gen === player.gen) onend(); }); };
    return {
      feed(t) { if (ended) return; buf += t; flush(false); },
      reset() { buf = ''; },
      end() { ended = true; flush(true); finish(); },
      cancel() { ended = true; },
      get count() { return count; },
    };
  }
  // Returns true when Kokoro is handling it; false means "use the browser voice".
  function speak(text, onend) {
    if (!tts.engine || tts.failed) { loadTts().catch(() => {}); return false; }
    const sp = speaker(onend);
    sp.feed(text + ' '); sp.end();
    return true;
  }
  // The page the user is looking at (title and visible text), so she can answer "what's on my screen?". Sent only to this computer's server.
  function screenText() {
    try { return ((document.title || '') + ': ' + (document.body ? document.body.innerText : '')).replace(/\s+/g, ' ').slice(0, 2500); } catch (e) { return ''; }
  }
  // Ask on the fast voice path and speak the answer while it streams.
  // cb: { text(t), tool(), spoken(), error(msg), fallback(), timing(str) }
  function ask(text, cb) {
    stopSpeak(); // cancels the previous answer, if any
    const ac = new AbortController();
    const t0 = performance.now();
    const tm = { stt: timing.stt || 0 };
    let sp = null, full = '', finished = false;
    const me = { abort() { finished = true; try { ac.abort(); } catch (e) {} if (sp) sp.cancel(); } };
    current = me;
    const show = () => {
      const s = 'heard ' + (tm.stt / 1000).toFixed(1) + 's, first words ' + (tm.first != null ? (tm.first / 1000).toFixed(1) + 's' : '-') + ', first audio ' + (tm.audio != null ? (tm.audio / 1000).toFixed(1) + 's' : '-') + ', answer ' + (tm.total != null ? (tm.total / 1000).toFixed(1) + 's' : '-') + ' (' + (stt.device || '?') + ' / ' + (tts.engine ? (tts.device === 'native' ? 'piper' : 'kokoro') : 'browser voice') + ')';
      Object.assign(timing, tm, { line: s }); console.info('[renee timing]', s); cb.timing && cb.timing(s);
      // the finished turn is also written to the server log (grep "voice timing" ~/lifeos-server.log) so it can be read without a browser console
      if (tm.total != null && !tm.sent) { tm.sent = true; try { fetch('/api/voice/timing', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ line: s, stt: stt.device || '', tts: tts.device || '', endMs: SILENCE_MS }) }).catch(() => {}); } catch (e) {} }
    };
    const fail = async (msg) => {
      if (finished) return; finished = true; if (current === me) current = null;
      cb.error && cb.error(msg);
      try { await nativeSpeak(msg); } catch (e) {} // never fail silently
    };
    (async () => {
      let r;
      try { r = await fetch('/api/voice/ask', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text, screen: screenText() }), signal: ac.signal }); }
      catch (e) { if (!finished) fail("Couldn't reach the server. Is the LifeOS window still open?"); return; }
      if (r.status === 404 || r.status === 405) { finished = true; if (current === me) current = null; cb.fallback && cb.fallback(); return; }
      if (!r.ok) { let m = 'That did not work. Try again.'; try { m = (await r.json()).error || m; } catch (e) {} return fail(m); }
      sp = speaker(() => { if (finished && current === me) current = null; else if (current === me) current = null; cb.spoken && cb.spoken(); }, () => { if (tm.audio == null) { tm.audio = performance.now() - t0; show(); } });
      let gotDone = false;
      const handle = (j) => {
        if (finished) return;
        if (j.d) { if (tm.first == null) tm.first = performance.now() - t0; full += j.d; sp.feed(j.d); cb.text && cb.text(full); }
        else if (j.reset) { full = ''; sp.reset(); }
        else if (j.tool) { cb.tool && cb.tool(j.tool); }
        else if (j.error) { gotDone = true; sp.cancel(); fail(j.error); }
        else if (j.done) {
          gotDone = true; tm.total = performance.now() - t0; tm.server = j.ms; tm.api = j.api;
          const finalText = String(j.text || full || '').trim();
          if (finalText && finalText !== full.trim() && sp.count === 0) { full = finalText; sp.feed(finalText + ' '); }
          cb.text && cb.text(finalText || full);
          cb.done && cb.done(finalText || full, j.proposed || []);
          show(); sp.end();
        }
      };
      try {
        if (!r.body || !r.body.getReader) { for (const l of (await r.text()).split('\n')) if (l.trim()) { try { handle(JSON.parse(l)); } catch (e) {} } }
        else {
          const rd = r.body.getReader(), dec = new TextDecoder(); let b = '';
          for (;;) {
            const { value, done } = await rd.read(); if (done) break;
            b += dec.decode(value, { stream: true });
            let i; while ((i = b.indexOf('\n')) >= 0) { const l = b.slice(0, i).trim(); b = b.slice(i + 1); if (l) { try { handle(JSON.parse(l)); } catch (e) {} } }
          }
        }
        if (!gotDone && !finished) fail('The answer was cut off. Try again.');
      } catch (e) { if (!finished) fail('The answer was cut off. Try again.'); }
    })();
    return me;
  }
  function voiceId() { let v = ''; try { v = localStorage.getItem('lifeos.kvoice') || ''; } catch (e) {} return VOICES.includes(v) ? v : VOICES[0]; }
  function nextVoice() { const i = VOICES.indexOf(voiceId()); const n = VOICES[(i + 1) % VOICES.length]; try { localStorage.setItem('lifeos.kvoice', n); } catch (e) {} return n; }

  // ---- listening ----
  // One microphone stream stays open for the whole conversation. Opening and closing it every turn made Bluetooth headsets and
  // Windows flip between "call mode" (low quality, quiet) and normal audio on every turn. It is released when the conversation ends
  // (stopListen with no argument) or after 20 s with nobody listening.
  let kept = null, keepTimer = null;
  function micRelease() {
    clearTimeout(keepTimer); keepTimer = null;
    const k = kept; kept = null;
    try { k && k.getTracks().forEach((t) => t.stop()); } catch (e) {}
  }
  // A Bluetooth headset's microphone forces the headset into low-quality "hands-free call" sound while it is open. If the chosen microphone is
  // a Bluetooth one and the computer has another (built-in or USB), listen with that one instead, so the headset keeps its high-quality sound.
  const shortMic = (l) => String(l || '').replace(/^(default|communications)\s*-\s*/i, '').replace(/\s*\([0-9a-f]{4}:[0-9a-f]{4}\)/i, '').trim() || 'Default';
  const savedMic = () => { try { return localStorage.getItem('lifeos.micId') || ''; } catch (e) { return ''; } };
  // Android's automatic gain control slowly raises the background after you stop talking, so the quiet that ends your turn never came and you
  // had to tap. It stays on elsewhere (it helps a quiet voice on a laptop); on Android the level is evened out before listening instead.
  const AGC = !/Android/i.test((typeof navigator !== 'undefined' && navigator.userAgent) || '');
  async function openMic() {
    const base = { echoCancellation: false, noiseSuppression: false, autoGainControl: AGC };
    const id = savedMic();
    if (id) { try { return await navigator.mediaDevices.getUserMedia({ audio: { ...base, deviceId: { exact: id } } }); } catch (e) { if (e && e.name === 'NotAllowedError') throw e; /* that microphone is not plugged in: use the default */ } }
    return await navigator.mediaDevices.getUserMedia({ audio: base });
  }
  // Name of the microphone in use (shown in the panel) and a way to switch to the next one.
  function micLabel() {
    const tr = kept && kept.getAudioTracks()[0];
    if (tr && tr.label) return shortMic(tr.label);
    let l = ''; try { l = localStorage.getItem('lifeos.micLabel') || ''; } catch (e) {}
    return l ? shortMic(l) : 'Default';
  }
  async function cycleMic() {
    let tmp = null;
    try {
      if (!kept) { tmp = await navigator.mediaDevices.getUserMedia({ audio: true }); } // permission, so the device names are visible
      const list = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'audioinput' && d.deviceId && d.deviceId !== 'communications');
      if (!list.length) return micLabel();
      let cur = savedMic(); if (!cur) { const tr = kept && kept.getAudioTracks()[0]; const s0 = tr && tr.getSettings && tr.getSettings(); cur = (s0 && s0.deviceId) || ''; }
      const i = list.findIndex((d) => d.deviceId === cur), nx = list[(i + 1) % list.length];
      try { localStorage.setItem('lifeos.micId', nx.deviceId); localStorage.setItem('lifeos.micLabel', nx.label || ''); } catch (e) {}
      micRelease(); // the next turn opens the new microphone
      return shortMic(nx.label);
    } catch (e) { return micLabel(); } finally { try { tmp && tmp.getTracks().forEach((t) => t.stop()); } catch (e) {} }
  }
  // Automatic microphone: nothing to set up. A dedicated or USB microphone beats the built-in one; a Bluetooth headset microphone (it forces
  // the headset into low-quality call sound) and virtual devices (Stereo Mix, OBS, VB-Cable) come last. The system default only wins ties.
  // A microphone you chose yourself (lifeos.micId) is never replaced.
  const BT = /bluetooth|hands-?free|airpods|buds|a2dp/i;
  const VIRTUAL = /stereo mix|virtual|loopback|cable|voicemeeter|vb-audio|nvidia broadcast|\bobs\b|steam streaming|what u hear/i;
  const WEBCAM = /webcam|camera|\bc9\d\d\b|brio/i;
  const EXTERNAL = /usb|blue\b|yeti|rode|shure|audio-technica|at2\d\d\d|hyperx|quadcast|fifine|samson|elgato|focusrite|scarlett|behringer|snowball|seiren|maono|tonor|podcast|condenser/i;
  const BUILTIN = /array|internal|built-?in|realtek|laptop|smart sound|dmic/i;
  const micScore = (label, isDefault) => (VIRTUAL.test(label) ? -20 : 0) + (BT.test(label) ? -6 : 0) + (WEBCAM.test(label) ? 4 : EXTERNAL.test(label) ? 10 : 0) + (BUILTIN.test(label) ? 1 : 0) + (isDefault ? 2 : 0);
  async function autoPickMic(stream) {
    try {
      if (savedMic()) return stream;
      const cur = stream.getAudioTracks()[0]; if (!cur) return stream;
      const all = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'audioinput');
      const defDev = all.find((d) => d.deviceId === 'default'), defGroup = (defDev && defDev.groupId) || (cur.getSettings && cur.getSettings().groupId) || '';
      const real = all.filter((d) => d.deviceId && d.deviceId !== 'default' && d.deviceId !== 'communications' && d.label);
      if (real.length < 2) return stream; // only one microphone: nothing to choose
      const ranked = real.map((d) => ({ d, sc: micScore(d.label, d.groupId === defGroup) })).sort((x, y) => y.sc - x.sc);
      const best = ranked[0].d, curGroup = (cur.getSettings && cur.getSettings().groupId) || defGroup;
      console.info('[renee] microphones:', ranked.map((r) => r.d.label + ' (' + r.sc + ')').join(' | '));
      if (best.groupId === curGroup) return stream;
      const s2 = await navigator.mediaDevices.getUserMedia({ audio: { deviceId: { exact: best.deviceId }, echoCancellation: false, noiseSuppression: false, autoGainControl: AGC } });
      try { stream.getTracks().forEach((t) => t.stop()); } catch (e) {}
      console.info('[renee] microphone chosen automatically:', best.label);
      return s2;
    } catch (e) { return stream; }
  }
  // Plugging in or removing a microphone: the next turn picks again.
  let micStale = false;
  try { navigator.mediaDevices.addEventListener('devicechange', () => { micStale = true; }); } catch (e) {}
  const micLive = () => !!kept && kept.getTracks().some((t) => t.readyState === 'live' && !t.muted);
  function stopListen(keepOpen) {
    listenGen++;
    const m = mic; mic = null;
    if (m) {
      m.cancelled = true;
      try { m.src.disconnect(); } catch (e) {}
      try { m.proc && m.proc.disconnect(); } catch (e) {}
      try { if (m.node) { m.node.port.onmessage = null; m.node.disconnect(); } m.zero && m.zero.disconnect(); } catch (e) {}
    }
    if (keepOpen === true) { clearTimeout(keepTimer); keepTimer = setTimeout(micRelease, 20000); } else micRelease();
  }
  // cb: { status(s), text(t), error(msg) }   s = loading | listening | hearing | thinking
  let wlCtx = null, wlP = null;
  function workletReady(c) {
    if (wlCtx !== c) { wlCtx = c; wlP = null; }
    if (!wlP) {
      const code = "class C extends AudioWorkletProcessor{process(i){const x=i[0]&&i[0][0];if(x)this.port.postMessage(x.slice(0));return true}}registerProcessor('renee-cap',C)";
      wlP = c.audioWorklet.addModule(URL.createObjectURL(new Blob([code], { type: 'text/javascript' }))).catch((e) => { wlP = null; throw e; });
    }
    return wlP;
  }
  // Decides when you started and when you finished talking, from the loudness of each block (rms) and its length (ms). Speech must be clearly
  // above the room noise measured before you started; once you have started, quiet means clearly below YOUR OWN voice level (a share of
  // its recent peak), so a background that got louder meanwhile does not keep the turn open. Returns '' | 'start' | 'end' | 'idle' | 'cap'.
  function makeVad() {
    let heard = false, silentMs = 0, speechMs = 0, idleMs = 0, floor = 0, calMs = 0, t = 0, deaf = 350, peak = 0;
    return {
      get heard() { return heard; },
      step(rms, ms) {
        if (calMs < 300) { floor = floor ? Math.min(floor, rms) : rms; calMs += ms; }
        else if (!heard) { if (rms < floor * 2.5) floor = floor * 0.9 + rms * 0.1; else floor *= 1.002; }
        floor = Math.max(floor, 0.0008);
        t += ms; deaf -= ms; // the first 350 ms are not counted as speech, so the end of her own voice is not mistaken for you
        let thr = Math.max(0.006, floor * 3);
        if (heard) thr = Math.max(thr, peak * 0.3);
        const on = deaf <= 0 && rms > thr;
        let ev = '';
        if (on) { if (!heard) { heard = true; ev = 'start'; } speechMs += ms; silentMs = 0; peak = Math.max(peak * 0.99, rms); }
        else if (heard) { silentMs += ms; peak *= 0.999; } else idleMs += ms;
        const endMs = speechMs < 1200 ? SILENCE_MS : SILENCE_MS + 200; // a longer pause is allowed after a longer sentence
        if (heard && silentMs > endMs && speechMs > 400) return 'end';
        if (!heard && idleMs > 9000) return 'idle';
        if (t > 40000) return 'cap';
        return ev;
      },
    };
  }

  async function listen(cb) {
    stopListen(true);
    const myGen = listenGen;
    outAwake(); // keep the speakers/headset awake for the whole conversation
    if (!stt.pipe && !stt.failed) {
      const iv = setInterval(() => cb.status('loading', stt.progress), 400);
      cb.status('loading', stt.progress);
      // If setup takes more than 90 s, give up waiting and use the browser's own listening (loading carries on in the background).
      let slow = false;
      try { await Promise.race([loadStt(), new Promise((_, rej) => setTimeout(() => { slow = true; rej(new Error('timeout')); }, 90000))]); }
      catch (e) { clearInterval(iv); if (slow) console.warn('[renee] whisper setup slow, using browser listening this time'); if (myGen === listenGen) cb.error('stt-failed'); return false; }
      clearInterval(iv);
    }
    if (myGen !== listenGen) return false;
    if (stt.failed) { cb.error('stt-failed'); return false; }
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { cb.error('no-mic'); return false; }
    let stream;
    clearTimeout(keepTimer);
    if (micStale) { micStale = false; micRelease(); } // a device was plugged in or removed: choose again
    if (micLive()) stream = kept;
    else {
      // Echo cancellation and noise suppression are off on purpose: they switch the browser into "voice call" processing, which lowers
      // and degrades her voice. She never listens while she is speaking, so there is no echo to cancel.
      try { stream = await openMic(); }
      catch (e) { cb.error(e && e.name === 'NotAllowedError' ? 'blocked' : 'no-mic'); return false; }
      if (myGen !== listenGen) { try { stream.getTracks().forEach((t) => t.stop()); } catch (e) {} return false; }
      stream = await autoPickMic(stream);
      if (myGen !== listenGen) { try { stream.getTracks().forEach((t) => t.stop()); } catch (e) {} return false; }
      kept = stream;
      try { const tr0 = stream.getAudioTracks()[0]; console.info('[renee] microphone:', tr0 && tr0.label); if (tr0 && tr0.label) localStorage.setItem('lifeos.micLabel', tr0.label); } catch (e) {}
    }
    const c = capCtx(); try { await c.resume(); } catch (e) {}
    if (myGen !== listenGen) return false;
    const src = c.createMediaStreamSource(stream);
    const m = { stream, src, node: null, zero: null, proc: null, cancelled: false };
    mic = m;
    // The microphone is read on the audio thread (AudioWorklet), so a busy page cannot make it drop pieces of your voice. The old
    // ScriptProcessor, which runs on the page's main thread, is only the fallback.
    const chunks = []; const vad = makeVad();
    const done = async (ok) => {
      if (m.cancelled) return;
      stopListen(true); // keep the microphone stream open for the next turn
      if (!ok || !vad.heard) { cb.text(''); return; }
      cb.status('thinking');
      const tt0 = performance.now();
      try {
        const pipe = stt.pipe || await loadStt();
        const total = chunks.reduce((n, a) => n + a.length, 0), all = new Float32Array(total);
        let o = 0; for (const a of chunks) { all.set(a, o); o += a.length; }
        let pk = 0; for (let i = 0; i < all.length; i++) { const a = Math.abs(all[i]); if (a > pk) pk = a; }
        if (pk > 0.002 && pk < 0.4) { const g = Math.min(30, 0.8 / pk); for (let i = 0; i < all.length; i++) all[i] *= g; }
        const r = await pipe(downsample(all, c.sampleRate, 16000), { chunk_length_s: 30, return_timestamps: false });
        timing.stt = Math.round(performance.now() - tt0);
        // Whisper invents words on room noise ("Thank you.", "you", "Bye."). Treat those as nothing heard.
        const heardText = String((r && r.text) || '').replace(/\[[^\]]*\]|\([^)]*\)/g, '').trim();
        if (!/[a-z0-9]/i.test(heardText) || /^(thank you[.! ]*|thanks[.! ]*|thanks for watching[.! ]*|you[.! ]*|bye[.! ]*|okay[.! ]*|uh[.! ]*|um[.! ]*|hmm+[.! ]*|the[.! ]*)$/i.test(heardText)) { cb.text(''); return; }
        cb.text(String((r && r.text) || '').replace(/\[[^\]]*\]|\([^)]*\)/g, '').trim()); // drop [BLANK_AUDIO] style tags
      } catch (e) { cb.error('stt-failed'); }
    };
    m.finish = () => done(true);
    const onBlock = (d) => {
      if (m.cancelled) return;
      const ms = d.length / c.sampleRate * 1000;
      let s = 0; for (let i = 0; i < d.length; i++) s += d[i] * d[i];
      const rms = Math.sqrt(s / d.length);
      const ev = vad.step(rms, ms);
      chunks.push(new Float32Array(d)); // pre-roll: the half second before you start is kept so the first word is not clipped
      if (!vad.heard) { const keep = Math.ceil(700 / ms); while (chunks.length > keep) chunks.shift(); }
      if (ev === 'start') cb.status('hearing');
      else if (ev === 'end') done(true);
      else if (ev === 'idle') done(false);
      else if (ev === 'cap') done(vad.heard);
    };
    let wired = false;
    try {
      await workletReady(c);
      if (myGen !== listenGen) return false;
      const node = new AudioWorkletNode(c, 'renee-cap', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] });
      let acc = new Float32Array(2048), n = 0;
      node.port.onmessage = (ev) => { const f = ev.data; for (let i = 0; i < f.length; i++) { acc[n++] = f[i]; if (n === 2048) { const blk = acc; acc = new Float32Array(2048); n = 0; onBlock(blk); } } };
      const zero = c.createGain(); zero.gain.value = 0;
      src.connect(node); node.connect(zero); zero.connect(c.destination);
      m.node = node; m.zero = zero; wired = true;
    } catch (e) { console.warn('[renee] AudioWorklet not available, using the older microphone reader:', e && e.message); }
    if (!wired) {
      const proc = c.createScriptProcessor(4096, 1, 1);
      proc.onaudioprocess = (ev) => onBlock(new Float32Array(ev.inputBuffer.getChannelData(0)));
      src.connect(proc); proc.connect(c.destination);
      m.proc = proc;
    }
    cb.status('listening');
    return true;
  }

  window.reneeVoice = {
    stt, tts, timing, ask, nativeSpeak, get voices() { return VOICES; }, voiceId, nextVoice,
    preload() { loadStt().catch(() => {}); loadTts().catch(() => {}); try { fetch('/api/voice/warm', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }).catch(() => {}); } catch (e) {} },
    makeVad, loadStt, loadTts, listen, stopListen, micLabel, cycleMic, finishListen() { if (mic && mic.finish) mic.finish(); }, speak, stopSpeak, clean, sentences, downsample,
  };
})();
