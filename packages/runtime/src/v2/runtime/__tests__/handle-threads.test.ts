import { describe, expect, it, vi } from "vitest";

import {
  handleArchiveThread,
  handleClearThreads,
  handleDeleteThread,
  handleGetThreadEvents,
  handleGetThreadMessages,
  handleGetThreadState,
  handleListThreads,
  handleSubscribeToThreads,
  handleUpdateThread,
} from "../handlers/handle-threads";
import { CopilotRuntime } from "../core/runtime";
import { InMemoryAgentRunner } from "../runner/in-memory";

describe("thread handlers", () => {
  const createIdentifyUser = () =>
    vi.fn().mockResolvedValue({ id: "user-1", name: "User One" });

  const createIntelligenceRuntime = (options?: {
    identifyUser?: (
      request: Request,
    ) => { id: string; name: string } | Promise<{ id: string; name: string }>;
    intelligence?: Record<string, unknown>;
  }) =>
    ({
      agents: Promise.resolve({}),
      transcriptionService: undefined,
      beforeRequestMiddleware: undefined,
      afterRequestMiddleware: undefined,
      runner: {
        run: vi.fn(),
        connect: vi.fn(),
        isRunning: vi.fn(),
        stop: vi.fn(),
      },
      mode: "intelligence",
      generateThreadNames: false,
      identifyUser: options?.identifyUser ?? createIdentifyUser(),
      intelligence: options?.intelligence,
    }) as unknown as CopilotRuntime;

  const createMutationRequest = (
    path: string,
    method: "PATCH" | "POST" | "DELETE",
    body: Record<string, unknown>,
  ) =>
    new Request(`https://example.com${path}`, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

  it("returns empty thread list when intelligence is not configured for listThreads", async () => {
    const runtime = new CopilotRuntime({ agents: {} });

    const response = await handleListThreads({
      runtime,
      request: new Request("https://example.com/threads?agentId=agent-1"),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      threads: [],
      nextCursor: null,
    });
  });

  it("lists threads using identifyUser and the request agentId", async () => {
    const intelligence = {
      listThreads: vi.fn().mockResolvedValue({
        threads: [{ id: "thread-1", name: "Hello" }],
        joinCode: "jc-1",
      }),
    };
    const identifyUser = createIdentifyUser();
    const runtime = createIntelligenceRuntime({ intelligence, identifyUser });
    const request = new Request("https://example.com/threads?agentId=agent-1");

    const response = await handleListThreads({
      runtime,
      request,
    });

    expect(response.status).toBe(200);
    expect(identifyUser).toHaveBeenCalledTimes(1);
    expect(identifyUser).toHaveBeenCalledWith(request);
    expect(intelligence.listThreads).toHaveBeenCalledWith({
      userId: "user-1",
      agentId: "agent-1",
    });
  });

  it("returns 400 when identifyUser returns an invalid id for thread list", async () => {
    const intelligence = {
      listThreads: vi.fn(),
    };
    const runtime = createIntelligenceRuntime({
      intelligence,
      identifyUser: vi.fn().mockResolvedValue({ id: "", name: "User" }),
    });

    const response = await handleListThreads({
      runtime,
      request: new Request("https://example.com/threads?agentId=agent-1"),
    });

    expect(response.status).toBe(400);
    expect(intelligence.listThreads).not.toHaveBeenCalled();
  });

  it("returns 400 when identifyUser returns an invalid name for thread list", async () => {
    const intelligence = {
      listThreads: vi.fn(),
    };
    const runtime = createIntelligenceRuntime({
      intelligence,
      identifyUser: vi.fn().mockResolvedValue({ id: "user-1", name: "" }),
    });

    const response = await handleListThreads({
      runtime,
      request: new Request("https://example.com/threads?agentId=agent-1"),
    });

    expect(response.status).toBe(400);
    expect(intelligence.listThreads).not.toHaveBeenCalled();
  });

  it("returns 500 when identifyUser throws for thread subscription", async () => {
    const intelligence = {
      ɵsubscribeToThreads: vi.fn(),
    };
    const runtime = createIntelligenceRuntime({
      intelligence,
      identifyUser: vi.fn().mockRejectedValue(new Error("auth failed")),
    });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      const response = await handleSubscribeToThreads({
        runtime,
        request: new Request("https://example.com/threads/subscribe", {
          method: "POST",
        }),
      });

      expect(response.status).toBe(500);
      expect(intelligence.ɵsubscribeToThreads).not.toHaveBeenCalled();
    } finally {
      errorSpy.mockRestore();
    }
  });

  it("updates, archives, and deletes threads using identifyUser and ignoring request userId", async () => {
    const intelligence = {
      updateThread: vi
        .fn()
        .mockResolvedValue({ id: "thread-1", name: "Renamed" }),
      archiveThread: vi.fn().mockResolvedValue(undefined),
      deleteThread: vi.fn().mockResolvedValue(undefined),
    };
    const identifyUser = createIdentifyUser();
    const runtime = createIntelligenceRuntime({ intelligence, identifyUser });
    const mutationBody = {
      userId: "ignored-user",
      agentId: "agent-1",
      name: "Renamed",
    };

    const updateRequest = createMutationRequest(
      "/threads/thread-1",
      "PATCH",
      mutationBody,
    );
    const updateResponse = await handleUpdateThread({
      runtime,
      request: updateRequest,
      threadId: "thread-1",
    });
    expect(updateResponse.status).toBe(200);
    expect(identifyUser).toHaveBeenCalledWith(updateRequest);
    expect(intelligence.updateThread).toHaveBeenCalledWith({
      threadId: "thread-1",
      userId: "user-1",
      agentId: "agent-1",
      updates: { name: "Renamed" },
    });

    const archiveRequest = createMutationRequest(
      "/threads/thread-1/archive",
      "POST",
      mutationBody,
    );
    const archiveResponse = await handleArchiveThread({
      runtime,
      request: archiveRequest,
      threadId: "thread-1",
    });
    expect(archiveResponse.status).toBe(200);
    expect(identifyUser).toHaveBeenCalledWith(archiveRequest);
    expect(intelligence.archiveThread).toHaveBeenCalledWith({
      threadId: "thread-1",
      userId: "user-1",
      agentId: "agent-1",
    });

    const deleteRequest = createMutationRequest(
      "/threads/thread-1",
      "DELETE",
      mutationBody,
    );
    const deleteResponse = await handleDeleteThread({
      runtime,
      request: deleteRequest,
      threadId: "thread-1",
    });
    expect(deleteResponse.status).toBe(200);
    expect(identifyUser).toHaveBeenCalledWith(deleteRequest);
    expect(identifyUser).toHaveBeenCalledTimes(3);
    expect(intelligence.deleteThread).toHaveBeenCalledWith({
      threadId: "thread-1",
      userId: "user-1",
      agentId: "agent-1",
    });
  });

  it("subscribes to threads using identifyUser", async () => {
    const intelligence = {
      ɵsubscribeToThreads: vi
        .fn()
        .mockResolvedValue({ joinToken: "join-token-1" }),
    };
    const identifyUser = createIdentifyUser();
    const runtime = createIntelligenceRuntime({ intelligence, identifyUser });
    const request = new Request("https://example.com/threads/subscribe", {
      method: "POST",
    });

    const response = await handleSubscribeToThreads({
      runtime,
      request,
    });

    expect(response.status).toBe(200);
    expect(identifyUser).toHaveBeenCalledTimes(1);
    expect(identifyUser).toHaveBeenCalledWith(request);
    await expect(response.json()).resolves.toEqual({
      joinToken: "join-token-1",
    });
    expect(intelligence.ɵsubscribeToThreads).toHaveBeenCalledWith({
      userId: "user-1",
    });
  });

  it("returns 400 when agentId is invalid for thread mutations", async () => {
    const intelligence = {
      updateThread: vi.fn(),
    };
    const runtime = createIntelligenceRuntime({ intelligence });

    const response = await handleUpdateThread({
      runtime,
      request: new Request("https://example.com/threads/thread-1", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agentId: "" }),
      }),
      threadId: "thread-1",
    });

    expect(response.status).toBe(400);
    expect(intelligence.updateThread).not.toHaveBeenCalled();
  });

  it("returns 400 when identifyUser returns an invalid id for thread mutations", async () => {
    const intelligence = {
      updateThread: vi.fn(),
      archiveThread: vi.fn(),
      deleteThread: vi.fn(),
    };
    const runtime = createIntelligenceRuntime({
      intelligence,
      identifyUser: vi.fn().mockResolvedValue({ id: "", name: "User" }),
    });

    const updateResponse = await handleUpdateThread({
      runtime,
      request: createMutationRequest("/threads/thread-1", "PATCH", {
        agentId: "agent-1",
      }),
      threadId: "thread-1",
    });
    expect(updateResponse.status).toBe(400);

    const archiveResponse = await handleArchiveThread({
      runtime,
      request: createMutationRequest("/threads/thread-1/archive", "POST", {
        agentId: "agent-1",
      }),
      threadId: "thread-1",
    });
    expect(archiveResponse.status).toBe(400);

    const deleteResponse = await handleDeleteThread({
      runtime,
      request: createMutationRequest("/threads/thread-1", "DELETE", {
        agentId: "agent-1",
      }),
      threadId: "thread-1",
    });
    expect(deleteResponse.status).toBe(400);

    expect(intelligence.updateThread).not.toHaveBeenCalled();
    expect(intelligence.archiveThread).not.toHaveBeenCalled();
    expect(intelligence.deleteThread).not.toHaveBeenCalled();
  });

  it("returns 400 when identifyUser returns an invalid name for thread mutations", async () => {
    const intelligence = {
      updateThread: vi.fn(),
      archiveThread: vi.fn(),
      deleteThread: vi.fn(),
    };
    const runtime = createIntelligenceRuntime({
      intelligence,
      identifyUser: vi.fn().mockResolvedValue({ id: "user-1", name: "" }),
    });

    const updateResponse = await handleUpdateThread({
      runtime,
      request: createMutationRequest("/threads/thread-1", "PATCH", {
        agentId: "agent-1",
      }),
      threadId: "thread-1",
    });
    expect(updateResponse.status).toBe(400);

    const archiveResponse = await handleArchiveThread({
      runtime,
      request: createMutationRequest("/threads/thread-1/archive", "POST", {
        agentId: "agent-1",
      }),
      threadId: "thread-1",
    });
    expect(archiveResponse.status).toBe(400);

    const deleteResponse = await handleDeleteThread({
      runtime,
      request: createMutationRequest("/threads/thread-1", "DELETE", {
        agentId: "agent-1",
      }),
      threadId: "thread-1",
    });
    expect(deleteResponse.status).toBe(400);

    expect(intelligence.updateThread).not.toHaveBeenCalled();
    expect(intelligence.archiveThread).not.toHaveBeenCalled();
    expect(intelligence.deleteThread).not.toHaveBeenCalled();
  });

  it("returns 422 when intelligence is not configured for thread mutations", async () => {
    const runtime = new CopilotRuntime({ agents: {} });
    const mutationRequest = new Request(
      "https://example.com/threads/thread-1",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: "user-1", agentId: "agent-1" }),
      },
    );

    const updateResponse = await handleUpdateThread({
      runtime,
      request: mutationRequest.clone(),
      threadId: "thread-1",
    });
    expect(updateResponse.status).toBe(422);

    const archiveResponse = await handleArchiveThread({
      runtime,
      request: mutationRequest.clone(),
      threadId: "thread-1",
    });
    expect(archiveResponse.status).toBe(422);

    const deleteResponse = await handleDeleteThread({
      runtime,
      request: mutationRequest.clone(),
      threadId: "thread-1",
    });
    expect(deleteResponse.status).toBe(422);
  });

  describe("handleClearThreads", () => {
    it("clears in-memory threads and returns 204 for InMemoryAgentRunner", () => {
      const runner = new InMemoryAgentRunner();
      const clearThreadsSpy = vi.spyOn(runner, "clearThreads");
      const runtime = new CopilotRuntime({ agents: {}, runner });

      const response = handleClearThreads({
        runtime,
        request: new Request("https://example.com/threads"),
      });

      expect(response.status).toBe(204);
      expect(clearThreadsSpy).toHaveBeenCalledTimes(1);
    });

    it("returns 204 without touching state when intelligence runtime is configured", () => {
      const intelligence = { listThreads: vi.fn() };
      const runtime = createIntelligenceRuntime({ intelligence });

      const response = handleClearThreads({
        runtime,
        request: new Request("https://example.com/threads"),
      });

      expect(response.status).toBe(204);
      expect(intelligence.listThreads).not.toHaveBeenCalled();
    });
  });

  describe("handleGetThreadMessages", () => {
    it("returns messages from the in-memory runner for a known thread", async () => {
      const runner = new InMemoryAgentRunner();
      vi.spyOn(runner, "getThreadMessages").mockReturnValue([
        { id: "m1", role: "user", content: "hello" } as never,
        { id: "m2", role: "assistant", content: "hi there" } as never,
      ]);
      const runtime = new CopilotRuntime({ agents: {}, runner });

      const response = await handleGetThreadMessages({
        runtime,
        request: new Request("https://example.com/threads/thread-1/messages"),
        threadId: "thread-1",
      });

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.messages).toHaveLength(2);
      expect(body.messages[0]).toMatchObject({
        id: "m1",
        role: "user",
        content: "hello",
      });
      expect(body.messages[1]).toMatchObject({
        id: "m2",
        role: "assistant",
        content: "hi there",
      });
    });

    it("returns empty messages for an unknown threadId", async () => {
      const runtime = new CopilotRuntime({ agents: {} });

      const response = await handleGetThreadMessages({
        runtime,
        request: new Request(
          "https://example.com/threads/nonexistent/messages",
        ),
        threadId: "nonexistent",
      });

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.messages).toEqual([]);
    });

    it("delegates to intelligence.getThreadMessages when intelligence is configured", async () => {
      const intelligence = {
        getThreadMessages: vi
          .fn()
          .mockResolvedValue({ messages: [{ id: "m1" }] }),
      };
      const identifyUser = createIdentifyUser();
      const runtime = createIntelligenceRuntime({ intelligence, identifyUser });

      const response = await handleGetThreadMessages({
        runtime,
        request: new Request("https://example.com/threads/thread-1/messages"),
        threadId: "thread-1",
      });

      expect(response.status).toBe(200);
      expect(intelligence.getThreadMessages).toHaveBeenCalledWith({
        threadId: "thread-1",
      });
      expect(identifyUser).toHaveBeenCalledTimes(1);
      expect(identifyUser).toHaveBeenCalledWith(
        expect.objectContaining({ url: expect.stringContaining("thread-1") }),
      );
    });

    it("returns 500 when identifyUser throws for getThreadMessages", async () => {
      const intelligence = {
        getThreadMessages: vi.fn(),
      };
      const runtime = createIntelligenceRuntime({
        intelligence,
        identifyUser: vi.fn().mockRejectedValue(new Error("auth failed")),
      });

      const response = await handleGetThreadMessages({
        runtime,
        request: new Request("https://example.com/threads/thread-1/messages"),
        threadId: "thread-1",
      });

      expect(response.status).toBe(500);
      expect(intelligence.getThreadMessages).not.toHaveBeenCalled();
    });

    it("returns 422 when neither in-memory nor intelligence is configured", async () => {
      // A CopilotRuntime with no runner defaults to InMemoryAgentRunner,
      // so simulate a non-InMemory, non-intelligence setup via a custom runner stub.
      // Use the intelligence path but omit intelligence config.
      const runtime = createIntelligenceRuntime({ intelligence: undefined });

      const response = await handleGetThreadMessages({
        runtime,
        request: new Request("https://example.com/threads/thread-1/messages"),
        threadId: "thread-1",
      });

      expect(response.status).toBe(422);
    });

    it("maps tool-call and tool-result messages from the in-memory runner without as-never casts", async () => {
      const runner = new InMemoryAgentRunner();
      const messages = [
        {
          id: "m1",
          role: "assistant" as const,
          toolCalls: [
            {
              id: "tc-1",
              type: "function" as const,
              function: { name: "get_weather", arguments: '{"city":"Paris"}' },
            },
          ],
        },
        {
          id: "m2",
          role: "tool" as const,
          toolCallId: "tc-1",
          content: '{"temp":18}',
        },
      ];
      vi.spyOn(runner, "getThreadMessages").mockReturnValue(messages);
      const runtime = new CopilotRuntime({ agents: {}, runner });

      const response = await handleGetThreadMessages({
        runtime,
        request: new Request("https://example.com/threads/thread-1/messages"),
        threadId: "thread-1",
      });

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.messages).toHaveLength(2);

      const assistantMsg = body.messages[0];
      expect(assistantMsg.role).toBe("assistant");
      expect(assistantMsg.toolCalls).toHaveLength(1);
      expect(assistantMsg.toolCalls[0]).toMatchObject({
        id: "tc-1",
        name: "get_weather",
        args: '{"city":"Paris"}',
      });

      const toolResultMsg = body.messages[1];
      expect(toolResultMsg.role).toBe("tool");
      expect(toolResultMsg.toolCallId).toBe("tc-1");
      expect(toolResultMsg.content).toBe('{"temp":18}');
    });
  });

  it("returns 422 when intelligence is not configured for thread subscription", async () => {
    const runtime = new CopilotRuntime({ agents: {} });

    const response = await handleSubscribeToThreads({
      runtime,
      request: new Request("https://example.com/threads/subscribe", {
        method: "POST",
      }),
    });

    expect(response.status).toBe(422);
  });

  it("forwards includeArchived, limit, and cursor query params to listThreads", async () => {
    const intelligence = {
      listThreads: vi.fn().mockResolvedValue({
        threads: [{ id: "thread-1", name: "Hello" }],
        joinCode: "jc-1",
        nextCursor: "cursor-xyz",
      }),
    };
    const identifyUser = createIdentifyUser();
    const runtime = createIntelligenceRuntime({ intelligence, identifyUser });
    const request = new Request(
      "https://example.com/threads?agentId=agent-1&includeArchived=true&limit=10&cursor=prev-cursor",
    );

    const response = await handleListThreads({ runtime, request });

    expect(response.status).toBe(200);
    expect(intelligence.listThreads).toHaveBeenCalledWith({
      userId: "user-1",
      agentId: "agent-1",
      includeArchived: true,
      limit: 10,
      cursor: "prev-cursor",
    });
    const body = await response.json();
    expect(body.nextCursor).toBe("cursor-xyz");
  });

  it("omits includeArchived, limit, and cursor when not provided", async () => {
    const intelligence = {
      listThreads: vi.fn().mockResolvedValue({
        threads: [],
        joinCode: "jc-1",
      }),
    };
    const identifyUser = createIdentifyUser();
    const runtime = createIntelligenceRuntime({ intelligence, identifyUser });
    const request = new Request("https://example.com/threads?agentId=agent-1");

    await handleListThreads({ runtime, request });

    expect(intelligence.listThreads).toHaveBeenCalledWith({
      userId: "user-1",
      agentId: "agent-1",
    });
  });

  describe("handleGetThreadEvents", () => {
    it("returns events from the in-memory runner for a known thread", async () => {
      const runner = new InMemoryAgentRunner();
      const fakeEvents = [
        { type: "RUN_STARTED", runId: "r1", threadId: "thread-1" },
        {
          type: "TEXT_MESSAGE_START",
          messageId: "m1",
          role: "assistant",
        },
      ];
      vi.spyOn(runner, "getThreadEvents").mockReturnValue(fakeEvents as never);
      const runtime = new CopilotRuntime({ agents: {}, runner });

      const response = await handleGetThreadEvents({
        runtime,
        request: new Request("https://example.com/threads/thread-1/events"),
        threadId: "thread-1",
      });

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.events).toHaveLength(2);
      expect(body.events[0]).toMatchObject({ type: "RUN_STARTED" });
    });

    it("returns empty events for an unknown threadId via the in-memory runner", async () => {
      const runtime = new CopilotRuntime({ agents: {} });

      const response = await handleGetThreadEvents({
        runtime,
        request: new Request("https://example.com/threads/nonexistent/events"),
        threadId: "nonexistent",
      });

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.events).toEqual([]);
    });

    it("returns 501 when intelligence is configured (not yet implemented)", async () => {
      const intelligence = { listThreads: vi.fn() };
      const runtime = createIntelligenceRuntime({ intelligence });

      const response = await handleGetThreadEvents({
        runtime,
        request: new Request("https://example.com/threads/thread-1/events"),
        threadId: "thread-1",
      });

      expect(response.status).toBe(501);
    });

    it("returns 500 when the runner throws", async () => {
      const runner = new InMemoryAgentRunner();
      vi.spyOn(runner, "getThreadEvents").mockImplementation(() => {
        throw new Error("boom");
      });
      const runtime = new CopilotRuntime({ agents: {}, runner });

      const response = await handleGetThreadEvents({
        runtime,
        request: new Request("https://example.com/threads/thread-1/events"),
        threadId: "thread-1",
      });

      expect(response.status).toBe(500);
    });
  });

  describe("handleGetThreadState", () => {
    it("returns the state from the in-memory runner", async () => {
      const runner = new InMemoryAgentRunner();
      const snapshot = { counter: 3, label: "alpha" };
      vi.spyOn(runner, "getThreadState").mockReturnValue(snapshot as never);
      const runtime = new CopilotRuntime({ agents: {}, runner });

      const response = await handleGetThreadState({
        runtime,
        request: new Request("https://example.com/threads/thread-1/state"),
        threadId: "thread-1",
      });

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.state).toEqual(snapshot);
    });

    it("returns state:null when the runner has no snapshot for the thread", async () => {
      const runtime = new CopilotRuntime({ agents: {} });

      const response = await handleGetThreadState({
        runtime,
        request: new Request("https://example.com/threads/nonexistent/state"),
        threadId: "nonexistent",
      });

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.state).toBeNull();
    });

    it("returns 501 when intelligence is configured (not yet implemented)", async () => {
      const intelligence = { listThreads: vi.fn() };
      const runtime = createIntelligenceRuntime({ intelligence });

      const response = await handleGetThreadState({
        runtime,
        request: new Request("https://example.com/threads/thread-1/state"),
        threadId: "thread-1",
      });

      expect(response.status).toBe(501);
    });

    it("returns 500 when the runner throws", async () => {
      const runner = new InMemoryAgentRunner();
      vi.spyOn(runner, "getThreadState").mockImplementation(() => {
        throw new Error("boom");
      });
      const runtime = new CopilotRuntime({ agents: {}, runner });

      const response = await handleGetThreadState({
        runtime,
        request: new Request("https://example.com/threads/thread-1/state"),
        threadId: "thread-1",
      });

      expect(response.status).toBe(500);
    });
  });
});
