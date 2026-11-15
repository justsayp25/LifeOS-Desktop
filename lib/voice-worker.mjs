// Runs the native voice models (sherpa-onnx) off the main thread, so a 1 s synthesis never stalls the server.
import { parentPort, workerData } from 'node:worker_threads';
import { createRequire } from 'node:module';
import path from 'node:path';

const { root } = workerData;
const sherpa = createRequire(path.join(root, 'voice-native', 'package.json'))('sherpa-onnx-node');
const MODELS = path.join(root, 'voice-models');
const THREADS = Math.max(2, Math.min(6, Math.floor((workerData.cores || 8) / 2)));
let rec = null;
const voices = new Map();

function recognizer() {
  if (rec) return rec;
  const d = path.join(MODELS, 'sherpa-onnx-whisper-base.en');
  rec = new sherpa.OfflineRecognizer({
    featConfig: { sampleRate: 16000, featureDim: 80 },
    modelConfig: { whisper: { encoder: path.join(d, 'base.en-encoder.int8.onnx'), decoder: path.join(d, 'base.en-decoder.int8.onnx'), language: 'en', task: 'transcribe', tailPaddings: -1 }, tokens: path.join(d, 'base.en-tokens.txt'), numThreads: THREADS, provider: 'cpu', debug: false },
  });
  return rec;
}
function voice(v) {
  let t = voices.get(v.id);
  if (t) return t;
  const d = path.join(MODELS, v.dir);
  t = new sherpa.OfflineTts({ model: { vits: { model: path.join(d, v.file), tokens: path.join(d, 'tokens.txt'), dataDir: path.join(d, 'espeak-ng-data') }, debug: false, numThreads: THREADS, provider: 'cpu' }, maxNumSentences: 1 });
  voices.set(v.id, t);
  return t;
}

parentPort.on('message', (m) => {
  try {
    if (m.op === 'init') {
      recognizer(); if (m.voice) { const t = voice(m.voice); t.generate({ text: 'Ready.', sid: 0, speed: 1.0 }); }
      // one dummy transcription so the first real one is not slower
      const s = rec.createStream(); s.acceptWaveform({ sampleRate: 16000, samples: new Float32Array(8000) }); rec.decode(s);
      return parentPort.postMessage({ id: m.id, ok: true });
    }
    if (m.op === 'stt') {
      const r = recognizer(), s = r.createStream();
      s.acceptWaveform({ sampleRate: 16000, samples: m.samples });
      r.decode(s);
      return parentPort.postMessage({ id: m.id, ok: true, text: String(r.getResult(s).text || '').trim() });
    }
    if (m.op === 'tts') {
      const a = voice(m.voice).generate({ text: m.text, sid: 0, speed: m.speed || 1.0 });
      const samples = a.samples, out = new Float32Array(samples.length); out.set(samples);
      return parentPort.postMessage({ id: m.id, ok: true, samples: out, sampleRate: a.sampleRate }, [out.buffer]);
    }
    parentPort.postMessage({ id: m.id, ok: false, error: 'unknown op' });
  } catch (e) { parentPort.postMessage({ id: m.id, ok: false, error: String((e && e.message) || e) }); }
});
