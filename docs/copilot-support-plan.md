# GitHub Copilot CLI & VS Code Copilot Chat Support Plan

## 1. Goal

Extend `codex-chatgpt-web` so the existing ChatGPT Web runtime can serve **Codex, GitHub Copilot CLI, and VS Code GitHub Copilot Chat** without duplicating browser automation or weakening the current Codex flow.

Target experience:

```text
Codex -------------------┐
Copilot CLI -------------+--> Client integration --> shared ChatGPT Web runtime --> ChatGPT Web
VS Code Copilot Chat ----┘                              |
                                                       +--> client tools via MCP/tool bridge
```

The project should keep one implementation for ChatGPT login, model selection, browser turns, streaming, retained conversations, compaction primitives, limits, and launcher lifecycle. Each client gets only the protocol/config/tool translation it needs.

## 2. Current architecture and constraints

The reusable core is already substantial:

- ChatGPT browser/session automation and model routing.
- `ProviderAdapter` turn execution boundary.
- Launcher/runtime installation and lifecycle.
- Streaming/event queue infrastructure.
- MCP/tunnel capability broker used by Full Harness.
- Browser-only and Full modes.

Codex-specific behavior is currently spread across the outer edge:

- `src/codex-integration*.ts` installs and manages Codex configuration/routes.
- `src/server.ts`, `src/bridge.ts`, `src/responses/*` implement Codex's Responses API expectations.
- `src/types.ts` uses Codex-named request/message/tool/usage types.
- Model catalog, compaction, interrupt identity, subagents, and Full Harness callback behavior contain Codex assumptions.
- Launcher copy and setup flows currently describe Codex as the only client.

The design rule for this work is: **do not fork the ChatGPT Web adapter**. Add thin client integrations around the existing runtime.

## 3. First gate: validate supported Copilot extension points

Before implementation, build two tiny spikes against the exact installed/current Copilot versions. This gate prevents us from designing around undocumented assumptions.

### 3.1 Copilot CLI spike

Confirm:

1. Whether Copilot CLI supports a custom model/provider endpoint suitable for this bridge.
2. Exact request/stream protocol used by that endpoint.
3. How system/developer/user messages and image/file context are represented.
4. How tool definitions, tool calls, tool results, approvals, cancellation, and session continuation are exposed.
5. Whether MCP servers can be attached and whether tool execution can remain owned by Copilot CLI.
6. Whether model discovery is configurable or fixed.
7. Authentication expectations for a local endpoint.

Deliverable: `docs/research/copilot-cli-protocol.md` containing a captured minimal request/response, supported capabilities, unsupported capabilities, and the chosen integration path.

### 3.2 VS Code GitHub Copilot Chat spike

Confirm the supported public VS Code/Copilot extension APIs for:

1. Registering a language model/provider or model entry.
2. Sending chat requests and streaming response fragments.
3. Tool calling and tool result continuation.
4. Workspace/file/selection/image context.
5. Cancellation.
6. Chat participant versus language-model-provider behavior.
7. Authentication and extension trust requirements.

Prefer an official provider/model API when it can make the ChatGPT Web model available naturally inside Copilot Chat. Use a dedicated chat participant only if the provider API cannot support the required behavior.

Deliverable: `docs/research/vscode-copilot-api.md` with a minimal extension spike and a capability matrix.

### 3.3 Gate decision

Proceed only with documented/public extension points. Record one of these outcomes per client:

- **Provider route**: client can call the local bridge as a model/provider.
- **Extension adapter**: a small VS Code extension translates between Copilot/VS Code APIs and the local bridge.
- **MCP-only integration**: useful tool integration is possible, but replacing/adding the model is not supported; document the reduced scope explicitly.

Do not patch Copilot binaries, intercept private traffic, or depend on private APIs.

## 4. Architecture change

Introduce a small client boundary while preserving the existing ChatGPT adapter.

```text
                       +--------------------+
Codex ---------------->| Codex integration  |---+
                       +--------------------+   |
                                                |
                       +--------------------+   v
Copilot CLI ---------->| Copilot CLI adapter|--> Canonical Turn --> ChatGPT Web Adapter
                       +--------------------+   ^                       |
                                                |                       v
VS Code Copilot Chat ->| VS Code adapter    |---+                  Browser worker
                       +--------------------+                           |
                                                                       v
                                                              ChatGPT Web model

Canonical tool calls <----------------------------------------> Client tool bridge
```

### 4.1 Canonical internal turn

Extract only the client-neutral data actually required by the existing adapter. Keep this deliberately small.

Suggested shape:

```ts
type ClientKind = "codex" | "copilot-cli" | "vscode-copilot";

interface ClientTurn {
  client: ClientKind;
  sessionId: string;
  turnId: string;
  model: string;
  messages: ClientMessage[];
  tools: ClientTool[];
  attachments: ClientAttachment[];
  outputSchema?: unknown;
  signal: AbortSignal;
}
```

Do not perform a broad rename of every `Codex*` type initially. Extract a neutral type only at the seam needed by a second client; leave proven Codex internals alone until duplication demonstrates a need.

### 4.2 Client adapter contract

Add the minimum contract needed to translate a client turn into the shared runtime and translate events back:

```ts
interface ClientAdapter {
  parseRequest(input: unknown, signal: AbortSignal): Promise<ClientTurn>;
  formatEvent(event: AdapterEvent): unknown;
}
```

If Copilot CLI already speaks a protocol the current Responses endpoint accepts, skip this abstraction and reuse the existing parser directly. The spike decides this.

## 5. Implementation phases

### Phase 0 - Research and protocol fixtures

**Purpose:** remove uncertainty before production code.

Work:

- Complete both spikes in section 3.
- Capture sanitized protocol fixtures for successful text, streaming, tool call, tool result, cancellation, and failure cases.
- Create a capability matrix:

| Capability | Codex | Copilot CLI | VS Code Copilot Chat |
| --- | --- | --- | --- |
| Text turns | Current | Supported | Supported |
| Streaming | Current | Supported | Supported |
| Images/files | Current | Supported | Partial |
| Local tools | Current Full Harness | Supported | Supported |
| MCP | Current | Supported | Supported |
| Cancellation | Current | Supported | Supported |
| Retained sessions | Current | Supported | Supported |
| Compaction | Native Codex flow | Supported (client-owned) | Supported (caller-owned history; daemon retains ChatGPT session) |
| Model picker | Current | Supported | Supported |

