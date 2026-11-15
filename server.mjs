// LifeOS web app server. Serves the dashboard and a small API over the vault. No dependencies.
import { chatStatus, chatAsk } from './lib/chat.mjs';
import { agentUpload } from './lib/agent.mjs';
import { voiceAsk, voiceWarm, voiceReset } from './lib/voice.mjs';
import { gitStatus, gitSyncRun } from './lib/gitsync.mjs';
import { nativeStatus, nativeWarm, nativeStt, nativeTts } from './lib/voicenative.mjs';
import { phoneHealthList, phoneHealthSave } from './lib/phonehealth.mjs';
import * as sync from './lib/sync.mjs';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, VAULT, PORT, HOST, HttpError, exists, env } from './lib/vault.mjs';
import { getHabits, setHabit } from './lib/habits.mjs';
import { listReviews, createReview, binReview } from './lib/reviews.mjs';
import { listTasks, createTask, setTaskDone } from './lib/tasks.mjs';
import { getDaily, setDaily, listEvents, createEvent, deleteEvent } from './lib/daily.mjs';
import { listProjects, createProject, patchProject, binProject } from './lib/projects.mjs';
import { listEntries, addEntry, removeEntry } from './lib/finance.mjs';
import { listHealth, addHealth, removeHealth } from './lib/healthlogs.mjs';
import { listAreas, search, resolve } from './lib/areas.mjs';
import { listLibrary, createNote, updateNote, binNote, attachFile, detachFile, readAttachment } from './lib/library.mjs';

const PUBLIC = path.join(ROOT, 'public');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2' };

// COOP/COEP make the page cross-origin isolated, which lets the voice models use several CPU threads (Firefox, and Chrome without WebGPU).
const ISO = { 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'credentialless' };
const send = (res, status, body, headers = {}) => { res.writeHead(status, { 'Cache-Control': 'no-store', ...ISO, ...headers }); res.end(body); };
const json = (res, status, obj) => send(res, status, JSON.stringify(obj), { 'Content-Type': 'application/json; charset=utf-8' });
async function readBody(req, limit = 1_000_000) {
  let size = 0; const chunks = [];
  for await (const c of req) { size += c.length; if (size > limit) throw new HttpError(413, 'Too large.'); chunks.push(c); }
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch (e) { throw new HttpError(400, 'Bad JSON.'); }
}

async function readRaw(req, limit = 110 * 1024 * 1024) {
  let size = 0; const chunks = [];
  for await (const c of req) { size += c.length; if (size > limit) throw new HttpError(413, 'Too large.'); chunks.push(c); }
  return Buffer.concat(chunks);
}
// Everything the phone is allowed to reach. Pairing, device list and the pairing code are for the PC itself only.
async function syncApi(req, res, url) {
  const p = url.pathname, q = url.searchParams, m = req.method;
  const local = sync.isLoopback(req.socket.remoteAddress);
  if (p === '/api/sync/code' && m === 'GET') { if (!local) throw new HttpError(403, 'Only on the PC.'); return json(res, 200, sync.newPairingCode()); }
  if (p === '/api/sync/devices' && m === 'GET') { if (!local) throw new HttpError(403, 'Only on the PC.'); return json(res, 200, sync.listDevices()); }
  let r = p.match(/^\/api\/sync\/devices\/(\w+)$/);
  if (r && m === 'DELETE') { if (!local) throw new HttpError(403, 'Only on the PC.'); return json(res, 200, sync.revokeDevice(r[1])); }
  if (p === '/api/sync/pair' && m === 'POST') return json(res, 200, sync.pairDevice(await readBody(req, 10_000)));
  const dev = sync.authDevice(req);
  if (p === '/api/sync/info' && m === 'GET') return json(res, 200, sync.info());
  if (p === '/api/sync/manifest' && m === 'GET') return json(res, 200, sync.manifest());
  if (p === '/api/sync/plan' && m === 'POST') return json(res, 200, sync.plan(await readBody(req, 20_000_000), dev));
  if (p === '/api/sync/file' && m === 'GET') { const f = sync.readFile(q.get('path')); return send(res, 200, f.buf, { 'Content-Type': 'application/octet-stream', 'X-Hash': f.hash }); }
  if (p === '/api/sync/file' && m === 'PUT') return json(res, 200, sync.writeFile(q.get('path'), q.get('expect') || 'none', await readRaw(req), q.get('hash')));
  if (p === '/api/sync/resolve' && m === 'POST') return json(res, 200, sync.resolve(q.get('path'), q.get('base'), await readRaw(req)));
  if (p === '/api/sync/bin' && m === 'POST') { const b = await readBody(req, 100_000); return json(res, 200, sync.binOnPc(b.path, b.expect)); }
  if (p === '/api/sync/done' && m === 'POST') return json(res, 200, sync.finish(dev));
  throw new HttpError(404, 'No such endpoint.');
}

