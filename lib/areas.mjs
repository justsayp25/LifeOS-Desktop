// Areas (folder trees) and vault search. Read-only.
import fs from 'node:fs';
import path from 'node:path';
import { VAULT, vp, rel, exists, readNote, getFrontmatter } from './vault.mjs';
import { walkMd } from './util.mjs';

const H = '1 Human';
const AREAS = [
  { name: 'Health', dir: '11 Health' }, { name: 'MMA', dir: '12 MMA' }, { name: 'Spiritual', dir: '06 Spiritual' },
  { name: 'Finances', dir: '13 Finance' }
];
const isHub = (abs) => { try { return getFrontmatter(readNote(abs).text, 'type') === 'hub'; } catch (e) { return false; } };
const isIndex = (n) => /^\d\d - /.test(n);
const mmdd = (ms) => { const d = new Date(ms); return String(d.getMonth() + 1).padStart(2, '0') + '/' + String(d.getDate()).padStart(2, '0'); };

function walk(dir, depth, tree, st, chipDir) {
  if (depth > 5 || tree.length > 400) return;
  const ents = fs.readdirSync(dir, { withFileTypes: true }).filter((e) => !e.name.startsWith('.'));
  const folders = ents.filter((e) => e.isDirectory()).sort((a, b) => a.name.localeCompare(b.name));
  const files = ents.filter((e) => e.isFile() && e.name.endsWith('.md')).sort((a, b) => a.name.localeCompare(b.name));
  for (const f of folders) {
    tree.push([f.name, depth]);
    walk(path.join(dir, f.name), depth + 1, tree, st, chipDir || /^(Tracker|Assets)$/.test(f.name));
  }
  for (const f of files) {
    const abs = path.join(dir, f.name);
    if (isIndex(f.name) || isHub(abs)) continue;
    tree.push([f.name.replace(/\.md$/, ''), depth, chipDir ? 'LOG' : '', 1]);
    try { st.t = Math.max(st.t, fs.statSync(abs).mtimeMs); } catch (e) {}
  }
}

export function listAreas() {
  return AREAS.map((A) => {
    const base = vp(H, A.dir);
    const tree = [], st = { t: 0 };
    if (exists(base)) walk(base, 0, tree, st, false);
    return { name: A.name, path: H + '/' + A.dir, upd: st.t ? mmdd(st.t) : '', tree };
  });
}

export function search(qRaw) {
  const q = String(qRaw || '').trim().toLowerCase();
  if (q.length < 2) return { vault: path.basename(VAULT), results: [] };
  const root = vp(H);
  const out = [];
  for (const abs of walkMd(root)) {
    const r = rel(abs);
    if (/\/(99 Bin|05 Journal)\//.test('/' + r) || /\/02 Daily\//.test('/' + r)) continue;
    const title = path.basename(abs, '.md');
    let text = '';
    try { if (fs.statSync(abs).size < 400_000) text = readNote(abs).text; } catch (e) { continue; }
    if (getFrontmatter(text, 'type') === 'hub') continue;
    const tl = title.toLowerCase();
    let score = 0, snippet = '';
    if (tl === q) score = 100; else if (tl.startsWith(q)) score = 80; else if (tl.includes(q)) score = 60;
    const body = text.replace(/^---\n[\s\S]*?\n---\n?/, '');
    const i = body.toLowerCase().indexOf(q);
    if (i >= 0) {
      score = Math.max(score, 20);
      const s = Math.max(0, i - 40);
      snippet = body.slice(s, i + q.length + 80).replace(/\s+/g, ' ').trim();
    }
    if (score) out.push({ score, title, path: r.replace(/\.md$/, ''), folder: path.dirname(r).replace(/^1 Human\/?/, ''), snippet });
  }
  out.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title));
  return { vault: path.basename(VAULT), results: out.slice(0, 25).map(({ score, ...x }) => x) };
}

// Find a note by its [[link]] name (alias and #heading removed). Read-only.
export function resolve(nameRaw) {
  const name = String(nameRaw || '').split('|')[0].split('#')[0].trim().toLowerCase();
  if (!name) return { vault: path.basename(VAULT), path: null };
  const want = name.replace(/\.md$/, '').split('/').pop();
  let best = null;
  for (const abs of walkMd(vp(H))) {
    const r = rel(abs);
    if (/\/99 Bin\//.test('/' + r)) continue;
    if (path.basename(abs, '.md').toLowerCase() === want) {
      if (name.includes('/') && !r.toLowerCase().replace(/\.md$/, '').endsWith(name)) continue;
      if (!best || r.length < best.length) best = r;
    }
  }
  return { vault: path.basename(VAULT), path: best ? best.replace(/\.md$/, '') : null };
}
