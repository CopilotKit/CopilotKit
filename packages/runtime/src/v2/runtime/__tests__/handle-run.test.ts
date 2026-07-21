import { EMPTY, Observable } from "rxjs";
import { describe, it, expect, vi } from "vitest";
import type { BaseEvent, RunAgentInput, RunAgentResult } from "@ag-ui/client";
import { AbstractAgent, EventType, HttpAgent } from "@ag-ui/client";
import { A2UIMiddleware } from "@ag-ui/a2ui-middleware";
import { handleRunAgent } from "../handlers/handle-run";
import { CopilotRuntime } from "../core/runtime";
import { resolveForwardHeadersPolicy } from "../handlers/header-utils";
import { IntelligenceAgentRunner } from "../runner/intelligence";
import { InMemoryAgentRunner } from "../runner/in-memory";

describe("handleRunAgent", () => {
  const createMockRuntime = (
    agents: Record<string, unknown> = {},
  ): CopilotRuntime => {
    return {
      agents: Promise.resolve(agents),
      transcriptionService: undefined,
      beforeRequestMiddleware: undefined,
      afterRequestMiddleware: undefined,
      forwardHeadersPolicy: resolveForwardHeadersPolicy(undefined),
    } as unknown as CopilotRuntime;
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
      forwardHeadersPolicy: resolveForwardHeadersPolicy(undefined),
    } as unknown as CopilotRuntime;
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

      clone(): HttpAgent {
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
      forwardHeadersPolicy: resolveForwardHeadersPolicy(undefined),
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
    } as unknown as CopilotRuntime;

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

  const createMockAgentWithUse = () => {
    const useSpy = vi.fn();
    const agent = {
      clone: () => ({ ...agent, use: useSpy }),
      use: useSpy,
    } as unknown as AbstractAgent;
    return { agent, useSpy };
  };

  const createMockRunner = () => ({
    run: () =>
      new Observable<BaseEvent>((subscriber) => {
        subscriber.complete();
      }),
    connect: () =>
      new Observable<BaseEvent>((subscriber) => {
        subscriber.complete();
      }),
    isRunning: async () => false,
    stop: async () => false,
  });

  const createRunRequest = (headers?: Record<string, string>) =>
    new Request("https://example.com/agent/my-agent/run", {
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
      }),
    });

  it("applies A2UIMiddleware to all agents when a2ui.enabled is true and no agents filter", async () => {
    const { agent, useSpy } = createMockAgentWithUse();

    const runtime = {
      agents: Promise.resolve({ "my-agent": agent }),
      transcriptionService: undefined,
      beforeRequestMiddleware: undefined,
      afterRequestMiddleware: undefined,
      forwardHeadersPolicy: resolveForwardHeadersPolicy(undefined),
      runner: createMockRunner(),
      a2ui: { enabled: true, injectA2UITool: true },
    } as unknown as CopilotRuntime;

    await handleRunAgent({
      runtime,
      request: createRunRequest(),
      agentId: "my-agent",
    });

    expect(useSpy).toHaveBeenCalledOnce();
    expect(useSpy.mock.calls[0][0]).toBeInstanceOf(A2UIMiddleware);
  });

  it("applies A2UIMiddleware only to matching agent when agents filter is set", async () => {
    const { agent: matchingAgent, useSpy: matchingSpy } =
      createMockAgentWithUse();
    const { agent: otherAgent, useSpy: otherSpy } = createMockAgentWithUse();

    const makeRuntime = (agentId: string, targetAgent: AbstractAgent) =>
      ({
        agents: Promise.resolve({ [agentId]: targetAgent }),
        transcriptionService: undefined,
        beforeRequestMiddleware: undefined,
        afterRequestMiddleware: undefined,
        forwardHeadersPolicy: resolveForwardHeadersPolicy(undefined),
        runner: createMockRunner(),
        a2ui: { enabled: true, agents: ["my-agent"] },
      }) as unknown as CopilotRuntime;

    // Should apply for "my-agent"
    await handleRunAgent({
      runtime: makeRuntime("my-agent", matchingAgent),
      request: createRunRequest(),
      agentId: "my-agent",
    });
    expect(matchingSpy).toHaveBeenCalledOnce();

    // Should NOT apply for "other-agent"
    const otherRequest = new Request("https://example.com/agent/other/run", {
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
    await handleRunAgent({
      runtime: makeRuntime("other", otherAgent),
      request: otherRequest,
      agentId: "other",
    });
    expect(otherSpy).not.toHaveBeenCalled();
  });

  it("does not apply A2UIMiddleware when a2ui is omitted", async () => {
    const { agent, useSpy } = createMockAgentWithUse();

    const runtime = {
      agents: Promise.resolve({ "my-agent": agent }),
      transcriptionService: undefined,
      beforeRequestMiddleware: undefined,
      afterRequestMiddleware: undefined,
      forwardHeadersPolicy: resolveForwardHeadersPolicy(undefined),
      runner: createMockRunner(),
    } as unknown as CopilotRuntime;

    await handleRunAgent({
      runtime,
      request: createRunRequest(),
      agentId: "my-agent",
    });

    expect(useSpy).not.toHaveBeenCalled();
  });

  it("does not apply A2UIMiddleware when a2ui.enabled is false", async () => {
    const { agent, useSpy } = createMockAgentWithUse();

    const runtime = {
      agents: Promise.resolve({ "my-agent": agent }),
      transcriptionService: undefined,
      beforeRequestMiddleware: undefined,
      afterRequestMiddleware: undefined,
      forwardHeadersPolicy: resolveForwardHeadersPolicy(undefined),
      runner: createMockRunner(),
      // Config object present but explicitly disabled — the run path must
      // honor the opt-out, not just `!!runtime.a2ui`.
      a2ui: { enabled: false, injectA2UITool: true },
    } as unknown as CopilotRuntime;

    await handleRunAgent({
      runtime,
      request: createRunRequest(),
      agentId: "my-agent",
    });

    expect(useSpy).not.toHaveBeenCalled();
  });

  // A run request whose forwardedProps signal that the React provider was
  // given an A2UI catalog (`<CopilotKit a2ui={{ catalog }}>`). This is the
  // signal that lets a catalog alone turn A2UI on end-to-end.
  const createCatalogRunRequest = () =>
    new Request("https://example.com/agent/my-agent/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        threadId: "thread-1",
        runId: "run-1",
        state: {},
        messages: [],
        tools: [],
        context: [],
        forwardedProps: { a2uiCatalogAvailable: true },
      }),
    });

  const getAppliedA2UIMiddleware = (useSpy: ReturnType<typeof vi.fn>) => {
    const call = useSpy.mock.calls.find((c) => c[0] instanceof A2UIMiddleware);
    return call?.[0] as A2UIMiddleware | undefined;
  };

  it("applies A2UIMiddleware with tool injection when a catalog is forwarded and the runtime has no a2ui config", async () => {
    const { agent, useSpy } = createMockAgentWithUse();

    const runtime = {
      agents: Promise.resolve({ "my-agent": agent }),
      transcriptionService: undefined,
      beforeRequestMiddleware: undefined,
      afterRequestMiddleware: undefined,
      forwardHeadersPolicy: resolveForwardHeadersPolicy(undefined),
      runner: createMockRunner(),
      // No `a2ui` config at all — the provider's catalog alone must enable it.
    } as unknown as CopilotRuntime;

    await handleRunAgent({
      runtime,
      request: createCatalogRunRequest(),
      agentId: "my-agent",
    });

    const middleware = getAppliedA2UIMiddleware(useSpy);
    expect(middleware).toBeInstanceOf(A2UIMiddleware);
    expect(
      (middleware as unknown as { config: { injectA2UITool?: unknown } }).config
        .injectA2UITool,
    ).toBe(true);
  });

  it("respects an explicit injectA2UITool: false even when a catalog is forwarded", async () => {
    const { agent, useSpy } = createMockAgentWithUse();

    const runtime = {
      agents: Promise.resolve({ "my-agent": agent }),
      transcriptionService: undefined,
      beforeRequestMiddleware: undefined,
      afterRequestMiddleware: undefined,
      forwardHeadersPolicy: resolveForwardHeadersPolicy(undefined),
      runner: createMockRunner(),
      // Deeper, explicit opt-out — the catalog default must NOT override it.
      a2ui: { enabled: true, injectA2UITool: false },
    } as unknown as CopilotRuntime;

    await handleRunAgent({
      runtime,
      request: createCatalogRunRequest(),
      agentId: "my-agent",
    });

    const middleware = getAppliedA2UIMiddleware(useSpy);
    expect(middleware).toBeInstanceOf(A2UIMiddleware);
    expect(
      (middleware as unknown as { config: { injectA2UITool?: unknown } }).config
        .injectA2UITool,
    ).toBe(false);
  });

  it("does not apply A2UIMiddleware when a catalog is forwarded but a2ui.enabled is false", async () => {
    const { agent, useSpy } = createMockAgentWithUse();

    const runtime = {
      agents: Promise.resolve({ "my-agent": agent }),
      transcriptionService: undefined,
      beforeRequestMiddleware: undefined,
      afterRequestMiddleware: undefined,
      forwardHeadersPolicy: resolveForwardHeadersPolicy(undefined),
      runner: createMockRunner(),
      a2ui: { enabled: false },
    } as unknown as CopilotRuntime;

    await handleRunAgent({
      runtime,
      request: createCatalogRunRequest(),
      agentId: "my-agent",
    });

    expect(useSpy).not.toHaveBeenCalled();
  });

  it("defaults injectA2UITool to true when a catalog is forwarded and a2ui is enabled without an explicit flag", async () => {
    const { agent, useSpy } = createMockAgentWithUse();

    const runtime = {
      agents: Promise.resolve({ "my-agent": agent }),
      transcriptionService: undefined,
      beforeRequestMiddleware: undefined,
      afterRequestMiddleware: undefined,
      forwardHeadersPolicy: resolveForwardHeadersPolicy(undefined),
      runner: createMockRunner(),
      a2ui: { enabled: true },
    } as unknown as CopilotRuntime;

    await handleRunAgent({
      runtime,
      request: createCatalogRunRequest(),
      agentId: "my-agent",
    });

    const middleware = getAppliedA2UIMiddleware(useSpy);
    expect(middleware).toBeInstanceOf(A2UIMiddleware);
    expect(
      (middleware as unknown as { config: { injectA2UITool?: unknown } }).config
        .injectA2UITool,
    ).toBe(true);
  });

  it("does not apply A2UIMiddleware when neither a catalog is forwarded nor a2ui is configured", async () => {
    const { agent, useSpy } = createMockAgentWithUse();

    const runtime = {
      agents: Promise.resolve({ "my-agent": agent }),
      transcriptionService: undefined,
      beforeRequestMiddleware: undefined,
      afterRequestMiddleware: undefined,
      forwardHeadersPolicy: resolveForwardHeadersPolicy(undefined),
      runner: createMockRunner(),
    } as unknown as CopilotRuntime;

    await handleRunAgent({
      runtime,
      request: createRunRequest(),
      agentId: "my-agent",
    });

    expect(useSpy).not.toHaveBeenCalled();
  });

  describe("IntelligenceAgentRunner realtime credentials path", () => {
    /** Loose mock type for CopilotKitIntelligence — avoids `as any` while the class has private fields. */
    interface MockIntelligencePlatform {
      [key: string]: ((...args: any[]) => any) | undefined;
    }

    const createIntelligenceRuntime = (
      agent: AbstractAgent,
      platform?: MockIntelligencePlatform,
      options?: {
        generateThreadNames?: boolean;
        lockHeartbeatIntervalSeconds?: number;
        lockTtlSeconds?: number;
        identifyUser?: (
          request: Request,
        ) =>
          | { id: string; name: string }
          | Promise<{ id: string; name: string }>;
        resolveLearningContainer?: (params: {
          request: Request;
          threadId: string;
          agentId: string;
          user: { id: string; name: string };
        }) => string | null | Promise<string | null>;
      },
    ) => {
      const runner = Object.create(IntelligenceAgentRunner.prototype);
      runner.run = vi.fn(
        () =>
          new Observable<BaseEvent>((subscriber) => {
            subscriber.complete();
          }),
      );
      return {
        agents: Promise.resolve({ "my-agent": agent }),
        transcriptionService: undefined,
        beforeRequestMiddleware: undefined,
        afterRequestMiddleware: undefined,
        forwardHeadersPolicy: resolveForwardHeadersPolicy(undefined),
        runner,
        mode: "intelligence",
        generateThreadNames: options?.generateThreadNames ?? false,
        lockHeartbeatIntervalSeconds:
          options?.lockHeartbeatIntervalSeconds ?? 15,
        lockTtlSeconds: options?.lockTtlSeconds ?? 20,
        intelligence: {
          ɵgetClientWsUrl: vi.fn(() => "wss://runtime.example/client"),
          ...platform,
        },
        identifyUser:
          options?.identifyUser ??
          vi.fn().mockResolvedValue({ id: "user-1", name: "User One" }),
        resolveLearningContainer: options?.resolveLearningContainer,
      } as unknown as CopilotRuntime;
    };

    const createAgentForIntelligence = () => {
      const createClone = () =>
        ({
          clone: vi.fn(() => createClone()),
          setMessages: vi.fn(),
          setState: vi.fn(),
          abortRun: vi.fn(),
          threadId: undefined,
          headers: {},
          runAgent: vi.fn().mockResolvedValue(undefined),
        }) as unknown as AbstractAgent;

      const agent = {
        clone: vi.fn(() => createClone()),
        setMessages: vi.fn(),
        setState: vi.fn(),
        abortRun: vi.fn(),
        threadId: undefined,
        headers: {},
        runAgent: vi.fn().mockResolvedValue(undefined),
      } as unknown as AbstractAgent;
      return agent;
    };

    it("returns joinToken JSON when lock is acquired", async () => {
      const agent = createAgentForIntelligence();
      const platform = {
        getOrCreateThread: vi.fn().mockResolvedValue({
          thread: { id: "thread-1", name: null },
          created: false,
        }),
        getThreadMessages: vi.fn().mockResolvedValue({ messages: [] }),
        ɵacquireThreadLock: vi.fn().mockResolvedValue({
          threadId: "thread-1",
          runId: "run-1",
          joinToken: "jt-123",
        }),
        ɵcleanupThreadLock: vi.fn().mockResolvedValue(undefined),
      };
      const runtime = createIntelligenceRuntime(agent, platform);

      const response = await handleRunAgent({
        runtime,
        request: createRunRequest(),
        agentId: "my-agent",
      });

      expect(response.status).toBe(200);
      expect(response.headers.get("Content-Type")).toBe("application/json");
      const body = await response.json();
      expect(body).toEqual({
        threadId: "thread-1",
        runId: "run-1",
        joinToken: "jt-123",
        realtime: {
          clientUrl: "wss://runtime.example/client",
          topic: "thread:thread-1",
        },
      });
      expect(platform.getOrCreateThread).toHaveBeenCalledWith({
        threadId: "thread-1",
        userId: "user-1",
        agentId: "my-agent",
      });
      expect(platform.ɵacquireThreadLock).toHaveBeenCalledWith({
        threadId: "thread-1",
        runId: "run-1",
        userId: "user-1",
        agentId: "my-agent",
        ttlSeconds: 20,
      });
      expect(platform.getThreadMessages).toHaveBeenCalledWith({
        threadId: "thread-1",
        userId: "user-1",
      });
    });

    it("uses identifyUser instead of a conflicting X-User-Id header", async () => {
      const agent = createAgentForIntelligence();
      const platform = {
        getOrCreateThread: vi.fn().mockResolvedValue({
          thread: { id: "thread-1", name: null },
          created: false,
        }),
        getThreadMessages: vi.fn().mockResolvedValue({ messages: [] }),
        ɵacquireThreadLock: vi.fn().mockResolvedValue({
          threadId: "thread-1",
          runId: "run-1",
          joinToken: "jt-123",
        }),
        ɵcleanupThreadLock: vi.fn().mockResolvedValue(undefined),
      };
      const identifyUser = vi
        .fn()
        .mockResolvedValue({ id: "resolved-user", name: "Resolved User" });
      const runtime = createIntelligenceRuntime(agent, platform, {
        identifyUser,
      });
      const request = createRunRequest({ "X-User-Id": "legacy-user" });

      const response = await handleRunAgent({
        runtime,
        request,
        agentId: "my-agent",
      });

      expect(response.status).toBe(200);
      expect(identifyUser).toHaveBeenCalledTimes(1);
      expect(identifyUser).toHaveBeenCalledWith(request);
      expect(platform.getOrCreateThread).toHaveBeenCalledWith({
        threadId: "thread-1",
        userId: "resolved-user",
        agentId: "my-agent",
      });
      expect(platform.ɵacquireThreadLock).toHaveBeenCalledWith({
        threadId: "thread-1",
        runId: "run-1",
        userId: "resolved-user",
        agentId: "my-agent",
        ttlSeconds: 20,
      });
    });

    it("resolves one trusted learning container assignment and forwards its exact UUID", async () => {
      const learningContainerId = "11111111-1111-4111-8111-111111111111";
      const agent = createAgentForIntelligence();
      const platform = {
        getOrCreateThread: vi.fn().mockResolvedValue({
          thread: {
            id: "thread-1",
            name: null,
            learningContainerId,
            assignmentRevision: 3,
          },
          created: false,
        }),
        getThreadMessages: vi.fn().mockResolvedValue({ messages: [] }),
        ɵacquireThreadLock: vi.fn().mockResolvedValue({
          threadId: "thread-1",
          runId: "run-1",
          joinToken: "jt-123",
          learningContainerId,
          assignmentRevision: 3,
        }),
        ɵcleanupThreadLock: vi.fn().mockResolvedValue(undefined),
      };
      const trustedUser = { id: "trusted-user", name: "Trusted User" };
      const identifyUser = vi.fn().mockResolvedValue(trustedUser);
      const resolveLearningContainer = vi
        .fn()
        .mockResolvedValue(learningContainerId);
      const runtime = createIntelligenceRuntime(agent, platform, {
        identifyUser,
        resolveLearningContainer,
      });
      const request = createRunRequest({
        "X-Learning-Container-Id": "22222222-2222-4222-8222-222222222222",
      });

      const response = await handleRunAgent({
        runtime,
        request,
        agentId: "my-agent",
      });

      expect(response.status).toBe(200);
      expect(resolveLearningContainer).toHaveBeenCalledTimes(1);
      expect(resolveLearningContainer).toHaveBeenCalledWith({
        request,
        threadId: "thread-1",
        agentId: "my-agent",
        user: trustedUser,
      });
      expect(platform.getOrCreateThread).toHaveBeenCalledWith({
        threadId: "thread-1",
        userId: "trusted-user",
        agentId: "my-agent",
        learningContainerId,
      });
      expect(platform.ɵacquireThreadLock).toHaveBeenCalledWith({
        threadId: "thread-1",
        runId: "run-1",
        userId: "trusted-user",
        agentId: "my-agent",
        learningContainerId,
        ttlSeconds: 20,
      });
    });

    it("forwards an explicit null learning container assignment", async () => {
      const agent = createAgentForIntelligence();
      const platform = {
        getOrCreateThread: vi.fn().mockResolvedValue({
          thread: {
            id: "thread-1",
            name: null,
            learningContainerId: null,
            assignmentRevision: 0,
          },
          created: false,
        }),
        getThreadMessages: vi.fn().mockResolvedValue({ messages: [] }),
        ɵacquireThreadLock: vi.fn().mockResolvedValue({
          threadId: "thread-1",
          runId: "run-1",
          joinToken: "jt-123",
          learningContainerId: null,
          assignmentRevision: 0,
        }),
        ɵcleanupThreadLock: vi.fn().mockResolvedValue(undefined),
      };
      const runtime = createIntelligenceRuntime(agent, platform, {
        resolveLearningContainer: vi.fn().mockResolvedValue(null),
      });

      const response = await handleRunAgent({
        runtime,
        request: createRunRequest(),
        agentId: "my-agent",
      });

      expect(response.status).toBe(200);
      expect(platform.getOrCreateThread).toHaveBeenCalledWith(
        expect.objectContaining({ learningContainerId: null }),
      );
      expect(platform.ɵacquireThreadLock).toHaveBeenCalledWith(
        expect.objectContaining({ learningContainerId: null }),
      );
    });

    it("rejects an invalid resolved learning container before platform writes", async () => {
      const agent = createAgentForIntelligence();
      const platform = {
        getOrCreateThread: vi.fn(),
        ɵacquireThreadLock: vi.fn(),
      };
      const runtime = createIntelligenceRuntime(agent, platform, {
        resolveLearningContainer: vi.fn().mockResolvedValue("not-a-uuid"),
      });

      const response = await handleRunAgent({
        runtime,
        request: createRunRequest(),
        agentId: "my-agent",
      });

      expect(response.status).toBe(500);
      expect(platform.getOrCreateThread).not.toHaveBeenCalled();
      expect(platform.ɵacquireThreadLock).not.toHaveBeenCalled();
      expect(runtime.runner.run).not.toHaveBeenCalled();
    });

    it("stops before platform writes when learning container resolution fails", async () => {
      const agent = createAgentForIntelligence();
      const platform = {
        getOrCreateThread: vi.fn(),
        ɵacquireThreadLock: vi.fn(),
      };
      const runtime = createIntelligenceRuntime(agent, platform, {
        resolveLearningContainer: vi
          .fn()
          .mockRejectedValue(new Error("assignment lookup failed")),
      });

      const response = await handleRunAgent({
        runtime,
        request: createRunRequest(),
        agentId: "my-agent",
      });

      expect(response.status).toBe(500);
      expect(platform.getOrCreateThread).not.toHaveBeenCalled();
      expect(platform.ɵacquireThreadLock).not.toHaveBeenCalled();
      expect(runtime.runner.run).not.toHaveBeenCalled();
    });

    it.each([
      ["missing assignment", { assignmentRevision: 1 }],
      [
        "malformed assignment",
        { learningContainerId: "not-a-uuid", assignmentRevision: 1 },
      ],
      [
        "missing revision",
        { learningContainerId: "11111111-1111-4111-8111-111111111111" },
      ],
      [
        "malformed revision",
        {
          learningContainerId: "11111111-1111-4111-8111-111111111111",
          assignmentRevision: -1,
        },
      ],
      [
        "unsafe revision",
        {
          learningContainerId: "11111111-1111-4111-8111-111111111111",
          assignmentRevision: Number.MAX_SAFE_INTEGER + 1,
        },
      ],
    ])(
      "returns 502 before lock acquisition when the thread echo has %s",
      async (_caseName, assignmentFields) => {
        const learningContainerId = "11111111-1111-4111-8111-111111111111";
        const agent = createAgentForIntelligence();
        const platform = {
          getOrCreateThread: vi.fn().mockResolvedValue({
            thread: { id: "thread-1", name: null, ...assignmentFields },
            created: false,
          }),
          ɵacquireThreadLock: vi.fn(),
        };
        const runtime = createIntelligenceRuntime(agent, platform, {
          resolveLearningContainer: vi
            .fn()
            .mockResolvedValue(learningContainerId),
        });

        const response = await handleRunAgent({
          runtime,
          request: createRunRequest(),
          agentId: "my-agent",
        });

        expect(response.status).toBe(502);
        expect(platform.ɵacquireThreadLock).not.toHaveBeenCalled();
        expect(runtime.runner.run).not.toHaveBeenCalled();
      },
    );

    it("returns 409 before lock acquisition when the thread echo mismatches", async () => {
      const agent = createAgentForIntelligence();
      const platform = {
        getOrCreateThread: vi.fn().mockResolvedValue({
          thread: {
            id: "thread-1",
            name: null,
            learningContainerId: "22222222-2222-4222-8222-222222222222",
            assignmentRevision: 1,
          },
          created: false,
        }),
        ɵacquireThreadLock: vi.fn(),
      };
      const runtime = createIntelligenceRuntime(agent, platform, {
        resolveLearningContainer: vi
          .fn()
          .mockResolvedValue("11111111-1111-4111-8111-111111111111"),
      });

      const response = await handleRunAgent({
        runtime,
        request: createRunRequest(),
        agentId: "my-agent",
      });

      expect(response.status).toBe(409);
      expect(platform.ɵacquireThreadLock).not.toHaveBeenCalled();
      expect(runtime.runner.run).not.toHaveBeenCalled();
    });

    it.each([
      ["missing assignment", { assignmentRevision: 1 }],
      [
        "malformed assignment",
        { learningContainerId: "not-a-uuid", assignmentRevision: 1 },
      ],
      [
        "missing revision",
        { learningContainerId: "11111111-1111-4111-8111-111111111111" },
      ],
      [
        "malformed revision",
        {
          learningContainerId: "11111111-1111-4111-8111-111111111111",
          assignmentRevision: 1.5,
        },
      ],
      [
        "unsafe revision",
        {
          learningContainerId: "11111111-1111-4111-8111-111111111111",
          assignmentRevision: Number.MAX_SAFE_INTEGER + 1,
        },
      ],
    ])(
      "returns 502 and cleans the lock when the lock echo has %s",
      async (_caseName, assignmentFields) => {
        const learningContainerId = "11111111-1111-4111-8111-111111111111";
        const agent = createAgentForIntelligence();
        const platform = {
          getOrCreateThread: vi.fn().mockResolvedValue({
            thread: {
              id: "thread-1",
              name: null,
              learningContainerId,
              assignmentRevision: 1,
            },
            created: false,
          }),
          getThreadMessages: vi.fn().mockResolvedValue({ messages: [] }),
          ɵacquireThreadLock: vi.fn().mockResolvedValue({
            threadId: "thread-1",
            runId: "run-1",
            joinToken: "jt-123",
            ...assignmentFields,
          }),
          ɵcleanupThreadLock: vi.fn().mockResolvedValue(undefined),
        };
        const runtime = createIntelligenceRuntime(agent, platform, {
          resolveLearningContainer: vi
            .fn()
            .mockResolvedValue(learningContainerId),
        });

        const response = await handleRunAgent({
          runtime,
          request: createRunRequest(),
          agentId: "my-agent",
        });

        expect(response.status).toBe(502);
        expect(platform.ɵcleanupThreadLock).toHaveBeenCalledWith({
          threadId: "thread-1",
          runId: "run-1",
          userId: "user-1",
          agentId: "my-agent",
        });
        expect(runtime.runner.run).not.toHaveBeenCalled();
      },
    );

    it("returns 409 and cleans the lock when the lock echo mismatches", async () => {
      const learningContainerId = "11111111-1111-4111-8111-111111111111";
      const agent = createAgentForIntelligence();
      const platform = {
        getOrCreateThread: vi.fn().mockResolvedValue({
          thread: {
            id: "thread-1",
            name: null,
            learningContainerId,
            assignmentRevision: 1,
          },
          created: false,
        }),
        ɵacquireThreadLock: vi.fn().mockResolvedValue({
          threadId: "thread-1",
          runId: "run-1",
          joinToken: "jt-123",
          learningContainerId: "22222222-2222-4222-8222-222222222222",
          assignmentRevision: 1,
        }),
        ɵcleanupThreadLock: vi.fn().mockResolvedValue(undefined),
      };
      const runtime = createIntelligenceRuntime(agent, platform, {
        resolveLearningContainer: vi
          .fn()
          .mockResolvedValue(learningContainerId),
      });

      const response = await handleRunAgent({
        runtime,
        request: createRunRequest(),
        agentId: "my-agent",
      });

      expect(response.status).toBe(409);
      expect(platform.ɵcleanupThreadLock).toHaveBeenCalledWith({
        threadId: "thread-1",
        runId: "run-1",
        userId: "user-1",
        agentId: "my-agent",
      });
      expect(runtime.runner.run).not.toHaveBeenCalled();
    });

    it("starts the runner with canonical threadId and runId from the lock response", async () => {
      const agent = createAgentForIntelligence();
      const platform = {
        getOrCreateThread: vi.fn().mockResolvedValue({
          thread: { id: "thread-1", name: null },
          created: false,
        }),
        getThreadMessages: vi.fn().mockResolvedValue({ messages: [] }),
        ɵacquireThreadLock: vi.fn().mockResolvedValue({
          threadId: "canonical-thread",
          runId: "canonical-run",
          joinToken: "jt-456",
        }),
      };
      const runtime = createIntelligenceRuntime(agent, platform);

      await handleRunAgent({
        runtime,
        request: createRunRequest(),
        agentId: "my-agent",
      });

      expect(runtime.runner.run).toHaveBeenCalledWith(
        expect.objectContaining({
          threadId: "canonical-thread",
          input: expect.objectContaining({
            threadId: "canonical-thread",
            runId: "canonical-run",
          }),
        }),
      );
    });

    it("cleans up the lock and returns 502 when joinToken is missing", async () => {
      const agent = createAgentForIntelligence();
      const platform = {
        getOrCreateThread: vi.fn().mockResolvedValue({
          thread: { id: "thread-1", name: null },
          created: false,
        }),
        getThreadMessages: vi.fn().mockResolvedValue({ messages: [] }),
        ɵacquireThreadLock: vi.fn().mockResolvedValue({
          threadId: "thread-1",
          runId: "run-1",
        }),
        ɵcleanupThreadLock: vi.fn().mockResolvedValue(undefined),
      };
      const runtime = createIntelligenceRuntime(agent, platform);

      const response = await handleRunAgent({
        runtime,
        request: createRunRequest(),
        agentId: "my-agent",
      });

      expect(response.status).toBe(502);
      const body = await response.json();
      expect(body.error).toBe("Run connection credentials not available");
      expect(platform.ɵcleanupThreadLock).toHaveBeenCalledWith({
        threadId: "thread-1",
        runId: "run-1",
        userId: "user-1",
        agentId: "my-agent",
      });
      expect(runtime.runner.run).not.toHaveBeenCalled();
    });

    it("uses the requested lock owner when malformed credentials omit canonical IDs", async () => {
      const agent = createAgentForIntelligence();
      const platform = {
        getOrCreateThread: vi.fn().mockResolvedValue({
          thread: { id: "thread-1", name: null },
          created: false,
        }),
        getThreadMessages: vi.fn().mockResolvedValue({ messages: [] }),
        ɵacquireThreadLock: vi.fn().mockResolvedValue({
          joinToken: "jt-123",
        }),
        ɵcleanupThreadLock: vi.fn().mockResolvedValue(undefined),
      };
      const runtime = createIntelligenceRuntime(agent, platform);

      const response = await handleRunAgent({
        runtime,
        request: createRunRequest(),
        agentId: "my-agent",
      });

      expect(response.status).toBe(502);
      expect(platform.ɵcleanupThreadLock).toHaveBeenCalledWith({
        threadId: "thread-1",
        runId: "run-1",
        userId: "user-1",
        agentId: "my-agent",
      });
      expect(runtime.runner.run).not.toHaveBeenCalled();
    });

    it("returns 409 when thread lock is denied", async () => {
      const agent = createAgentForIntelligence();
      const platform = {
        getOrCreateThread: vi.fn().mockResolvedValue({
          thread: { id: "thread-1", name: null },
          created: false,
        }),
        getThreadMessages: vi.fn(),
        ɵacquireThreadLock: vi
          .fn()
          .mockRejectedValue(new Error("Thread is locked by another runner")),
      };
      const runtime = createIntelligenceRuntime(agent, platform);

      const response = await handleRunAgent({
        runtime,
        request: createRunRequest(),
        agentId: "my-agent",
      });

      expect(response.status).toBe(409);
      const body = await response.json();
      expect(body.error).toBe("Thread lock denied");
    });

    it("cleans up the canonical lock and returns 502 when runner start fails immediately", async () => {
      const agent = createAgentForIntelligence();
      const platform = {
        getOrCreateThread: vi.fn().mockResolvedValue({
          thread: { id: "thread-1", name: null },
          created: false,
        }),
        getThreadMessages: vi.fn().mockResolvedValue({ messages: [] }),
        ɵacquireThreadLock: vi.fn().mockResolvedValue({
          threadId: "canonical-thread",
          runId: "canonical-run",
          joinToken: "jt-123",
        }),
        ɵcleanupThreadLock: vi.fn().mockResolvedValue(undefined),
      };
      const runtime = createIntelligenceRuntime(agent, platform);
      runtime.runner.run = vi.fn(
        () =>
          new Observable<BaseEvent>((subscriber) => {
            subscriber.next({
              type: EventType.RUN_ERROR,
              message: "join failed",
            } as BaseEvent);
            subscriber.complete();
          }),
      );

      const response = await handleRunAgent({
        runtime,
        request: createRunRequest(),
        agentId: "my-agent",
      });

      expect(response.status).toBe(502);
      const body = await response.json();
      expect(body).toEqual({
        error: "Failed to start runner",
        message: "join failed",
      });
      expect(platform.ɵcleanupThreadLock).toHaveBeenCalledWith({
        threadId: "canonical-thread",
        runId: "canonical-run",
        userId: "user-1",
        agentId: "my-agent",
      });
      expect(platform.ɵcleanupThreadLock).toHaveBeenCalledTimes(1);
    });

    it("delays the run success response until the runner startup boundary resolves", async () => {
      const agent = createAgentForIntelligence();
      let resolveStartup: (() => void) | undefined;
      const startup = new Promise<void>((resolve) => {
        resolveStartup = resolve;
      });
      const platform = {
        getOrCreateThread: vi.fn().mockResolvedValue({
          thread: { id: "thread-1", name: null },
          created: false,
        }),
        getThreadMessages: vi.fn().mockResolvedValue({ messages: [] }),
        ɵacquireThreadLock: vi.fn().mockResolvedValue({
          threadId: "canonical-thread",
          runId: "canonical-run",
          joinToken: "jt-123",
        }),
        ɵcleanupThreadLock: vi.fn().mockResolvedValue(undefined),
      };
      const runtime = createIntelligenceRuntime(agent, platform);
      (runtime.runner as IntelligenceAgentRunner).runWithStartupBoundary =
        vi.fn(() => ({
          events: new Observable<BaseEvent>(() => {}),
          startup,
        }));
      let settled = false;

      const responsePromise = handleRunAgent({
        runtime,
        request: createRunRequest(),
        agentId: "my-agent",
      }).then((response) => {
        settled = true;
        return response;
      });

      await Promise.resolve();

      expect(settled).toBe(false);

      resolveStartup?.();
      const response = await responsePromise;

      expect(response.status).toBe(200);
      expect(
        (runtime.runner as IntelligenceAgentRunner).runWithStartupBoundary,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          threadId: "canonical-thread",
          input: expect.objectContaining({
            threadId: "canonical-thread",
            runId: "canonical-run",
          }),
        }),
      );
    });

    it("cleans up the lock and returns 502 when the runner startup boundary rejects", async () => {
      const agent = createAgentForIntelligence();
      const platform = {
        getOrCreateThread: vi.fn().mockResolvedValue({
          thread: { id: "thread-1", name: null },
          created: false,
        }),
        getThreadMessages: vi.fn().mockResolvedValue({ messages: [] }),
        ɵacquireThreadLock: vi.fn().mockResolvedValue({
          threadId: "canonical-thread",
          runId: "canonical-run",
          joinToken: "jt-123",
        }),
        ɵcleanupThreadLock: vi.fn().mockResolvedValue(undefined),
      };
      const runtime = createIntelligenceRuntime(agent, platform);
      (runtime.runner as IntelligenceAgentRunner).runWithStartupBoundary =
        vi.fn(() => ({
          events: new Observable<BaseEvent>(() => {}),
          startup: Promise.reject(new Error("Failed to join channel: denied")),
        }));

      const response = await handleRunAgent({
        runtime,
        request: createRunRequest(),
        agentId: "my-agent",
      });

      expect(response.status).toBe(502);
      const body = await response.json();
      expect(body).toEqual({
        error: "Failed to start runner",
        message: "Failed to join channel: denied",
      });
      expect(platform.ɵcleanupThreadLock).toHaveBeenCalledWith({
        threadId: "canonical-thread",
        runId: "canonical-run",
        userId: "user-1",
        agentId: "my-agent",
      });
      expect(platform.ɵcleanupThreadLock).toHaveBeenCalledTimes(1);
    });

    it("aborts the agent when lock renewal fails", async () => {
      vi.useFakeTimers();
      const runningAgent = {
        clone: vi.fn(),
        setMessages: vi.fn(),
        setState: vi.fn(),
        abortRun: vi.fn(),
        threadId: undefined,
        headers: {},
        runAgent: vi.fn().mockResolvedValue(undefined),
      } as unknown as AbstractAgent;
      const baseAgent = {
        clone: vi.fn(() => runningAgent),
        setMessages: vi.fn(),
        setState: vi.fn(),
        abortRun: vi.fn(),
        threadId: undefined,
        headers: {},
        runAgent: vi.fn().mockResolvedValue(undefined),
      } as unknown as AbstractAgent;
      const platform = {
        getOrCreateThread: vi.fn().mockResolvedValue({
          thread: { id: "thread-1", name: null },
          created: false,
        }),
        getThreadMessages: vi.fn().mockResolvedValue({ messages: [] }),
        ɵacquireThreadLock: vi.fn().mockResolvedValue({
          threadId: "canonical-thread",
          runId: "canonical-run",
          joinToken: "jt-123",
        }),
        ɵrenewThreadLock: vi.fn().mockRejectedValue(new Error("lost lock")),
      };
      const runtime = createIntelligenceRuntime(baseAgent, platform, {
        lockHeartbeatIntervalSeconds: 1,
        lockTtlSeconds: 5,
      });
      runtime.runner.run = vi.fn(() => new Observable<BaseEvent>(() => {}));

      try {
        const response = await handleRunAgent({
          runtime,
          request: createRunRequest(),
          agentId: "my-agent",
        });
        expect(response.status).toBe(200);

        await vi.advanceTimersByTimeAsync(1_000);

        expect(platform.ɵrenewThreadLock).toHaveBeenCalledWith({
          threadId: "canonical-thread",
          runId: "canonical-run",
          userId: "user-1",
          agentId: "my-agent",
          ttlSeconds: 5,
        });
        expect(runningAgent.abortRun).toHaveBeenCalledTimes(1);
      } finally {
        vi.useRealTimers();
      }
    });

    it("passes only unseen input messages to the runner for durable persistence", async () => {
      const agent = createAgentForIntelligence();
      const platform = {
        getOrCreateThread: vi.fn().mockResolvedValue({
          thread: { id: "thread-1", name: null },
          created: false,
        }),
        getThreadMessages: vi.fn().mockResolvedValue({
          messages: [
            {
              id: "msg-existing",
              role: "user",
              content: "First turn",
            },
          ],
        }),
        ɵacquireThreadLock: vi.fn().mockResolvedValue({
          threadId: "thread-1",
          runId: "run-1",
          joinToken: "jt-123",
        }),
      };
      const runtime = createIntelligenceRuntime(agent, platform);
      const response = await handleRunAgent({
        runtime,
        request: new Request("https://example.com/agent/my-agent/run", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            threadId: "thread-1",
            runId: "run-1",
            state: {},
            messages: [
              {
                id: "msg-existing",
                role: "user",
                content: "First turn",
              },
              {
                id: "msg-new",
                role: "user",
                content: "Second turn",
              },
            ],
            tools: [],
            context: [],
            forwardedProps: {},
          }),
        }),
        agentId: "my-agent",
      });

      expect(response.status).toBe(200);
      expect(runtime.runner.run).toHaveBeenCalledWith(
        expect.objectContaining({
          persistedInputMessages: [
            {
              id: "msg-new",
              role: "user",
              content: "Second turn",
            },
          ],
        }),
      );
    });

    it("returns 502 when durable thread history lookup fails", async () => {
      const agent = createAgentForIntelligence();
      const platform = {
        getOrCreateThread: vi.fn().mockResolvedValue({
          thread: { id: "thread-1", name: null },
          created: false,
        }),
        getThreadMessages: vi
          .fn()
          .mockRejectedValue(new Error("history unavailable")),
        ɵacquireThreadLock: vi.fn().mockResolvedValue({
          threadId: "thread-1",
          runId: "run-1",
          joinToken: "jt-123",
        }),
        ɵcleanupThreadLock: vi.fn().mockResolvedValue(undefined),
      };
      const runtime = createIntelligenceRuntime(agent, platform);

      const response = await handleRunAgent({
        runtime,
        request: createRunRequest(),
        agentId: "my-agent",
      });

      expect(response.status).toBe(502);
      const body = await response.json();
      expect(body.error).toBe("Thread history lookup failed");
      expect(platform.ɵcleanupThreadLock).toHaveBeenCalledWith({
        threadId: "thread-1",
        runId: "run-1",
        userId: "user-1",
        agentId: "my-agent",
      });
      expect(runtime.runner.run).not.toHaveBeenCalled();
    });

    it("creates the thread before locking when run targets a fresh thread", async () => {
      const agent = createAgentForIntelligence();
      const platform = {
        getOrCreateThread: vi.fn().mockResolvedValue({
          thread: { id: "thread-1", name: null },
          created: true,
        }),
        getThreadMessages: vi.fn().mockResolvedValue({ messages: [] }),
        ɵacquireThreadLock: vi.fn().mockResolvedValue({
          threadId: "thread-1",
          runId: "run-1",
          joinToken: "jt-created",
        }),
      };
      const runtime = createIntelligenceRuntime(agent, platform);

      const response = await handleRunAgent({
        runtime,
        request: createRunRequest(),
        agentId: "my-agent",
      });

      expect(response.status).toBe(200);
      expect(platform.getOrCreateThread).toHaveBeenCalledWith({
        threadId: "thread-1",
        userId: "user-1",
        agentId: "my-agent",
      });
      expect(platform.ɵacquireThreadLock).toHaveBeenCalledWith({
        threadId: "thread-1",
        runId: "run-1",
        userId: "user-1",
        agentId: "my-agent",
        ttlSeconds: 20,
      });
    });

    it("generates and persists a thread name in the background for new unnamed threads", async () => {
      const namingAgent = {
        clone: vi.fn(),
        setMessages: vi.fn(),
        setState: vi.fn(),
        threadId: undefined,
        headers: {},
        runAgent: vi.fn().mockResolvedValue({
          newMessages: [
            {
              id: "assistant-1",
              role: "assistant",
              content: '{"title":"**Order refund** status"}',
            },
            {
              id: "tool-1",
              role: "tool",
              content: '{"timezone":"UTC","iso":"2026-06-01T00:00:00Z"}',
            },
          ],
        }),
      } as unknown as AbstractAgent;
      const baseAgent = {
        clone: vi
          .fn()
          .mockReturnValueOnce({
            clone: vi.fn(),
            setMessages: vi.fn(),
            setState: vi.fn(),
            threadId: undefined,
            headers: {},
            runAgent: vi.fn().mockResolvedValue(undefined),
          })
          .mockReturnValueOnce(namingAgent),
        setMessages: vi.fn(),
        setState: vi.fn(),
        threadId: undefined,
        headers: {},
        runAgent: vi.fn().mockResolvedValue(undefined),
      } as unknown as AbstractAgent;
      const platform = {
        getOrCreateThread: vi.fn().mockResolvedValue({
          thread: { id: "thread-1", name: null },
          created: true,
        }),
        updateThread: vi.fn().mockResolvedValue({
          id: "thread-1",
          name: "Order refund status",
        }),
        getThreadMessages: vi.fn().mockResolvedValue({ messages: [] }),
        ɵacquireThreadLock: vi.fn().mockResolvedValue({
          threadId: "thread-1",
          runId: "run-1",
          joinToken: "jt-created",
        }),
      };
      const runtime = createIntelligenceRuntime(baseAgent, platform, {
        generateThreadNames: true,
      });
      const response = await handleRunAgent({
        runtime,
        request: new Request("https://example.com/agent/my-agent/run", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            threadId: "thread-1",
            runId: "run-1",
            state: {},
            messages: [
              {
                id: "user-1",
                role: "user",
                content: "Can you help me with my refund request?",
              },
            ],
            tools: [],
            context: [],
            forwardedProps: {},
          }),
        }),
        agentId: "my-agent",
      });

      expect(response.status).toBe(200);
      await vi.waitFor(() =>
        expect(platform.updateThread).toHaveBeenCalledWith({
          threadId: "thread-1",
          userId: "user-1",
          agentId: "my-agent",
          updates: { name: "Order refund status" },
        }),
      );
      expect(runtime.runner.run).toHaveBeenCalledTimes(1);
    });

    it("does not generate a thread name when generateThreadNames is false", async () => {
      const agent = createAgentForIntelligence();
      const platform = {
        getOrCreateThread: vi.fn().mockResolvedValue({
          thread: { id: "thread-1", name: null },
          created: true,
        }),
        updateThread: vi.fn(),
        getThreadMessages: vi.fn().mockResolvedValue({ messages: [] }),
        ɵacquireThreadLock: vi.fn().mockResolvedValue({
          threadId: "thread-1",
          runId: "run-1",
          joinToken: "jt-created",
        }),
      };
      const runtime = createIntelligenceRuntime(agent, platform, {
        generateThreadNames: false,
      });

      const response = await handleRunAgent({
        runtime,
        request: createRunRequest(),
        agentId: "my-agent",
      });

      expect(response.status).toBe(200);
      await Promise.resolve();
      expect(platform.updateThread).not.toHaveBeenCalled();
    });

    it("does not generate a thread name when the created thread already has a name", async () => {
      const agent = createAgentForIntelligence();
      const platform = {
        getOrCreateThread: vi.fn().mockResolvedValue({
          thread: { id: "thread-1", name: "Existing name" },
          created: true,
        }),
        updateThread: vi.fn(),
        getThreadMessages: vi.fn().mockResolvedValue({ messages: [] }),
        ɵacquireThreadLock: vi.fn().mockResolvedValue({
          threadId: "thread-1",
          runId: "run-1",
          joinToken: "jt-created",
        }),
      };
      const runtime = createIntelligenceRuntime(agent, platform, {
        generateThreadNames: true,
      });

      const response = await handleRunAgent({
        runtime,
        request: createRunRequest(),
        agentId: "my-agent",
      });

      expect(response.status).toBe(200);
      await Promise.resolve();
      expect(platform.updateThread).not.toHaveBeenCalled();
    });

    it("retries thread naming three times and falls back to Untitled", async () => {
      const namingAgent = {
        clone: vi.fn(),
        setMessages: vi.fn(),
        setState: vi.fn(),
        threadId: undefined,
        headers: {},
        runAgent: vi.fn().mockRejectedValue(new Error("naming failed")),
      } as unknown as AbstractAgent;
      const baseAgent = {
        clone: vi
          .fn()
          .mockReturnValueOnce({
            clone: vi.fn(),
            setMessages: vi.fn(),
            setState: vi.fn(),
            threadId: undefined,
            headers: {},
            runAgent: vi.fn().mockResolvedValue(undefined),
          })
          .mockReturnValueOnce(namingAgent)
          .mockReturnValueOnce(namingAgent)
          .mockReturnValueOnce(namingAgent),
        setMessages: vi.fn(),
        setState: vi.fn(),
        threadId: undefined,
        headers: {},
        runAgent: vi.fn().mockResolvedValue(undefined),
      } as unknown as AbstractAgent;
      const platform = {
        getOrCreateThread: vi.fn().mockResolvedValue({
          thread: { id: "thread-1", name: null },
          created: true,
        }),
        updateThread: vi.fn(),
        getThreadMessages: vi.fn().mockResolvedValue({ messages: [] }),
        ɵacquireThreadLock: vi.fn().mockResolvedValue({
          threadId: "thread-1",
          runId: "run-1",
          joinToken: "jt-created",
        }),
      };
      const runtime = createIntelligenceRuntime(baseAgent, platform, {
        generateThreadNames: true,
      });
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      try {
        const response = await handleRunAgent({
          runtime,
          request: new Request("https://example.com/agent/my-agent/run", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              threadId: "thread-1",
              runId: "run-1",
              state: {},
              messages: [
                {
                  id: "user-1",
                  role: "user",
                  content: "Please help me name this failed thread.",
                },
              ],
              tools: [],
              context: [],
              forwardedProps: {},
            }),
          }),
          agentId: "my-agent",
        });

        expect(response.status).toBe(200);
        await vi.waitFor(() =>
          expect(platform.updateThread).toHaveBeenCalledWith({
            threadId: "thread-1",
            userId: "user-1",
            agentId: "my-agent",
            updates: { name: "Untitled" },
          }),
        );
        expect(namingAgent.runAgent).toHaveBeenCalledTimes(3);
        expect(runtime.runner.run).toHaveBeenCalledTimes(1);
      } finally {
        errorSpy.mockRestore();
      }
    });

    it("returns 400 when identifyUser returns an invalid id", async () => {
      const agent = createAgentForIntelligence();
      const platform = {
        getOrCreateThread: vi.fn(),
        getThreadMessages: vi.fn(),
        ɵacquireThreadLock: vi.fn(),
      };
      const runtime = createIntelligenceRuntime(agent, platform, {
        identifyUser: vi.fn().mockResolvedValue({ id: "", name: "User" }),
      });

      const response = await handleRunAgent({
        runtime,
        request: createRunRequest(),
        agentId: "my-agent",
      });

      expect(response.status).toBe(400);
      expect(platform.getOrCreateThread).not.toHaveBeenCalled();
      expect(platform.ɵacquireThreadLock).not.toHaveBeenCalled();
    });

    it("returns 400 when identifyUser returns an invalid name", async () => {
      const agent = createAgentForIntelligence();
      const platform = {
        getOrCreateThread: vi.fn(),
        getThreadMessages: vi.fn(),
        ɵacquireThreadLock: vi.fn(),
      };
      const runtime = createIntelligenceRuntime(agent, platform, {
        identifyUser: vi.fn().mockResolvedValue({ id: "user-1", name: "" }),
      });

      const response = await handleRunAgent({
        runtime,
        request: createRunRequest(),
        agentId: "my-agent",
      });

      expect(response.status).toBe(400);
      expect(platform.getOrCreateThread).not.toHaveBeenCalled();
      expect(platform.ɵacquireThreadLock).not.toHaveBeenCalled();
    });

    it("returns 500 when identifyUser throws", async () => {
      const agent = createAgentForIntelligence();
      const platform = {
        getOrCreateThread: vi.fn(),
        getThreadMessages: vi.fn(),
        ɵacquireThreadLock: vi.fn(),
      };
      const runtime = createIntelligenceRuntime(agent, platform, {
        identifyUser: vi.fn().mockRejectedValue(new Error("auth failed")),
      });
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      try {
        const response = await handleRunAgent({
          runtime,
          request: createRunRequest(),
          agentId: "my-agent",
        });

        expect(response.status).toBe(500);
        expect(platform.getOrCreateThread).not.toHaveBeenCalled();
        expect(platform.ɵacquireThreadLock).not.toHaveBeenCalled();
      } finally {
        errorSpy.mockRestore();
      }
    });
  });

  describe("telemetry", () => {
    it("captures oss.runtime.copilot_request_created on every invocation", async () => {
      // Dynamic import so we spy on the module singleton the handler uses.
      const { telemetry } = await import("../telemetry");
      const captureSpy = vi
        .spyOn(telemetry, "capture")
        .mockResolvedValue(undefined);

      try {
        const runtime = createMockRuntime({});
        await handleRunAgent({
          runtime,
          request: createMockRequest(),
          agentId: "nonexistent-agent",
        });

        expect(captureSpy).toHaveBeenCalledWith(
          "oss.runtime.copilot_request_created",
          expect.objectContaining({
            requestType: "run",
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
        const request = new Request("https://example.com/agent/test/run", {
          method: "POST",
          headers: {
            "x-copilotcloud-public-api-key": "ck_pub_run_test",
          },
        });

        await handleRunAgent({
          runtime,
          request,
          agentId: "nonexistent-agent",
        });

        expect(captureSpy).toHaveBeenCalledWith(
          "oss.runtime.copilot_request_created",
          expect.objectContaining({
            "cloud.api_key_provided": true,
            "cloud.public_api_key": "ck_pub_run_test",
          }),
        );
      } finally {
        captureSpy.mockRestore();
      }
    });
  });

  describe("agentId tagging on cloned agents", () => {
    /**
     * Pins handle-run.ts:40 — `agent.agentId = agentId` is set on the clone
     * BEFORE the agent reaches the runner. Without it, InMemoryAgentRunner
     * falls back to "default" when stamping historic runs, and listThreads
     * returns rows with the wrong agentId. This breaks the agentId filter
     * in `GET /threads?agentId=...` for the local-dev fallback.
     *
     * This test runs the full flow through InMemoryAgentRunner with an
     * AbstractAgent whose own `agentId` field is undefined (matches the
     * shape after `clone()` returns a fresh instance), and asserts the
     * runner records the registry key, NOT "default".
     */
    class TaggingTestAgent extends AbstractAgent {
      run(_input: RunAgentInput): Observable<BaseEvent> {
        return EMPTY;
      }

      async runAgent(
        _input: RunAgentInput,
        options: { onEvent: (event: { event: BaseEvent }) => void },
      ): Promise<RunAgentResult> {
        // Emit a single TEXT_MESSAGE_END event so the run produces at least
        // one event and gets persisted to historicRuns. RUN_STARTED /
        // RUN_FINISHED are appended by the runner itself.
        options.onEvent({
          event: {
            type: EventType.TEXT_MESSAGE_END,
            messageId: "msg-1",
          } as BaseEvent,
        });
        return { result: undefined, newMessages: [] };
      }

      clone(): AbstractAgent {
        // The fresh clone has NO agentId — the only way the runner can know
        // the registry key is if handle-run.ts:40 stamps it before the run.
        return new TaggingTestAgent();
      }
    }

    const createRunRequestForAgent = (agentId: string, threadId: string) =>
      new Request(`https://example.com/agent/${agentId}/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          threadId,
          runId: `run-${threadId}`,
          state: {},
          messages: [],
          tools: [],
          context: [],
          forwardedProps: {},
        }),
      });

    it("propagates the registry agentId onto historic runs (NOT 'default')", async () => {
      const runner = new InMemoryAgentRunner();
      const agent = new TaggingTestAgent();
      const runtime = new CopilotRuntime({
        agents: { tagged: agent },
        runner,
      });

      // Use a unique threadId so this test does not collide with other
      // tests that share the InMemoryAgentRunner GLOBAL_STORE.
      const threadId = `thread-tagged-${Date.now()}-${Math.random()}`;

      const response = await handleRunAgent({
        runtime,
        request: createRunRequestForAgent("tagged", threadId),
        agentId: "tagged",
      });
      expect(response.status).toBe(200);

      // Drain the SSE stream so the underlying observable run completes —
      // historicRuns is only populated AFTER the run finalizes.
      const reader = response.body!.getReader();
      while (true) {
        const { done } = await reader.read();
        if (done) break;
      }

      const threads = runner.listThreads();
      const thisThread = threads.find((t) => t.id === threadId);
      expect(thisThread).toBeDefined();
      expect(thisThread!.agentId).toBe("tagged");
      // Negative assertion locks the regression: a future change that drops
      // the `agent.agentId = agentId` line in handle-run will surface as
      // "default" here, not as a missing thread.
      expect(thisThread!.agentId).not.toBe("default");
    });
  });
});
