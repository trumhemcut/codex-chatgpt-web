# GitHub Copilot CLI Protocol Research

Captured: 2026-09-29. Tested CLI: `1.0.79-9` on Windows.

## P0.2 - Official integration mechanisms

Copilot CLI exposes a documented **Custom Model Providers (BYOK)** route. Setting `COPILOT_PROVIDER_BASE_URL` switches inference to a custom provider; GitHub authentication is not required in this mode.

For this project the relevant supported settings are:

- `COPILOT_PROVIDER_BASE_URL`: provider base URL; activates BYOK.
- `COPILOT_PROVIDER_TYPE=openai`: OpenAI-compatible provider mode.
- `COPILOT_PROVIDER_WIRE_API=responses`: use the OpenAI Responses wire API. `completions` is the default alternative.
- `COPILOT_PROVIDER_TRANSPORT=http`: default transport; Responses can optionally use `websockets`.
- `COPILOT_PROVIDER_API_KEY` or `COPILOT_PROVIDER_BEARER_TOKEN`: optional provider credentials. Bearer token wins when both are set.
- `COPILOT_PROVIDER_HEADERS`: provider-only custom headers.
- `COPILOT_MODEL`: simple model selection; sets internal model ID and wire model.
- `COPILOT_PROVIDER_MODEL_ID`: well-known model identity used for agent configuration/token limits.
- `COPILOT_PROVIDER_WIRE_MODEL`: model string sent to the provider, allowing the bridge model slug to differ from Copilot's internal model identity.
- `COPILOT_PROVIDER_MAX_PROMPT_TOKENS` / `COPILOT_PROVIDER_MAX_OUTPUT_TOKENS`: explicit token limits.

### Model discovery

The documented BYOK mechanism requires a model to be supplied through `COPILOT_MODEL`, `COPILOT_PROVIDER_MODEL_ID`, or `--model`. The provider help does not document dynamic model discovery from the custom endpoint. A recognized `COPILOT_PROVIDER_MODEL_ID` enables Copilot's built-in model-specific configuration; unknown IDs fall back to safe defaults.

For the spike, use a known Copilot model ID for agent behavior and a separate wire model matching this bridge's model slug.

### MCP and tool ownership

Copilot CLI natively owns tools and approvals. `copilot help permissions` documents availability filters plus allow/deny approval rules for shell, writes, MCP tools, and URLs. Deny rules take precedence. MCP servers are supported through user `~/.copilot/mcp-config.json`, workspace `.mcp.json` / `.github/mcp.json`, installed plugins, and `--additional-mcp-config`.

This supports the plan's preferred ownership model: keep tool execution and approval in Copilot CLI when the Responses tool-call protocol permits it.

### Supported route selected for P0.3

Use the public BYOK route:

```text
Copilot CLI -> OpenAI Responses API over HTTP -> local disposable endpoint
```

The experiment will set provider environment variables only for the spawned process, so it does not modify persistent Copilot configuration.

### Mechanisms intentionally excluded

- No Copilot binary patching.
- No interception of GitHub/Copilot private traffic.
- No private/internal API dependency.
- No copied GitHub credentials.
- No production runtime refactor before the disposable provider spike proves request compatibility.

### P0.2 decision

**Provider route is supported.** Copilot CLI has a documented OpenAI-compatible BYOK provider and explicitly supports the Responses wire API. P0.3 can proceed directly against a disposable local endpoint.

## P0.3 - Disposable provider spike

Artifact: `spikes/copilot-cli/server.ts`.

The spike starts a loopback-only Bun server on an ephemeral port and implements only `POST /v1/responses`. It captures the incoming JSON to `spikes/copilot-cli/request.json` and returns a minimal streamed Responses API sequence containing `COPILOT_SPIKE_OK`.

Copilot CLI was launched with process-local environment variables only:

