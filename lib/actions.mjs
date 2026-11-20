// Confirm-before-write actions for R.E.N.E.E.
// Claude Code stays read-only. A reply may end with <actions>[{"type":"...","args":{...}}]</actions>. This module:
//   1. cuts that block out of the text (so it is never shown or spoken),
//   2. checks every action against a short whitelist and normalises every field (nothing else gets through),
//   3. hands the checked actions to the page as "proposed". NOTHING is written here.
// The page shows a card (or asks aloud); only if Jess says Yes does it call the existing routes. Nothing here deletes anything.
import { todayStr, isDate } from './vault.mjs';
import { listTasks } from './tasks.mjs';
import { listProjects } from './projects.mjs';
import { logAction } from './agent.mjs';

export const HABITS = ['Meditation', 'Prayer', 'Training', 'Studying', 'Reading'];
const MAX_ACTIONS = 5, TTL = 30 * 60 * 1000;
const FORBIDDEN_PLACE = /(01 Inbox|05 Journal|2 Machine)/i;
const PATHISH_KEY = /^(path|file|filepath|filename|folder|dir|directory|target|note|url|uri)$/i;

// ---- 1. cut the block out ----
const BLOCK = /<actions>([\s\S]*?)<\/actions>/gi;
/** Returns { text: reply without any <actions> block, raw: parsed array (or [] when absent or broken) }. */
export function extractActions(reply) {
  const s = String(reply || '');
  let raw = [];
  const m = [...s.matchAll(BLOCK)];
  for (const x of m) {
    try { const j = JSON.parse(x[1].trim()); if (Array.isArray(j)) raw = raw.concat(j); } catch (_) { /* a broken block proposes nothing */ }
  }
  // also remove a block that was never closed (cut-off answer)
  const text = s.replace(BLOCK, '').replace(/<actions>[\s\S]*$/i, '').replace(/\n{3,}/g, '\n\n').trim();
  return { text, raw };
}
/** For streaming: how much of the text so far is safe to show or speak (stops before a possible "<actions>"). */
export function safePrefixLength(text) {
  const i = text.search(/<actions/i); if (i >= 0) return i;
  const tail = text.lastIndexOf('<');
  if (tail >= 0 && '<actions>'.startsWith(text.slice(tail).toLowerCase()) && text.length - tail < 9) return tail;
  return text.length;
}

// ---- 2. whitelist and validation ----
const clean = (v, max) => String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\[\[|\]\]|[\[\]<>]|::/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
const timeOk = (s) => typeof s === 'string' && /^([01]?\d|2[0-3]):[0-5]\d$/.test(s.trim());
const t5 = (s) => s.trim().padStart(5, '0');
const dateOk = (s) => isDate(s) && s >= '2000-01-01' && s <= '2100-12-31';
const PRI = { low: 'Low', medium: 'Medium', med: 'Medium', high: 'High' };
const niceDate = (d) => (d === todayStr() ? 'today' : d);
// how it is read aloud: "November 20", "5 PM"
const sayDate = (d) => { if (d === todayStr()) return 'today'; try { return new Date(d + 'T12:00:00').toLocaleDateString('en-US', { month: 'long', day: 'numeric' }); } catch (_) { return d; } };
const sayTime = (t) => { const [h, m] = t.split(':').map(Number); return (h % 12 || 12) + (m ? ':' + String(m).padStart(2, '0') : '') + ' ' + (h < 12 ? 'AM' : 'PM'); };

const VALIDATORS = {
  add_task(a) {
    const title = clean(a.title, 200); if (!title) return 'a task needs a title';
    const out = { title };
    if (a.due != null && a.due !== '') { if (!dateOk(a.due)) return 'the due date must be YYYY-MM-DD'; out.dueKey = a.due; }
    if (a.time != null && a.time !== '') { if (!timeOk(a.time)) return 'the time must be HH:MM'; if (!out.dueKey) return 'a time needs a due date'; out.time = t5(a.time); }
    if (a.priority != null && a.priority !== '') { const p = PRI[String(a.priority).toLowerCase()]; if (!p) return 'priority must be Low, Medium or High'; out.priority = p; }
    if (a.project != null && a.project !== '') {
      const want = clean(a.project, 100).toLowerCase();
      const hit = listProjects().projects.map((p) => p.name || p.title).filter(Boolean).find((n) => n.toLowerCase() === want);
      if (!hit) return 'there is no project called "' + clean(a.project, 60) + '"';
      out.project = hit;
    }
    const lead = 'Add task: ' + title; return { say: lead + (out.dueKey ? ', due ' + sayDate(out.dueKey) + (out.time ? ' at ' + sayTime(out.time) : '') : '') + (out.priority ? ', ' + out.priority + ' priority' : '') + (out.project ? ', in ' + out.project : ''), args: out, label: 'Add task: ' + title + (out.dueKey ? ', due ' + out.dueKey + (out.time ? ' at ' + out.time : '') : '') + (out.priority ? ', ' + out.priority + ' priority' : '') + (out.project ? ', in ' + out.project : '') };
  },
  complete_task(a) {
    const title = clean(a.title, 200).toLowerCase(); if (!title) return 'say which task';
    const open = listTasks().tasks.filter((t) => !t.done && String(t.title).trim().toLowerCase() === title);
    if (open.length === 0) return 'no open task is called exactly that';
    if (open.length > 1) return 'more than one open task has that name';
    return { say: 'Mark task done: ' + open[0].title, args: { id: open[0].id, done: true }, label: 'Mark task done: ' + open[0].title };
  },
  tick_habit(a) {
    const h = HABITS.find((x) => x.toLowerCase() === String(a.habit || '').trim().toLowerCase());
    if (!h) return 'the habit must be one of ' + HABITS.join(', ');
    const done = a.done === false ? false : true; // today only: the date is set here, not taken from the reply
    return { say: (done ? 'Tick ' : 'Untick ') + h + ' for today', args: { date: todayStr(), habit: h, done }, label: (done ? 'Tick habit: ' : 'Untick habit: ') + h + ' (today)' };
  },
  add_capture(a) {
    const text = clean(a.text, 500); if (!text) return 'a capture needs text';
    return { say: "Add to today's captures: " + text, args: { text }, label: "Add to today's Captures: " + text };
  },
  add_event(a) {
    const title = clean(a.title, 120); if (!title) return 'an event needs a title';
    if (!dateOk(a.date)) return 'the event date must be YYYY-MM-DD';
    const out = { title, date: a.date };
    if (a.allDay === true || (!a.start && !a.end)) out.allDay = true;
    else {
      if (!timeOk(a.start)) return 'the start time must be HH:MM';
      out.start = t5(a.start);
      if (a.end != null && a.end !== '') { if (!timeOk(a.end)) return 'the end time must be HH:MM'; if (t5(a.end) <= out.start) return 'the end must be after the start'; out.end = t5(a.end); }
    }
    return { say: 'Add event: ' + title + ', ' + sayDate(out.date) + (out.allDay ? ', all day' : ' at ' + sayTime(out.start) + (out.end ? ' to ' + sayTime(out.end) : '')), args: out, label: 'Add event: ' + title + ', ' + niceDate(out.date) + (out.allDay ? ' (all day)' : ' at ' + out.start + (out.end ? '-' + out.end : '')) };
  },
};

