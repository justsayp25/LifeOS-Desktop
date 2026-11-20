// GymMane mirror: LifeOS shows what GymMane has. GymMane (a separate app, no internet) writes its Auto backup, a ZIP with gymmane.json inside,
// into a folder. This reads the NEWEST backup and works out, for every workout: its start time, length, volume, records, muscle split and sets
// (with time and distance for runs and sprints). Nothing here writes to the vault. Edits and deletes made in GymMane show up here because the
// whole backup is read again whenever the file changes. A copy of the last good read is kept in .memory/ (outside the vault) so a folder that
// is briefly unreadable does not empty the screens.
// Settings in .env: GYMMANE_DIR (the backup folder), GYMMANE_MIRROR=0 (the pages keep using only the Lifts note).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { env, ROOT } from './vault.mjs';

export const mirrorOn = env.GYMMANE_MIRROR !== '0';
const CACHE = path.join(ROOT, '.memory', 'gymmirror.json');

// ---- finding and reading the backup
export function candidateDirs() {
  const h = os.homedir();
  const l = [env.GYMMANE_DIR, '/sdcard/Documents/GymMane', '/storage/emulated/0/Documents/GymMane', path.join(h, 'storage', 'shared', 'Documents', 'GymMane'), path.join(h, 'Documents', 'GymMane')];
  return [...new Set(l.filter(Boolean))];
}
export function findBackup() {
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
// a tiny ZIP reader (no dependencies): the bytes of one entry
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

// ---- turning a GymMane session into what the screens need
const r2 = (n) => Math.round(Number(n) * 100) / 100;
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const cap = (s) => { s = String(s || '').trim(); return s ? s[0].toUpperCase() + s.slice(1) : 'Other'; };
const pad = (n) => String(n).padStart(2, '0');
export const e1rm = (w, r) => (w > 0 && r > 0 ? w * (1 + Math.min(r, 30) / 30) : 0); // Epley
const isCardioSet = (s) => s.km > 0 || (s.t > 0 && !(s.r > 0) && !(s.w > 0));

export function normalize(json) {
  const raw = Array.isArray(json && json.sessions) ? json.sessions : [];
  const sessions = [];
  for (const s of raw) {
    const m = String((s && s.d) || '').match(/^(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}):(\d{2}))?/);
    if (!m) continue;
    const exercises = [];
    for (const e of Array.isArray(s.ex) ? s.ex : []) {
      const name = String((e && e.n) || '').trim();
      const sets = (Array.isArray(e && e.s) ? e.s : []).map((x) => ({ w: r2(num(x && x.w)), r: num(x && x.r), t: num(x && x.t), km: r2(num(x && x.km)) })).filter((x) => x.w > 0 || x.r > 0 || x.t > 0 || x.km > 0);
      if (name && sets.length) exercises.push({ name, muscle: cap(e.p), sets, cardio: sets.every(isCardioSet) });
    }
    if (!exercises.length) continue;
    const hh = m[2] === undefined ? null : Number(m[2]);
    const durMin = Math.round(num(s.dur) / 60);
    sessions.push({
      id: String(s.d), date: m[1], time: hh === null ? '' : pad(hh) + ':' + m[3], hour: hh, durMin,
      title: hh === null ? 'Workout' : (hh < 12 ? 'Morning' : hh < 17 ? 'Afternoon' : 'Evening') + ' workout',
      exercises
    });
  }
  sessions.sort((a, b) => a.id.localeCompare(b.id)); // oldest first
  // volume, sets, muscle split, records (a record = a better estimated 1RM, or more reps for a bodyweight exercise, than ever before)
  const best = new Map(); // exercise -> {e, reps}
  for (const s of sessions) {
    let vol = 0, nSets = 0, records = 0; const per = new Map();
    for (const e of s.exercises) {
      if (e.cardio) { e.records = 0; continue; }
      const k = e.name.toLowerCase(), b = best.get(k) || { e: 0, reps: 0 };
      let me = 0, mr = 0;
      for (const x of e.sets) { if (x.w > 0 && x.r > 0) vol += x.w * x.r; nSets++; me = Math.max(me, e1rm(x.w, x.r)); if (!(x.w > 0)) mr = Math.max(mr, x.r); }
      e.records = (b.e > 0 && me > b.e + 1e-9) || (b.e === 0 && b.reps > 0 && mr > b.reps) ? 1 : 0;
      records += e.records;
      best.set(k, { e: Math.max(b.e, me), reps: Math.max(b.reps, mr) });
      per.set(e.muscle, (per.get(e.muscle) || 0) + e.sets.length);
    }
    const total = [...per.values()].reduce((a, c) => a + c, 0) || 1;
    s.volumeKg = r2(vol); s.sets = nSets; s.records = records;
    s.split = [...per.entries()].map(([muscle, n]) => ({ muscle, pct: Math.round((n / total) * 100) })).sort((a, b) => b.pct - a.pct);
    s.cardio = s.exercises.filter((e) => e.cardio).map((e) => ({ name: e.name, km: r2(e.sets.reduce((a, x) => a + x.km, 0)), sec: e.sets.reduce((a, x) => a + x.t, 0), reps: e.sets.length }));
  }
  return sessions;
}