Exit criterion: exact supported integration route is known for both clients.

### Phase 1 - Separate shared runtime from Codex installation

**Purpose:** allow another client to invoke the browser runtime without touching Codex config.

Work:

- Keep `src/adapters/chatgpt-web/**` as the shared backend.
- Extract client-neutral request/event types only where Copilot needs them.
- Move Codex route/config installation behind a clearly named Codex client module if needed.
- Make runtime startup independent from `installCodexIntegration()`.
- Add `clients` configuration, defaulting to `codex` for backward compatibility.

Possible layout after the spike:

```text
src/
  clients/
    codex/
    copilot-cli/
    vscode-copilot/
  adapters/
    chatgpt-web/
```

Avoid moving files merely for symmetry. Create these folders only for code that actually differs by client.

Exit criterion: existing Codex tests pass with no behavioral change, and the shared runtime can start without installing a Codex route.

### Phase 2 - Copilot CLI support

**Preferred path:** configure Copilot CLI to use the existing local HTTP bridge if its supported provider protocol is compatible.

Work:

1. Add `copilot-cli` setup/preflight/status/remove commands.
2. Generate or update only the Copilot CLI configuration fields owned by this project.
3. Add protocol translation only for differences proven by the spike.
4. Map ChatGPT Web models to the model identifiers Copilot CLI accepts.
5. Preserve streaming and cancellation.
6. For tools:
   - Prefer Copilot CLI's native tool/MCP execution ownership.
   - Bind each ChatGPT tool call to the originating Copilot turn/session.
   - Return tool results to the same browser response.
7. Add diagnostics showing bridge reachability, configured model/provider, and tool/MCP readiness.
8. Add uninstall/restore behavior using the same transactional principle as Codex integration.

Validation scenarios:

- Prompt -> streamed answer.
- Multi-turn session.
- File/context input.
- One read-only tool call.
- One write tool call with native Copilot approval behavior.
- Cancellation during generation and during a tool round.
- ChatGPT browser/session failure surfaces cleanly in CLI.

Exit criterion: Copilot CLI can complete a real repository task through ChatGPT Web and execute an allowed local tool round end to end.

### Phase 3 - VS Code GitHub Copilot Chat support

Build the smallest VS Code extension required by the validated API.

Preferred behavior:

- ChatGPT Web models appear through the supported Copilot/VS Code model surface.
- The extension talks only to the local launcher-owned daemon.
- The extension contains no ChatGPT browser automation and no ChatGPT credentials.

Work:

1. Add a small extension package only if the official VS Code API requires one.
2. Register the provider/model or participant selected by the spike.
3. Translate VS Code chat messages/context into the canonical local request.
4. Stream markdown/reasoning/tool progress through supported VS Code response primitives.
5. Forward cancellation using the VS Code cancellation token.
6. Map workspace/file/selection/image references without embedding unnecessary file bytes.
7. Integrate tool calls using the official VS Code/Copilot tool/MCP surface.
8. Expose actionable errors when the launcher is stopped, ChatGPT is signed out, model capability is unavailable, or Full Harness is not configured.
9. Package the extension with the launcher or publish it separately depending on installation constraints discovered by the spike.

Validation scenarios:

- Ask/Edit/Agent-style flows that the public API actually supports.
- Current file and selected-text context.
- Multi-file repository context.
- Streaming markdown/code.
- Tool call and approval.
- Cancellation.
- VS Code reload/reconnect.
- Launcher upgrade without extension reconfiguration where possible.

Exit criterion: a user can select/invoke a ChatGPT Web-backed model in the supported Copilot Chat surface and complete a repository edit with normal VS Code approval UX.

### Phase 4 - Generalize Full Harness tool routing

Today Full Harness is described and bound around `Codex Native2`. Generalize only after both Copilot clients prove what they expose.

Work:

- Replace Codex-specific turn binding internally with `client + sessionId + turnId` authority.
- Keep separate connector identities when schemas/tool capabilities differ.
- Never let one client/session claim another client's turn.
- Preserve explicit approval ownership in the originating client.
- Keep tool discovery scoped to the tools that client actually exposes.
- Add connector/runtime verification per client.

Potential connector names, only if separate connectors are required:

```text
Codex Native2
Copilot CLI Native
VS Code Copilot Native
```

If the tool schemas are identical and a single generic connector can safely route by opaque turn capability, use one connector instead. Do not create three connectors for branding alone.

Exit criterion: concurrent Codex/Copilot turns cannot cross-route tools or results.

### Phase 5 - Launcher UX and setup

Change setup from a Codex-only install flow to client selection:

```text
Integrations
[x] Codex
[ ] GitHub Copilot CLI
[ ] VS Code GitHub Copilot Chat
```

Each integration reports independently:

- Installed/configured.
- Client detected/version.
- Local bridge reachable.
- Model/provider registered.
- Full Harness/tool bridge ready.
- Restart/reload required.

Keep ChatGPT login, model capability detection, browser settings, limits, and runtime status global because they are shared.

Do not require existing Codex users to reconfigure on upgrade.

### Phase 6 - Documentation and release

Update:

- `README.md` product positioning from Codex-only to supported coding clients.
- `docs/architecture.md` with the client-adapter boundary.
- setup/troubleshooting docs for each client.
- security model with per-client local authority and tool routing.
- release validation matrix for Windows/macOS/Linux where each client is available.

Keep unsupported Copilot modes/features explicit rather than emulating them incorrectly.

## 6. Configuration strategy

Preserve existing config and add client state additively. Example only; final fields depend on the spikes:

```json
{
  "integrations": {
    "codex": { "enabled": true },
    "copilotCli": { "enabled": false },
    "vscodeCopilot": { "enabled": false }
  }
}
```

Rules:

- Existing installations behave exactly as before.
- Setup modifies only configuration it owns.
- Store backups/journal entries before changing external client config.
- Uninstall restores/removes only project-owned entries.
- Do not store GitHub tokens; let GitHub/Copilot own GitHub authentication.
- ChatGPT authentication remains in the launcher-owned browser profile.

## 7. Security requirements

These are non-negotiable because Full Harness can execute local actions:

