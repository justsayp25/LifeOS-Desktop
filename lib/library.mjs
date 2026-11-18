// Library notes: Information (Health), MMA styles, Spiritual and Knowledge notes, filed in the vault's own folders.
import { b64, unb64, h8, section, markerIndex, walkMd, touch, bin, ensureFromTemplate, cleanName, fs, path, vp, rel, exists, readNote, writeNote, todayStr, isDate, getFrontmatter, setFrontmatter, HttpError, VAULT } from './util.mjs';
import { canWrite } from './vault.mjs';
import { mdToHtml, htmlToMd, mdPlain } from './rich.mjs';

const H = '1 Human';
export const DOMAINS = {
  health: { sections: { Programs: ['Programs'], Performance: ['Hypertrophy', 'MMA Performance', 'Power', 'Rotation', 'Speed', 'Strength'], Recovery: ['Nutrition', 'Sleep', 'Supplements'] },
    dir: (s, t) => (s === t ? [H, '11 Health', 'Information', s] : [H, '11 Health', 'Information', s, t]) },
  mma: { sections: { Grappling: ['Brazilian Jiu Jitsu', 'Judo', 'Wrestling'], Striking: ['Boxing', 'Kickboxing', 'Muay Thai'], Weaponry: ['Eskrima', 'Kali'], 'Hybrid Styles': ['Jeet Kune Do'] },
    dir: (s, t) => [H, '12 MMA', s, t] },
  spiritual: { sections: { 'New Testament': ['New Testament'], 'Old Testament': ['Old Testament'] }, dir: (s) => [H, '06 Spiritual', s] },
  work: { sections: { 'Freelance Work': ['Freelance Work'], Karigawa: ['Karigawa'], 'Virtual Assistance': ['Virtual Assistance'], WebWarriorz: ['WebWarriorz'], marcheone: ['marcheone'] }, dir: (s) => [H, '14 Work', s] },
  knowledge: {
    sections: {
      Journal: ['Journal'],
      College: ['CA 2', 'CA 3', 'CDI 3C', 'CDI 4C', 'CDI 5C', 'Criminology 5', 'Criminology 7', 'FORENSIC 4C', 'FORENSIC 5C', 'LEA 4N', 'CDI 6C', 'CDI 7', 'CDI 8N', 'CLJ 6', 'Criminology 6', 'Criminology 8', 'FL 100', 'Forensic 6C'],
      Languages: ['Japanese', 'Latin'],
      'Self-Study': ['AI', 'Biology', 'Chemistry', 'Computer Science', 'Analytics', 'Google Ads', 'Google Marketing Platform', 'Local & Other', 'Workspace & AI', 'Mathematics', 'Physics', 'Sales'],
      Resources: ['Articles', 'Books', 'PDFs', 'Photos', 'Podcasts', 'Researches', 'Sketches', 'Videos'],
      People: ['Acquaintances', 'Brothers', 'Coaches', 'Family', 'Friends', 'Influencers', 'Mentors', 'Philosophers', 'Teachers & Instructors'],
      Places: ['Countries', 'Gyms', 'House', 'Province', 'Restaurants']
    },
    dir: (s, t) => {
      if (s === 'Journal') return [H, '05 Journal'];
      if (s === 'College' || s === 'Languages') { const f = findDir(vp(H, '09 Knowledge', s), t, 0); return f ? [rel(f)] : [H, '09 Knowledge', s, t]; }
      if (s === 'Self-Study') { const f = findDir(vp(H, '09 Knowledge', 'Own Curriculum'), t, 0); return f ? [rel(f)] : [H, '09 Knowledge', 'Own Curriculum', t]; }
      if (s === 'Resources') return [H, '10 Resources', t];
      if (s === 'People') return [H, '07 People', t];
      return [H, '08 Places', t];
    } }
};
function findDir(base, name, depth) {
  if (depth > 3 || !exists(base)) return null;
  for (const d of fs.readdirSync(base, { withFileTypes: true })) {
    if (!d.isDirectory() || d.name.startsWith('.')) continue;
    if (d.name === name) return path.join(base, d.name);
    const r = findDir(path.join(base, d.name), name, depth + 1); if (r) return r;
  }
  return null;
}
const dom = (k) => { const d = DOMAINS[String(k || '').toLowerCase()]; if (!d) throw new HttpError(400, 'Unknown library.'); return d; };
const dirFor = (d, s, t) => { if (!d.sections[s] || !d.sections[s].includes(t)) throw new HttpError(400, 'Unknown section or topic.'); return vp(...d.dir(s, t)); };

