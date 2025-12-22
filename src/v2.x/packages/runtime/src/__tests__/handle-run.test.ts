import { Observable } from "rxjs";
import { describe, it, expect, vi } from "vitest";
import { AbstractAgent, BaseEvent, HttpAgent } from "@ag-ui/client";
import { handleRunAgent } from "../handlers/handle-run";
import { CopilotRuntime } from "../runtime";

describe("handleRunAgent", () => {
  const createMockRuntime = (
    agents: Record<string, unknown> = {}
  ): CopilotRuntime => {
    return {
      agents: Promise.resolve(agents),
      transcriptionService: undefined,
      beforeRequestMiddleware: undefined,
      afterRequestMiddleware: undefined,
    } as CopilotRuntime;
  };

  const createMockRequest = (): Request => {
    return new Request("https://example.com/agent/test/run", {
      method: "POST",
    });
  };

  it("should return 404 when agent does not exist", async () => {
    const runtime = createMockRuntime({}); // Empty agents
    const request = createMockRequest();
    const agentId = "nonexistent-agent";

    const response = await handleRunAgent({
      runtime,
      request,
      agentId,
    });

    expect(response.status).toBe(404);
    expect(response.headers.get("Content-Type")).toBe("application/json");

    const body = await response.json();
    expect(body).toEqual({
      error: "Agent not found",
      message: "Agent 'nonexistent-agent' does not exist",
    });
  });

  it("should return 500 when runtime.agents throws an error", async () => {
    const runtime = {
      agents: Promise.reject(new Error("Database connection failed")),
      transcriptionService: undefined,
      beforeRequestMiddleware: undefined,
      afterRequestMiddleware: undefined,
    } as CopilotRuntime;
    const request = createMockRequest();
    const agentId = "test-agent";

    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      const response = await handleRunAgent({
        runtime,
        request,
        agentId,
      });

      expect(response.status).toBe(500);
      expect(response.headers.get("Content-Type")).toBe("application/json");

      const body = await response.json();
      expect(body).toEqual({
        error: "Failed to run agent",
        message: "Database connection failed",
      });
    } finally {
      errorSpy.mockRestore();
    }
  });

  it("forwards only authorization and custom x- headers to HttpAgent runs", async () => {
    class RecordingHttpAgent extends HttpAgent {
      constructor(initialHeaders: Record<string, string>) {
        super({ url: "https://runtime.example/agent" });
        this.headers = initialHeaders;
      }

      clone(): AbstractAgent {
        return new RecordingHttpAgent({});
      }
    }

    const baseHeaders = {
      Authorization: "Bearer base",
    };

    const registeredAgent = new RecordingHttpAgent(baseHeaders);

    const recordedHeaders: Array<Record<string, string>> = [];
    let resolveRun: (() => void) | undefined;
    const runInvoked = new Promise<void>((resolve) => {
      resolveRun = resolve;
    });

    const runtime = {
      agents: Promise.resolve({ "test-agent": registeredAgent }),
      transcriptionService: undefined,
      beforeRequestMiddleware: undefined,
      afterRequestMiddleware: undefined,
      runner: {
        run: ({ agent }: { agent: AbstractAgent }) =>
          new Observable<BaseEvent>((subscriber) => {
            recordedHeaders.push({ ...(agent as HttpAgent).headers });
            resolveRun?.();
            subscriber.complete();
          }),
        connect: () =>
          new Observable<BaseEvent>((subscriber) => {
            subscriber.complete();
          }),
        isRunning: async () => false,
        stop: async () => false,
      },
    } as CopilotRuntime;

    const requestBody = {
      threadId: "thread-1",
      runId: "run-1",
      state: {},
      messages: [],
      tools: [],
      context: [],
      forwardedProps: {},
    };

    const request = new Request("https://example.com/agent/test-agent/run", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Custom": "custom-value",
        Authorization: "Bearer forwarded",
        Origin: "http://localhost:4200",
      },
      body: JSON.stringify(requestBody),
    });

    const response = await handleRunAgent({
      runtime,
      request,
      agentId: "test-agent",
    });

    expect(response.status).toBe(200);
    await runInvoked;

    expect(recordedHeaders).toHaveLength(1);
    expect(recordedHeaders[0]).toMatchObject({
      authorization: "Bearer forwarded",
      "x-custom": "custom-value",
    });
    expect(recordedHeaders[0]).not.toHaveProperty("origin");
    expect(recordedHeaders[0]).not.toHaveProperty("content-type");
  });
});
