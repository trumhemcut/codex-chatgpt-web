# Copilot Environment Inventory

Captured: 2026-09-29 (Asia/Saigon)

## GitHub Copilot CLI

- Version: `1.0.79-9`
- Executable: `C:\Users\phihuynh\AppData\Roaming\npm\copilot.ps1`
- User config root: `C:\Users\phihuynh\.copilot`
- Supported provider mechanism observed from `copilot help providers`: custom model providers (BYOK) through `COPILOT_PROVIDER_BASE_URL`.
- Provider types: `openai` (default), `azure`, `anthropic`.
- OpenAI wire APIs: `completions` (default) or `responses` via `COPILOT_PROVIDER_WIRE_API`.
- Transport: HTTP by default; Responses API may use WebSockets with `COPILOT_PROVIDER_TRANSPORT=websockets`.
- Authentication: custom provider mode does not require GitHub authentication; provider API key/bearer token is optional depending on endpoint.
- Model selection: `COPILOT_MODEL`, `COPILOT_PROVIDER_MODEL_ID`, `COPILOT_PROVIDER_WIRE_MODEL`, or `--model`.
- MCP: CLI exposes `mcp` management plus `--additional-mcp-config`, built-in GitHub MCP controls, and native tool permission flags.
- Attachments: `--attachment <path>` supports an image or native document for non-interactive prompts.
- Sessions: `--continue`, `--resume`, and `--session-id` are available.
- Streaming: `--stream on|off` and JSONL output are available.

This is enough to proceed with P0.2/P0.3 using the public BYOK route rather than patching or intercepting Copilot traffic.

## Visual Studio Code

- Version: `1.139.1`
- Commit: `04c0d99f4fb0d8afe6ce4f0c58e31e183ac3e4b1`
- Architecture: `x64`
- CLI: `C:\Users\phihuynh\AppData\Local\Programs\Microsoft VS Code\bin\code.cmd`
- User settings: `C:\Users\phihuynh\AppData\Roaming\Code\User\settings.json`

### Copilot-related extensions found by VS Code CLI

- `hieuhuynht.ai-agent-copilot@14.0.0`
- `ms-azuretools.vscode-azure-github-copilot@1.0.236`

The standard `GitHub.copilot` / `GitHub.copilot-chat` extension IDs were not returned by `code --list-extensions --show-versions`. The current user settings do contain `github.copilot.*` and `chat.*` keys. P0.9 must verify whether Copilot Chat is built into this VS Code build/profile, installed in another profile, or unavailable in the current CLI profile before a VS Code spike is attempted.

## Relevant local state

- Copilot CLI root exists at `C:\Users\phihuynh\.copilot` with session, MCP, IDE, log, plugin, skill, and runtime state.
- Existing user settings include `github.copilot.*` and `chat.*` configuration keys.
- No secret values were copied into this inventory.

## P0.1 result

P0.1 is complete for the active Windows environment. The strongest finding is that Copilot CLI already exposes an official OpenAI-compatible BYOK provider route with Responses API support, so the next CLI task should test the existing local Responses endpoint directly before adding any adapter code.
