# GitHub Copilot CLI Quickstart (BYOK)

Ready-to-paste commands for testing the Copilot CLI integration once the app
is already running. For first-time setup, troubleshooting, and how the
integration works, see [github-copilot-usage.md](github-copilot-usage.md) and
[../AGENTS.md](../AGENTS.md).

## Restart from source (after a reboot / machine restart)

Windows may auto-start the **installed** app on login, which does not have
your latest source changes. Stop it and relaunch from the repo instead.

**PowerShell** — paste this whole block as one go:

```powershell
Set-Location C:\Users\phihuynh\projects\codex-chatgpt-web
Get-Process "Codex Web GPT" -ErrorAction SilentlyContinue | Stop-Process -Force
Get-Process "tunnel-client" -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Sleep -Seconds 2
Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
Remove-Item Env:ELECTRON_NO_ATTACH_CONSOLE -ErrorAction SilentlyContinue
bun run scripts/build-browser-helper.ts
Start-Process -FilePath bun -ArgumentList "--cwd","launcher","node_modules/vite/bin/vite.js" -NoNewWindow `
  -RedirectStandardOutput "$env:TEMP\vite-prod.log" -RedirectStandardError "$env:TEMP\vite-prod-err.log"
Start-Sleep -Seconds 3
$env:VITE_DEV_SERVER_URL = "http://127.0.0.1:4178"
$env:CODEX_WEB_GPT_BUN = "C:\Users\phihuynh\AppData\Local\Microsoft\WinGet\Links\bun.exe"
$env:CODEX_CHATGPT_WEB_BUN = $env:CODEX_WEB_GPT_BUN
$electronBin = "C:\Users\phihuynh\projects\codex-chatgpt-web\launcher\node_modules\electron\dist\electron.exe"
Start-Process -FilePath $electronBin -ArgumentList "C:\Users\phihuynh\projects\codex-chatgpt-web\launcher" `
  -RedirectStandardOutput "$env:TEMP\electron-prod.log" -RedirectStandardError "$env:TEMP\electron-prod-err.log"
Start-Sleep -Seconds 15
bun run src/cli.ts doctor
```

**Bash / Git Bash** — paste this whole block as one go:

```bash
cd /c/Users/phihuynh/projects/codex-chatgpt-web && \
tasklist | grep -iE "codex web gpt|tunnel-client" | awk '{print $2}' | while read -r p; do taskkill //PID "$p" //F; done; \
sleep 2 && \
env -u ELECTRON_RUN_AS_NODE -u ELECTRON_NO_ATTACH_CONSOLE bun run scripts/build-browser-helper.ts && \
(bun --cwd launcher node_modules/vite/bin/vite.js > /tmp/vite-prod.log 2>&1 &) && \
sleep 3 && \
ELECTRON_BIN="/c/Users/phihuynh/projects/codex-chatgpt-web/launcher/node_modules/electron/dist/electron.exe" && \
BUN_BIN="/c/Users/phihuynh/AppData/Local/Microsoft/WinGet/Links/bun.exe" && \
(env -u ELECTRON_RUN_AS_NODE -u ELECTRON_NO_ATTACH_CONSOLE VITE_DEV_SERVER_URL="http://127.0.0.1:4178" CODEX_WEB_GPT_BUN="$BUN_BIN" CODEX_CHATGPT_WEB_BUN="$BUN_BIN" "$ELECTRON_BIN" "/c/Users/phihuynh/projects/codex-chatgpt-web/launcher" > /tmp/electron-prod.log 2>&1 &) && \
sleep 15 && \
bun run src/cli.ts doctor
```

Either way, must print `Doctor result: ready`. If the browser line still says
"running a Codex turn" or "unavailable", wait a bit and re-run just the last
line (`bun run src/cli.ts doctor`) again.

Confirm it's really running from source (not the installed build) via
`~/.codex-chatgpt-web/runtime/launcher-browser.json`: `helper.executable`
must point into this repo's `launcher/node_modules/electron`, not
`AppData\Local\Programs\Codex Web GPT`.

Full explanation and the "restart just the daemon after a code edit"
variant: [../AGENTS.md](../AGENTS.md).

## 0. Prerequisites (one-time)

1. App running and healthy:
   ```powershell
   bun run src/cli.ts doctor
   ```
   Must print `Doctor result: ready`.
2. Copilot CLI integration enabled:
   ```powershell
   bun run src/cli.ts integrations setup copilot-cli
   ```
