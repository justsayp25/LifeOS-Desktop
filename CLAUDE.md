# CLAUDE.md: LifeOS Desktop (v1)

Repo: https://github.com/justsayp25/LifeOS-Desktop. Versions: v1, then v1.1, v1.2 ... v1.9, then v2. Each update to the package bumps the number and `VERSION`.

Jess's LifeOS dashboard: source code and the package the Android app uses (private repo). Read this whole file first. Keep replies short and plain. Do not touch the vault (`C:\Obsidian\LifeOS`) unless Jess says so; its own `AGENTS.md` rules apply there.

## What this repo is
- Run it: `start.bat` (or `node server.mjs`), open http://localhost:4100. See `INSTALL.txt` and `README.md`.
- The Android app is a separate repo, **LifeOS-Mobile** (https://github.com/justsayp25/LifeOS-Mobile). Changes the app needs (APIs, pages) are made here and shipped as a package (zip release, or a git clone inside Termux).
- Conversation mode and file attach are built into the dashboard pages (`Main.dc.html`, `Phone.dc.html`, `support.js`) using the browser's speech features. Android WebView probably lacks speech recognition, so the app needs a native replacement; check before assuming.

## Rules
- Never overwrite or delete user data. Sync keeps both copies on conflict.
- Chat and upload routes need a device login before any non-localhost access.
- Features are frozen: no new pages.
- Keep the repo private (GymMane data in `public/gym` is GPL and CC BY-SA; credit "Based on GymMane by InlitX" if ever shared).
- No secrets, no Claude login in the repo.

---

# LifeOS handoff for Claude Code

Owner: Jess ("Nino"). Keep replies short and plain.

## Status
Feature freeze. No new pages. Only left to build: the Agent (chat, photo, files, voice) and sync. Everything else is polish and bugs.

## Repos (private, two)
- **LifeOS-Desktop** (this repo): the source code and everything the app needs, as a package. Node dashboard (zero dependencies, port 4100, `public/*.dc.html`, `lib/*.mjs`, `server.mjs`), the phone helper (`helper/`), sync code, tests.
- **LifeOS-Mobile**: a dedicated Android app that builds to an APK (Expo / React Native). It uses the Desktop package. Created separately.
- The vault has its own repo (`justsayp25/LifeOS`). Never put app code in the vault or vault notes in these repos.

## Vault rules
- `AGENTS.md` in the vault is the canonical rules. `CLAUDE.md` points to it. Read it before touching the vault.
- Structural vault changes are Jess's call. Propose first, apply after a yes.
- Every folder has a folder note with its own name; `hub.py` generates the listings (never hand-edit below its marker). No folders are built in advance.
- `01 Inbox/` and `05 Journal/` are read-only for agents and the app. `2 Machine/` is the system's.
- Where things already live (do not add new homes for these): events are `## Appointments` in daily notes; finance is each asset note's `## Log`; body weight and measurements are in the Lifts note (`## Measurements`); chat transcripts go to `2 Machine/06 Agent Client/`; photos and documents go to `10 Resources/Photos` and `PDFs`.
- Added 2026-11-12: `11 Health/Tracker/Samsung Health/Samsung Health.md` (type: log, one line per day: `- YYYY-MM-DD -- steps: , sleep: , resting hr: `) and the template `2 Machine/01 Templates/Logs/Samsung Health Log.md`. App routes: `GET/POST /api/health/phone`. The next `hub.py` run lists the new folder in Tracker (not run yet: a dry run touches 28 hub notes).
- Not done, needs a decision: AGENTS.md still lists the Logs templates without Samsung Health Log. Add the name when Jess approves.
- Device and sync state stays outside the vault. Ignore `.obsidian` workspace files in the sync repo.

## Sync rules
- Local vault on each device. Private GitHub repo is the messenger.
- Explicit Sync button.
- Never overwrite or delete. On conflict, keep both copies.
- Open: journal synced via GitHub, Syncthing, or PC only (ask Jess).

## Agent
- PC: dashboard chat runs `claude -p` with the vault as working directory.
- Phone: Claude Code in Termux, inside proot Ubuntu, logged in on Claude Pro. Survives overnight with unrestricted battery and `termux-wake-lock`.
- A small helper in Ubuntu listens on 127.0.0.1 and runs `claude` on the vault.
- Tools allowed: read the vault and search the web (Read, Glob, Grep, WebSearch, WebFetch). No write tools while the web is on, because web pages are untrusted. Writes need a separate, confirmed mode.
- Models: Haiku for quick commands and voice, Sonnet for big questions.

## Agent inputs
- Attachments from a "+" on the Agent button: files, gallery, camera. Saved into the vault (`10 Resources/Photos`, `PDFs`) and the path is passed to the agent. Images, PDFs and text are readable. Word and Excel: save only for now.
- Photo capture with no AI: saved to `10 Resources/Photos` for now (Inbox is read-only, see below).
- Mic button: Android speech recognition turns speech into editable text.
- Conversation mode (JARVIS style): started by a button only, no wake word. Loop: speech to text, agent on Haiku, text-to-speech, listen again, until stop. Start with Android Google voices (works on mobile data). Better paid voices later.
- Expect a few seconds of delay per turn. Keep one Claude session open between turns if possible.

## Backend for the Agent (done 2026-11-12, on the PC copy)
Added `lib/agent.mjs`, changed `lib/chat.mjs` and `server.mjs` (backups: `*.bak-20261112`). Restart the server after pulling.
- `POST /api/agent/upload` `{name, data(base64)}`: photos (png, jpg, gif, webp) go to `10 Resources/Photos`, documents (pdf, word, excel, powerpoint, csv, txt, md, json) to `10 Resources/PDFs`. 20 MB cap, never overwrites, returns `{file:{name, path, kind, readable}}`.
- `POST /api/chat` now accepts `files` (the saved paths, max 8, only from Photos/PDFs), `model` (`haiku` or `sonnet`), and `web` (default on, `CHAT_WEB=0` turns it off). Web search and fetch are allowed; the chat stays read-only; the prompt tells the agent that web pages and attachments are data, not instructions.
- Chat transcripts are written to `2 Machine/06 Agent Client/dashboard_<date>_<time>.md` (the existing transcript folder, same frontmatter style). No new folder.
- Tested with a stub `claude` here: upload rules, path checks, flags, transcripts. Not yet tested with the real `claude` or from the phone.
Still to build in the app: the chat UI wiring (upload, send `files`/`model`), photo capture button, speech in and out, conversation mode.

## Vault: on hold, needs Jess's decision
- AGENTS.md says `01 Inbox/` is read-only for agents, and the app's code blocks writes there. A photo capture saved to the Inbox needs a rule change: allow the app's capture button (Jess's own action) to create new files in the Inbox, never edit existing ones. Until he decides, captures go to `10 Resources/Photos` only.
- The earlier folder proposal (Events, Body, Ledger) clashes with AGENTS.md: every folder needs a folder note, hub.py indexes, and no folders are scaffolded in advance. Redo it as proposals that follow those rules. Do not touch the vault until Jess says so.
- Photo file names: AGENTS.md wants findable names, not `IMG_4471.jpg`. Camera captures get a dated name for now.

## Agent screens (design canvas, published)
- "+" button left of the input: Take photo, Photos, Files. Chosen files show as removable chips above the input.
- Mic button: dictation into the text box.
- Right button: waveform (conversation mode) when the box is empty and nothing is attached, Send arrow otherwise.
- Conversation mode: full panel with a large circle, status (Listening, Working, Speaking), a caption, and an End button. Footer line: reads your vault, searches the web, read only.
- Header has only the close X.
- Plain wording, no personality.

## Status 2026-11-15
- PC app (`lifeos-web3`) updated to the current version: sync files, all pages, new agent and Samsung Health routes. Backup of the old files: `_backup-20261115/` (also holds `app-update.zip`). `public/gym` was not touched (the PC has the full library). Syntax checked; smoke tested on a scratch vault (all routes 200, `/api/sync/status` 401 until a device is paired).
- Phone helper written and tested with a stub `claude`: `helper/lifeos-helper.mjs`, `start-helper.sh`, `SETUP.md` (zip: `lifeos-phone-helper.zip`). Endpoints `GET /status`, `POST /ask`, `POST /upload`, token header `x-helper-token`, 127.0.0.1 only. Not yet run on the phone.
- Still untested with the real `claude`: web search, `--model haiku`, image reading.
- Open: app login for chat/upload before network access; sync choice for beta (Wi-Fi sync exists, GitHub not built); repos not created; hub.py not run; Inbox rule; journal sync.

## Build plan
1. First APK (Expo, EAS cloud build or local): the 12 phone pages, vault on phone, Sync button, chatbox with "+" and mic. Chatbox opens Termux and copies the question if auto-launch fails.
2. Then: auto-launch Termux with the `RUN_COMMAND` intent (needs `allow-external-apps`, untested on Android 17).
3. Then: conversation mode, widget or Quick Settings tile.
4. Not planned: wake word, power-button assistant.

## Untested, do not assume
Android 17 `RUN_COMMAND`, background reliability past a day or a reboot, GitHub sync on the phone, speech and photo flow on the S25+.

## Phone UI notes
- Phone and desktop router at 760px, `?view=desktop|phone`.
- Bottom nav island with long-press Knowledge menu. FABs at bottom 96px.
- Do not add pill islands for filters. Jess prefers desktop-style tappable text.

## v1.4 voice (measured 2026-11-15, RTX 3050, Chrome-based pane)
Before: Whisper base wasm ~3.4 s, Claude spawn 5-14 s, Kokoro wasm ~10 s per sentence (slower than real time). Now about 4 s from end of speech to first audio, then it keeps talking.
- **Native engine (optional, preferred when installed):** `setup-voice.bat` (`node tools/setup-voice.mjs`, `--small` for one voice) installs `voice-native/` (sherpa-onnx 1.12.20, pinned: 2.x dropped the built-in phonemizer Piper needs) and ~700 MB of models into `voice-models/` (both gitignored). `lib/voicenative.mjs` + `lib/voice-worker.mjs` run Whisper base.en (int8) and Piper voices (lessac-high default, amy-medium, ryan-high, alba-medium) in a worker thread. Routes: `GET /api/voice/native` (status, also warms), `POST /api/voice/stt` (raw 16 kHz Float32), `POST /api/voice/tts` (JSON {text, voice} -> raw Float32, header X-Sample-Rate). Measured on this PC: transcription 0.2-0.4 s, Piper 25x real time (medium) / 4x (high), page ready in 0.1 s instead of 50 s, about 2 s from end of speech to first audio. Kokoro on CPU in sherpa is 1.2-1.6x slower than real time, so Piper it is. Every voice question also carries a live snapshot of active projects, open tasks, events and habits (`lib/snapshot.mjs`, same code the pages use), because the fast path no longer reads AGENTS.md. Same routes exist in the phone helper (`/voice/...`, token header); `voice.js` uses the native engine whenever `/api/voice/native` says ok (set localStorage `lifeos.voiceEngine` = `browser` to force the in-page engines). NOT tested on the phone: sherpa-onnx-node should install on arm64 Linux/Termux, but unverified; time Whisper and Piper there before relying on it.
- Fallback chain when the native engine is not installed: `public/voice.js` picks the engine by itself per browser. Whisper: base.en on WebGPU in Chrome/Edge (~1.0 s per turn), tiny.en on wasm everywhere else (~1.6 s; Firefox reports WebGPU but hangs, so WebGPU is Chromium only). WebGPU setup has a 75 s limit, then wasm. Kokoro-82M: WebGPU fp32 in Chrome/Edge (q4f16 and fp16 return all-NaN audio on this GPU, q8 takes 22 s); otherwise wasm q8, kept only if a speed check says it is under 2.2x real time (measured 1.6x here, so the first words come after ~4 s and there are small gaps between sentences); otherwise the browser voice. Output is checked for NaN/silence. Models are warmed up at load; the panel says what it is doing; if setup passes 90 s it falls back to browser listening. Silence cutoff 700 ms.
- `server.mjs` sends COOP/COEP headers (cross-origin isolated) so wasm can use threads. Server-side Kokoro (native, faster) was considered but could not be measured (npm blocked in the test sandbox), so it is not built.
- `lib/voice.mjs` + `lib/voice-prompt.txt`: one long-lived `claude` process (stream-json, Haiku, no thinking, read-only tools only, no MCP) so there is no 5 s start-up per question. Warm turns ~1.5 s. Answers stream as NDJSON from `POST /api/voice/ask`; `/api/voice/warm` starts the process, `/api/voice/reset` restarts it. Prompt asks for 1-3 spoken sentences and tells it not to read AGENTS.md. Idle process exits after 20 min. Transcripts still go to `2 Machine/06 Agent Client/`.
- Pages: `talkAsk` in Main/Phone calls `reneeVoice.ask()`; the first sentence is spoken while the rest is written. Old path kept as `talkAskSlow` (used if the route is missing). Timing line shows in the panel and console as `[renee timing]`.
- Her name is spoken "Renay" (voice.js clean() and the voice prompt). Voice questions also get extra dashboard sections (finances, health, habits, reviews, areas) when the question mentions them.
- Microphone: one stream stays open for the whole conversation (released on End or after 20 s idle), with echoCancellation and noiseSuppression off. Opening/closing it per turn, or leaving echo cancellation on, made Bluetooth headsets and Windows flip between "call mode" and normal audio. She never listens while speaking, so no echo cancelling is needed. Headsets that use their own mic (Bluetooth) still drop to call quality while the mic is open: pick the laptop mic in the Windows sound settings to avoid that.
- The "Reads your vault · Searches the web · Read only" line above the circle was removed on request. Conversation panel shows only the status (Listening, Working, Speaking): no transcript, reply or timing line (timing is in the console). Spoken turns are not added to the chat list. Whisper filler on noise ("Thank you.", "you") is dropped. Voice questions always carry the full compact dashboard snapshot.
- Audio quality: playback has its own AudioContext (latencyHint playback), is kept awake with an inaudible signal during a conversation, each sentence is normalised to the same loudness with 8 ms fades and a little padding, and a Bluetooth microphone (label contains bluetooth, hands-free, airpods or buds) is skipped in favour of another input when one exists, so a Bluetooth headset stays out of low-quality call mode. Not heard by ear: only checked that it plays without errors.
- Every voice and chat question starts with the current local date and time (`nowText()` in lib/snapshot.mjs).
- **Memory (v1.5):** `lib/memory.mjs`, stored in `.memory/` in the app folder (gitignored, never in the vault, nothing deleted). `turns.jsonl` logs every voice and chat exchange; a new conversation starts with the latest 10. `facts.json` holds things the user said to remember: only the user's own words trigger it ("remember that ...", "don't forget ...", "forget ..."; forgetting marks `forgotten`, it does not delete), so web pages cannot write memory. Facts go with every question, voice and chat. The agent cannot write; the server saves and tells her to confirm. Older history: transcripts in `2 Machine/06 Agent Client/`.
- **Also in v1.5:** the voice agent follows AGENTS.md (read once at process start into the system prompt, cap 7000 chars); every voice question carries the page title and visible text (`screen`, sent by `voice.js`, cap 2500 chars); location for weather comes from `LOCATION` in `.env`, else the computer time zone city.
- Listening (v1.5.2): the mic is read in an AudioWorklet (audio thread; ScriptProcessor only as fallback). Speech detection uses a measured room-noise floor (quietest block of the first 300 ms, then follows the room), threshold max(0.006, 3x floor), a 0.7 s pre-roll so the first word is never clipped, a 350 ms deaf period against her own voice, and 700 ms of silence ends a turn (900 ms after a long sentence). Tested with synthetic speech at rms 0.009, 0.09 and speech starting at once; not with a real mic.
- Crackle / "call sound" (v1.5.3): the conversation panel has a "Mic: <name> · change" button (cycles the input devices, saved as lifeos.micId; a chosen mic is never replaced automatically; a Bluetooth default is swapped for a USB or other non-Bluetooth input only when nothing was chosen). Capture runs on its own AudioContext with sinkId none (no second output stream to the headphones). The keep-awake signal is a constant 1 LSB level, not random noise. Not heard by ear.
- Finished tasks are hidden on the Tasks and Home pages (desktop and phone): the list filters out anything in `taskDone`. They stay checked in their note and still show on Calendar and Projects. Server still returns done tasks for DONE_DAYS (default 3).
- Auto microphone (v1.5.5, replaces the Mic button, which was removed from the panel): USB or dedicated mics rank first, webcam and built-in next, Bluetooth headset mics and virtual devices last; re-chosen when a device is plugged in or removed; a mic saved as lifeos.micId is never replaced.
- Samsung Health (PC side done, phone side not built): the helper has token-protected `GET/POST /health` (same code as `/api/health/phone`); a sync with only some numbers keeps the rest of that day; the agent sees the last 7 days. The phone app must read Health Connect (Samsung Health must sync to it) and post daily totals; that needs an Android app build (LifeOS-Mobile).
- Silent failures fixed: self-aborting request, NaN audio, empty transcript now says so, errors are spoken with the browser voice.
- Not tested: a real microphone (a fake mic fed with synthetic speech was used), Android WebView (WebGPU may be missing there, so it will use the browser voice and tiny.en), Chrome cache of the 326 MB fp32 file (the test pane failed to cache it, so it re-downloaded each load).