// ---- reading with a cache (by file) and a saved copy of the last good read
let mem = { key: '', sessions: [], file: null, mtime: 0, size: 0, at: 0, error: '' };
function readSaved() { try { const j = JSON.parse(fs.readFileSync(CACHE, 'utf8')); return Array.isArray(j.sessions) ? j : null; } catch { return null; } }
function saveCopy(sessions, meta) { try { fs.mkdirSync(path.dirname(CACHE), { recursive: true }); fs.writeFileSync(CACHE, JSON.stringify({ sessions, ...meta })); } catch { /* it just reads again */ } }

export function mirror() {
  if (!mirrorOn) return { sessions: [], file: null, mtime: 0, size: 0, error: 'off', saved: false };
  const { best, dir } = findBackup();
  if (best) {
    const key = best.file + '|' + best.mtime + '|' + best.size;
    if (mem.key === key && !mem.error) return { ...mem, saved: false };
    try {
      const json = JSON.parse(zipEntry(fs.readFileSync(best.file), 'gymmane.json').toString('utf8'));
      const sessions = normalize(json);
      mem = { key, sessions, file: path.basename(best.file), mtime: best.mtime, size: best.size, at: Date.now(), error: '' };
      saveCopy(sessions, { file: mem.file, mtime: mem.mtime, size: mem.size });
      return { ...mem, saved: false };
    } catch (e) {
      mem = { ...mem, key, error: String((e && e.message) || e).slice(0, 200) };
    }
  } else if (!mem.sessions.length) {
    mem = { ...mem, error: dir ? 'No GymMane backup ZIP in ' + dir : 'GymMane folder not found' };
  }
  if (!mem.sessions.length) { const c = readSaved(); if (c) return { sessions: c.sessions, file: c.file || null, mtime: c.mtime || 0, size: c.size || 0, error: mem.error, saved: true }; }
  return { ...mem, saved: !best };
}
export const mirrorSessions = () => mirror().sessions;

// ---- what the screens ask for
export function mirrorStatus() {
  const m = mirror();
  const now = Date.now();
  return { ok: !m.error || m.sessions.length > 0, on: mirrorOn, file: m.file, backupAt: m.mtime ? new Date(m.mtime).toISOString() : null, ageMin: m.mtime ? Math.max(0, Math.round((now - m.mtime) / 60000)) : null, sessions: m.sessions.length, fromCopy: !!m.saved, error: m.error || '' };
}

const WEEKDAY = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export function longDate(d) { const [y, mo, da] = d.split('-').map(Number); const dt = new Date(y, mo - 1, da); return WEEKDAY[dt.getDay()] + ', ' + MONTH[mo - 1] + ' ' + da + ', ' + y; }
const clock = (t) => { if (!t) return ''; let [h, mi] = t.split(':').map(Number); const ap = h < 12 ? 'am' : 'pm'; h = h % 12 || 12; return h + ':' + pad(mi) + ap; };

