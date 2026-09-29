# GitHub Copilot CLI Quickstart (BYOK)

Ready-to-paste commands for testing the Copilot CLI integration once the app
is already running. For first-time setup, troubleshooting, and how the
integration works, see [github-copilot-usage.md](github-copilot-usage.md) and
[../AGENTS.md](../AGENTS.md).

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
