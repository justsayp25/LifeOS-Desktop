// LifeOS phone helper. Runs on the phone (Termux > Ubuntu) next to the vault and lets the app talk to Claude Code there.
// Listens on 127.0.0.1 only and needs the token on every request. It reuses the same chat and upload code as the dashboard.
import http from 'node:http';
import crypto from 'node:crypto';
import { chatStatus, chatAsk } from '../lib/chat.mjs';
import { agentUpload } from '../lib/agent.mjs';
import { voiceAsk, voiceWarm } from '../lib/voice.mjs';
import { nativeStatus, nativeWarm, nativeStt, nativeTts } from '../lib/voicenative.mjs';
import { env, HttpError } from '../lib/vault.mjs';

const PORT = Number(env.HELPER_PORT || 4200);
const TOKEN = String(env.HELPER_TOKEN || '');
if (TOKEN.length < 16) { console.error('Set HELPER_TOKEN (at least 16 characters) first. See helper/SETUP.md.'); process.exit(1); }

const same = (a, b) => { const x = Buffer.from(String(a || '')), y = Buffer.from(TOKEN); return x.length === y.length && crypto.timingSafeEqual(x, y); };
const json = (res, code, body) => { const s = JSON.stringify(body); res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(s); };
const readRaw = (req, limit) => new Promise((resolve, reject) => {
  let n = 0; const parts = [];
  req.on('data', (c) => { n += c.length; if (n > limit) { reject(new HttpError(413, 'Too large.')); req.destroy(); } else parts.push(c); });
  req.on('end', () => resolve(Buffer.concat(parts)));
  req.on('error', reject);
});
const readBody = (req, limit) => new Promise((resolve, reject) => {
  let n = 0; const parts = [];
  req.on('data', (c) => { n += c.length; if (n > limit) { reject(new HttpError(413, 'Too large.')); req.destroy(); } else parts.push(c); });
  req.on('end', () => { try { resolve(parts.length ? JSON.parse(Buffer.concat(parts).toString('utf8')) : {}); } catch (e) { reject(new HttpError(400, 'Bad JSON.')); } });
  req.on('error', reject);
});

http.createServer(async (req, res) => {
  try {
    const host = String(req.headers.host || '').replace(/:\d+$/, '');
    if (host !== '127.0.0.1' && host !== 'localhost') return json(res, 403, { error: 'Local only.' });
    if (!same(req.headers['x-helper-token'], TOKEN)) return json(res, 401, { error: 'Wrong or missing token.' });
    const p = (req.url || '').split('?')[0];
    if (p === '/status' && req.method === 'GET') return json(res, 200, await chatStatus());
    if (p === '/ask' && req.method === 'POST') return json(res, 200, await chatAsk(await readBody(req, 1_000_000)));
    if (p === '/upload' && req.method === 'POST') return json(res, 200, agentUpload(await readBody(req, 30_000_000)));
    // Voice: same engine and same answers as the dashboard on the PC (see lib/voicenative.mjs and lib/voice.mjs).
    if (p === '/voice/native' && req.method === 'GET') { const st = nativeStatus(); if (st.ok) nativeWarm(); return json(res, 200, st); }
    if (p === '/voice/stt' && req.method === 'POST') return json(res, 200, await nativeStt(await readRaw(req, 4_000_000)));
    if (p === '/voice/tts' && req.method === 'POST') { const r = await nativeTts(await readBody(req, 20_000)); res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'X-Sample-Rate': String(r.sampleRate), 'Cache-Control': 'no-store' }); return res.end(r.buf); }
    if (p === '/voice/warm' && req.method === 'POST') return json(res, 200, await voiceWarm());
    if (p === '/voice/ask' && req.method === 'POST') return voiceAsk(await readBody(req, 20_000), req, res);
    return json(res, 404, { error: 'No such endpoint.' });
  } catch (e) {
    json(res, e instanceof HttpError ? e.status : 500, { error: e instanceof HttpError ? e.message : 'Something went wrong.' });
  }
}).listen(PORT, '127.0.0.1', () => console.log(`LifeOS helper on http://127.0.0.1:${PORT}`));
