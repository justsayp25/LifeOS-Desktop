// Spiritual tracker. Practices come from where they already live:
//   Prayer and Meditation = the daily notes' ## Habits checkboxes (the Home habit tracker writes them; nothing is copied).
//   Scripture = one line per finished chapter in 1 Human/06 Spiritual/Tracker/Reading/Reading.md
//     ## Plan   - book: John, chapters: 21
//     ## Log    - 2026-11-22 -- chapter: John 7
//   To memorize = 1 Human/06 Spiritual/Tracker/Memorize/Memorize.md, ## Verses   - 2026-11-22 -- John 15:5 -- the verse text (the newest line is the current one)
import { b64, unb64, h8, section, markerIndex, touch, vp, exists, readNote, writeNote, todayStr, isDate, HttpError } from './util.mjs';
import { addDays } from './vault.mjs';
import { getHabits } from './habits.mjs';

const readingNote = () => vp('1 Human', '06 Spiritual', 'Tracker', 'Reading', 'Reading.md');
const memoNote = () => vp('1 Human', '06 Spiritual', 'Tracker', 'Memorize', 'Memorize.md');
const CHAP = /^\s*-\s+(\d{4}-\d{2}-\d{2})\s+--\s+chapter:\s*(.+?)\s+(\d{1,3})\s*$/i;
const PLAN = /^\s*-\s+book:\s*(.+?)\s*,\s*chapters:\s*(\d{1,3})\s*$/i;
const VERSE = /^\s*-\s+(\d{4}-\d{2}-\d{2})\s+--\s+(.+?)\s+--\s+(.+?)\s*$/;
const one = (s) => String(s || '').replace(/[\r\n\[\]]+/g, ' ').replace(/\s+/g, ' ').trim();

