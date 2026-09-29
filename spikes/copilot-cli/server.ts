import { writeFileSync } from "node:fs";

const out = new URL("./request.json", import.meta.url);
const headersOut = new URL("./headers.json", import.meta.url);

const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname !== "/v1/responses" || request.method !== "POST") {
      return new Response("Not found", { status: 404 });
    }

    writeFileSync(out, `${JSON.stringify(await request.json(), null, 2)}\n`);
    writeFileSync(headersOut, `${JSON.stringify(Object.fromEntries(request.headers), null, 2)}\n`);

    const responseId = "resp_copilot_spike";
    const itemId = "msg_copilot_spike";
    const events = [
      { type: "response.created", response: { id: responseId, object: "response", status: "in_progress", model: "gpt-5.6-sol", output: [] } },
      { type: "response.output_item.added", output_index: 0, item: { id: itemId, type: "message", role: "assistant", status: "in_progress", content: [] } },
      { type: "response.content_part.added", item_id: itemId, output_index: 0, content_index: 0, part: { type: "output_text", text: "", annotations: [] } },
      { type: "response.output_text.delta", item_id: itemId, output_index: 0, content_index: 0, delta: "COPILOT_" },
      { type: "response.output_text.delta", item_id: itemId, output_index: 0, content_index: 0, delta: "SPIKE_OK" },
      { type: "response.output_text.done", item_id: itemId, output_index: 0, content_index: 0, text: "COPILOT_SPIKE_OK" },
      { type: "response.content_part.done", item_id: itemId, output_index: 0, content_index: 0, part: { type: "output_text", text: "COPILOT_SPIKE_OK", annotations: [] } },
      { type: "response.output_item.done", output_index: 0, item: { id: itemId, type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text: "COPILOT_SPIKE_OK", annotations: [] }] } },
      { type: "response.completed", response: { id: responseId, object: "response", status: "completed", model: "gpt-5.6-sol", output: [{ id: itemId, type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text: "COPILOT_SPIKE_OK", annotations: [] }] }], usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } } },
    ];

    return new Response(events.map(event => `data: ${JSON.stringify(event)}\n\n`).join("") + "data: [DONE]\n\n", {
      headers: { "content-type": "text/event-stream", "cache-control": "no-cache" },
    });
  },
});

console.log(server.port);
await new Promise(() => {});


