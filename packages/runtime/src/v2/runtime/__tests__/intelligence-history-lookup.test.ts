import { AbstractAgent, EventType } from "@ag-ui/client";
import type { Message } from "@ag-ui/client";
import { logger } from "@copilotkit/shared";
import { EMPTY, of } from "rxjs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CopilotIntelligenceRuntime } from "../core/runtime";
import { CopilotKitIntelligence } from "../intelligence-platform/client";
import { IntelligenceAgentRunner } from "../runner/intelligence";
import { handleIntelligenceRun } from "../handlers/intelligence/run";

class TestAgent extends AbstractAgent {
  run() {
    return EMPTY;
  }
}

const threadId = "550e8400-e29b-41d4-a716-446655440000";

const inputMessages: Message[] = [
  { id: "msg-existing", role: "user", content: "First turn" },
  { id: "msg-new", role: "user", content: "Second turn" },
];

/**
 * Uses the real platform client so the run-start history lookup is tested on
 * the wire. `historyResponse` is what the messages endpoint returns.
 */
function setup(historyResponse: () => Response) {
  const transport = vi
    .spyOn(globalThis, "fetch")
    .mockImplementation(async (url, init) => {
      const path = new URL(String(url)).pathname;
      if (path.endsWith("/lock") && init?.method === "POST") {
        return Response.json({ threadId, runId: "run-1", joinToken: "join" });
      }
      if (path.endsWith("/lock") && init?.method === "DELETE") {
        return new Response(null, { status: 204 });
      }
      if (path.endsWith("/messages")) {
        return historyResponse();
      }
      throw new Error("Unexpected request: " + String(url));
    });
  const intelligence = new CopilotKitIntelligence({ apiKey: "test-key" });
  vi.spyOn(intelligence, "getOrCreateThread").mockResolvedValue({
    thread: { id: threadId, name: "Existing" },
    created: false,
  });
  const agent = new TestAgent({ threadId });
  const runtime = new CopilotIntelligenceRuntime({
    agents: { test: agent },
    intelligence,
    identifyUser: () => ({ id: "user-1", name: "User One" }),
    generateThreadNames: false,
  });
  if (!(runtime.runner instanceof IntelligenceAgentRunner))
    throw new Error("expected intelligence runner");
  const run = vi
    .spyOn(runtime.runner, "run")
    .mockReturnValue(
      of({ type: EventType.RUN_FINISHED, threadId, runId: "run-1" }),
    );
  vi.spyOn(runtime.runner, "runWithStartupBoundary").mockImplementation(
    (request) => ({
      events: runtime.runner.run(request),
      startup: Promise.resolve(),
    }),
  );
  return { runtime, agent, run, transport };
}

function runInput() {
  return {
    threadId,
    runId: "run-1",
    messages: inputMessages,
    tools: [],
    context: [],
    state: {},
    forwardedProps: {},
  };
}

describe("intelligence run history lookup", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each([
    [
      "an ids-only response",
      () => Response.json({ messages: [{ id: "msg-existing" }] }),
    ],
    [
      "a full transcript from a server that ignores fields=id",
      () =>
        Response.json({
          messages: [
            { id: "msg-existing", role: "user", content: "First turn" },
            { id: "msg-reply", role: "assistant", content: "Reply" },
          ],
        }),
    ],
  ])(
    "requests only message ids and drops persisted input messages for %s",
    async (_name, historyResponse) => {
      const fixture = setup(historyResponse);

      const response = await handleIntelligenceRun({
        runtime: fixture.runtime,
        request: new Request("https://runtime.example/run"),
        agentId: "test",
        agent: fixture.agent,
        input: runInput(),
      });

      expect(response.status).toBe(200);
      const historyCall = fixture.transport.mock.calls.find(([url]) =>
        new URL(String(url)).pathname.endsWith("/messages"),
      );
      const historyUrl = new URL(String(historyCall?.[0]));
      expect(historyUrl.searchParams.get("userId")).toBe("user-1");
      expect(historyUrl.searchParams.get("fields")).toBe("id");
      expect(fixture.run).toHaveBeenCalledWith(
        expect.objectContaining({
          persistedInputMessages: [
            { id: "msg-new", role: "user", content: "Second turn" },
          ],
        }),
      );
    },
  );

  it("returns 502 and releases the lock when the lookup fails", async () => {
    vi.spyOn(logger, "error").mockImplementation(() => {});
    const fixture = setup(() =>
      Response.json({ code: "INTERNAL" }, { status: 500 }),
    );

    const response = await handleIntelligenceRun({
      runtime: fixture.runtime,
      request: new Request("https://runtime.example/run"),
      agentId: "test",
      agent: fixture.agent,
      input: runInput(),
    });

    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({
      error: "Thread history lookup failed",
    });
    const cleanupCall = fixture.transport.mock.calls.find(
      ([url, init]) =>
        String(url).endsWith("/lock") && init?.method === "DELETE",
    );
    expect(JSON.parse(String(cleanupCall?.[1]?.body))).toEqual({
      runId: "run-1",
    });
    expect(fixture.run).not.toHaveBeenCalled();
  });
});
