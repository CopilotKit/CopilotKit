import { Observable } from "rxjs";
import { describe, it, expect, vi } from "vitest";
import { AbstractAgent, HttpAgent } from "@ag-ui/client";
import { A2UIMiddleware } from "@ag-ui/a2ui-middleware";
import { handleRunAgent } from "../handlers/handle-run";
import { CopilotRuntime } from "../core/runtime";
import { IntelligenceAgentRunner } from "../runner/intelligence";

describe("handleRunAgent", () => {
  const createMockRuntime = (
    agents: Record<string, unknown> = {},
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
      runner: createMockRunner(),
    } as unknown as CopilotRuntime;

    await handleRunAgent({
      runtime,
      request: createRunRequest(),
      agentId: "my-agent",
    });

    expect(useSpy).not.toHaveBeenCalled();
  });

  describe("IntelligenceAgentRunner join code path", () => {
    /** Loose mock type for CopilotKitIntelligence — avoids `as any` while the class has private fields. */
    interface MockIntelligencePlatform {
      [key: string]: ((...args: any[]) => any) | undefined;
    }

    const createIntelligenceRuntime = (
      agent: AbstractAgent,
      platform?: MockIntelligencePlatform,
      options?: {
        generateThreadNames?: boolean;
        identifyUser?: (
          request: Request,
        ) =>
          | { id: string; name: string }
          | Promise<{ id: string; name: string }>;
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
        runner,
        mode: "intelligence",
        generateThreadNames: options?.generateThreadNames ?? false,
        intelligence: platform,
        identifyUser:
          options?.identifyUser ??
          vi.fn().mockResolvedValue({ id: "user-1", name: "User One" }),
      } as unknown as CopilotRuntime;
    };

    const createAgentForIntelligence = () => {
      const createClone = () =>
        ({
          clone: vi.fn(() => createClone()),
          setMessages: vi.fn(),
          setState: vi.fn(),
          threadId: undefined,
          headers: {},
          runAgent: vi.fn().mockResolvedValue(undefined),
        }) as unknown as AbstractAgent;

      const agent = {
        clone: vi.fn(() => createClone()),
        setMessages: vi.fn(),
        setState: vi.fn(),
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
        ɵacquireThreadLock: vi
          .fn()
          .mockResolvedValue({ joinToken: "jt-123", joinCode: "jc-123" }),
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
      expect(body).toEqual({ joinToken: "jt-123" });
      expect(platform.getOrCreateThread).toHaveBeenCalledWith({
        threadId: "thread-1",
        userId: "user-1",
        agentId: "my-agent",
      });
      expect(platform.ɵacquireThreadLock).toHaveBeenCalledWith({
        threadId: "thread-1",
        runId: "run-1",
        userId: "user-1",
      });
      expect(platform.getThreadMessages).toHaveBeenCalledWith({
        threadId: "thread-1",
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
        ɵacquireThreadLock: vi
          .fn()
          .mockResolvedValue({ joinToken: "jt-123", joinCode: "jc-123" }),
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
      });
    });

    it("passes joinCode to runner.run() when provided", async () => {
      const agent = createAgentForIntelligence();
      const platform = {
        getOrCreateThread: vi.fn().mockResolvedValue({
          thread: { id: "thread-1", name: null },
          created: false,
        }),
        getThreadMessages: vi.fn().mockResolvedValue({ messages: [] }),
        ɵacquireThreadLock: vi
          .fn()
          .mockResolvedValue({ joinToken: "jt-456", joinCode: "jc-456" }),
      };
      const runtime = createIntelligenceRuntime(agent, platform);

      await handleRunAgent({
        runtime,
        request: createRunRequest(),
        agentId: "my-agent",
      });

      expect(runtime.runner.run).toHaveBeenCalledWith(
        expect.objectContaining({ joinCode: "jc-456" }),
      );
    });

    it("returns 502 when joinToken is missing", async () => {
      const agent = createAgentForIntelligence();
      const platform = {
        getOrCreateThread: vi.fn().mockResolvedValue({
          thread: { id: "thread-1", name: null },
          created: false,
        }),
        getThreadMessages: vi.fn().mockResolvedValue({ messages: [] }),
        ɵacquireThreadLock: vi.fn().mockResolvedValue({ joinCode: "jc-789" }),
      };
      const runtime = createIntelligenceRuntime(agent, platform);

      const response = await handleRunAgent({
        runtime,
        request: createRunRequest(),
        agentId: "my-agent",
      });

      expect(response.status).toBe(502);
      const body = await response.json();
      expect(body.error).toBe("Join token not available");
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
        ɵacquireThreadLock: vi
          .fn()
          .mockResolvedValue({ joinToken: "jt-123", joinCode: "jc-123" }),
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
        ɵacquireThreadLock: vi
          .fn()
          .mockResolvedValue({ joinToken: "jt-123", joinCode: "jc-123" }),
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
          joinToken: "jt-created",
          joinCode: "jc-created",
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
          joinToken: "jt-created",
          joinCode: "jc-created",
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
          joinToken: "jt-created",
          joinCode: "jc-created",
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
          joinToken: "jt-created",
          joinCode: "jc-created",
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
          joinToken: "jt-created",
          joinCode: "jc-created",
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
});
