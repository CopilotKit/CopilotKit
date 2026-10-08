import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const mastraProfiles = Object.freeze({
  rich: { agent: "beautifulChatAgent", resourceId: "mastra-beautiful-chat" },
  reasoning: { agent: "reasoningAgent" },
  state: { agent: "beautifulChatAgent", resourceId: "mastra-beautiful-chat" },
  media: { agent: "multimodalAgent" },
  "native-suspend": { agent: "interruptAgent" },
  "native-approval": { agent: "weatherAgent", requireToolApproval: true },
});

/** Preserve the registered Showcase Agent, tools, model and Memory. The sole
 * approval-fixture variation uses Mastra's public stream option. Binding other
 * methods to the real instance preserves private fields and storage registration.
 */
export function withToolApproval(agent) {
  return new Proxy(agent, {
    get(target, key) {
      const value = Reflect.get(target, key, target);
      if (key === "stream")
        return (messages, options) =>
          value.call(target, messages, {
            ...options,
            requireToolApproval: true,
          });
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

export function createMastraBackend({
  mastra,
  MastraAgent,
  RunAgentInputSchema,
}) {
  const adapters = new Map(
    Object.entries(mastraProfiles).map(([name, profile]) => {
      const agent = mastra.getAgent(profile.agent);
      assert.ok(agent, `Showcase agent ${profile.agent} missing`);
      return [
        name,
        new MastraAgent({
          agent: profile.requireToolApproval ? withToolApproval(agent) : agent,
          resourceId: profile.resourceId ?? `mastra-${profile.agent}`,
        }),
      ];
    }),
  );
  return createServer(async (request, response) => {
    if (request.method === "GET" && request.url === "/health") {
      response.writeHead(200).end("ready");
      return;
    }
    const adapter = adapters.get(
      new URL(request.url, "http://owned-native").pathname.slice(1),
    );
    if (request.method !== "POST" || !adapter) {
      response.writeHead(404).end();
      return;
    }
    let subscription;
    try {
      const chunks = [];
      let size = 0;
      for await (const chunk of request) {
        size += chunk.length;
        assert.ok(size <= 32 * 1024 * 1024, "Native request exceeds 32MiB");
        chunks.push(chunk);
      }
      const input = RunAgentInputSchema.parse(
        JSON.parse(Buffer.concat(chunks).toString("utf8")),
      );
      response.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
      });
      response.on("close", () => subscription?.unsubscribe());
      subscription = adapter.run(input).subscribe({
        next: (event) => response.write(`data: ${JSON.stringify(event)}\n\n`),
        error: (error) => {
          response.write(
            `data: ${JSON.stringify({ type: "RUN_ERROR", message: error.message })}\n\n`,
          );
          response.end();
        },
        complete: () => response.end(),
      });
    } catch (error) {
      if (!response.headersSent)
        response.writeHead(400, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: error.message }));
    }
  });
}

/** Execute with tsx and the actual integration tsconfig; no copied fixture agent.
 * Source path is part of the lifecycle's recorded, installable image manifest.
 */
async function main() {
  for (const name of [
    "MASTRA_WORKING_MEMORY_URL",
    "MASTRA_WORKFLOW_STORAGE_URL",
  ])
    assert.ok(
      process.env[name] && !process.env[name].includes(":memory:"),
      `${name} must identify an owned durable store`,
    );
  const source = resolve(
    process.env.RICH_THREADS_MASTRA_SOURCE ??
      "showcase/integrations/mastra/src/mastra/index.ts",
  );
  const requireSource = createRequire(source);
  const adapterEntry = requireSource.resolve("@ag-ui/mastra");
  const requireAdapter = createRequire(adapterEntry);
  const [{ mastra }, { MastraAgent }, { RunAgentInputSchema }] =
    await Promise.all([
      import(pathToFileURL(source)),
      import(pathToFileURL(adapterEntry)),
      import(pathToFileURL(requireAdapter.resolve("@ag-ui/core"))),
    ]);
  const server = createMastraBackend({
    mastra,
    MastraAgent,
    RunAgentInputSchema,
  });
  const port = Number(process.env.PORT ?? 4111);
  assert.ok(
    Number.isSafeInteger(port) && port > 0 && port <= 65535,
    "Valid owned backend PORT required",
  );
  server.listen(port, "0.0.0.0");
  for (const signal of ["SIGINT", "SIGTERM"])
    process.once(signal, () => server.close(() => process.exit(0)));
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
)
  await main();
