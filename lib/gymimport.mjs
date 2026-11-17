// GymMane import: your lifts (sets, reps, weights) from GymMane's Auto backup into the Lifts note, by themselves.
// GymMane (a separate app) saves a ZIP with a gymmane.json inside into a folder on the phone/PC ("Auto backup").
// This reads the newest ZIP and adds every workout it has not seen yet, in the Lifts note's existing format:
//   ### 2026-11-13
//   - Barbell Bench Press -- 3x5 @ 45
// Rules: nothing is overwritten or deleted. A workout is imported once (its id is kept in .memory/gymimport.json), so
// a lift you delete in LifeOS does not come back. A lift already in the note (same day, name, sets) is skipped.
// The ZIP is only read. Settings in .env: GYMMANE_DIR (the backup folder), GYMMANE_IMPORT=0 (off), GYMMANE_CHECK_S (default 60).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { env, ROOT } from './vault.mjs';
import { listHealth, addHealth } from './healthlogs.mjs';

const FILE = path.join(ROOT, '.memory', 'gymimport.json');
const CHECK_MS = Math.max(10, Number(env.GYMMANE_CHECK_S || 60)) * 1000;
const available = env.GYMMANE_IMPORT !== '0';
const state = { last: null, seen: {}, done: {} }; // seen: {file, mtime, size}; done: {sessionId: true}
try { const j = JSON.parse(fs.readFileSync(FILE, 'utf8')); state.seen = j.seen || {}; state.done = j.done || {}; state.last = j.last || null; } catch { /* first run */ }
const save = () => { try { fs.mkdirSync(path.dirname(FILE), { recursive: true }); fs.writeFileSync(FILE, JSON.stringify({ seen: state.seen, done: state.done, last: state.last })); } catch { /* it just runs again */ } };

// the folders to look in: .env first, then where the phone and the PC usually keep it
export function candidateDirs() {
  const h = os.homedir();
  const l = [env.GYMMANE_DIR, '/sdcard/Documents/GymMane', '/storage/emulated/0/Documents/GymMane', path.join(h, 'storage', 'shared', 'Documents', 'GymMane'), path.join(h, 'Documents', 'GymMane')];
  return [...new Set(l.filter(Boolean))];
}
function findBackup() {
  let best = null, dir = null;
  for (const d of candidateDirs()) {
    let names; try { names = fs.readdirSync(d); } catch { continue; }
    dir = dir || d;
    for (const n of names) {
      if (!/^gymmane.*\.zip$/i.test(n)) continue;
      try { const st = fs.statSync(path.join(d, n)); if (st.isFile() && (!best || st.mtimeMs > best.mtime)) best = { file: path.join(d, n), mtime: st.mtimeMs, size: st.size }; } catch { /* skip */ }
    }
  }
  return { best, dir };
}

// a tiny ZIP reader (no dependencies): returns the bytes of one entry
export function zipEntry(buf, wanted) {
  let e = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 70000); i--) if (buf.readUInt32LE(i) === 0x06054b50) { e = i; break; }
  if (e < 0) throw new Error('Not a ZIP file.');
  const n = buf.readUInt16LE(e + 10);
  let p = buf.readUInt32LE(e + 16);
  for (let k = 0; k < n; k++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break;
    const method = buf.readUInt16LE(p + 10), csize = buf.readUInt32LE(p + 20), nlen = buf.readUInt16LE(p + 28), xlen = buf.readUInt16LE(p + 30), clen = buf.readUInt16LE(p + 32), off = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nlen);
    p += 46 + nlen + xlen + clen;
    if (name !== wanted) continue;
    const dataAt = off + 30 + buf.readUInt16LE(off + 26) + buf.readUInt16LE(off + 28);
    const raw = buf.subarray(dataAt, dataAt + csize);
    if (method === 0) return raw;
    if (method === 8) return zlib.inflateRawSync(raw);
    throw new Error('Unsupported ZIP compression.');
  }
  throw new Error(wanted + ' is not in the ZIP.');
}

const r2 = (n) => String(Math.round(Number(n) * 100) / 100);
const sig = (sets) => sets.map((s) => r2(s.r || 0) + '@' + r2(s.w || 0)).join(',');

// workouts -> [{id, date, exercises:[{name, sets:[{w, r}]}]}]
export function readSessions(json) {
  const out = [];
  for (const s of Array.isArray(json && json.sessions) ? json.sessions : []) {
    const m = String(s && s.d || '').match(/^(\d{4}-\d{2}-\d{2})/);
    if (!m) continue;
    const exercises = [];
    for (const e of Array.isArray(s.ex) ? s.ex : []) {
      const name = String(e && e.n || '').trim();
      const sets = (Array.isArray(e && e.s) ? e.s : []).map((x) => ({ w: Number(x && x.w) || 0, r: Number(x && x.r) || 0 })).filter((x) => x.w > 0 || x.r > 0);
      if (name && sets.length) exercises.push({ name, sets });
    }
    if (exercises.length) out.push({ id: String(s.d), date: m[1], exercises });
  }
  return out;
}

export function gymImportRun() {
  const t = new Date().toISOString();
  if (!available) return { ok: true, off: true };
  const { best, dir } = findBackup();
  if (!best) {
    const msg = dir ? 'No GymMane backup ZIP in ' + dir + '. Turn on Auto backup in GymMane.' : 'GymMane folder not found. Set GYMMANE_DIR in .env (looked in: ' + candidateDirs().join(', ') + ').';
    state.last = { at: t, ok: false, error: msg, added: 0, workouts: 0 };
    return { ok: false, error: msg };
  }
  if (state.seen.file === best.file && state.seen.mtime === best.mtime && state.seen.size === best.size && state.last && state.last.ok) return { ok: true, unchanged: true, file: path.basename(best.file), added: 0 };
  try {
    const json = JSON.parse(zipEntry(fs.readFileSync(best.file), 'gymmane.json').toString('utf8'));
    const have = new Set(listHealth().lifts.map((x) => x.date + '|' + x.name.toLowerCase() + '|' + sig(x.sets)));
    let added = 0, workouts = 0;
    for (const s of readSessions(json)) {
      if (state.done[s.id]) continue;
      for (const e of s.exercises) {
        const key = s.date + '|' + e.name.toLowerCase() + '|' + sig(e.sets);
        if (have.has(key)) continue;
        addHealth('lifts', { name: e.name, date: s.date, sets: e.sets.map((x) => ({ w: x.w, r: x.r, t: 0 })) });
        have.add(key); added++;
      }
      state.done[s.id] = true; workouts++;
    }
    state.seen = { file: best.file, mtime: best.mtime, size: best.size };
    state.last = { at: t, ok: true, file: path.basename(best.file), added, workouts };
    save();
    return { ok: true, file: path.basename(best.file), added, workouts };
  } catch (e) {
    const msg = String((e && e.message) || e).slice(0, 240);
    state.last = { at: t, ok: false, error: msg, added: 0, workouts: 0 };
    return { ok: false, error: msg };
  }
}
export function gymImportStatus() { return { ok: true, available, folders: candidateDirs(), last: state.last, imported: Object.keys(state.done).length }; }

let timer = null;
export function startGymImport() {
  if (!available || timer) return;
  const tick = () => { try { const r = gymImportRun(); if (r.added) console.log(`GymMane: ${r.added} lift(s) from ${r.workouts} workout(s) added to the Lifts note.`); } catch { /* next time */ } };
  timer = setInterval(tick, CHECK_MS);
  setTimeout(tick, 5000);
  console.log('GymMane import is on (checks the backup folder every ' + CHECK_MS / 1000 + ' s).');
}
