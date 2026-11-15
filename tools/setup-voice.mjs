// Installs the optional native voice engine: sherpa-onnx (about 25 MB) plus the speech models (about 500 MB).
// Run once:  node tools/setup-voice.mjs      (or double-click setup-voice.bat)
// Same script on Windows and on the phone (Termux). Safe to run again: it skips what is already there.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MODELS = path.join(ROOT, 'voice-models');
const REL = 'https://github.com/k2-fsa/sherpa-onnx/releases/download/';
const ITEMS = [
  { name: 'sherpa-onnx-whisper-base.en', url: REL + 'asr-models/sherpa-onnx-whisper-base.en.tar.bz2', keep: /(int8.onnx|tokens.txt)$/, check: 'base.en-encoder.int8.onnx', label: 'Speech recognition (Whisper base.en)' },
  { name: 'vits-piper-en_US-lessac-high', url: REL + 'tts-models/vits-piper-en_US-lessac-high.tar.bz2', check: 'tokens.txt', label: 'Voice: Lessac (female, high quality)' },
  { name: 'vits-piper-en_US-amy-medium', url: REL + 'tts-models/vits-piper-en_US-amy-medium.tar.bz2', check: 'tokens.txt', label: 'Voice: Amy (female)' },
  { name: 'vits-piper-en_US-ryan-high', url: REL + 'tts-models/vits-piper-en_US-ryan-high.tar.bz2', check: 'tokens.txt', label: 'Voice: Ryan (male, high quality)' },
  { name: 'vits-piper-en_GB-alba-medium', url: REL + 'tts-models/vits-piper-en_GB-alba-medium.tar.bz2', check: 'tokens.txt', label: 'Voice: Alba (British female)' },
];
const quick = process.argv.includes('--small'); // speech recognition + one voice only
const list = quick ? ITEMS.slice(0, 2) : ITEMS;

console.log('LifeOS native voice setup\n');
console.log('1/2  Installing the engine (sherpa-onnx)...');
const npm = spawnSync('npm', ['install', '--no-audit', '--no-fund', '--loglevel=error'], { cwd: path.join(ROOT, 'voice-native'), stdio: 'inherit', shell: true });
if (npm.status !== 0) { console.error('\nnpm install failed. Is Node.js installed and are you online?'); process.exit(1); }

console.log('\n2/2  Downloading speech models (once)...');
fs.mkdirSync(MODELS, { recursive: true });
for (const it of list) {
  const dir = path.join(MODELS, it.name);
  if (fs.existsSync(path.join(dir, it.check))) { console.log('  have  ' + it.label); continue; }
  const tmp = path.join(MODELS, it.name + '.tar.bz2');
  process.stdout.write('  get   ' + it.label + ' ...');
  const r = await fetch(it.url, { redirect: 'follow' });
  if (!r.ok || !r.body) { console.error('\n  download failed (' + r.status + '): ' + it.url); process.exit(1); }
  await pipeline(Readable.fromWeb(r.body), fs.createWriteStream(tmp));
  const t = spawnSync('tar', ['-xjf', path.basename(tmp)], { cwd: MODELS, stdio: ['ignore', 'inherit', 'inherit'] }) // relative path: GNU tar reads "C:\..." as a remote host;
  if (t.status !== 0 || !fs.existsSync(path.join(dir, it.check))) { console.error('\n  could not unpack ' + tmp + ' (needs a tar that reads .bz2)'); process.exit(1); }
  fs.rmSync(tmp, { force: true }); // only the archive we downloaded ourselves
  if (it.keep) for (const f of fs.readdirSync(dir)) if (!it.keep.test(f)) fs.rmSync(path.join(dir, f), { recursive: true, force: true }); // drop the big unused model files we just unpacked
  console.log(' done');
}
console.log('\nDone. Restart LifeOS. The voice panel will now use the native engine.');
