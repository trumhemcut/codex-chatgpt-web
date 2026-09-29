# Running this project (agent notes)

Operational notes learned the hard way while running the launcher and testing
the GitHub Copilot CLI integration on Windows. See also `docs/dev-chat.md` and
`docs/architecture.md` for the DEV harness design and `docs/github-copilot-usage.md`
for the user-facing Copilot CLI guide.

## Environment gotchas (Windows / VS Code host)

- **`ELECTRON_RUN_AS_NODE=1` / `ELECTRON_NO_ATTACH_CONSOLE=1`** are inherited
  from the VS Code / Claude Code host process. Any Electron binary spawned
  while these are set runs in plain-Node emulation (`app` is `undefined`,
  `main.cjs` crashes on `app.getPath`). Always strip them before spawning
  Electron or running launcher scripts:
  `env -u ELECTRON_RUN_AS_NODE -u ELECTRON_NO_ATTACH_CONSOLE <command>`.
- **`cd` into `launcher/`** triggers a broken shell hook that prints
  `error: We can't find the necessary environment variables to replace the
  Node version. ... fnm env ...` and returns exit code 1, even though the
  directory change itself succeeds. It's noise, not a real failure — but it
  breaks `&&` chains. Avoid `cd launcher && ...`; use `bun --cwd launcher ...`
  from the repo root instead, and treat the same message elsewhere in this
  repo (e.g. from `bun run src/cli.ts doctor`) as a one-off fluke worth a retry.

## Running the Prod app normally

Double-click the installed shortcut ("Codex Web GPT"), or:

```bash
"/c/Users/phihuynh/AppData/Local/Programs/Codex Web GPT/Codex Web GPT.exe"
```

This runs the **installed release build** (`~/.codex-chatgpt-web/versions/<ver>/app`),
not the current repo source. Config/session lives in `~/.codex-chatgpt-web`.

## Running the Prod app from latest repo source

`bun run launcher` is **not** this — it always passes `--dev-profile`
(`launcher/scripts/dev.cjs`), which forces the isolated DEV harness identity
(`~/.codex-chatgpt-web-dev`, separate ChatGPT login, separate connector). To
run the real Prod identity (`~/.codex-chatgpt-web`, existing ChatGPT session,
`Codex Native2` connector) from current source instead of the installed
build, replicate `dev.cjs` manually without the flag:

```bash
cd /c/Users/phihuynh/projects/codex-chatgpt-web

# 1. Stop the installed Prod app cleanly (get PIDs first, kill together —
#    killing only the daemon lets the supervisor auto-restart the OLD
#    installed build and reclaim the port before yours binds).
tasklist | grep -iE "codex web gpt|tunnel-client"
# taskkill //PID <main> //PID <tunnel-client> //F   (children cascade)

# 2. Build the browser helper from source.
env -u ELECTRON_RUN_AS_NODE -u ELECTRON_NO_ATTACH_CONSOLE \
  bun run scripts/build-browser-helper.ts

# 3. Start the renderer dev server (from repo root, NOT `cd launcher`).
bun --cwd launcher node_modules/vite/bin/vite.js > /tmp/vite-prod.log 2>&1 &
disown

# 4. Spawn Electron directly, no --dev-profile => resolves to production
#    profile (profile.cjs) => uses ~/.codex-chatgpt-web, existing session.
ELECTRON_BIN="/c/Users/phihuynh/projects/codex-chatgpt-web/launcher/node_modules/electron/dist/electron.exe"
BUN_BIN="/c/Users/phihuynh/AppData/Local/Microsoft/WinGet/Links/bun.exe"
env -u ELECTRON_RUN_AS_NODE -u ELECTRON_NO_ATTACH_CONSOLE \
  VITE_DEV_SERVER_URL="http://127.0.0.1:4178" \
  CODEX_WEB_GPT_BUN="$BUN_BIN" \
  CODEX_CHATGPT_WEB_BUN="$BUN_BIN" \
  "$ELECTRON_BIN" "/c/Users/phihuynh/projects/codex-chatgpt-web/launcher" \
  > /tmp/electron-prod.log 2>&1 &
disown

# 5. Verify.
bun run src/cli.ts doctor
```

Confirm it actually resolved to production (not dev) by checking
`~/.codex-chatgpt-web/runtime/launcher-browser.json`: `"profile": "production"`,
and that `helper.executable` / `helper.script` point into this repo's
`launcher/node_modules/electron` and `.launcher-runtime/`, not
`AppData\Local\Programs\Codex Web GPT`.

