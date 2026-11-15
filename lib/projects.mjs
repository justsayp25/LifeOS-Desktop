// Projects: 04 Projects/<Name>/<Name>.md, shaped by the Project template.
import { section, markerIndex, touch, bin, ensureFromTemplate, cleanName, fs, path, vp, rel, exists, readNote, writeNote, todayStr, isDate, getFrontmatter, setFrontmatter, HttpError } from './util.mjs';

const PH = {
  goal: ['One sentence: what does done look like?'],
  context: ["Why this exists, what problem it solves, who it's for."]
};
const STATUS_IN = { active: 'active', 'on-hold': 'hold', hold: 'hold', done: 'done' };
const STATUS_OUT = { active: 'active', hold: 'on-hold', done: 'done' };
const CHK = /^\s*- \[( |x|X)\]\s*(.*)$/;

const projDir = () => vp('1 Human', '04 Projects');
const noteOf = (name) => vp('1 Human', '04 Projects', name, name + '.md');
const strip = (l) => l.replace(/^>\s?/, '');

function textOf(lines, sec, ph) {
  const out = [];
  for (let i = sec[0] + 1; i < sec[1]; i++) {
    const raw = lines[i];
    if (/^>/.test(raw) && ph.includes(strip(raw).trim())) continue;
    out.push(strip(raw));
  }
  return out.join('\n').replace(/^\n+|\n+$/g, '');
}
function parse(name) {
  const abs = noteOf(name);
  const { text } = readNote(abs);
  const lines = text.split('\n');
  const sec = (re) => section(lines, re);
  const st = getFrontmatter(text, 'status');
  const p = { name, last: getFrontmatter(text, 'updated') || getFrontmatter(text, 'created'), due: (getFrontmatter(text, 'due_date') || '').replace(/^["']|["']$/g, ''), status: STATUS_IN[st] || 'active', goal: '', context: '', docs: [], tasks: [], notes: [], related: [], logs: [] };
  if (!isDate(p.due)) p.due = '';
  let s = sec(/^##\s+Goal\b/i); if (s) p.goal = textOf(lines, s, PH.goal);
  s = sec(/^##\s+Context\b/i); if (s) p.context = textOf(lines, s, PH.context);
  s = sec(/^##\s+Tasks\b/i);
  if (s) for (let i = s[0] + 1; i < s[1]; i++) { const m = lines[i].match(CHK); if (m && m[2].trim()) p.tasks.push([m[2].trim(), m[1] !== ' ']); }
  s = sec(/^##\s+Notes\b/i);
  if (s) { const t = lines.slice(s[0] + 1, s[1]).join('\n').replace(/^\n+|\n+$/g, ''); p.notesText = t; p.notes = t ? t.split('\n') : []; }
  s = sec(/^##\s+Related\b/i);
  if (s) for (let i = s[0] + 1; i < s[1]; i++) { const m = lines[i].match(/^\s*-\s*(Person|Place|Project)\s*:\s*\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/i); if (m && m[2].trim()) p.related.push([m[1][0].toUpperCase() + m[1].slice(1).toLowerCase(), m[2].trim()]); }
  s = sec(/^##\s+Log\b/i);
  if (s) {
    let cur = null;
    for (let i = s[0] + 1; i < s[1]; i++) {
      const hm = lines[i].match(/^###\s+(\d{4}-\d{2}-\d{2})\s*$/);
      if (hm) { cur = [hm[1], []]; p.logs.push(cur); continue; }
      const bm = lines[i].match(/^\s*[-*]\s+(.*\S)\s*$/);
      if (cur && bm) cur[1].push(bm[1]);
    }
    p.logs = p.logs.filter((x) => x[1].length).sort((a, b) => (a[0] < b[0] ? 1 : a[0] > b[0] ? -1 : 0));
  }
  if (p.logs.length) p.last = p.logs[0][0];
  const dir = path.dirname(abs);
  p.docs = fs.readdirSync(dir).filter((f) => f !== name + '.md' && !f.startsWith('.') && !f.endsWith('.lifeos-tmp')).map((f) => f.replace(/\.md$/, ''));
  return p;
}

export function listProjects() {
  const base = projDir();
  const out = [];
  if (exists(base)) for (const d of fs.readdirSync(base, { withFileTypes: true })) {
    if (!d.isDirectory() || d.name.startsWith('.')) continue;
    if (!exists(noteOf(d.name))) continue;
    try { out.push(parse(d.name)); } catch (e) { /* skip unreadable */ }
  }
  return { projects: out };
}

function replaceBody(lines, sec, bodyLines) {
  lines.splice(sec[0] + 1, sec[1] - sec[0] - 1, ...bodyLines, '');
}
export function patchProject(name, b) {
  name = cleanName(name);
  const abs = noteOf(name);
  if (!exists(abs)) throw new HttpError(404, 'No such project.');
  let { text, eol } = readNote(abs);
  let lines = text.split('\n');
  const need = (re, title) => { let s = section(lines, re); if (!s) { const lim = markerIndex(lines); lines.splice(lim, 0, '## ' + title, '', ''); s = section(lines, re); } return s; };
  if (b.status !== undefined) {
    if (!STATUS_OUT[b.status]) throw new HttpError(400, 'Status is active, hold or done.');
    text = setFrontmatter(lines.join('\n'), 'status', STATUS_OUT[b.status]); lines = text.split('\n');
  }
  if (b.due !== undefined) {
    const v = b.due && isDate(b.due) ? b.due : '';
    text = lines.join('\n');
    if (/^due_date:/m.test(text)) text = setFrontmatter(text, 'due_date', v);
    lines = text.split('\n');
  }
  const prose = (key, re, title, ph) => {
    if (b[key] === undefined) return;
    const v = String(b[key]).replace(/\r\n/g, '\n').replace(/^\n+|\n+$/g, '').replace(/^#{1,2}(\s)/gm, '###$1'); // a ## here would start a new section
    const s = need(re, title);
    const quoted = lines.slice(s[0] + 1, s[1]).some((l) => /^>/.test(l)) ;
    const body = v ? v.split('\n').map((l) => (quoted ? '> ' + l : l)) : ['> ' + ph];
    replaceBody(lines, s, body);
  };
  prose('goal', /^##\s+Goal\b/i, 'Goal', PH.goal[0]);
  prose('context', /^##\s+Context\b/i, 'Context', PH.context[0]);
  if (b.notesText !== undefined) {
    const s = need(/^##\s+Notes\b/i, 'Notes');
    const v = String(b.notesText).replace(/\r\n/g, '\n').replace(/^\n+|\n+$/g, '').replace(/^#{1,2}(\s)/gm, '###$1'); // a ## here would start a new section
    replaceBody(lines, s, v ? v.split('\n') : []);
  }
  if (Array.isArray(b.tasks)) {
    const s = need(/^##\s+Tasks\b/i, 'Tasks');
    const rows = b.tasks.filter((t) => Array.isArray(t) && String(t[0] || '').trim()).map((t) => `- [${t[1] ? 'x' : ' '}] ${String(t[0]).replace(/\r?\n+/g, ' ').trim()}`);
    let first = -1, last = -1;
    for (let i = s[0] + 1; i < s[1]; i++) if (CHK.test(lines[i])) { if (first < 0) first = i; last = i; }
    if (first < 0) lines.splice(s[0] + 1, 0, ...(rows.length ? ['', ...rows] : [])); // keep spacing sane
    else lines.splice(first, last - first + 1, ...rows);
  }
  if (Array.isArray(b.related)) {
    const s = need(/^##\s+Related\b/i, 'Related');
    const rows = b.related.filter((r) => Array.isArray(r) && String(r[1] || '').trim()).map((r) => `- ${['Person', 'Place', 'Project'].includes(r[0]) ? r[0] : 'Person'}: [[${String(r[1]).replace(/[\[\]\r\n]/g, '').trim()}]]`);
    let first = -1, last = -1;
    for (let i = s[0] + 1; i < s[1]; i++) if (/^\s*-\s*(Person|Place|Project)\s*:/i.test(lines[i])) { if (first < 0) first = i; last = i; }
    if (first < 0) lines.splice(s[0] + 1, 0, ...rows);
    else lines.splice(first, last - first + 1, ...rows);
  }
  if (Array.isArray(b.logs)) {
    // only today's new bullets are added; past entries are never rewritten from here
    const today = todayStr();
    const now = parse(name);
    const have = (now.logs.find((x) => x[0] === today) || [today, []])[1];
    const want = (b.logs.find((x) => Array.isArray(x) && x[0] === today) || [today, []])[1] || [];
    const add = want.filter((x) => String(x).trim() && !have.includes(String(x).trim())).map((x) => `- ${String(x).replace(/\r?\n+/g, ' ').trim()}`);
    if (add.length) {
      const s = need(/^##\s+Log\b/i, 'Log');
      const hi = lines.findIndex((l, i) => i > s[0] && i < s[1] && l.trim() === '### ' + today);
      if (hi >= 0) { let at = hi + 1; for (let i = hi + 1; i < s[1] && !/^###\s/.test(lines[i]); i++) if (/^\s*[-*]\s/.test(lines[i])) at = i + 1; lines.splice(at, 0, ...add); }
      else lines.splice(s[0] + 1, 0, '### ' + today, ...add, '');
    }
  }
  writeNote(abs, touch(lines.join('\n')), eol);
  return { ok: true, project: parse(name) };
}

export function createProject(b) {
  const name = cleanName(b.name);
  if (!name) throw new HttpError(400, 'Give the project a name.');
  const abs = noteOf(name);
  if (exists(abs) || exists(path.dirname(abs))) throw new HttpError(409, 'A project with that name already exists.');
  ensureFromTemplate(abs, 'Project.md', name);
  if (b.due && isDate(b.due)) { const { text, eol } = readNote(abs); writeNote(abs, setFrontmatter(text, 'due_date', b.due), eol); }
  return { ok: true, project: parse(name) };
}
export function binProject(name) {
  name = cleanName(name);
  const abs = noteOf(name);
  if (!exists(abs)) throw new HttpError(404, 'No such project.');
  const extra = fs.readdirSync(path.dirname(abs)).filter((f) => f !== name + '.md');
  if (extra.length) throw new HttpError(409, 'That project folder has other files in it. Move it in Obsidian.');
  const to = bin(abs);
  return { ok: true, movedTo: to };
}
