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
function setup() {
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
        });
      throw new Error("Unexpected request: " + String(url));
    });
  const intelligence = new CopilotKitIntelligence({ apiKey: "test-key" });
  vi.spyOn(intelligence, "getOrCreateThread").mockResolvedValue({
    thread: { id: threadId, name: "Imported" },
    created: false,
  });
  vi.spyOn(intelligence, "getThreadMessages").mockResolvedValue({
    messages: [],
  });
  const agent = new TestAgent({ threadId });
  const runtime = new CopilotIntelligenceRuntime({
    agents: { test: agent },
    intelligence,
    identifyUser: () => ({ id: "user-1", name: "User One" }),
    generateThreadNames: false,
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
    });
    expect(await response.json()).toMatchObject({
      threadId: fixture.threadId,
      realtime: { topic: "thread:" + fixture.threadId },
    });
  } finally {
    fixture.teardown();
  }
});