```text
COPILOT_PROVIDER_BASE_URL=http://127.0.0.1:<ephemeral>/v1
COPILOT_PROVIDER_TYPE=openai
COPILOT_PROVIDER_WIRE_API=responses
COPILOT_PROVIDER_TRANSPORT=http
COPILOT_PROVIDER_MODEL_ID=gpt-5.4
COPILOT_PROVIDER_WIRE_MODEL=gpt-5.6-sol
```

Command behavior was validated with a non-interactive prompt. The CLI printed:

```text
COPILOT_SPIKE_OK
```

Captured request evidence:

- Method/path: `POST /v1/responses`.
- `model`: `gpt-5.6-sol`.
- `stream`: `true`.
- `input`: one user message for the test prompt.
- `tools`: 60 tool definitions were present in the request, even with the experiment's empty `--available-tools=` argument. Tool availability/approval semantics therefore need explicit P0.6 validation rather than assuming an empty CLI filter removes tool schemas from the wire request.
- The request includes Copilot's generated `instructions` plus environment/session context around the user prompt.

No persistent Copilot configuration or credentials were changed. The disposable server process was stopped after the experiment.

### P0.3 decision

**Provider-route feasibility is proven.** Copilot CLI 1.0.79-9 can call a local OpenAI-compatible Responses endpoint over HTTP and consume a valid streamed response. The production runtime should not gain a Copilot-specific transport adapter unless later fixtures prove a semantic incompatibility.

## P0.4 - Text and streaming protocol fixtures

Sanitized fixtures are stored under `test/fixtures/copilot-cli/`: `request-text.json`, `request-headers.json`, and `response-stream.sse`.

Observed on Copilot CLI 1.0.79-9: `POST /v1/responses` with JSON, `stream=true`, `store=false`, and `parallel_tool_calls=true`. The provider wire model is sent in `model`. The client sent `Accept: application/json`, `Content-Type: application/json`, `User-Agent: OpenAI/JS 5.20.1`, `x-initiator: user`, and `x-interaction-type: conversation-user`. With no provider credential configured, the captured authorization value was an empty bearer value; the fixture records it as `Bearer [redacted-or-empty]`, and the local spike requires no authentication.

The SSE fixture contains two `response.output_text.delta` chunks, terminal text/content/item events, `response.completed`, and `[DONE]`. Generated Copilot instructions, environment/session context, local paths, session IDs, prompt-cache identifiers, credentials, repository content, and the full tool catalog are excluded from the sanitized fixtures; context and tool semantics are covered by P0.5/P0.6.

Replay validation: posting `request-text.json` to the disposable spike returned HTTP 200 with exactly two text delta events, a `response.completed` event, and `[DONE]`.

### P0.4 decision

**Text + streaming protocol is captured without guessing.** The sanitized fixtures are secret-free and replay successfully against the local spike.

## P0.5 - Context and attachment semantics

Copilot CLI 1.0.79-9 exposes `--attachment <path>` only in non-interactive mode and documents it for images or native documents. Plain text files such as `.txt` and `.md` are rejected by the CLI with `--attachment file type not supported (must be an image or native document)`.

Captured native-document example: attaching `context.docx` produced a single user message whose content contained the normal prompt text, an `input_text` item naming the document path, and a structured `input_file` item with `filename: "context.docx"`, `file_id: null`, and `file_data` as an inline `data:application/vnd.openxmlformats-officedocument.wordprocessingml.document;base64,...` URL. The bridge therefore needs to accept Responses API `input_file` parts and preserve the embedded data payload; no separate file fetch is required on this route.

Captured image example: attaching a PNG produced the normal prompt text, an `input_text` item naming the image path, and a structured `input_image` item with `detail: "auto"` and `image_url` as an inline `data:image/png;base64,...` URL. The bridge therefore needs to accept Responses API `input_image` parts and forward/decode the data URL as appropriate for the ChatGPT Web adapter.

The CLI also injects attachment-specific reminder text into the prompt. Local attachment paths are present in generated `input_text` content, so production logging/fixtures must sanitize user paths. No public help text observed in this version exposes a byte-size limit; only the surface restriction to image/native-document attachment types is visible. Multiple attachments are supported by repeating `--attachment`.

