// Builds a THROWAWAY vault that looks like a busy week, for testing the pages: node tools/make-test-vault.mjs <folder>
import fs from 'node:fs'; import path from 'node:path';
const V = path.resolve(process.argv[2] || 'test-vault'); const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; const day = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return d; };
const w = (rel, t) => { const f = path.join(V, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, t); };
const today = ymd(day(0)), month = today.slice(0, 7);
w('AGENTS.md', '# Rules\nBe brief.\n');
w('2 Machine/01 Templates/Daily.md', '---\ntype: daily\ncreated: <% tp.date.now("YYYY-MM-DD") %>\n---\n# <% tp.file.title %>\n\n## Appointments\n\n## Habits\n- [ ] Meditation\n- [ ] Prayer\n- [ ] Training\n- [ ] Studying\n- [ ] Reading\n\n## Captures\n> Anything I mentioned today that might deserve a note.\n\n## Reflections\n> How did the day go?\n');
w('1 Human/03 Tasks/Current Tasks/Current Tasks.md', `---\ntype: tasks\n---\n# Current Tasks\n\n- [ ] Pay the water bill [due:: ${ymd(day(-2))}] [priority:: High]\n- [ ] Call the dentist [due:: ${today}] [time:: 15:30]\n- [ ] Buy HP T630 thin client (bare or low-RAM variant, ~₱940-2,080) [due:: ${ymd(day(3))}] [priority:: Medium]\n- [ ] Confirm RAM (8GB DDR4 if not included)\n- [ ] Reply to Sam about the weekend [due:: ${ymd(day(1))}] [project:: [[Garden]]]\n- [x] Send invoice [due:: ${ymd(day(-1))}] ✅ ${ymd(day(-1))}\n- [ ] Water the plants [due:: ${today}] [repeat:: weekly]\n`);
w('1 Human/04 Projects/Garden/Garden.md', `---\nstatus: active\ncreated: 2026-09-01\ndue_date: ${ymd(day(20))}\n---\n# Garden\n\n## Goal\nA small vegetable bed.\n\n## Tasks\n- [ ] Buy seeds [due:: ${ymd(day(2))}]\n- [ ] Build the frame\n\n## Log\n- ${ymd(day(-3))} -- Bought soil\n`);
w('1 Human/04 Projects/LifeOS/LifeOS.md', `---\nstatus: active\ncreated: 2026-10-01\n---\n# LifeOS\n\n## Goal\nA daily dashboard.\n\n## Tasks\n- [ ] Try the edit sheet\n\n## Log\n`);
w(`1 Human/02 Daily/${month}/${today}.md`, `---\ntype: daily\n---\n# ${today}\n\n## Appointments\n- 09:00-10:00 Standup\n- 18:30 Gym\n\n## Habits\n- [x] Meditation\n- [ ] Prayer\n- [ ] Training\n- [ ] Studying\n- [ ] Reading\n\n## Captures\nTest capture one\n\n## Reflections\n> How did the day go?\n`);
w('1 Human/11 Health/Tracker/Samsung Health/Samsung Health.md', `---\ntype: log\n---\n# Samsung Health\n\n## Log\n- ${today} -- steps: 6240, sleep: 7h 05m, resting hr: 58, active: 25, burned: 1980\n- ${ymd(day(-1))} -- steps: 11994, sleep: 6h 40m, resting hr: 60, active: 40, burned: 2410\n`);
fs.mkdirSync(path.join(V, '2 Machine/06 Agent Client'), { recursive: true });
console.log('test vault at', V);