**After editing server/adapter code**, the daemon (`cli.js serve`, a child of
the Electron main process) does not hot-reload. Find and kill just that child
PID — the app's own supervisor restarts it immediately using the same source
tree, since the whole app is already running from source:

```bash
powershell -NoProfile -Command "(Get-NetTCPConnection -LocalPort 17841 -State Listen).OwningProcess"
taskkill //PID <that-pid> //F
# wait ~3s, then re-check the port; supervisor rebinds automatically
```

Do **not** do this dance against the *installed* app (daemon PID under
`versions/<ver>/app/cli.js`) — its supervisor restarts the same old
installed build, not your source changes, and racing kills against it can
trip its restart circuit breaker (>5 restarts/60s => `automatic restart is
disabled`, requires a full app restart to clear).

## Testing the GitHub Copilot CLI (BYOK) integration

Ready-to-paste commands: [docs/copilot-cli-quickstart.md](docs/copilot-cli-quickstart.md).

One-time per config: enable the integration and attach the Full harness MCP
connector.

```bash
bun run src/cli.ts integrations setup copilot-cli
```

Prints the required env vars. Then in the running app's window: **MCP** tab →
**Setup MCP** → create/attach the ChatGPT connector named exactly
`Codex Native2` (Prod) — Connection: Tunnel, Authentication: None,
Permissions: Allow all actions. `doctor`'s
`ChatGPT connector "Codex Native2" is attached` line can't be verified
locally; only `Verify runtime` in the app or an actual tool-call proof
confirms it.

Smoke test (same terminal, env vars set first):

```bash
export COPILOT_PROVIDER_BASE_URL="http://127.0.0.1:17841/copilot/v1"
export COPILOT_PROVIDER_TYPE="openai"
export COPILOT_PROVIDER_WIRE_API="responses"
export COPILOT_PROVIDER_TRANSPORT="http"
export COPILOT_PROVIDER_MODEL_ID="gpt-5.4"
export COPILOT_PROVIDER_WIRE_MODEL="chatgpt-web/gpt-5.6-sol"

copilot -p "Reply exactly: COPILOT_OK" --allow-all-tools --model "gpt-5.4"
copilot -p "Read package.json using your local tool and reply only with the package name." --allow-all-tools --model "gpt-5.4"
```

Expected: `COPILOT_OK`, then `codex-chatgpt-web` (with an actual `Read
package.json` tool-call line above it, not a raw `<copilot_tool_call_json>`
tag printed as text — see the bug note below if you see the raw tag).

**Interactive `copilot` sessions** (no `-p`) only use BYOK if the same
`COPILOT_PROVIDER_*` env vars are set in that exact terminal before launch.
Without them, `/model` won't offer `gpt-5.4` and it silently falls back to
real GitHub Copilot cloud routing/quota (`exceeded your monthly quota` is
real GitHub quota, unrelated to this server).

Debugging a bad response: rerun with `--log-level debug --log-dir
/tmp/copilot-debug-logs`, then `grep -n "model_wire" <logfile>` to see the
raw JSON our server returned.

### Known server-side bugs already fixed (`src/adapters/chatgpt-web/index.ts`)

1. `emitReadOnlyContextWarning` used to fire even when `copilotClientTools`
   was true, injecting a "Local tools unavailable... connect the Full
   harness" warning that's about ChatGPT's own native computer tool, not
   Copilot's client-executed-tools protocol. It corrupted the response shape
   (two `choices` entries, one commentary + one final_answer) which newer
   Copilot CLI builds don't split correctly, so both got concatenated into
   one visible blob. Fixed by skipping the warning when `copilotClientTools`
   is true.
2. ChatGPT's Markdown habit of backslash-escaping underscores (e.g.
   `COPILOT_OK` → `COPILOT\_OK`) also escapes the `<copilot_tool_call_json>`
   tag delimiters, breaking the exact-match regex and leaving the raw tag
   printed as text instead of executed as a tool call. Fixed by stripping
   `\_` → `_` from the answer before matching/parsing it.

## DEV harness (not for Copilot CLI testing)

`bun run src/cli.ts dev launcher` / `dev setup --browser-only
--automatic-browser-interaction --acknowledge-unofficial` sets up an isolated
`~/.codex-chatgpt-web-dev` profile with its own ChatGPT login and its own
connector (`Codex Native2 DEV`). It is for the built-in `dev chat NAME` REPL
only (context/compaction/model experiments against a live browser session,
tool calls simulated). `server.ts` hard-refuses to start a Responses/Copilot
HTTP listener for any `purpose: "dev-harness"` config — this harness can
never serve the Copilot CLI bridge, by design. Don't use it for that.
