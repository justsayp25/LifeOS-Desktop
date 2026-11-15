// Samsung Health numbers sent from the phone: one line per day in 11 Health/Tracker/Samsung Health/Samsung Health.md.
// Line shape: "- 2026-11-12 -- steps: 8421, sleep: 7h 20m, resting hr: 62". The note must already exist; this never creates folders.
import { section, markerIndex, touch, vp, exists, readNote, writeNote, todayStr, isDate, HttpError } from './util.mjs';

const note = () => vp('1 Human', '11 Health', 'Tracker', 'Samsung Health', 'Samsung Health.md');
const LINE = /^\s*-\s+(\d{4}-\d{2}-\d{2})\s+--\s*(.*)$/;
const intIn = (v, lo, hi, what) => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < lo || n > hi) throw new HttpError(400, `${what} looks wrong.`);
  return Math.round(n);
};
const sleepText = (min) => (min === null ? '' : `${Math.floor(min / 60)}h ${String(min % 60).padStart(2, '0')}m`);
const sleepMin = (t) => { const m = String(t || '').match(/^(\d+)h\s*(\d+)m$/); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };

function parseRest(rest) {
  const g = (k) => { const m = rest.match(new RegExp(k + ':\\s*([^,]*)')); return m ? m[1].trim() : ''; };
  const steps = g('steps'), hr = g('resting hr');
  return { steps: /^\d+$/.test(steps) ? Number(steps) : null, sleepMin: sleepMin(g('sleep')), restingHr: /^\d+$/.test(hr) ? Number(hr) : null };
}

export function phoneHealthList(days) {
  const abs = note();
  if (!exists(abs)) return { days: [] };
  const lines = readNote(abs).text.split('\n');
  const sec = section(lines, /^##\s+Log\b/i);
  const out = [];
  if (sec) for (let i = sec[0] + 1; i < sec[1]; i++) {
    const m = lines[i].match(LINE);
    if (!m) continue;
    const v = parseRest(m[2]);
    if (v.steps === null && v.sleepMin === null && v.restingHr === null) continue; // empty placeholder line
    out.push({ date: m[1], ...v });
  }
  out.sort((a, b) => (a.date < b.date ? 1 : -1));
  return { days: out.slice(0, Math.max(1, Math.min(366, Number(days) || 30))) };
}

// Save one day. Sending the same date again replaces that day's line (so a later sync can correct it).
export function phoneHealthSave(b) {
  const date = String((b && b.date) || todayStr());
  if (!isDate(date)) throw new HttpError(400, 'Bad date.');
  const steps = intIn(b && b.steps, 0, 200000, 'Steps');
  const sleep = intIn(b && b.sleepMin, 0, 1440, 'Sleep');
  const hr = intIn(b && b.restingHr, 20, 250, 'Resting heart rate');
  if (steps === null && sleep === null && hr === null) throw new HttpError(400, 'Nothing to save.');
  const abs = note();
  if (!exists(abs)) throw new HttpError(409, 'The Samsung Health note is not in the vault yet.');
  const { text, eol } = readNote(abs);
  const lines = text.split('\n');
  const sec = section(lines, /^##\s+Log\b/i);
  if (!sec) throw new HttpError(409, 'The Samsung Health note has no Log section.');
  let idx = -1;
  for (let i = sec[0] + 1; i < sec[1]; i++) { const m = lines[i].match(LINE); if (m && m[1] === date) { idx = i; break; } }
  // A later sync that has only some of the numbers (steps during the day, sleep only after you wake up) keeps what is already saved for that day.
  let st = steps, sl = sleep, hh = hr;
  if (idx >= 0) { const old = parseRest(lines[idx].match(LINE)[2]); if (st === null) st = old.steps; if (sl === null) sl = old.sleepMin; if (hh === null) hh = old.restingHr; }
  const line = `- ${date} -- steps: ${st === null ? '' : st}, sleep: ${sleepText(sl)}, resting hr: ${hh === null ? '' : hh}`;
  if (idx >= 0) lines[idx] = line;
  else {
    let at = Math.min(sec[1], markerIndex(lines));
    while (at > sec[0] + 1 && /^\s*$/.test(lines[at - 1])) at--;
    lines.splice(at, 0, line);
  }
  writeNote(abs, touch(lines.join('\n')), eol);
  return { ok: true, date };
}
