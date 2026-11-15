// Phone <-> PC sync, PC side. The phone asks for a plan, then applies it file by file.
// Rules live in syncCore.mjs. Here: the files, the pairing code and the tokens.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { ROOT, VAULT, HttpError } from './vault.mjs';
import { SCOPE, BIN_DIR, cleanPath, isReadonly, isTextPath, planSync, merge3, conflictName } from './syncCore.mjs';

const DATA = path.join(ROOT, '.sync');                 // app folder, never inside the vault
const DEVICES = path.join(DATA, 'devices.json');
const STORE = path.join(DATA, 'store');                // text of every note at the last sync (so edits on both sides can be merged)
const BACKUPS = path.join(DATA, 'backups');            // anything the PC copy replaces is kept here first
const MAX_FILE = 100 * 1024 * 1024;
const STORE_MAX = 2 * 1024 * 1024;
const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const abs = (p) => path.join(VAULT, ...p.split('/'));
const mk = (d) => fs.mkdirSync(d, { recursive: true });

// ---------- files ----------
const hashCache = new Map(); // path -> { size, mtimeMs, hash }
function hashOf(p) {
  const f = abs(p); let st; try { st = fs.statSync(f); } catch (e) { return undefined; }
  if (!st.isFile()) return undefined;
  const hit = hashCache.get(p);
  // trust the cache only when the file has been quiet for a couple of seconds
  if (hit && hit.size === st.size && hit.mtimeMs === st.mtimeMs && Date.now() - st.mtimeMs > 2000) return hit.hash;
  const h = sha(fs.readFileSync(f));
  hashCache.set(p, { size: st.size, mtimeMs: st.mtimeMs, hash: h });
  return h;
}
function walk(dir, rel, out) {
  let ents; try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return; }
  for (const e of ents) {
    if (e.name.startsWith('.') || e.name === 'Thumbs.db' || e.name === 'desktop.ini' || e.name.startsWith('~$')) continue;
    const r = rel ? rel + '/' + e.name : e.name;
    if (e.isDirectory()) walk(path.join(dir, e.name), r, out);
    else if (e.isFile() && cleanPath(r.normalize('NFC'))) out.push(r);
  }
}
export function pcManifest() {
  const list = [];
  for (const s of SCOPE) {
    if (s.endsWith('/')) walk(abs(s.slice(0, -1)), s.slice(0, -1), list);
    else if (fs.existsSync(abs(s))) list.push(s);
  }
  const m = {};
  for (const p of list) { const h = hashOf(p); if (h) m[p.normalize('NFC')] = h; }
  return m;
}
// the real path on disk for a (cleaned) manifest path; handles names stored in a different Unicode form
function realPath(p) { return abs(p); }
function safeAbs(p) {
  const c = cleanPath(p); if (!c) throw new HttpError(400, 'That path is not allowed.');
  const f = realPath(c);
  const rel = path.relative(VAULT, f); if (rel.startsWith('..') || path.isAbsolute(rel)) throw new HttpError(400, 'That path is not allowed.');
  // never follow a link out of the vault
  let dir = path.dirname(f);
  while (dir.length > VAULT.length) { try { if (fs.lstatSync(dir).isSymbolicLink()) throw new HttpError(400, 'That path is not allowed.'); } catch (e) { if (e instanceof HttpError) throw e; } dir = path.dirname(dir); }
  return { c, f };
}
function backup(p) {
  const f = abs(p); if (!fs.existsSync(f)) return;
  const d = path.join(BACKUPS, new Date().toISOString().slice(0, 10), ...p.split('/'));
  mk(path.dirname(d)); let t = d, n = 1; while (fs.existsSync(t)) t = d + '.' + n++;
  fs.copyFileSync(f, t);
}
function writeAtomic(f, buf) {
  mk(path.dirname(f));
  const tmp = path.join(path.dirname(f), '.lifeos-sync-' + crypto.randomBytes(5).toString('hex') + '.tmp');
  fs.writeFileSync(tmp, buf); fs.renameSync(tmp, f);
}
function remember(p, buf) { // keep the text of agreed notes so a later two-sided edit can be merged
  if (!isTextPath(p) || buf.length > STORE_MAX) return;
  mk(STORE); const f = path.join(STORE, sha(buf)); if (!fs.existsSync(f)) fs.writeFileSync(f, buf);
}
function recall(h) { try { return fs.readFileSync(path.join(STORE, h)); } catch (e) { return null; } }
function pruneOld() {
  try { // backups older than 30 days
    for (const d of fs.readdirSync(BACKUPS)) { const t = Date.parse(d); if (t && Date.now() - t > 30 * 864e5) fs.rmSync(path.join(BACKUPS, d), { recursive: true, force: true }); }
  } catch (e) {}
}
pruneOld();

