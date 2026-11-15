// A short, live summary of the dashboard (active projects, open tasks, today's events and habits), read with the same code the
// pages use. The voice agent gets it with every question, so it answers "which projects are active?" like the dashboard does
// instead of searching the vault for it.
import { listProjects } from './projects.mjs';
import { listTasks } from './tasks.mjs';
import { listEvents } from './daily.mjs';
import { getHabits } from './habits.mjs';
import { listEntries } from './finance.mjs';
import { listHealth } from './healthlogs.mjs';
import { listReviews } from './reviews.mjs';
import { listAreas } from './areas.mjs';
import { todayStr, addDays } from './vault.mjs';

// Local date and time for the question (the server runs on the same computer or phone as you, so this is your clock).
export function nowText() {
  const d = new Date();
  const tz = (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch (e) { return ''; } })();
  return d.toLocaleString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' }) + (tz ? ' (' + tz + ')' : '');
}

const clip = (s, n) => { s = String(s || '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; };

// Extra sections (the other dashboard pages): finances, health, habits, reviews, areas. Always included, in compact form.
const dump = (label, v, n) => { let t; try { t = JSON.stringify(v); } catch (e) { return ''; } return label + ': ' + (t.length > n ? t.slice(0, n) + '…' : t) + '.'; };
const last = (a, n) => (Array.isArray(a) ? a.slice(-n) : a);
function extras(q, today) {
  const out = [], has = () => true; // every section is always included, kept compact
  if (has(/money|financ|asset|balance|spen[dt]|saving|invest|net worth|cash|crypto|stock|income|expens/i)) try {
    const by = {}; for (const e of listEntries().entries || []) (by[e.asset] = by[e.asset] || []).push(e);
    out.push(dump('Finances (latest log entries per asset)', Object.fromEntries(Object.entries(by).map(([k, v]) => [k, v.sort((a, b) => (a.date < b.date ? -1 : 1)).slice(-4).map((e) => e.date + ' ' + e.kind + ' ' + e.amt)])), 900));
  } catch (e) {}
  if (has(/health|lift|workout|train|\brun|sprint|weigh|measure|sleep|steps|routine|exercise|physio|\bpt\b|recover|body/i)) try {
    const h = listHealth();
    out.push(dump('Health', { lifts: last(h.lifts, 6), runs: last(h.runs, 6), pt: last(h.pt, 4), rec: last(h.rec, 4), measures: last(h.measures, 4), sprints: last(h.sprints, 4), routines: (h.routines || []).map((r) => r.name || r).slice(0, 12) }, 1100));
  } catch (e) {}
  if (has(/habit|streak|meditat|prayer|pray|studying|reading|consisten/i)) try {
    let d = today; for (let i = 0; i < 13; i++) d = addDays(d, -1);
    const h = getHabits(d, today), tot = {}; for (const day of Object.values(h.days)) for (const [k, v] of Object.entries(day)) tot[k] = (tot[k] || 0) + (v ? 1 : 0);
    out.push('Habits, days done in the last 14 days (' + h.notes.length + ' daily notes): ' + Object.entries(tot).map(([k, v]) => k + ' ' + v).join(', ') + '.');
  } catch (e) {}
  if (has(/review|performance|score|weekly|monthly|how am i doing|progress/i)) try { out.push(dump('Latest reviews', last(listReviews().reviews, 3), 1100)); } catch (e) {}
  if (has(/area|spiritual|\bwork\b|mma|knowledge|folder/i)) try { out.push(dump('Areas', listAreas().map((a) => ({ name: a.name, updated: a.upd, items: (a.tree || []).slice(0, 12).map((n) => n.name || n.n || n.title || n) })), 900)); } catch (e) {}
  return out;
}

export function liveSnapshot(question = '') {
  const out = [];
  const today = todayStr();
  try {
    const ps = listProjects().projects || [];
    const act = ps.filter((p) => p.status === 'active'), hold = ps.filter((p) => p.status === 'hold'), done = ps.filter((p) => p.status === 'done');
    out.push(`Active projects (${act.length}): ` + (act.length ? act.slice(0, 20).map((p) => {
      const open = (p.tasks || []).filter((t) => !t[1]).length;
      return clip(p.name, 50) + (p.due ? ' (due ' + p.due + ')' : '') + (open ? ', ' + open + ' open tasks' : '') + (p.goal ? ': ' + clip(p.goal, 90) : '');
    }).join('; ') : 'none') + '.');
    if (hold.length) out.push('On hold: ' + hold.slice(0, 15).map((p) => clip(p.name, 40)).join(', ') + '.');
    if (done.length) out.push(done.length + ' projects done.');
  } catch (e) { /* the dashboard page shows the same errors */ }
  try {
    const ts = (listTasks().tasks || []).filter((t) => !t.done);
    ts.sort((a, b) => (a.dueKey || '9999').localeCompare(b.dueKey || '9999'));
    out.push(`Open tasks (${ts.length}): ` + (ts.length ? ts.slice(0, 15).map((t) => clip(t.title, 70) + (t.dueKey ? ' [due ' + t.dueKey + ']' : '') + (t.project ? ' {' + clip(t.project, 30) + '}' : '')).join('; ') : 'none') + '.');
  } catch (e) {}
  try {
    const ev = (listEvents(today, addDays(today, 7)).events || []);
    if (ev.length) out.push('Next 7 days: ' + ev.slice(0, 12).map((e) => e.date + (e.allDay ? '' : ' ' + e.start) + ' ' + clip(e.title, 50)).join('; ') + '.');
  } catch (e) {}
  try {
    const h = getHabits(today, today), d = h.days[today];
    if (d) out.push('Habits today: ' + h.habits.map((n) => n + (d[n] ? ' done' : ' not yet')).join(', ') + '.');
  } catch (e) {}
  try { out.push(...extras(String(question || ''), today)); } catch (e) {}
  return out.join('\n').slice(0, 8000);
}
