import { describe, expect, it, vi } from "vitest";

import {
  handleArchiveThread,
  handleDeleteThread,
  handleListThreads,
  handleSubscribeToThreads,
  handleUpdateThread,
} from "../handlers/handle-threads";
import { CopilotRuntime } from "../core/runtime";

describe("thread handlers", () => {
  const createIdentifyUser = () => vi.fn().mockResolvedValue({ id: "user-1" });

  const createIntelligenceRuntime = (options?: {
    identifyUser?: (
      request: Request,
    ) => { id: string } | Promise<{ id: string }>;
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
      identifyUser: vi.fn().mockResolvedValue({ id: "" }),
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
      identifyUser: vi.fn().mockResolvedValue({ id: "" }),
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
});
