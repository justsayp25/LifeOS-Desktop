// MMA training log: one note, 1 Human/12 MMA/Tracker/Training/Training.md, entries are bullets under ## Log:
//   - 2026-11-22 -- style: Boxing, minutes: 60, intensity: 7, notes: pads and bag
// (intensity 1 to 10 and notes are optional; notes come last and may hold commas)
import { b64, unb64, h8, section, markerIndex, touch, vp, exists, readNote, writeNote, todayStr, isDate, HttpError } from './util.mjs';
import { DOMAINS } from './library.mjs';

export const STYLES = [].concat(...Object.values(DOMAINS.mma.sections), ['Sparring', 'Conditioning', 'Other']);
const noteOf = () => vp('1 Human', '12 MMA', 'Tracker', 'Training', 'Training.md');
const ENTRY = /^\s*-\s+(\d{4}-\d{2}-\d{2})\s+--\s+style:\s*([^,]+?)\s*,\s*minutes:\s*(\d+(?:\.\d+)?)\s*(?:,\s*intensity:\s*(\d+)\s*)?(?:,\s*notes:\s*(.*?)\s*)?$/i;

export function listMma() {
  const abs = noteOf();
  const out = [];
  if (exists(abs)) {
    const lines = readNote(abs).text.split('\n');
    const sec = section(lines, /^##\s+Log\b/i);
    if (sec) for (let i = sec[0] + 1; i < sec[1]; i++) {
      const m = lines[i].match(ENTRY);
      if (m) out.push({ id: b64('mma') + '.' + h8(lines[i]) + '.' + i, date: m[1], style: m[2], min: Number(m[3]), ...(m[4] ? { rpe: Number(m[4]) } : {}), ...(m[5] ? { notes: m[5] } : {}) });
    }
  }
  out.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  return { entries: out, styles: STYLES };
}
// minutes and sessions per week (Monday start), oldest first, ending with the current week
export function mmaWeeks(weeks = 12, today = todayStr()) {
  weeks = Math.max(2, Math.min(52, Math.floor(Number(weeks) || 12)));
  const mon = (ds) => { const d = new Date(ds + 'T00:00:00Z'); const k = (d.getUTCDay() + 6) % 7; d.setUTCDate(d.getUTCDate() - k); return d.toISOString().slice(0, 10); };
  const cur = mon(today), list = [];
  for (let i = weeks - 1; i >= 0; i--) { const d = new Date(cur + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() - 7 * i); list.push({ start: d.toISOString().slice(0, 10), minutes: 0, sessions: 0 }); }
  const idx = new Map(list.map((w, i) => [w.start, i]));
  for (const e of listMma().entries) { const i = idx.get(mon(e.date)); if (i != null) { list[i].minutes += e.min; list[i].sessions++; } }
  return { weeks: list };
}
export function addMma(b) {
  const abs = noteOf();
  if (!exists(abs)) throw new HttpError(404, 'The MMA training note is missing.');
  const style = STYLES.find((s) => s.toLowerCase() === String(b.style || '').toLowerCase());
  if (!style) throw new HttpError(400, 'Pick a style.');
  const min = Math.round(parseFloat(String(b.min == null ? '' : b.min).replace(',', '.')) * 10) / 10;
  if (!(min > 0 && min <= 600)) throw new HttpError(400, 'Enter the minutes.');
  const date = isDate(b.date) ? b.date : todayStr();
  let extra = '';
  if (b.rpe != null && b.rpe !== '') { const r = Math.round(Number(b.rpe)); if (!(r >= 1 && r <= 10)) throw new HttpError(400, 'Intensity is 1 to 10.'); extra += `, intensity: ${r}`; }
  const notes = String(b.notes || '').replace(/[\r\n\[\]]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120);
  if (notes) extra += `, notes: ${notes}`;
  const line = `- ${date} -- style: ${style}, minutes: ${min}${extra}`;
  const { text, eol } = readNote(abs);
  const lines = text.split('\n');
  let sec = section(lines, /^##\s+Log\b/i);
  if (!sec) { const lim = markerIndex(lines); lines.splice(lim, 0, '## Log', '', ''); sec = section(lines, /^##\s+Log\b/i); }
  let at = sec[0] + 1;
  for (let i = sec[0] + 1; i < sec[1]; i++) if (/^\s*-\s/.test(lines[i])) at = i + 1;
  lines.splice(at, 0, line);
  writeNote(abs, touch(lines.join('\n')), eol);
  return { ok: true, id: b64('mma') + '.' + h8(line) + '.' + at };
}
export function removeMma(id) {
  const m = String(id).match(/^([\w-]+)\.([0-9a-f]{8})\.(\d+)$/);
  if (!m || unb64(m[1]) !== 'mma') throw new HttpError(400, 'Bad id.');
  const abs = noteOf();
  const { text, eol } = readNote(abs);
  const lines = text.split('\n');
  let idx = Number(m[3]);
  if (!(lines[idx] && h8(lines[idx]) === m[2] && ENTRY.test(lines[idx]))) idx = lines.findIndex((l) => ENTRY.test(l) && h8(l) === m[2]);
  if (idx < 0) throw new HttpError(409, 'That entry changed in the vault. Refreshing.');
  lines.splice(idx, 1);
  writeNote(abs, touch(lines.join('\n')), eol);
  return { ok: true };
}
