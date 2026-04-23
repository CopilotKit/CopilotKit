import { Observable } from "rxjs";
import { describe, it, expect, vi } from "vitest";
import { BaseEvent } from "@ag-ui/client";
import { handleConnectAgent } from "../handlers/handle-connect";
import { CopilotRuntime } from "../core/runtime";
import { AgentRunnerConnectRequest } from "../runner/agent-runner";
import { IntelligenceAgentRunner } from "../runner/intelligence";

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

  describe("IntelligenceAgentRunner connect planning path", () => {
    const createConnectRequest = (
      headers?: Record<string, string>,
      lastSeenEventId?: string | null,
    ) =>
      new Request("https://example.com/agent/my-agent/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify({
          threadId: "thread-1",
          runId: "run-1",
          state: {},
          messages: [],
          tools: [],
          context: [],
          forwardedProps: {},
          ...(lastSeenEventId !== undefined ? { lastSeenEventId } : {}),
        }),
      });

    /** Loose mock type for CopilotKitIntelligence — avoids `as any` while the class has private fields. */
    interface MockIntelligencePlatform {
      [key: string]: ((...args: any[]) => any) | undefined;
    }

    const createIntelligenceRuntime = (platform?: MockIntelligencePlatform) => {
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
        mode: "intelligence",
        identifyUser: vi
          .fn()
          .mockResolvedValue({ id: "user-1", name: "User One" }),
        intelligence: {
          ɵgetClientWsUrl: vi.fn(() => "wss://runtime.example/client"),
          ...platform,
        },
      } as unknown as CopilotRuntime;
    };

    it("returns runtime websocket connection credentials when available", async () => {
      const platform = {
        ɵconnectThread: vi.fn().mockResolvedValue({
          threadId: "thread-1",
          joinToken: "jt-connect-1",
        }),
      };
      const runtime = createIntelligenceRuntime(platform);

      const response = await handleConnectAgent({
        runtime,
        request: createConnectRequest(),
        agentId: "my-agent",
      });

      expect(response.status).toBe(200);
      expect(response.headers.get("Content-Type")).toBe("application/json");
      const body = await response.json();
      expect(body).toEqual({
        threadId: "thread-1",
        joinToken: "jt-connect-1",
        realtime: {
          clientUrl: "wss://runtime.example/client",
          threadTopic: "thread:thread-1",
        },
      });
      expect(platform.ɵconnectThread).toHaveBeenCalledWith({
        threadId: "thread-1",
        userId: "user-1",
        agentId: "my-agent",
      });
    });

    it("does not restamp historical replay plans during connect", async () => {
      const platform = {
        ɵconnectThread: vi.fn().mockResolvedValue({
          threadId: "thread-1",
          joinToken: "jt-connect-1",
        }),
      };
      const runtime = createIntelligenceRuntime(platform);

      const response = await handleConnectAgent({
        runtime,
        request: createConnectRequest(),
        agentId: "my-agent",
      });

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body).toEqual({
        threadId: "thread-1",
        joinToken: "jt-connect-1",
        realtime: {
          clientUrl: "wss://runtime.example/client",
          threadTopic: "thread:thread-1",
        },
      });
    });

    it("returns 204 when connect targets a fresh thread", async () => {
      const platform = {
        ɵconnectThread: vi.fn().mockResolvedValue(null),
        createThread: vi.fn(),
      };
      const runtime = createIntelligenceRuntime(platform);

      const response = await handleConnectAgent({
        runtime,
        request: createConnectRequest(),
        agentId: "my-agent",
      });

      expect(response.status).toBe(204);
      expect(platform.createThread).not.toHaveBeenCalled();
      expect(platform.ɵconnectThread).toHaveBeenCalledTimes(1);
      expect(platform.ɵconnectThread).toHaveBeenCalledWith({
        threadId: "thread-1",
        userId: "user-1",
        agentId: "my-agent",
      });
    });

    it("returns 404 when connect planning is not available", async () => {
      const platform = {
        ɵconnectThread: vi
          .fn()
          .mockRejectedValue(new Error("No active connect plan")),
      };
      const runtime = createIntelligenceRuntime(platform);

      const response = await handleConnectAgent({
        runtime,
        request: createConnectRequest(),
        agentId: "my-agent",
      });

      expect(response.status).toBe(404);
      const body = await response.json();
      expect(body.error).toBe("Connect plan not available");
    });

    it("preserves platform validation errors when connect fails validation", async () => {
      const platform = {
        ɵconnectThread: vi.fn().mockRejectedValue(
          Object.assign(new Error("Intelligence platform error 400"), {
            status: 400,
          }),
        ),
      };
      const runtime = createIntelligenceRuntime(platform);

      const response = await handleConnectAgent({
        runtime,
        request: createConnectRequest(),
        agentId: "my-agent",
      });

      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error).toBe("Connect request rejected");
    });

    it("preserves platform ownership conflicts when connect fails authorization", async () => {
      const platform = {
        ɵconnectThread: vi.fn().mockRejectedValue(
          Object.assign(new Error("Intelligence platform error 403"), {
            status: 403,
          }),
        ),
      };
      const runtime = createIntelligenceRuntime(platform);

      const response = await handleConnectAgent({
        runtime,
        request: createConnectRequest(),
        agentId: "my-agent",
      });

      expect(response.status).toBe(403);
      const body = await response.json();
      expect(body.error).toBe("Connect request rejected");
    });

    it("does not forward replay cursors to the credentials-only intelligence platform connect", async () => {
      const platform = {
        ɵconnectThread: vi.fn().mockResolvedValue(null),
      };
      const runtime = createIntelligenceRuntime(platform);

      const response = await handleConnectAgent({
        runtime,
        request: createConnectRequest(undefined, "event-9"),
        agentId: "my-agent",
      });

      expect(response.status).toBe(204);
      expect(platform.ɵconnectThread).toHaveBeenCalledWith({
        threadId: "thread-1",
        userId: "user-1",
        agentId: "my-agent",
      });
    });

    it("uses identifyUser instead of a conflicting X-User-Id header", async () => {
      const platform = {
        ɵconnectThread: vi.fn().mockResolvedValue(null),
      };
      const identifyUser = vi
        .fn()
        .mockResolvedValue({ id: "resolved-user", name: "Resolved User" });
      const runtime = createIntelligenceRuntime(platform);
      runtime.identifyUser = identifyUser;
      const request = createConnectRequest(
        { "X-User-Id": "legacy-user" },
        "event-9",
      );

      const response = await handleConnectAgent({
        runtime,
        request,
        agentId: "my-agent",
      });

      expect(response.status).toBe(204);
      expect(identifyUser).toHaveBeenCalledTimes(1);
      expect(identifyUser).toHaveBeenCalledWith(request);
      expect(platform.ɵconnectThread).toHaveBeenCalledWith({
        threadId: "thread-1",
        userId: "resolved-user",
        agentId: "my-agent",
      });
    });

    it("returns 400 when identifyUser returns an invalid id", async () => {
      const platform = {
        ɵconnectThread: vi.fn(),
      };
      const runtime = createIntelligenceRuntime(platform);
      runtime.identifyUser = vi
        .fn()
        .mockResolvedValue({ id: "", name: "User" });

      const response = await handleConnectAgent({
        runtime,
        request: createConnectRequest(),
        agentId: "my-agent",
      });

      expect(response.status).toBe(400);
      expect(platform.ɵconnectThread).not.toHaveBeenCalled();
    });

    it("returns 400 when identifyUser returns an invalid name", async () => {
      const platform = {
        ɵconnectThread: vi.fn(),
      };
      const runtime = createIntelligenceRuntime(platform);
      runtime.identifyUser = vi
        .fn()
        .mockResolvedValue({ id: "user-1", name: "" });

      const response = await handleConnectAgent({
        runtime,
        request: createConnectRequest(),
        agentId: "my-agent",
      });

      expect(response.status).toBe(400);
      expect(platform.ɵconnectThread).not.toHaveBeenCalled();
    });

    it("returns 500 when identifyUser throws", async () => {
      const platform = {
        ɵconnectThread: vi.fn(),
      };
      const runtime = createIntelligenceRuntime(platform);
      runtime.identifyUser = vi
        .fn()
        .mockRejectedValue(new Error("auth failed"));
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      try {
        const response = await handleConnectAgent({
          runtime,
          request: createConnectRequest(),
          agentId: "my-agent",
        });

        expect(response.status).toBe(500);
        expect(platform.ɵconnectThread).not.toHaveBeenCalled();
      } finally {
        errorSpy.mockRestore();
      }
    });
  });

  describe("telemetry", () => {
    it("captures oss.runtime.copilot_request_created on every invocation", async () => {
      const { telemetry } = await import("../telemetry");
      const captureSpy = vi
        .spyOn(telemetry, "capture")
        .mockResolvedValue(undefined);

      try {
        const runtime = createMockRuntime({});
        const request = new Request("https://example.com/agent/test/connect", {
          method: "POST",
        });
        await handleConnectAgent({
          runtime,
          request,
          agentId: "nonexistent-agent",
        });

        expect(captureSpy).toHaveBeenCalledWith(
          "oss.runtime.copilot_request_created",
          expect.objectContaining({
            requestType: "connect",
            "cloud.api_key_provided": false,
          }),
        );
      } finally {
        captureSpy.mockRestore();
      }
    });

    it("includes cloud.public_api_key when x-copilotcloud-public-api-key header is set", async () => {
      const { telemetry } = await import("../telemetry");
      const captureSpy = vi
        .spyOn(telemetry, "capture")
        .mockResolvedValue(undefined);

      try {
        const runtime = createMockRuntime({});
        const request = new Request("https://example.com/agent/test/connect", {
          method: "POST",
          headers: {
            "x-copilotcloud-public-api-key": "ck_pub_connect_test",
          },
        });

        await handleConnectAgent({
          runtime,
          request,
          agentId: "nonexistent-agent",
        });

        expect(captureSpy).toHaveBeenCalledWith(
          "oss.runtime.copilot_request_created",
          expect.objectContaining({
            "cloud.api_key_provided": true,
            "cloud.public_api_key": "ck_pub_connect_test",
          }),
        );
      } finally {
        captureSpy.mockRestore();
      }
    });
  });
});
