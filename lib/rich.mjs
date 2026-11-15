// Markdown <-> the small HTML the in-page editors produce. Lossless for anything it does not recognise: unknown lines stay plain text.
// Shown the way Obsidian shows it: no # or * marks, real headings, bullets, quotes, links.
const esc = (x) => String(x).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const unesc = (x) => String(x).replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
const LINKSTYLE = 'color:#F5F5F5;text-decoration:underline;text-underline-offset:3px;';

function inline(s) {
  const codes = [];
  let t = String(s).replace(/`([^`\n]+)`/g, (m, c) => { codes.push(c); return '\u0001' + (codes.length - 1) + '\u0001'; });
  t = esc(t);
  t = t.replace(/&lt;u&gt;([\s\S]*?)&lt;\/u&gt;/g, '<u>$1</u>');
  t = t.replace(/&lt;span style="font-size:(12|14|20|24|32)px"&gt;([\s\S]*?)&lt;\/span&gt;/g, '<span style="font-size:$1px">$2</span>');
  t = t.replace(/(?<!!)\[\[([^\]"\n]+?)\]\]/g, (m, raw) => {
    const alias = raw.includes('|') ? raw.slice(raw.indexOf('|') + 1) : raw.replace(/#.*$/, '');
    return '<a href="#" class="wl" data-wl="' + raw + '" style="' + LINKSTYLE + '">' + (alias.trim() || raw) + '</a>';
  });
  t = t.replace(/(?<!!)\[([^\]\n]+?)\]\(((?:https?:\/\/|mailto:|tel:)[^\s)"]+)\)/g, (m, text, url) => '<a href="' + url + '" target="_blank" rel="noopener" style="' + LINKSTYLE + '">' + text + '</a>');
  t = t.replace(/\*\*(?=\S)([^*]+?)(?<=\S)\*\*/g, '<b>$1</b>');
  t = t.replace(/(?<![*\w])\*(?=[^\s*])([^*]+?)(?<=[^\s*])\*(?![*\w])/g, '<i>$1</i>');
  t = t.replace(/~~(?=\S)([^~]+?)(?<=\S)~~/g, '<s>$1</s>');
  t = t.replace(/==(?=\S)([^=]+?)(?<=\S)==/g, '<mark>$1</mark>');
  t = t.replace(/\u0001(\d+)\u0001/g, (m, i) => '<code>' + esc(codes[Number(i)]) + '</code>');
  return t;
}
const SIZES = [12, 14, 16, 20, 24, 32];
const nearSize = (n) => SIZES.reduce((a, b) => (Math.abs(b - n) < Math.abs(a - n) ? b : a), 16);
const FONT_PX = { 1: 12, 2: 12, 3: 16, 4: 20, 5: 24, 6: 32, 7: 32 };
// the only raw HTML the notes accept back from a markdown file; everything else is shown as plain text
function safeHtml(s) {
  let t = String(s).replace(/&(?!(?:amp|lt|gt|quot|#39|nbsp);)/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  t = t.replace(/&lt;(\/?)(b|i|s|u|mark|code)&gt;/g, '<$1$2>').replace(/&lt;br\s*\/?&gt;/g, '<br>');
  t = t.replace(/&lt;span style="font-size:(12|14|20|24|32)px"&gt;/g, '<span style="font-size:$1px">').replace(/&lt;\/span&gt;/g, '</span>');
  t = t.replace(/&lt;a href="((?:https?:\/\/|mailto:|tel:)[^"\s<>]*)"&gt;/g, (m, u) => '<a href="' + u + '" target="_blank" rel="noopener" style="' + LINKSTYLE + '">').replace(/&lt;\/a&gt;/g, '</a>');
  return t;
}
export function mdToHtml(md) {
  const out = [];
  const lines = String(md || '').split('\n');
  const stack = []; // open lists: 'ul' | 'ol'
  const closeTo = (d) => { while (stack.length > d) out.push('</' + stack.pop() + '>'); };
  for (const l of lines) {
    const b = l.match(/^(\s*)(?:([-*])|(\d+)\.)\s+(.*)$/);
    if (b) {
      const type = b[3] ? 'ol' : 'ul';
      const d = Math.floor(b[1].replace(/\t/g, '  ').length / 2) + 1;
      while (stack.length < d) { out.push('<' + type + '>'); stack.push(type); }
      closeTo(d);
      if (stack[d - 1] !== type) { out.push('</' + stack.pop() + '>'); out.push('<' + type + '>'); stack.push(type); }
      const tk = !b[3] && b[4].match(/^\[([ xX])\](?:\s+(.*))?$/);
      if (tk) out.push('<li data-task="' + (tk[1] === ' ' ? 0 : 1) + '">' + inline(tk[2] || '') + (tk[2] ? '' : '<br>') + '</li>');
      else out.push(b[3] ? '<li value="' + b[3] + '">' + inline(b[4]) + '</li>' : '<li>' + inline(b[4]) + '</li>');
      continue;
    }
    closeTo(0);
    const em = l.match(/^!\[\[([^\]|\n"<>]+\.(?:png|jpe?g|gif|webp))\]\]\s*$/i);
    if (em) { out.push('<div><img data-att="' + em[1] + '" src="/api/file?p=' + encodeURIComponent(em[1]) + '" alt="' + em[1] + '" style="max-width:100%;border-radius:12px;display:block;"></div>'); continue; }
    const al = l.match(/^<(div|h[1-6]) style="text-align:(center|right|justify)">(.*)<\/\1>\s*$/);
    if (al) { out.push('<' + al[1] + ' style="text-align:' + al[2] + '">' + safeHtml(al[3]) + '</' + al[1] + '>'); continue; }
    const h = l.match(/^(#{1,6})\s+(.*)$/);
    if (h) { out.push(`<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`); continue; }
    const q = l.match(/^>\s?(.*)$/);
    if (q) { out.push('<blockquote>' + inline(q[1]) + '</blockquote>'); continue; }
    const hr = l.match(/^(-{3,}|\*{3,}|_{3,})\s*$/);
    if (hr) { out.push('<hr data-md="' + hr[1] + '">'); continue; }
    out.push(l.trim() === '' ? '<div><br></div>' : '<div>' + inline(l) + '</div>');
  }
  closeTo(0);
  return out.join('');
}
export function mdPlain(md) {
  return String(md || '').replace(/(?<!!)\[\[([^\]\n|]*\|)?([^\]\n]+?)\]\]/g, '$2').replace(/\[([^\]\n]+?)\]\((?:https?:\/\/|mailto:|tel:)[^\s)]+\)/g, '$1')
    .replace(/^#{1,6}\s+/gm, '').replace(/^>\s?/gm, '').replace(/\*\*(.+?)\*\*/g, '$1').replace(/(?<![*\w])\*(.+?)\*(?![*\w])/g, '$1')
    .replace(/~~(.+?)~~/g, '$1').replace(/==(.+?)==/g, '$1').replace(/`([^`\n]+)`/g, '$1')  .replace(/^!\[\[[^\]\n]+\]\]\s*$/gm, '').replace(/<\/?(?:u|b|i|s|mark|code|span|div|a|h[1-6]|br)\b[^>]*>/g, '');
}
export function htmlToMd(html) {
  const toks = String(html || '').replace(/\r?\n/g, ' ').split(/(<[^>]+>)/).filter((x) => x !== '');
  const blocks = [];
  const lists = []; // {type, n}
  let cur = '', prefix = '', li = false, skip = false, bq = false, task = null;
  let ah = null, adepth = 0; // aligned block: {name, align}; html mode inside it
  const spans = []; // open font/span tags: closing text or ''
  const indent = () => '  '.repeat(Math.max(0, lists.length - 1));
  const bullet = () => { const top = lists[lists.length - 1]; return indent() + (top && top.type === 'ol' ? (top.n || 1) + '. ' : '- ') + (task != null && !(top && top.type === 'ol') ? (task ? '[x] ' : '[ ] ') : ''); };
  const links = [];
  const flush = (force) => { if (cur.trim() !== '') blocks.push(prefix + cur.replace(/\s+$/, '')); else if (force) blocks.push(''); cur = ''; prefix = li ? bullet() : ''; };
  const alignOf = (t) => { const m = t.match(/text-align:\s*(center|right|justify)/i) || t.match(/\salign="(center|right|justify)"/i); return m ? m[1].toLowerCase() : null; };
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    const tag = t.match(/^<(\/?)([a-zA-Z0-9]+)[^>]*>$/);
    if (!tag) { if (!skip) cur += ah ? esc(unesc(t)) : unesc(t); continue; }
    const close = !!tag[1], name = tag[2].toLowerCase();
    if (name === 'img') { const at = t.match(/data-att="([^"]+)"/); if (at) { flush(); blocks.push('![[' + unesc(at[1]) + ']]'); } continue; }
    if (name === 'br') {
      const next = toks[i + 1] || '';
      if (ah) { if (!/^<\//.test(next) && next !== '' && cur.trim() !== '') cur += '<br>'; continue; }
      if (cur.trim() === '') { if (!li && !bq) blocks.push(''); }
      else if (/^<\//.test(next) || next === '') { /* trailing br inside a block */ }
      else flush();
      continue;
    }
    if (name === 'a') {
      if (close) { skip = false; const l = links.pop(); if (l && l.href) cur += ah ? '</a>' : '](' + l.href + ')'; continue; }
      const wl = t.match(/data-wl="([^"]*)"/);
      if (wl) { cur += '[[' + unesc(wl[1]) + ']]'; skip = true; links.push(null); continue; }
      const hr = t.match(/href="((?:https?:\/\/|mailto:|tel:)[^"]*)"/);
      if (hr) { cur += ah ? '<a href="' + esc(unesc(hr[1])) + '">' : '['; links.push({ href: unesc(hr[1]) }); } else links.push(null);
      continue;
    }
    if (name === 'b' || name === 'strong') { cur += ah ? (close ? '</b>' : '<b>') : '**'; continue; }
    if (name === 'i' || name === 'em') { cur += ah ? (close ? '</i>' : '<i>') : '*'; continue; }
    if (name === 'u') { cur += close ? '</u>' : '<u>'; continue; }
    if (name === 's' || name === 'del' || name === 'strike') { cur += ah ? (close ? '</s>' : '<s>') : '~~'; continue; }
    if (name === 'mark') { cur += ah ? (close ? '</mark>' : '<mark>') : '=='; continue; }
    if (name === 'code') { cur += ah ? (close ? '</code>' : '<code>') : '`'; continue; }
    if (name === 'span' || name === 'font') {
      const eff = spans.length ? spans[spans.length - 1].eff : 16;
      if (close) {
        const e = spans.pop(); if (!e) continue;
        if (e.eff !== e.prev) { if (e.eff !== 16) cur += '</span>'; if (e.prev !== 16) cur += '<span style="font-size:' + e.prev + 'px">'; }
        continue;
      }
      let px = null;
      const fs = t.match(/font-size:\s*(\d+(?:\.\d+)?)px/i);
      if (fs) px = nearSize(Number(fs[1]));
      else if (name === 'font') { const f = t.match(/size="(\d)"/); if (f) px = FONT_PX[f[1]]; }
      const ne = px == null ? eff : px;
      if (ne !== eff) { if (eff !== 16) cur += '</span>'; if (ne !== 16) cur += '<span style="font-size:' + ne + 'px">'; }
      spans.push({ eff: ne, prev: eff });
      continue;
    }
    if (name === 'hr') { flush(); const m = t.match(/data-md="([^"]*)"/); blocks.push(m ? m[1] : '---'); continue; }
    if (name === 'blockquote') { if (close) { blocks.push(cur.trim() === '' ? '>' : '> ' + cur.replace(/\s+$/, '')); cur = ''; bq = false; } else { flush(); bq = true; } continue; }
    if (name === 'ul' || name === 'ol') {
      flush();
      if (close) lists.pop(); else lists.push({ type: name, n: 0 });
      li = false; prefix = ''; task = null;
      continue;
    }
    if (name === 'li') {
      if (close) { if (cur.trim() === '' && li) blocks.push(prefix.replace(/\s+$/, '') + ' '); else flush(); cur = ''; li = false; prefix = ''; task = null; }
      else {
        flush();
        const top = lists[lists.length - 1];
        if (top) { const v = t.match(/value="(\d+)"/); top.n = v ? Number(v[1]) : (top.n || 0) + 1; }
        const tk = t.match(/data-task="([01])"/);
        task = tk ? Number(tk[1]) : null;
        li = true; prefix = bullet();
      }
      continue;
    }
    const isH = /^h[1-6]$/.test(name);
    if (isH || name === 'div' || name === 'p') {
      if (ah) {
        if (close) { adepth--; if (adepth <= 0) { const body = cur.replace(/\s+$/, ''); blocks.push(body.trim() ? '<' + ah.name + ' style="text-align:' + ah.align + '">' + body + '</' + ah.name + '>' : ''); cur = ''; ah = null; adepth = 0; } }
        else { adepth++; if (cur.trim() !== '' && !/<br>$/.test(cur)) cur += '<br>'; }
        continue;
      }
      if (!close && !li && !bq) { const a = alignOf(t); if (a) { flush(); ah = { name: isH ? name : 'div', align: a }; adepth = 1; cur = ''; continue; } }
      if (isH) { if (close) { const lvl = Number(name[1]); if (cur.trim()) blocks.push('#'.repeat(lvl) + ' ' + cur.replace(/\s+$/, '')); cur = ''; } else flush(); continue; }
      flush(); continue;
    }
    // anything else: keep the text, drop the tag
  }
  flush();
  // collapse the bold/italic markers that ended up empty or doubled
  return blocks.join('\n').replace(/\*\*\*\*/g, '').replace(/\*\*([ \t]*)\*\*/g, '$1').replace(/\n+$/, '');
}
