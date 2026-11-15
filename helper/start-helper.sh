#!/bin/bash
# Run inside Termux's Ubuntu. Usage: bash helper/start-helper.sh
cd "$(dirname "$0")/.."
[ -f helper/.token ] || { head -c 24 /dev/urandom | base64 | tr -d '/+=' > helper/.token; echo "Made a new token in helper/.token"; }
export HELPER_TOKEN="$(cat helper/.token)"
export VAULT_PATH="${VAULT_PATH:-$HOME/vault/LifeOS}"
echo "Vault: $VAULT_PATH"
exec node helper/lifeos-helper.mjs