- Bind local HTTP endpoints to loopback and retain local request authentication/control-token checks.
- Bind every tool capability to one client/session/turn with expiry/cancellation.
- Do not accept a client-supplied identity as authority without validating the issued capability.
- Preserve the originating client's approval UX; the bridge must not silently grant a write.
- Keep ChatGPT browser credentials inaccessible to Copilot integrations/extensions.
- Validate extension-to-daemon messages and cap request/body sizes.
- Redact tokens/secrets from logs and protocol fixtures.
- Fail closed on unknown tool names, stale turn tokens, schema drift, and ambiguous routing.

## 8. Testing strategy

Keep tests at protocol seams; avoid duplicating browser tests for every client.

### Shared runtime

Reuse current ChatGPT Web/browser tests. Add tests only when neutralization changes behavior.

### Per client

One compact fixture suite per adapter should cover:

- parse text/context request;
- stream text response;
- tool call/result round trip;
- cancellation;
- malformed/unsupported request;
- session/turn isolation.

### End-to-end smoke

Add real smoke commands where automation is supported:

```text
smoke:codex       existing
smoke:copilot-cli new
smoke:vscode      new, extension-host based if supported
```

Release validation should include at least one real ChatGPT Web turn for every supported client. Tool-enabled release validation includes one harmless local tool call.

## 9. Compatibility and migration

Backward compatibility is a release requirement:

- Existing Codex config and model slugs remain valid.
- Existing `Codex Native2` connector remains valid.
- Existing launcher profile/login is reused.
- No automatic enabling of Copilot integrations.
- No rename of current Codex-facing CLI commands until a later major version.

New generic commands can be added alongside existing commands, for example:

```text
codex-chatgpt-web integrations status
codex-chatgpt-web integrations setup codex
codex-chatgpt-web integrations setup copilot-cli
codex-chatgpt-web integrations setup vscode-copilot
```

A future product rename is separate from this implementation and is not required to support Copilot.

## 10. Risks and mitigations

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Copilot does not expose custom model/provider API | Blocks transparent model selection | Use supported extension/participant surface; otherwise document MCP-only scope |
| Copilot API/version drift | Integration breaks after update | Version preflight + protocol fixtures + explicit compatibility range |
| Different tool semantics | Incorrect tool execution/result routing | Client-specific translator, shared turn authority |
| VS Code extension adds another runtime | Operational complexity | Extension remains thin; daemon/browser stay launcher-owned |
| Context semantics differ from Codex | Lost/duplicated context | Client adapter owns context translation; test retained/multi-turn behavior |
| Compaction differs | Long sessions fail | Let client own native compaction when exposed; otherwise add client-specific checkpoint policy |
| Concurrent clients cross-route tools | Security issue | Capability includes client/session/turn and is validated on every call |
| Existing Codex flow regresses | Current users break | Additive config, unchanged defaults, run existing full verify suite |

## 11. Recommended delivery order

1. **Protocol spikes** for Copilot CLI and VS Code Copilot Chat.
2. **Extract the smallest client-neutral seam** needed by the first successful spike.
3. **Copilot CLI MVP** because it is likely to require less UI/package work.
4. **VS Code extension/provider MVP** using the same local seam.
5. **Full Harness/tool routing generalization** based on real client capabilities.
6. **Launcher integration UX**.
7. **Cross-client E2E, security checks, docs, release packaging**.

Do not start by renaming Codex types or reorganizing the repository. The protocol spikes should tell us exactly which abstraction is necessary.

## 12. Definition of Done

Copilot support is complete when:

- Codex behavior remains backward compatible and the existing verify suite passes.
- Copilot CLI can use an eligible ChatGPT Web model for streamed multi-turn coding work.
- VS Code Copilot Chat can use/invoke the ChatGPT Web-backed integration through a documented public API.
- Supported file/workspace/image context reaches ChatGPT correctly.
- Full Harness tool calls execute in the originating client with its approval semantics.
- Cancellation works through browser generation and tool rounds.
- Concurrent Codex, Copilot CLI, and VS Code sessions remain isolated.
- Setup, status, repair, uninstall, and upgrade are transactional for each integration.
- No GitHub credential is copied into this project.
- Release docs state the exact supported Copilot versions/features and known limitations.

## 13. Immediate next task

Phase 0 is complete and both production paths are implemented. The remaining work is release validation on the pinned clients: authenticated/live Copilot CLI and VS Code end-to-end smoke, concurrent-client isolation, and upgrade/uninstall validation. Do not add a generic client-routing layer unless those live checks expose a real routing gap.

### Current execution status — 2026-09-29

| Task | Status | Evidence / remaining gate |
| --- | --- | --- |
| P0.1–P0.16 | Done | `docs/research/**` and disposable spikes record the public provider routes and pinned versions. |
| P1.1–P1.5 | Done | Additive integration state; shared Responses runtime remains the single browser path; Codex stays enabled by default. |
| P2.1–P2.8 | Done | Copilot CLI uses the dedicated `/copilot/v1/responses` route. The server marks that route as trusted client-owned tool mode, ChatGPT Web emits standard Responses tool calls, and Copilot remains responsible for local execution/approval. Lifecycle/config diagnostics live in `src/copilot-cli-integration.ts` + CLI commands. |
| P2.9 | Release-blocked | Requires a real authenticated ChatGPT Web repository smoke through Copilot CLI `1.0.79-9`, including multi-turn, tool round, cancellation, and browser failure. |
| P3.1–P3.8 | Done for supported MVP | Public `vscode.lm.registerLanguageModelChatProvider` extension exists; text/history, streaming, tool calls, cancellation, and actionable bridge errors are implemented. Image input remains Partial. |
| P3.9 | Partial | Production extension package and lifecycle flag exist. Bundled/published VSIX installation and upgrade/uninstall must be live-proven before stable release. |
| P3.10 | Release-blocked | Requires VS Code `1.139.1` + GitHub Copilot `0.67.0` Extension Host/Copilot Chat live smoke. |
| P4.1–P4.4 | Not required by current protocol evidence | Copilot CLI and VS Code own tool execution/approval/history and send independent Responses requests. `Codex Native2` authority stays Codex-only; no shared bridge-side Copilot turn routing exists to generalize. |
| P4.5 | Release-blocked | Run Codex + Copilot CLI + VS Code concurrently and confirm responses/tool calls remain isolated. |
| P5.1–P5.4 | Implemented | Launcher exposes independent Copilot CLI / VS Code integration state and routes status/setup/remove through the same CLI lifecycle seam. Live mixed-state lifecycle validation remains part of P6.5. |
| P6.1–P6.3 | Done | README, architecture, security, troubleshooting, and release validation docs updated to shipped behavior/limitations. |
| P6.4–P6.6 | Release-blocked | Stable release remains blocked until P2.9, P3.10, P4.5, and upgrade/uninstall validation complete. |

