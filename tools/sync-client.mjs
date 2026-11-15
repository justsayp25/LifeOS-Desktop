// Reference sync client (Node). It follows the exact steps the phone app will follow, so the PC side can be tested end to end.
// Usage: node tools/sync-client.mjs pair <http://pc:4100> <code> <folder> [name]
//        node tools/sync-client.mjs sync <folder> [--dry]
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { SCOPE, BIN_DIR, cleanPath } from '../lib/syncCore.mjs';

const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const STATE = '.lifeos-sync';

function walk(dir, rel, out) {
  let ents; try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return; }
  for (const e of ents) {
    if (e.name.startsWith('.') || e.name === 'Thumbs.db' || e.name === 'desktop.ini') continue;
    const r = rel ? rel + '/' + e.name : e.name;
    if (e.isDirectory()) walk(path.join(dir, e.name), r, out);
    else if (e.isFile() && cleanPath(r.normalize('NFC'))) out.push(r);
  }
}
export function localManifest(dir) {
  const list = [];
  for (const s of SCOPE) { if (s.endsWith('/')) walk(path.join(dir, ...s.slice(0, -1).split('/')), s.slice(0, -1), list); else if (fs.existsSync(path.join(dir, s))) list.push(s); }
  const m = {}; for (const p of list) m[p.normalize('NFC')] = sha(fs.readFileSync(path.join(dir, ...p.split('/'))));
  return m;
}
const loadState = (dir) => { try { return JSON.parse(fs.readFileSync(path.join(dir, STATE, 'state.json'), 'utf8')); } catch (e) { return null; } };
const saveState = (dir, st) => { fs.mkdirSync(path.join(dir, STATE), { recursive: true }); fs.writeFileSync(path.join(dir, STATE, 'state.json'), JSON.stringify(st, null, 2)); };
const L = (dir, p) => path.join(dir, ...p.split('/'));
const put = (dir, p, buf) => { fs.mkdirSync(path.dirname(L(dir, p)), { recursive: true }); fs.writeFileSync(L(dir, p), buf); };

export async function pair(server, code, dir, name = 'Test phone') {
  const r = await fetch(server + '/api/sync/pair', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code, name }) });
  const j = await r.json(); if (!r.ok) throw new Error(j.error);
  saveState(dir, { server, token: j.token, base: {} });
  return j;
}

export async function syncFolder(dir, { dry = false, log = () => {} } = {}) {
  const st = loadState(dir); if (!st) throw new Error('Not paired.');
  const H = { Authorization: 'Bearer ' + st.token };
  const call = async (method, url, body, raw) => {
    const r = await fetch(st.server + url, { method, headers: { ...H, ...(body && !raw ? { 'Content-Type': 'application/json' } : {}) }, body: body ? (raw ? body : JSON.stringify(body)) : undefined });
    if (!r.ok) { let j = {}; try { j = await r.json(); } catch (e) {} const err = new Error(j.error || 'HTTP ' + r.status); err.status = r.status; throw err; }
    return r;
  };
  const files = localManifest(dir);
  const { actions, summary } = await (await call('POST', '/api/sync/plan', { base: st.base, files, now: Date.now() })).json();
  log('plan', summary);
  if (dry) return { summary, actions, applied: [], errors: [] };
  const applied = [], errors = [];
  for (const a of actions) {
    try {
      if (a.type === 'pull') { const r = await call('GET', '/api/sync/file?path=' + encodeURIComponent(a.path)); const buf = Buffer.from(await r.arrayBuffer()); if (sha(buf) !== r.headers.get('x-hash')) throw new Error('damaged'); put(dir, a.path, buf); }
      else if (a.type === 'push') { const buf = fs.readFileSync(L(dir, a.path)); await call('PUT', `/api/sync/file?path=${encodeURIComponent(a.path)}&expect=${a.expect}&hash=${sha(buf)}`, buf, true); }
      else if (a.type === 'merge' || a.type === 'conflict') {
        const buf = fs.readFileSync(L(dir, a.path));
        const j = await (await call('POST', `/api/sync/resolve?path=${encodeURIComponent(a.path)}&base=${a.base || 'none'}`, buf, true)).json();
        if (j.result === 'merged') put(dir, a.path, Buffer.from(j.content, 'base64'));
        else { put(dir, j.copyPath, buf); const r = await call('GET', '/api/sync/file?path=' + encodeURIComponent(a.path)); put(dir, a.path, Buffer.from(await r.arrayBuffer())); }
        a.result = j.result; if (j.copyPath) a.copyPath = j.copyPath;
      }
      else if (a.type === 'bin-phone') {
        const name = path.basename(a.path); let d = BIN_DIR + '/' + name, n = 1;
        while (fs.existsSync(L(dir, d)) && sha(fs.readFileSync(L(dir, d))) !== sha(fs.readFileSync(L(dir, a.path)))) { const i = name.lastIndexOf('.'); d = BIN_DIR + '/' + (i > 0 ? name.slice(0, i) + ' (' + (++n) + ')' + name.slice(i) : name + ' (' + (++n) + ')'); }
        fs.mkdirSync(path.dirname(L(dir, d)), { recursive: true });
        if (fs.existsSync(L(dir, d))) fs.unlinkSync(L(dir, a.path)); else fs.renameSync(L(dir, a.path), L(dir, d));
      }
      else if (a.type === 'bin-pc') await call('POST', '/api/sync/bin', { path: a.path, expect: a.expect });
      applied.push(a);
    } catch (e) { errors.push({ path: a.path, type: a.type, error: e.message }); }
  }
  const pc = (await (await call('GET', '/api/sync/manifest')).json()).files, mine = localManifest(dir), base = {};
  for (const [p, h] of Object.entries(mine)) if (pc[p] === h) base[p] = h;
  saveState(dir, { ...st, base });
  await call('POST', '/api/sync/done', {});
  return { summary, actions, applied, errors };
}

if (process.argv[1] && process.argv[1].endsWith('sync-client.mjs')) {
  const [cmd, a, b, c, d] = process.argv.slice(2);
  if (cmd === 'pair') pair(a, b, c, d).then((j) => console.log('paired', j.vault)).catch((e) => { console.error(e.message); process.exit(1); });
  else if (cmd === 'sync') syncFolder(a, { dry: process.argv.includes('--dry'), log: console.log }).then((r) => { console.log(JSON.stringify({ summary: r.summary, errors: r.errors }, null, 2)); }).catch((e) => { console.error(e.message); process.exit(1); });
}
