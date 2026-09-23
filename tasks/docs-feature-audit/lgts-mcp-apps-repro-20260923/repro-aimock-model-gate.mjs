// Shows the real aimock 1.37.4 server, in strict mode, loaded with the LGTS
// fixture files, starting the create_view stream role-less for gpt-5-mini
// (reasoning emitted) but role-first for gpt-4o-mini (reasoning suppressed).
// usage: node repro-aimock-model-gate.mjs <worktree-root>
import path from "node:path";

const root = process.argv[2];
const aimock = await import(
  path.join(
    root,
    "showcase/scripts/node_modules/@copilotkit/aimock/dist/index.js",
  )
);
const dir = path.join(root, "showcase/aimock/d6/langgraph-typescript");
const fixtures = [
  ...aimock.loadFixtureFile(
    path.join(dir, "tool-rendering-reasoning-chain.json"),
  ),
  ...aimock.loadFixtureFile(path.join(dir, "mcp-apps.json")),
];
const server = await aimock.createServer(fixtures, {
  port: 0,
  host: "127.0.0.1",
  strict: true,
  logLevel: "silent",
  chunkSize: 8,
});
for (const model of ["gpt-5-mini", "gpt-4o-mini"]) {
  const res = await fetch(`${server.url}/v1/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-aimock-context": "langgraph-typescript",
    },
    body: JSON.stringify({
      model,
      stream: true,
      messages: [
        {
          role: "user",
          content:
            "Open Excalidraw and sketch a system diagram with a client, server, and database.",
        },
      ],
      tools: [
        {
          type: "function",
          function: {
            name: "create_view",
            parameters: { type: "object", properties: {} },
          },
        },
      ],
    }),
  });
  const events = (await res.text())
    .split("\n")
    .filter((l) => l.startsWith("data: {"))
    .map((l) => JSON.parse(l.slice(6)));
  const firstRole = events.findIndex((e) => e.choices?.[0]?.delta?.role);
  console.log(
    JSON.stringify({
      model,
      status: res.status,
      firstDelta: events[0]?.choices?.[0]?.delta,
      reasoningDeltasBeforeRole: firstRole,
      toolCallNames: events
        .flatMap((e) => e.choices?.[0]?.delta?.tool_calls ?? [])
        .map((t) => t.function?.name)
        .filter(Boolean),
    }),
  );
}
await new Promise((r) =>
  server.server ? server.server.close(r) : server.close ? server.close(r) : r(),
);
process.exit(0);
