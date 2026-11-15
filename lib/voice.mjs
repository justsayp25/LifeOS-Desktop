// Fast path for voice questions. One long-lived `claude` process (stream-json) stays open between turns,
// so there is no ~5 s start-up per question, and the answer streams back as it is written so the page can
// start speaking the first sentence early. Same rules as the text chat: read-only, web pages are data.
import { spawn } from 'node:child_process';
import path from 'node:path';
import { env, VAULT, ROOT, todayStr, HttpError } from './vault.mjs';
import { logTurn } from './agent.mjs';

const win = process.platform === 'win32';
const IDLE_MS = 20 * 60 * 1000;
const TURN_MS = Math.max(20, Number(env.VOICE_TIMEOUT) || 60) * 1000;
const PROMPT_FILE = path.join(ROOT, 'lib', 'voice-prompt.txt');

let w = null; // { p, ready, queue, cur, idle, session, buf }

function childEnv() {
  const e = { ...process.env };
  delete e.CLAUDECODE;
  if (!env.CHAT_USE_KEY) delete e.ANTHROPIC_API_KEY;
  e.MAX_THINKING_TOKENS = '0'; // no hidden thinking: spoken answers do not need it and it costs seconds
  return e;
}

function spawnWorker() {
  const web = env.CHAT_WEB !== '0';
  const q = (s) => (win ? '"' + s + '"' : s);
  const args = ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--include-partial-messages',
    '--model', 'haiku', '--tools', web ? 'Read,Glob,Grep,WebSearch,WebFetch' : 'Read,Glob,Grep',
    '--allowedTools', web ? 'Read,Glob,Grep,WebSearch,WebFetch' : 'Read,Glob,Grep', '--strict-mcp-config', '--disable-slash-commands', '--max-turns', '8',
    '--append-system-prompt-file', q(PROMPT_FILE)];
  const p = spawn('claude', args, { cwd: VAULT, env: childEnv(), shell: win, windowsHide: true });
  const x = { p, queue: [], cur: null, idle: null, session: '', buf: '', dead: false, started: Date.now(), ready: false };
  p.stdout.on('data', (d) => {
    x.buf += d;
    let i;
    while ((i = x.buf.indexOf('\n')) >= 0) { const line = x.buf.slice(0, i); x.buf = x.buf.slice(i + 1); if (line.trim()) onLine(x, line); }
  });
  p.stderr.on('data', () => {});
  const die = () => {
    if (x.dead) return; x.dead = true; clearTimeout(x.idle);
    if (w === x) w = null;
    const c = x.cur; x.cur = null; if (c) c.fail('The voice helper stopped. Try again.');
    for (const t of x.queue.splice(0)) t.fail('The voice helper stopped. Try again.');
  };
  p.on('error', die); p.on('close', die);
  bump(x);
  return x;
}
function bump(x) { clearTimeout(x.idle); x.idle = setTimeout(() => { try { x.p.kill(); } catch (_) {} }, IDLE_MS); }

function onLine(x, line) {
  let j; try { j = JSON.parse(line); } catch (_) { return; }
  if (j.type === 'system' && j.subtype === 'init') { x.ready = true; x.session = j.session_id || x.session; return; }
  const c = x.cur; if (!c) return;
  if (j.type === 'stream_event' && j.event && j.event.type === 'content_block_delta' && j.event.delta && j.event.delta.type === 'text_delta') {
    if (!c.first) c.first = Date.now();
    c.text += j.event.delta.text; c.emit({ d: j.event.delta.text });
  } else if (j.type === 'stream_event' && j.event && j.event.type === 'content_block_start' && j.event.content_block && j.event.content_block.type === 'tool_use') {
    c.emit({ tool: j.event.content_block.name });
  } else if (j.type === 'assistant' && j.message && Array.isArray(j.message.content) && j.message.content.some((b) => b.type === 'tool_use')) {
    c.text = ''; // anything said before a tool call was a preamble; the answer is what comes after
    c.emit({ reset: true });
  } else if (j.type === 'result') {
    x.cur = null; clearTimeout(c.timer); bump(x);
    const final = String(j.result || '').trim();
    if (j.is_error) c.fail(/login|auth|api key/i.test(final) ? 'Claude Code is not signed in. Open a terminal, run: claude, and sign in once.' : (final || 'Claude Code returned an error.').slice(0, 300));
    else c.finish(final || c.text.trim() || '(no answer)', { api: j.duration_api_ms, turns: j.num_turns });
    next(x);
  }
}
function next(x) {
  if (x.cur || x.dead) return;
  const t = x.queue.shift(); if (!t) return;
  if (t.cancelled) return next(x);
  x.cur = t; t.start = Date.now();
  t.timer = setTimeout(() => { t.fail('That took too long. Try again.'); x.cur = null; try { x.p.kill(); } catch (_) {} }, TURN_MS);
  try { x.p.stdin.write(JSON.stringify({ type: 'user', message: { role: 'user', content: t.prompt } }) + '\n'); } catch (e) { t.fail('The voice helper stopped. Try again.'); }
}

export async function voiceWarm() {
  const { chatStatusOk } = await import('./chat.mjs').then((m) => ({ chatStatusOk: m.chatStatus }));
  const st = await chatStatusOk();
  if (!st.ok) return { ok: false, error: st.reason };
  if (!w || w.dead) w = spawnWorker(); else bump(w);
  return { ok: true, ready: w.ready };
}

// res: Node response. Streams NDJSON: {d}, {tool}, {reset}, then {done,text,ms,first,api} or {error}.
export function voiceAsk(b, req, res) {
  const text = String((b && b.text) || '').trim();
  if (!text) throw new HttpError(400, 'Say something first.');
  if (text.length > 2000) throw new HttpError(400, 'That was too long.');
  res.writeHead(200, { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no' });
  const out = (o) => { try { if (!res.writableEnded) res.write(JSON.stringify(o) + '\n'); } catch (_) {} };
  const t0 = Date.now();
  const t = {
    prompt: text, text: '', first: 0, cancelled: false, start: 0, timer: null,
    emit: out,
    finish(reply, info) {
      logTurn(w ? w.session || 'voice' : 'voice', text, [], reply);
      out({ done: true, text: reply, ms: Date.now() - t0, queued: (t.start || t0) - t0, first: t.first ? t.first - t0 : null, api: info && info.api, turns: info && info.turns });
      try { res.end(); } catch (_) {}
    },
    fail(msg) { clearTimeout(t.timer); out({ error: msg }); try { res.end(); } catch (_) {} },
  };
  res.on('close', () => { if (!res.writableEnded) { t.cancelled = true; t.emit = () => {}; } });
  (async () => {
    const r = await voiceWarm();
    if (!r.ok) return t.fail(r.error || 'Claude Code is not installed.');
    // Date is passed with the first question only; the process keeps the conversation after that.
    if (!w.told) { w.told = true; t.prompt = `(Today is ${todayStr()}.)\n` + text; }
    w.queue.push(t); next(w);
  })().catch((e) => t.fail(String((e && e.message) || e)));
}

export function voiceReset() { if (w) { try { w.p.kill(); } catch (_) {} } return { ok: true }; }
