// GymMane import. GymMane (a separate app) saves a ZIP with a gymmane.json inside into a folder on the phone/PC ("Auto backup").
// Two jobs, both from the NEWEST backup (see lib/gymmirror.mjs):
//  1. The pages show GymMane's data directly (history, workout detail, records, week stats), so edits and deletes made in GymMane follow.
//  2. Every workout is also written ONCE to the vault, in the notes' existing formats, so the agent and the notes have it:
//       Lifts note:  ### 2026-11-13  then  - Barbell Bench Press -- 3x5 @ 45
//       Runs note:   - 2026-11-13 -- distance: 5 km, time: 28 min ...   (a run: sets with a distance)
//       Sprints:     - 2026-11-13 -- 100 m x 4: 14.2, 14.0, ... s       (an exercise named sprint, with a distance and times)
//       Length:      - Session -- 43 min, 07:49    (one line per workout, under that day's ### heading in the Lifts note, so a PC without the backup can show it)
// Rules: nothing in the vault is overwritten or deleted. A workout is written once (its id is kept in .memory/gymimport.json), so a line you
// delete in the note does not come back. The ZIP is only read.
// Settings in .env: GYMMANE_DIR (the backup folder), GYMMANE_IMPORT=0 (off), GYMMANE_CHECK_S (default 60), GYMMANE_MIRROR=0 (pages use only the notes).
import fs from 'node:fs';
import path from 'node:path';
import { env, ROOT } from './vault.mjs';
import { addHealth, readVaultLifts, readVaultRuns, readVaultSprints, readVaultSessions } from './healthlogs.mjs';
import { mirror, mirrorStatus, candidateDirs, zipEntry, normalize } from './gymmirror.mjs';

export { candidateDirs, zipEntry, normalize };
const FILE = path.join(ROOT, '.memory', 'gymimport.json');
const CHECK_MS = Math.max(10, Number(env.GYMMANE_CHECK_S || 60)) * 1000;
const available = env.GYMMANE_IMPORT !== '0';
const state = { last: null, seen: {}, done: {}, lengthsDone: false }; // seen: {file, mtime, size}; done: {sessionId: true}
try { const j = JSON.parse(fs.readFileSync(FILE, 'utf8')); state.seen = j.seen || {}; state.done = j.done || {}; state.last = j.last || null; state.lengthsDone = !!j.lengthsDone; } catch { /* first run */ }
const save = () => { try { fs.mkdirSync(path.dirname(FILE), { recursive: true }); fs.writeFileSync(FILE, JSON.stringify({ seen: state.seen, done: state.done, last: state.last, lengthsDone: state.lengthsDone })); } catch { /* it just runs again */ } };

const r2 = (n) => String(Math.round(Number(n) * 100) / 100);
const sig = (sets) => sets.map((s) => r2(s.r || 0) + '@' + r2(s.w || 0)).join(',');
const key = (date, name, sets) => date + '|' + String(name).toLowerCase() + '|' + sig(sets);
const liftSets = (e) => e.sets.filter((x) => x.w > 0 || x.r > 0).map((x) => ({ w: x.w, r: x.r }));

// what is written to the vault for one workout's cardio exercises
function cardioWrites(s) {
  const out = [];
  for (const e of s.exercises) {
    if (!e.cardio) continue;
    if (/sprint/i.test(e.name)) {
      const km = e.sets.find((x) => x.km > 0), times = e.sets.map((x) => x.t).filter((t) => t > 0);
      if (km && times.length) out.push({ sprint: { date: s.date, dist: km.km * 1000, times } });
    } else {
      const km = e.sets.reduce((a, x) => a + x.km, 0), sec = e.sets.reduce((a, x) => a + x.t, 0);
      if (km > 0) out.push({ run: { date: s.date, dist: km, time: sec / 60 } });
    }
  }
  return out;
}

