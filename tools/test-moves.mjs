import { execFileSync } from 'node:child_process'; import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mv-')); const g = (cwd, ...a) => execFileSync('git', a, { cwd, encoding: 'utf8', env: { ...process.env, GIT_AUTHOR_NAME: 'x', GIT_AUTHOR_EMAIL: 'x@x', GIT_COMMITTER_NAME: 'x', GIT_COMMITTER_EMAIL: 'x@x' } });
const bare = path.join(root, 'o.git'); fs.mkdirSync(bare); g(bare, 'init', '-q', '--bare', '-b', 'master');
const seed = path.join(root, 's'); fs.mkdirSync(seed); g(seed, 'init', '-q', '-b', 'master');
for (const [f, t] of [['1 Human/Inbox/Idea.md', 'an idea\n'], ['1 Human/Inbox/Plan.md', 'the plan\n'], ['1 Human/Inbox/Old.md', 'old stuff\n']]) { fs.mkdirSync(path.dirname(path.join(seed, f)), { recursive: true }); fs.writeFileSync(path.join(seed, f), t); }
g(seed, 'add', '-A'); g(seed, 'commit', '-qm', 's'); g(seed, 'push', '-q', bare, 'master');
const vault = path.join(root, 'v'); g(root, 'clone', '-q', bare, vault); process.env.VAULT_PATH = vault; process.env.DEVICE_NAME = 'pc';
const { gitSyncRun } = await import(new URL('../lib/gitsync.mjs', import.meta.url).href);
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
const bin = () => { try { return fs.readdirSync(path.join(vault, '1 Human/99 Bin')); } catch { return []; } };
// 1. organise: move a note to another folder
fs.mkdirSync(path.join(vault, '1 Human/Projects'), { recursive: true }); fs.renameSync(path.join(vault, '1 Human/Inbox/Idea.md'), path.join(vault, '1 Human/Projects/Idea.md'));
let r = await gitSyncRun(); ok(r.ok && bin().length === 0, 'moving a note to another folder puts nothing in the Bin: ' + JSON.stringify(bin()));
// 2. move AND rename
fs.renameSync(path.join(vault, '1 Human/Inbox/Plan.md'), path.join(vault, '1 Human/Projects/Big Plan.md')); r = await gitSyncRun();
ok(r.ok && bin().length === 0, 'moving and renaming (same text) puts nothing in the Bin: ' + JSON.stringify(bin()));
// 3. rename and edit at once is the one case that cannot be told from "delete + new note": the old text is kept in the Bin (safe side)
fs.renameSync(path.join(vault, '1 Human/Projects/Idea.md'), path.join(vault, '1 Human/Projects/Idea v2.md')); fs.writeFileSync(path.join(vault, '1 Human/Projects/Idea v2.md'), 'an idea, rewritten\n'); r = await gitSyncRun();
ok(r.ok && bin().length <= 1, 'rename + rewrite at once: at most one safety copy in the Bin: ' + JSON.stringify(bin()));
const before = bin().length;
// 4. a real delete still goes to the Bin
fs.rmSync(path.join(vault, '1 Human/Inbox/Old.md')); r = await gitSyncRun();
ok(r.ok && bin().length === before + 1 && fs.readFileSync(path.join(vault, '1 Human/99 Bin/Old.md'), 'utf8') === 'old stuff\n', 'a real delete still goes to the Bin with its text: ' + JSON.stringify(bin()));
// 5. the other device receives the moves
g(seed, 'pull', '-q', bare, 'master'); ok(fs.existsSync(path.join(seed, '1 Human/Projects/Big Plan.md')) && !fs.existsSync(path.join(seed, '1 Human/Inbox/Plan.md')), 'the other side sees the moved notes');
fs.rmSync(root, { recursive: true, force: true }); console.log(fails ? fails + ' FAILED' : 'ALL PASSED');
