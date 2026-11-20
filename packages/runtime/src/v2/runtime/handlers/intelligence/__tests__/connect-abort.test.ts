import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import type { CopilotIntelligenceRuntimeLike } from "../../../core/runtime";
import { CopilotKitIntelligence } from "../../../intelligence-platform/client";
import { handleIntelligenceConnect } from "../connect";

type Mode = "complete" | "headers" | "body";
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

async function fixture(mode: Mode) {
  let entered!: () => void;
  let disconnected!: () => void;
  let release: (() => void) | undefined;
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const closed = new Promise<void>((resolve) => {
    disconnected = resolve;
  });
  const requests: { path?: string; method?: string; body: unknown }[] = [];
  const connection = {
    threadId: "thread-1",
    runId: "run-1",
    joinToken: "fixture-token",
  };
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    requests.push({
      path: request.url,
      method: request.method,
      body: JSON.parse(Buffer.concat(chunks).toString()),
    });
    response.on("close", disconnected);
    const json = JSON.stringify(connection);
    if (mode === "body") {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.write(json.slice(0, 1));
    }
    release = () => {
      if (response.destroyed) return;
      if (mode !== "body")
        response.setHeader("Content-Type", "application/json");
      response.end(mode === "body" ? json.slice(1) : json);
    };
    entered();
    if (mode === "complete") release();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  cleanups.push(async () => {
    release?.();
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  });
  const port = (server.address() as AddressInfo).port;
  const runtime = {
    mode: "intelligence",
    intelligence: new CopilotKitIntelligence({
      apiKey: "fixture-key",
      apiUrl: `http://127.0.0.1:${port}`,
    }),
    identifyUser: async () => ({ id: "user-1", name: "Test User" }),
  } as unknown as CopilotIntelligenceRuntimeLike;
  const controller = new AbortController();
  const request = new Request("https://runtime.example/agent/agent-1/connect", {
    signal: controller.signal,
  });
  return {
    requests,
    controller,
    started,
    read: () =>
      handleIntelligenceConnect({
        runtime,
        request,
        agentId: "agent-1",
        threadId: "thread-1",
      }),
    release: () => release?.(),
    async wasDisconnected() {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        return await Promise.race([
          closed.then(() => true),
          new Promise<false>((resolve) => {
            timer = setTimeout(() => resolve(false), 1000);
          }),
        ]);
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

describe("Intelligence connect HTTP cancellation", () => {
  it("preserves the original scoped metadata read without aborting", async () => {
    const f = await fixture("complete");
    const response = await f.read();
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      threadId: "thread-1",
      runId: "run-1",
      joinToken: "fixture-token",
    });
    expect(f.requests).toEqual([
      {
        path: "/api/threads/thread-1/connect",
        method: "POST",
        body: { userId: "user-1", agentId: "agent-1" },
      },
    ]);
  });

  it("does not dispatch a metadata request after the caller already aborted", async () => {
    const f = await fixture("complete");
    f.controller.abort();
    const response = await f.read();
    expect(response.ok).toBe(false);
    expect(f.requests).toHaveLength(0);
  });

  for (const mode of ["headers", "body"] as const) {
    it(`closes the actual HTTP connection when aborted while waiting for ${mode}`, async () => {
      const f = await fixture(mode);
      const pending = f.read();
      await f.started;
      f.controller.abort();
      // Capture this before releasing the fixture: ordinary response completion
      // must not count as proof that the caller canceled the HTTP request.
      const disconnectedBeforeRelease = await f.wasDisconnected();
      f.release();
      const response = await pending;
      expect(disconnectedBeforeRelease).toBe(true);
      expect(response.ok).toBe(false);
      expect(response.status).not.toBe(204);
      expect(f.requests).toHaveLength(1);
    });
  }
});