3. Full harness MCP connector attached in the app: **MCP** tab → **Setup MCP**
   → create/attach a ChatGPT connector named exactly `Codex Native2`
   (Connection: Tunnel, Authentication: None, Permissions: Allow all
   actions), then **Verify runtime**.

Skip step 3 and the model replies with a `Local tools unavailable` notice
instead of executing tools.

## 1. Set the environment variables

Paste this whole block into the terminal window you'll run `copilot` from.
These variables only apply to that terminal/session.

**PowerShell:**

```powershell
$env:COPILOT_PROVIDER_BASE_URL = "http://127.0.0.1:17841/copilot/v1"
$env:COPILOT_PROVIDER_TYPE = "openai"
$env:COPILOT_PROVIDER_WIRE_API = "responses"
$env:COPILOT_PROVIDER_TRANSPORT = "http"
$env:COPILOT_PROVIDER_MODEL_ID = "gpt-5.4"
$env:COPILOT_PROVIDER_WIRE_MODEL = "chatgpt-web/gpt-5.6-sol"
```

**Bash / Git Bash:**

```bash
export COPILOT_PROVIDER_BASE_URL="http://127.0.0.1:17841/copilot/v1"
export COPILOT_PROVIDER_TYPE="openai"
export COPILOT_PROVIDER_WIRE_API="responses"
export COPILOT_PROVIDER_TRANSPORT="http"
export COPILOT_PROVIDER_MODEL_ID="gpt-5.4"
export COPILOT_PROVIDER_WIRE_MODEL="chatgpt-web/gpt-5.6-sol"
```

Verify they're set:

```powershell
Get-ChildItem Env:COPILOT_PROVIDER_*
```

**Slow responses?** `chatgpt-web/gpt-5.6-sol` runs Medium/High reasoning.
Use the instant variant instead (low-effort, no reasoning slider wait) for
much faster turnaround at the cost of reasoning depth:

**PowerShell:**

```powershell
$env:COPILOT_PROVIDER_BASE_URL = "http://127.0.0.1:17841/copilot/v1"
$env:COPILOT_PROVIDER_TYPE = "openai"
$env:COPILOT_PROVIDER_WIRE_API = "responses"
$env:COPILOT_PROVIDER_TRANSPORT = "http"
$env:COPILOT_PROVIDER_MODEL_ID = "gpt-5.4"
$env:COPILOT_PROVIDER_WIRE_MODEL = "chatgpt-web/gpt-5.6-sol-instant"
```

**Bash / Git Bash:**

```bash
export COPILOT_PROVIDER_BASE_URL="http://127.0.0.1:17841/copilot/v1"
export COPILOT_PROVIDER_TYPE="openai"
export COPILOT_PROVIDER_WIRE_API="responses"
export COPILOT_PROVIDER_TRANSPORT="http"
export COPILOT_PROVIDER_MODEL_ID="gpt-5.4"
export COPILOT_PROVIDER_WIRE_MODEL="chatgpt-web/gpt-5.6-sol-instant"
```

## 2. Smoke test (no tools)

```powershell
copilot -p "Reply exactly: COPILOT_OK" --allow-all-tools --model "gpt-5.4"
```

Expected: `COPILOT_OK` and nothing else.

## 3. Local tool proof

```powershell
copilot -p "Read package.json using your local tool and reply only with the package name." --allow-all-tools --model "gpt-5.4"
```

Expected output includes a real tool-call line (e.g. `Read package.json`)
followed by:

```
codex-chatgpt-web
```

If instead you see a literal `<copilot_tool_call_json>...</copilot_tool_call_json>`
tag printed as text, or a `Local tools unavailable` notice, see the
troubleshooting notes in [../AGENTS.md](../AGENTS.md) (Full harness not
attached, or an older build without the underscore-escaping fix).

## 4. Interactive session

Same env vars must be set in the same terminal *before* launching:

```powershell
copilot
```

Once inside, `/model` should list `gpt-5.4`. If it only offers cloud models
(`Auto`, `gpt-5.6-terra`, etc.) and shows real GitHub Copilot quota errors,
the env vars weren't set in this terminal — BYOK silently falls back to
normal GitHub Copilot cloud routing.

## Debugging a bad response

```powershell
copilot -p "..." --allow-all-tools --model "gpt-5.4" --log-level debug --log-dir C:\temp\copilot-debug
```

Then search the log for the raw response our server sent:

```powershell
Select-String -Path C:\temp\copilot-debug\*.log -Pattern "model_wire"
```
