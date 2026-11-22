/* LifeOS web app: keeps each page's data in step with the vault.
   Pages keep working exactly as before; this layer loads data from the server into the page's own state,
   and turns the page's own state changes (add, tick, edit, remove) into vault writes. */
(function () {
  'use strict';
  const V = window.vault; if (!V) return;
  const page = ((location.pathname.match(/\/([A-Za-z]+?)(?:Phone)?\.dc\.html$/) || [])[1] || '').replace(/^Phone$/, 'Main');
  const HOME = ['Main', 'Tasks', 'Calendar', 'Projects'];
  const LIB = { Health: 'health', Mma: 'mma', Spiritual: 'spiritual', Work: 'work', Knowledge: 'knowledge' };
  const pad = (n) => String(n).padStart(2, '0');
  const dk = (d) => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  const today = () => dk(new Date());
  const shift = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return dk(d); };
  const isTemp = (id) => /^[a-z]\d{10,}$/.test(String(id));
  const byId = (a) => { const m = {}; (a || []).forEach((x) => { m[x.id] = x; }); return m; };
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

  // ---------- toast ----------
  let toastEl, toastT;
  V.toast = function (msg) {
    try {
      if (!toastEl) {
        toastEl = document.createElement('div');
        toastEl.setAttribute('role', 'status');
        toastEl.style.cssText = 'position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:90;max-width:min(92vw,460px);padding:12px 16px;border-radius:12px;background:#1E1E1E;border:1px solid #3A3A3A;color:#EDEDED;font:13.5px/1.4 "IBM Plex Sans",system-ui,sans-serif;box-shadow:0 8px 28px rgba(0,0,0,.5);transition:opacity .2s;opacity:0;pointer-events:none';
        document.body.appendChild(toastEl);
      }
      toastEl.textContent = msg; toastEl.style.opacity = '1';
      clearTimeout(toastT); toastT = setTimeout(() => { toastEl.style.opacity = '0'; }, 4200);
    } catch (e) {}
  };
  const fail = (e, what) => V.toast((e && e.message ? e.message : 'Something went wrong') + (what ? '' : ''));

  // ---------- hook setState so adapters see every change the page makes ----------
  const proto = window.DCLogic && window.DCLogic.prototype;
  if (!proto) return;
  const orig = proto.setState;
  // when the agent panel opens, start the chat process in the background so the first question is not slow (at most every 5 minutes)
  let warmAt = 0;
  const warmChat = () => { const t = Date.now(); if (t - warmAt < 300000) return; warmAt = t; try { const r = V.post('/api/chat/warm', {}); if (r && r.catch) r.catch(() => {}); } catch (e) {} };
  proto.setState = function (o, cb) {
    const prev = this.state;
    orig.call(this, o, cb);
    try { if (this.state && this.state.chatOpen && !(prev && prev.chatOpen)) warmChat(); } catch (e) {}
    if (this._vhooks && !this._vapply) for (const h of this._vhooks) { try { h(prev, this.state); } catch (e) { console.error(e); } }
  };
  const apply = (inst, patch) => { inst._vapply = true; try { inst.setState(patch); } finally { inst._vapply = false; } };

  // one serial queue per resource, so writes land in order
  const queues = {};
  const enqueue = (name, fn) => { const q = (queues[name] || Promise.resolve()).then(fn, fn); queues[name] = q.catch(() => {}); return q; };
  const busy = (name) => queues[name] && queues[name].__busy;
  const pending = { n: 0 };
  const track = (p) => { pending.n++; return p.finally(() => { pending.n--; }); };

  function poller(fn, ms) {
    const run = () => { if (!document.hidden && pending.n === 0) fn(); };
    setInterval(run, ms);
    document.addEventListener('visibilitychange', run);
  }

  // ---------- tasks (home pages) ----------
  function tasks(inst) {
    const creating = {};
    const load = () => V.get('/api/tasks').then((j) => {
      const list = j.tasks.map((t) => ({ id: t.id, title: t.title, dueKey: t.dueKey, priority: t.priority, time: t.time, project: t.project, repeat: t.repeat }));
      const done = {}; j.tasks.forEach((t) => { if (t.done) done[t.id] = true; });
      apply(inst, { added: list, taskDone: done });
    }).catch(() => {});
    inst._vhooks.push((p, n) => {
      const pa = byId(p.added), na = n.added || [];
      na.forEach((t) => {
        if (pa[t.id] || !isTemp(t.id)) return;
        creating[t.id] = track(enqueue('tasks', () => V.post('/api/tasks', { title: t.title, dueKey: t.dueKey, time: t.time, priority: t.priority, project: t.project, repeat: t.repeat })
          .then((r) => r.id).catch((e) => { fail(e); return null; })));
        creating[t.id].then(() => load());
      });
      const pd = p.taskDone || {}, nd = n.taskDone || {};
      Object.keys(Object.assign({}, pd, nd)).forEach((id) => {
        if (!!pd[id] === !!nd[id]) return;
        const done = !!nd[id];
        const go = (rid) => rid && track(enqueue('tasks', () => V.call('PATCH', '/api/tasks/' + encodeURIComponent(rid), { done }).catch((e) => { fail(e); })).then(() => load()));
        if (isTemp(id)) (creating[id] || Promise.resolve(null)).then(go); else go(id);
      });
    });
    V.reloadTasks = load;
    load(); poller(load, 20000);
  }

  // ---------- events (home pages) ----------
  function events(inst) {
    const load = () => V.get('/api/events?from=' + shift(-62) + '&to=' + shift(400)).then((j) => apply(inst, { events: j.events })).catch(() => {});
    inst._vhooks.push((p, n) => {
      const pe = byId(p.events), ne = byId(n.events);
      (n.events || []).forEach((e) => { if (pe[e.id] || !isTemp(e.id)) return; track(enqueue('events', () => V.post('/api/events', { title: e.title, date: e.date, allDay: e.allDay, start: e.start, end: e.end }).catch((x) => fail(x)))).then(load); });
      (p.events || []).forEach((e) => { if (ne[e.id] || isTemp(e.id)) return; track(enqueue('events', () => V.del('/api/events/' + encodeURIComponent(e.id)).catch((x) => fail(x)))).then(load); });
    });
    load(); poller(load, 30000);
  }

  // ---------- Focus / Captures / Reflections (today's daily note) ----------
  function daily(inst) {
    const F = { focus: 'focusText', captures: 'captureText', reflections: 'reflectText' };
    const base = { focus: '', captures: '', reflections: '' };
    const timers = {};
    const dirty = (k) => (inst.state[F[k]] || '') !== base[k];
    const load = () => V.get('/api/daily?date=' + today()).then((j) => {
      const patch = {};
      Object.keys(F).forEach((k) => { if (!dirty(k) && (inst.state[F[k]] || '') !== (j[k] || '')) patch[F[k]] = j[k] || ''; base[k] = dirty(k) ? base[k] : (j[k] || ''); });
      if (Object.keys(patch).length) apply(inst, patch);
    }).catch(() => {});
    inst._vhooks.push((p, n) => {
      Object.keys(F).forEach((k) => {
        if ((p[F[k]] || '') === (n[F[k]] || '')) return;
        clearTimeout(timers[k]);
        timers[k] = setTimeout(() => {
          const text = inst.state[F[k]] || '';
          if (text === base[k]) return;
          track(V.post('/api/daily', { date: today(), field: k, text, base: base[k] }).then(() => { base[k] = text; }).catch((e) => {
            if (e.status === 409 && e.data && typeof e.data.current === 'string') { base[k] = e.data.current; apply(inst, { [F[k]]: e.data.current }); V.toast('Updated from the vault.'); }
            else fail(e);
          }));
        }, 900);
      });
    });
    load(); poller(load, 20000);
  }

  // ---------- project count on the home overview ----------
  function projCount(inst) {
    const load = () => V.get('/api/projects').then((j) => apply(inst, { projCount: j.projects.filter((p) => p.status === 'active').length })).catch(() => {});
    load(); poller(load, 60000);
  }

  // ---------- projects ----------
  function projects(inst) {
    const timers = {};
    const load = () => V.get('/api/projects').then((j) => apply(inst, { vproj: j.projects })).catch(() => {});
    const FIELDS = ['status', 'goal', 'context', 'notesText', 'tasks', 'related', 'logs'];
    const sent = {};
    inst._vhooks.push((p, n) => {
      const pp = p.pe || {}, np = n.pe || {};
      Object.keys(np).forEach((name) => {
        if (same(pp[name], np[name])) return;
        clearTimeout(timers[name]);
        timers[name] = setTimeout(() => {
          const cur = (inst.state.pe || {})[name]; if (!cur) return;
          const body = {}; FIELDS.forEach((f) => { if (cur[f] !== undefined) body[f] = cur[f]; });
          if (!Object.keys(body).length) return;
          track(enqueue('proj', () => V.call('PATCH', '/api/projects/' + encodeURIComponent(name), body).then(() => {
            // clear what was saved; keep anything typed since
            const now = Object.assign({}, (inst.state.pe || {})[name] || {});
            Object.keys(body).forEach((f) => { if (same(now[f], body[f])) delete now[f]; });
            const all = Object.assign({}, inst.state.pe || {}); if (Object.keys(now).length) all[name] = now; else delete all[name];
            apply(inst, { pe: all });
          }).catch((e) => { fail(e); const all = Object.assign({}, inst.state.pe || {}); delete all[name]; apply(inst, { pe: all }); }))).then(load);
        }, body0(np[name]) ? 900 : 200);
      });
      // new projects
      const known = {}; (inst.state.vproj || []).forEach((x) => { known[x.name] = 1; });
      (n.projAdded || []).forEach((a) => {
        if ((p.projAdded || []).some((x) => x.name === a.name)) return;
        track(enqueue('proj', () => V.post('/api/projects', { name: a.name, due: a.due }).catch((e) => { fail(e); }))).then(() => {
          apply(inst, { projAdded: (inst.state.projAdded || []).filter((x) => x.name !== a.name) });
          return load();
        });
      });
    });
    function body0(o) { return !!(o && (o.goal !== undefined || o.context !== undefined || o.notesText !== undefined)); }
    load(); poller(load, 30000);
  }

  // ---------- finances ----------
  function finance(inst) {
    const load = () => V.get('/api/finance').then((j) => apply(inst, { fEntries: j.entries, fBudget: j.budget })).catch(() => {});
    inst._vhooks.push((p, n) => {
      const pe = byId(p.fEntries), ne = byId(n.fEntries);
      (n.fEntries || []).forEach((e) => { if (pe[e.id] || !isTemp(e.id)) return; track(enqueue('fin', () => V.post('/api/finance', { asset: e.asset, kind: e.kind, amt: e.amt, date: e.date, cat: e.cat, note: e.note }).catch((x) => fail(x)))).then(load); });
      (p.fEntries || []).forEach((e) => { if (ne[e.id] || isTemp(e.id)) return; track(enqueue('fin', () => V.del('/api/finance/' + encodeURIComponent(e.id)).catch((x) => fail(x)))).then(load); });
    });
    load(); poller(load, 30000);
  }

  // ---------- MMA training log ----------
  function mmaLog(inst) {
    const load = () => V.get('/api/mma').then((j) => apply(inst, { mEntries: j.entries, mStyles: j.styles })).catch(() => {});
    inst._vhooks.push((p, n) => {
      const pe = byId(p.mEntries), ne = byId(n.mEntries);
      (n.mEntries || []).forEach((e) => { if (pe[e.id] || !isTemp(e.id)) return; track(enqueue('mma', () => V.post('/api/mma', { style: e.style, min: e.min, rpe: e.rpe, notes: e.notes, date: e.date }).catch((x) => fail(x)))).then(load); });
      (p.mEntries || []).forEach((e) => { if (ne[e.id] || isTemp(e.id)) return; track(enqueue('mma', () => V.del('/api/mma/' + encodeURIComponent(e.id)).catch((x) => fail(x)))).then(load); });
    });
    load(); poller(load, 30000);
  }

  // ---------- Spiritual tracker (prayer and meditation are the daily-note habits; chapters and verses live in 06 Spiritual/Tracker) ----------
  function spiritual(inst) {
    const load = () => V.get('/api/spiritual').then((j) => apply(inst, { spData: j })).catch(() => {});
    inst._spAct = (method, path, body) => { track(enqueue('spirit', () => (method === 'DELETE' ? V.del(path) : V.post(path, body || {})).catch((x) => fail(x)))).then(load); };
    load(); poller(load, 30000);
  }

  // ---------- Home: the Health summary on the stack (steps today, lifts and cardio this week) ----------
  function homeHealth(inst) {
    const load = () => Promise.all([V.get('/api/health/phone?days=2').catch(() => null), V.get('/api/train/summary?weeks=4').catch(() => null)]).then(([p, t]) => {
      const now = new Date(); const today = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0');
      const row = p && (p.days || []).filter((d) => d.date === today)[0];
      apply(inst, { hh: { steps: row && row.steps != null ? row.steps : null, lifts: t && t.thisWeek ? t.thisWeek.lifts : null, cardio: t && t.thisWeek ? t.thisWeek.cardio : null } });
    }).catch(() => {});
    load(); poller(load, 60000);
  }

  // ---------- health trackers ----------
  function healthLogs(inst) {
    const load = () => V.get('/api/healthlog').then((j) => apply(inst, { hLifts: j.lifts, hRoutines: j.routines || [], hExercises: j.exercises || [], hMeasures: j.measures || [], hSprints: j.sprints || [], hEntries: { runs: j.runs, pt: j.pt, rec: j.rec } })).catch(() => {});
    const diff = (kind, pa, na, body) => {
      const pm = byId(pa), nm = byId(na);
      (na || []).forEach((e) => { if (pm[e.id] || !isTemp(e.id)) return; track(enqueue('health', () => V.post('/api/healthlog/' + kind, body(e)).catch((x) => fail(x)))).then(load); });
      (pa || []).forEach((e) => { if (nm[e.id] || isTemp(e.id)) return; track(enqueue('health', () => V.del('/api/healthlog/' + kind + '/' + encodeURIComponent(e.id)).catch((x) => fail(x)))).then(load); });
    };
    inst._vhooks.push((p, n) => {
      if (p.hLifts !== n.hLifts) diff('lifts', p.hLifts, n.hLifts, (e) => ({ date: e.date, name: e.name, sets: e.sets }));
      if (p.hRoutines !== n.hRoutines) diff('lifts', p.hRoutines, n.hRoutines, (e) => ({ routine: { name: e.name, ex: e.ex, days: e.days || [] } }));
      if (p.hExercises !== n.hExercises) diff('lifts', p.hExercises, n.hExercises, (e) => ({ exercise: { name: e.name, muscle: e.muscle, equip: e.equip } }));
      if (p.hMeasures !== n.hMeasures) diff('lifts', p.hMeasures, n.hMeasures, (e) => ({ measure: { date: e.date, values: e.values } }));
      if (p.hSprints !== n.hSprints) diff('runs', p.hSprints, n.hSprints, (e) => ({ sprint: { date: e.date, dist: e.dist, times: e.times } }));
      const ph = p.hEntries || {}, nh = n.hEntries || {};
      if (ph.runs !== nh.runs) diff('runs', ph.runs, nh.runs, (e) => ({ date: e.date, dist: e.dist, time: e.time }));
      if (ph.pt !== nh.pt) diff('pt', ph.pt, nh.pt, (e) => ({ date: e.date, text: e.text }));
      if (ph.rec !== nh.rec) diff('rec', ph.rec, nh.rec, (e) => ({ date: e.date, feeling: e.feeling, notes: e.notes }));
    });
    load(); poller(load, 30000);
  }

  // ---------- library notes ----------
  function library(inst, domain) {
    const timers = {}; const created = {}; let warned = {};
    const load = () => V.get('/api/lib?domain=' + domain).then((j) => {
      const st = inst.state; const keep = (st.libNotes || []).filter((n) => isTemp(n.id));
      apply(inst, { libNotes: j.notes.concat(keep), libYears: j.years || {} });
    }).catch(() => {});
    const swapId = (from, to, extra) => {
      const notes = (inst.state.libNotes || []).map((n) => (n.id === from ? Object.assign({}, n, { id: to }, extra || {}) : n));
      const patch = { libNotes: notes }; if (inst.state.libNote === from) patch.libNote = to;
      apply(inst, patch);
    };
    const fileB64 = (f) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1] || ''); r.onerror = () => rej(new Error('Could not read the file.')); r.readAsDataURL(f); });
    const cur = (id) => (inst.state.libNotes || []).find((n) => n.id === id);
    const schedule = (id, key, fn, ms) => { const k = id + '|' + key; clearTimeout(timers[k]); timers[k] = setTimeout(fn, ms); };

    const createNow = (id) => {
      const n = cur(id); if (!n || created[id]) return;
      if (!(n.title || '').trim()) return;
      created[id] = track(enqueue('lib', () => V.post('/api/lib', { domain, section: n.section, topic: n.topic, title: n.title, html: n.html != null ? n.html : '', tags: n.tags }).then((r) => {
        const now = cur(id); swapId(id, r.id, { ro: false }); return { ok: true, id: r.id, now };
      }).catch((e) => { fail(e); delete created[id]; return null; })));
      created[id].then((res) => { if (!res) return; // anything typed while it was being created
        const n2 = cur(res.id); if (n2 && res.now && ((n2.html || '') !== (res.now.html || ''))) saveBody(res.id);
        (n2 && n2.files || []).forEach((f) => { if (f.file) uploadFile(res.id, f); });
      });
    };
    const saveBody = (id) => { const n = cur(id); if (!n) return; track(enqueue('lib', () => V.call('PATCH', '/api/lib/' + encodeURIComponent(id), { html: n.html || '' }).catch((e) => { fail(e); load(); }))); };
    const uploadFile = (id, f) => {
      if (!f.file || f.__up) return; f.__up = true;
      track(enqueue('lib', () => fileB64(f.file).then((data) => V.post('/api/lib/' + encodeURIComponent(id) + '/files', { name: f.name, type: f.file.type, data, inline: f.inline ? 1 : 0 })).then((r) => {
        const notes = (inst.state.libNotes || []).map((n) => (n.id === id ? Object.assign({}, n, { files: (n.files || []).map((x) => (x.id === f.id ? r.file : x)) }) : n));
        apply(inst, { libNotes: notes });
      }).catch((e) => { fail(e); const notes = (inst.state.libNotes || []).map((n) => (n.id === id ? Object.assign({}, n, { files: (n.files || []).filter((x) => x.id !== f.id) }) : n)); apply(inst, { libNotes: notes }); })));
    };

    inst._vhooks.push((p, n) => {
      const pm = byId(p.libNotes), nm = byId(n.libNotes);
      (n.libNotes || []).forEach((note) => {
        const old = pm[note.id];
        if (!old) return; // brand-new blank note: nothing to save until it has a title
        if (isTemp(note.id)) {
          if (note.title !== old.title || note.html !== old.html || note.tags !== old.tags) {
            if (!(note.title || '').trim()) { if (!warned[note.id] && (note.html || note.tags) && (note.html !== old.html || note.tags !== old.tags)) { warned[note.id] = 1; schedule(note.id, 'warn', () => { const c = cur(note.id); if (c && !(c.title || '').trim()) V.toast('Give the note a title and it will be saved to the vault.'); }, 2500); } }
            else schedule(note.id, 'create', () => createNow(note.id), 1100);
          }
          (note.files || []).forEach((f) => { if (!(old.files || []).some((x) => x.id === f.id) && created[note.id]) created[note.id].then(() => { const c = (inst.state.libNotes || []).find((q) => (q.files || []).some((x) => x.id === f.id)); if (c) uploadFile(c.id, f); }); });
          return;
        }
        if (note.title !== old.title) schedule(note.id, 'title', () => { const c = cur(note.id); if (!c || !(c.title || '').trim()) return; track(enqueue('lib', () => V.call('PATCH', '/api/lib/' + encodeURIComponent(note.id), { title: c.title }).then((r) => { if (r.id !== note.id) swapId(note.id, r.id); }).catch((e) => { fail(e); load(); }))); }, 1300);
        if (note.html !== old.html) schedule(note.id, 'body', () => saveBody(note.id), 1000);
        if (note.tags !== old.tags) schedule(note.id, 'tags', () => { const c = cur(note.id); if (c) track(enqueue('lib', () => V.call('PATCH', '/api/lib/' + encodeURIComponent(note.id), { tags: c.tags }).catch((e) => { fail(e); load(); }))); }, 500);
        (note.files || []).forEach((f) => { if (!(old.files || []).some((x) => x.id === f.id) && f.file) uploadFile(note.id, f); });
        (old.files || []).forEach((f) => { if (!(note.files || []).some((x) => x.id === f.id) && !f.file) track(enqueue('lib', () => V.del('/api/lib/' + encodeURIComponent(note.id) + '/files?name=' + encodeURIComponent(f.name)).catch((e) => { fail(e); load(); }))); });
      });
      (p.libNotes || []).forEach((note) => {
        if (nm[note.id] || isTemp(note.id)) return;
        // a note that is open and renamed gets a new id (handled by swapId, which keeps it in the list)
        track(enqueue('lib', () => V.del('/api/lib/' + encodeURIComponent(note.id)).catch((e) => { fail(e); load(); })));
      });
    });
    load();
    poller(() => { if (!inst.state.libNote) load(); }, 30000);
  }


  // ---------- areas (folder trees) ----------
  function areas(inst) {
    const load = () => V.get('/api/areas').then((j) => { if (!same(j, inst.state.vareas)) apply(inst, { vareas: j }); }).catch(() => {});
    load();
    poller(load, 60000);
  }


  // ---------- rich fields: project Goal / Context / Notes and read-only rich text, shown the way Obsidian shows it ----------
  let RICH = null;
  const seen = new WeakMap();
  function richLoad() { return RICH ? Promise.resolve(RICH) : import('/rich.mjs').then((m) => { RICH = m; return m; }); }
  function pfields(inst) {
    const valueOf = (name, f) => {
      const pe = (inst.state.pe || {})[name]; if (pe && pe[f] !== undefined) return pe[f];
      const p = (inst.state.vproj || []).find((x) => x.name === name); if (!p) return '';
      if (f === 'notesText') return p.notesText !== undefined ? p.notesText : (p.notes || []).join('\n');
      return p[f] || '';
    };
    const scan = () => {
      if (!RICH) return;
      document.querySelectorAll('[data-pf]').forEach((el) => {
        if (document.activeElement === el) return;
        const name = el.getAttribute('data-pn'); if (!name) return;
        const key = name + '\u0000' + valueOf(name, el.getAttribute('data-pf'));
        if (seen.get(el) !== key) { const md0 = valueOf(name, el.getAttribute('data-pf')); el.innerHTML = md0.trim() ? RICH.mdToHtml(md0) : ''; seen.set(el, key); }
      });
    };
    richLoad().then(scan);
    new MutationObserver(scan).observe(document.body, { childList: true, subtree: true });
    setInterval(scan, 1500);
    // live formatting while typing (like Obsidian's live preview): finish a [[link]], **bold**, *italic*, ~~strike~~, ==mark== or `code`
    // and the marks disappear; "# ", "- ", "1. ", "> " at the start of a line turn into a heading, bullet, number or quote.
    const unwrap = (h) => h.replace(/^<div>([\s\S]*)<\/div>$/, (m, x) => (x.indexOf('<div') < 0 ? x : m));
    const live = (el, ev) => {
      if (!RICH || !ev || ev.inputType !== 'insertText') return;
      const sel = window.getSelection(); if (!sel.rangeCount || !sel.isCollapsed) return;
      const r = sel.getRangeAt(0), node = r.startContainer; if (node.nodeType !== 3) return;
      const before = node.data.slice(0, r.startOffset);
      if (/^[ \u00a0]$/.test(ev.data || '')) {
        const m = /^(#{1,6}|-|\*|\d+\.|>)[ \u00a0]$/.exec(node.data);
        let blk = node; while (blk.parentNode && blk.parentNode !== el) blk = blk.parentNode;
        const only = blk === node || (blk.textContent === node.data);
        if (m && only && r.startOffset === node.data.length) {
          const k = m[1];
          const tag = k[0] === '#' ? 'h3' : (k === '>' ? 'blockquote' : (k === '-' || k === '*' ? 'ul' : 'ol'));
          const mk = document.createElement(tag), inner = tag === 'ul' || tag === 'ol' ? mk.appendChild(document.createElement('li')) : mk;
          const br = document.createElement('br'); inner.appendChild(br);
          if (blk === node) el.replaceChild(mk, node); else el.replaceChild(mk, blk);
          const q = document.createRange(); q.setStart(inner, 0); q.collapse(true); sel.removeAllRanges(); sel.addRange(q);
          return true;
        }
      }
      const pats = [/\[\[[^\[\]\n|#]+(?:[#|][^\[\]\n]*)?\]\]$/, /\*\*[^*\n]+\*\*$/, /~~[^~\n]+~~$/, /==[^=\n]+==$/, /`[^`\n]+`$/, /(?:^|[^*])(\*[^*\s][^*\n]*\*)$/];
      for (let i = 0; i < pats.length; i++) {
        const m = pats[i].exec(before); if (!m) continue;
        const md = i === 5 ? m[1] : m[0];
        if (i === 5 && /\s\*$/.test(md)) continue;
        const html = unwrap(RICH.mdToHtml(md));
        const q = document.createRange(); q.setStart(node, r.startOffset - md.length); q.setEnd(node, r.startOffset); q.deleteContents();
        const tpl = document.createElement('template'); tpl.innerHTML = html;
        const z = document.createTextNode('\u200b'); tpl.content.appendChild(z);
        q.insertNode(tpl.content);
        const c = document.createRange(); c.setStart(z, 1); c.collapse(true); sel.removeAllRanges(); sel.addRange(c);
        return true;
      }
    };
    document.addEventListener('input', (e) => {
      const el = e.target.closest && e.target.closest('[data-pf]'); if (!el || !RICH) return;
      try { live(el, e); } catch (_) {}
      const name = el.getAttribute('data-pn'), f = el.getAttribute('data-pf'); if (!name) return;
      const md = RICH.htmlToMd(el.innerHTML).replace(/\u200b/g, '');
      seen.set(el, name + '\u0000' + md);
      const pe0 = inst.state.pe || {};
      inst.setState({ pe: { ...pe0, [name]: { ...(pe0[name] || {}), [f]: md } } });
    });
    // leaving a field shows it formatted (so typed # and ** turn into headings and bold)
    document.addEventListener('focusout', (e) => { const el = e.target.closest && e.target.closest('[data-pf]'); if (el) { seen.delete(el); setTimeout(scan, 50); } });
    document.addEventListener('paste', (e) => {
      const el = e.target.closest && e.target.closest('[data-pf]'); if (!el || !RICH) return;
      e.preventDefault();
      const tx = (e.clipboardData || window.clipboardData).getData('text/plain');
      document.execCommand('insertHTML', false, RICH.mdToHtml(tx).replace(/^<div>([\s\S]*)<\/div>$/, (m, x) => (x.indexOf('<div') < 0 ? x : m)));
    });
  }
  // read-only rich text (log lines etc.)
  function richReadOnly() {
    const scan = () => {
      if (!RICH) return;
      document.querySelectorAll('[data-rich]').forEach((el) => {
        const md = el.getAttribute('data-rich') || '';
        if (seen.get(el) !== md) { el.innerHTML = RICH.mdToHtml(md); seen.set(el, md); }
      });
    };
    richLoad().then(scan);
    new MutationObserver(scan).observe(document.body, { childList: true, subtree: true });
  }

  // ---------- [[links]]: open the note in Obsidian, like Obsidian does ----------
  function wikilinks() {
    document.addEventListener('click', (e) => {
      const ext = e.target.closest && e.target.closest('.rt-ed a[href^="http"], .rt-ed a[href^="mailto:"]');
      if (ext) { e.preventDefault(); window.open(ext.getAttribute('href'), '_blank', 'noopener'); return; }
      const a = e.target.closest && e.target.closest('a[data-wl]');
      if (!a) return;
      e.preventDefault();
      const raw = a.getAttribute('data-wl') || '';
      V.get('/api/resolve?name=' + encodeURIComponent(raw)).then((j) => {
        if (!j.path) { V.toast('No note called "' + raw.split('|')[0].split('#')[0] + '" in the vault yet.'); return; }
        const h = raw.split('|')[0].split('#')[1];
        location.href = 'obsidian://open?vault=' + encodeURIComponent(j.vault) + '&file=' + encodeURIComponent(j.path + (h ? '#' + h : ''));
      }).catch(() => V.toast("Couldn't look that link up."));
    }, true);
  }

  // ---------- search (sidebar box or Ctrl+K) ----------
  function palette() {
    let box, input, list, t, seq = 0, vault = 'LifeOS';
    const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    const close = () => { if (box) { box.remove(); box = null; } };
    const render = (res, q) => {
      if (!res.length) { list.innerHTML = '<div style="padding:16px;color:#8A8A8A;font-size:13px;">' + (q.length < 2 ? 'Type at least 2 letters.' : 'Nothing found.') + '</div>'; return; }
      list.innerHTML = res.map((r) => '<a href="obsidian://open?vault=' + encodeURIComponent(vault) + '&file=' + encodeURIComponent(r.path) + '" style="display:block;min-height:44px;box-sizing:border-box;padding:10px 16px;border-top:1px solid #242424;text-decoration:none;color:#EDEDED;">'
        + '<div style="font-size:14px;">' + esc(r.title) + ' <span style="font-family:\'IBM Plex Mono\',monospace;font-size:11px;color:#8A8A8A;">' + esc(r.folder) + '</span></div>'
        + (r.snippet ? '<div style="font-size:12px;color:#9A9A9A;margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + esc(r.snippet) + '</div>' : '') + '</a>').join('');
    };
    const go = () => {
      const q = input.value.trim(); const n = ++seq;
      if (q.length < 2) return render([], q);
      V.get('/api/search?q=' + encodeURIComponent(q)).then((j) => { if (n !== seq || !box) return; vault = j.vault || vault; render(j.results || [], q); }).catch(() => { if (box) list.innerHTML = '<div style="padding:16px;color:#8A8A8A;font-size:13px;">Search failed.</div>'; });
    };
    const open = () => {
      if (box) { input.focus(); return; }
      box = document.createElement('div');
      box.setAttribute('role', 'dialog'); box.setAttribute('aria-label', 'Search the vault');
      box.style.cssText = 'position:fixed;inset:0;z-index:95;background:rgba(0,0,0,.6);display:flex;justify-content:center;align-items:flex-start;padding:10vh 16px 0;';
      box.innerHTML = '<div style="width:min(620px,100%);max-height:70vh;display:flex;flex-direction:column;border-radius:14px;background:#1A1A1A;border:1px solid #333;overflow:hidden;font-family:\'IBM Plex Sans\',sans-serif;">'
        + '<input type="search" aria-label="Search notes" placeholder="Search notes in your vault" style="all:unset;box-sizing:border-box;width:100%;min-height:52px;padding:0 16px;font-size:15px;color:#F5F5F5;">'
        + '<div data-r style="overflow-y:auto;"></div></div>';
      document.body.appendChild(box);
      input = box.querySelector('input'); list = box.querySelector('[data-r]');
      render([], '');
      input.focus();
      input.addEventListener('input', () => { clearTimeout(t); t = setTimeout(go, 180); });
      box.addEventListener('mousedown', (e) => { if (e.target === box) close(); });
    };
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && box) { close(); return; }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); open(); }
    });
    document.addEventListener('click', (e) => {
      const d = e.target.closest && e.target.closest('div');
      if (d && d.children.length === 2 && d.children[0].tagName === 'svg' && d.children[0].querySelector('circle') && d.children[1].textContent.trim() === 'Search') open();
    });
  }

  // ---------- attach ----------
  function attach(inst) {
    inst._vhooks = [];
    if (HOME.indexOf(page) >= 0) { tasks(inst); events(inst); daily(inst); if (page === 'Projects') projects(inst); else projCount(inst); }
    if (page === 'Finances') finance(inst);
    if (page === 'Mma') mmaLog(inst);
    if (page === 'Main') homeHealth(inst);
    if (page === 'Spiritual') spiritual(inst);
    if (page === 'Health') healthLogs(inst);
    if (LIB[page]) library(inst, LIB[page]);
    if (page === 'Areas') areas(inst);
    if (page === 'Projects') pfields(inst);
  }
  const wait = (n) => { if (window.__dc) return V.ready.then((on) => { if (on) attach(window.__dc); }); if (n > 200) return; setTimeout(() => wait(n + 1), 25); };
  wait(0);
  V.ready.then((on) => { if (on) { palette(); wikilinks(); richReadOnly(); } });
})();