Verification completed in this working tree:

- `bun x --no-install --bun tsc --noEmit --pretty false` — PASS.
- `bun test tests/copilot-cli-integration.test.ts tests/vscode-copilot-integration.test.ts tests/copilot-file-attachment.test.ts` — 3 PASS / 0 FAIL.
- `node --check` on the VS Code extension and changed Electron `.cjs` files — PASS.
- `git diff --check` — PASS.
- Installed client baselines observed: GitHub Copilot CLI `1.0.79-9`, VS Code `1.139.1`.
- Full dependency install attempt is currently blocked on this Windows checkout by Bun cache extraction `EPERM` for `content-type`; existing installed dependencies are sufficient for the checks above.

## 14. Detailed execution backlog

Use this section as the implementation order. A task is done only when its validation passes and its artifact/evidence exists. Do not start production-runtime changes in P1+ until the P0 gate is recorded.

### Phase 0 — Research, protocol spikes, and gate decision

#### P0.1 — Inventory local GitHub Copilot surfaces

**Depends on:** none

**Steps:**

1. Record the installed GitHub Copilot CLI binary/package, version, executable path, and relevant config locations.
2. Record installed VS Code version and GitHub Copilot / GitHub Copilot Chat extension versions.
3. Record whether MCP support is enabled/available in each client.
4. Record OS-specific paths or commands needed for repeatable detection.

**Artifact:** `docs/research/copilot-environment.md`

**Validation:** another developer can run the documented commands and reproduce the same version/config inventory.

**Done when:** exact client versions under investigation are pinned in the research notes.

#### P0.2 — Verify official Copilot CLI integration mechanisms

**Depends on:** P0.1

**Steps:**

1. Review current official Copilot CLI documentation/help for custom model/provider/endpoints.
2. Identify supported configuration keys and environment variables relevant to providers/models.
3. Check whether the CLI can discover models dynamically or requires predefined model IDs.
4. Check documented MCP/tool integration and approval behavior.
5. Explicitly list unsupported/private mechanisms that will not be used.

**Artifact:** first section of `docs/research/copilot-cli-protocol.md`

**Validation:** every proposed integration point has a public/documented reference or is marked unsupported.

**Done when:** we know whether a provider route is possible enough to build a disposable spike.

#### P0.3 — Build disposable Copilot CLI provider spike

**Depends on:** P0.2

**Steps:**

1. Create a tiny local test endpoint outside the production request path, reusing existing server utilities where practical.
2. Configure Copilot CLI to point at the spike using only supported configuration.
3. Return a fixed text response first.
4. Capture the request shape without secrets.
5. Remove any temporary external config after the experiment or document the exact cleanup command.

**Artifact:** disposable spike under `spikes/copilot-cli/` only if code is needed; otherwise keep the experiment command-only and document it.

**Validation:** one CLI prompt reaches the local endpoint and receives a valid response, or the experiment proves that custom provider routing is unsupported.

**Done when:** provider-route feasibility is proven with evidence.

#### P0.4 — Capture Copilot CLI text and streaming protocol fixtures

**Depends on:** P0.3 provider route feasible

**Steps:**

1. Capture one minimal text request.
2. Capture the expected response envelope.
3. Capture a streamed response with at least two chunks plus completion.
4. Record headers/auth requirements expected by the client.
5. Sanitize user paths, tokens, cookies, IDs, and repository content.

**Artifacts:** sanitized fixtures under `test/fixtures/copilot-cli/` or the repository's existing fixture location.

**Validation:** fixtures can be replayed against the spike without needing GitHub secrets.

**Done when:** text + stream protocol can be implemented from fixtures without guessing.

#### P0.5 — Validate Copilot CLI context and attachment semantics

**Depends on:** P0.3

**Steps:**

1. Send a prompt with repository/file context.
2. Determine whether content is embedded, referenced, summarized, or sent as structured attachments.
3. Test one image input if the CLI surface officially supports images.
4. Record size/format limitations visible from the public surface.

**Artifact:** context section in `docs/research/copilot-cli-protocol.md`

**Validation:** document one concrete captured example per supported context type.

**Done when:** production mapping requirements for files/images are known.

#### P0.6 — Validate Copilot CLI tools and MCP behavior

**Depends on:** P0.3

**Steps:**

1. Expose one harmless read-only tool/MCP capability.
2. Observe the tool-definition format presented to the model/provider path, if exposed.
3. Trigger one tool call and capture call/result semantics.
4. Determine which process owns execution and approval.
5. Test one write-capable operation only far enough to observe the approval boundary; do not bypass native approval.
6. Record whether tool results continue the same model turn/session.

**Artifact:** tool/MCP section plus sanitized fixture(s) in the CLI research output.

**Validation:** tool authority and round-trip ownership are unambiguous.

**Done when:** the plan can state whether the bridge translates tools or lets Copilot own them natively.

#### P0.7 — Validate Copilot CLI cancellation and session continuation

**Depends on:** P0.3

**Steps:**

1. Start a streaming response and cancel it from the CLI.
2. Observe connection/abort behavior at the local endpoint.
3. Run a two-turn conversation and identify retained session/conversation identifiers.
4. Restart the local spike and test whether the client expects session continuity.
5. Record failure behavior when the provider disappears mid-turn.

**Artifact:** cancellation/session section in `docs/research/copilot-cli-protocol.md`

**Validation:** captured evidence explains how to map cancellation and multi-turn identity.

**Done when:** `sessionId`/`turnId` requirements can be defined without assumptions.

#### P0.8 — Finalize Copilot CLI research decision

**Depends on:** P0.4, P0.5, P0.6, P0.7; or P0.3 proves provider route unsupported

**Steps:**

1. Summarize supported capabilities and gaps.
2. Select `provider route` or `MCP-only` for CLI.
3. State exact supported/tested CLI version.
4. List the minimum production changes implied by the evidence.

**Artifact:** completed `docs/research/copilot-cli-protocol.md`

**Validation:** the chosen route is supported entirely by public mechanisms and backed by captured evidence.

**Done when:** Copilot CLI integration path is a recorded gate decision.

