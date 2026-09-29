# ChatGPT Web VS Code integration

Supported baseline: VS Code 1.139.1 with GitHub Copilot 0.67.0.

This extension uses the stable `languageModelChatProviders` API and forwards provider requests to `http://127.0.0.1:17841/copilot/v1/responses` — the same client-owns-tools bridge GitHub Copilot CLI's BYOK mode uses, since VS Code/Copilot owns conversation history, tool invocation, MCP, and approval UI itself. Requires the `vscodeCopilot` (or `copilotCli`) integration enabled in `codex-chatgpt-web`'s config; see `bun run src/cli.ts integrations setup vscode-copilot`. The extension only forwards messages/tools, streams model output, and maps cancellation to the HTTP request.

Install for local validation:

```powershell
code --install-extension .\integrations\vscode-copilot
```

For development, use `code --extensionDevelopmentPath=<repo>\integrations\vscode-copilot`.

Known limitation: image delivery through the provider route is not live-proven, so the production provider declares `imageInput: false`.