Repository/file context that is not supplied via `--attachment` remains a separate concern: Copilot includes cwd/repository metadata in generated instructions/environment context and can access repository files through its native tools. P0.6 will validate tool ownership and round trips; P0.5 does not require a second transport for repository context.

### P0.5 decision

**Production mapping is known for supported attachments.** Images arrive as structured `input_image` parts with inline data URLs; native documents arrive as structured `input_file` parts with inline base64 data URLs. Plain `.txt`/`.md` files are not accepted by `--attachment` in the tested CLI version, so ordinary source/text repository context should continue through Copilot's native workspace/tool context rather than being modeled as an attachment.

## P0.6 - Tools and MCP behavior

Copilot CLI 1.0.79-9 sends local and MCP capabilities to the provider as standard Responses API function tools. A captured local `powershell` tool used `type: "function"`, `name`, `description`, JSON-schema `parameters`, and `strict: false`.

A two-round capture proves execution ownership. The provider returned a streamed `function_call` for `powershell` with `call_id: "call_p06_read"`. Copilot CLI executed the PowerShell command locally, then issued a second `POST /v1/responses`. That second request repeated the original user message and included both the completed `function_call` and a matching `function_call_output` item with the same `call_id`. The provider then returned the final text response. No `previous_response_id` was sent; the round is reconstructed by resending the conversation state in `input`.

Sanitized evidence is stored in `test/fixtures/copilot-cli/request-tool-roundtrip.json`.

Approval ownership also remains in Copilot CLI. `copilot help permissions` documents availability filters via `--available-tools` / `--excluded-tools`, and approval rules via `--allow-tool`, `--deny-tool`, and `--allow-all-tools`; deny rules take precedence. MCP tool permissions use `<mcp-server-name>(tool-name?)`. In non-interactive mode, write-capable operations require an allow rule such as `--allow-tool='write'` or broader explicit auto-approval; without approval, the CLI does not silently execute them.

MCP is therefore client-owned as well. The CLI accepts session-scoped servers through `--additional-mcp-config` and persistent/workspace MCP config, and MCP tool schemas flow through the same Responses `tools` array as function tools. The bridge only needs to preserve standard Responses tool definitions/calls/results and bind each tool round to the originating Copilot session/turn; it should not execute Copilot-owned tools itself.

### P0.6 decision

**Let Copilot CLI own tool/MCP execution and approval.** The provider bridge must support Responses API function tool definitions, streamed `function_call` output, and follow-up `function_call_output` input. Native CLI approval/filtering remains authoritative, including MCP-specific rules. No Copilot-specific tool executor is needed in the bridge unless a later production incompatibility is observed.

## P0.7 - Cancellation and session continuation

Copilot CLI 1.0.79-9 exposes explicit session identity independently of the provider protocol: `--session-id <uuid>` creates or resumes a session, `--resume[=<id>]` resumes by ID/prefix/name, and `--continue` resumes the most recent session. Non-interactive runs print the resumable CLI session UUID after completion or provider failure.

A two-turn capture using a fixed CLI session UUID showed that the second provider request contained prior conversation input plus the new user turn. The provider request did not contain `previous_response_id` or the CLI session UUID. A sanitized example is stored in `test/fixtures/copilot-cli/request-session-continuation.json`. Restarting the disposable provider and resuming the same CLI session still resent the prior conversation, proving continuity is persisted/owned by Copilot CLI rather than by the provider process. `prompt_cache_key` was observed but is not a stable session identifier and changed across the provider-restart experiment, so the bridge must not use it as session identity.

Cancellation was tested against a delayed streaming provider. After the first text delta, sending Ctrl+C to the running CLI terminated the CLI command with exit code 1 and no final response. The disposable Bun server did not receive an observable `request.signal` abort or stream `cancel()` callback before the probe ended, so HTTP-level abort propagation is not proven by this fixture. Production cancellation should therefore cancel the browser/provider work when the originating CLI connection closes, but must not depend on a Copilot-specific cancellation message that was not observed.

