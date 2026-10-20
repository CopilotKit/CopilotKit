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

/** Give each real-client case browser globals and bounded resource ownership. */
async function withClients(runtimeUrl, run) {
  const originalWebSocket = globalThis.WebSocket;
  const originalWindow = globalThis.window;
  globalThis.WebSocket = WebSocket;
  globalThis.window = { location: new URL(runtimeUrl), WebSocket };
  const cores = [];
  const agents = [];
  try {
    await run({ cores, agents });
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
}

export const clientCases = [
  ...["active", "network", "expired", "stale"].map((mode) => ({
    id:
      mode === "network"
        ? "client.network-reconnect-refresh-and-stop"
        : mode === "expired"
          ? "client.expired-credential-refresh-and-stop"
          : mode === "stale"
            ? "client.stale-connect-cannot-stop-replacement"
            : "client.active-reconnect-stop-and-restart",
    async run({ runtimeUrl, platform, request }) {
      await withClients(runtimeUrl, async ({ cores, agents }) => {
        platform.faults.agentKeepOpen = true;
        if (mode === "network") platform.faults.clientDisconnectAfterReplay = 1;
        if (mode === "expired") {
          platform.faults.clientRejectUnusedTokens = 1;
          platform.faults.clientTokenSequence = 0;
        }
        platform.faults.agentEvents = async function* (body) {
          yield* [
            { type: "RUN_STARTED", threadId: body.threadId, runId: body.runId },
            {
              type: "TEXT_MESSAGE_START",
              messageId: "active-answer",
              role: "assistant",
            },
            {
              type: "TEXT_MESSAGE_CONTENT",
              messageId: "active-answer",
              delta: "First. ",
            },
            {
              type: "TEXT_MESSAGE_CONTENT",
              messageId: "active-answer",
              delta: "Second.",
            },
          ];
          if (mode === "network") {
            await platform.waitFor(
              () => platform.faults.clientDisconnectAfterReplay === 0,
            );
            yield {
              type: "TEXT_MESSAGE_CONTENT",
              messageId: "active-answer",
              delta: " Recovered.",
            };
          }
        };
        const input = {
          protocolVersion: "1.0",
          threadId: "active-reconnect-thread",
          runId: "active-reconnect-run",
          messages: [
            { id: "original-question", role: "user", content: "hello" },
          ],
          tools: [],
          context: [],
          state: {},
          forwardedProps: {},
        };
        assert.equal(
          (await request("POST", "/agent/default/run", input)).status,
          200,
        );
        await platform.waitFor(() =>
          platform.events.some(
            (event) =>
              event.type === "TEXT_MESSAGE_CONTENT" &&
              event.delta === "Second.",
          ),
        );
        const core = await openCore(runtimeUrl, platform);
        cores.push(core);
        const agent = core.getAgent("default");
        agents.push(agent);
        agent.threadId = input.threadId;
        if (mode === "stale") {
          // Model a replacement run that starts after credentials were issued.
          await request("POST", "/agent/default/connect", input);
          platform.faults.http.set(
            `POST /api/threads/${input.threadId}/connect`,
            {
              once: true,
              status: 200,
              body: {
                threadId: input.threadId,
                joinToken: `connect-token-${input.threadId}`,
                runId: "retired-run",
              },
            },
          );
        }
        const connection = core.connectAgent({ agent });
        // Observe the rejection now; bounded(connection) still reports it below.
        connection.catch(() => {});
        const expectedText =
          mode === "network" ? "First. Second. Recovered." : "First. Second.";
        await platform.waitFor(
          () =>
            agent.messages.some(
              (message) =>
                message.id === "active-answer" &&
                message.content === expectedText,
            ),
          10000,
        );
        if (mode === "network") {
          await platform.waitFor(
            () =>
              platform.clientFrames.filter(
                (frame) => frame.event === "phx_join",
              ).length === 2,
            10000,
          );
          assert.equal(platform.faults.clientDisconnectAfterReplay, 0);
          assert.equal(
            platform.requests.filter(
              (entry) =>
                entry.path === `/api/threads/${input.threadId}/connect`,
            ).length,
            2,
            "A consumed token requires fresh credentials after network loss",
          );
          const reconnect = platform.clientFrames.filter(
            (frame) => frame.event === "phx_join",
          )[1];
          assert.equal(reconnect.payload.stream_mode, "connect");
          assert.equal(
            reconnect.payload.last_seen_event_id,
            platform.events.find((event) => event.delta === "Second.").metadata
              .cpki_event_id,
            "Recovery must resume after the last durable text event",
          );
        }
        assert.equal(agent.isRunning, true);
        if (mode === "expired") {
          assert.equal(platform.faults.clientRejectUnusedTokens, 0);
          assert.deepEqual(
            [...new Set(platform.faults.clientTokenAttempts)],
            [
              `connect-token-${input.threadId}-1`,
              `connect-token-${input.threadId}-2`,
            ],
          );
          assert.equal(
            platform.requests.filter(
              (entry) =>
                entry.path === `/api/threads/${input.threadId}/connect`,
            ).length,
            2,
          );
          assert.equal(
            platform.clientFrames.filter((frame) => frame.event === "phx_join")
              .length,
            1,
            "The simulated expired credential must fail before channel join",
          );
        }
        assert.equal(
          agent.messages.filter((message) => message.id === "active-answer")
            .length,
          1,
        );
        assert.equal(
          agent.messages.find((message) => message.id === "active-answer")
            .content,
          expectedText,
        );
        assert.equal(
          agent.messages.filter((message) => message.id === "original-question")
            .length,
          1,
        );
        assert.equal(
          platform.agentInputs.length,
          1,
          "Replay must not start another agent run",
        );
        agent.abortRun();
        await bounded(connection);
        assert.equal(agent.isRunning, false);
        await platform.waitFor(() =>
          platform.clientFrames.some((frame) => frame.event === "stop_run"),
        );
        assert.deepEqual(
          platform.clientFrames
            .filter((frame) => frame.event === "stop_run")
            .map((frame) => frame.payload),
          [
            {
              run_id: mode === "stale" ? "retired-run" : "active-reconnect-run",
            },
          ],
        );
        if (mode === "stale") {
          assert.equal(
            platform.locks.get(input.threadId)?.runId,
            "active-reconnect-run",
          );
          assert.equal(
            platform.agentDisconnects.includes("active-reconnect-run"),
            false,
            "A stale Stop must not cancel the replacement run",
          );
          assert.equal(
            platform.events.some((event) => event.type === "RUN_FINISHED"),
            false,
          );
          assert.equal(
            (
              await request("POST", `/agent/default/stop/${input.threadId}`, {
                runId: "active-reconnect-run",
              })
            ).status,
            200,
          );
        }
        await platform.waitFor(() => !platform.locks.has(input.threadId));
        await platform.waitFor(() =>
          platform.agentDisconnects.includes("active-reconnect-run"),
        );
        assert.ok(platform.agentDisconnects.includes("active-reconnect-run"));
        assert.ok(
          platform.events.some(
            (event) =>
              event.runId === "active-reconnect-run" &&
              ["RUN_FINISHED", "RUN_ERROR"].includes(event.type),
          ),
        );
        platform.faults.agentKeepOpen = false;
        platform.faults.agentEvents = undefined;
        const nextRun = await request("POST", "/agent/default/run", {
          ...input,
          runId: "replacement-run",
          messages: [
            { id: "next-question", role: "user", content: "Tell me more." },
          ],
        });
        assert.equal(nextRun.status, 200, JSON.stringify(nextRun.body));
        await platform.waitFor(() => !platform.locks.has(input.threadId));
        assert.equal(platform.agentInputs.length, 2);
        assert.deepEqual(platform.agentInputs[1].messages, [
          { id: "next-question", role: "user", content: "Tell me more." },
        ]);
      });
    },
  })),
  {
    id: "client.public-core-run-and-history-replay",
    async run({ runtimeUrl, platform }) {
      await withClients(runtimeUrl, async ({ cores, agents }) => {
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
        assert.equal(restored.isRunning, false);

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
      });
    },
  },
];