// How long a workout took goes into the Lifts note as one extra line under that day's heading ("- Session -- 43 min, 07:49").
// Only workouts with lifts get one (runs carry their own time in the Runs note). Nothing is overwritten.
const hasLifts = (s) => s.exercises.some((e) => !e.cardio && liftSets(e).length);
const addSession = (s) => { if (s.durMin > 0 && hasLifts(s)) { addHealth('lifts', { date: s.date, session: { min: s.durMin, time: s.time } }); return 1; } return 0; };
// Once after the upgrade: workouts imported before lengths existed get their Session line (the note must hold one per workout and day).
function backfillLengths(m) {
  const have = new Map();
  for (const x of readVaultSessions()) have.set(x.date, (have.get(x.date) || 0) + 1);
  let n = 0;
  for (const s of m.sessions) {
    if (!state.done[s.id] || !(s.durMin > 0) || !hasLifts(s)) continue;
    const c = have.get(s.date) || 0;
    const mine = m.sessions.filter((x) => x.date === s.date && x.id <= s.id && x.durMin > 0 && hasLifts(x)).length; // my place among that day's workouts
    if (c >= mine) continue;
    n += addSession(s); have.set(s.date, c + 1);
  }
  return n;
}

export function summaryText() {
  const m = mirror(), n = m.sessions.length;
  if (!m.file && !n) return 'GymMane: no backup found yet. Turn on Auto backup in GymMane (After every workout).';
  const pending = m.sessions.filter((s) => !state.done[s.id]).length;
  const age = m.mtime ? Math.max(0, Math.round((Date.now() - m.mtime) / 60000)) : null;
  const ageT = age === null ? '' : age < 1 ? 'just now' : age < 90 ? age + ' min ago' : age < 2880 ? Math.round(age / 60) + ' h ago' : Math.round(age / 1440) + ' days ago';
  return 'GymMane ' + n + (n === 1 ? ' workout' : ' workouts') + ', LifeOS shows ' + n + (pending ? ', the Lifts note is missing ' + pending : ', the Lifts note has ' + n) + (ageT ? '. Backup read ' + ageT : '') + (m.saved ? ' (from a saved copy: the backup folder cannot be read now)' : '') + '.';
}