Provider disappearance was tested separately by stopping the local provider after its first streamed delta. Copilot printed `Response was interrupted due to a server error. Retrying...` five times, then failed with `Could not connect to local model provider ... Check that the service is running and the port is correct.` The CLI retained and printed a resumable session UUID after the failure. No silent success or stale completion was observed.

### P0.7 decision

**Session identity belongs to Copilot CLI; provider-turn identity belongs to the bridge.** The production bridge does not need to mirror the Copilot session UUID into Responses API fields. It should maintain its own opaque per-request/connection turn authority, treat each follow-up request as carrying the conversation state supplied by Copilot, cancel in-flight browser/provider work when that originating request disconnects, and reject late output after cancellation. Session resume survives provider restart because Copilot CLI persists the conversation. HTTP abort propagation from Ctrl+C was not directly observable in the local Bun probe, so implementation must not assume a specific client-side abort event beyond connection lifecycle.

## P0.8 - Final Copilot CLI integration decision

**Gate decision: proceed with the Copilot CLI provider route.** The supported and tested baseline is **GitHub Copilot CLI 1.0.79-9 on Windows**.

Use Copilot CLI's documented Custom Model Provider/BYOK mechanism with the OpenAI Responses API over HTTP. MCP is not the primary inference integration route. Copilot CLI remains responsible for tools, MCP execution, approvals, workspace context, and persistent session history. The bridge is responsible for Responses protocol handling, ChatGPT Web/browser provider execution, streaming, attachments, per-request lifecycle, and rejecting late output after cancellation.

### Supported capabilities proven by the spike

- `POST /v1/responses` over HTTP with streamed SSE responses.
- Copilot-generated instructions, messages, and full conversation state in request input.
- Text input plus inline `input_image` and `input_file` data URLs.
- Standard Responses API function-tool schemas.
- Streamed `function_call` output followed by Copilot-executed `function_call_output` input on the next request.
- Session continuation across provider restarts because Copilot CLI persists and resends conversation state.
- Separate Copilot model identity and provider wire-model strings.

### Minimum production changes implied by evidence

- Expose an OpenAI-compatible `POST /v1/responses` endpoint.
- Support the streamed Responses SSE lifecycle used by Copilot CLI.
- Accept Copilot-generated instructions, messages, and reconstructed conversation state.
- Support `input_text`, inline `input_image`, and inline `input_file` parts.
- Accept Responses function-tool schemas, emit streamed `function_call`, and accept matching `function_call_output` on follow-up requests.
- Leave Copilot-owned tool and MCP execution in Copilot CLI.
- Do not depend on `previous_response_id`; Copilot CLI resends state instead.
- Do not use `prompt_cache_key` as persistent session identity.
- Treat each HTTP request/connection as the bridge's turn authority and reject late output once that request is cancelled or disconnected.
- Cancel downstream browser/provider work when request disconnect is observable.
- Preserve the distinction between `COPILOT_PROVIDER_MODEL_ID` and `COPILOT_PROVIDER_WIRE_MODEL`.
- Sanitize credentials, local paths, generated context, prompt-cache identifiers, session identifiers, repository information, and attachment payloads from logs and fixtures.

### Known gaps and limits

- Validation is limited to GitHub Copilot CLI 1.0.79-9 on Windows.
- Dynamic model discovery from a custom provider is not documented in the tested CLI surface.
- `.txt` and `.md` files are rejected by `--attachment` in the tested version.
- Ctrl+C termination was observed, but explicit HTTP abort propagation to the provider was not directly observable in the local probe.
- Compatibility with the production ChatGPT Web/browser adapter remains to be implemented and integration-tested.

### P0.8 decision

**Copilot CLI integration gate passes on the provider route.** The next implementation work can target the standard Responses API boundary without adding a Copilot-specific MCP inference path or tool executor.
