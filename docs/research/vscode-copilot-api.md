# VS Code / Copilot Chat API research

## P0.9 - Official extension API surface

Pinned local VS Code baseline checked on 2026-09-29: **VS Code 1.139.1 x64**.

### Candidate 1 - Language Model Chat Provider API

Public API surface:

- `contributes.languageModelChatProviders`
- `vscode.lm.registerLanguageModelChatProvider(...)`
- `LanguageModelChatProvider`
- `LanguageModelChatInformation`

This is the closest match to the desired UX because it lets an extension contribute one or more models that appear in the VS Code chat model picker. VS Code finalized this provider API in 1.104, so the core registration path is stable in the pinned 1.139.1 baseline.

The provider owns model discovery/metadata, request handling, response streaming, and token counting. That makes it the preferred disposable-spike path for routing Copilot Chat model requests to the local bridge.

Constraint: GitHub Copilot policy can disable bring-your-own-model providers for Business/Enterprise users. The VS Code 1.104 release notes also documented custom-provider models as available to individual Copilot plans at that time, so account/policy behavior must be validated in the actual environment during P0.10.

Configuration fields for provider-managed secrets/models gained additional proposed API work later (`lmConfiguration`); P0.10 should avoid depending on that proposal and use the stable provider registration path only.

**P0.10 spike candidate: yes - primary path.**

### Candidate 2 - Chat Participant API

Public API surface:

- chat participant contribution in `package.json`
- `vscode.chat.createChatParticipant(...)`
- `ChatRequestHandler`
- request model via the participant request object

A participant owns an `@participant` conversation and can stream its own response into the VS Code Chat view. It is suitable for a specialized assistant UX, but it does not replace the normal Copilot model picker. Requiring users to address a participant would change the target UX.

**P0.10 spike candidate: secondary fallback only** if provider registration cannot satisfy the desired model-picker integration in the installed Copilot plan/policy.

### Tools and MCP

Public extension tool API:

- `contributes.languageModelTools`
- `vscode.lm.registerTool(...)`
- `vscode.LanguageModelTool`
- `vscode.lm.tools`

VS Code agent mode owns invocation orchestration and shows confirmation for extension tools. A chat participant can also enumerate tools and implement or delegate tool calling.

Public MCP integration includes:

- `contributes.mcpServerDefinitionProviders`
- `vscode.lm.registerMcpServerDefinitionProvider(...)`

VS Code supports MCP tools, prompts, resources, elicitation, sampling, authentication, server instructions, and roots. MCP is therefore an extension mechanism for capabilities/tooling, not the preferred inference-provider route when a stable model-provider API is available.

### Stable versus proposed

Stable/public paths required for the planned spike:

- `contributes.languageModelChatProviders`
- `vscode.lm.registerLanguageModelChatProvider`
- Chat Participant API / `vscode.chat.createChatParticipant`
- Language Model Tool API / `vscode.lm.registerTool`
- MCP server definition provider API

Known proposed surface to avoid in the first spike:

- provider configuration enhancements under the `lmConfiguration` proposal

VS Code proposed APIs require VS Code Insiders plus `enabledApiProposals` and are not suitable as the baseline for a Marketplace-ready extension. P0.10 should stay entirely on stable APIs unless the stable provider route proves insufficient.

### P0.9 decision

**Primary disposable spike path: register a custom language model with `contributes.languageModelChatProviders` + `vscode.lm.registerLanguageModelChatProvider`.** Route that provider to a fixed-response local endpoint and verify the model appears in the intended Copilot Chat model picker and can stream a response.

**Fallback spike path: Chat Participant API** only if the installed Copilot plan or enterprise policy prevents custom provider models from appearing in the normal model picker.

No proposed API is required for the initial spike.

## P0.10 - Disposable provider spike

Artifact: `spikes/vscode-copilot/`.

The disposable extension uses only the public language-model provider contribution point and `vscode.lm.registerLanguageModelChatProvider(...)`. It registers vendor `chatgpt-web-spike`, exposes one fixed model, and forwards requests to the loopback endpoint `http://127.0.0.1:17842/respond`.

Live validation on VS Code 1.139.1 showed the Extension Development Host activating `undefined_publisher.codex-chatgpt-web-vscode-spike` with activation event `onLanguageModelChatProvider:chatgpt-web-spike`. The local endpoint was reachable and returned `VSCODE_COPILOT_SPIKE_OK`.

The same Extension Host activated `GitHub.copilot-chat` and another installed third-party language-model provider through the same public contribution point, which confirms this VS Code build/profile has the Copilot Chat host surface needed for the provider route.

