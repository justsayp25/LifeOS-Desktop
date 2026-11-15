// Note editor tools shared by every library note: checklists, indent, font size, alignment, auto-links and handwriting.
// Everything here works on the #rt-ed element and the document; the pages only call these from their toolbar.
(function () {
  if (window.NoteEd) return;
  const LINKSTYLE = 'color:#F5F5F5;text-decoration:underline;text-underline-offset:3px;';
  const SIZES = [12, 14, 16, 20, 24, 32];
  const ed = () => document.getElementById('rt-ed');
  const changed = () => { const el = ed(); if (el) el.dispatchEvent(new Event('input', { bubbles: true })); };
  const focusEd = () => { const el = ed(); if (el && document.activeElement !== el) el.focus(); return el; };
  let busy = false; // while a command runs, hold back the page's own input handler so it can't re-render mid-edit
  const exec = (c, v) => { busy = true; try { document.execCommand(c, false, v == null ? null : v); } catch (e) {} busy = false; };
  const inEd = (n) => { const el = ed(); return !!(el && n && el.contains(n)); };
  const selRange = () => { const s = window.getSelection(); return s && s.rangeCount ? s.getRangeAt(0) : null; };
  const liOf = (n) => { const el = ed(); let x = n && n.nodeType === 3 ? n.parentNode : n; while (x && x !== el) { if (x.nodeName === 'LI') return x; x = x.parentNode; } return null; };
  const selLis = () => {
    const el = ed(), r = selRange(); if (!el || !r) return [];
    const hit = Array.from(el.querySelectorAll('li')).filter((li) => { try { return r.intersectsNode(li); } catch (e) { return false; } });
    return hit.filter((li) => !hit.some((o) => o !== li && li.contains(o)));
  };

  // the caret can land just outside a brand-new list; find its items anyway
  const lisNear = () => {
    let lis = selLis(); if (lis.length) return lis;
    const r = selRange(); if (!r) return [];
    const c = r.startContainer; const n = c.childNodes && (c.childNodes[r.startOffset] || c.childNodes[r.startOffset - 1]);
    if (!n || n.nodeType !== 1) return [];
    if (n.nodeName === 'LI') return [n];
    return n.querySelectorAll ? Array.from(n.querySelectorAll('li')).slice(0, 1) : [];
  };

  // ---- font size: browsers give <font size=7>, we turn it into a plain px span (or drop it for body size)
  let pendingPx = 16;
  function fixFonts() {
    const el = ed(); if (!el) return;
    el.querySelectorAll('font').forEach((f) => {
      const sz = f.getAttribute('size');
      let px = sz === '7' ? pendingPx : ({ 1: 12, 2: 12, 3: 16, 4: 20, 5: 24, 6: 32 })[sz] || 16;
      // a size inside another size replaces it
      f.querySelectorAll('span[style*="font-size"]').forEach((s) => { s.style.fontSize = ''; if (!s.getAttribute('style')) { while (s.firstChild) s.parentNode.insertBefore(s.firstChild, s); s.remove(); } });
      if (px === 16) { while (f.firstChild) f.parentNode.insertBefore(f.firstChild, f); f.remove(); return; }
      const sp = document.createElement('span'); sp.style.fontSize = px + 'px';
      while (f.firstChild) sp.appendChild(f.firstChild);
      f.parentNode.replaceChild(sp, f);
    });
    // spans that lost their size
    el.querySelectorAll('span').forEach((s) => { if (!s.getAttribute('style') && !s.attributes.length) { while (s.firstChild) s.parentNode.insertBefore(s.firstChild, s); s.remove(); } });
  }
  const size = (px) => { const el = focusEd(); if (!el) return; pendingPx = px; exec('styleWithCSS', false); exec('fontSize', '7'); fixFonts(); changed(); };
  const align = (a) => { const el = focusEd(); if (!el) return; exec({ left: 'justifyLeft', center: 'justifyCenter', right: 'justifyRight', justify: 'justifyFull' }[a] || 'justifyLeft'); changed(); };
  const block = (tag) => { const el = focusEd(); if (!el) return; exec('formatBlock', tag); changed(); };

  // ---- lists
  const todo = () => {
    const el = focusEd(); if (!el) return;
    let lis = selLis();
    if (!lis.length) { exec('insertUnorderedList'); lis = lisNear(); }
    if (!lis.length) { changed(); return; }
    const allOn = lis.every((li) => li.hasAttribute('data-task'));
    lis.forEach((li) => { if (allOn) li.removeAttribute('data-task'); else if (!li.hasAttribute('data-task')) li.setAttribute('data-task', '0'); });
    // the list must be a bullet list for tasks
    changed();
  };
  const bullets = () => {
    const el = focusEd(); if (!el) return;
    const lis = selLis();
    if (lis.length && lis.some((li) => li.hasAttribute('data-task')) && lis[0].parentNode.nodeName === 'UL') { lis.forEach((li) => li.removeAttribute('data-task')); changed(); return; }
    exec('insertUnorderedList'); changed();
  };
  const numbers = () => {
    const el = focusEd(); if (!el) return;
    exec('insertOrderedList');
    el.querySelectorAll('ol > li[data-task]').forEach((li) => li.removeAttribute('data-task'));
    changed();
  };
  const indent = () => {
    const el = focusEd(); if (!el) return;
    if (!selLis().length) { exec('insertUnorderedList'); changed(); return; }
    exec('indent'); changed();
  };
  const outdent = () => { const el = focusEd(); if (!el) return; exec('outdent'); changed(); };
  const strike = () => { focusEd(); exec('strikeThrough'); changed(); };
  const undo = () => { focusEd(); exec('undo'); changed(); };
  const redo = () => { focusEd(); exec('redo'); changed(); };

  // ---- auto links (only while typing)
  function classify(tok) {
    const t = tok.replace(/^[(\[<"']+/, '').replace(/[.,;:!?)\]>"']+$/, '');
    if (!t) return null;
    if (/^https?:\/\/[^\s/$.?#][^\s]*$/i.test(t)) return { t, href: t };
    if (/^www\.[^\s.]+\.[^\s]{2,}$/i.test(t)) return { t, href: 'https://' + t };
    if (/^[^\s@\/]+@[^\s@\/]+\.[a-z]{2,}$/i.test(t)) return { t, href: 'mailto:' + t };
    if (/^\+?[\d()\-]{7,20}$/.test(t) && !/^\d{4}-\d{2}-\d{2}$/.test(t) && !/^\d{1,2}-\d{1,2}-\d{2,4}$/.test(t)) {
      const digits = t.replace(/\D/g, '');
      if (digits.length >= 7 && digits.length <= 15 && (/[+()\-]/.test(t) || digits.length >= 10)) return { t, href: 'tel:' + (t[0] === '+' ? '+' : '') + digits };
    }
    return null;
  }
  function linkify(node, end) {
    if (!node || node.nodeType !== 3 || node.parentNode.closest('a')) return null;
    const before = node.data.slice(0, end);
    const m = before.match(/(\S+)$/); if (!m) return null;
    const c = classify(m[1]); if (!c) return null;
    const start = end - m[1].length + m[1].indexOf(c.t);
    const stop = start + c.t.length;
    const r = document.createRange(); r.setStart(node, start); r.setEnd(node, stop);
    const a = document.createElement('a');
    a.setAttribute('href', c.href); a.setAttribute('target', '_blank'); a.setAttribute('rel', 'noopener'); a.setAttribute('style', LINKSTYLE);
    r.surroundContents(a);
    return a;
  }
  function onInput(e) {
    if (busy) { e.stopImmediatePropagation(); return; }
    const el = ed(); if (!el || !e.target || !(e.target === el || el.contains(e.target))) return;
    const it = e.inputType, sel = window.getSelection();
    if (!sel || !sel.rangeCount || !sel.isCollapsed) return;
    if (el.querySelector('font[size="7"]')) { fixFonts(); }
    let did = false;
    if (it === 'insertParagraph') {
      const li = liOf(sel.anchorNode);
      if (li && li.getAttribute('data-task') === '1' && !li.textContent.trim()) li.setAttribute('data-task', '0');
      if (li && li.hasAttribute('data-task') && li.getAttribute('data-task') === '1') li.setAttribute('data-task', '0');
      // link the word that ended the previous line
      try {
        const tw = document.createTreeWalker(el, NodeFilter.SHOW_TEXT); tw.currentNode = sel.anchorNode;
        let n = tw.previousNode(); while (n && !n.data.trim()) n = tw.previousNode();
        if (n && !n.parentNode.closest('a')) did = !!linkify(n, n.data.replace(/\s+$/, '').length);
      } catch (err) {}
    } else if (it === 'insertText' && e.data === ' ' && sel.anchorNode && sel.anchorNode.nodeType === 3) {
      const node = sel.anchorNode, off = sel.anchorOffset;
      if (node.data[off - 1] === ' ' || node.data[off - 1] === ' ') {
        try {
          const a = linkify(node, off - 1);
          if (a) {
            did = true;
            const nx = a.nextSibling; const r = document.createRange();
            if (nx && nx.nodeType === 3) r.setStart(nx, Math.min(1, nx.data.length)); else r.setStartAfter(a);
            r.collapse(true); sel.removeAllRanges(); sel.addRange(r);
          }
        } catch (err) {}
      }
    }
    if (did || it === 'insertParagraph') changed();
  }
  function onClick(e) {
    const el = ed(); if (!el || !el.contains(e.target)) return;
    const li = e.target.nodeName === 'LI' ? e.target : null;
    if (li && li.hasAttribute('data-task')) {
      const b = li.getBoundingClientRect();
      if (e.clientX - b.left < 30 && e.clientX >= b.left) { e.preventDefault(); li.setAttribute('data-task', li.getAttribute('data-task') === '1' ? '0' : '1'); changed(); return; }
    }
    const a = e.target.closest && e.target.closest('a[href]');
    if (a && el.contains(a) && !a.hasAttribute('data-wl')) {
      const h = a.getAttribute('href') || '';
      if (/^https?:/i.test(h)) { e.preventDefault(); window.open(h, '_blank', 'noopener'); }
      else if (/^(tel|mailto):/i.test(h)) { e.preventDefault(); location.href = h; }
    }
  }
  function onKey(e) {
    const el = ed(); if (!el || e.target !== el) return;
    if (e.key === 'Tab' && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); if (e.shiftKey) outdent(); else indent(); }
  }
  document.addEventListener('input', onInput, true);
  document.addEventListener('click', onClick, true);
  document.addEventListener('keydown', onKey, true);

  // ---- Aa popover
  let pop = null;
  const closePop = () => { if (pop) { pop.remove(); pop = null; document.removeEventListener('pointerdown', outside, true); } };
  function outside(e) { if (pop && !pop.contains(e.target) && !(e.target.closest && e.target.closest('[aria-label="Text size and alignment"]'))) closePop(); }
  const mk = (tag, css, txt) => { const x = document.createElement(tag); if (css) x.style.cssText = css; if (txt != null) x.textContent = txt; return x; };
  const BTN = 'min-width:44px;height:44px;padding:0 8px;display:flex;align-items:center;justify-content:center;background:#222;border:1px solid #333;border-radius:12px;color:#E4E4E4;cursor:pointer;font-family:"IBM Plex Sans",sans-serif;box-sizing:border-box;flex:0 0 auto;';
  const ALIGN_ICON = {
    left: '<line x1="4" y1="6" x2="20" y2="6"/><line x1="4" y1="11" x2="14" y2="11"/><line x1="4" y1="16" x2="20" y2="16"/><line x1="4" y1="21" x2="14" y2="21"/>',
    center: '<line x1="4" y1="6" x2="20" y2="6"/><line x1="7" y1="11" x2="17" y2="11"/><line x1="4" y1="16" x2="20" y2="16"/><line x1="7" y1="21" x2="17" y2="21"/>',
    right: '<line x1="4" y1="6" x2="20" y2="6"/><line x1="10" y1="11" x2="20" y2="11"/><line x1="4" y1="16" x2="20" y2="16"/><line x1="10" y1="21" x2="20" y2="21"/>',
    justify: '<line x1="4" y1="6" x2="20" y2="6"/><line x1="4" y1="11" x2="20" y2="11"/><line x1="4" y1="16" x2="20" y2="16"/><line x1="4" y1="21" x2="20" y2="21"/>'
  };
  function aa(anchor) {
    if (pop) { closePop(); return; }
    const el = ed(); if (!el) return;
    pop = mk('div', 'position:fixed;z-index:9000;background:#1A1A1A;border:1px solid #333;border-radius:16px;padding:10px;display:flex;flex-direction:column;gap:8px;box-shadow:0 12px 32px rgba(0,0,0,.5);max-width:calc(100vw - 16px);box-sizing:border-box;');
    pop.setAttribute('role', 'dialog'); pop.setAttribute('aria-label', 'Text size and alignment');
    const row = (label) => { const w = mk('div', 'display:flex;flex-direction:column;gap:4px;'); w.appendChild(mk('div', 'font:500 10px "IBM Plex Mono",monospace;letter-spacing:.08em;color:#8A8A8A;', label)); const r = mk('div', 'display:flex;gap:6px;flex-wrap:wrap;'); w.appendChild(r); pop.appendChild(w); return r; };
    const add = (r, html, label, fn, css) => { const b = mk('button', BTN + (css || '')); b.type = 'button'; b.setAttribute('aria-label', label); b.innerHTML = html; b.addEventListener('mousedown', (e) => e.preventDefault()); b.addEventListener('click', () => { fn(); }); r.appendChild(b); };
    const r1 = row('SIZE');
    SIZES.forEach((px) => add(r1, String(px), 'Font size ' + px, () => size(px), 'font-size:13px;'));
    const r2 = row('STYLE');
    add(r2, 'Body', 'Body text', () => { block('div'); size(16); }, 'font-size:14px;');
    add(r2, 'Heading', 'Heading', () => block('h2'), 'font:600 16px "Space Grotesk",sans-serif;');
    add(r2, 'Title', 'Title', () => block('h1'), 'font:600 20px "Space Grotesk",sans-serif;');
    const r3 = row('ALIGN');
    ['left', 'center', 'right', 'justify'].forEach((a) => add(r3, '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">' + ALIGN_ICON[a] + '</svg>', 'Align ' + a, () => align(a)));
    document.body.appendChild(pop);
    const br = anchor && anchor.getBoundingClientRect ? anchor.getBoundingClientRect() : { left: 8, bottom: 80, top: 80 };
    const pw = pop.offsetWidth, ph = pop.offsetHeight;
    let left = Math.max(8, Math.min(br.left, window.innerWidth - pw - 8));
    let top = br.bottom + 8; if (top + ph > window.innerHeight - 8) top = Math.max(8, br.top - ph - 8);
    pop.style.left = left + 'px'; pop.style.top = top + 'px';
    setTimeout(() => document.addEventListener('pointerdown', outside, true), 0);
  }

  // ---- handwriting
  function draw(onBlob) {
    closePop();
    try { if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); } catch (e) {}
    const wrap = mk('div', 'position:fixed;inset:0;z-index:9500;background:#121212;display:flex;flex-direction:column;font-family:"IBM Plex Sans",sans-serif;color:#E4E4E4;touch-action:none;overscroll-behavior:contain;');
    wrap.setAttribute('role', 'dialog'); wrap.setAttribute('aria-label', 'Handwriting');
    const bar = mk('div', 'display:flex;align-items:center;gap:6px;padding:8px 10px;border-bottom:1px solid #292929;flex:0 0 auto;flex-wrap:wrap;');
    const tools = mk('div', 'display:flex;flex-direction:column;gap:8px;padding:8px 10px calc(8px + env(safe-area-inset-bottom));border-top:1px solid #292929;flex:0 0 auto;background:#121212;');
    const rowT = mk('div', 'display:flex;align-items:center;justify-content:center;gap:6px;flex-wrap:wrap;');
    const rowC = mk('div', 'display:flex;align-items:center;justify-content:center;gap:6px;flex-wrap:wrap;');
    const rowW = mk('div', 'display:flex;align-items:center;gap:10px;max-width:520px;width:100%;align-self:center;');
    tools.appendChild(rowT); tools.appendChild(rowC); tools.appendChild(rowW);
    const stage = mk('div', 'position:relative;flex:1 1 auto;min-height:0;');
    const cv = mk('canvas', 'position:absolute;inset:0;width:100%;height:100%;touch-action:none;cursor:crosshair;background:#1A1A1A;');
    cv.setAttribute('aria-label', 'Drawing area');
    const chip = mk('div', 'position:absolute;left:10px;top:10px;display:flex;align-items:center;gap:8px;padding:6px 12px 6px 10px;border-radius:999px;background:#F5F5F5;color:#121212;font:600 13px "IBM Plex Sans",sans-serif;pointer-events:none;z-index:2;box-shadow:0 4px 14px rgba(0,0,0,.4);');
    chip.setAttribute('aria-live', 'polite');
    const hint = mk('div', 'position:absolute;inset:0;display:flex;align-items:center;justify-content:center;pointer-events:none;color:#6A6A6A;font:500 15px "IBM Plex Sans",sans-serif;text-align:center;padding:0 24px;', 'Draw here with your finger, stylus or mouse');
    stage.appendChild(cv); stage.appendChild(hint); stage.appendChild(chip); wrap.appendChild(bar); wrap.appendChild(stage); wrap.appendChild(tools); document.body.appendChild(wrap);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const ctx = cv.getContext('2d');
    const sizeCv = () => { const r = stage.getBoundingClientRect(); const w = Math.max(1, Math.round(r.width)), h = Math.max(1, Math.round(r.height)); if (cv.width !== w * dpr || cv.height !== h * dpr) { cv.width = w * dpr; cv.height = h * dpr; redraw(); } };
    // pen types: width range, opacity, whether a stylus's pressure changes the width
    const T = {
      pen: { name: 'Pen', w: 3, min: 1, max: 20, alpha: 1, pressure: true, color: '#F5F5F5' },
      fine: { name: 'Fine liner', w: 1.5, min: 0.5, max: 6, alpha: 1, pressure: false, color: '#F5F5F5' },
      marker: { name: 'Marker', w: 8, min: 3, max: 36, alpha: 1, pressure: false, color: '#F5F5F5' },
      pencil: { name: 'Pencil', w: 3, min: 1, max: 14, alpha: 0.65, pressure: true, color: '#F5F5F5' },
      hl: { name: 'Highlighter', w: 18, min: 8, max: 56, alpha: 0.38, pressure: false, color: '#F2D54B' },
      erase: { name: 'Eraser', w: 16, min: 6, max: 60, alpha: 1, pressure: false, color: '#F5F5F5' }
    };
    const KEY = 'lifeos.draw';
    try { const sv = JSON.parse(localStorage.getItem(KEY) || '{}'); Object.keys(T).forEach((k) => { if (sv[k]) { if (typeof sv[k].w === 'number') T[k].w = Math.max(T[k].min, Math.min(T[k].max, sv[k].w)); if (/^#[0-9a-f]{6}$/i.test(sv[k].color || '')) T[k].color = sv[k].color; } }); } catch (e) {}
    const persist = () => { try { const o = {}; Object.keys(T).forEach((k) => { o[k] = { w: T[k].w, color: T[k].color }; }); localStorage.setItem(KEY, JSON.stringify(o)); } catch (e) {} };
    let tool = 'pen', lastPen = 'pen', strokes = [], redoS = [], cur = null;
    const paint = (s, upto) => {
      const p = s.pts; if (!p.length) return;
      ctx.save(); ctx.scale(dpr, dpr);
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      ctx.strokeStyle = s.color; ctx.fillStyle = s.color; ctx.globalAlpha = s.alpha;
      const n = upto == null ? p.length : upto;
      if (n === 1 || p.length === 1) { ctx.beginPath(); ctx.arc(p[0][0], p[0][1], Math.max(0.6, s.w * (s.pressure ? p[0][2] : 1) / 2), 0, Math.PI * 2); ctx.fill(); ctx.restore(); return; }
      if (s.alpha < 1 || !s.pressure) {
        ctx.lineWidth = s.w; ctx.beginPath(); ctx.moveTo(p[0][0], p[0][1]);
        for (let i = 1; i < n - 1; i++) ctx.quadraticCurveTo(p[i][0], p[i][1], (p[i][0] + p[i + 1][0]) / 2, (p[i][1] + p[i + 1][1]) / 2);
        ctx.lineTo(p[n - 1][0], p[n - 1][1]); ctx.stroke();
      } else {
        for (let i = 1; i < n; i++) { ctx.lineWidth = s.w * p[i][2]; ctx.beginPath(); const a = p[i - 1], b = p[i]; ctx.moveTo((a[0] + b[0]) / 2, (a[1] + b[1]) / 2); const c = p[i + 1] && i + 1 < n ? p[i + 1] : b; ctx.quadraticCurveTo(b[0], b[1], (b[0] + c[0]) / 2, (b[1] + c[1]) / 2); ctx.stroke(); }
      }
      ctx.restore();
    };
    function redraw() { ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, cv.width, cv.height); ctx.restore(); strokes.forEach((s) => paint(s)); if (cur) paint(cur); sync(); }
    const pt = (e) => { const r = cv.getBoundingClientRect(); const pr = e.pointerType === 'pen' && e.pressure > 0 ? 0.35 + e.pressure * 1.1 : 1; return [e.clientX - r.left, e.clientY - r.top, pr]; };
    const eraseAt = (x, y) => { const R = T.erase.w; const before = strokes.length; strokes = strokes.filter((s) => !s.pts.some((q) => (q[0] - x) * (q[0] - x) + (q[1] - y) * (q[1] - y) < (R + s.w / 2) * (R + s.w / 2))); if (strokes.length !== before) { redoS = []; return true; } return false; };
    let erased = null;
    cv.addEventListener('pointerdown', (e) => {
      e.preventDefault(); try { cv.setPointerCapture(e.pointerId); } catch (x) {}
      hint.style.display = 'none';
      const p = pt(e);
      if (tool === 'erase') { erased = strokes.slice(); if (eraseAt(p[0], p[1])) redraw(); return; }
      const t = T[tool];
      cur = { tool, color: t.color, w: t.w, alpha: t.alpha, pressure: t.pressure, pts: [p] };
      paint(cur, 1);
    });
    cv.addEventListener('pointermove', (e) => {
      if (tool === 'erase') { if (e.buttons || e.pressure > 0) { const p = pt(e); if (erased && eraseAt(p[0], p[1])) redraw(); } return; }
      if (!cur) return;
      e.preventDefault();
      const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
      (evs.length ? evs : [e]).forEach((ev) => cur.pts.push(pt(ev)));
      if (cur.alpha < 1 || !cur.pressure) redraw(); else paint({ ...cur, pts: cur.pts.slice(-4) });
    });
    const end = () => { if (cur) { strokes.push(cur); cur = null; redoS = []; redraw(); } erased = null; };
    cv.addEventListener('pointerup', end); cv.addEventListener('pointercancel', end);
    const mkb = (html, label, fn, extra, into) => { const b = mk('button', BTN + (extra || '')); b.type = 'button'; b.setAttribute('aria-label', label); b.innerHTML = html; b.addEventListener('click', fn); (into || bar).appendChild(b); return b; };
    const ic = (d) => '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + d + '</svg>';
    const PENSVG = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>';
    const toolBtns = {};
    const ICONS = {
      pen: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
      fine: '<path d="M4 20 20 4"/><circle cx="4.5" cy="19.5" r="1.4"/>',
      marker: '<path d="M4 20l1.5-4.5L16 5l3 3L8.5 18.5Z"/><path d="m14 7 3 3"/>',
      pencil: '<path d="M17 3a2.8 2.8 0 0 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/>',
      hl: '<path d="m9 11-6 6v3h9l3-3"/><path d="m22 12-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 4"/>',
      erase: '<path d="m7 21-4.3-4.3c-1-1-1-2.5 0-3.4l9.6-9.6c1-1 2.5-1 3.4 0l5.6 5.6c1 1 1 2.5 0 3.4L13 21"/><path d="M22 21H7"/><path d="m5 11 9 9"/>'
    };
    // width slider + preview
    const wLabel = mk('span', 'font:500 11px "IBM Plex Mono",monospace;letter-spacing:.08em;color:#8A8A8A;flex:0 0 auto;', 'WIDTH');
    const slider = mk('input', 'flex:1 1 auto;min-width:0;height:36px;accent-color:#F5F5F5;');
    slider.type = 'range'; slider.setAttribute('aria-label', 'Stroke width'); slider.step = '0.5';
    const pvBox = mk('div', 'flex:0 0 56px;height:44px;border-radius:12px;background:#1A1A1A;border:1px solid #333;display:flex;align-items:center;justify-content:center;overflow:hidden;');
    const pv = mk('span', 'display:block;border-radius:50%;');
    pvBox.appendChild(pv);
    const wNum = mk('span', 'font:500 12px "IBM Plex Mono",monospace;color:#BDBDBD;flex:0 0 34px;text-align:right;');
    rowW.appendChild(wLabel); rowW.appendChild(slider); rowW.appendChild(pvBox); rowW.appendChild(wNum);
    const showW = () => { const t = T[tool]; slider.min = t.min; slider.max = t.max; slider.value = t.w; wNum.textContent = (Math.round(t.w * 10) / 10) + 'px'; const d = Math.max(2, Math.min(40, t.w)); pv.style.width = d + 'px'; pv.style.height = d + 'px'; pv.style.background = tool === 'erase' ? 'transparent' : t.color; pv.style.opacity = tool === 'erase' ? '1' : String(Math.max(0.45, t.alpha)); pv.style.border = tool === 'erase' ? '2px dashed #8A8A8A' : '0'; };
    slider.addEventListener('input', () => { T[tool].w = Number(slider.value); showW(); persist(); });
    const swatchBtns = [];
    const setTool = (t) => {
      tool = t; if (t !== 'erase') lastPen = t;
      chip.innerHTML = PENSVG + '<span>Drawing mode · ' + T[t].name + '</span>'; cv.style.cursor = t === 'erase' ? 'cell' : 'crosshair';
      Object.keys(toolBtns).forEach((k) => { toolBtns[k].style.background = k === t ? '#3A3A3A' : '#222'; toolBtns[k].style.borderColor = k === t ? '#777' : '#333'; toolBtns[k].setAttribute('aria-pressed', String(k === t)); });
      swatchBtns.forEach((s) => { s.b.style.borderColor = t !== 'erase' && s.c.toLowerCase() === T[t].color.toLowerCase() ? '#F5F5F5' : '#333'; s.b.style.opacity = t === 'erase' ? '.45' : '1'; });
      showW();
    };
    ['pen', 'fine', 'marker', 'pencil', 'hl', 'erase'].forEach((k) => { toolBtns[k] = mkb(ic(ICONS[k]), T[k].name, () => setTool(k), 'min-width:46px;', rowT); toolBtns[k].title = T[k].name; });
    const COLORS = ['#F5F5F5', '#9A9A9A', '#FF7B72', '#FFA657', '#F2D54B', '#7EE787', '#56D4DD', '#79B8FF', '#D2A8FF', '#FF9BCE'];
    const pick = (c) => { if (tool === 'erase') setTool(lastPen); T[tool].color = c; persist(); setTool(tool); };
    COLORS.forEach((c) => { const b = mkb('<span style="width:20px;height:20px;border-radius:50%;background:' + c + ';display:block;"></span>', 'Pen colour ' + c, () => pick(c), 'min-width:38px;height:38px;padding:0;', rowC); swatchBtns.push({ b, c }); });
    const cust = mk('label', BTN + 'min-width:38px;height:38px;padding:0;position:relative;overflow:hidden;');
    cust.setAttribute('aria-label', 'Custom colour'); cust.title = 'Custom colour';
    cust.innerHTML = '<span style="width:20px;height:20px;border-radius:50%;background:conic-gradient(#ff5f5f,#ffd24d,#7ee787,#56d4dd,#79b8ff,#d2a8ff,#ff5f5f);display:block;"></span>';
    const ci = mk('input', 'position:absolute;inset:0;opacity:0;width:100%;height:100%;cursor:pointer;'); ci.type = 'color'; ci.setAttribute('aria-label', 'Pick any colour'); ci.value = '#ffffff';
    ci.addEventListener('input', () => pick(ci.value)); cust.appendChild(ci); rowC.appendChild(cust);
    mkb('Cancel', 'Cancel drawing', () => close(), 'font-size:14px;');
    const undoB = mkb(ic('<path d="M3 7v6h6"/><path d="M21 17a9 9 0 0 0-15-6.7L3 13"/>'), 'Undo stroke', () => { if (strokes.length) { redoS.push(strokes.pop()); redraw(); } });
    const redoB = mkb(ic('<path d="M21 7v6h-6"/><path d="M3 17a9 9 0 0 1 15-6.7L21 13"/>'), 'Redo stroke', () => { if (redoS.length) { strokes.push(redoS.pop()); redraw(); } });
    mkb('Clear', 'Clear drawing', () => { if (strokes.length) { redoS = strokes.slice().reverse(); strokes = []; redraw(); } }, 'font-size:13px;');
    bar.appendChild(mk('span', 'flex:1 1 auto;'));
    const doneB = mkb('Done', 'Save drawing', () => save(), 'font-size:14px;background:#F5F5F5;color:#121212;border-color:#F5F5F5;font-weight:600;');
    function sync() { hint.style.display = strokes.length || cur ? 'none' : 'flex'; undoB.style.opacity = strokes.length ? '1' : '.4'; redoB.style.opacity = redoS.length ? '1' : '.4'; doneB.style.opacity = strokes.length ? '1' : '.5'; }
    function close() { document.removeEventListener('keydown', onEsc, true); window.removeEventListener('resize', sizeCv); wrap.remove(); }
    function onEsc(e) { if (e.key === 'Escape') { e.stopPropagation(); close(); } }
    function save() {
      if (!strokes.length) { close(); return; }
      let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
      strokes.forEach((s) => s.pts.forEach((q) => { const r = s.w; x0 = Math.min(x0, q[0] - r); y0 = Math.min(y0, q[1] - r); x1 = Math.max(x1, q[0] + r); y1 = Math.max(y1, q[1] + r); }));
      const pad = 20; x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad);
      const cw = Math.max(1, Math.round(cv.width / dpr)), ch = Math.max(1, Math.round(cv.height / dpr));
      x1 = Math.min(cw, x1 + pad); y1 = Math.min(ch, y1 + pad);
      const w = Math.max(240, Math.round(x1 - x0)), h = Math.max(120, Math.round(y1 - y0));
      const out = document.createElement('canvas'); out.width = Math.round(w * dpr); out.height = Math.round(h * dpr);
      const o = out.getContext('2d'); o.fillStyle = '#1A1A1A'; o.fillRect(0, 0, out.width, out.height);
      o.drawImage(cv, Math.round(x0 * dpr), Math.round(y0 * dpr), out.width, out.height, 0, 0, out.width, out.height);
      out.toBlob((blob) => { close(); if (blob && onBlob) onBlob(blob); }, 'image/png');
    }
    document.addEventListener('keydown', onEsc, true);
    window.addEventListener('resize', sizeCv);
    setTool('pen'); sizeCv(); sync();
    window.__noteDraw = { get strokes() { return strokes.length; }, get last() { return strokes[strokes.length - 1]; } };
  }

  const insertImage = (name, url) => {
    const el = focusEd(); if (!el) return;
    const safe = String(name).replace(/[\"<>&]/g, '');
    exec('insertHTML', '<div><img data-att="' + safe + '" src="' + url + '" alt="' + safe + '" style="max-width:100%;border-radius:12px;display:block;"></div><div><br></div>');
    changed();
  };

  // ---- phone: the toolbar sits at the bottom and rides above the keyboard while you type
  (function dock() {
    try {
      const st = document.createElement('style');
      st.textContent = 'html.ne-typing .ne-dock{bottom:calc(var(--ne-kb,0px) + 8px)!important;}html.ne-typing nav[aria-label="Main"],html.ne-typing button[aria-label^="Open agent"]{display:none!important;}.ne-dock{box-shadow:0 8px 24px rgba(0,0,0,.45);}';
      document.head.appendChild(st);
    } catch (e) {}
    const vv = window.visualViewport;
    const root = document.documentElement;
    const kb = () => { if (!vv) return 0; return Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop)); };
    const typing = () => { const a = document.activeElement; return !!(a && a !== document.body && (a.isContentEditable || /^(INPUT|TEXTAREA)$/.test(a.tagName)) && document.querySelector('.ne-dock')); };
    const apply = () => { root.style.setProperty('--ne-kb', kb() + 'px'); root.classList.toggle('ne-typing', typing()); keepCaret(); };
    // keep the line you are typing above the toolbar
    let raf = 0;
    function keepCaret() {
      if (raf) return; raf = requestAnimationFrame(() => {
        raf = 0;
        try {
          const el = ed(), tb = document.querySelector('.ne-dock'); if (!el || !tb || document.activeElement !== el) return;
          const sel = window.getSelection(); if (!sel || !sel.rangeCount) return;
          const r = sel.getRangeAt(0); let rect = r.getClientRects()[0];
          if (!rect) { const n = r.startContainer.nodeType === 1 ? r.startContainer : r.startContainer.parentNode; rect = n && n.getBoundingClientRect ? n.getBoundingClientRect() : null; }
          if (!rect) return;
          const limit = tb.getBoundingClientRect().top - 12;
          if (rect.bottom > limit) {
            let sc = el.parentNode; while (sc && sc !== document.body) { const o = getComputedStyle(sc).overflowY; if ((o === 'auto' || o === 'scroll') && sc.scrollHeight > sc.clientHeight) break; sc = sc.parentNode; }
            const d = rect.bottom - limit;
            if (sc && sc !== document.body) sc.scrollTop += d; else window.scrollBy(0, d);
          }
        } catch (e) {}
      });
    }
    if (vv) { vv.addEventListener('resize', apply); vv.addEventListener('scroll', apply); }
    window.addEventListener('resize', apply);
    document.addEventListener('focusin', () => setTimeout(apply, 50));
    document.addEventListener('focusout', () => setTimeout(apply, 120));
    document.addEventListener('selectionchange', keepCaret);
    document.addEventListener('input', keepCaret, true);
  })();

  window.NoteEd = { insertImage, size, align, block, todo, bullets, numbers, indent, outdent, strike, undo, redo, aa, draw, classify };
})();
