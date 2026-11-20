// The same history the pages get from the GymMane backup (lib/gymmirror.mjs), but built from the VAULT notes alone.
// This is what a PC sees (it has no backup file): the phone writes every workout into the Lifts and Runs notes and Sync brings them over.
// What the notes hold: date, exercise, sets, reps, weight, and (since v1.9.54) a "Session" line with the length and start time.
// What they do not hold: the muscle of an exercise (looked up here by name in public/gym/exercises.json, then by a few keywords) and
// anything changed or deleted in GymMane after it was written. Nothing here writes to the vault.
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './vault.mjs';
import { readVaultLifts, readVaultRuns, readVaultSprints, readVaultSessions } from './healthlogs.mjs';
import { normalize, historyFrom } from './gymmirror.mjs';

let table = null;
const norm = (s) => String(s || '').toLowerCase().replace(/\(.*?\)/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim();
function loadTable() {
  if (table) return table;
  table = new Map();
  try {
    const j = JSON.parse(fs.readFileSync(path.join(ROOT, 'public', 'gym', 'exercises.json'), 'utf8'));
    for (const e of j) if (e && e.name && e.p) table.set(norm(e.name), String(e.p));
  } catch { /* keywords only */ }
  return table;
}
const KEYS = [
  [/bench|chest|fly|pec|push up|pushup|dip/, 'chest'], [/shoulder|overhead|lateral raise|front raise|arnold|military|face pull|rear delt/, 'shoulders'],
  [/curl/, 'biceps'], [/tricep|skull|pushdown|extension.*(cable|rope)|close grip/, 'triceps'], [/forearm|wrist/, 'forearm'],
  [/row|pulldown|pull down|pull up|pullup|chin up|lat |back/, 'back'], [/shrug|trap/, 'trapezius'], [/deadlift|good morning|hyperextension|back extension/, 'lowerback'],
  [/squat|leg press|lunge|leg extension|hack|step up|split squat/, 'quads'], [/hamstring|leg curl|romanian|stiff leg|straight leg/, 'hamstrings'], [/glute|hip thrust|bridge|kickback/, 'glutes'],
  [/calf|calves/, 'calves'], [/crunch|sit up|situp|plank|leg raise|ab |abs|core|wheel/, 'abdomen'], [/oblique|twist|woodchop|landmine 180/, 'obliques']
];
// where GymMane's own choice differs from the exercise library, follow GymMane (so the PC matches the phone)
const FIRST = [[/romanian|stiff leg|straight leg deadlift/, 'hamstrings'], [/zercher/, 'quads']];
export function muscleOf(name) {
  const t = loadTable(), n = norm(name);
  for (const [re, m] of FIRST) if (re.test(n)) return m;
  if (t.has(n)) return t.get(n);
  for (const [re, m] of KEYS) if (re.test(n)) return m;
  return 'other';
}

// build what normalize() reads (the GymMane backup's own shape) from the notes
export function vaultSessionsJson() {
  const byDay = new Map(); // date -> { ex: Map(name -> sets), min, time }
  const day = (d) => { let x = byDay.get(d); if (!x) { x = { ex: new Map(), min: 0, time: '' }; byDay.set(d, x); } return x; };
  for (const l of readVaultLifts()) {
    const x = day(l.date), arr = x.ex.get(l.name) || [];
    for (const st of l.sets) arr.push({ w: Number(st.w) || 0, r: Number(st.r) || 0 });
    x.ex.set(l.name, arr);
  }
  for (const s of readVaultSessions()) { const x = day(s.date); x.min += s.min; if (!x.time || (s.time && s.time < x.time)) x.time = s.time || x.time; }
  const sessions = [];
  for (const [date, x] of byDay) {
    const ex = [...x.ex.entries()].map(([n, s]) => ({ n, p: muscleOf(n), s }));
    if (ex.length) sessions.push({ d: date + (x.time ? 'T' + x.time : ''), dur: x.min * 60, ex });
  }
  // runs and sprints become their own sessions (cardio sets), so the pages count them like GymMane's
  // (a fake minute keeps their ids apart; vaultHistory() clears the time of day again)
  let k = 0;
  const fake = (date) => date + 'T00:' + String(Math.min(59, ++k)).padStart(2, '0');
  for (const r of readVaultRuns()) sessions.push({ d: fake(r.date), dur: (r.time || 0) * 60, ex: [{ n: 'Running', p: '', s: [{ km: r.dist, t: (r.time || 0) * 60 }] }] });
  for (const r of readVaultSprints()) sessions.push({ d: fake(r.date), dur: 0, ex: [{ n: 'Sprint', p: '', s: r.times.map((t) => ({ km: r.dist / 1000, t })) }] });
  return { sessions };
}
export function vaultHistory(limit = 400) {
  const sessions = normalize(vaultSessionsJson());
  // cardio-only sessions have no real time of day (their minute above is only an id)
  for (const s of sessions) if (s.exercises.every((e) => e.cardio) && /T00:\d\d$/.test(s.id)) { s.time = ''; s.hour = null; s.title = 'Cardio'; }
  const newest = sessions.length ? sessions[sessions.length - 1].date : null;
  const status = { ok: true, on: true, file: null, backupAt: null, ageMin: null, sessions: sessions.length, fromCopy: false, fromVault: true, error: '' };
  return { ...historyFrom(sessions, limit), status, count: sessions.length, newest };
}