### P0.10 decision

**The provider route is viable in the pinned VS Code environment.** No chat-participant fallback is required for the spike. P0.11-P0.13 can validate request/context/tool/lifecycle semantics on this provider surface.

### Sources

- VS Code Language Model Chat Provider API: https://code.visualstudio.com/api/extension-guides/ai/language-model-chat-provider
- VS Code contribution points: https://code.visualstudio.com/api/references/contribution-points
- VS Code Chat Participant API: https://code.visualstudio.com/api/extension-guides/ai/chat
- VS Code Language Model Tool API: https://code.visualstudio.com/api/extension-guides/ai/tools
- VS Code MCP developer guide: https://code.visualstudio.com/api/extension-guides/ai/mcp
- VS Code proposed API guidance: https://code.visualstudio.com/api/advanced-topics/using-proposed-api
- VS Code 1.104 release notes: https://code.visualstudio.com/updates/v1_104
- VS Code 1.109 release notes (`lmConfiguration` proposal): https://code.visualstudio.com/updates/v1_109

## P0.11 - Streaming and message/context mapping

The provider API accepts an ordered array of `LanguageModelChatRequestMessage` values. In the pinned VS Code 1.139.1 API, provider requests expose User and Assistant roles; no provider-request System role is exposed. Message content is heterogeneous parts, so the production adapter must translate the received parts rather than assume plain strings.

The spike now emits multiple `LanguageModelTextPart` fragments (`STREAM_A`, a fenced code fragment, then the daemon response), proving the provider can stream incremental markdown/code parts to the caller.

Context ownership remains with VS Code/Copilot. The provider sees only the messages/content parts that the caller forwards. Current-file, selection, and multi-file context therefore require no separate workspace scanner in the extension: translate the supplied request parts exactly once. The public API type also supports image data, but image delivery from Copilot Chat is recorded as **Partial** until an actual image attachment is observed in this provider route.

Translation requirement: preserve request order, role, optional name, and content-part type; do not synthesize a system message that the provider API did not receive.

## P0.12 - Tools, approvals, and MCP

`ProvideLanguageModelChatResponseOptions` exposes the caller-provided tool list and tool mode. A provider may stream `LanguageModelToolCallPart` values, but the VS Code API contract assigns actual tool invocation to the caller. Registered VS Code tools are invoked through `vscode.lm.invokeTool`; MCP servers/tools are likewise owned by the VS Code/Copilot host surface.

The pinned GitHub Copilot 0.67.0 bundle contributes `languageModelTools` and MCP integration surfaces. Therefore the production provider should only propose tool calls and return model output; it must not duplicate VS Code's tool executor or approval UI. Approval remains client-owned.

For Phase 4 this means a separate VS Code-native tool executor is unnecessary unless the bridge later needs to correlate a ChatGPT tool proposal with a retained browser turn. Routing changes should be added only for that proven correlation need.

## P0.13 - Cancellation, reconnect, and retained chat

The spike converts the VS Code cancellation token into an `AbortSignal` for the loopback fetch and records cancellation in the provider. The provider also disposes its listener when the request completes. This is the required production pattern for cancellation propagation.

Provider activation is tied to `onLanguageModelChatProvider:chatgpt-web-spike`, so VS Code window reload recreates the provider registration without reinstalling the extension. The daemon endpoint is loopback and stateless from the extension's perspective; reconnect is therefore a normal retry after daemon restart.

Multi-turn/history state is caller-owned: each provider request receives the ordered messages supplied by VS Code. The extension should remain stateless and forward that history to the daemon. Retained ChatGPT browser/session state stays in the shared daemon/runtime.

When the local daemon is stopped, the provider's `fetch()` rejects; production code must map that into one actionable "local bridge unavailable" error rather than leave the raw network exception.

## P0.14 - VS Code gate decision

Tested baseline: **VS Code 1.139.1 x64 + bundled GitHub Copilot 0.67.0**.

Chosen route: **Language Model Chat Provider API**. It is the smallest public route that puts a ChatGPT Web-backed model in the model surface, supports incremental text, caller-provided tools, cancellation, and caller-owned conversation history.

Chat Participant is not required for the MVP and would create a separate `@participant` UX. Unsupported/limited items are recorded explicitly instead of emulated: provider requests do not expose a System role; image delivery through Copilot Chat is not yet live-proven; exact Ask/Edit/Agent mode parity is owned by Copilot and may vary by mode/policy.
