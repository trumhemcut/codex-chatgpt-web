const vscode = require("vscode");
const fs = require("fs");
const path = require("path");

const logPath = path.join(__dirname, "evidence.jsonl");
function record(type, data = {}) {
  fs.appendFileSync(logPath, JSON.stringify({ at: new Date().toISOString(), type, ...data }) + "\n");
}

function activate(context) {
  const provider = {
    provideLanguageModelChatInformation() {
      return [{
        id: "fixed",
        name: "ChatGPT Web Spike",
        family: "chatgpt-web-spike",
        version: "0.0.2",
        maxInputTokens: 128000,
        maxOutputTokens: 4096,
        capabilities: { toolCalling: true, imageInput: true },
      }];
    },
    async provideLanguageModelChatResponse(_model, messages, options, progress, token) {
      record("request", {
        messages: messages.map((m) => ({ role: m.role, name: m.name, content: m.content.map((p) => p.constructor?.name || typeof p) })),
        toolNames: (options.tools || []).map((t) => t.name),
        toolMode: options.toolMode,
      });
      const subscription = token.onCancellationRequested(() => record("cancelled"));
      try {
        progress.report(new vscode.LanguageModelTextPart("STREAM_A\n\n"));
        await delay(150, token);
        progress.report(new vscode.LanguageModelTextPart("```txt\nSTREAM_B\n```\n"));
        await delay(150, token);
        const response = await fetch("http://127.0.0.1:17842/respond", { signal: cancellationSignal(token) });
        if (!response.ok) throw new Error(`Spike endpoint returned HTTP ${response.status}`);
        progress.report(new vscode.LanguageModelTextPart(await response.text()));
        record("completed");
      } catch (error) {
        record("error", { message: String(error?.message || error) });
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
  context.subscriptions.push(vscode.lm.registerLanguageModelChatProvider("chatgpt-web-spike", provider));
}

function delay(ms, token) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    const sub = token.onCancellationRequested(() => {
      clearTimeout(timer);
      sub.dispose();
      reject(new vscode.CancellationError());
    });
  });
}

function cancellationSignal(token) {
  const controller = new AbortController();
  token.onCancellationRequested(() => controller.abort());
  return controller.signal;
}

module.exports = { activate };
