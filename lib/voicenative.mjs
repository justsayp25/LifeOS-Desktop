// Optional native voice engine: Whisper (speech to text) and Piper (text to speech) through sherpa-onnx, in a worker thread.
// It is the same code on the PC and inside Termux on the phone. Install it with: node tools/setup-voice.mjs
// If it is not installed, status() says so and the page keeps using the engines that run in the browser.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Worker } from 'node:worker_threads';
import { ROOT, HttpError } from './vault.mjs';

export const VOICES = [
  { id: 'us_lessac', dir: 'vits-piper-en_US-lessac-high', file: 'en_US-lessac-high.onnx' },
  { id: 'us_amy', dir: 'vits-piper-en_US-amy-medium', file: 'en_US-amy-medium.onnx' },
  { id: 'us_ryan', dir: 'vits-piper-en_US-ryan-high', file: 'en_US-ryan-high.onnx' },
  { id: 'gb_alba', dir: 'vits-piper-en_GB-alba-medium', file: 'en_GB-alba-medium.onnx' },
];
const MODELS = path.join(ROOT, 'voice-models');
const has = (p) => { try { return fs.existsSync(p); } catch (_) { return false; } };

export function nativeStatus() {
  if (!has(path.join(ROOT, 'voice-native', 'node_modules', 'sherpa-onnx-node'))) return { ok: false, reason: 'not installed (run setup-voice.bat)' };
  if (!has(path.join(MODELS, 'sherpa-onnx-whisper-base.en', 'base.en-encoder.int8.onnx'))) return { ok: false, reason: 'speech models not downloaded (run setup-voice.bat)' };
  const voices = VOICES.filter((v) => has(path.join(MODELS, v.dir, v.file)));
  if (!voices.length) return { ok: false, reason: 'no voice downloaded (run setup-voice.bat)' };
  return { ok: true, stt: 'whisper base.en', tts: 'piper', voices: voices.map((v) => ({ id: v.id })) };
}

let w = null, seq = 0, broken = false;
const waiting = new Map();
function worker() {
  if (w) return w;
  w = new Worker(new URL('./voice-worker.mjs', import.meta.url), { workerData: { root: ROOT, cores: os.cpus().length } });
  w.on('message', (m) => { const p = waiting.get(m.id); if (p) { waiting.delete(m.id); clearTimeout(p.t); m.ok ? p.res(m) : p.rej(new Error(m.error || 'voice engine error')); } });
  const die = (why) => { const old = w; w = null; for (const [id, p] of waiting) { clearTimeout(p.t); p.rej(new Error(why)); waiting.delete(id); } try { old.terminate(); } catch (_) {} };
  w.on('error', (e) => { broken = true; die('voice engine failed: ' + ((e && e.message) || e)); });
  w.on('exit', () => die('voice engine stopped'));
  return w;
}
function call(msg, transfer, ms = 30000) {
  return new Promise((res, rej) => {
    const id = ++seq;
    const t = setTimeout(() => { waiting.delete(id); rej(new Error('voice engine timed out')); }, ms);
    waiting.set(id, { res, rej, t });
    try { worker().postMessage({ id, ...msg }, transfer || []); } catch (e) { clearTimeout(t); waiting.delete(id); rej(e); }
  });
}
const pick = (id) => { const v = VOICES.find((x) => x.id === id && has(path.join(MODELS, x.dir, x.file))) || VOICES.find((x) => has(path.join(MODELS, x.dir, x.file))); if (!v) throw new HttpError(503, 'No voice installed.'); return v; };

let warming = null;
export function nativeWarm() {
  const st = nativeStatus(); if (!st.ok || broken) return Promise.resolve(false);
  if (!warming) warming = call({ op: 'init', voice: pick(st.voices[0].id) }, null, 120000).then(() => true).catch((e) => { console.warn('native voice warm-up failed:', e.message); warming = null; return false; });
  return warming;
}
export async function nativeStt(buf) {
  const st = nativeStatus(); if (!st.ok) throw new HttpError(503, 'Native voice is ' + st.reason + '.');
  if (buf.length < 1600 * 4) return { text: '' }; // under 0.1 s
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length - (buf.length % 4));
  const samples = new Float32Array(ab);
  const r = await call({ op: 'stt', samples }, [samples.buffer]);
  return { text: r.text };
}
export async function nativeTts(body) {
  const st = nativeStatus(); if (!st.ok) throw new HttpError(503, 'Native voice is ' + st.reason + '.');
  const text = String((body && body.text) || '').trim().slice(0, 1200);
  if (!text) throw new HttpError(400, 'No text.');
  const r = await call({ op: 'tts', text, voice: pick(body && body.voice), speed: 1.0 });
  return { buf: Buffer.from(r.samples.buffer, r.samples.byteOffset, r.samples.byteLength), sampleRate: r.sampleRate };
}
