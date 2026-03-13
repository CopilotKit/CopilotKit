import { Observable } from "rxjs";
import { describe, it, expect } from "vitest";
import { BaseEvent } from "@ag-ui/client";
import { handleConnectAgent } from "../handlers/handle-connect";
import { CopilotRuntime } from "../runtime";
import { AgentRunnerConnectRequest } from "../runner/agent-runner";

describe("handleConnectAgent", () => {
  const createMockRuntime = (
    agents: Record<string, unknown> = {},
    connectHandler?: (
      request: AgentRunnerConnectRequest,
    ) => Observable<BaseEvent>,
  ): CopilotRuntime => {
    return {
      agents: Promise.resolve(agents),
      transcriptionService: undefined,
      beforeRequestMiddleware: undefined,
      afterRequestMiddleware: undefined,
      runner: {
        run: () =>
          new Observable<BaseEvent>((subscriber) => {
            subscriber.complete();
          }),
        connect:
          connectHandler ??
          (() =>
            new Observable<BaseEvent>((subscriber) => {
              subscriber.complete();
            })),
        isRunning: async () => false,
        stop: async () => false,
      },
    } as CopilotRuntime;
  };

  it("should return 404 when agent does not exist", async () => {
    const runtime = createMockRuntime({});
    const request = new Request(
      "https://example.com/agent/nonexistent/connect",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          threadId: "thread-1",
          runId: "run-1",
          state: {},
          messages: [],
          tools: [],
          context: [],
          forwardedProps: {},
        }),
      },
    );

    const response = await handleConnectAgent({
      runtime,
      request,
      agentId: "nonexistent-agent",
    });

    expect(response.status).toBe(404);
    expect(response.headers.get("Content-Type")).toBe("application/json");

    const body = await response.json();
    expect(body).toEqual({
      error: "Agent not found",
      message: "Agent 'nonexistent-agent' does not exist",
    });
  });

  it("forwards only authorization and custom x- headers to runner.connect()", async () => {
    const recordedRequests: AgentRunnerConnectRequest[] = [];
    let resolveConnect: (() => void) | undefined;
    const connectInvoked = new Promise<void>((resolve) => {
      resolveConnect = resolve;
    });

    const runtime = createMockRuntime(
      { "test-agent": { clone: () => ({}) } },
      (request: AgentRunnerConnectRequest) =>
        new Observable<BaseEvent>((subscriber) => {
          recordedRequests.push(request);
          resolveConnect?.();
          subscriber.complete();
        }),
    );

    const requestBody = {
      threadId: "thread-1",
      runId: "run-1",
      state: {},
      messages: [],
      tools: [],
      context: [],
      forwardedProps: {},
    };

    const request = new Request(
      "https://example.com/agent/test-agent/connect",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Custom": "custom-value",
          "X-Another-Header": "another-value",
          Authorization: "Bearer forwarded-token",
          Origin: "http://localhost:4200",
          "User-Agent": "test-agent",
        },
        body: JSON.stringify(requestBody),
      },
    );

    const response = await handleConnectAgent({
      runtime,
      request,
      agentId: "test-agent",
    });

    expect(response.status).toBe(200);
    await connectInvoked;

    expect(recordedRequests).toHaveLength(1);
    expect(recordedRequests[0].threadId).toBe("thread-1");
    expect(recordedRequests[0].headers).toMatchObject({
      authorization: "Bearer forwarded-token",
      "x-custom": "custom-value",
      "x-another-header": "another-value",
    });
    expect(recordedRequests[0].headers).not.toHaveProperty("origin");
    expect(recordedRequests[0].headers).not.toHaveProperty("content-type");
    expect(recordedRequests[0].headers).not.toHaveProperty("user-agent");
  });

  it("passes empty headers object when no forwardable headers present", async () => {
    const recordedRequests: AgentRunnerConnectRequest[] = [];
    let resolveConnect: (() => void) | undefined;
    const connectInvoked = new Promise<void>((resolve) => {
      resolveConnect = resolve;
    });

    const runtime = createMockRuntime(
      { "test-agent": { clone: () => ({}) } },
      (request: AgentRunnerConnectRequest) =>
        new Observable<BaseEvent>((subscriber) => {
          recordedRequests.push(request);
          resolveConnect?.();
          subscriber.complete();
        }),
    );

    const requestBody = {
      threadId: "thread-1",
      runId: "run-1",
      state: {},
      messages: [],
      tools: [],
      context: [],
      forwardedProps: {},
    };

    const request = new Request(
      "https://example.com/agent/test-agent/connect",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: "http://localhost:4200",
        },
        body: JSON.stringify(requestBody),
      },
    );

    const response = await handleConnectAgent({
      runtime,
      request,
      agentId: "test-agent",
    });

    expect(response.status).toBe(200);
    await connectInvoked;

    expect(recordedRequests).toHaveLength(1);
    expect(recordedRequests[0].headers).toEqual({});
  });
});