#### P0.9 — Verify official VS Code / Copilot Chat extension APIs

**Depends on:** P0.1

**Steps:**

1. Review the VS Code Language Model API available in the pinned version.
2. Review Chat Participant APIs and determine whether a participant can satisfy the desired UX.
3. Review tool/MCP APIs exposed to extensions.
4. Check model registration/provider mechanisms and extension trust/auth constraints.
5. Identify proposed APIs that are stable versus proposed/preview.

**Artifact:** first section of `docs/research/vscode-copilot-api.md`

**Validation:** each candidate integration route names the exact public VS Code API surface it uses.

**Done when:** one or more disposable spike paths are identified.

#### P0.10 — Build minimal disposable VS Code extension spike

**Depends on:** P0.9

**Steps:**

1. Create the smallest extension under `spikes/vscode-copilot/` only if required by the API.
2. Register the candidate model/provider or chat participant.
3. Connect it to a fixed-response local endpoint.
4. Verify the integration appears in the intended Copilot Chat surface.
5. Keep build tooling to what the repo already has where possible; avoid introducing framework scaffolding for the spike.

**Artifact:** minimal spike and run instructions.

**Validation:** one prompt flows from VS Code Copilot Chat through the public API into the local spike and renders a response, or the candidate API is proven insufficient.

**Done when:** the viable VS Code route is demonstrated rather than inferred.

#### P0.11 — Validate VS Code streaming and message/context mapping

**Depends on:** P0.10

**Steps:**

1. Stream multiple markdown/code fragments.
2. Inspect system/user/history/context inputs available to the extension/provider.
3. Test current-file and selected-text context.
4. Test multi-file/workspace context available through the chosen API.
5. Test image context only if the public API supports it.

**Artifact:** protocol/context section in `docs/research/vscode-copilot-api.md`

**Validation:** documented examples show exactly what the adapter receives and what it can stream back.

**Done when:** message and context translation requirements are known.

#### P0.12 — Validate VS Code tools, approvals, and MCP

**Depends on:** P0.10

**Steps:**

1. Register or expose one harmless tool using the official API.
2. Trigger it through the chosen Copilot Chat flow.
3. Observe tool-call/result representation.
4. Confirm where user approval is presented and enforced.
5. Determine whether existing MCP servers can remain client-owned.

**Artifact:** tool section in `docs/research/vscode-copilot-api.md`

**Validation:** the research states which side owns tool execution and approval with captured evidence.

**Done when:** Phase 4 can be scoped from real behavior.

#### P0.13 — Validate VS Code cancellation, reconnect, and retained chat behavior

**Depends on:** P0.10

**Steps:**

1. Cancel a streaming response via VS Code.
2. Verify the extension/provider receives cancellation.
3. Reload the VS Code window and reconnect to the local spike.
4. Test a multi-turn chat and identify which history/session state is supplied by VS Code.
5. Stop the local daemon/spike and capture the client-facing error behavior.

**Artifact:** lifecycle section in `docs/research/vscode-copilot-api.md`

**Validation:** cancellation and reconnection semantics are reproducible.

**Done when:** daemon lifecycle requirements are explicit.

#### P0.14 — Finalize VS Code integration route

**Depends on:** P0.11, P0.12, P0.13

**Steps:**

1. Compare provider/model API and chat-participant route against required capabilities.
2. Select the smallest supported route.
3. Record unsupported Copilot Chat modes/features instead of emulating them.
4. State exact tested VS Code and Copilot extension versions.

**Artifact:** completed `docs/research/vscode-copilot-api.md`

**Validation:** selected route is public, reproducible, and sufficient for the documented MVP.

**Done when:** VS Code route is a recorded gate decision.

#### P0.15 — Build cross-client capability matrix

**Depends on:** P0.8, P0.14

**Steps:**

1. Replace all `Validate` cells in the Phase 0 matrix with `Supported`, `Unsupported`, or `Partial`.
2. For partial support, link the limitation/condition.
3. Add tested version ranges.
4. Add required adapter behavior per capability only where clients differ.

**Artifact:** capability matrix in this document or `docs/research/copilot-capability-matrix.md` if it grows beyond one page.

**Validation:** no implementation-critical capability remains marked unknown.

**Done when:** matrix is usable as acceptance criteria for P1–P6.

#### P0.16 — Record Phase 0 gate and update architecture

**Depends on:** P0.15

**Steps:**

1. Record the chosen route for CLI and VS Code.
2. Revisit the suggested `ClientTurn` / `ClientAdapter` seam and remove any abstraction not required by the fixtures.
3. Identify exact production files expected to change in P1–P4.
4. Record any hard limitation that changes MVP scope.
5. Mark Phase 0 gate `PASS`, `REDUCED-SCOPE`, or `BLOCKED` per client.

**Artifact:** `docs/research/copilot-gate-decision.md` plus updates to Sections 4–5 of this plan.

**Validation:** P1 can start without unresolved protocol/API questions.

**Done when:** production implementation is authorized by evidence from the two spikes.

### Phase 1 — Separate the shared runtime from Codex installation

#### P1.1 — Trace current runtime startup and Codex coupling

**Depends on:** P0.16

**Steps:**

1. Trace launcher -> server/runtime startup -> `installCodexIntegration()` and related config code.
2. List callers of Codex-specific request/response types at the runtime seam.
3. Identify the smallest seam needed by the first successful Copilot client.
4. Confirm what can remain Codex-specific.

**Artifact:** implementation notes in the Phase 0 gate document or PR description; no new design document required.

**Validation:** exact files/functions to modify are named before edits begin.

**Done when:** scope is small enough to implement without repository-wide renames.

#### P1.2 — Decouple daemon/runtime startup from Codex setup

**Depends on:** P1.1

**Steps:**

1. Separate shared daemon startup from Codex external configuration installation.
2. Preserve the existing Codex startup path/default behavior.
3. Ensure shared ChatGPT browser runtime can start when Codex integration is disabled.

**Expected files:** `src/server.ts`, launcher/runtime startup code, and existing Codex integration module only as required by the traced flow.

**Validation:** existing Codex start path still works; shared runtime starts in a test/dev mode without modifying Codex config.

**Done when:** another client can reach the daemon without invoking Codex setup.

#### P1.3 — Add minimal integration enablement state

**Depends on:** P1.2

**Steps:**

