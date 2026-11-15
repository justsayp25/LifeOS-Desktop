#!/usr/bin/env bash
# Starts the LifeOS server on the phone (127.0.0.1:4100). Safe to run twice: it does nothing if LifeOS is already running.
APP_DIR="$HOME/LifeOS-Desktop"
LOG="$HOME/lifeos.log"

command -v termux-wake-lock >/dev/null 2>&1 && termux-wake-lock # keep the phone awake enough for the server to stay alive

if curl -fs -m 2 http://127.0.0.1:4100/api/health >/dev/null 2>&1; then
  echo "LifeOS is already running."
  exit 0
fi

cd "$APP_DIR" || { echo "Run setup first: bash $APP_DIR/phone/setup-termux.sh"; exit 1; }
nohup node server.mjs >> "$LOG" 2>&1 &
sleep 2
if curl -fs -m 3 http://127.0.0.1:4100/api/health >/dev/null 2>&1; then
  echo "LifeOS started. Open the LifeOS app."
else
  echo "LifeOS did not start. Last lines of the log:"; tail -n 15 "$LOG"; exit 1
fi
