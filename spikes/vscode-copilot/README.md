# P0.10 disposable VS Code provider spike

1. Start the fixed-response endpoint: `bun run spikes/vscode-copilot/server.ts`.
2. Launch an Extension Development Host: `code --extensionDevelopmentPath=<repo>\\spikes\\vscode-copilot`.
3. Open Chat, choose **ChatGPT Web Spike / ChatGPT Web Spike** in the model picker, and send any prompt.
4. Expected response: `VSCODE_COPILOT_SPIKE_OK`.

The spike uses only the stable `languageModelChatProviders` contribution and `vscode.lm.registerLanguageModelChatProvider` API. It intentionally has no build step or dependencies.
