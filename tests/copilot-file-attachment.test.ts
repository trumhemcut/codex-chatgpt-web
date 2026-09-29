import { expect, test } from "bun:test";
import { parseRequest } from "../src/responses/parser";
import { compileChatGptWebPrompt } from "../src/adapters/chatgpt-web/prompt";
import { chatGptPromptFilePayloads } from "../src/adapters/chatgpt-web/browser-worker";
import { CHATGPT_WEB_MODEL_ID } from "../src/adapters/chatgpt-web/model";

test("inline Responses input_file survives into the existing ChatGPT attachment transport", () => {
  const parsed = parseRequest({
    model: CHATGPT_WEB_MODEL_ID,
    input: [{
      role: "user",
      content: [
        { type: "input_text", text: "Read this document" },
        { type: "input_file", filename: "sample.docx", file_data: "data:application/vnd.openxmlformats-officedocument.wordprocessingml.document;base64,UEsDBA==" },
      ],
    }],
  });
  const compiled = compileChatGptWebPrompt(parsed, {
    localToolsEnabled: false,
    solAvailable: true,
    extraHighAvailable: true,
    proAvailable: true,
  });
  const files = chatGptPromptFilePayloads(compiled);
  expect(compiled.text).toContain('"type":"file_attachment"');
  expect(files.map(file => file.name)).toContain("sample.docx");
  expect(files.find(file => file.name === "sample.docx")?.buffer.length).toBeGreaterThan(0);
});
