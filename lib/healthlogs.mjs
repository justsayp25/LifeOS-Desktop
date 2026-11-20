// Health trackers: Lifts, Runs, Physical Therapy and Recovery logs under 11 Health/Tracker.
import { b64, unb64, h8, section, markerIndex, touch, vp, exists, readNote, writeNote, todayStr, isDate, HttpError } from './util.mjs';
import { overlayLifts, overlayRuns, isMirrorId } from './gymmirror.mjs';

const FILES = {
  lifts: ['Lifts', 'Lifts.md'],
  runs: ['Runs', 'Runs.md'],
  pt: ['Physical Therapy', 'Physical Therapy.md'],
  rec: ['Recovery Tracker', 'Recovery Tracker.md']
};
const noteOf = (kind) => { if (!FILES[kind]) throw new HttpError(400, 'Unknown tracker.'); const [d, f] = FILES[kind]; return vp('1 Human', '11 Health', 'Tracker', d, f); };
const TYPES = ['', 'warm-up', 'drop', 'failure']; // index = client set type (0 normal)
const num = (v) => { const n = parseFloat(String(v == null ? '' : v).replace(',', '.')); return isNaN(n) ? 0 : n; };
const r2 = (n) => String(Math.round(n * 100) / 100);

const paceOf = (km, min) => { if (!km || !min) return ''; const p = min / km; let m = Math.floor(p), s = Math.round((p - m) * 60); if (s === 60) { m++; s = 0; } return `${m}:${String(s).padStart(2, '0')} /km`; };

function liftLine(x) {
  const groups = [];
  for (const st of x.sets) {
    const t = Math.max(0, Math.min(3, Number(st.t) || 0));
    const key = t + '|' + r2(num(st.w)) + '|' + r2(num(st.r));
    const g = groups[groups.length - 1];
    if (g && g.key === key) g.n++; else groups.push({ key, n: 1, t, w: r2(num(st.w)), r: r2(num(st.r)) });
  }
  return `- ${String(x.name).replace(/\r?\n+/g, ' ').replace(/--/g, '-').trim()} -- ` + groups.map((g) => `${g.n}x${g.r} @ ${g.w}${g.t ? ` (${TYPES[g.t]})` : ''}`).join(', ');
}
function parseLift(rest) {
  const m = rest.match(/^(.+?)\s+--\s+(.+)$/);
  if (!m) return null;
  const sets = [];
  for (const part of m[2].split(/,\s*(?=\d+x)/)) {
    const g = part.trim().match(/^(\d+)x(\d+(?:\.\d+)?)\s*@\s*(\d+(?:\.\d+)?)(?:\s*\((warm-up|drop|failure)\))?$/i);
    if (!g) return null;
    const t = Math.max(0, TYPES.indexOf((g[4] || '').toLowerCase()));
    for (let k = 0; k < Number(g[1]); k++) sets.push({ t, w: g[3] === '0' ? '' : g[3], r: g[2] });
  }
  return sets.length ? { name: m[1].trim(), sets } : null;
}

