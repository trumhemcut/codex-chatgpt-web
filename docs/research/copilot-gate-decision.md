# Copilot Phase 0 gate decision

Date: 2026-09-29

## Gate

| Client | Route | Result |
| --- | --- | --- |
| GitHub Copilot CLI | Existing local OpenAI-compatible Responses/provider route established by the CLI spike/research | PASS |
| VS Code GitHub Copilot Chat | Public Language Model Chat Provider API via a thin extension | PASS |

## Smallest production seam

Do not introduce the speculative `ClientTurn` / `ClientAdapter` abstraction yet. The CLI can reuse the existing HTTP/Responses seam, while VS Code needs only a thin extension plus one daemon-facing request shape. Keep `ProviderAdapter` and the ChatGPT Web browser runtime unchanged until a second concrete parser proves a shared neutral type saves code.

## Expected production files

Phase 1 should focus on startup/config boundaries: `src/setup.ts`, `src/cli.ts`, `src/config.ts`, `src/server.ts`, and the existing Codex integration modules. Shared ChatGPT runtime remains under `src/adapters/chatgpt-web/**`.

Phase 2 should add Copilot CLI integration code/config only where the CLI fixture differs from the existing Responses route.

Phase 3 should add a small VS Code extension package that talks to the local daemon; it contains no ChatGPT browser automation or GitHub credentials.

Phase 4 remains conditional. VS Code/Copilot owns native tool/MCP invocation and approval. Shared authority changes are required only if retained ChatGPT tool rounds need cross-client turn correlation.

## Hard limitations / reduced scope

- VS Code provider requests expose User/Assistant request roles, not a provider System role.
- Image payload delivery through the selected Copilot Chat provider path is API-supported but not live-proven in this spike, so image context is Partial.
- Copilot policy/plan can affect availability of custom model providers.
- Client-owned tool approval must remain in Copilot/VS Code; the bridge must not silently execute a write.

P1 is unblocked: no implementation-critical provider/protocol question remains open.
