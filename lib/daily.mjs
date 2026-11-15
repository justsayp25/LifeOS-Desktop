// Daily note text (Focus, Captures, Reflections) and appointments.
import { b64, unb64, h8, section, markerIndex, walkMd, touch, vp, exists, readNote, writeNote, todayStr, isDate, ensureDaily, dailyPath, HttpError } from './util.mjs';
import { addDays } from './vault.mjs';

const PLACE = {
  Focus: ['What matters most today?'],
  Captures: ['Anything I mentioned today that might deserve a note. Reviewed at close of day.', 'Anything I mentioned today that might deserve a note.'],
  Reflections: ['Reflection']
};
const HEAD = { focus: 'Focus', captures: 'Captures', reflections: 'Reflections' };

function bodyOf(lines, sec, name) {
  const out = [];
  for (let i = sec[0] + 1; i < sec[1]; i++) {
    const t = lines[i].replace(/^>\s?/, '');
    if (/^>/.test(lines[i]) && PLACE[name].includes(t.trim())) continue;
    out.push(lines[i].replace(/^>\s?/, ''));
  }
  return out.join('\n').replace(/^\n+|\n+$/g, '');
}
function read(date) {
  const p = dailyPath(date);
  if (!exists(p)) return { exists: false, focus: '', captures: '', reflections: '' };
  const lines = readNote(p).text.split('\n');
  const o = { exists: true };
  for (const k of Object.keys(HEAD)) {
    const sec = section(lines, new RegExp('^##\\s+' + HEAD[k] + '\\b', 'i'));
    o[k] = sec ? bodyOf(lines, sec, HEAD[k]) : '';
  }
  return o;
}
export function getDaily(date) {
  if (!isDate(date)) throw new HttpError(400, 'Bad date.');
  return read(date);
}
export function setDaily({ date, field, text, base }) {
  if (!isDate(date)) throw new HttpError(400, 'Bad date.');
  if (!HEAD[field]) throw new HttpError(400, 'Unknown field.');
  if (date > todayStr()) throw new HttpError(400, 'Only today or earlier.');
  text = String(text || '').replace(/\r\n/g, '\n').replace(/^\n+|\n+$/g, '');
  const cur = read(date);
  if (typeof base === 'string' && cur[field] !== base.replace(/^\n+|\n+$/g, '') && cur[field] !== text) throw new HttpError(409, 'That section changed in the vault. Refreshing.', { current: cur[field] });
  if (!cur.exists && !text) return { ok: true };
  const p = ensureDaily(date);
  const { text: raw, eol } = readNote(p);
  const lines = raw.split('\n');
  let sec = section(lines, new RegExp('^##\\s+' + HEAD[field] + '\\b', 'i'));
  if (!sec) { const cap = lines.findIndex((l) => /^##\s+Reflections/i.test(l)); const at = cap >= 0 ? cap : markerIndex(lines); lines.splice(at, 0, '## ' + HEAD[field], ''); sec = section(lines, new RegExp('^##\\s+' + HEAD[field] + '\\b', 'i')); }
  const body = text ? text.split('\n') : ['> ' + PLACE[HEAD[field]][0]];
  lines.splice(sec[0] + 1, sec[1] - sec[0] - 1, ...body, '');
  writeNote(p, touch(lines.join('\n')), eol);
  return { ok: true };
}

// ---- appointments: "- 17:00-18:30 Title" / "- All day Title" / "- 17:00 Title" under ## Appointments in the day's note ----
const APPT = /^\s*-\s+(?:(All day)|(\d{1,2}:\d{2})(?:\s*[-–]\s*(\d{1,2}:\d{2}))?)\s+(.+?)\s*$/;
const t5 = (s) => (s ? s.padStart(5, '0') : '');
export function listEvents(from, to) {
  if (!isDate(from) || !isDate(to) || from > to) throw new HttpError(400, 'Use from and to as YYYY-MM-DD.');
  const events = [];
  let d = from, n = 0;
  while (d <= to && n++ < 800) {
    const p = dailyPath(d);
    if (exists(p)) {
      const lines = readNote(p).text.split('\n');
      const sec = section(lines, /^##\s+Appointments\b/i);
      if (sec) for (let i = sec[0] + 1; i < sec[1]; i++) {
        const m = lines[i].match(APPT);
        if (m) events.push({ id: b64(d) + '.' + h8(lines[i]), date: d, title: m[4], allDay: !!m[1], start: m[1] ? '' : t5(m[2]), end: m[1] ? '' : t5(m[3]) });
      }
    }
    d = addDays(d, 1);
  }
  return { events };
}
export function createEvent(b) {
  const title = String(b.title || '').replace(/\r?\n+/g, ' ').trim();
  if (!title) throw new HttpError(400, 'Give the event a title.');
  if (!isDate(b.date)) throw new HttpError(400, 'Pick a date.');
  const ok = (s) => /^\d{1,2}:\d{2}$/.test(String(s || '').trim());
  let line;
  if (b.allDay) line = `- All day ${title}`;
  else if (ok(b.start)) line = `- ${t5(b.start.trim())}${ok(b.end) ? '-' + t5(b.end.trim()) : ''} ${title}`;
  else line = `- All day ${title}`;
  const p = ensureDaily(b.date);
  const { text, eol } = readNote(p);
  const lines = text.split('\n');
  let sec = section(lines, /^##\s+Appointments\b/i);
  if (!sec) {
    let at = lines.findIndex((l) => /^##\s+Habits\b/i.test(l));
    if (at < 0) at = lines.findIndex((l) => /^##\s+Captures\b/i.test(l));
    if (at < 0) at = markerIndex(lines);
    lines.splice(at, 0, '## Appointments', '', '');
    sec = section(lines, /^##\s+Appointments\b/i);
  }
  let at = sec[0] + 1;
  for (let i = sec[0] + 1; i < sec[1]; i++) if (APPT.test(lines[i])) at = i + 1;
  if (at === sec[0] + 1 && /^\s*$/.test(lines[at] || '')) at = sec[0] + 1;
  lines.splice(at, 0, line);
  writeNote(p, touch(lines.join('\n')), eol);
  return { ok: true, id: b64(b.date) + '.' + h8(line) };
}
export function deleteEvent(id) {
  const m = String(id).match(/^([\w-]+)\.([0-9a-f]{8})$/);
  if (!m) throw new HttpError(400, 'Bad event id.');
  const date = unb64(m[1]);
  if (!isDate(date)) throw new HttpError(400, 'Bad event id.');
  const p = dailyPath(date);
  if (!exists(p)) throw new HttpError(409, 'That event is already gone.');
  const { text, eol } = readNote(p);
  const lines = text.split('\n');
  const sec = section(lines, /^##\s+Appointments\b/i);
  const idx = sec ? lines.findIndex((l, i) => i > sec[0] && i < sec[1] && h8(l) === m[2]) : -1;
  if (idx < 0) throw new HttpError(409, 'That event changed in the vault. Refreshing.');
  lines.splice(idx, 1);
  writeNote(p, touch(lines.join('\n')), eol);
  return { ok: true };
}
