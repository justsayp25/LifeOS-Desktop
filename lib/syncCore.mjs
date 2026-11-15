// Sync rules. Pure functions (no file or network access) so the phone app can use the exact same code.
// Terms: "phone" and "pc" are the two copies; "base" is what both agreed on at the end of the last sync.
// A manifest is { "path/inside/vault.md": "<sha256 of the file's bytes>" }.

// Only these parts of the vault are synced. Everything else (.git, .obsidian, ...) never leaves the PC.
export const SCOPE = ['1 Human/', '2 Machine/01 Templates/', 'AGENTS.md', 'CLAUDE.md'];
// The phone may read these but never changes them: the PC copy always wins.
export const READONLY = ['2 Machine/', 'AGENTS.md', 'CLAUDE.md'];
export const BIN_DIR = '1 Human/99 Bin';

export const inScope = (p) => SCOPE.some((s) => (s.endsWith('/') ? p.startsWith(s) : p === s));
export const isReadonly = (p) => READONLY.some((s) => (s.endsWith('/') ? p.startsWith(s) : p === s));
export const isTextPath = (p) => /\.(md|markdown|txt|json|csv)$/i.test(p);

const BAD_SEG = /[<>:"|?*\u0000-\u001f]|[. ]$|^\.{1,2}$/;
const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;
// A path is safe if it stays inside the vault and is a valid name on Windows too. Returns the cleaned path or null.
export function cleanPath(p) {
  if (typeof p !== 'string' || !p || p.length > 400 || p.includes('\\') || p.startsWith('/')) return null;
  const segs = p.normalize('NFC').split('/');
  for (const s of segs) if (!s || BAD_SEG.test(s) || RESERVED.test(s) || s.startsWith('.')) return null;
  const out = segs.join('/');
  return inScope(out) ? out : null;
}

const pad = (n) => String(n).padStart(2, '0');
export function stamp(now) { const d = new Date(now || Date.now()); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}${pad(d.getMinutes())}`; }
// "Folder/Note.md" -> "Folder/Note (conflict phone 2026-10-31 1530).md"
export function conflictName(p, now, taken = () => false) {
  const i = p.lastIndexOf('.'), s = p.lastIndexOf('/');
  const stem = i > s ? p.slice(0, i) : p, ext = i > s ? p.slice(i) : '';
  let n = 0, c;
  do { c = `${stem} (conflict phone ${stamp(now)}${n ? ' ' + (n + 1) : ''})${ext}`; n++; } while (taken(c));
  return c;
}

// Decide what to do with every file. Returns { actions, summary }.
// action.type: pull (PC -> phone) | push (phone -> PC) | merge (both edited a text note: try a clean merge)
//   | conflict (both edited, keep both) | bin-phone | bin-pc (the other side deleted it, we move it to the Bin) | skip
// Nothing is ever deleted outright: a file that changed on one side always beats a deletion on the other.
export function planSync(base, phone, pc, opts = {}) {
  const now = opts.now || Date.now();
  const paths = new Set([...Object.keys(base || {}), ...Object.keys(phone || {}), ...Object.keys(pc || {})]);
  const actions = [];
  const taken = new Set([...paths]);
  for (const p of [...paths].sort()) {
    if (!inScope(p)) continue;
    const b = (base || {})[p], a = (phone || {})[p], c = (pc || {})[p];
    if (a === c) continue; // same on both sides (or missing on both)
    if (isReadonly(p)) {
      if (c !== undefined) actions.push({ type: 'pull', path: p, why: 'pc-owned' });
      else actions.push({ type: 'bin-phone', path: p, why: 'removed-on-pc' });
      continue;
    }
    const phoneSame = a === b, pcSame = c === b;
    if (phoneSame && !pcSame) {
      if (c === undefined) actions.push({ type: 'bin-phone', path: p, why: 'deleted-on-pc' });
      else actions.push({ type: 'pull', path: p, why: b === undefined ? 'new-on-pc' : 'edited-on-pc' });
    } else if (pcSame && !phoneSame) {
      if (a === undefined) actions.push({ type: 'bin-pc', path: p, why: 'deleted-on-phone', expect: c });
      else actions.push({ type: 'push', path: p, why: b === undefined ? 'new-on-phone' : 'edited-on-phone', expect: c === undefined ? 'none' : c });
    } else {
      // both sides changed it differently
      if (a === undefined) actions.push({ type: 'pull', path: p, why: 'deleted-on-phone-but-edited-on-pc' });
      else if (c === undefined) actions.push({ type: 'push', path: p, why: 'deleted-on-pc-but-edited-on-phone', expect: 'none' });
      else if (isTextPath(p) && b !== undefined) actions.push({ type: 'merge', path: p, base: b });
      else {
        const copy = conflictName(p, now, (x) => taken.has(x)); taken.add(copy);
        actions.push({ type: 'conflict', path: p, copyPath: copy });
      }
    }
  }
  // moves to the Bin run last, so a bin file arriving in the same sync is in place first
  const order = { pull: 0, push: 0, merge: 1, conflict: 1, 'bin-phone': 2, 'bin-pc': 2, skip: 3 };
  actions.sort((x, y) => order[x.type] - order[y.type]);
  const summary = { pull: 0, push: 0, merge: 0, conflict: 0, bin: 0 };
  for (const x of actions) { if (x.type === 'bin-phone' || x.type === 'bin-pc') summary.bin++; else if (summary[x.type] !== undefined) summary[x.type]++; }
  return { actions, summary };
}

// ---- three-way text merge (lines) ----
function lcsPairs(x, y) {
  const n = x.length, m = y.length;
  const t = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) t[i][j] = x[i] === y[j] ? t[i + 1][j + 1] + 1 : Math.max(t[i + 1][j], t[i][j + 1]);
  const out = new Map(); let i = 0, j = 0;
  while (i < n && j < m) { if (x[i] === y[j]) { out.set(i, j); i++; j++; } else if (t[i + 1][j] >= t[i][j + 1]) i++; else j++; }
  return out;
}
const same = (u, v) => u.length === v.length && u.every((l, k) => l === v[k]);
const UPD = /^updated:\s*(\d{4}-\d{2}-\d{2})\s*$/;
// Returns the merged text, or null if two edits touch the same lines differently.
export function merge3(baseText, phoneText, pcText) {
  if (phoneText === pcText) return pcText;
  if (phoneText === baseText) return pcText;
  if (pcText === baseText) return phoneText;
  const B = baseText.split('\n'), A = phoneText.split('\n'), C = pcText.split('\n');
  if (B.length * Math.max(A.length, C.length) > 4_000_000) return null;
  const ma = lcsPairs(B, A), mc = lcsPairs(B, C);
  const stable = [[-1, -1, -1]];
  for (let i = 0; i < B.length; i++) if (ma.has(i) && mc.has(i) && ma.get(i) > stable[stable.length - 1][1] && mc.get(i) > stable[stable.length - 1][2]) stable.push([i, ma.get(i), mc.get(i)]);
  stable.push([B.length, A.length, C.length]);
  const out = [];
  for (let s = 0; s < stable.length - 1; s++) {
    const [i0, j0, k0] = stable[s], [i1, j1, k1] = stable[s + 1];
    const cb = B.slice(i0 + 1, i1), ca = A.slice(j0 + 1, j1), cc = C.slice(k0 + 1, k1);
    if (same(ca, cb)) out.push(...cc);
    else if (same(cc, cb)) out.push(...ca);
    else if (same(ca, cc)) out.push(...ca);
    else if (ca.length === 1 && cc.length === 1 && UPD.test(ca[0]) && UPD.test(cc[0])) out.push(ca[0] > cc[0] ? ca[0] : cc[0]);
    else return null;
    if (i1 < B.length) out.push(B[i1]);
  }
  return out.join('\n');
}
