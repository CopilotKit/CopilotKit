import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { WebSocket } from "ws";

/** Exercise the shipped frontend state pipeline without mocking fetch or Phoenix. */
async function openCore(runtimeUrl, platform) {
  const { CopilotKitCore } = await import("@copilotkit/core");
  const core = new CopilotKitCore({
    runtimeUrl,
    runtimeTransport: "rest",
    deferInitialConnection: true,
    headers: { "x-test-user-id": "test-user", "x-test-user-name": "Test User" },
  });
  core.connect();
  try {
    await platform.waitFor(() => core.getAgent("default"), 5000);
    return core;
  } catch (error) {
    core.setRuntimeUrl(undefined);
    throw error;
  }
}

/** Keep failures bounded while retaining the actual client promise's rejection. */
async function bounded(promise) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(
          () =>
            reject(
              new Error("Real frontend client did not finish in 8 seconds"),
            ),
          8000,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export const clientCases = [
  {
    id: "client.public-core-run-and-history-replay",
    async run({ runtimeUrl, platform }) {
      const originalWebSocket = globalThis.WebSocket;
      const originalWindow = globalThis.window;
      globalThis.WebSocket = WebSocket;
      // Core intentionally skips browser startup during SSR. Supply only that
      // environment marker; fetch, Phoenix, reducers, and sockets remain real.
      globalThis.window = { location: new URL(runtimeUrl), WebSocket };
      const cores = [];
      const agents = [];
      try {
        const core = await openCore(runtimeUrl, platform);
        cores.push(core);
        const agent = core.getAgent("default");
        agents.push(agent);
        const threadId = randomUUID();
        const runId = randomUUID();
        agent.threadId = threadId;
        agent.addMessage({ id: randomUUID(), role: "user", content: "hello" });

        await bounded(core.runAgent({ agent, runId }));

        assert.ok(
          agent.messages.some(
            (message) =>
              message.role === "assistant" &&
              message.content === "Hello from AIMock.",
          ),
          "Actual frontend reducer must receive the generated assistant text",
        );
        assert.equal(agent.isRunning, false);
        assert.equal(platform.agentInputs.length, 1);
        await platform.waitFor(() => !platform.locks.has(threadId));

        const restoredCore = await openCore(runtimeUrl, platform);
        cores.push(restoredCore);
        const restored = restoredCore.getAgent("default");
        agents.push(restored);
        restored.threadId = threadId;

        await bounded(restoredCore.connectAgent({ agent: restored }));

        assert.ok(
          restored.messages.some(
            (message) =>
              message.role === "assistant" &&
              message.content === "Hello from AIMock.",
          ),
          "Fresh frontend must reconstruct the existing answer through Phoenix replay",
        );
        assert.equal(
          platform.agentInputs.length,
          1,
          "Connect must not execute the agent again",
        );
        assert.ok(
          platform.requests.some(
            (request) =>
              request.method === "POST" &&
              request.path === `/api/threads/${threadId}/connect`,
          ),
        );
      } finally {
        try {
          await Promise.all(agents.map((agent) => agent.detachActiveRun()));
          for (const core of cores) core.setRuntimeUrl(undefined);
        } finally {
          globalThis.WebSocket = originalWebSocket;
          if (originalWindow === undefined) delete globalThis.window;
          else globalThis.window = originalWindow;
        }
      }
    },
  },
];
