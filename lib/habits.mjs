import fs from 'node:fs';
import { vp, exists, readNote, writeNote, todayStr, isDate, addDays, fillTemplate, setFrontmatter, findSection, HttpError } from './vault.mjs';

const HABITS = ['Meditation', 'Prayer', 'Training', 'Studying', 'Reading'];
const dailyPath = (date) => vp('1 Human', '02 Daily', date.slice(0, 7), date + '.md');
const LINE = /^\s*- \[( |x|X)\]\s+(.+?)\s*$/;

function parseHabits(text) {
  const lines = text.split('\n');
  const sec = findSection(lines, (l) => /^##\s+Habits\s*$/i.test(l));
  const out = {};
  if (!sec) return out;
  for (let i = sec[0] + 1; i < sec[1]; i++) { const m = lines[i].match(LINE); if (m) out[m[2]] = m[1] !== ' '; }
  return out;
}

export function getHabits(from, to) {
  if (!isDate(from) || !isDate(to) || from > to) throw new HttpError(400, 'Use from and to as YYYY-MM-DD.');
  const days = {}; const withNote = [];
  let d = from, n = 0;
  while (d <= to && n++ < 800) {
    const p = dailyPath(d);
    if (exists(p)) { withNote.push(d); days[d] = parseHabits(readNote(p).text); }
    d = addDays(d, 1);
  }
  return { habits: HABITS, days, notes: withNote };
}

function ensureDaily(date) {
  const p = dailyPath(date);
  if (exists(p)) return p;
  const tpl = vp('2 Machine', '01 Templates', 'Daily.md');
  if (!exists(tpl)) throw new HttpError(500, 'The Daily template is missing.');
  const { text, eol } = readNote(tpl);
  writeNote(p, fillTemplate(text, { date, title: date }), eol);
  return p;
}

export function setHabit({ date, habit, done }) {
  if (!isDate(date)) throw new HttpError(400, 'Bad date.');
  if (date > todayStr()) throw new HttpError(400, 'Habits can only be ticked for today or earlier.');
  if (typeof habit !== 'string' || !HABITS.includes(habit)) throw new HttpError(400, 'Unknown habit.');
  const p = ensureDaily(date);
  const { text, eol } = readNote(p);
  const lines = text.split('\n');
  let sec = findSection(lines, (l) => /^##\s+Habits\s*$/i.test(l));
  const mark = done ? 'x' : ' ';
  if (!sec) {
    // add the section before Captures, otherwise at the end
    const cap = lines.findIndex((l) => /^##\s+Captures/i.test(l));
    const block = ['## Habits', ...HABITS.map((h) => `- [ ] ${h}`), ''];
    if (cap >= 0) lines.splice(cap, 0, ...block); else lines.push('', ...block);
    sec = findSection(lines, (l) => /^##\s+Habits\s*$/i.test(l));
  }
  let found = false, last = sec[0];
  for (let i = sec[0] + 1; i < sec[1]; i++) {
    const m = lines[i].match(LINE);
    if (m) { last = i; if (m[2] === habit) { lines[i] = lines[i].replace(/\[( |x|X)\]/, `[${mark}]`); found = true; } }
  }
  if (!found) lines.splice(last + 1, 0, `- [${mark}] ${habit}`);
  let out = lines.join('\n');
  out = setFrontmatter(out, 'updated', todayStr());
  writeNote(p, out, eol);
  return { ok: true, date, habit, done: !!done };
}
