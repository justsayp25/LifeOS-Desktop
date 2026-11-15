// Tasks: any checkbox line in 1 Human, with inline fields like [due:: 2026-10-26]. Habits are not tasks.
import { b64, unb64, h8, markerIndex, section, insertInSection, walkMd, touch, fs, path, vp, rel, exists, readNote, writeNote, todayStr, isDate, HttpError } from './util.mjs';
import { addDays, env } from './vault.mjs';
import { listProjects } from './projects.mjs';

// Journal and Inbox are private/read-only; Knowledge holds study checklists, not to-dos; old daily notes are history.
const SKIP_DIRS = ['1 Human/99 Bin', '1 Human/05 Journal', '1 Human/01 Inbox', '1 Human/09 Knowledge'];
const DAILY_DAYS = 7;
const CHECK = /^(\s*)- \[( |x|X)\]\s+(.*)$/;
const PLACEHOLDERS = [/^Task due: MM-DD priority/i];
const DONE_WINDOW = Math.max(1, Number(env.DONE_DAYS) || 3); // finished tasks leave the page after this many days (the line stays in its note)

function fieldsOf(raw) {
  const f = {};
  let title = raw.replace(/\s*[\[(]([A-Za-z]+)::\s*((?:\[\[[^\]]*\]\]|[^\])])*)[\])]/g, (_, k, v) => { f[k.toLowerCase()] = v.trim(); return ''; });
  let doneOn = '';
  title = title.replace(/\s*✅\s*(\d{4}-\d{2}-\d{2})/, (_, d) => { doneOn = d; return ''; });
  return { title: title.replace(/\s+/g, ' ').trim(), f, doneOn };
}
const normPri = (v) => { const s = String(v || '').toLowerCase(); return s === 'low' ? 'Low' : s === 'medium' || s === 'med' ? 'Medium' : s === 'high' ? 'High' : ''; };
const normRepeat = (v) => { const s = String(v || '').toLowerCase(); return ['daily', 'weekly', 'monthly'].includes(s) ? s : ''; };
const stripLink = (v) => String(v || '').replace(/^\[\[|\]\]$/g, '').split('|')[0].trim();

