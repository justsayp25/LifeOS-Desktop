// The Training dot grid on the Health pages: one square per day for the last N weeks (columns = weeks Monday..Sunday, oldest first).
// A day lights up for lifts (by number of sets), cardio (a run or sprint, by minutes) or physical therapy (always a visible square).
// Numbers come from listHealth(), so it is GymMane's data where the backup exists (phone) and the vault notes everywhere else (PC).
import { listHealth } from './healthlogs.mjs';
import { todayStr } from './util.mjs';

const pad = (n) => String(n).padStart(2, '0');
const fmt = (d) => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
const liftLevel = (sets) => (sets <= 0 ? 0 : sets <= 5 ? 1 : sets <= 11 ? 2 : sets <= 17 ? 3 : 4);
const cardioLevel = (min, km) => (min >= 60 ? 4 : min >= 40 ? 3 : min >= 20 ? 2 : min > 0 || km > 0 ? 1 : 0);

export function trainSummary(weeks = 17) {
  weeks = Math.max(4, Math.min(52, Math.floor(Number(weeks) || 17)));
  const h = listHealth();
  const by = new Map(); // date -> {l: sets, c: min, km, cs: cardio sessions, p: pt entries}
  const day = (d) => { let x = by.get(d); if (!x) { x = { l: 0, c: 0, km: 0, cs: 0, p: 0 }; by.set(d, x); } return x; };
  for (const x of h.lifts) day(x.date).l += x.sets.filter((s) => Number(s.w) > 0 || Number(s.r) > 0).length;
  for (const r of h.runs) { const x = day(r.date); x.c += Number(r.time) || 0; x.km += Number(r.dist) || 0; x.cs++; }
  for (const r of h.sprints) { const x = day(r.date); x.c += (r.times || []).reduce((a, t) => a + t, 0) / 60; x.km += (r.dist || 0) / 1000; x.cs++; }
  for (const r of h.pt) day(r.date).p++;
  const today = todayStr(), now = new Date(today + 'T12:00:00');
  const monday = new Date(now); monday.setDate(now.getDate() - ((now.getDay() + 6) % 7)); // this week's Monday
  const start = new Date(monday); start.setDate(monday.getDate() - 7 * (weeks - 1));
  const cols = [];
  for (let w = 0; w < weeks; w++) {
    const col = [];
    for (let d = 0; d < 7; d++) {
      const dt = new Date(start); dt.setDate(start.getDate() + w * 7 + d);
      const date = fmt(dt), x = by.get(date), future = date > today;
      const lvl = future || !x ? 0 : Math.max(liftLevel(x.l), cardioLevel(x.c, x.km), x.p ? 2 : 0);
      col.push({ date, lvl, future, l: x ? x.l : 0, c: x ? Math.round(x.c) : 0, p: x ? x.p : 0 });
    }
    cols.push(col);
  }
  const wk = cols[cols.length - 1];
  const thisWeek = {
    lifts: wk.filter((d) => d.l > 0).length,
    cardio: wk.reduce((a, d) => a + (by.get(d.date) ? by.get(d.date).cs : 0), 0),
    pt: wk.reduce((a, d) => a + d.p, 0)
  };
  return { today, weeks, cols, thisWeek };
}
