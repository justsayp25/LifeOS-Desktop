#!/usr/bin/env bash
# LifeOS on the phone: one-time setup. Run this in the SAME place where you run `claude` (Termux, or inside proot Ubuntu).
# It installs Node and git, downloads the app and your vault from your private GitHub repos, and writes the settings.
# Your GitHub token is stored only on this phone (in ~/.git-credentials), never in the repo.
set -e

APP_DIR="$HOME/LifeOS-Desktop"
VAULT_DIR="$HOME/LifeOS"
APP_REPO="https://github.com/justsayp25/LifeOS-Desktop.git"
VAULT_REPO="https://github.com/justsayp25/LifeOS.git"

echo "== LifeOS phone setup =="

# 1. tools
if command -v pkg >/dev/null 2>&1; then
  pkg update -y && pkg install -y nodejs git curl
elif command -v apt-get >/dev/null 2>&1; then
  apt-get update -y && apt-get install -y git curl ca-certificates
  command -v node >/dev/null 2>&1 || { echo "Node.js is missing. Install Node 20 or newer, then run this again."; exit 1; }
fi
node -v >/dev/null 2>&1 || { echo "Node.js is not installed."; exit 1; }

# 2. GitHub login (one token for both private repos: fine-grained, Contents read and write)
if ! git config --global credential.helper >/dev/null 2>&1; then git config --global credential.helper store; fi
if ! grep -q "github.com" "$HOME/.git-credentials" 2>/dev/null; then
  echo
  echo "Make a GitHub token: github.com > Settings > Developer settings > Fine-grained tokens."
  echo "Give it only the repos LifeOS-Desktop and LifeOS, permission 'Contents: Read and write'."
  printf "Paste the token (it will not show): "
  read -rs TOKEN; echo
  [ -n "$TOKEN" ] || { echo "No token entered."; exit 1; }
  umask 077
  printf "https://justsayp25:%s@github.com\n" "$TOKEN" >> "$HOME/.git-credentials"
  chmod 600 "$HOME/.git-credentials"
  unset TOKEN
fi

# 3. the app and the vault
[ -d "$APP_DIR/.git" ] && git -C "$APP_DIR" pull --ff-only || git clone "$APP_REPO" "$APP_DIR"
[ -d "$VAULT_DIR/.git" ] || git clone "$VAULT_REPO" "$VAULT_DIR"

# 4. settings for the app (stay on this phone)
if [ ! -f "$APP_DIR/.env" ]; then
  cat > "$APP_DIR/.env" <<EOF
VAULT_PATH=$VAULT_DIR
PORT=4100
HOST=127.0.0.1
DEVICE_NAME=phone
EOF
fi

# 5. let the LifeOS app start the server from Termux (only matters in Termux)
if [ -d "$HOME/.termux" ] || command -v termux-reload-settings >/dev/null 2>&1; then
  mkdir -p "$HOME/.termux"
  grep -q "^allow-external-apps" "$HOME/.termux/termux.properties" 2>/dev/null || echo "allow-external-apps=true" >> "$HOME/.termux/termux.properties"
  command -v termux-reload-settings >/dev/null 2>&1 && termux-reload-settings || true
fi

echo
echo "Done. Start LifeOS with:  bash $APP_DIR/phone/start-lifeos.sh"
echo "Then open the LifeOS app. Optional fast voice (about 700 MB):  node $APP_DIR/tools/setup-voice.mjs"
echo "Tip: in Android settings set Termux battery to Unrestricted so it keeps running."