// ---------- devices and pairing ----------
let devices = (() => { try { return JSON.parse(fs.readFileSync(DEVICES, 'utf8')); } catch (e) { return []; } })();
const saveDevices = () => { mk(DATA); fs.writeFileSync(DEVICES, JSON.stringify(devices, null, 2)); };
let pairing = null; // { code, expires, tries }
export const isLoopback = (a) => !a || a === '::1' || a === '127.0.0.1' || a === '::ffff:127.0.0.1';
export function lanAddresses() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) for (const i of list || []) if (i.family === 'IPv4' && !i.internal) out.push(i.address);
  return out;
}
export function newPairingCode() {
  pairing = { code: String(crypto.randomInt(0, 1000000)).padStart(6, '0'), expires: Date.now() + 10 * 60000, tries: 0 };
  return { code: pairing.code, expiresInSeconds: 600, addresses: lanAddresses() };
}
export function pairDevice(b) {
  if (!pairing || Date.now() > pairing.expires) throw new HttpError(403, 'There is no active pairing code. Open the Sync page on the PC to get one.');
  if (++pairing.tries > 5) { pairing = null; throw new HttpError(403, 'Too many wrong tries. Get a new code on the PC.'); }
  const given = Buffer.from(String((b && b.code) || '')), want = Buffer.from(pairing.code);
  if (given.length !== want.length || !crypto.timingSafeEqual(given, want)) throw new HttpError(403, 'That code is wrong.');
  pairing = null;
  const token = crypto.randomBytes(32).toString('base64url');
  const id = crypto.randomBytes(4).toString('hex');
  devices.push({ id, name: String((b && b.name) || 'Phone').slice(0, 60), hash: sha(token), createdAt: new Date().toISOString(), lastSeen: null, lastSync: null });
  saveDevices();
  return { token, deviceId: id, vault: path.basename(VAULT) };
}
export function listDevices() { return { devices: devices.map(({ hash, ...d }) => d) }; }
export function revokeDevice(id) { const n = devices.length; devices = devices.filter((d) => d.id !== id); if (devices.length !== n) saveDevices(); return { ok: true }; }
export function authDevice(req) {
  const m = /^Bearer (\S+)$/.exec(req.headers.authorization || '');
  if (!m) throw new HttpError(401, 'Pair this device first.');
  const h = Buffer.from(sha(m[1]));
  const d = devices.find((x) => { const y = Buffer.from(x.hash); return y.length === h.length && crypto.timingSafeEqual(y, h); });
  if (!d) throw new HttpError(401, 'This device is not paired (or was removed). Pair it again.');
  d.lastSeen = new Date().toISOString();
  return d;
}

// ---------- the sync steps ----------
export function info() { return { vault: path.basename(VAULT), scope: SCOPE, serverTime: Date.now() }; }
export function manifest() { return { files: pcManifest() }; }

export function plan(b, device) {
  const phone = (b && b.files) || {}, base = (b && b.base) || {};
  const clean = (m) => { const o = {}; for (const [k, v] of Object.entries(m)) { const c = cleanPath(k); if (c && /^[0-9a-f]{64}$/.test(v)) o[c] = v; } return o; };
  const pc = pcManifest();
  const P = clean(phone), B = clean(base);
  // files both sides already agree on: remember their text for future merges
  for (const [p, h] of Object.entries(P)) if (pc[p] === h && isTextPath(p)) { const f = abs(p); if (!fs.existsSync(path.join(STORE, h))) { try { remember(p, fs.readFileSync(f)); } catch (e) {} } }
  const out = planSync(B, P, pc, { now: Number(b && b.now) || Date.now() });
  const actions = out.actions.map((a) => (a.type === 'push' ? { ...a, expect: pc[a.path] || 'none' } : a.type === 'bin-pc' ? { ...a, expect: pc[a.path] } : a));
  return { actions, summary: out.summary };
}

