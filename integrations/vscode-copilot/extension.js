const vscode = require("vscode");

// The plain /v1/responses route only grants local-tool access to a genuine
// native Codex turn (thread/turn id present); VS Code has no such identity
// and owns its own tool execution/approval, so use the client-tools route
// instead (same one GitHub Copilot CLI's BYOK bridge uses).
const DEFAULT_ENDPOINT = "http://127.0.0.1:17841/copilot/v1/responses";
// The server routes by prefix: anything without "chatgpt-web/" is forwarded
// as a raw native Codex/OpenAI model id and requires a real Bearer token
// (see isChatGptWebModelSlug in src/chatgpt-web-models.ts).
const DEFAULT_MODEL = "chatgpt-web/gpt-5.6-sol";

function activate(context) {
  const provider = {
    provideLanguageModelChatInformation() {
      return [{
        id: "chatgpt-web/gpt-5.6-sol",
        name: "ChatGPT Web GPT-5.6 Sol",
        family: "gpt-5.6-sol",
        version: "1",
        maxInputTokens: 128000,
        maxOutputTokens: 32768,
        capabilities: { toolCalling: true, imageInput: false },
      }];
    },
    async provideLanguageModelChatResponse(model, messages, options, progress, token) {
      const controller = new AbortController();
      const subscription = token.onCancellationRequested(() => controller.abort());
      try {
        const response = await fetch(DEFAULT_ENDPOINT, {
          method: "POST",
          headers: { "content-type": "application/json", accept: "text/event-stream" },
          body: JSON.stringify({
            model: model?.id || DEFAULT_MODEL,
            stream: true,
            input: messages.flatMap(toResponseItems),
            tools: (options.tools || []).map(tool => ({
              type: "function",
              name: tool.name,
              description: tool.description,
              parameters: tool.inputSchema,
            })),
          }),
          signal: controller.signal,
        });
        if (!response.ok || !response.body) {
          const detail = await response.text().catch(() => "");
          throw new Error(`ChatGPT Web bridge returned HTTP ${response.status}${detail ? `: ${detail}` : ""}`);
        }
        await readResponsesStream(response.body, event => {
          if (event.type === "response.output_text.delta" && typeof event.delta === "string") {
            progress.report(new vscode.LanguageModelTextPart(event.delta));
          } else if (event.type === "response.output_item.done" && event.item?.type === "function_call") {
            progress.report(new vscode.LanguageModelToolCallPart(
              event.item.call_id || event.item.id,
              event.item.name,
              parseArguments(event.item.arguments),
            ));
          }
        });
      } catch (error) {
        if (controller.signal.aborted) throw new vscode.CancellationError();
        if (error instanceof TypeError) {
          throw new Error("ChatGPT Web local bridge is unavailable. Start the launcher/runtime and try again.");
        }
        throw error;
      } finally {
        subscription.dispose();
      }
    },
    async provideTokenCount(_model, text) {
      const value = typeof text === "string" ? text : JSON.stringify(text);
      return Math.ceil(value.length / 4);
    },
  };
  context.subscriptions.push(vscode.lm.registerLanguageModelChatProvider("chatgpt-web", provider));
}

// One VS Code message can hold a mix of plain text and tool call/result parts.
// The Responses API needs each kind as its own top-level input item: a
// "message" item for text (content type depends on role: assistant replies
// use output_text, everything else uses input_text — mixing these fails
// server-side schema validation), plus a separate function_call /
// function_call_output item per tool part.
function toResponseItems(message) {
  const role = message.role === vscode.LanguageModelChatMessageRole.Assistant ? "assistant" : "user";
  const textType = role === "assistant" ? "output_text" : "input_text";
  const items = [];
  const textParts = [];
  for (const part of message.content) {
    if (part instanceof vscode.LanguageModelToolCallPart) {
      items.push({
        type: "function_call",
        call_id: part.callId,
        name: part.name,
        arguments: JSON.stringify(part.input ?? {}),
      });
    } else if (part instanceof vscode.LanguageModelToolResultPart) {
      items.push({ type: "function_call_output", call_id: part.callId, output: toolResultText(part.content) });
    } else if (part instanceof vscode.LanguageModelTextPart) {
      textParts.push({ type: textType, text: part.value });
    } else {
      textParts.push({ type: textType, text: String(part.value ?? part) });
    }
  }
  if (textParts.length > 0) items.push({ role, content: textParts });
  return items;
}

function toolResultText(content) {
  if (!Array.isArray(content)) return typeof content === "string" ? content : JSON.stringify(content);
  return content
    .map(part => (part instanceof vscode.LanguageModelTextPart ? part.value : JSON.stringify(part)))
    .join("\n");
}

async function readResponsesStream(stream, onEvent) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let pending = "";
  while (true) {
    const { done, value } = await reader.read();
    pending += decoder.decode(value || new Uint8Array(), { stream: !done });
    const blocks = pending.split(/\r?\n\r?\n/);
    pending = blocks.pop() || "";
    for (const block of blocks) {
      const data = block.split(/\r?\n/)
        .filter(line => line.startsWith("data:"))
        .map(line => line.slice(5).trimStart())
        .join("\n");
      if (!data || data === "[DONE]") continue;
      onEvent(JSON.parse(data));
    }
    if (done) break;
  }
}

function parseArguments(value) {
  if (typeof value !== "string" || value.length === 0) return {};
  try { return JSON.parse(value); } catch { return { raw: value }; }
}

module.exports = { activate, parseArguments, readResponsesStream, toResponseItems };
