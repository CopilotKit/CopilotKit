import { AbstractAgent, EventType } from "@ag-ui/client";
import { EMPTY, of } from "rxjs";
import { expect, test, vi } from "vitest";
import { CopilotIntelligenceRuntime } from "../core/runtime";
import { CopilotKitIntelligence } from "../intelligence-platform/client";
import { IntelligenceAgentRunner } from "../runner/intelligence";
import { handleIntelligenceRun } from "../handlers/intelligence/run";

class TestAgent extends AbstractAgent {
  run() {
    return EMPTY;
  }
}

/** Uses the real platform client so capability negotiation is tested on the wire. */
function setup(
  inputPolicy?: "native-history-delta-v1",
  nativeHistoryAgents?: string[],
) {
  const threadId = "550e8400-e29b-41d4-a716-446655440000";
  const transport = vi
    .spyOn(globalThis, "fetch")
    .mockImplementation(async (url) => {
      if (String(url).endsWith("/lock"))
        return Response.json({
          threadId,
          runId: "run-1",
          joinToken: "join",
          backendThreadId: "native/session",
          inputPolicy,
        });
      throw new Error("Unexpected request: " + String(url));
    });
  const intelligence = new CopilotKitIntelligence({ apiKey: "test-key" });
  vi.spyOn(intelligence, "getOrCreateThread").mockResolvedValue({
    thread: { id: threadId, name: "Imported" },
    created: false,
  });
  vi.spyOn(intelligence, "ɵgetThreadMessageIds").mockResolvedValue([]);
  const agent = new TestAgent({ threadId });
  const runtime = new CopilotIntelligenceRuntime({
    agents: { test: agent },
    intelligence,
    identifyUser: () => ({ id: "user-1", name: "User One" }),
    generateThreadNames: false,
    nativeHistoryAgents,
  });
  if (!(runtime.runner instanceof IntelligenceAgentRunner))
    throw new Error("Expected Intelligence runner");
  const run = vi
    .spyOn(runtime.runner, "run")
    .mockReturnValue(
      of({ type: EventType.RUN_FINISHED, threadId, runId: "run-1" }),
    );
  // Keep the real runner instance; isolate the external Phoenix connection only.
  vi.spyOn(runtime.runner, "runWithStartupBoundary").mockImplementation(
    (request) => ({
      events: runtime.runner.run(request),
      startup: Promise.resolve(),
    }),
  );
  return {
    threadId,
    runtime,
    agent,
    run,
    transport,
    teardown: () => transport.mockRestore(),
  };
}

test("web continuation forwards only server-owned backend identity and advertises support", async () => {
  const fixture = setup();
  try {
    const response = await handleIntelligenceRun({
      runtime: fixture.runtime,
      request: new Request("https://runtime.example/run"),
      agentId: "test",
      agent: fixture.agent,
      input: {
        threadId: fixture.threadId,
        runId: "run-1",
        messages: [],
        tools: [],
        context: [],
        state: {},
        forwardedProps: { backendThreadId: "untrusted" },
      },
    });
    expect(response.status).toBe(200);
    expect(fixture.run).toHaveBeenCalledWith(
      expect.objectContaining({
        threadId: fixture.threadId,
        backendThreadId: "native/session",
        input: expect.objectContaining({ threadId: fixture.threadId }),
      }),
    );
    const lockCall = fixture.transport.mock.calls.find(([url]) =>
      String(url).endsWith("/lock"),
    );
    expect(JSON.parse(String(lockCall?.[1]?.body))).toMatchObject({
      supportsBackendThreadId: true,
      supportsNativeHistoryDelta: 1,
    });
    expect(await response.json()).toMatchObject({
      threadId: fixture.threadId,
      realtime: { topic: "thread:" + fixture.threadId },
    });
  } finally {
    fixture.teardown();
  }
});

for (const mode of ["imported", "fresh", "stateless"] as const) {
  test(`${mode}: execution and recording preserve only the intended input`, async () => {
    const fixture = setup(
      mode === "imported" ? "native-history-delta-v1" : undefined,
      mode === "fresh" ? ["test"] : undefined,
    );
    const old = { id: "original", role: "user" as const, content: "same text" };
    const next = { ...old, id: "new-occurrence" };
    vi.spyOn(
      fixture.runtime.intelligence,
      "getThreadMessages",
    ).mockResolvedValue({ messages: [old] });
    fixture.agent.setMessages([old, next]);
    try {
      const response = await handleIntelligenceRun({
        runtime: fixture.runtime,
        request: new Request("https://runtime.example/run"),
        agentId: "test",
        agent: fixture.agent,
        input: {
          threadId: fixture.threadId,
          runId: "run-1",
          messages: [old, next],
          tools: [],
          context: [],
          state: { retained: true },
          forwardedProps: { inputPolicy: "native-history-delta-v1" },
        },
      });
      expect(response.status).toBe(200);
      const expected = mode === "stateless" ? [old, next] : [next];
      expect(fixture.run.mock.calls[0][0].input.messages).toEqual(expected);
      expect(fixture.agent.messages).toEqual(expected);
      expect(fixture.run.mock.calls[0][0].input.state).toEqual({
        retained: true,
      });
      expect(fixture.run.mock.calls[0][0].persistedInputMessages).toEqual(
        expected,
      );
    } finally {
      fixture.teardown();
    }
  });
}

test("native history lookup failure never executes and releases the lock", async () => {
  const fixture = setup("native-history-delta-v1");
  const cleanup = vi
    .spyOn(fixture.runtime.intelligence, "ɵcleanupThreadLock")
    .mockResolvedValue();
  vi.spyOn(fixture.runtime.intelligence, "getThreadMessages").mockRejectedValue(
    new Error("history unavailable"),
  );
  try {
    const response = await handleIntelligenceRun({
      runtime: fixture.runtime,
      request: new Request("https://runtime.example/run"),
      agentId: "test",
      agent: fixture.agent,
      input: {
        threadId: fixture.threadId,
        runId: "run-1",
        messages: [],
        tools: [],
        context: [],
        state: {},
        forwardedProps: {},
      },
    });
    expect(response.status).toBe(502);
    expect(fixture.run).not.toHaveBeenCalled();
    expect(cleanup).toHaveBeenCalledWith({
      threadId: fixture.threadId,
      runId: "run-1",
    });
  } finally {
    fixture.teardown();
  }
});

test("same-ID frontend result update is forwarded and recorded with its resolved value", async () => {
  const fixture = setup("native-history-delta-v1");
  const pending = {
    id: "tool-message",
    role: "tool" as const,
    toolCallId: "native-call",
    content: "pending",
  };
  const resolved = { ...pending, content: '{"approved":false}' };
  vi.spyOn(fixture.runtime.intelligence, "getThreadMessages").mockResolvedValue(
    { messages: [pending] },
  );
  try {
    const response = await handleIntelligenceRun({
      runtime: fixture.runtime,
      request: new Request("https://runtime.example/run"),
      agentId: "test",
      agent: fixture.agent,
      input: {
        threadId: fixture.threadId,
        runId: "run-1",
        messages: [resolved],
        tools: [],
        context: [],
        state: {},
        forwardedProps: { command: { resume: "native-approval" } },
      },
    });
    expect(response.status).toBe(200);
    const request = fixture.run.mock.calls[0][0];
    expect(request.input.messages).toEqual([resolved]);
    expect(request.persistedInputMessages).toEqual([resolved]);
    expect(request.input.forwardedProps).toEqual({
      command: { resume: "native-approval" },
    });
  } finally {
    fixture.teardown();
  }
});