const FM = /^---\n[\s\S]*?\n---\n?/;
const IMG = /\.(png|jpe?g|gif|webp|svg)$/i;
const ATT = /^!\[\[([^\]|]+\.(?:png|jpe?g|gif|webp|svg|pdf))(?:\|[^\]]*)?\]\]\s*$/i;
const fileUrl = (name) => '/api/file?p=' + encodeURIComponent(name);

function tagsOf(text) {
  const m = text.match(/^---\n([\s\S]*?)\n---/);
  if (!m) return [];
  const inline = m[1].match(/^tags:\s*\[(.*)\]\s*$/m);
  if (inline) return inline[1].split(',').map((x) => x.trim().replace(/^["']|["']$/g, '').replace(/^#/, '')).filter(Boolean);
  const block = m[1].match(/^tags:\s*\n((?:[ \t]*-[ \t]+.*\n?)+)/m);
  if (block) return block[1].split('\n').map((x) => x.replace(/^[ \t]*-[ \t]+/, '').trim().replace(/^["']|["']$/g, '').replace(/^#/, '')).filter(Boolean);
  return [];
}
function setTags(text, tags) {
  const m = text.match(/^---\n([\s\S]*?)\n---/);
  if (!m) return text;
  const val = `tags: [${tags.join(', ')}]`;
  let fm = m[1];
  if (/^tags:.*$/m.test(fm)) fm = fm.replace(/^tags:.*(?:\n[ \t]+-[ \t]+.*)*$/m, val);
  else fm = fm + '\n' + val;
  return text.replace(m[1], () => fm);
}

function parseNote(abs, section_, topic) {
  const { text } = readNote(abs);
  const title = path.basename(abs, '.md');
  if (getFrontmatter(text, 'type') === 'hub') return null;
  const lines = text.replace(FM, '').split('\n');
  // attachments
  const files = [];
  const attIdx = lines.findIndex((l) => /^##\s+Attachments\s*$/i.test(l));
  let bodyLines = lines;
  if (attIdx >= 0) {
    let e = lines.length;
    for (let i = attIdx + 1; i < lines.length; i++) if (/^##\s/.test(lines[i])) { e = i; break; }
    for (let i = attIdx + 1; i < e; i++) { const m = lines[i].match(ATT); if (m) files.push({ id: h8(m[1]), name: m[1], kind: IMG.test(m[1]) ? 'image' : 'pdf', url: fileUrl(m[1]) }); }
    bodyLines = lines.slice(0, attIdx).concat(lines.slice(e));
  }
  // the first "# Title" line is the note's own title
  const ti = bodyLines.findIndex((l) => l.trim() !== '');
  if (ti >= 0 && bodyLines[ti].trim() === '# ' + title) bodyLines.splice(ti, 1);
  const marker = bodyLines.findIndex((l) => l.startsWith('<!-- AUTO-GENERATED'));
  const md = (marker >= 0 ? bodyLines.slice(0, marker) : bodyLines).join('\n').replace(/^\n+|\n+$/g, '');
  const created = getFrontmatter(text, 'created');
  return { id: b64(rel(abs)), section: section_, topic, title, md, body: mdPlain(md), html: mdToHtml(md), tags: tagsOf(text).join(', '), files, date: isDate(created) ? created : new Date(fs.statSync(abs).mtimeMs).toISOString().slice(0, 10), ro: !canWrite(abs) };
}

// College notes sit in a year folder (09 Knowledge/College/<...>/<Year>/<Course>/): the year is shown beside the course.
// It is read from the folder path (the folder whose name has "Year" in it), so renaming or adding a year folder just works.
function yearOf(abs) {
  const parts = path.relative(vp(H, '09 Knowledge', 'College'), abs).split(path.sep).slice(0, -1);
  return parts.find((x) => /\byear\b/i.test(x)) || '';
}
export function listLibrary(domain) {
  const d = dom(domain);
  const out = [];
  for (const [s, topics] of Object.entries(d.sections)) for (const t of topics) {
    const dir = (() => { try { return dirFor(d, s, t); } catch (e) { return null; } })();
    if (!dir || !exists(dir)) continue;
    const list = s === 'Journal' ? fs.readdirSync(dir).filter((f) => f.endsWith('.md')).map((f) => path.join(dir, f)) : walkMd(dir);
    for (const abs of list) {
      try {
        const n = parseNote(abs, s, t);
        if (n) { delete n.md; if (s === 'College') { const y = yearOf(abs); if (y) n.year = y; } out.push(n); }
      } catch (e) { /* unreadable note: skip */ }
    }
  }
  return { notes: out };
}

function locate(id) {
  let r; try { r = unb64(String(id)); } catch (e) { throw new HttpError(400, 'Bad note id.'); }
  if (!r.startsWith(H + '/') || r.includes('..') || !r.endsWith('.md')) throw new HttpError(400, 'Bad note id.');
  const abs = vp(r);
  if (!exists(abs)) throw new HttpError(409, 'That note moved. Refreshing.');
  return abs;
}

export function createNote(b) {
  const d = dom(b.domain);
  const dir = dirFor(d, b.section, b.topic);
  if (b.section === 'Journal') throw new HttpError(403, 'Journal entries are read-only here. Write them in Obsidian.');
  const title = cleanName(b.title);
  if (!title) throw new HttpError(400, 'Give the note a title.');
  const abs = path.join(dir, title + '.md');
  if (exists(abs)) throw new HttpError(409, 'A note with that name already exists there.');
  ensureFromTemplate(abs, 'Note.md', title);
  const { text, eol } = readNote(abs);
  let t = text;
  const tags = String(b.tags || '').split(',').map((x) => x.trim()).filter(Boolean);
  if (tags.length) t = setTags(t, tags);
  const md = htmlToMd(b.html || '');
  if (md.trim()) t = t.replace(/\s*$/, '\n\n') + md + '\n';
  writeNote(abs, t, eol);
  return { ok: true, id: b64(rel(abs)) };
}

export function updateNote(id, b) {
  const abs = locate(id);
  if (!canWrite(abs)) throw new HttpError(403, 'Journal entries are read-only here. Edit them in Obsidian.');
  let { text, eol } = readNote(abs);
  let curAbs = abs;
  if (b.tags !== undefined) {
    const tags = String(b.tags).split(',').map((x) => x.trim()).filter(Boolean);
    text = setTags(text, tags);
  }
  if (b.html !== undefined) {
    const fm = (text.match(/^---\n[\s\S]*?\n---\n\n?/) || [''])[0];
    const rest = text.slice(fm.length).split('\n');
    const title = path.basename(abs, '.md');
    const attIdx = rest.findIndex((l) => /^##\s+Attachments\s*$/i.test(l));
    let attBlock = [];
    let main = rest;
    if (attIdx >= 0) {
      let e = rest.length; for (let i = attIdx + 1; i < rest.length; i++) if (/^##\s/.test(rest[i])) { e = i; break; }
      attBlock = rest.slice(attIdx, e); main = rest.slice(0, attIdx).concat(rest.slice(e));
    }
    const mk = main.findIndex((l) => l.startsWith('<!-- AUTO-GENERATED'));
    const tail = mk >= 0 ? main.slice(mk) : [];
    const head = mk >= 0 ? main.slice(0, mk) : main;
    const ti = head.findIndex((l) => l.trim() !== '');
    const hasTitle = ti >= 0 && head[ti].trim() === '# ' + title;
    const md = htmlToMd(String(b.html));
    const parts = [hasTitle || ti < 0 ? '# ' + title : null, hasTitle || ti < 0 ? '' : null, md].filter((x) => x !== null).join('\n').replace(/\n+$/, '');
    let out = parts + '\n';
    if (attBlock.length) out += '\n' + attBlock.join('\n').replace(/\n+$/, '') + '\n';
    if (tail.length) out += '\n' + tail.join('\n');
    text = fm + out;
  }
  if (b.title !== undefined) {
    const nt = cleanName(b.title);
    const old = path.basename(abs, '.md');
    if (nt && nt !== old) {
      const dest = path.join(path.dirname(abs), nt + '.md');
      if (exists(dest)) throw new HttpError(409, 'A note with that name already exists there.');
      // links elsewhere would break; Obsidian itself fixes them, the app cannot
      const re = new RegExp('\\[\\[' + old.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?:[|#\\]])');
      for (const f of walkMd(vp(H))) { if (f === abs) continue; try { if (re.test(readNote(f).text)) throw new HttpError(409, 'Other notes link to this name. Rename it in Obsidian so the links follow.'); } catch (e) { if (e instanceof HttpError) throw e; } }
      text = text.replace(new RegExp('^# ' + old.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*$', 'm'), '# ' + nt);
      writeNote(abs, touch(text), eol);
      fs.renameSync(abs, dest);
      return { ok: true, id: b64(rel(dest)) };
    }
  }
  writeNote(curAbs, touch(text), eol);
  return { ok: true, id };
}

export function binNote(id) {
  const abs = locate(id);
  if (!canWrite(abs)) throw new HttpError(403, 'Journal entries are read-only here. Edit them in Obsidian.');
  return { ok: true, movedTo: bin(abs) };
}

const ATTDIR = { img: ['1 Human', '10 Resources', 'Photos'], pdf: ['1 Human', '10 Resources', 'PDFs'] };
export function attachFile(id, b) {
  const abs = locate(id);
  if (!canWrite(abs)) throw new HttpError(403, 'That note is read-only here.');
  const name0 = path.basename(String(b.name || 'file')).replace(/[\\/:*?"<>|#^\[\]]/g, ' ').replace(/\s+/g, ' ').trim();
  const isImg = IMG.test(name0), isPdf = /\.pdf$/i.test(name0);
  if (!isImg && !isPdf) throw new HttpError(400, 'Only images and PDFs.');
  const buf = Buffer.from(String(b.data || ''), 'base64');
  if (!buf.length || buf.length > 20 * 1024 * 1024) throw new HttpError(400, 'File is empty or over 20 MB.');
  const dir = vp(...(isPdf ? ATTDIR.pdf : ATTDIR.img));
  fs.mkdirSync(dir, { recursive: true });
  let name = name0, n = 2;
  while (exists(path.join(dir, name))) { name = name0.replace(/(\.[^.]+)$/, ` ${n++}$1`); }
  fs.writeFileSync(path.join(dir, name), buf, { flag: 'wx' });
  if (b.inline && isImg) return { ok: true, file: { id: h8(name), name, kind: 'image', url: fileUrl(name), inline: true } }; // drawn into the note body: the note text already embeds it
  const { text, eol } = readNote(abs);
  const lines = text.split('\n');
  let idx = lines.findIndex((l) => /^##\s+Attachments\s*$/i.test(l));
  if (idx < 0) { const mk = markerIndex(lines); let at = mk; while (at > 0 && /^\s*$/.test(lines[at - 1])) at--; lines.splice(at, 0, '', '## Attachments', ''); idx = at + 1; }
  let at = idx + 1; let e = lines.length; for (let i = idx + 1; i < lines.length; i++) if (/^##\s/.test(lines[i])) { e = i; break; }
  for (let i = idx + 1; i < e; i++) if (ATT.test(lines[i])) at = i + 1;
  if (at === idx + 1 && lines[at] !== undefined && /^\s*$/.test(lines[at])) at = idx + 2;
  lines.splice(at, 0, `![[${name}]]`);
  writeNote(abs, touch(lines.join('\n')), eol);
  return { ok: true, file: { id: h8(name), name, kind: isImg ? 'image' : 'pdf', url: fileUrl(name) } };
}
export function detachFile(id, fileName) {
  const abs = locate(id);
  if (!canWrite(abs)) throw new HttpError(403, 'That note is read-only here.');
  const { text, eol } = readNote(abs);
  const lines = text.split('\n');
  const i = lines.findIndex((l) => { const m = l.match(ATT); return m && m[1] === fileName; });
  if (i < 0) return { ok: true };
  lines.splice(i, 1); // only the embed goes; the file itself stays in 10 Resources
  writeNote(abs, touch(lines.join('\n')), eol);
  return { ok: true };
}
export function readAttachment(p) {
  const name = path.basename(String(p || ''));
  for (const parts of [ATTDIR.img, ATTDIR.pdf]) {
    const abs = path.join(vp(...parts), name);
    if (exists(abs) && fs.statSync(abs).isFile()) return abs;
  }
  throw new HttpError(404, 'No such file.');
}
