# GitHub Copilot Integration - Run Guide

Already set up and just need the commands? See the
[quickstart](copilot-cli-quickstart.md) instead.

This guide covers both supported GitHub Copilot integrations:

- GitHub Copilot CLI
- GitHub Copilot in VS Code

## 1. Prerequisites

Open PowerShell in the repository:

```powershell
cd C:\Users\phihuynh\projects\codex-chatgpt-web
```

Verify the required Bun version:

```powershell
bun --version
```

Expected:

```text
1.4.0
```

Build the runtime if needed:

```powershell
bun install --frozen-lockfile
bun run build
```

Start the app **from this repo's current source**, not the installed
shortcut — the Copilot integration routes are unreleased code, so the
installed build (`Codex Web GPT.exe`) doesn't have them yet. Follow "Running
the Prod app from latest repo source" in [../AGENTS.md](../AGENTS.md).

Do **not** use `bun run launcher` for this: that command always passes
`--dev-profile`, which starts the isolated DEV harness (`~/.codex-chatgpt-web-dev`,
its own ChatGPT login, its own `Codex Native2 DEV` connector) instead of the
real Prod identity these instructions assume. The DEV harness also refuses to
start the Responses/Copilot HTTP listener entirely (`server.ts`), so neither
Copilot integration below can work against it regardless.

Keep the launcher/runtime running while using either Copilot integration.
After changing server/adapter source, the daemon needs restarting to pick it
up — see "After editing server/adapter code" in [../AGENTS.md](../AGENTS.md).

## 2. GitHub Copilot CLI

In the launcher, enable **GitHub Copilot CLI** and keep the launcher/runtime running.

Then, in a new PowerShell window, go to the repository and enable the integration for the project:

```powershell
cd C:\Users\phihuynh\projects\codex-chatgpt-web
bun run src/cli.ts integrations setup copilot-cli
```

The command prints the environment variables required for GitHub Copilot CLI BYOK mode. Apply them in the **same PowerShell window** before starting `copilot`:

```powershell
$env:COPILOT_PROVIDER_BASE_URL="http://127.0.0.1:17841/copilot/v1"
$env:COPILOT_PROVIDER_TYPE="openai"
$env:COPILOT_PROVIDER_WIRE_API="responses"
$env:COPILOT_PROVIDER_TRANSPORT="http"
$env:COPILOT_PROVIDER_MODEL_ID="gpt-5.4"
$env:COPILOT_PROVIDER_WIRE_MODEL="gpt-5.6-sol"
```

Verify BYOK mode is active before sending any prompt:

```powershell
Get-ChildItem Env:COPILOT_PROVIDER_*
```

`COPILOT_PROVIDER_BASE_URL` must be present. GitHub Copilot CLI documents this variable as the switch that activates custom-provider/BYOK mode; GitHub authentication and GitHub Copilot quota are not required for that mode.

Verify Copilot CLI:

```powershell
copilot --version
```

The validated baseline for this integration is:

```text
1.0.79-9
```

If a newer CLI is installed, `integrations status copilot-cli` may report it as unvalidated. Run the smoke test below before treating that version as supported.

Start an interactive Copilot session:

```powershell
copilot
```

For a quick smoke test:

```powershell
copilot -p "Reply exactly: COPILOT_OK" --allow-all-tools
```

Expected result: Copilot returns `COPILOT_OK` through the local `codex-chatgpt-web` Responses bridge.

Before the smoke test, confirm project status:

```powershell
bun run src/cli.ts integrations status copilot-cli
```

If the prompt returns `You have exceeded your monthly quota`, the CLI is using normal GitHub Copilot routing instead of the local BYOK bridge. Re-check that the `COPILOT_PROVIDER_*` variables are set in the same shell where `copilot` is launched.

## 3. GitHub Copilot in VS Code

In the launcher, enable **VS Code Copilot** and keep the runtime running.

The VS Code integration is implemented as the extension under:

```text
integrations/vscode-copilot
```

Install or run the built extension using the VS Code Extension Host workflow used by the project. Then open Copilot Chat in that VS Code instance and select the `codex-chatgpt-web` language model/provider exposed by the extension.

Run a simple prompt first:

```text
Reply exactly: VSCODE_COPILOT_OK
```

Then verify a normal coding prompt and a tool-calling prompt. Tool execution and approval remain owned by VS Code/Copilot; the integration forwards Copilot CLI requests through the dedicated local `/copilot/v1/responses` route.

## 4. Quick verification

Before diagnosing Copilot itself, verify the project locally:

```powershell
bun x --no-install --bun tsc --noEmit
bun test tests/copilot-cli-integration.test.ts tests/copilot-file-attachment.test.ts tests/vscode-copilot-integration.test.ts
```

Current expected focused-test result:

```text
3 pass
0 fail
```

Rebuild when source code changes:

```powershell
bun run build
```

The runtime output is written to:

```text
dist/runtime
```

## 5. Troubleshooting

If `bun run build` rejects the Bun version, verify that `bun --version` is exactly `1.4.0`.

If Copilot CLI is not detected, verify:

```powershell
Get-Command copilot
copilot --version
```

On Windows the CLI may be exposed through `copilot.cmd`; the integration supports this form.

If Copilot reports a provider/API error, keep the launcher running and check the launcher/runtime logs. A successful unit test or build does not by itself prove the live Copilot connection; the CLI or VS Code smoke test above must also succeed.
