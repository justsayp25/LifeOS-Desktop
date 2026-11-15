// A short, live summary of the dashboard (active projects, open tasks, today's events and habits), read with the same code the
// pages use. The voice agent gets it with every question, so it answers "which projects are active?" like the dashboard does
// instead of searching the vault for it.
import { listProjects } from './projects.mjs';
import { listTasks } from './tasks.mjs';
import { listEvents } from './daily.mjs';
import { getHabits } from './habits.mjs';
import { todayStr, addDays } from './vault.mjs';

const clip = (s, n) => { s = String(s || '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; };

export function liveSnapshot() {
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
  return out.join('\n').slice(0, 3500);
}
