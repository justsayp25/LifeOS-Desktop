// Vault access: one place that knows where the vault is and how to touch it safely.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(here, '..');

function readEnvFile() {
  const out = {};
  try {
    for (const line of fs.readFileSync(path.join(ROOT, '.env'), 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/);
      if (m && !line.trim().startsWith('#')) out[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  } catch (e) { /* no .env is fine */ }
  return out;
}
export const env = { ...readEnvFile(), ...process.env };
export const VAULT = path.resolve(env.VAULT_PATH || path.join(ROOT, '..', 'LifeOS'));
export const PORT = Number(env.PORT || 4100);
export const HOST = env.HOST || '127.0.0.1';

// Folders the app may never write into. Journal and Inbox are read-only by the vault rules; 2 Machine is the system's.
const NO_WRITE = ['1 Human/05 Journal', '1 Human/01 Inbox', '2 Machine'];

export function inVault(p) {
  const abs = path.resolve(p);
  const rel = path.relative(VAULT, abs);
  return rel && !rel.startsWith('..') && !path.isAbsolute(rel);
}
export function vp(...parts) {
  const abs = path.resolve(VAULT, ...parts);
  if (!inVault(abs)) throw new HttpError(400, 'Path is outside the vault.');
  return abs;
}
export function rel(abs) { return path.relative(VAULT, abs).split(path.sep).join('/'); }
export function canWrite(abs) {
  const r = rel(abs);
  return !NO_WRITE.some((n) => r === n || r.startsWith(n + '/'));
}

export class HttpError extends Error { constructor(status, message, extra) { super(message); this.status = status; this.extra = extra; } }

export function exists(abs) { try { fs.accessSync(abs); return true; } catch (e) { return false; } }

// Read a note as LF text and remember its line ending so writes keep it.
// Reads are cached by size + modified time, so repeated scans of the vault stay cheap (virus scanners make file opens slow on Windows).
const CACHE = new Map();
export function readNote(abs) {
  let st = null;
  try { st = fs.statSync(abs); } catch (e) { /* let the read below throw the real error */ }
  if (st) {
    const c = CACHE.get(abs);
    if (c && c.m === st.mtimeMs && c.s === st.size && Date.now() - st.mtimeMs > 2000) return { text: c.text, eol: c.eol };
  }
  const raw = fs.readFileSync(abs, 'utf8').replace(/^﻿/, '');
  const eol = raw.includes('\r\n') ? '\r\n' : '\n';
  const text = raw.replace(/\r\n/g, '\n');
  if (st) { if (CACHE.size > 4000) CACHE.clear(); CACHE.set(abs, { m: st.mtimeMs, s: st.size, text, eol }); }
  return { text, eol };
}
export function writeNote(abs, text, eol = '\n') {
  if (!canWrite(abs)) throw new HttpError(403, 'The vault rules do not let the app write there.');
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  const out = eol === '\r\n' ? text.replace(/\n/g, '\r\n') : text;
  const tmp = abs + '.lifeos-tmp';
  fs.writeFileSync(tmp, out, 'utf8');
  fs.renameSync(tmp, abs);
  CACHE.delete(abs);
}

// ---- dates (local time, YYYY-MM-DD) ----
export const pad = (n) => String(n).padStart(2, '0');
export function todayStr() { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
export const isDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s + 'T00:00:00Z'));
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export function addDays(s, n) { const d = new Date(s + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
function fmtDate(s, fmt) {
  const d = new Date(s + 'T00:00:00Z');
  const map = { YYYY: String(d.getUTCFullYear()), MMMM: MONTHS[d.getUTCMonth()], MM: pad(d.getUTCMonth() + 1), DD: pad(d.getUTCDate()), dddd: DAYS[d.getUTCDay()], D: String(d.getUTCDate()) };
  return fmt.replace(/YYYY|MMMM|MM|DD|dddd|D/g, (t) => map[t]);
}
// Templater only runs inside Obsidian, so the app fills the few expressions the templates use.
export function fillTemplate(text, { date, title }) {
  return text
    .replace(/<%\s*tp\.date\.now\(\s*"([^"]*)"\s*(?:,\s*(-?\d+)\s*)?\)\s*%>/g, (_, fmt, off) => fmtDate(off ? addDays(date, Number(off)) : date, fmt))
    .replace(/<%\s*tp\.file\.title\s*%>/g, title || '');
}

// ---- small markdown helpers ----
export function setFrontmatter(text, key, value) {
  const m = text.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!m) return text;
  const re = new RegExp('^' + key + ':.*$', 'm');
  if (!re.test(m[1])) return text;
  return text.replace(m[0], m[0].replace(re, `${key}: ${value}`));
}
export function getFrontmatter(text, key) {
  const m = text.match(/^---\n([\s\S]*?)\n---/);
  if (!m) return '';
  const l = m[1].match(new RegExp('^' + key + ':\\s*(.*)$', 'm'));
  return l ? l[1].trim() : '';
}
// Index range of a "## " section: [start of heading line, end before next "## " heading or EOF].
export function findSection(lines, test) {
  const s = lines.findIndex((l) => /^##\s/.test(l) && test(l));
  if (s < 0) return null;
  let e = lines.length;
  for (let i = s + 1; i < lines.length; i++) if (/^##\s/.test(lines[i])) { e = i; break; }
  return [s, e];
}