async function api(req, res, url) {
  const p = url.pathname, q = url.searchParams, m = req.method;
  if (p === '/api/chat/status' && m === 'GET') return json(res, 200, await chatStatus());
  if (p === '/api/agent/upload' && m === 'POST') return json(res, 200, agentUpload(await readBody(req, 30_000_000)));
  if (p === '/api/gitsync/status' && m === 'GET') return json(res, 200, await gitStatus());
  if (p === '/api/gitsync/run' && m === 'POST') return json(res, 200, await gitSyncRun());
  if (p === '/api/voice/native' && m === 'GET') { const st = nativeStatus(); if (st.ok) nativeWarm(); return json(res, 200, st); }
  if (p === '/api/voice/stt' && m === 'POST') return json(res, 200, await nativeStt(await readRaw(req, 4_000_000)));
  if (p === '/api/voice/tts' && m === 'POST') { const r = await nativeTts(await readBody(req, 20_000)); return send(res, 200, r.buf, { 'Content-Type': 'application/octet-stream', 'X-Sample-Rate': String(r.sampleRate) }); }
  if (p === '/api/voice/warm' && m === 'POST') return json(res, 200, await voiceWarm());
  if (p === '/api/voice/reset' && m === 'POST') return json(res, 200, voiceReset());
  if (p === '/api/voice/ask' && m === 'POST') return voiceAsk(await readBody(req, 20_000), req, res);
  if (p === '/api/chat' && m === 'POST') return json(res, 200, await chatAsk(await readBody(req)));
  if (p === '/api/health') return json(res, 200, { ok: exists(path.join(VAULT, '1 Human')), vault: VAULT });
  if (p === '/api/habits' && m === 'GET') return json(res, 200, getHabits(q.get('from'), q.get('to')));
  if (p === '/api/habits' && m === 'POST') return json(res, 200, setHabit(await readBody(req)));
  if (p === '/api/reviews' && m === 'GET') return json(res, 200, listReviews());
  if (p === '/api/reviews' && m === 'POST') return json(res, 200, createReview(await readBody(req)));
  const del = p.match(/^\/api\/reviews\/([\w-]+)$/);
  if (del && m === 'DELETE') return json(res, 200, binReview(del[1]));
  // tasks
  if (p === '/api/tasks' && m === 'GET') return json(res, 200, listTasks());
  if (p === '/api/tasks' && m === 'POST') return json(res, 200, createTask(await readBody(req)));
  let r = p.match(/^\/api\/tasks\/([^/]+)$/);
  if (r && m === 'PATCH') { const b = await readBody(req); return json(res, 200, setTaskDone(decodeURIComponent(r[1]), !!b.done)); }
  // daily text + appointments
  if (p === '/api/daily' && m === 'GET') return json(res, 200, getDaily(q.get('date')));
  if (p === '/api/daily' && m === 'POST') return json(res, 200, setDaily(await readBody(req)));
  if (p === '/api/events' && m === 'GET') return json(res, 200, listEvents(q.get('from'), q.get('to')));
  if (p === '/api/events' && m === 'POST') return json(res, 200, createEvent(await readBody(req)));
  r = p.match(/^\/api\/events\/([^/]+)$/);
  if (r && m === 'DELETE') return json(res, 200, deleteEvent(decodeURIComponent(r[1])));
  // projects
  if (p === '/api/projects' && m === 'GET') return json(res, 200, listProjects());
  if (p === '/api/projects' && m === 'POST') return json(res, 200, createProject(await readBody(req)));
  r = p.match(/^\/api\/projects\/([^/]+)$/);
  if (r && m === 'PATCH') return json(res, 200, patchProject(decodeURIComponent(r[1]), await readBody(req)));
  if (r && m === 'DELETE') return json(res, 200, binProject(decodeURIComponent(r[1])));
  // finances
  if (p === '/api/finance' && m === 'GET') return json(res, 200, listEntries());
  if (p === '/api/finance' && m === 'POST') return json(res, 200, addEntry(await readBody(req)));
  r = p.match(/^\/api\/finance\/([^/]+)$/);
  if (r && m === 'DELETE') return json(res, 200, removeEntry(decodeURIComponent(r[1])));
  // health logs
  if (p === '/api/health/phone' && m === 'GET') return json(res, 200, phoneHealthList(q.get('days')));
  if (p === '/api/health/phone' && m === 'POST') return json(res, 200, phoneHealthSave(await readBody(req, 10_000)));
  if (p === '/api/healthlog' && m === 'GET') return json(res, 200, listHealth());
  r = p.match(/^\/api\/healthlog\/(lifts|runs|pt|rec)(?:\/([^/]+))?$/);
  if (r && m === 'POST' && !r[2]) return json(res, 200, addHealth(r[1], await readBody(req)));
  if (r && m === 'DELETE' && r[2]) return json(res, 200, removeHealth(r[1], decodeURIComponent(r[2])));
  // library notes
  if (p === '/api/areas' && m === 'GET') return json(res, 200, listAreas());
  if (p === '/api/resolve' && m === 'GET') return json(res, 200, resolve(q.get('name')));
  if (p === '/api/search' && m === 'GET') return json(res, 200, search(q.get('q')));
  if (p === '/api/lib' && m === 'GET') return json(res, 200, listLibrary(q.get('domain')));
  if (p === '/api/lib' && m === 'POST') return json(res, 200, createNote(await readBody(req)));
  r = p.match(/^\/api\/lib\/([^/]+)$/);
  if (r && m === 'PATCH') return json(res, 200, updateNote(decodeURIComponent(r[1]), await readBody(req)));
  if (r && m === 'DELETE') return json(res, 200, binNote(decodeURIComponent(r[1])));
  r = p.match(/^\/api\/lib\/([^/]+)\/files$/);
  if (r && m === 'POST') return json(res, 200, attachFile(decodeURIComponent(r[1]), await readBody(req, 30_000_000)));
  if (r && m === 'DELETE') return json(res, 200, detachFile(decodeURIComponent(r[1]), q.get('name')));
  if (p === '/api/file' && m === 'GET') { const abs = readAttachment(q.get('p')); return send(res, 200, fs.readFileSync(abs), { 'Content-Type': TYPES[path.extname(abs).toLowerCase()] || (abs.toLowerCase().endsWith('.pdf') ? 'application/pdf' : /\.jpe?g$/i.test(abs) ? 'image/jpeg' : /\.gif$/i.test(abs) ? 'image/gif' : /\.webp$/i.test(abs) ? 'image/webp' : 'application/octet-stream') }); }
  throw new HttpError(404, 'No such endpoint.');
}

