// Auto-sync ("Ctrl+S like Google Docs"): the same Sync as the button, started by itself.
//  - a note is changed here -> 30 s after the last change (so a note is not saved half typed), save and send it
//  - every 60 s: if GitHub has something new, bring it in
// Same rules as the button: nothing is overwritten or deleted, the newer edit keeps the name, deleted notes go to the Bin.
// Settings in .env: AUTOSYNC=0 (never), AUTOSYNC_QUIET_S, AUTOSYNC_PULL_S, AUTOSYNC_TICK_S. The on/off choice is kept in .memory/autosync.json.
import fs from 'node:fs';
import path from 'node:path';
import { env, ROOT, VAULT } from './vault.mjs';
import { gitSyncRun, localSignature, remoteAhead, syncBusy } from './gitsync.mjs';

const QUIET_MS = Number(env.AUTOSYNC_QUIET_S || 30) * 1000;
const PULL_MS = Number(env.AUTOSYNC_PULL_S || 60) * 1000;
const TICK_MS = Number(env.AUTOSYNC_TICK_S || 10) * 1000;
const FILE = path.join(ROOT, '.memory', 'autosync.json');

const state = { on: env.AUTOSYNC !== '0', available: env.AUTOSYNC !== '0', last: null, failures: 0 };
let running = false, lastSig = '', changedAt = 0, lastPull = 0, nextAllowed = 0, timer = null;

try { const j = JSON.parse(fs.readFileSync(FILE, 'utf8')); if (typeof j.on === 'boolean') state.on = j.on && state.available; } catch { /* first run */ }

export function autosyncStatus() {
  return { ok: true, on: state.on, available: state.available, quietSeconds: QUIET_MS / 1000, checkSeconds: PULL_MS / 1000, last: state.last, failures: state.failures };
}
export function autosyncSet(on) {
  state.on = !!on && state.available;
  try { fs.mkdirSync(path.dirname(FILE), { recursive: true }); fs.writeFileSync(FILE, JSON.stringify({ on: state.on })); } catch { /* the choice just is not remembered */ }
  lastSig = ''; nextAllowed = 0; state.failures = 0;
  return autosyncStatus();
}

async function run(reason) {
  const now = Date.now();
  try {
    const r = await gitSyncRun();
    state.last = { at: new Date().toISOString(), reason, ok: r.ok, pulled: r.pulled, pushed: r.pushed, conflicts: r.conflicts.length, error: r.error };
    if (r.ok) { state.failures = 0; nextAllowed = 0; lastSig = ''; }
    else fail(now);
  } catch (e) {
    state.last = { at: new Date().toISOString(), reason, ok: false, pulled: 0, pushed: 0, conflicts: 0, error: String((e && e.message) || e).slice(0, 240) };
    fail(now);
  }
}
// no internet, a git lock, a refused login ...: wait longer each time (up to 10 min) instead of hammering
function fail(now) { state.failures++; nextAllowed = now + Math.min(600000, TICK_MS * 3 * 2 ** Math.min(state.failures, 8)); }

async function tick() {
  if (!state.on || running || syncBusy() || Date.now() < nextAllowed) return;
  if (!fs.existsSync(path.join(VAULT, '.git'))) return;
  running = true;
  try {
    const now = Date.now();
    const sig = await localSignature();
    if (sig) {
      if (sig !== lastSig) { lastSig = sig; changedAt = now; return; } // still being edited: wait
      if (now - changedAt >= QUIET_MS) return await run('edits');
      return; // changed recently: do not bring in other changes under your hands either
    }
    lastSig = '';
    if (now - lastPull >= PULL_MS) {
      lastPull = now;
      if (await remoteAhead()) await run('remote');
    }
  } catch (e) {
    fail(Date.now());
  } finally { running = false; }
}

export function startAutosync() {
  if (!state.available || timer) return;
  timer = setInterval(tick, TICK_MS);
  console.log(`Auto-sync is ${state.on ? 'on' : 'off'} (saves ${QUIET_MS / 1000} s after your last change, checks for news every ${PULL_MS / 1000} s).`);
}
