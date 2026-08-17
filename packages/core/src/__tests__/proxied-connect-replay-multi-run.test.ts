import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { ProxiedCopilotRuntimeAgent } from "../agent";

/**
 * Issue #4943 (part 2): hydrating an existing thread through `/connect` on a
 * self-hosted runtime.
 *
 * A `/connect` response replays the thread's history, so it can legitimately
 * carry events from several past runs — including a run that ended in
 * RUN_ERROR followed by a later RUN_STARTED. AbstractAgent's connect pipeline
 * runs the stream through `verifyEvents`, which enforces single-run lifecycle
 * rules and rejects a RUN_STARTED after a RUN_ERROR:
 *
 *   Cannot send event type 'RUN_STARTED': The run has already errored with
 *   'RUN_ERROR'. No further events can be sent.
 *
 * IntelligenceAgent already omits `verifyEvents` from its connect pipeline for
 * exactly this reason (see intelligence-agent.ts). Self-hosted runtimes
 * (RUNTIME_MODE_SSE) still inherit the base pipeline, so replay of a thread
 * whose history contains an errored run fails to hydrate.
 */

const encoder = new TextEncoder();

function createConnectReplayResponse(): Response {
  const stream = new ReadableStream({
    start(controller) {
      const events = [
        // ---- first past run: ended in RUN_ERROR ----
        { type: "RUN_STARTED", threadId: "existing-thread", runId: "run-1" },
        {
          type: "TEXT_MESSAGE_START",
          messageId: "msg-1",
          role: "assistant",
        },
        {
          type: "TEXT_MESSAGE_CONTENT",
          messageId: "msg-1",
          delta: "first run answer",
        },
        { type: "TEXT_MESSAGE_END", messageId: "msg-1" },
        {
          type: "RUN_ERROR",
          threadId: "existing-thread",
          runId: "run-1",
          message: "upstream model error",
        },
        // ---- second past run: replayed in the same /connect stream ----
        { type: "RUN_STARTED", threadId: "existing-thread", runId: "run-2" },
        {
          type: "TEXT_MESSAGE_START",
          messageId: "msg-2",
          role: "assistant",
        },
        {
          type: "TEXT_MESSAGE_CONTENT",
          messageId: "msg-2",
          delta: "second run answer",
        },
        { type: "TEXT_MESSAGE_END", messageId: "msg-2" },
        {
          type: "RUN_FINISHED",
          threadId: "existing-thread",
          runId: "run-2",
          result: { newMessages: [] },
        },
      ];
      controller.enqueue(
        encoder.encode(
          events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join(""),
        ),
      );
      controller.close();
    },
  });

  return new Response(stream, {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
}

describe("self-hosted /connect replay across multiple past runs (#4943)", () => {
  const originalFetch = global.fetch;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn(() => Promise.resolve(createConnectReplayResponse()));
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    global.fetch = originalFetch;
  });

  it("hydrates a thread whose replayed history contains an errored run", async () => {
    const agent = new ProxiedCopilotRuntimeAgent({
      runtimeUrl: "https://runtime.example/hono",
      agentId: "hydrating-agent",
      transport: "rest",
    });
    agent.threadId = "existing-thread";

    await expect(agent.connectAgent()).resolves.toBeDefined();

    expect(agent.messages.map((m) => m.id)).toEqual(["msg-1", "msg-2"]);
  });
});
