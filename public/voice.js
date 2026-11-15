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
      const c = audioCtx();
      const b = c.createBuffer(1, raw.audio.length, raw.sampling_rate);
      b.copyToChannel(raw.audio, 0);
      const s = c.createBufferSource(); s.buffer = b; s.connect(c.destination);
      s.onended = () => { if (player.src === s) player.src = null; resolve(); };
      player.src = s;
      try { c.resume(); s.start(); } catch (e) { resolve(); }
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
    };
    const fail = async (msg) => {
      if (finished) return; finished = true; if (current === me) current = null;
      cb.error && cb.error(msg);
      try { await nativeSpeak(msg); } catch (e) {} // never fail silently
    };
    (async () => {
      let r;
      try { r = await fetch('/api/voice/ask', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }), signal: ac.signal }); }
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
          cb.done && cb.done(finalText || full);
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
  function stopListen() {
    listenGen++;
    const m = mic; mic = null;
    if (!m) return;
    m.cancelled = true;
    try { m.proc.disconnect(); m.src.disconnect(); } catch (e) {}
    try { m.stream.getTracks().forEach((t) => t.stop()); } catch (e) {}
  }
  // cb: { status(s), text(t), error(msg) }   s = loading | listening | hearing | thinking
  async function listen(cb) {
    stopListen();
    const myGen = listenGen;
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
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } }); }
    catch (e) { cb.error(e && e.name === 'NotAllowedError' ? 'blocked' : 'no-mic'); return false; }
    if (myGen !== listenGen) { try { stream.getTracks().forEach((t) => t.stop()); } catch (e) {} return false; }
    const c = audioCtx(); try { await c.resume(); } catch (e) {}
    const src = c.createMediaStreamSource(stream);
    const proc = c.createScriptProcessor(4096, 1, 1);
    const m = { stream, src, proc, cancelled: false };
    mic = m;
    const chunks = []; let heard = false, silentMs = 0, speechMs = 0, idleMs = 0, floor = 0.004, t = 0;
    const done = async (ok) => {
      if (m.cancelled) return;
      stopListen();
      if (!ok || !heard) { cb.text(''); return; }
      cb.status('thinking');
      const tt0 = performance.now();
      try {
        const pipe = stt.pipe || await loadStt();
        const total = chunks.reduce((n, a) => n + a.length, 0), all = new Float32Array(total);
        let o = 0; for (const a of chunks) { all.set(a, o); o += a.length; }
        const r = await pipe(downsample(all, c.sampleRate, 16000), { chunk_length_s: 30, return_timestamps: false });
        timing.stt = Math.round(performance.now() - tt0);
        cb.text(String((r && r.text) || '').replace(/\[[^\]]*\]|\([^)]*\)/g, '').trim()); // drop [BLANK_AUDIO] style tags
      } catch (e) { cb.error('stt-failed'); }
    };
    m.finish = () => done(true);
    proc.onaudioprocess = (ev) => {
      if (m.cancelled) return;
      const d = ev.inputBuffer.getChannelData(0), ms = d.length / c.sampleRate * 1000;
      let s = 0; for (let i = 0; i < d.length; i++) s += d[i] * d[i];
      const rms = Math.sqrt(s / d.length);
      if (!heard) floor = floor * 0.95 + rms * 0.05;
      const on = rms > Math.max(0.012, floor * 3.5);
      chunks.push(new Float32Array(d)); // keep the lead-in so the first word isn't clipped
      if (!heard && chunks.length > 6) chunks.shift();
      t += ms;
      if (on) { if (!heard) { heard = true; cb.status('hearing'); } speechMs += ms; silentMs = 0; }
      else if (heard) silentMs += ms; else idleMs += ms;
      if (heard && silentMs > SILENCE_MS && speechMs > 250) done(true);
      else if (!heard && idleMs > 9000) done(false);
      else if (t > 40000) done(heard);
    };
    src.connect(proc); proc.connect(c.destination);
    cb.status('listening');
    return true;
  }

  window.reneeVoice = {
    stt, tts, timing, ask, nativeSpeak, get voices() { return VOICES; }, voiceId, nextVoice,
    preload() { loadStt().catch(() => {}); loadTts().catch(() => {}); try { fetch('/api/voice/warm', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }).catch(() => {}); } catch (e) {} },
    loadStt, loadTts, listen, stopListen, finishListen() { if (mic && mic.finish) mic.finish(); }, speak, stopSpeak, clean, sentences, downsample,
  };
})();
