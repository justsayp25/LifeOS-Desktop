// Agent extras: file uploads from the chat, and chat transcripts kept on the Machine side.
import fs from 'node:fs';
import path from 'node:path';
import { vp, rel, exists, HttpError, todayStr, pad } from './vault.mjs';

const H = '1 Human';
const PHOTOS = [H, '10 Resources', 'Photos'];
const PDFS = [H, '10 Resources', 'PDFs'];
const CHATS = ['2 Machine', '06 Agent Client'];
const IMG = /\.(png|jpe?g|gif|webp)$/i;
const READABLE = /\.(png|jpe?g|gif|webp|pdf|txt|md|csv|json)$/i;
const DOC = /\.(pdf|docx?|xlsx?|pptx?|csv|txt|md|json)$/i;
const MAX = 20 * 1024 * 1024;

const clean = (s) => path.basename(String(s || 'file')).replace(/[\\/:*?"<>|#^\[\]!]/g, ' ').replace(/\s+/g, ' ').trim() || 'file';

// Save a photo or file sent from the chat. Photos go to 10 Resources/Photos; PDFs and other documents to 10 Resources/PDFs.
// Never overwrites: a number is added if the name is taken.
export function agentUpload(b) {
  const name0 = clean(b && b.name);
  const isImg = IMG.test(name0);
  if (!isImg && !DOC.test(name0)) throw new HttpError(400, 'Only photos (png, jpg, gif, webp) and documents (pdf, word, excel, powerpoint, csv, txt, md, json).');
  const buf = Buffer.from(String((b && b.data) || ''), 'base64');
  if (!buf.length || buf.length > MAX) throw new HttpError(400, 'File is empty or over 20 MB.');
  const dir = vp(...(isImg ? PHOTOS : PDFS));
  fs.mkdirSync(dir, { recursive: true });
  let name = name0, n = 2;
  while (exists(path.join(dir, name))) name = name0.replace(/(\.[^.]+)$/, ` ${n++}$1`);
  const abs = path.join(dir, name);
  fs.writeFileSync(abs, buf, { flag: 'wx' });
  return { ok: true, file: { name, path: rel(abs), kind: isImg ? 'photo' : 'document', readable: READABLE.test(name) } };
}

// Check the paths the chat sends back: only files already saved under Photos or PDFs count.
export function checkAttachments(list) {
  const out = [];
  for (const p of Array.isArray(list) ? list.slice(0, 8) : []) {
    const r = String(p || '').replace(/\\/g, '/');
    if (!(r.startsWith(PHOTOS.join('/') + '/') || r.startsWith(PDFS.join('/') + '/'))) throw new HttpError(400, 'That attachment is not in the vault.');
    const abs = vp(r);
    if (!exists(abs)) throw new HttpError(400, 'An attachment is missing: ' + path.basename(r));
    out.push({ path: r, readable: READABLE.test(r) });
  }
  return out;
}

// A confirmed change is written into the same transcript as the conversation it came from (if there is one).
export function logAction(session, line) {
  try {
    const file = files.get(session); if (!file || !exists(file)) return;
    const d = new Date();
    fs.appendFileSync(file, `\n## ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())} - Change\n\n${line}\n\n---\n`);
  } catch (_) { /* a transcript must never break the chat */ }
}

// One transcript file per conversation, in 2 Machine/06 Agent Client. Skipped if that folder does not exist.
const files = new Map();
export function logTurn(session, userText, attached, reply) {
  try {
    const dir = vp(...CHATS);
    if (!exists(dir)) return;
    const d = new Date();
    const t = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
    let file = files.get(session);
    if (!file) {
      file = path.join(dir, `dashboard_${todayStr().replace(/-/g, '')}_${t.replace(/:/g, '')}.md`);
      if (exists(file)) return;
      fs.writeFileSync(file, `---\ncreated: ${todayStr()}T${t}\nagentDisplayName: Claude Code (dashboard)\nsession_id: ${session}\ntags: [agent-client]\n---\n\n# Claude Code (dashboard)\n`, { flag: 'wx' });
      files.set(session, file);
    }
    const att = attached && attached.length ? '\n\nAttached: ' + attached.map((a) => '`' + path.basename(a.path) + '`').join(', ') : '';
    fs.appendFileSync(file, `\n## ${t} - User\n\n${userText}${att}\n\n---\n\n## ${t} - Assistant\n\n${reply}\n\n---\n`);
  } catch (_) { /* a transcript must never break the chat */ }
}