1. Add additive client/integration state only if P0 proves more than one integration must be configured independently.
2. Default existing installs to current Codex behavior.
3. Do not rename existing Codex commands/config keys.

**Expected files:** existing launcher/config schema and migration/default logic.

**Validation:** old config loads unchanged; fresh install behaves exactly as current Codex-only release until Copilot is explicitly enabled.

**Done when:** client enablement can be represented without breaking old installs.

#### P1.4 — Extract only the proven client-neutral turn seam

**Depends on:** P1.1, P0 fixtures

**Steps:**

1. Compare existing Codex request model with the first Copilot fixture.
2. Reuse existing Responses parsing directly if compatible.
3. If incompatible, introduce only the neutral fields both paths genuinely need.
4. Keep Codex-only compaction/subagent/model details in Codex code.

**Expected files:** `src/types.ts`, `src/responses/**`, `src/bridge.ts`, or a small new client module only where required.

**Validation:** Codex fixture behavior unchanged; one captured Copilot fixture can reach the ChatGPT adapter through the new seam.

**Done when:** there is exactly one shared path into `src/adapters/chatgpt-web/**` for equivalent turns.

#### P1.5 — Protect Codex backward compatibility

**Depends on:** P1.2–P1.4

**Steps:**

1. Run existing unit/integration verification.
2. Exercise current Codex text streaming.
3. Exercise existing Codex Native2 / Full Harness path if covered by current smoke tooling.
4. Check existing model slugs/config still resolve.

**Artifact:** validation evidence in commit/PR notes; no duplicate test suite unless a regression seam lacks coverage.

**Validation:** current Codex behavior passes unchanged.

**Done when:** Phase 1 introduces no user-visible Codex migration.

### Phase 2 — GitHub Copilot CLI support

#### P2.1 — Implement Copilot CLI client adapter only where fixtures differ

**Depends on:** P1.4, P0.8

**Steps:**

1. Reuse the existing HTTP/Responses route if the fixture is compatible.
2. Add parsing/event translation only for proven differences.
3. Map request/session identifiers into the shared runtime.
4. Reject unsupported fields with a clear client-facing error.

**Expected files:** a small `src/clients/copilot-cli/` module only if translation is actually required; otherwise reuse existing route code.

**Validation:** sanitized P0 text + streaming fixtures pass against the production path.

**Done when:** CLI text streaming works without tool support enabled.

#### P2.2 — Add Copilot CLI model mapping/discovery

**Depends on:** P2.1

**Steps:**

1. Map only ChatGPT Web models eligible for this runtime to identifiers accepted by the CLI.
2. Reuse current model capability catalog.
3. Handle an unavailable/ineligible model with an actionable error.

**Validation:** CLI can select/use at least one supported model and rejects one invalid model cleanly.

**Done when:** no duplicated hard-coded model catalog is introduced.

#### P2.3 — Implement CLI setup transaction

**Depends on:** P0.8

**Steps:**

1. Detect CLI installation/version.
2. Read current supported config location.
3. Back up/journal the exact fields to be changed.
4. Write only project-owned provider/model fields.
5. Never persist GitHub credentials.
6. Make repeated setup idempotent.

**Expected files:** existing integration setup/config utilities plus a minimal Copilot-specific module.

**Validation:** setup works twice with the same result; unrelated user config remains byte/field equivalent.

**Done when:** CLI points to the local bridge using supported config.

#### P2.4 — Implement CLI status/preflight diagnostics

**Depends on:** P2.3

**Steps:**

1. Report CLI detected/version.
2. Report provider/config state.
3. Check local bridge reachability.
4. Check configured model exists/is eligible.
5. Report MCP/tool readiness when applicable.

**Validation:** each deliberately broken prerequisite produces the correct diagnostic.

**Done when:** common setup failures are diagnosable without reading logs manually.

#### P2.5 — Implement CLI context mapping

**Depends on:** P2.1, P0.5

**Steps:**

1. Map supported file/repository context into the shared turn.
2. Map images only if P0 proved official support.
3. Enforce existing daemon request/body limits.
4. Avoid copying file bytes when the supported protocol already supplies a safe reference/structured context form.

**Validation:** P0 context fixtures produce equivalent ChatGPT Web input.

**Done when:** supported CLI context arrives once, in order, without duplication.

#### P2.6 — Implement CLI cancellation and multi-turn identity

**Depends on:** P2.1, P0.7

**Steps:**

1. Map CLI cancellation to the shared `AbortSignal` path.
2. Bind retained turns using the identifiers proven in P0.
3. Ensure cancelled turns cannot later deliver stale chunks/tool results.

**Validation:** cancellation stops generation; second turn retains intended conversation context.

**Done when:** text-only multi-turn and cancellation scenarios pass.

#### P2.7 — Integrate CLI tools/MCP

**Depends on:** P2.6, P0.6; Phase 4 only if generalized authority is required first

**Steps:**

1. Prefer client-owned execution/approval when P0 shows it is available.
2. Translate tool schemas only if required by the provider protocol.
3. Bind each tool round to the originating CLI session/turn.
4. Fail closed on unknown or stale tool calls.

**Validation:** one read-only tool round succeeds; a write-capable tool follows native Copilot approval behavior.

**Done when:** tool result returns to the correct ChatGPT browser turn.

#### P2.8 — Implement CLI repair/remove/restore

**Depends on:** P2.3

**Steps:**

1. Detect drift in project-owned config.
2. Repair only owned fields.
3. Remove integration without deleting unrelated Copilot configuration.
4. Restore backed-up values when appropriate.

**Validation:** setup -> user-unrelated edit -> remove preserves the unrelated edit and restores/removes only owned state.

**Done when:** integration lifecycle is transactional and reversible.

#### P2.9 — Add CLI end-to-end smoke

**Depends on:** P2.2–P2.8

**Steps:**

1. Run streamed prompt.
2. Run second turn.
3. Include file context.
4. Run harmless local tool call when supported.
5. Cancel one active response.
6. Exercise signed-out/browser-unavailable failure.

**Artifact:** `smoke:copilot-cli` command using existing test/script conventions.

**Validation:** smoke passes on the pinned supported CLI version.

**Done when:** a real repository task completes through ChatGPT Web.

### Phase 3 — VS Code GitHub Copilot Chat support

#### P3.1 — Create the minimal production VS Code integration package

**Depends on:** P0.14, P1.4

**Steps:**