function read(kind) {
  const abs = noteOf(kind);
  if (!exists(abs)) return [];
  const lines = readNote(abs).text.split('\n');
  const sec = section(lines, /^##\s+Log\b/i);
  const out = [];
  if (!sec) return out;
  let day = '';
  for (let i = sec[0] + 1; i < sec[1]; i++) {
    const l = lines[i];
    const id = b64(kind) + '.' + h8(l) + '.' + i;
    if (kind === 'lifts') {
      const hm = l.match(/^###\s+(\d{4}-\d{2}-\d{2})\s*$/); if (hm) { day = hm[1]; continue; }
      const bm = l.match(/^\s*-\s+(.*)$/);
      if (day && bm) { const p = parseLift(bm[1]); if (p) out.push({ id, date: day, name: p.name, sets: p.sets }); }
      continue;
    }
    const bm = l.match(/^\s*-\s+(\d{4}-\d{2}-\d{2})(?:\s+\d{1,2}:\d{2})?\s+--\s*(.*)$/);
    if (!bm || !bm[2].trim()) continue;
    const date = bm[1], rest = bm[2].trim();
    if (kind === 'runs') {
      const d = rest.match(/distance:\s*([\d.]+)/i), t = rest.match(/time:\s*([\d.]+)/i);
      if (d) out.push({ id, date, dist: Number(d[1]), time: t ? Number(t[1]) : 0 });
    } else if (kind === 'pt') {
      out.push({ id, date, text: rest });
    } else {
      const f = rest.match(/feeling:\s*(.*?)(?:,\s*notes:\s*(.*))?$/i);
      if (f && f[1].trim()) out.push({ id, date, feeling: f[1].trim(), notes: (f[2] || '').trim() });
    }
  }
  return out;
}
// Extra sections live in the same notes, above the hub.py marker:
//   Lifts: ## Routines  (- Push day -- Bench Press x3, Squat x3 | days: Mon, Thu)
//          ## Exercises (- Cable Fly -- muscle: Chest, equipment: Cable)
//          ## Measurements (- 2026-10-31 -- waist: 80)
//   Runs:  ## Sprints   (- 2026-10-31 -- 100 m x 4: 13.2, 13.0, 12.9, 13.4 s)
const clean1 = (x) => String(x || '').replace(/\r?\n+/g, ' ').replace(/--/g, '-').replace(/,/g, ' ').replace(/\|/g, ' ').replace(/\s+/g, ' ').trim();
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
function extraLines(kind, title) {
  const abs = noteOf(kind);
  if (!exists(abs)) return [];
  const lines = readNote(abs).text.split('\n');
  const sec = section(lines, new RegExp('^##\\s+' + title + '\\b', 'i'));
  const out = [];
  if (!sec) return out;
  for (let i = sec[0] + 1; i < sec[1]; i++) { const m = lines[i].match(/^\s*-\s+(.+)$/); if (m) out.push({ text: m[1], id: b64(kind) + '.' + h8(lines[i]) + '.' + i }); }
  return out;
}
function putExtra(kind, title, line) {
  const abs = noteOf(kind);
  const { text, eol } = readNote(abs);
  const lines = text.split('\n');
  let sec = section(lines, new RegExp('^##\\s+' + title + '\\b', 'i'));
  if (!sec) {
    const lim = markerIndex(lines);
    const pre = lim > 0 && lines[lim - 1].trim() !== '' ? [''] : [];
    lines.splice(lim, 0, ...pre, '## ' + title, '', line, '');
  } else {
    let at = sec[0] + 1;
    for (let i = sec[0] + 1; i < sec[1]; i++) if (/^\s*-\s/.test(lines[i])) at = i + 1;
    lines.splice(at, 0, line);
  }
  writeNote(abs, touch(lines.join('\n')), eol);
  return { ok: true };
}
function readRoutines() {
  return extraLines('lifts', 'Routines').map((r) => {
    const m = r.text.match(/^(.+?)\s+--\s+(.+?)(?:\s+\|\s+days:\s*(.+))?$/);
    if (!m) return null;
    const ex = m[2].split(/,\s*/).map((x) => x.trim().match(/^(.+?)\s+x(\d+)$/)).filter(Boolean).map((g) => ({ name: g[1].trim(), n: Math.max(1, Math.min(20, Number(g[2]))) }));
    const days = (m[3] || '').split(/,\s*/).map((d) => d.trim()).filter((d) => DAYS.includes(d));
    return ex.length ? { id: r.id, name: m[1].trim(), ex, days } : null;
  }).filter(Boolean);
}
function readExercises() {
  return extraLines('lifts', 'Exercises').map((r) => {
    const m = r.text.match(/^(.+?)\s+--\s+muscle:\s*([^,]+),\s*equipment:\s*(.+)$/);
    return m ? { id: r.id, name: m[1].trim(), muscle: m[2].trim(), equip: m[3].trim() } : null;
  }).filter(Boolean);
}
function readMeasures() {
  return extraLines('lifts', 'Measurements').map((r) => {
    const m = r.text.match(/^(\d{4}-\d{2}-\d{2})\s+--\s+(.+)$/);
    if (!m) return null;
    const values = {};
    m[2].split(/,\s*/).forEach((kv) => { const g = kv.match(/^([A-Za-z][A-Za-z ]*?):\s*([\d.]+)$/); if (g) values[g[1].trim().toLowerCase()] = Number(g[2]); });
    return Object.keys(values).length ? { id: r.id, date: m[1], values } : null;
  }).filter(Boolean);
}
function readSprints() {
  return extraLines('runs', 'Sprints').map((r) => {
    const m = r.text.match(/^(\d{4}-\d{2}-\d{2})\s+--\s+(\d+(?:\.\d+)?)\s*m\s+x\s*\d+:\s*([\d.,\s]+?)\s*s\s*$/);
    if (!m) return null;
    const times = m[3].split(/,\s*/).map(Number).filter((n) => n > 0);
    return times.length ? { id: r.id, date: m[1], dist: Number(m[2]), times } : null;
  }).filter(Boolean);
}
// the notes as they are on disk (without GymMane layered on top): the GymMane import compares with these
export const readVaultLifts = () => read('lifts');
export const readVaultRuns = () => read('runs');
export const readVaultSprints = () => readSprints();
export function listHealth() {
  // GymMane's own data is layered on top of the notes (see lib/gymmirror.mjs); the notes on disk are not changed by this
  const o = overlayRuns(read('runs'), readSprints());
  return { lifts: overlayLifts(read('lifts')), runs: o.runs, pt: read('pt'), rec: read('rec'), routines: readRoutines(), exercises: readExercises(), measures: readMeasures(), sprints: o.sprints };
}
function addExtra(kind, b) {
  if (b.routine) {
    const r = b.routine;
    const name = clean1(r.name);
    const ex = (Array.isArray(r.ex) ? r.ex : []).map((e) => ({ name: clean1(e && e.name), n: Math.max(1, Math.min(20, Math.round(Number(e && e.n) || 1))) })).filter((e) => e.name);
    if (!name || !ex.length) throw new HttpError(400, 'A routine needs a name and at least one exercise.');
    const days = (Array.isArray(r.days) ? r.days : []).filter((d) => DAYS.includes(d));
    return putExtra('lifts', 'Routines', `- ${name} -- ` + ex.map((e) => `${e.name} x${e.n}`).join(', ') + (days.length ? ` | days: ${days.join(', ')}` : ''));
  }
  if (b.exercise) {
    const e = b.exercise;
    const name = clean1(e.name), muscle = clean1(e.muscle) || 'Other', equip = clean1(e.equip) || 'Other';
    if (!name) throw new HttpError(400, 'Name the exercise.');
    return putExtra('lifts', 'Exercises', `- ${name} -- muscle: ${muscle}, equipment: ${equip}`);
  }
  if (b.measure) {
    const date = isDate(b.measure.date) ? b.measure.date : todayStr();
    const vals = Object.entries(b.measure.values || {}).map(([k, v]) => [clean1(k).toLowerCase().replace(/:/g, ''), num(v)]).filter(([k, v]) => k && v > 0);
    if (!vals.length) throw new HttpError(400, 'Enter a value.');
    return putExtra('lifts', 'Measurements', `- ${date} -- ` + vals.map(([k, v]) => `${k}: ${r2(v)}`).join(', '));
  }
  if (b.sprint) {
    const sp = b.sprint;
    const date = isDate(sp.date) ? sp.date : todayStr();
    const dist = num(sp.dist);
    const times = (Array.isArray(sp.times) ? sp.times : []).map(num).filter((n) => n > 0);
    if (!(dist > 0) || !times.length) throw new HttpError(400, 'Add a distance and at least one time.');
    return putExtra('runs', 'Sprints', `- ${date} -- ${r2(dist)} m x ${times.length}: ${times.map(r2).join(', ')} s`);
  }
  return null;
}

export function addHealth(kind, b) {
  const abs = noteOf(kind);
  if (!exists(abs)) throw new HttpError(404, 'That tracker note is missing.');
  if (b && (kind === 'lifts' || kind === 'runs')) { const x = addExtra(kind, b); if (x) return x; }
  const date = isDate(b.date) ? b.date : todayStr();
  const one = (s) => String(s || '').replace(/\r?\n+/g, ' ').trim();
  const { text, eol } = readNote(abs);
  const lines = text.split('\n');
  let sec = section(lines, /^##\s+Log\b/i);
  if (!sec) { const lim = markerIndex(lines); lines.splice(lim, 0, '## Log', '', ''); sec = section(lines, /^##\s+Log\b/i); }
  const lastBullet = () => { let at = sec[0] + 1; for (let i = sec[0] + 1; i < sec[1]; i++) if (/^\s*-\s/.test(lines[i])) at = i + 1; return at; };
  if (kind === 'lifts') {
    const sets = (b.sets || []).filter((s) => num(s.w) > 0 || num(s.r) > 0);
    if (!one(b.name) || !sets.length) throw new HttpError(400, 'Add an exercise and at least one set.');
    const line = liftLine({ name: b.name, sets });
    const hi = lines.findIndex((l, i) => i > sec[0] && i < sec[1] && l.trim() === '### ' + date);
    if (hi >= 0) { let at = hi + 1; for (let i = hi + 1; i < sec[1] && !/^###\s/.test(lines[i]); i++) if (/^\s*-\s/.test(lines[i])) at = i + 1; lines.splice(at, 0, line); }
    else { let at = sec[1]; while (at > sec[0] + 1 && /^\s*$/.test(lines[at - 1])) at--; lines.splice(at, 0, '', '### ' + date, line); }
  } else {
    let line;
    if (kind === 'runs') { const d = num(b.dist), t = num(b.time); if (!(d > 0)) throw new HttpError(400, 'Enter a distance.'); line = `- ${date} -- distance: ${r2(d)} km${t ? `, time: ${r2(t)} min, speed/pace: ${paceOf(d, t)}` : ''}`; }
    else if (kind === 'pt') { line = `- ${date} -- ${one(b.text) || 'Done'}`; }
    else { if (!one(b.feeling)) throw new HttpError(400, 'Add a feeling.'); line = `- ${date} -- feeling: ${one(b.feeling).replace(/,/g, ' ')}, notes: ${one(b.notes)}`; }
    lines.splice(lastBullet(), 0, line);
  }
  writeNote(abs, touch(lines.join('\n')), eol);
  return { ok: true };
}
export function removeHealth(kind, id) {
  if (isMirrorId(id)) throw new HttpError(409, 'That entry comes from GymMane. Change or delete it in GymMane.');
  const abs = noteOf(kind);
  const m = String(id).match(/^([\w-]+)\.([0-9a-f]{8})\.(\d+)$/);
  if (!m || unb64(m[1]) !== kind) throw new HttpError(400, 'Bad id.');
  const { text, eol } = readNote(abs);
  const lines = text.split('\n');
  let idx = Number(m[3]);
  if (!(lines[idx] !== undefined && h8(lines[idx]) === m[2])) idx = lines.findIndex((l) => h8(l) === m[2]);
  if (idx < 0) throw new HttpError(409, 'That entry changed in the vault. Refreshing.');
  lines.splice(idx, 1);
  // a lift date heading left with nothing under it goes too
  if (kind === 'lifts') {
    const hi = (() => { for (let i = idx - 1; i >= 0; i--) if (/^###\s/.test(lines[i])) return i; else if (/^##\s/.test(lines[i])) return -1; return -1; })();
    if (hi >= 0) { let empty = true; for (let i = hi + 1; i < lines.length && !/^#{2,3}\s/.test(lines[i]) && !lines[i].startsWith('<!--'); i++) if (/^\s*-\s/.test(lines[i])) empty = false; if (empty) lines.splice(hi, 1); }
  }
  writeNote(abs, touch(lines.join('\n')), eol);
  return { ok: true };
}
