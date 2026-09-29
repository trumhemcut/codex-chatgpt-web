import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

test("VS Code provider uses the shared Responses route and streams tool calls", () => {
  const source = readFileSync(join(import.meta.dir, "..", "integrations", "vscode-copilot", "extension.js"), "utf8");
  expect(source).toContain("/v1/responses");
  expect(source).toContain("response.output_text.delta");
  expect(source).toContain("LanguageModelToolCallPart");
  expect(source).toContain("CancellationError");
});