export function readFile(p) {
  const { c, f } = safeAstat(p);
  const buf = fs.readFileSync(f);
  remember(c, buf);
  return { buf, hash: sha(buf) };
}
function safeAstat(p) {
  const r = safeAbs(p);
  if (!fs.existsSync(r.f) || !fs.statSync(r.f).isFile()) throw new HttpError(404, 'No such file.');
  return r;
}

export function writeFile(p, expect, buf, claimedHash) {
  const { c, f } = safeAbs(p);
  if (isReadonly(c)) throw new HttpError(403, 'The phone cannot change this file.');
  if (buf.length > MAX_FILE) throw new HttpError(413, 'That file is too large.');
  const h = sha(buf);
  if (claimedHash && claimedHash !== h) throw new HttpError(400, 'The file arrived damaged. Try again.');
  const cur = hashOf(c);
  if ((expect === 'none' ? undefined : expect) !== cur) throw new HttpError(409, 'That file changed on the PC while syncing. Sync again.');
  if (cur === h) return { hash: h };
  backup(c); writeAtomic(f, buf); hashCache.delete(c); remember(c, buf);
  return { hash: h };
}

export function resolve(p, baseHash, buf) {
  const { c, f } = safeAbs(p);
  if (isReadonly(c)) throw new HttpError(403, 'The phone cannot change this file.');
  if (!fs.existsSync(f)) throw new HttpError(404, 'No such file on the PC.');
  const pcBuf = fs.readFileSync(f), baseBuf = /^[0-9a-f]{64}$/.test(baseHash || '') ? recall(baseHash) : null;
  if (baseBuf && isTextPath(c)) {
    const m = merge3(baseBuf.toString('utf8'), buf.toString('utf8'), pcBuf.toString('utf8'));
    if (m !== null) {
      const out = Buffer.from(m, 'utf8');
      backup(c); writeAtomic(f, out); hashCache.delete(c); remember(c, out);
      return { result: 'merged', hash: sha(out), content: out.toString('base64') };
    }
  }
  // could not merge: keep both. The PC keeps its note; the phone's version is saved beside it.
  const copy = conflictName(c, Date.now(), (x) => fs.existsSync(abs(x)));
  writeAtomic(abs(copy), buf); hashCache.delete(copy);
  return { result: 'conflict', copyPath: copy, hash: sha(pcBuf) };
}

export function binOnPc(p, expect) {
  const { c, f } = safeAbs(p);
  if (isReadonly(c)) throw new HttpError(403, 'The phone cannot change this file.');
  const cur = hashOf(c);
  if (cur === undefined) return { ok: true };
  if (expect && cur !== expect) throw new HttpError(409, 'That file changed on the PC while syncing. Sync again.');
  const name = path.basename(c);
  let dest = c.startsWith(BIN_DIR + '/') ? null : BIN_DIR + '/' + name, n = 1;
  if (dest) {
    // if the same file is already in the Bin (the phone moved it there), the original can simply go
    while (fs.existsSync(abs(dest)) && hashOf(dest) !== cur) { const i = name.lastIndexOf('.'); dest = BIN_DIR + '/' + (i > 0 ? name.slice(0, i) + ' (' + (++n) + ')' + name.slice(i) : name + ' (' + (++n) + ')'); }
    if (!fs.existsSync(abs(dest))) { mk(path.dirname(abs(dest))); fs.renameSync(f, abs(dest)); }
    else { backup(c); fs.unlinkSync(f); }
  } else { backup(c); fs.unlinkSync(f); }
  hashCache.delete(c);
  return { ok: true };
}

export function finish(device) { device.lastSync = new Date().toISOString(); saveDevices(); return { ok: true }; }