1. Promote only the viable disposable spike behavior into production.
2. Keep the extension thin: registration, local-daemon transport, context translation, streaming, cancellation, errors.
3. Reuse repo tooling/dependencies where possible.

**Expected files:** a dedicated extension package only if the chosen public API requires it.

**Validation:** extension loads in Extension Host without ChatGPT/browser code bundled into it.

**Done when:** the production extension can reach the shared daemon.

#### P3.2 — Register the selected model/provider or participant

**Depends on:** P3.1

**Steps:**

1. Register only the P0-selected public API surface.
2. Expose supported ChatGPT Web model(s) or participant command.
3. Declare capabilities honestly from the capability matrix.

**Validation:** integration appears in the expected Copilot Chat UI and can be invoked.

**Done when:** one text prompt reaches the daemon.

#### P3.3 — Implement VS Code message/history translation

**Depends on:** P3.2, P0.11

**Steps:**

1. Translate user/history/system context supplied by the official API.
2. Preserve order and roles supported by the shared runtime.
3. Avoid inventing history not supplied by VS Code.

**Validation:** P0 captured multi-turn example produces equivalent shared-runtime turns.

**Done when:** text multi-turn works without duplicated context.

#### P3.4 — Implement VS Code streaming response rendering

**Depends on:** P3.3

**Steps:**

1. Stream markdown/code fragments through official response primitives.
2. Map only supported progress/tool status events.
3. Surface terminal/provider errors once.

**Validation:** long answer visibly streams and completes cleanly.

**Done when:** no buffering requirement remains for normal text output.

#### P3.5 — Implement workspace/file/selection/image context

**Depends on:** P3.3, P0.11

**Steps:**

1. Map current file and selection.
2. Map multi-file/workspace references exposed by the chosen API.
3. Map images only when P0 marked support.
4. Apply daemon size/validation limits.

**Validation:** each supported context type reaches ChatGPT exactly once and can be identified in a controlled test prompt.

**Done when:** context coverage matches the capability matrix.

#### P3.6 — Implement VS Code cancellation and daemon reconnect

**Depends on:** P3.4, P0.13

**Steps:**

1. Convert VS Code cancellation token to request abort.
2. Dispose streams/listeners on cancellation.
3. Reconnect after daemon restart without requiring extension reinstall.
4. Handle VS Code window reload.

**Validation:** cancel + daemon restart + window reload scenarios recover predictably.

**Done when:** no stale response reaches a cancelled/reloaded chat.

#### P3.7 — Integrate VS Code tools/MCP and approvals

**Depends on:** P3.3, P0.12; Phase 4 if shared authority changes are required

**Steps:**

1. Use official VS Code/Copilot tool APIs.
2. Preserve VS Code-owned user approval semantics.
3. Bind tool calls to originating VS Code session/turn.
4. Translate tool results back to the corresponding browser response.

**Validation:** one read-only and one approval-requiring scenario behave as observed in P0.

**Done when:** repository edit can complete with normal VS Code approval UX.

#### P3.8 — Add actionable integration errors

**Depends on:** P3.2

**Steps:**

1. Launcher/daemon stopped.
2. ChatGPT signed out.
3. Unsupported/unavailable model.
4. Full Harness/tool bridge missing when a tool turn requires it.
5. Incompatible extension/client version.

**Validation:** each simulated failure maps to one clear VS Code error/action.

**Done when:** user does not need daemon logs for these common failures.

#### P3.9 — Package/install/update VS Code integration

**Depends on:** P3.1, P5 setup design

**Steps:**

1. Choose bundled VSIX/local install or published extension based on P0 installation constraints.
2. Add install/update detection.
3. Keep daemon endpoint/config stable across launcher upgrades where possible.
4. Add uninstall path.

**Validation:** install -> VS Code reload -> use -> launcher upgrade -> use -> uninstall lifecycle works.

**Done when:** extension lifecycle is repeatable for a user installation.

#### P3.10 — Add VS Code end-to-end smoke

**Depends on:** P3.2–P3.9

**Steps:**

1. Prompt + streaming answer.
2. Current file/selection context.
3. Multi-turn chat.
4. Tool/edit flow if supported.
5. Cancellation.
6. daemon reconnect/reload.

**Artifact:** extension-host smoke command using repository conventions.

**Validation:** smoke passes on pinned VS Code + Copilot versions.

**Done when:** a real repository edit completes through the supported Copilot Chat surface.

### Phase 4 — Generalize Full Harness / tool routing only as required

#### P4.1 — Trace current Codex Native2 authority model

**Depends on:** P0.6, P0.12

**Steps:**

1. Trace capability/token issuance.
2. Trace client/session/turn identity carried today.
3. Trace tool inventory, invocation, result return, expiry, cancellation.
4. Identify the minimum Codex-specific assumption blocking Copilot.

**Validation:** one shared choke point for authority/routing is identified before edits.

**Done when:** proposed change fixes routing at the shared root rather than per caller.

#### P4.2 — Add client identity to turn authority if proven necessary

**Depends on:** P4.1

**Steps:**

1. Extend existing authority with `client` only if session/turn IDs can collide across clients or routing needs it.
2. Reuse existing capability/token machinery.
3. Preserve existing Codex Native2 token behavior.

**Validation:** old Codex capability still validates; Copilot capability cannot be accepted as a different client.

**Done when:** authority uniquely scopes an originating turn.

#### P4.3 — Route tool inventory per originating client

**Depends on:** P4.2

**Steps:**

1. Expose only tools available to that client/session.
2. Keep connector identities separate only if schema/runtime differs.
3. Reuse one connector when schemas are genuinely identical and existing capability routing can distinguish turns.

**Validation:** concurrent clients see only their allowed tool inventory.

**Done when:** no branding-only duplicate connector exists.

#### P4.4 — Route invocation/result/cancellation to the originating turn

**Depends on:** P4.3

**Steps:**

1. Validate capability before tool invocation.
2. Bind result to same client/session/turn.
3. Expire authority on completion/cancellation.
4. Reject stale/foreign result submissions.

**Validation:** cross-route attempts fail; legitimate concurrent tool rounds succeed.

**Done when:** tool calls cannot cross client/session boundaries.

#### P4.5 — Concurrency/isolation check

**Depends on:** P4.4

**Steps:**

1. Run Codex and Copilot concurrently.
2. Trigger tool rounds in both.
3. Cancel one while the other continues.
4. Attempt replay of a completed/stale capability.

