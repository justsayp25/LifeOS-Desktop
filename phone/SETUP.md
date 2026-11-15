# LifeOS on the phone (standalone)

The phone runs its own copy of LifeOS (a small Node server, in Termux) with its own copy of your vault. The vault syncs between the PC and the phone through the private GitHub repo `justsayp25/LifeOS`. The Android app is a window onto the phone's server (`http://127.0.0.1:4100`). Claude Code on the phone is the agent.

## One-time setup (in the same place where you run `claude`: Termux, or inside proot Ubuntu)
1. Make a GitHub token: GitHub > Settings > Developer settings > Fine-grained tokens. Only the repos `LifeOS-Desktop` and `LifeOS`, permission "Contents: Read and write".
2. Get the app (private repo): `pkg install git` (in proot: `apt install git`), then  
   `git clone https://github.com/justsayp25/LifeOS-Desktop.git ~/LifeOS-Desktop`  
   Username `justsayp25`, password = the token.
3. `bash ~/LifeOS-Desktop/phone/setup-termux.sh` (installs Node, stores the token only on the phone, clones the vault to `~/LifeOS`, writes `.env`).
4. Start it: `bash ~/LifeOS-Desktop/phone/start-lifeos.sh`. Open the LifeOS app, or `http://127.0.0.1:4100/Phone.dc.html` in the phone browser.
5. Optional fast voice (about 700 MB): `node ~/LifeOS-Desktop/tools/setup-voice.mjs`.
6. Termux battery: Android settings > Apps > Termux > Battery > Unrestricted.

## Sync
`POST /api/gitsync/run` (the Sync button in the app) saves local changes as a commit, fetches, merges, pushes. Nothing is overwritten or deleted: if both devices changed the same note, your version stays and the other is saved next to it as `Name (conflict <device> <date time>).md`. `GET /api/gitsync/status` shows what is waiting. The vault's own `.gitignore` decides what is skipped (Obsidian workspace files). The same button works on the PC (the PC vault is already a git checkout of that repo).

## Samsung Health
Samsung Health > Settings > Health Connect: turn sync on. The app reads Health Connect and posts daily totals to `POST /api/health/phone`.

## Not tested on a real phone
Everything here. In particular: Node in Termux, Claude Code inside proot (if `claude` lives in proot Ubuntu, run setup and the server there), the Termux start intent, the token login, the native voice engine on ARM.
