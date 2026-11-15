import fs from 'node:fs';
import path from 'node:path';
import { vp, rel, exists, readNote, writeNote, isDate, fillTemplate, getFrontmatter, findSection, MONTHS, VAULT, HttpError } from './vault.mjs';

const KINDS = ['Weekly', 'Monthly', 'Yearly'];
const PILLARS = ['Body', 'Mind', 'Wealth', 'Craft', 'Spirit'];
const BASE = ['1 Human', '16 Performance Review'];
const label = (n) => (n >= 4 ? 'On track' : n === 3 ? 'Drifting' : 'Off track');
const idOf = (abs) => Buffer.from(rel(abs)).toString('base64url');
const fromId = (id) => {
  let r; try { r = Buffer.from(String(id), 'base64url').toString('utf8'); } catch (e) { throw new HttpError(400, 'Bad id.'); }
  const abs = vp(r);
  const folder = vp(...BASE);
  if (!abs.startsWith(folder + path.sep) || !abs.endsWith('.md')) throw new HttpError(400, 'Not a review.');
  return abs;
};
const cell = (s) => String(s || '').replace(/\r?\n+/g, ' ').replace(/\|/g, '\\|').trim();
const unc = (s) => String(s || '').replace(/\\\|/g, '|').trim();
const one = (s) => String(s || '').replace(/\r?\n+/g, ' ').trim();

function parse(abs, kind) {
  const { text } = readNote(abs);
  const lines = text.split('\n');
  const name = path.basename(abs, '.md');
  if (name === kind) return null; // the folder's own note
  const r = { id: idOf(abs), type: kind, name, date: getFrontmatter(text, 'created'), projects: '', wins: '', blocker: '', sc: {}, pn: {}, f: ['', '', ''], obs: '' };
  const sc = findSection(lines, (l) => /Scorecard/i.test(l));
  if (sc) for (let i = sc[0] + 1; i < sc[1]; i++) {
    const m = lines[i].match(/^- \*\*(Projects moved|Quick wins completed|Biggest blocker):\*\*\s*(.*)$/);
    if (m) r[{ 'Projects moved': 'projects', 'Quick wins completed': 'wins', 'Biggest blocker': 'blocker' }[m[1]]] = m[2].trim();
  }
  const pc = findSection(lines, (l) => /Pillar Check-in/i.test(l));
  if (pc) for (let i = pc[0] + 1; i < pc[1]; i++) {
    const m = lines[i].match(/^\|\s*(Body|Mind|Wealth|Craft|Spirit)\s*\|((?:\\\||[^|])*)\|((?:\\\||[^|])*)\|\s*$/);
    if (m) { const n = unc(m[2]).match(/([1-5])\s*\/\s*5/); if (n) r.sc[m[1]] = Number(n[1]); const note = unc(m[3]); if (note) r.pn[m[1]] = note; }
  }
  const nf = findSection(lines, (l) => /Next Focus/i.test(l));
  if (nf) for (let i = nf[0] + 1; i < nf[1]; i++) { const m = lines[i].match(/^\s*([1-3])\.\s*(.*)$/); if (m) r.f[Number(m[1]) - 1] = m[2].trim(); }
  const ob = findSection(lines, (l) => /Observations/i.test(l));
  if (ob) {
    let i = ob[0] + 1;
    while (i < ob[1] && (/^\s*$/.test(lines[i]) || /^>/.test(lines[i]))) i++;
    r.obs = lines.slice(i, ob[1]).join('\n').trim();
  }
  return r;
}

export function listReviews() {
  const out = [];
  for (const kind of KINDS) {
    const dir = vp(...BASE, kind);
    if (!exists(dir)) continue;
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith('.md')) continue;
      try { const r = parse(path.join(dir, f), kind); if (r && isDate(r.date)) out.push(r); } catch (e) { /* skip unreadable note */ }
    }
  }
  out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.name < b.name ? -1 : 1));
  return { reviews: out };
}

function nameFor(kind, date) {
  const y = date.slice(0, 4), m = Number(date.slice(5, 7));
  if (kind === 'Weekly') return `Week of ${date}`;
  if (kind === 'Monthly') return `Review ${MONTHS[m - 1]} ${y}`;
  return `Review ${y}`;
}

export function createReview(b) {
  if (!b || !KINDS.includes(b.type)) throw new HttpError(400, 'Pick Weekly, Monthly or Yearly.');
  if (!isDate(b.date)) throw new HttpError(400, 'Pick a date.');
  const name = nameFor(b.type, b.date);
  const abs = vp(...BASE, b.type, name + '.md');
  if (exists(abs)) throw new HttpError(409, `A ${b.type.toLowerCase()} review already exists for this ${b.type === 'Weekly' ? 'date' : b.type === 'Monthly' ? 'month' : 'year'}.`, { id: idOf(abs) });
  const tpl = vp('2 Machine', '01 Templates', 'Performance Review.md');
  if (!exists(tpl)) throw new HttpError(500, 'The Performance Review template is missing.');
  const { text: t0, eol } = readNote(tpl);
  let lines = fillTemplate(t0, { date: b.date, title: name }).split('\n');
  const sc = b.sc || {}, pn = b.pn || {}, f = Array.isArray(b.f) ? b.f : [];
  const put = (re, fn) => { const i = lines.findIndex((l) => re.test(l)); if (i >= 0) lines[i] = fn(lines[i]); };
  const bullet = (key, v) => put(new RegExp('^- \\*\\*' + key + ':\\*\\*'), (l) => (one(v) ? l.replace(/\s*$/, '') + ' ' + one(v) : l));
  bullet('Projects moved', b.projects); bullet('Quick wins completed', b.wins); bullet('Biggest blocker', b.blocker);
  for (const p of PILLARS) {
    const n = Number(sc[p]); const ok = n >= 1 && n <= 5;
    put(new RegExp('^\\|\\s*' + p + '\\s*\\|'), () => `| ${p} | ${ok ? `${n}/5 · ${label(n)}` : ''} | ${cell(pn[p])} |`);
  }
  for (let i = 1; i <= 3; i++) put(new RegExp('^' + i + '\\.\\s*$'), (l) => (one(f[i - 1]) ? `${i}. ${one(f[i - 1])}` : l));
  const obs = String(b.obs || '').replace(/\r\n/g, '\n').trim();
  if (obs) {
    const ob = findSection(lines, (l) => /Observations/i.test(l));
    if (ob) { let i = ob[0] + 1; while (i < ob[1] && (/^\s*$/.test(lines[i]) || /^>/.test(lines[i]))) i++; lines.splice(i, 0, ...obs.split('\n')); }
  }
  writeNote(abs, lines.join('\n'), eol);
  return { ok: true, id: idOf(abs), name };
}

// "Never delete": the note moves flat into 99 Bin and its connections are emptied.
export function binReview(id) {
  const abs = fromId(id);
  if (!exists(abs)) throw new HttpError(404, 'That review is already gone.');
  const { text, eol } = readNote(abs);
  const cleaned = text.replace(/^connections:[^\n]*\n(?:[ \t]+-[^\n]*\n)*/m, 'connections: []\n');
  const bin = vp('1 Human', '99 Bin');
  fs.mkdirSync(bin, { recursive: true });
  let dest = path.join(bin, path.basename(abs)), k = 2;
  while (exists(dest)) dest = path.join(bin, path.basename(abs, '.md') + ` (${k++}).md`);
  writeNote(abs, cleaned, eol);
  fs.renameSync(abs, dest);
  return { ok: true, movedTo: rel(dest) };
}