function* taskLines(abs, relPath) {
  const { text } = readNote(abs);
  const lines = text.split('\n');
  const lim = markerIndex(lines);
  let fence = false, head = '', sec = '';
  for (let i = 0; i < lim; i++) {
    const l = lines[i];
    if (/^\s*```/.test(l)) { fence = !fence; continue; }
    if (fence) continue;
    const hm = l.match(/^(#{1,6})\s+(.*)$/); if (hm) { head = hm[2]; if (hm[1].length <= 2) sec = hm[2]; continue; }
    if (/habits/i.test(head)) continue;
    const m = l.match(CHECK); if (!m) continue;
    yield { i, raw: l, done: m[2] !== ' ', body: m[3], sec };
  }
}

export function listTasks() {
  const base = vp('1 Human');
  const today = todayStr(), cutoff = addDays(today, -DONE_WINDOW);
  const out = [];
  for (const abs of walkMd(base)) {
    const r = rel(abs);
    if (SKIP_DIRS.some((d) => r.startsWith(d + '/'))) continue;
    const dm = r.match(/^1 Human\/02 Daily\/\d{4}-\d{2}\/(\d{4}-\d{2}-\d{2})\.md$/);
    if (dm && dm[1] < addDays(today, -DAILY_DAYS)) continue;
    if (r.startsWith('1 Human/02 Daily/') && !dm) continue;
    for (const t of taskLines(abs, r)) {
      const { title, f, doneOn } = fieldsOf(t.body);
      if (!title || PLACEHOLDERS.some((p) => p.test(title))) continue;
      // A checkbox is a task when it sits in a daily note, in 03 Tasks, under a "Tasks" heading, or carries a due date.
      // Loose checkboxes elsewhere (setup lists, study notes) are just notes.
      if (!(dm || r.startsWith('1 Human/03 Tasks/') || /\btasks?\b|to-?do/i.test(t.sec) || isDate(f.due))) continue;
      if (t.done && (!doneOn || doneOn < cutoff)) continue; // finished tasks show for two weeks, dated by their ✅
      const pm = r.match(/^1 Human\/04 Projects\/([^/]+)\//);
      const proj = stripLink(f.project) || (pm ? pm[1] : '');
      const due = isDate(f.due) ? f.due : '';
      const tm = /^\d{1,2}:\d{2}$/.test(f.time || '') ? f.time.padStart(5, '0') : '';
      out.push({ id: b64(r) + '.' + t.i + '.' + h8(t.raw), title, dueKey: due, time: tm, priority: normPri(f.priority), project: proj, repeat: normRepeat(f.repeat), done: t.done, file: r.replace(/^1 Human\//, '').replace(/\.md$/, '') });
    }
  }
  return { tasks: out };
}

function locate(id) {
  const m = String(id).match(/^([\w-]+)\.(\d+)\.([0-9a-f]{8})$/);
  if (!m) throw new HttpError(400, 'Bad task id.');
  const relPath = unb64(m[1]);
  if (!relPath.startsWith('1 Human/') || relPath.includes('..')) throw new HttpError(400, 'Bad task id.');
  const abs = vp(relPath);
  if (!exists(abs)) throw new HttpError(409, 'That task moved. Refreshing.');
  const { text, eol } = readNote(abs);
  const lines = text.split('\n');
  let idx = Number(m[2]);
  if (!(lines[idx] && h8(lines[idx]) === m[3])) idx = lines.findIndex((l) => CHECK.test(l) && h8(l) === m[3]);
  if (idx < 0) throw new HttpError(409, 'That task changed in the vault. Refreshing.');
  return { abs, lines, idx, eol };
}

function addMonth(d) { const [y, m, dd] = d.split('-').map(Number); const t = new Date(Date.UTC(y, m, 1)); const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate(); t.setUTCDate(Math.min(dd, last)); return t.toISOString().slice(0, 10); }

export function setTaskDone(id, done) {
  const { abs, lines, idx, eol } = locate(id);
  const m = lines[idx].match(CHECK);
  const was = m[2] !== ' ';
  if (was === !!done) return { ok: true };
  const today = todayStr();
  let body = m[3];
  if (done) { if (!/✅/.test(body)) body = body.replace(/\s+$/, '') + ' ✅ ' + today; }
  else body = body.replace(/\s*✅\s*\d{4}-\d{2}-\d{2}/, '');
  const fresh = `${m[1]}- [${done ? 'x' : ' '}] ${body}`;
  const extra = [];
  const { f, title } = fieldsOf(m[3]);
  const rep = normRepeat(f.repeat);
  if (done && rep && isDate(f.due)) {
    const nd = rep === 'daily' ? addDays(f.due, 1) : rep === 'weekly' ? addDays(f.due, 7) : addMonth(f.due);
    extra.push(`${m[1]}- [ ] ${m[3].replace(/\s*✅\s*\d{4}-\d{2}-\d{2}/, '').replace(/\[due::\s*[^\]]*\]/, `[due:: ${nd}]`)}`);
  }
  lines.splice(idx, 1, fresh, ...extra);
  writeNote(abs, touch(lines.join('\n')), eol);
  return { ok: true, repeated: extra.length > 0 };
}

// Edit a task in place: title, due date, time, priority, project, repeat. Everything else on its line (its done date, other fields)
// stays as it was. A value that is not sent is kept; an empty value clears the field. The task's id changes with its text, so the new one is returned.
export function editTask(id, b) {
  const { abs, lines, idx, eol } = locate(id);
  const m = lines[idx].match(CHECK);
  const { title: oldTitle, f, doneOn } = fieldsOf(m[3]);
  const has = (k) => b && b[k] !== undefined && b[k] !== null;
  const title = clean1(has('title') ? b.title : oldTitle).slice(0, 300);
  if (!title) throw new HttpError(400, 'A task needs a title.');
  let due = has('dueKey') ? String(b.dueKey || '') : (isDate(f.due) ? f.due : '');
  if (due && !isDate(due)) throw new HttpError(400, 'The due date must be YYYY-MM-DD.');
  let time = has('time') ? String(b.time || '').trim() : (f.time || '');
  if (time && !/^([01]?\d|2[0-3]):[0-5]\d$/.test(time)) throw new HttpError(400, 'The time must be HH:MM.');
  if (!due) time = '';
  let pri = ''; if (has('priority')) { pri = normPri(b.priority); if (String(b.priority || '') && !pri) throw new HttpError(400, 'Priority must be Low, Medium or High.'); } else pri = normPri(f.priority);
  let rep = ''; if (has('repeat')) { rep = normRepeat(b.repeat); if (String(b.repeat || '') && !rep) throw new HttpError(400, 'Repeat must be daily, weekly or monthly.'); } else rep = normRepeat(f.repeat);
  let proj = has('project') ? clean1(b.project) : stripLink(f.project);
  if (proj && has('project')) { const hit = listProjects().projects.map((p) => p.name).find((n) => n.toLowerCase() === proj.toLowerCase()); if (!hit) throw new HttpError(400, 'There is no project called "' + proj.slice(0, 60) + '".'); proj = hit; }
  // fields this editor does not know are kept exactly as written
  const known = new Set(['due', 'time', 'priority', 'project', 'repeat']), others = [];
  m[3].replace(/\s*[\[(]([A-Za-z]+)::\s*((?:\[\[[^\]]*\]\]|[^\])])*)[\])]/g, (all, k) => { if (!known.has(k.toLowerCase())) others.push(all.trim()); return all; });
  const parts = [title];
  if (due) parts.push(`[due:: ${due}]`);
  if (time) parts.push(`[time:: ${time.padStart(5, '0')}]`);
  if (pri) parts.push(`[priority:: ${pri}]`);
  if (proj) parts.push(`[project:: [[${proj}]]]`);
  if (rep) parts.push(`[repeat:: ${rep}]`);
  parts.push(...others);
  if (doneOn) parts.push(`✅ ${doneOn}`);
  const fresh = `${m[1]}- [${m[2]}] ${parts.join(' ')}`;
  lines[idx] = fresh;
  writeNote(abs, touch(lines.join('\n')), eol);
  return { ok: true, id: b64(rel(abs)) + '.' + idx + '.' + h8(fresh) };
}

const clean1 = (s) => String(s || '').replace(/\r?\n+/g, ' ').replace(/[\[\]]/g, '').replace(/::+/g, ':').trim(); // no brackets and no "::", so a title can never act as an inline field
export function createTask(b) {
  const title = clean1(b.title);
  if (!title) throw new HttpError(400, 'Give the task a title.');
  const parts = [];
  if (isDate(b.dueKey)) parts.push(`[due:: ${b.dueKey}]`);
  if (/^\d{1,2}:\d{2}$/.test(b.time || '') && isDate(b.dueKey)) parts.push(`[time:: ${b.time.padStart(5, '0')}]`);
  const pri = normPri(b.priority); if (pri) parts.push(`[priority:: ${pri}]`);
  const proj = clean1(b.project);
  if (proj) parts.push(`[project:: [[${proj}]]]`);
  const rep = normRepeat(b.repeat); if (rep) parts.push(`[repeat:: ${rep}]`);
  const line = `- [ ] ${title}${parts.length ? ' ' + parts.join(' ') : ''}`;
  let abs = proj ? vp('1 Human', '04 Projects', proj, proj + '.md') : null;
  if (!abs || !exists(abs)) abs = vp('1 Human', '03 Tasks', 'Current Tasks', 'Current Tasks.md');
  if (!exists(abs)) throw new HttpError(500, 'Current Tasks note is missing.');
  const { text, eol } = readNote(abs);
  const lines = text.split('\n');
  const inProject = abs.includes('04 Projects');
  if (inProject) {
    let sec = section(lines, /^##\s+Tasks\b/i);
    if (!sec) { const lim = markerIndex(lines); lines.splice(lim, 0, '## Tasks', ''); sec = section(lines, /^##\s+Tasks\b/i); }
    // an empty "- [ ] " template placeholder gives way to the first real task
    for (let i = sec[0] + 1; i < sec[1]; i++) if (/^\s*- \[ \]\s*$/.test(lines[i])) { lines.splice(i, 1); sec[1]--; break; }
    let at = sec[0] + 1;
    for (let i = sec[0] + 1; i < sec[1]; i++) if (CHECK.test(lines[i])) at = i + 1;
    lines.splice(at, 0, line);
  } else {
    const lim = markerIndex(lines);
    let at = lim;
    while (at > 0 && /^\s*$/.test(lines[at - 1])) at--;
    if (at > 0 && !CHECK.test(lines[at - 1]) && !/^\s*$/.test(lines[at - 1])) { lines.splice(at, 0, ''); at++; }
    lines.splice(at, 0, line);
    if (lines[at + 1] !== undefined && !/^\s*$/.test(lines[at + 1])) lines.splice(at + 1, 0, '');
  }
  writeNote(abs, touch(lines.join('\n')), eol);
  const idx = lines.indexOf(line);
  return { ok: true, id: b64(rel(abs)) + '.' + idx + '.' + h8(line) };
}