**Artifact:** one compact runnable regression check.

**Validation:** all routing remains isolated and replay is rejected.

**Done when:** Phase 4 security requirement is executable, not only documented.

### Phase 5 — Launcher setup, status, and integration UX

#### P5.1 — Add integration state model to launcher UI

**Depends on:** P1.3, supported clients from P0

**Steps:**

1. Show Codex, Copilot CLI, and VS Code Copilot only when supported on the current platform/version.
2. Keep existing Codex enabled/default behavior.
3. Keep shared ChatGPT login/browser/runtime status global.

**Validation:** existing user upgrade shows current Codex state correctly without forcing Copilot setup.

**Done when:** integrations can be managed independently.

#### P5.2 — Wire setup actions per integration

**Depends on:** P2.3, P3.9

**Steps:**

1. Codex uses existing flow.
2. Copilot CLI calls its transactional setup.
3. VS Code integration installs/configures the extension path chosen in P3.9.
4. Report reload/restart requirements explicitly.

**Validation:** enabling one integration does not modify another integration's external config.

**Done when:** all supported integrations can be enabled from the launcher.

#### P5.3 — Wire status/preflight cards

**Depends on:** P2.4, P3.8

**Steps:**

1. Client detected/version.
2. Config/provider registered.
3. Local daemon reachable.
4. Model available.
5. Tool bridge ready when applicable.
6. Reload/restart needed.

**Validation:** status matches deliberate healthy/broken states.

**Done when:** launcher status is enough for first-line troubleshooting.

#### P5.4 — Wire repair/remove lifecycle

**Depends on:** P2.8, P3.9

**Steps:**

1. Repair only project-owned state.
2. Remove one integration independently.
3. Preserve shared ChatGPT runtime/profile if another integration remains enabled.
4. Preserve unrelated external client settings.

**Validation:** mixed enabled/disabled combinations survive repair/remove correctly.

**Done when:** integration lifecycle has no destructive cross-client side effect.

### Phase 6 — Documentation, compatibility, and release

#### P6.1 — Update product README/setup docs

**Depends on:** P2/P3 supported MVPs

**Steps:**

1. Describe supported clients and exact supported versions.
2. Add setup commands/UI path for each client.
3. State unsupported Copilot modes/features explicitly.
4. Keep ChatGPT Web login/profile explanation shared.

**Validation:** a clean user can set up each supported client using docs only.

**Done when:** README no longer implies Codex is the only client.

#### P6.2 — Update architecture and security docs

**Depends on:** P4 complete or explicitly unnecessary

**Steps:**

1. Document shared runtime + thin client integration boundary.
2. Document actual client/session/turn authority implemented.
3. Document approval ownership.
4. Document credential boundaries and local loopback transport.

**Validation:** docs match code paths and capability matrix; remove speculative diagrams/abstractions that were not implemented.

**Done when:** architecture describes shipped behavior only.

#### P6.3 — Add troubleshooting matrix

**Depends on:** P2.4, P3.8, P5.3

**Steps:**

1. Client missing/incompatible.
2. Local bridge unreachable.
3. ChatGPT signed out.
4. Model unavailable.
5. MCP/tool bridge unavailable.
6. VS Code reload needed.
7. Config drift/repair.

**Validation:** each documented case points to a status signal and concrete recovery action.

**Done when:** common failures do not require source-code knowledge.

#### P6.4 — Run cross-client regression matrix

**Depends on:** P2.9, P3.10, P4.5

**Steps:**

1. Existing Codex smoke/verify.
2. Copilot CLI smoke on supported platforms.
3. VS Code smoke on supported platforms.
4. Run text, streaming, multi-turn, context, cancellation, tools where supported.
5. Run at least one simultaneous-client isolation check.

**Artifact:** release checklist/result under existing release-doc convention.

**Validation:** every `Supported` capability from P0.15 has release evidence.

**Done when:** no known regression exists against current Codex behavior.

#### P6.5 — Verify upgrade and uninstall compatibility

**Depends on:** P5.4

**Steps:**

1. Upgrade an existing Codex-only installation.
2. Enable one Copilot integration.
3. Upgrade again without reconfiguration where possible.
4. Remove Copilot while retaining Codex.
5. Remove Codex while retaining Copilot if the launcher supports that mode.

**Validation:** shared profile/runtime state remains usable and unrelated client config is preserved.

**Done when:** existing users can adopt Copilot incrementally.

#### P6.6 — Release gate

**Depends on:** P6.1–P6.5

**Steps:**

1. Freeze supported client/version matrix.
2. Confirm no GitHub credentials are stored by this project.
3. Confirm fixtures/logs contain no secrets.
4. Confirm public API usage only.
5. Confirm known limitations are published.

**Validation:** Section 12 Definition of Done can be checked item by item with evidence.

**Done when:** release candidate satisfies the documented support scope.

## 15. Dependency / execution order

The critical path is:

```text
P0.1
 ├─> P0.2 -> P0.3 -> P0.4/P0.5/P0.6/P0.7 -> P0.8 ─┐
 └─> P0.9 -> P0.10 -> P0.11/P0.12/P0.13 -> P0.14 ─┤
                                                     v
                                                  P0.15
                                                     v
                                                  P0.16
                                                     v
                                        P1.1 -> P1.2/P1.4 -> P1.5
                                                     |
                              +----------------------+----------------------+
                              v                                             v
                         P2 Copilot CLI                                P3 VS Code
                              +----------------------+----------------------+
                                                     v
                                          P4 only where required
                                                     v
                                                   P5
                                                     v
                                                   P6
```

P0 CLI and VS Code research branches can run in parallel after P0.1. P2 and P3 can also progress in parallel once P1 exposes the proven shared seam. P4 should start only for tool-routing differences actually demonstrated by P0/P2/P3.

## 16. First implementation batch

Start with these tasks only:

- `P0.1` inventory installed clients and versions.
- `P0.2` verify documented Copilot CLI extension/provider mechanisms.
- `P0.9` verify documented VS Code/Copilot Chat APIs.
- Then execute the smallest disposable spikes `P0.3` and `P0.10`.

Do not refactor production runtime before `P0.16`. The research gate is intentionally cheap: if Copilot exposes a compatible provider protocol, most of the proposed adapter architecture can be deleted and the existing Responses path reused.