// opts.repair = N: also look again at workouts from the last N days (a lift missing from the note is added back; nothing is removed)
export function gymImportRun(opts = {}) {
  const t = new Date().toISOString();
  if (!available) return { ok: true, off: true };
  const repair = Math.max(0, Math.min(60, Math.floor(Number(opts.repair) || 0)));
  const m = mirror();
  if (!m.file && !m.sessions.length) {
    const msg = m.error || 'No GymMane backup found.';
    state.last = { at: t, ok: false, error: msg, added: 0, workouts: 0 };
    return { ok: false, error: msg, summary: summaryText() };
  }
  if (m.error && !m.sessions.length) {
    state.last = { at: t, ok: false, error: m.error, added: 0, workouts: 0 };
    return { ok: false, error: m.error, summary: summaryText() };
  }
  if (!repair && state.seen.file === m.file && state.seen.mtime === m.mtime && state.seen.size === m.size && state.last && state.last.ok && state.lengthsDone) {
    return { ok: true, unchanged: true, file: m.file, added: 0, sessions: m.sessions.length, summary: summaryText() };
  }
  try {
    const addLift = (date, e) => addHealth('lifts', { name: e.name, date, sets: liftSets(e).map((x) => ({ w: x.w, r: x.r, t: 0 })) });
    const have = new Map(); // lift lines already in the note: key -> how many
    for (const x of readVaultLifts()) { const k = key(x.date, x.name, x.sets.map((y) => ({ w: Number(y.w) || 0, r: Number(y.r) || 0 }))); have.set(k, (have.get(k) || 0) + 1); }
    const vaultRuns = readVaultRuns(), vaultSprints = readVaultSprints();
    const first = Object.keys(state.done).length === 0;
    let added = 0, workouts = 0, cardio = 0;
    const doCardio = (s, skipDup) => {
      for (const w of cardioWrites(s)) {
        if (w.run) {
          if (skipDup && vaultRuns.some((v) => v.date === w.run.date && Math.abs(v.dist - w.run.dist) < 0.05)) continue;
          addHealth('runs', { date: w.run.date, dist: w.run.dist, time: w.run.time }); cardio++;
        } else if (w.sprint) {
          if (skipDup && vaultSprints.some((v) => v.date === w.sprint.date && Math.abs(v.dist - w.sprint.dist) < 1)) continue;
          addHealth('runs', { sprint: w.sprint }); cardio++;
        }
      }
    };
    if (repair) {
      // for the last N days: the note must hold at least as many identical lines as the backup has; add what is missing
      const cut = new Date(); cut.setDate(cut.getDate() - repair);
      const from = cut.getFullYear() + '-' + String(cut.getMonth() + 1).padStart(2, '0') + '-' + String(cut.getDate()).padStart(2, '0');
      const need = new Map();
      for (const s of m.sessions) if (s.date >= from) for (const e of s.exercises) { if (e.cardio) continue; const sets = liftSets(e); if (!sets.length) continue; const k = key(s.date, e.name, sets); const c = need.get(k); need.set(k, { date: s.date, e, n: (c ? c.n : 0) + 1 }); }
      for (const v of need.values()) for (let k = have.get(key(v.date, v.e.name, liftSets(v.e))) || 0; k < v.n; k++) { addLift(v.date, v.e); added++; }
      for (const s of m.sessions) if (s.date >= from && !state.done[s.id]) { state.done[s.id] = true; workouts++; doCardio(s, true); }
    } else {
      // The "already in the note" check is only for the very first import (lifts typed in by hand before GymMane). After that every new
      // workout is written in full, even if it is identical to another one (two workouts the same day, the same sets).
      for (const s of m.sessions) {
        if (state.done[s.id]) continue;
        for (const e of s.exercises) {
          if (e.cardio) continue;
          const sets = liftSets(e); if (!sets.length) continue;
          if (first) { const k = key(s.date, e.name, sets), n = have.get(k) || 0; if (n > 0) { have.set(k, n - 1); continue; } }
          addLift(s.date, e); added++;
        }
        doCardio(s, first);
        state.done[s.id] = true; workouts++;
      }
    }
    let lengths = 0;
    if (!state.lengthsDone || workouts) { lengths = backfillLengths(m); state.lengthsDone = true; } // counts what the note already has, so it never doubles up
    state.seen = { file: m.file, mtime: m.mtime, size: m.size };
    state.last = { at: t, ok: true, file: m.file, added, workouts, cardio, lengths };
    save();
    return { ok: true, file: m.file, added, workouts, cardio, lengths, sessions: m.sessions.length, summary: summaryText() };
  } catch (e) {
    const msg = String((e && e.message) || e).slice(0, 240);
    state.last = { at: t, ok: false, error: msg, added: 0, workouts: 0 };
    return { ok: false, error: msg, summary: summaryText() };
  }
}
export function gymImportStatus() {
  const m = mirror(), n = m.sessions.length, pending = m.sessions.filter((s) => !state.done[s.id]).length;
  return { ok: true, available, folders: candidateDirs(), last: state.last, imported: Object.keys(state.done).length, sessions: n, inNote: n - pending, pending, inSync: n > 0 && pending === 0, backup: mirrorStatus(), summary: summaryText() };
}

let timer = null;
export function startGymImport() {
  if (!available || timer) return;
  const tick = () => { try { const r = gymImportRun(); if (r.added || r.cardio) console.log(`GymMane: ${r.added || 0} lift(s) and ${r.cardio || 0} run(s) from ${r.workouts} workout(s) added to the notes.`); } catch { /* next time */ } };
  timer = setInterval(tick, CHECK_MS);
  setTimeout(tick, 5000);
  console.log('GymMane import is on (checks the backup folder every ' + CHECK_MS / 1000 + ' s).');
}