function lines(abs) { return exists(abs) ? readNote(abs).text.split('\n') : []; }
function readPlan() {
  const l = lines(readingNote()); const sec = section(l, /^##\s+Plan\b/i);
  if (sec) for (let i = sec[0] + 1; i < sec[1]; i++) { const m = l[i].match(PLAN); if (m) return { book: m[1], chapters: Number(m[2]) }; }
  return null;
}
function readChapters() {
  const l = lines(readingNote()); const sec = section(l, /^##\s+Log\b/i); const out = [];
  if (sec) for (let i = sec[0] + 1; i < sec[1]; i++) { const m = l[i].match(CHAP); if (m) out.push({ id: b64('sr') + '.' + h8(l[i]) + '.' + i, date: m[1], book: m[2], chapter: Number(m[3]) }); }
  return out;
}
function readVerse() {
  const l = lines(memoNote()); const sec = section(l, /^##\s+Verses\b/i); let best = null;
  if (sec) for (let i = sec[0] + 1; i < sec[1]; i++) { const m = l[i].match(VERSE); if (m && (!best || m[1] >= best.date)) best = { date: m[1], ref: m[2], text: m[3] }; }
  return best;
}
export function getSpiritual(days = 28, today = todayStr()) {
  days = Math.max(7, Math.min(120, Math.floor(Number(days) || 28)));
  const from = addDays(today, -(days - 1));
  const hab = getHabits(from, today).days;
  const ch = readChapters();
  const plan = readPlan();
  const scr = new Set(ch.map((c) => c.date));
  const list = [];
  for (let i = 0; i < days; i++) {
    const date = addDays(from, i), h = hab[date] || {};
    const prayer = !!h.Prayer, meditation = !!h.Meditation, scripture = scr.has(date);
    list.push({ date, prayer, meditation, scripture, on: prayer || meditation || scripture });
  }
  let streak = 0; for (let i = list.length - 1; i >= 0; i--) { if (list[i].on) streak++; else if (i === list.length - 1) continue; else break; }
  let best = 0, run = 0; for (const d of list) { run = d.on ? run + 1 : 0; if (run > best) best = run; }
  const done = plan ? new Set(ch.filter((c) => c.book.toLowerCase() === plan.book.toLowerCase()).map((c) => c.chapter)) : new Set();
  const last = done.size ? Math.max(...done) : 0;
  return { days: list, streak, best, month: list.filter((d) => d.on).length, week: list.slice(-7).filter((d) => d.on).length,
    reading: plan ? { book: plan.book, chapters: plan.chapters, done: done.size, last, next: Math.min(plan.chapters, last + 1) } : null,
    memorize: readVerse() };
}
function appendTo(abs, secRe, secName, line) {
  if (!exists(abs)) throw new HttpError(404, 'The Spiritual tracker note is missing.');
  const { text, eol } = readNote(abs); const l = text.split('\n');
  let sec = section(l, secRe);
  if (!sec) { const lim = markerIndex(l); l.splice(lim, 0, '## ' + secName, '', ''); sec = section(l, secRe); }
  let at = sec[0] + 1; for (let i = sec[0] + 1; i < sec[1]; i++) if (/^\s*-\s/.test(l[i])) at = i + 1;
  l.splice(at, 0, line); writeNote(abs, touch(l.join('\n')), eol);
  return { ok: true, id: b64('sr') + '.' + h8(line) + '.' + at };
}
export function addChapter(b = {}) {
  const plan = readPlan(); if (!plan) throw new HttpError(400, 'Set a reading plan first.');
  const date = isDate(b.date) ? b.date : todayStr();
  const sp = getSpiritual(28).reading;
  const n = Number.isInteger(b.chapter) ? b.chapter : sp.next;
  if (!(n >= 1 && n <= plan.chapters)) throw new HttpError(400, 'That chapter is outside the plan.');
  return appendTo(readingNote(), /^##\s+Log\b/i, 'Log', `- ${date} -- chapter: ${plan.book} ${n}`);
}
export function removeChapter(id) {
  const m = String(id).match(/^([\w-]+)\.([0-9a-f]{8})\.(\d+)$/); if (!m || unb64(m[1]) !== 'sr') throw new HttpError(400, 'Bad id.');
  const abs = readingNote(); const { text, eol } = readNote(abs); const l = text.split('\n');
  let idx = Number(m[3]); if (!(l[idx] && h8(l[idx]) === m[2] && CHAP.test(l[idx]))) idx = l.findIndex((x) => CHAP.test(x) && h8(x) === m[2]);
  if (idx < 0) throw new HttpError(409, 'That entry changed in the vault. Refreshing.');
  l.splice(idx, 1); writeNote(abs, touch(l.join('\n')), eol); return { ok: true };
}
export function setPlan(b = {}) {
  const book = one(b.book).slice(0, 40), n = Math.round(Number(b.chapters));
  if (!book) throw new HttpError(400, 'Enter a book.'); if (!(n >= 1 && n <= 150)) throw new HttpError(400, 'Chapters is 1 to 150.');
  const abs = readingNote(); if (!exists(abs)) throw new HttpError(404, 'The Spiritual tracker note is missing.');
  const { text, eol } = readNote(abs); const l = text.split('\n');
  let sec = section(l, /^##\s+Plan\b/i);
  const line = `- book: ${book}, chapters: ${n}`;
  if (!sec) { const lim = Math.max(0, l.findIndex((x) => /^##\s+Log\b/i.test(x))); l.splice(lim < 0 ? markerIndex(l) : lim, 0, '## Plan', '', line, ''); }
  else { const at = (() => { for (let i = sec[0] + 1; i < sec[1]; i++) if (PLAN.test(l[i])) return i; return -1; })(); if (at >= 0) l[at] = line; else l.splice(sec[0] + 1, 0, '', line); }
  writeNote(abs, touch(l.join('\n')), eol); return { ok: true };
}
export function addVerse(b = {}) {
  const ref = one(b.ref).slice(0, 40), txt = one(b.text).replace(/\s+--\s+/g, ' - ').slice(0, 600);
  if (!ref || !txt) throw new HttpError(400, 'Enter the reference and the verse.');
  return appendTo(memoNote(), /^##\s+Verses\b/i, 'Verses', `- ${isDate(b.date) ? b.date : todayStr()} -- ${ref} -- ${txt}`);
}
