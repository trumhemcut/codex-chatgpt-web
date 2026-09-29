Bun.serve({
  hostname: "127.0.0.1",
  port: 17842,
  fetch(req) {
    if (new URL(req.url).pathname !== "/respond") return new Response("not found", { status: 404 });
    return new Response("VSCODE_COPILOT_SPIKE_OK", { headers: { "content-type": "text/plain" } });
  },
});
console.log("VS Code spike endpoint: http://127.0.0.1:17842/respond");