function serveStatic(req, res, url) {
  let p = decodeURIComponent(url.pathname);
  if (p.endsWith('/')) p += 'index.html';
  const abs = path.join(PUBLIC, path.normalize(p));
  if (!abs.startsWith(PUBLIC + path.sep) || !exists(abs) || fs.statSync(abs).isDirectory()) return send(res, 404, 'Not found', { 'Content-Type': 'text/plain' });
  send(res, 200, fs.readFileSync(abs), { 'Content-Type': TYPES[path.extname(abs)] || 'application/octet-stream' });
}

// Optional idle stop (phone): IDLE_EXIT_MIN in .env. The server exits after that many minutes with no request at all.
// The Android app sends /api/health every 30 s while it is open, so it counts as activity; 0 or unset = never stop.
const IDLE_MIN = Number(env.IDLE_EXIT_MIN || 0);
let lastHit = Date.now(), inFlight = 0;
if (IDLE_MIN > 0) setInterval(() => {
  if (inFlight === 0 && Date.now() - lastHit > IDLE_MIN * 60000) { console.log('Idle for ' + IDLE_MIN + ' min, stopping. Start it again any time.'); process.exit(0); }
}, 30000).unref();

const server = http.createServer(async (req, res) => {
  lastHit = Date.now(); inFlight++;
  res.on('close', () => { inFlight--; lastHit = Date.now(); });
  try {
    const url = new URL(req.url, 'http://x');
    // Other devices on the network may only talk to the sync. Everything else (the dashboard and its API) stays on this PC.
    if (!sync.isLoopback(req.socket.remoteAddress) && !url.pathname.startsWith('/api/sync/')) return json(res, 403, { error: 'Only the LifeOS sync can be reached from other devices.' });
    // a web page on the internet must not be able to talk to this PC through the browser (DNS rebinding)
    if (sync.isLoopback(req.socket.remoteAddress) && !/^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i.test(req.headers.host || '')) return json(res, 403, { error: 'Open LifeOS at http://localhost:' + PORT });
    if (url.pathname.startsWith('/api/sync/')) return await syncApi(req, res, url);
    if (url.pathname.startsWith('/api/')) {
      const t0 = Date.now();
      res.on('finish', () => { const ms = Date.now() - t0; if (ms > 400) console.log('slow: ' + req.method + ' ' + url.pathname + ' ' + ms + ' ms'); });
      return await api(req, res, url);
    }
    if (url.pathname === '/rich.mjs') return send(res, 200, fs.readFileSync(path.join(ROOT, 'lib', 'rich.mjs')), { 'Content-Type': 'text/javascript; charset=utf-8' });
    return serveStatic(req, res, url);
  } catch (e) {
    if (e instanceof HttpError) return json(res, e.status, { error: e.message, ...(e.extra || {}) });
    console.error(e);
    return json(res, 500, { error: 'Something went wrong on the server.' });
  }
});
server.on('error', (e) => { console.error(e.code === 'EADDRINUSE' ? 'Port ' + PORT + ' is already in use. LifeOS is probably already running: close the other window, then start again.' : e); process.exit(1); });
server.listen(PORT, HOST, () => {
  console.log(`LifeOS is running at http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`);
  console.log(`Vault: ${VAULT}`);
  if (HOST !== '127.0.0.1' && HOST !== 'localhost') console.log('Phone sync is on: other devices on this network can reach the sync only (not the dashboard). Pair a phone at http://localhost:' + PORT + '/sync.html');
  if (!exists(path.join(VAULT, '1 Human'))) console.log('WARNING: no "1 Human" folder found there. Check VAULT_PATH in .env.');
});
