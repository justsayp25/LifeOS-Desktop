// Memory that survives restarts and new conversations. It lives in the app's own `.memory` folder (never in the vault, never in git).
//  - turns.jsonl : every voice and chat exchange, append-only. The latest ones are given to her when a new conversation starts.
//  - facts.json  : things you told her to remember ("remember that ..."). "Forget ..." marks a fact as forgotten; nothing is deleted.
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './vault.mjs';

const DIR = path.join(ROOT, '.memory');
const TURNS = path.join(DIR, 'turns.jsonl');
const FACTS = path.join(DIR, 'facts.json');
const clip = (s, n) => { s = String(s || '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
const ensure = () => { try { fs.mkdirSync(DIR, { recursive: true }); } catch (_) {} };

export function addTurn(src, user, reply) {
  try { ensure(); fs.appendFileSync(TURNS, JSON.stringify({ t: new Date().toISOString(), src, user: clip(user, 600), reply: clip(reply, 900) }) + '\n'); } catch (_) { /* memory must never break a conversation */ }
}
export function recentTurns(n = 10) {
  try {
    const lines = fs.readFileSync(TURNS, 'utf8').split('\n').filter(Boolean).slice(-n);
    return lines.map((l) => { try { return JSON.parse(l); } catch (_) { return null; } }).filter(Boolean);
  } catch (_) { return []; }
}
const readFacts = () => { try { const j = JSON.parse(fs.readFileSync(FACTS, 'utf8')); return Array.isArray(j) ? j : []; } catch (_) { return []; } };
const writeFacts = (list) => { ensure(); fs.writeFileSync(FACTS, JSON.stringify(list, null, 1)); };
export const listFacts = () => readFacts().filter((f) => !f.forgotten);

const words = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter((w) => w.length > 2);
const REMEMBER = /^\s*(?:hey,?\s*|ok(?:ay)?,?\s*)?(?:please\s+)?(?:remember|don't forget|do not forget|make a note|keep in mind|note)\s+(?:that\s+)?(.{4,300})$/i;
const FORGET = /^\s*(?:hey,?\s*|ok(?:ay)?,?\s*)?(?:please\s+)?forget\s+(?:that\s+|about\s+)?(.{3,300})$/i;

// Looks at what the user said (their own words only, never web pages or files) and saves or forgets a fact.
export function maybeRemember(text) {
  const t = String(text || '').trim().replace(/[.!?]+$/, '');
  let m = t.match(REMEMBER);
  if (m) {
    const fact = clip(m[1], 240), list = readFacts();
    if (list.some((f) => !f.forgotten && f.text.toLowerCase() === fact.toLowerCase())) return { saved: fact, dup: true };
    list.push({ id: Date.now().toString(36), text: fact, date: new Date().toISOString().slice(0, 10) });
    writeFacts(list);
    return { saved: fact };
  }
  m = t.match(FORGET);
  if (m) {
    const q = words(m[1]); if (!q.length) return null;
    const list = readFacts();
    let best = null, bs = 0;
    for (const f of list) { if (f.forgotten) continue; const fw = new Set(words(f.text)); const hit = q.filter((w) => fw.has(w)).length / q.length; if (hit > bs) { bs = hit; best = f; } }
    if (best && bs >= 0.5) { best.forgotten = true; best.forgottenOn = new Date().toISOString().slice(0, 10); writeFacts(list); return { forgot: best.text }; }
    return { forgot: '', missing: true };
  }
  return null;
}

// Text shown to the agent with every question.
export function factsBlock() {
  const f = listFacts().slice(-40);
  if (!f.length) return '';
  return 'Things the user asked you to remember (saved ' + f.length + '):\n' + f.map((x) => '- ' + x.text + ' (' + x.date + ')').join('\n');
}
// Shown once, when a new conversation starts.
export function historyBlock(n = 10) {
  const t = recentTurns(n);
  if (!t.length) return '';
  return 'Earlier conversations with the user, oldest first (' + t.length + ' most recent exchanges):\n' + t.map((x) => `- ${x.t.slice(0, 16).replace('T', ' ')} (${x.src}) User: ${clip(x.user, 200)} | You: ${clip(x.reply, 260)}`).join('\n');
}