export function mirrorHistory(limit = 400) {
  const m = mirror();
  const list = m.sessions.slice().reverse().slice(0, Math.max(1, Math.min(2000, limit)));
  const sessions = list.map((s) => ({
    id: s.id, date: s.date, dateLong: longDate(s.date), timeText: clock(s.time), title: s.title, durMin: s.durMin, volumeKg: s.volumeKg, sets: s.sets, records: s.records, split: s.split, cardio: s.cardio,
    exercises: s.exercises.map((e) => ({ name: e.name, muscle: e.muscle, cardio: e.cardio, records: e.records || 0, sets: e.sets }))
  }));
  // personal records per exercise: the heaviest weight lifted (with its reps) and the best estimated 1RM
  const bestBy = new Map();
  for (const s of m.sessions) for (const e of s.exercises) {
    if (e.cardio) continue;
    for (const x of e.sets) {
      const v = e1rm(x.w, x.r); if (v <= 0) continue;
      const k = e.name.toLowerCase(); let b = bestBy.get(k);
      if (!b) { b = { name: e.name, w: x.w, r: x.r, e1rm: r2(v), date: s.date }; bestBy.set(k, b); continue; }
      if (v > b.e1rm) { b.e1rm = r2(v); b.date = s.date; }
      if (x.w > b.w || (x.w === b.w && x.r > b.r)) { b.w = x.w; b.r = x.r; }
    }
  }
  const records = [...bestBy.values()].sort((a, b) => b.e1rm - a.e1rm).slice(0, 60).map((x) => ({ ...x, dateLong: longDate(x.date) }));
  return { status: mirrorStatus(), count: m.sessions.length, sessions, records };
}

// ---- what the other pages see (the Lifts note stays as it is on disk; these are layered on top when they are read)
const liftsOf = (sessions) => {
  const out = [];
  for (const s of sessions) s.exercises.forEach((e, i) => {
    if (e.cardio) return;
    const sets = e.sets.filter((x) => x.w > 0 || x.r > 0).map((x) => ({ t: 0, w: x.w > 0 ? String(x.w) : '', r: String(x.r) }));
    if (sets.length) out.push({ id: 'gm.' + s.id + '.' + i, date: s.date, name: e.name, sets });
  });
  return out;
};
const runsOf = (sessions) => {
  const runs = [], sprints = [];
  for (const s of sessions) s.exercises.forEach((e, i) => {
    if (!e.cardio) return;
    if (/sprint/i.test(e.name)) {
      const km = e.sets.find((x) => x.km > 0), times = e.sets.map((x) => x.t).filter((t) => t > 0);
      if (km && times.length) sprints.push({ id: 'gms.' + s.id + '.' + i, date: s.date, dist: r2(km.km * 1000), times });
    } else {
      const km = e.sets.reduce((a, x) => a + x.km, 0), sec = e.sets.reduce((a, x) => a + x.t, 0);
      if (km > 0) runs.push({ id: 'gmr.' + s.id + '.' + i, date: s.date, dist: r2(km), time: r2(sec / 60) });
    }
  });
  return { runs, sprints };
};
export const mirrorRuns = () => runsOf(mirrorSessions());
export const isMirrorId = (id) => /^gm[rs]?\./.test(String(id || ''));

// Lifts: for the days GymMane covers, GymMane's data is what is shown (so edits and deletes follow); older entries in the Lifts note stay.
export function overlayLifts(vault) {
  if (!mirrorOn) return vault;
  const ss = mirrorSessions();
  if (!ss.length) return vault;
  const first = ss[0].date;
  return [...vault.filter((x) => x.date < first), ...liftsOf(ss)];
}
// Runs and sprints: both are shown; a run that is in the note and in GymMane (same day, same distance) is shown once.
export function overlayRuns(vaultRuns, vaultSprints) {
  if (!mirrorOn) return { runs: vaultRuns, sprints: vaultSprints };
  const { runs, sprints } = mirrorRuns();
  const dupR = (x) => vaultRuns.some((v) => v.date === x.date && Math.abs(v.dist - x.dist) < 0.05);
  const dupS = (x) => vaultSprints.some((v) => v.date === x.date && Math.abs(v.dist - x.dist) < 1);
  return { runs: [...vaultRuns, ...runs.filter((x) => !dupR(x))], sprints: [...vaultSprints, ...sprints.filter((x) => !dupS(x))] };
}
