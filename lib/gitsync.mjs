// Vault sync through the private GitHub repo (the same repo on the PC and on the phone). One button: save local changes, fetch, merge,
// push. Nothing is ever overwritten or deleted: when both sides changed the same file, the NEWER one keeps the name and both copies are kept
// (the newer one keeps the note's name, the older is saved as "Note (conflict <device> <date time>).md" next to it). The vault keeps its own .gitignore (for example the Obsidian workspace files).
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { env, VAULT, HttpError } from './vault.mjs';

const device = () => String(env.DEVICE_NAME || os.hostname() || 'device').replace(/[^\w .-]/g, '').slice(0, 30) || 'device';
const pad = (n) => String(n).padStart(2, '0');
const stamp = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}${pad(d.getMinutes())}`;

function git(args, { buffer = false, ms = 120000, ok = [0] } = {}) {
  return new Promise((resolve) => {
    execFile('git', ['-c', 'core.quotepath=off', '-c', 'core.autocrlf=false', ...args], { cwd: VAULT, encoding: buffer ? 'buffer' : 'utf8', maxBuffer: 256 * 1024 * 1024, timeout: ms, windowsHide: true, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } },
      (err, stdout, stderr) => resolve({ code: err ? (typeof err.code === 'number' ? err.code : 1) : 0, out: stdout, err: String(stderr || (err && err.message) || '') }));
  });
}
const text = (r) => String(r.out || '').trim();
const lines = (r) => text(r).split('\n').map((s) => s.trim()).filter(Boolean);

let busy = false, last = null;

// A leftover git lock file (or another program using the repo) is the usual reason a save fails: say so in plain words.
function lockHint(err) {
  return /\.lock['"]?:? File exists|Unable to create .*\.lock|another git process/i.test(err)
    ? 'Another program is using the vault (a git lock file is in the way). Close Obsidian and other git tools, wait a few seconds and try again. If nothing is open, delete the file named in this message inside the vault\'s .git folder (HEAD.lock or index.lock).'
    : '';
}
// Seconds since 1970 of the last edit of every file that has uncommitted changes (before the save commit hides that).
async function editTimes() {
  const out = new Map();
  const r = await git(['status', '--porcelain', '-z', '--untracked-files=all']);
  for (const e of String(r.out || '').split('\0')) {
    if (e.length < 4) continue;
    const f = e.slice(3);
    try { out.set(f, Math.floor(fs.statSync(path.join(VAULT, f)).mtimeMs / 1000)); } catch { out.set(f, 0); /* deleted or renamed away */ }
  }
  return out;
}

const BIN = ['1 Human', '99 Bin'];
// Tracked files that are gone from the folder: put their last saved text into the Bin (flat, "(2)" for a name clash), like the dashboard's own delete.
async function binDeleted() {
  const gone = text(await git(['ls-files', '--deleted', '-z'])).split('\0').filter(Boolean);
  for (const f of gone) {
    if (f.startsWith(BIN.join('/') + '/') || f.startsWith('.obsidian/')) continue; // emptying the Bin, or Obsidian's own files: just recorded
    const blob = await git(['show', `HEAD:${f}`], { buffer: true });
    if (blob.code !== 0) continue;
    const dir = path.join(VAULT, ...BIN);
    fs.mkdirSync(dir, { recursive: true });
    const base = path.basename(f), ext = path.extname(base), stem = ext ? base.slice(0, -ext.length) : base;
    let dest = path.join(dir, base), n = 2;
    while (fs.existsSync(dest)) dest = path.join(dir, `${stem} (${n++})${ext}`);
    fs.writeFileSync(dest, blob.out);
  }
}

async function branchInfo() {
  const b = text(await git(['rev-parse', '--abbrev-ref', 'HEAD']));
  const remote = text(await git(['config', '--get', `branch.${b}.remote`])) || 'origin';
  return { branch: b, remote };
}

export async function gitStatus() {
  if (!fs.existsSync(path.join(VAULT, '.git'))) return { ok: true, repo: false, message: 'The vault is not connected to a GitHub repo on this device yet.' };
  const { branch, remote } = await branchInfo();
  const dirty = lines(await git(['status', '--porcelain'])).length;
  const ahead = Number(text(await git(['rev-list', '--count', `${remote}/${branch}..HEAD`]))) || 0;
  const behind = Number(text(await git(['rev-list', '--count', `HEAD..${remote}/${branch}`]))) || 0; // as of the last fetch
  const url = text(await git(['remote', 'get-url', remote])).replace(/\/\/[^@/]*@/, '//'); // never show a token
  return { ok: true, repo: true, branch, remote: url, unsaved: dirty, toPush: ahead, toPull: behind, device: device(), last };
}

export async function gitSyncRun() {
  if (busy) throw new HttpError(429, 'A sync is already running.');
  if (!fs.existsSync(path.join(VAULT, '.git'))) throw new HttpError(409, 'The vault is not a git repo on this device. See phone/SETUP.md (phone) or clone the vault repo.');
  busy = true;
  const res = { ok: false, pulled: 0, pushed: 0, saved: 0, conflicts: [], error: '' };
  try {
    const { branch, remote } = await branchInfo();
    if (!branch || branch === 'HEAD') throw new HttpError(409, 'The vault is not on a branch.');
    // 1. a note deleted on this device goes to the vault's Bin (1 Human/99 Bin) first, so it is never just gone
    await binDeleted();
    // 2. save local changes as a commit (the vault .gitignore decides what is left out)
    const localTimes = await editTimes(); // when each changed note was last edited here (used if the other device edited it too)
    const dirty = lines(await git(['status', '--porcelain'])).length;
    if (dirty) {
      const a = await git(['add', '-A']);
      if (a.code !== 0) throw new HttpError(409, lockHint(a.err) || 'Could not stage local changes: ' + a.err.slice(0, 200));
      const c = await git(['-c', `user.name=LifeOS (${device()})`, '-c', 'user.email=lifeos@localhost', 'commit', '-q', '-m', `LifeOS sync from ${device()} ${stamp(new Date())}`]);
      if (c.code !== 0 && !/nothing to commit/i.test(c.out + c.err)) throw new HttpError(409, lockHint(c.err) || 'Could not save local changes: ' + c.err.slice(0, 200));
      res.saved = dirty;
    }
    // 3. fetch
    const f = await git(['fetch', remote]);
    if (f.code !== 0) { res.error = /could not resolve|unable to access|timed out|network/i.test(f.err) ? 'Could not reach GitHub (no internet?). Your changes are saved here and will sync next time.' : 'Fetch failed: ' + f.err.slice(0, 240); return res; }
    // 4. merge what the other device pushed
    const hasRemote = (await git(['rev-parse', '--verify', '-q', `${remote}/${branch}`])).code === 0;
    if (hasRemote) {
      res.pulled = Number(text(await git(['rev-list', '--count', `HEAD..${remote}/${branch}`]))) || 0;
      if (res.pulled) {
        const m = await git(['-c', `user.name=LifeOS (${device()})`, '-c', 'user.email=lifeos@localhost', 'merge', '--no-edit', '--no-ff', `${remote}/${branch}`]);
        if (m.code !== 0) await keepBoth(remote, branch, res, localTimes);
      }
    }
    // 4. push
    const ahead = Number(text(await git(['rev-list', '--count', hasRemote ? `${remote}/${branch}..HEAD` : 'HEAD']))) || 0;
    if (ahead) {
      let p = await git(['push', remote, branch]);
      if (p.code !== 0 && /rejected|non-fast-forward|fetch first/i.test(p.err)) { // the other device pushed meanwhile: one more round
        await git(['fetch', remote]);
        const m2 = await git(['-c', `user.name=LifeOS (${device()})`, '-c', 'user.email=lifeos@localhost', 'merge', '--no-edit', '--no-ff', `${remote}/${branch}`]);
        if (m2.code !== 0) await keepBoth(remote, branch, res, localTimes);
        p = await git(['push', remote, branch]);
      }
      if (p.code !== 0) { res.error = /authentication|denied|403|401|could not read/i.test(p.err) ? 'GitHub did not accept the login. Check the token (see phone/SETUP.md).' : 'Push failed: ' + p.err.slice(0, 240); return res; }
      res.pushed = ahead;
    }
    res.ok = true;
    return res;
  } catch (e) {
    if (e instanceof HttpError) throw e;
    res.error = String((e && e.message) || e).slice(0, 240); return res;
  } finally {
    busy = false;
    last = { at: new Date().toISOString(), ok: res.ok, pulled: res.pulled, pushed: res.pushed, conflicts: res.conflicts.length, error: res.error };
  }
}

// A merge stopped on conflicts. For every conflicted file keep our version in place AND save the other side next to it as a conflict copy,
// then finish the merge. Nothing from either side is lost.
async function keepBoth(remote, branch, res, localTimes) {
  const files = lines(await git(['diff', '--name-only', '--diff-filter=U']));
  const now = new Date();
  for (const f of files) {
    const theirs = await git(['show', `${remote}/${branch}:${f}`], { buffer: true });
    const ours = await git(['cat-file', '-e', `HEAD:${f}`]);
    if (theirs.code === 0 && ours.code === 0) {
      // both sides changed the file: the newer edit keeps the name, the older is saved next to it as a copy
      const tTheirs = Number(text(await git(['log', '-1', '--format=%ct', `${remote}/${branch}`, '--', f]))) || 0;
      const tOurs = localTimes.get(f) || Number(text(await git(['log', '-1', '--format=%ct', 'HEAD', '--', f]))) || 0;
      const theirsNewer = tTheirs > tOurs;
      const i = f.lastIndexOf('.'), s = f.lastIndexOf('/');
      const stem = i > s ? f.slice(0, i) : f, ext = i > s ? f.slice(i) : '';
      let copy = `${stem} (conflict ${device()} ${stamp(now)})${ext}`, n = 1;
      while (fs.existsSync(path.join(VAULT, copy))) copy = `${stem} (conflict ${device()} ${stamp(now)} ${++n})${ext}`;
      fs.mkdirSync(path.dirname(path.join(VAULT, copy)), { recursive: true });
      if (theirsNewer) {
        const mine = await git(['show', `HEAD:${f}`], { buffer: true });
        fs.writeFileSync(path.join(VAULT, copy), mine.out); // ours is older: keep it as the copy
        fs.writeFileSync(path.join(VAULT, f), theirs.out);   // theirs is newer: it takes the name
      } else {
        fs.writeFileSync(path.join(VAULT, copy), theirs.out);
        await git(['checkout', '--ours', '--', f]);
      }
      await git(['add', '--', f, copy]);
      res.conflicts.push(copy);
    } else if (theirs.code === 0) {
      // we deleted it, they changed it: bring their file back
      fs.mkdirSync(path.dirname(path.join(VAULT, f)), { recursive: true });
      fs.writeFileSync(path.join(VAULT, f), theirs.out);
      await git(['add', '--', f]);
      res.conflicts.push(f);
    } else {
      await git(['checkout', '--ours', '--', f]); // they deleted it, we changed it: keep ours
      await git(['add', '--', f]);
    }
  }
  const c = await git(['-c', `user.name=LifeOS (${device()})`, '-c', 'user.email=lifeos@localhost', 'commit', '--no-edit', '-q']);
  if (c.code !== 0) { await git(['merge', '--abort']); throw new HttpError(500, 'Could not finish the merge, so it was undone and nothing changed: ' + c.err.slice(0, 200)); }
}


// ---- helpers for lib/autosync.mjs ----
export const syncBusy = () => busy;
/** A string that changes whenever a note is changed, added or deleted here ('' when nothing is waiting to be saved). */
export async function localSignature() {
  const m = await editTimes();
  return [...m].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([f, t]) => f + ':' + t).join('|');
}
/** Fetches, then says whether GitHub has something this device does not (false when there is no internet). */
export async function remoteAhead() {
  const { branch, remote } = await branchInfo();
  if (!branch || branch === 'HEAD') return false;
  const f = await git(['fetch', '-q', remote], { ms: 60000 });
  if (f.code !== 0) return false;
  return (Number(text(await git(['rev-list', '--count', `HEAD..${remote}/${branch}`]))) || 0) > 0;
}
