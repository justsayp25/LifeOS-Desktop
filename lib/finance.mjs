// Finances: one note per asset in 13 Finance/Assets, entries are bullets under ## Log.
import { b64, unb64, h8, section, insertInSection, touch, vp, exists, readNote, writeNote, todayStr, isDate, HttpError } from './util.mjs';

export const ASSETS = ['Cash', 'DragonFi', 'GCash', 'GoTYME', 'GoTrade', 'Maribank', 'Maya', 'Wise'];
export const CATEGORIES = ['Food', 'Transport', 'School', 'Bills', 'Health', 'Fun', 'Other'];
// `- 2026-11-22 -- withdraw, amount: 350` or, for spending, `..., amount: 350, category: Transport, note: Grab` (category and note are optional; older lines stay valid)
const ENTRY = /^\s*-\s+(\d{4}-\d{2}-\d{2})\s+--\s+(deposit|withdraw)\s*,\s*amount:\s*([\d,]+(?:\.\d+)?)\s*(?:,\s*category:\s*([A-Za-z]+)\s*)?(?:,\s*note:\s*(.*?)\s*)?$/i;
const noteOf = (asset) => { if (!ASSETS.includes(asset)) throw new HttpError(400, 'Unknown asset.'); return vp('1 Human', '13 Finance', 'Assets', asset + '.md'); };

export function listEntries() {
  const out = [];
  for (const asset of ASSETS) {
    const abs = noteOf(asset);
    if (!exists(abs)) continue;
    const lines = readNote(abs).text.split('\n');
    const sec = section(lines, /^##\s+Log\b/i);
    if (!sec) continue;
    for (let i = sec[0] + 1; i < sec[1]; i++) {
      const m = lines[i].match(ENTRY);
      if (m) out.push({ id: b64(asset) + '.' + h8(lines[i]) + '.' + i, asset, kind: m[2].toLowerCase(), amt: Number(m[3].replace(/,/g, '')), date: m[1], ...(m[4] ? { cat: m[4] } : {}), ...(m[5] ? { note: m[5] } : {}) });
    }
  }
  return { entries: out };
}
export function addEntry(b) {
  const abs = noteOf(b.asset);
  if (!exists(abs)) throw new HttpError(404, 'That asset note is missing.');
  const amt = Math.round(Number(b.amt) * 100) / 100;
  if (!(amt > 0)) throw new HttpError(400, 'Enter an amount.');
  if (!['deposit', 'withdraw'].includes(b.kind)) throw new HttpError(400, 'Deposit or withdraw.');
  if (!isDate(b.date)) throw new HttpError(400, 'Pick a date.');
  const { text, eol } = readNote(abs);
  const lines = text.split('\n');
  let sec = section(lines, /^##\s+Log\b/i);
  if (!sec) { lines.push('', '## Log', ''); sec = section(lines, /^##\s+Log\b/i); }
  let extra = '';
  if (b.cat) {
    const cat = CATEGORIES.find((c) => c.toLowerCase() === String(b.cat).toLowerCase());
    if (!cat) throw new HttpError(400, 'Unknown category.');
    if (b.kind !== 'withdraw') throw new HttpError(400, 'Only a withdraw has a category.');
    extra = `, category: ${cat}`;
    const note = String(b.note || '').replace(/[\r\n\[\]]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60);
    if (note) extra += `, note: ${note}`;
  }
  const line = `- ${b.date} -- ${b.kind}, amount: ${amt}${extra}`;
  let at = sec[0] + 1;
  for (let i = sec[0] + 1; i < sec[1]; i++) if (/^\s*-\s/.test(lines[i])) at = i + 1;
  lines.splice(at, 0, line);
  writeNote(abs, touch(lines.join('\n')), eol);
  return { ok: true, id: b64(b.asset) + '.' + h8(line) + '.' + at };
}
export function removeEntry(id) {
  const m = String(id).match(/^([\w-]+)\.([0-9a-f]{8})\.(\d+)$/);
  if (!m) throw new HttpError(400, 'Bad entry id.');
  const abs = noteOf(unb64(m[1]));
  const { text, eol } = readNote(abs);
  const lines = text.split('\n');
  let idx = Number(m[3]);
  if (!(lines[idx] && h8(lines[idx]) === m[2] && ENTRY.test(lines[idx]))) idx = lines.findIndex((l) => ENTRY.test(l) && h8(l) === m[2]);
  if (idx < 0) throw new HttpError(409, 'That entry changed in the vault. Refreshing.');
  lines.splice(idx, 1);
  writeNote(abs, touch(lines.join('\n')), eol);
  return { ok: true };
}
