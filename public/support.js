/* LifeOS web runtime. Runs the .dc.html pages as a normal web app.
   Implements the small slice of the Design Component format the pages use:
   {{holes}}, <sc-if>, <sc-for>, DCLogic (props, state, setState, lifecycle). */
(function () {
  'use strict';

  // ---------- logic base class ----------
  class DCLogic {
    constructor(props) { this.props = props || {}; this.state = {}; this._r = null; }
    setState(o, cb) {
      const p = typeof o === 'function' ? o(this.state, this.props) : o;
      if (p) this.state = Object.assign({}, this.state, p);
      this._schedule(cb);
    }
    forceUpdate(cb) { this._schedule(cb); }
    _schedule(cb) { if (this._r) this._r(cb); }
  }
  // The pages used to redraw EVERYTHING every second just to move the clock (about 50 ms of work each time on a slowed-down phone CPU).
  // Now the seconds are written straight into the clock text, and the page is redrawn only when the minute changes.
  DCLogic.prototype._tickClock = function () {
    const now = Date.now(), last = (this.state && this.state.now) || 0;
    if (!last || Math.floor(now / 60000) !== Math.floor(last / 60000)) { this.setState({ now }); return; }
    this.state.now = now; // a later redraw (a tap, a sync) then already has the right time
    const d = new Date(now), pad = (n) => String(n).padStart(2, '0'), h = d.getHours();
    const txt = pad(this.props && this.props.hour12 === false ? h : (h % 12 || 12)) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
    for (const e of document.querySelectorAll('[data-live-clock]')) if (e.textContent !== txt) e.textContent = txt;
  };
  window.DCLogic = DCLogic;

  // ---------- vault bridge ----------
  const vault = {
    on: false,
    ready: null,
    async call(method, url, body) {
      const r = await fetch(url, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
      let j = null; try { j = await r.json(); } catch (e) {}
      if (!r.ok) { const err = new Error((j && j.error) || ('HTTP ' + r.status)); err.status = r.status; err.data = j; throw err; }
      return j;
    },
    get(url) { return vault.call('GET', url); },
    post(url, body) { return vault.call('POST', url, body || {}); },
    del(url) { return vault.call('DELETE', url); }
  };
  // Opens the Claude desktop app in a Cowork session with the vault folder attached, so Claude can read the real files.
  vault.openChat = (prompt) => {
    const url = 'claude://cowork/new?q=' + encodeURIComponent(prompt) + (vault.path ? '&folder=' + encodeURIComponent(vault.path) : '');
    const a = document.createElement('a'); a.href = url; a.style.display = 'none'; document.body.appendChild(a); a.click(); a.remove();
  };
  // In-panel chat: asks Claude Code on this computer (read-only, inside the vault). Falls back to the Claude desktop app.
  const plain = (t) => String(t || '').replace(/```[a-z]*\n?/g, '').replace(/^#{1,6}\s+/gm, '').replace(/\*\*(.+?)\*\*/g, '$1').replace(/(^|[^*])\*([^*\n]+)\*/g, '$1$2').replace(/`([^`\n]+)`/g, '$1').replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (m, a, b) => b || a).replace(/^\s*[-*]\s+/gm, '\u2022 ').trim();
  const sget = () => { try { return localStorage.getItem('lifeos.chatSession') || ''; } catch (e) { return ''; } };
  const sset = (v) => { try { v ? localStorage.setItem('lifeos.chatSession', v) : localStorage.removeItem('lifeos.chatSession'); } catch (e) {} };
  vault.ask = async (text, fallbackPrompt, done, opts) => {
    const o = opts || {};
    const fall = (why) => {
      try { if (navigator.clipboard) navigator.clipboard.writeText(fallbackPrompt).catch(() => {}); } catch (e) {}
      try { vault.openChat(fallbackPrompt); } catch (e) {}
      done(why + ' I opened the Claude app instead, with your question filled in. Approve the folder prompt there, then send.');
    };
    // The answer streams in as it is written ({d}), with what she is doing ({status}); an older server without the stream route answers in one piece.
    const streamChat = async (body, onText) => {
      const r = await fetch('/api/chat/stream', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (!r.ok || !r.body || !r.body.getReader) return null;
      const rd = r.body.getReader(), dec = new TextDecoder();
      let buf = '', text = '', status = '', final = null, last = 0, waiting = false, over = false;
      const push = (force) => {
        if (!onText || over) return;
        const now = Date.now();
        if (!force && now - last < 70) { if (!waiting) { waiting = true; setTimeout(() => { waiting = false; push(true); }, 70); } return; }
        last = now; try { onText(plain(text), status); } catch (e) {}
      };
      try {
        for (;;) {
          const { value, done: end } = await rd.read(); if (end) break;
          buf += dec.decode(value, { stream: true });
          let i;
          while ((i = buf.indexOf('\n')) >= 0) {
            const line = buf.slice(0, i); buf = buf.slice(i + 1); if (!line.trim()) continue;
            let j; try { j = JSON.parse(line); } catch (e) { continue; }
            if (j.d) { text += j.d; push(false); }
            else if (j.reset) { text = ''; push(true); }
            else if (j.status) { status = j.status; if (!text) push(true); }
            else if (j.done) final = j;
            else if (j.error) { const err = new Error(j.error); err.status = j.code; throw err; }
          }
        }
      } finally { over = true; }
      if (!final) throw new Error('The answer was cut off. Try again.');
      return final;
    };
    const chat1 = async (body) => { const s = await streamChat(body, o.onText); return s === null ? vault.post('/api/chat', body) : s; };
    try {
      const body = { text, session: sget(), files: o.files || [], model: o.model || '' };
      let r = await chat1(body);
      if (!r.ok && !r.unavailable && sget()) { sset(''); r = await chat1({ ...body, session: '' }); }
      if (r.unavailable) return fall('Claude Code is not set up on this computer.');
      if (!r.ok) return done(r.error || "That didn't work. Try again.");
      if (r.session) sset(r.session);
      done(plain(r.text), r.proposed || []);
    } catch (e) { done(e && e.status === 429 ? 'Still answering the last question. Give it a moment.' : "Couldn't reach the server. Is the LifeOS window still open?"); }
  };
  // R.E.N.E.E. only proposes (the server checked every field). Nothing is written until Jess says Yes; then these existing routes do it.
  const ymd = () => { const d = new Date(), p = (n) => String(n).padStart(2, '0'); return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()); };
  vault.confirmAction = async (p) => {
    try {
      const a = p.args || {};
      if (p.type === 'add_task') await vault.post('/api/tasks', a);
      else if (p.type === 'complete_task') await vault.call('PATCH', '/api/tasks/' + encodeURIComponent(a.id), { done: true });
      else if (p.type === 'tick_habit') await vault.post('/api/habits', a);
      else if (p.type === 'add_event') await vault.post('/api/events', a);
      else if (p.type === 'add_capture') {
        const date = ymd(), cur = await vault.get('/api/daily?date=' + date), old = String(cur.captures || '').trim();
        await vault.post('/api/daily', { date, field: 'captures', text: old ? old + '\n' + a.text : a.text, base: cur.captures || '' });
      } else throw new Error('That change is not allowed.');
      vault.post('/api/actions/done', { id: p.id, ok: true }).catch(() => {});
      try { window.__dc && window.__dc._r(); } catch (e) {}
      return { ok: true };
    } catch (e) {
      const msg = (e && e.message) || "That didn't work.";
      vault.post('/api/actions/done', { id: p.id, ok: false, error: msg }).catch(() => {});
      return { ok: false, message: msg };
    }
  };
  vault.declineAction = (p) => { try { return vault.post('/api/actions/declined', { id: p.id }).catch(() => {}); } catch (e) { return null; } };
  // Spoken answers: "yes" / "no" (and the usual ways of saying them) to a read-back question. null = neither.
  vault.yesNo = (t) => {
    const s = String(t || '').toLowerCase().replace(/[^a-z' ]/g, ' ').replace(/\s+/g, ' ').trim();
    if (/^(yes|yeah|yep|yup|sure|ok|okay|confirm|confirmed|do it|go ahead|please do|that's right|correct|affirmative)\b/.test(s)) return true;
    if (/^(no|nope|nah|cancel|don't|do not|stop|never mind|nevermind|negative|wrong)\b/.test(s)) return false;
    return null;
  };
  // ---- edit a task: tap its title anywhere a task is listed. Changes the task in its note (PATCH /api/tasks/:id). ----
  vault.editTask = async (t) => {
    if (!t || !t.id || document.getElementById('lifeos-edit')) return;
    const mk = (tag, css, attrs) => { const e = document.createElement(tag); if (css) e.style.cssText = css; if (attrs) for (const k in attrs) e.setAttribute(k, attrs[k]); return e; };
    const FIELD = 'width:100%;box-sizing:border-box;height:44px;padding:0 12px;border-radius:12px;background:#222;border:1px solid #333;color:#F5F5F5;font:inherit;font-size:15px;color-scheme:dark;';
    const LAB = 'font-family:"IBM Plex Mono",monospace;font-size:11px;letter-spacing:.08em;color:#8A8A8A;margin:12px 0 5px;display:block;';
    const root = mk('div', 'position:fixed;inset:0;z-index:9999;display:flex;align-items:flex-end;justify-content:center;', { id: 'lifeos-edit' });
    const scrim = mk('button', 'position:absolute;inset:0;border:0;padding:0;background:rgba(0,0,0,.55);cursor:default;', { type: 'button', 'aria-label': 'Close' });
    const box = mk('div', 'position:relative;width:100%;max-width:480px;max-height:92vh;overflow:auto;box-sizing:border-box;padding:18px 16px calc(18px + env(safe-area-inset-bottom));border-radius:24px 24px 0 0;background:#1A1A1A;border:1px solid #333;color:#F5F5F5;font-family:"IBM Plex Sans",sans-serif;', { role: 'dialog', 'aria-label': 'Edit task' });
    const head = mk('div', 'font-family:"Space Grotesk",sans-serif;font-weight:600;font-size:18px;'); head.textContent = 'Edit task';
    const field = (label, el) => { const l = mk('label', LAB); l.textContent = label; box.appendChild(l); box.appendChild(el); return el; };
    box.appendChild(head);
    const title = field('TITLE', mk('input', FIELD, { type: 'text', 'aria-label': 'Task title', maxlength: '300' })); title.value = t.title || '';
    const due = field('DUE DATE', mk('input', FIELD, { type: 'date', 'aria-label': 'Due date' })); due.value = t.dueKey || '';
    const time = field('TIME (needs a due date)', mk('input', FIELD, { type: 'time', 'aria-label': 'Time' })); time.value = t.time || '';
    const sel = (opts, cur, label) => { const s2 = mk('select', FIELD, { 'aria-label': label }); opts.forEach(([v, n]) => { const o = mk('option'); o.value = v; o.textContent = n; if (v === cur) o.selected = true; s2.appendChild(o); }); return s2; };
    const pri = field('PRIORITY', sel([['', 'None'], ['Low', 'Low'], ['Medium', 'Medium'], ['High', 'High']], t.priority || '', 'Priority'));
    const rep = field('REPEAT', sel([['', 'Never'], ['daily', 'Daily'], ['weekly', 'Weekly'], ['monthly', 'Monthly']], t.repeat || '', 'Repeat'));
    let names = []; try { names = ((await vault.get('/api/projects')).projects || []).map((p) => p.name).filter(Boolean); } catch (e) {}
    const proj = field('PROJECT', sel([['', 'None']].concat(names.map((n) => [n, n])), t.project || '', 'Project'));
    const err = mk('div', 'min-height:18px;margin-top:10px;font-size:13px;color:#E08A82;', { role: 'alert' });
    const row = mk('div', 'display:flex;gap:10px;margin-top:8px;');
    const save = mk('button', 'flex:1;min-height:48px;border:0;border-radius:999px;background:#F5F5F5;color:#121212;font:inherit;font-size:15px;font-weight:700;cursor:pointer;', { type: 'button' }); save.textContent = 'Save';
    const cancel = mk('button', 'flex:1;min-height:48px;border-radius:999px;background:#222;border:1px solid #333;color:#D0D0D0;font:inherit;font-size:15px;cursor:pointer;', { type: 'button' }); cancel.textContent = 'Cancel';
    row.appendChild(save); row.appendChild(cancel); box.appendChild(err); box.appendChild(row);
    root.appendChild(scrim); root.appendChild(box); document.body.appendChild(root);
    const close = () => { try { root.remove(); } catch (e) {} document.removeEventListener('keydown', onKey, true); };
    const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); close(); } else if (e.key === 'Enter' && e.target === title) { e.preventDefault(); doSave(); } };
    document.addEventListener('keydown', onKey, true);
    scrim.onclick = close; cancel.onclick = close;
    const doSave = async () => {
      if (!title.value.trim()) { err.textContent = 'A task needs a title.'; title.focus(); return; }
      save.disabled = true; save.style.opacity = '.55'; err.textContent = '';
      try {
        await vault.call('PATCH', '/api/tasks/' + encodeURIComponent(t.id), { title: title.value, dueKey: due.value, time: due.value ? time.value : '', priority: pri.value, repeat: rep.value, project: proj.value });
        close(); try { await (vault.reloadTasks && vault.reloadTasks()); } catch (e) {}
      } catch (e) { err.textContent = (e && e.message) || "That didn't save."; save.disabled = false; save.style.opacity = ''; }
    };
    save.onclick = doSave;
    setTimeout(() => { try { title.focus(); title.select(); } catch (e) {} }, 60);
  };
  vault.newChat = () => sset('');
  // Sends a photo or file picked in the chat to the vault (Photos or PDFs). Resolves { file: { name, path, ... } }.
  vault.upload = (file) => new Promise((resolve, reject) => {
    if (!file) return reject(new Error('No file.'));
    if (file.size > 20 * 1024 * 1024) return reject(new Error('That file is over 20 MB.'));
    const fr = new FileReader();
    fr.onerror = () => reject(new Error("Couldn't read that file."));
    fr.onload = () => { const data = String(fr.result || '').split(',')[1] || ''; vault.post('/api/agent/upload', { name: file.name, data }).then(resolve, reject); };
    fr.readAsDataURL(file);
  });
  vault.checked = false;
  vault.label = () => (!vault.checked ? 'checking vault…' : vault.on ? 'vault connected' : 'vault not connected');
  vault.ready = fetch('/api/health').then((r) => r.json()).then((j) => { vault.on = !!(j && j.ok); vault.path = (j && j.vault) || ''; return vault.on; }).catch(() => false).then((on) => { vault.checked = true; try { window.__dc && window.__dc._r(); } catch (e) {} return on; });
  window.vault = vault;

  // ---------- expression holes ----------
  const HOLE = /\{\{([^}]*)\}\}/g;
  function lookup(path, scope) {
    const p = path.trim();
    if (p === 'true') return true;
    if (p === 'false') return false;
    if (p === 'null' || p === 'undefined') return undefined;
    if (/^-?\d+(\.\d+)?$/.test(p)) return Number(p);
    if (/^(['"]).*\1$/.test(p)) return p.slice(1, -1);
    const parts = p.split('.');
    let v = parts[0] in scope ? scope[parts[0]] : undefined;
    for (let i = 1; i < parts.length && v != null; i++) v = v[parts[i]];
    return v;
  }
  const isWhole = (s) => /^\s*\{\{[^}]*\}\}\s*$/.test(s);
  const interp = (s, scope) => s.replace(HOLE, (_, e) => { const v = lookup(e, scope); return v == null || v === false ? '' : String(v); });

  // ---------- template -> real nodes ----------
  const SKIP_ATTR = { 'hint-placeholder-val': 1, 'hint-placeholder-count': 1, 'hint-size': 1 };
  function build(node, scope, out) {
    if (node.nodeType === 3) {
      const t = node.nodeValue;
      out.push(document.createTextNode(t.indexOf('{{') < 0 ? t : interp(t, scope)));
      return;
    }
    if (node.nodeType !== 1) return;
    const tag = node.localName;
    if (tag === 'sc-if') {
      if (lookup(node.getAttribute('value').replace(/^\s*\{\{|\}\}\s*$/g, ''), scope)) for (const c of node.childNodes) build(c, scope, out);
      return;
    }
    if (tag === 'sc-for') {
      const list = lookup(node.getAttribute('list').replace(/^\s*\{\{|\}\}\s*$/g, ''), scope);
      const as = node.getAttribute('as') || 'item';
      if (Array.isArray(list)) list.forEach((item, i) => {
        const s2 = Object.create(scope); s2[as] = item; s2.$index = i;
        for (const c of node.childNodes) build(c, s2, out);
      });
      return;
    }
    const el = document.createElementNS(node.namespaceURI, tag);
    const h = {};
    for (const a of node.attributes) {
      const name = a.name;
      if (SKIP_ATTR[name]) continue;
      const raw = a.value;
      const hasHole = raw.indexOf('{{') >= 0;
      if (/^on[a-z]+$/.test(name) && hasHole && isWhole(raw)) {
        const fn = lookup(raw.replace(/^\s*\{\{|\}\}\s*$/g, ''), scope);
        if (typeof fn === 'function') { el[name] = fn; h[name] = fn; }
        continue;
      }
      let v = raw;
      if (hasHole) v = isWhole(raw) ? lookup(raw.replace(/^\s*\{\{|\}\}\s*$/g, ''), scope) : interp(raw, scope);
      if (name === 'value' && (tag === 'input' || tag === 'textarea' || tag === 'select')) { el.value = v == null ? '' : String(v); el.setAttribute('value', el.value); continue; }
      if (name === 'checked' && tag === 'input') { el.checked = !!v; continue; }
      if (name === 'data-lsrc') { if (v) el.setAttribute('src', String(v)); continue; } // an image whose address is filled in later: the browser must not fetch the unfilled template text (it made a failing request on 10 pages)
      if (v === false || v == null) { if (/^(aria-|data-)/.test(name) && v === false) el.setAttribute(name, 'false'); continue; }
      el.setAttribute(name, v === true ? (/^(aria-|data-)/.test(name) ? 'true' : '') : String(v));
    }
    el.__h = h;
    if (tag === 'textarea') {
      // value was set above; no children
    } else {
      const kids = [];
      for (const c of node.childNodes) build(c, scope, kids);
      for (const k of kids) el.appendChild(k);
    }
    out.push(el);
  }

  // ---------- morph: make the live DOM match a freshly built one ----------
  function syncEl(a, b) {
    // attributes
    for (const at of Array.from(a.attributes)) if (!b.hasAttribute(at.name)) a.removeAttribute(at.name);
    for (const at of b.attributes) if (a.getAttribute(at.name) !== at.value) {
      if (at.name === 'value' && (a.localName === 'input' || a.localName === 'textarea')) continue;
      a.setAttribute(at.name, at.value);
    }
    // handlers
    const ha = a.__h || {}, hb = b.__h || {};
    for (const n in ha) if (!(n in hb)) a[n] = null;
    for (const n in hb) a[n] = hb[n];
    a.__h = hb;
    // form values
    if (a.localName === 'input' || a.localName === 'textarea' || a.localName === 'select') {
      if (a.type === 'checkbox' || a.type === 'radio') { if (a.checked !== b.checked) a.checked = b.checked; }
      else if (a.value !== b.value) a.value = b.value;
    }
  }
  function morphChildren(a, b) {
    if (a.getAttribute && a.getAttribute('contenteditable') != null) return; // editor owns its content
    const bk = Array.from(b.childNodes);
    let i = 0;
    for (; i < bk.length; i++) {
      const nb = bk[i];
      const na = a.childNodes[i];
      if (!na) { a.appendChild(nb); continue; }
      if (na.nodeType === nb.nodeType && (na.nodeType === 3 || (na.localName === nb.localName && na.namespaceURI === nb.namespaceURI))) {
        if (na.nodeType === 3) { if (na.nodeValue !== nb.nodeValue) na.nodeValue = nb.nodeValue; }
        else { syncEl(na, nb); morphChildren(na, nb); }
      } else a.replaceChild(nb, na);
    }
    while (a.childNodes.length > bk.length) a.removeChild(a.lastChild);
  }

  // ---------- boot ----------
  function boot() {
    const host = document.querySelector('x-dc');
    const scriptEl = document.querySelector('script[data-dc-script]');
    if (!host || !scriptEl) return;
    // move <helmet> head content out
    const helmet = host.querySelector('helmet');
    if (helmet) { for (const n of Array.from(helmet.childNodes)) if (n.nodeType === 1) document.head.appendChild(n); helmet.remove(); }
    // inert copy of the template so {{...}} attributes never run as inline handlers
    const tdoc = document.implementation.createHTMLDocument('');
    tdoc.body.innerHTML = host.innerHTML;
    host.textContent = '';
    host.style.display = 'contents';
    let defaults = {};
    try { const dp = JSON.parse(scriptEl.getAttribute('data-props') || '{}'); for (const k in dp) if (dp[k] && 'default' in dp[k]) defaults[k] = dp[k].default; } catch (e) {}
    const Component = new Function('DCLogic', scriptEl.textContent + '\n;return Component;')(DCLogic);
    const inst = new Component(Object.assign({}, defaults));
    let queued = false, cbs = [], mounted = false;
    const render = () => {
      queued = false;
      let vals; try { vals = inst.renderVals ? inst.renderVals() : {}; } catch (e) { console.error('renderVals failed', e); return; }
      const out = [];
      const scope = Object.assign(Object.create(null), vals || {});
      for (const c of tdoc.body.childNodes) build(c, scope, out);
      const tmp = document.createElement('div');
      for (const o of out) tmp.appendChild(o);
      tmp.querySelectorAll('[data-vstat]').forEach((e) => { e.textContent = vault.label(); const box = e.parentElement; if (box) box.style.display = (vault.checked && !vault.on) ? '' : 'none'; }); // the status box only shows when the vault is NOT connected
      morphChildren(host, tmp);
      if (!mounted) { mounted = true; try { inst.componentDidMount && inst.componentDidMount(); } catch (e) { console.error(e); } }
      const run = cbs; cbs = []; run.forEach((f) => { try { f(); } catch (e) {} });
    };
    inst._r = (cb) => { if (cb) cbs.push(cb); if (!queued) { queued = true; Promise.resolve().then(render); } };
    window.__dc = inst;
    window.addEventListener('pagehide', () => { try { inst.componentWillUnmount && inst.componentWillUnmount(); } catch (e) {} });
    render();
    document.documentElement.setAttribute('data-dc-ready', '1');
  }

  // ---------- phone / desktop routing and fit ----------
  function route() {
    const m = location.pathname.match(/\/([A-Za-z]+?)(Phone)?\.dc\.html$/);
    const forced = (location.search.match(/[?&]view=(desktop|phone)/) || [])[1];
    const narrow = forced ? forced === 'phone' : window.matchMedia('(max-width: 760px)').matches;
    if (!m) return false;
    const base = m[1], isPhone = !!m[2] || base === 'Phone';
    let name = base, phoneName;
    if (base === 'Phone') { name = 'Main'; phoneName = 'Phone'; } else if (base === 'Main') { phoneName = 'Phone'; } else { phoneName = base + 'Phone'; }
    if (m[2]) { name = base; phoneName = base + 'Phone'; }
    const want = narrow ? phoneName : name;
    const cur = location.pathname.split('/').pop().replace('.dc.html', '');
    if (cur !== want) { location.replace('/' + want + '.dc.html' + location.search + location.hash); return true; }
    return false;
  }
  // Dark / light mode: the choice is the cookie lifeos_theme (the server sends the page with light colours when it says light). Dark is the default.
  window.lifeosTheme = {
    get: () => (/(?:^|;\s*)lifeos_theme=light\b/.test(document.cookie) ? 'light' : 'dark'),
    set(v) { document.cookie = 'lifeos_theme=' + (v === 'light' ? 'light' : 'dark') + '; path=/; max-age=31536000; SameSite=Lax'; location.reload(); },
    toggle() { this.set(this.get() === 'light' ? 'dark' : 'light'); },
  };
  const fit = document.createElement('style');
  fit.textContent = '@view-transition{navigation:auto} ::view-transition-group(root){animation-duration:.14s} *{-webkit-tap-highlight-color:transparent} :focus:not(:focus-visible){outline:none} html,body{margin:0;min-height:100%;background:#121212} x-dc{display:contents} @media (max-width:760px){ body > x-dc > div[style*="width: 390px"]{width:100vw!important;height:100vh!important;height:100dvh!important} }';
  document.head.appendChild(fit);
  const meta = document.createElement('meta'); meta.name = 'viewport'; meta.content = 'width=device-width, initial-scale=1, viewport-fit=cover'; document.head.appendChild(meta);
  const man = document.createElement('link'); man.rel = 'manifest'; man.href = '/manifest.webmanifest'; document.head.appendChild(man);
  const th = document.createElement('meta'); th.name = 'theme-color'; th.content = '#121212'; document.head.appendChild(th);
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});

  const go = () => {
    if (route()) return;
    const sc = document.createElement('script'); sc.src = '/vsync.js';
    const start = () => { vault.ready.then(() => boot(), () => boot()); };
    sc.onload = start; sc.onerror = start; document.head.appendChild(sc);
    try { const ne = document.createElement('script'); ne.src = '/noteed.js'; document.head.appendChild(ne); } catch (e) {}
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', go); else go();
})();
