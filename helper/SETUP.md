# Phone helper setup (Termux > Ubuntu)

1. Put the app folder on the phone (for example `~/lifeos`) and the vault at `~/vault/LifeOS` (or set `VAULT_PATH`).
2. In Ubuntu: `cd ~/lifeos && bash helper/start-helper.sh`
   First run makes a token in `helper/.token`. The app needs that token.
3. Test: `curl -H "x-helper-token: $(cat helper/.token)" localhost:4200/status`
4. Keep it alive: run `termux-wake-lock` in Termux and set Termux battery to Unrestricted.

Rules: listens on 127.0.0.1 only. Chat is read-only, web search on. Never share `helper/.token`.
