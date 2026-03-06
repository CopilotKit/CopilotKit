import { Observable } from "rxjs";
import { describe, it, expect, vi } from "vitest";
import { BaseEvent } from "@ag-ui/client";
import { handleConnectAgent } from "../handlers/handle-connect";
import { CopilotRuntime } from "../runtime";
import { AgentRunnerConnectRequest } from "../runner/agent-runner";
import { IntelligenceAgentRunner } from "../runner/intelligence";
import { IntelligencePlatformClient } from "../intelligence-platform/client";

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

  describe("IntelligenceAgentRunner join code path", () => {
    const createConnectRequest = () =>
      new Request("https://example.com/agent/my-agent/connect", {
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
      });

    const createIntelligenceRuntime = (
      platform?: Partial<IntelligencePlatformClient>,
    ) => {
      const runner = Object.create(IntelligenceAgentRunner.prototype);
      runner.connect = vi.fn(
        () =>
          new Observable<BaseEvent>((subscriber) => {
            subscriber.complete();
          }),
      );
      return {
        agents: Promise.resolve({
          "my-agent": { clone: () => ({}) },
        }),
        transcriptionService: undefined,
        beforeRequestMiddleware: undefined,
        afterRequestMiddleware: undefined,
        runner,
        intelligencePlatform: platform,
      } as unknown as CopilotRuntime;
    };

    it("returns joinCode JSON when join code is available", async () => {
      const platform = {
        getActiveJoinCode: vi
          .fn()
          .mockResolvedValue({ joinCode: "jc-connect-1" }),
      };
      const runtime = createIntelligenceRuntime(platform as any);

      const response = await handleConnectAgent({
        runtime,
        request: createConnectRequest(),
        agentId: "my-agent",
      });

      expect(response.status).toBe(200);
      expect(response.headers.get("Content-Type")).toBe("application/json");
      const body = await response.json();
      expect(body).toEqual({ joinCode: "jc-connect-1" });
      expect(platform.getActiveJoinCode).toHaveBeenCalledWith({
        threadId: "thread-1",
      });
    });

    it("returns 404 when join code is not available", async () => {
      const platform = {
        getActiveJoinCode: vi
          .fn()
          .mockRejectedValue(new Error("No active join code")),
      };
      const runtime = createIntelligenceRuntime(platform as any);

      const response = await handleConnectAgent({
        runtime,
        request: createConnectRequest(),
        agentId: "my-agent",
      });

      expect(response.status).toBe(404);
      const body = await response.json();
      expect(body.error).toBe("Join code not available");
      expect(body.message).toContain("No active join code");
    });

    it("returns 500 when intelligencePlatform is not configured", async () => {
      const runtime = createIntelligenceRuntime(undefined);

      const response = await handleConnectAgent({
        runtime,
        request: createConnectRequest(),
        agentId: "my-agent",
      });

      expect(response.status).toBe(500);
      const body = await response.json();
      expect(body.error).toBe("Intelligence platform not configured");
    });
  });
});
