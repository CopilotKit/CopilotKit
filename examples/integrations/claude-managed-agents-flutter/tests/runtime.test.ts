import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { once } from "node:events";
import test from "node:test";

async function openPort(): Promise<number> {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert(address && typeof address !== "string");
  server.close();
  return address.port;
}

test("the Flutter runtime streams an AG-UI reply from an agent", async () => {
  const mock = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const input = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    const events = [
      { type: "RUN_STARTED", threadId: input.threadId, runId: input.runId },
      { type: "TEXT_MESSAGE_START", messageId: "reply", role: "assistant" },
      {
        type: "TEXT_MESSAGE_CONTENT",
        messageId: "reply",
        delta: "Hello from Claude.",
      },
      { type: "TEXT_MESSAGE_END", messageId: "reply" },
      { type: "RUN_FINISHED", threadId: input.threadId, runId: input.runId },
    ];
    response.writeHead(200, { "content-type": "text/event-stream" });
    response.end(
      events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(""),
    );
  });
  mock.listen(0, "127.0.0.1");
  await once(mock, "listening");
  const address = mock.address();
  assert(address && typeof address !== "string");
  const port = await openPort();
  const child = spawn(
    process.execPath,
    ["--import", "tsx", "server/index.ts"],
    {
      env: {
        ...process.env,
        AGENT_URL: `http://127.0.0.1:${address.port}`,
        RUNTIME_PORT: String(port),
        RUNTIME_HOST: "127.0.0.1",
      },
      stdio: "pipe",
    },
  );

  try {
    const info = `http://127.0.0.1:${port}/api/copilotkit/info`;
    let ready = false;
    for (let attempt = 0; attempt < 50; attempt++) {
      try {
        const response = await fetch(info);
        ready = response.ok;
        if (ready) break;
      } catch {
        /* The server is starting. */
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert(ready, "the runtime did not start");
    const response = await fetch(
      `http://127.0.0.1:${port}/api/copilotkit/agent/default/run`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          threadId: "thread-1",
          runId: "run-1",
          messages: [{ id: "user-1", role: "user", content: "Hello" }],
          tools: [],
          context: [],
          state: null,
        }),
      },
    );
    assert.equal(response.status, 200);
    assert.match(await response.text(), /Hello from Claude\./);
  } finally {
    child.kill("SIGTERM");
    mock.close();
  }
});