// Words that show Jess really asked for a change. Without one, any action is dropped: a web page or a file cannot start an action by itself.
const CHANGE_WORDS = /\b(add|create|remind|reminder|schedule|book|put|tick|untick|mark|complete|completed|finish|finished|log|capture|jot|task|todo|to-do|event|appointment|meeting|habit)\b/i;
export const askedForChange = (userText) => CHANGE_WORDS.test(String(userText || ''));

const store = new Map(); // id -> { type, args, label, session, created, state }
let seq = 0;
const sweep = () => { const now = Date.now(); for (const [k, v] of store) if (now - v.created > TTL) store.delete(k); };

/**
 * raw: the parsed <actions> list. ctx: { userText, session, untrusted } (untrusted = web or attached content was read this turn).
 * Returns { proposed: [{ id, type, label, args }], rejected: [reasons] }.
 */
export function validateActions(raw, ctx = {}) {
  const proposed = [], rejected = [];
  if (!Array.isArray(raw) || !raw.length) return { proposed, rejected };
  if (ctx.untrusted) return { proposed, rejected: ['this answer used web or file content, which can never start a change'] };
  if (!askedForChange(ctx.userText)) return { proposed, rejected: ['the request did not ask for a change'] };
  sweep();
  for (const item of raw.slice(0, MAX_ACTIONS)) {
    try {
      if (!item || typeof item !== 'object' || Array.isArray(item)) { rejected.push('not an action'); continue; }
      const type = String(item.type || '');
      const fn = Object.prototype.hasOwnProperty.call(VALIDATORS, type) ? VALIDATORS[type] : null;
      if (!fn) { rejected.push('"' + clean(type, 40) + '" is not an allowed action'); continue; }
      const a = item.args && typeof item.args === 'object' && !Array.isArray(item.args) ? item.args : {};
      if (Object.keys(a).some((k) => PATHISH_KEY.test(k))) { rejected.push(type + ': file paths are not allowed'); continue; }
      if (Object.values(a).some((v) => typeof v === 'string' && FORBIDDEN_PLACE.test(v))) { rejected.push(type + ': that part of the vault is off limits'); continue; }
      const r = fn(a);
      if (typeof r === 'string') { rejected.push(type + ': ' + r); continue; }
      const id = 'act_' + Date.now().toString(36) + '_' + (++seq);
      store.set(id, { type, args: r.args, label: r.label, say: r.say, session: ctx.session || '', created: Date.now(), state: 'proposed' });
      proposed.push({ id, type, label: r.label, say: r.say || r.label, args: r.args });
    } catch (e) { rejected.push('could not check an action'); }
  }
  if (raw.length > MAX_ACTIONS) rejected.push('only the first ' + MAX_ACTIONS + ' actions are considered');
  return { proposed, rejected };
}

// ---- 3. after Jess confirmed and the page did it: record it ----
export function actionDone(b) {
  const id = String((b && b.id) || '');
  const p = store.get(id);
  if (!p) return { ok: false, error: 'That proposal has expired.' };
  if (p.state !== 'proposed') return { ok: true, already: true };
  p.state = b.ok ? 'done' : 'failed';
  logAction(p.session, (b.ok ? 'Confirmed by Jess and done: ' : 'Confirmed by Jess but it failed: ') + p.label + (b.ok ? '' : ' (' + clean(b.error, 160) + ')'));
  return { ok: true };
}
/** The page tells us Jess said No (only counted so the same proposal cannot be confirmed later). */
export function actionDeclined(b) {
  const p = store.get(String((b && b.id) || '')); if (p && p.state === 'proposed') p.state = 'declined';
  return { ok: true };
}
/** Did this proposal come from us and is it still waiting? (used by the confirm step) */
export function isPending(id) { const p = store.get(id); return !!p && p.state === 'proposed' && Date.now() - p.created < TTL; }
