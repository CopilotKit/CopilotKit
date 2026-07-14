import { describe, expect, it, vi } from "vitest";

import {
  handleListMemories,
  handleRecallMemories,
  handleSubscribeToMemories,
  handleCreateMemory,
  handleUpdateMemory,
  handleRemoveMemory,
} from "../handlers/handle-memories";
import { CopilotRuntime } from "../core/runtime";
import { PlatformRequestError } from "../intelligence-platform/client";

describe("memory handlers", () => {
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
      runner: {
        run: vi.fn(),
        connect: vi.fn(),
        isRunning: vi.fn(),
        stop: vi.fn(),
      },
      mode: "intelligence",
      identifyUser: options?.identifyUser ?? createIdentifyUser(),
      intelligence: options?.intelligence,
    }) as unknown as CopilotRuntime;

  it("returns 422 when intelligence is not configured", async () => {
    const runtime = new CopilotRuntime({ agents: {} });

    const response = await handleListMemories({
      runtime,
      request: new Request("https://example.com/memories"),
    });

    expect(response.status).toBe(422);
  });

  it("lists memories using identifyUser (never a client-supplied id)", async () => {
    const intelligence = {
      listMemories: vi.fn().mockResolvedValue({
        memories: [
          {
            id: "m-1",
            kind: "topical",
            scope: "user",
            content: "User's dog is called Pepe.",
            sourceThreadIds: [],
            invalidatedAt: null,
          },
        ],
      }),
    };
    const identifyUser = createIdentifyUser();
    const runtime = createIntelligenceRuntime({ intelligence, identifyUser });
    const request = new Request("https://example.com/memories");

    const response = await handleListMemories({ runtime, request });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      memories: [
        {
          id: "m-1",
          kind: "topical",
          scope: "user",
          content: "User's dog is called Pepe.",
          sourceThreadIds: [],
          invalidatedAt: null,
        },
      ],
    });
    expect(identifyUser).toHaveBeenCalledTimes(1);
    expect(identifyUser).toHaveBeenCalledWith(request);
    expect(intelligence.listMemories).toHaveBeenCalledWith({
      userId: "user-1",
    });
  });

  it("forwards includeInvalidated=true to the platform", async () => {
    const intelligence = {
      listMemories: vi.fn().mockResolvedValue({ memories: [] }),
    };
    const runtime = createIntelligenceRuntime({ intelligence });

    const response = await handleListMemories({
      runtime,
      request: new Request(
        "https://example.com/memories?includeInvalidated=true",
      ),
    });

    expect(response.status).toBe(200);
    expect(intelligence.listMemories).toHaveBeenCalledWith({
      userId: "user-1",
      includeInvalidated: true,
    });
  });

  it("returns 500 when the platform call throws a non-platform error", async () => {
    const intelligence = {
      listMemories: vi.fn().mockRejectedValue(new Error("platform down")),
    };
    const runtime = createIntelligenceRuntime({ intelligence });

    const response = await handleListMemories({
      runtime,
      request: new Request("https://example.com/memories"),
    });

    expect(response.status).toBe(500);
  });

  it("forwards a PlatformRequestError status instead of collapsing to 500", async () => {
    const intelligence = {
      listMemories: vi
        .fn()
        .mockRejectedValue(new PlatformRequestError("nope", 404)),
    };
    const runtime = createIntelligenceRuntime({ intelligence });

    const response = await handleListMemories({
      runtime,
      request: new Request("https://example.com/memories"),
    });

    expect(response.status).toBe(404);
  });

  it("maps a platform 5xx to 502 (dependency failed, not the runtime's own fault)", async () => {
    const intelligence = {
      listMemories: vi
        .fn()
        .mockRejectedValue(new PlatformRequestError("boom", 503)),
    };
    const runtime = createIntelligenceRuntime({ intelligence });

    const response = await handleListMemories({
      runtime,
      request: new Request("https://example.com/memories"),
    });

    expect(response.status).toBe(502);
  });

  const jsonRequest = (
    path: string,
    method: "POST" | "PATCH" | "DELETE",
    body?: Record<string, unknown>,
  ) =>
    new Request(`https://example.com${path}`, {
      method,
      headers: { "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });

  it("creates a memory via identifyUser and returns 201", async () => {
    const intelligence = {
      createMemory: vi.fn().mockResolvedValue({
        id: "m-new",
        kind: "topical",
        scope: "user",
        content: "User plays bass.",
        sourceThreadIds: [],
        invalidatedAt: null,
      }),
    };
    const identifyUser = createIdentifyUser();
    const runtime = createIntelligenceRuntime({ intelligence, identifyUser });
    const request = jsonRequest("/memories", "POST", {
      content: "User plays bass.",
      kind: "topical",
      scope: "user",
    });

    const response = await handleCreateMemory({ runtime, request });

    expect(response.status).toBe(201);
    expect(identifyUser).toHaveBeenCalledWith(request);
    expect(intelligence.createMemory).toHaveBeenCalledWith({
      userId: "user-1",
      content: "User plays bass.",
      kind: "topical",
      scope: "user",
    });
  });

  it("forwards a valid sourceThreadIds string array to createMemory", async () => {
    const intelligence = {
      createMemory: vi.fn().mockResolvedValue({
        id: "m-new",
        kind: "topical",
        scope: "user",
        content: "User plays bass.",
        sourceThreadIds: ["t1", "t2"],
        invalidatedAt: null,
      }),
    };
    const runtime = createIntelligenceRuntime({ intelligence });

    const response = await handleCreateMemory({
      runtime,
      request: jsonRequest("/memories", "POST", {
        content: "User plays bass.",
        kind: "topical",
        scope: "user",
        sourceThreadIds: ["t1", "t2"],
      }),
    });

    expect(response.status).toBe(201);
    expect(intelligence.createMemory).toHaveBeenCalledWith({
      userId: "user-1",
      content: "User plays bass.",
      kind: "topical",
      scope: "user",
      sourceThreadIds: ["t1", "t2"],
    });
  });

  it("returns 400 and does not call createMemory for a non-string sourceThreadIds element", async () => {
    const intelligence = { createMemory: vi.fn() };
    const runtime = createIntelligenceRuntime({ intelligence });

    const response = await handleCreateMemory({
      runtime,
      request: jsonRequest("/memories", "POST", {
        content: "User plays bass.",
        kind: "topical",
        scope: "user",
        sourceThreadIds: [1, 2],
      }),
    });

    expect(response.status).toBe(400);
    expect(intelligence.createMemory).not.toHaveBeenCalled();
  });

  it("returns 400 and does not call updateMemory for a non-string sourceThreadIds element on supersede", async () => {
    const intelligence = { updateMemory: vi.fn() };
    const runtime = createIntelligenceRuntime({ intelligence });

    const response = await handleUpdateMemory({
      runtime,
      request: jsonRequest("/memories/m-1", "PATCH", {
        content: "updated",
        kind: "topical",
        scope: "user",
        sourceThreadIds: ["t1", 3],
      }),
      memoryId: "m-1",
    });

    expect(response.status).toBe(400);
    expect(intelligence.updateMemory).not.toHaveBeenCalled();
  });

  it("returns 400 and does not call createMemory for an out-of-vocabulary kind", async () => {
    const intelligence = { createMemory: vi.fn() };
    const runtime = createIntelligenceRuntime({ intelligence });

    const response = await handleCreateMemory({
      runtime,
      request: jsonRequest("/memories", "POST", {
        content: "x",
        kind: "bogus",
        scope: "user",
      }),
    });

    expect(response.status).toBe(400);
    expect(intelligence.createMemory).not.toHaveBeenCalled();
  });

  it("returns 400 and does not call createMemory for an out-of-vocabulary scope", async () => {
    const intelligence = { createMemory: vi.fn() };
    const runtime = createIntelligenceRuntime({ intelligence });

    const response = await handleCreateMemory({
      runtime,
      request: jsonRequest("/memories", "POST", {
        content: "x",
        kind: "topical",
        scope: "global",
      }),
    });

    expect(response.status).toBe(400);
    expect(intelligence.createMemory).not.toHaveBeenCalled();
  });

  it("returns 502 when the platform list response has no memories array", async () => {
    const intelligence = {
      // Platform contract violation: no `memories` array.
      listMemories: vi.fn().mockResolvedValue({ items: [] }),
    };
    const runtime = createIntelligenceRuntime({ intelligence });

    const response = await handleListMemories({
      runtime,
      request: new Request("https://example.com/memories"),
    });

    expect(response.status).toBe(502);
  });

  it("omits scope when the create body has none (platform applies its default)", async () => {
    const intelligence = {
      createMemory: vi.fn().mockResolvedValue({
        id: "m-new",
        kind: "topical",
        scope: "user",
        content: "User plays bass.",
        sourceThreadIds: [],
        invalidatedAt: null,
      }),
    };
    const runtime = createIntelligenceRuntime({ intelligence });

    const response = await handleCreateMemory({
      runtime,
      request: jsonRequest("/memories", "POST", {
        content: "User plays bass.",
        kind: "topical",
      }),
    });

    expect(response.status).toBe(201);
    expect(intelligence.createMemory).toHaveBeenCalledWith({
      userId: "user-1",
      content: "User plays bass.",
      kind: "topical",
    });
  });

  it("forwards a PlatformRequestError status on supersede (e.g. 404 wrong-scope target)", async () => {
    const intelligence = {
      updateMemory: vi
        .fn()
        .mockRejectedValue(new PlatformRequestError("not found", 404)),
    };
    const runtime = createIntelligenceRuntime({ intelligence });

    const response = await handleUpdateMemory({
      runtime,
      request: jsonRequest("/memories/m-1", "PATCH", {
        content: "updated",
        kind: "topical",
        scope: "project",
      }),
      memoryId: "m-1",
    });

    expect(response.status).toBe(404);
  });

  it("forwards a 409 conflict on create verbatim (client-actionable)", async () => {
    const intelligence = {
      createMemory: vi
        .fn()
        .mockRejectedValue(new PlatformRequestError("conflict", 409)),
    };
    const runtime = createIntelligenceRuntime({ intelligence });

    const response = await handleCreateMemory({
      runtime,
      request: jsonRequest("/memories", "POST", {
        content: "x",
        kind: "topical",
        scope: "user",
      }),
    });

    expect(response.status).toBe(409);
  });

  it("returns 400 on a create body missing required fields", async () => {
    const intelligence = { createMemory: vi.fn() };
    const runtime = createIntelligenceRuntime({ intelligence });

    const response = await handleCreateMemory({
      runtime,
      request: jsonRequest("/memories", "POST", { content: "no kind/scope" }),
    });

    expect(response.status).toBe(400);
    expect(intelligence.createMemory).not.toHaveBeenCalled();
  });

  it("supersedes a memory (PATCH) and forwards retiredId", async () => {
    const intelligence = {
      updateMemory: vi.fn().mockResolvedValue({
        id: "m-2",
        kind: "topical",
        scope: "user",
        content: "updated",
        sourceThreadIds: [],
        invalidatedAt: null,
        retiredId: "m-1",
      }),
    };
    const runtime = createIntelligenceRuntime({ intelligence });

    const response = await handleUpdateMemory({
      runtime,
      request: jsonRequest("/memories/m-1", "PATCH", {
        content: "updated",
        kind: "topical",
        scope: "user",
      }),
      memoryId: "m-1",
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      id: "m-2",
      retiredId: "m-1",
    });
    expect(intelligence.updateMemory).toHaveBeenCalledWith({
      userId: "user-1",
      id: "m-1",
      content: "updated",
      kind: "topical",
      scope: "user",
    });
  });

  it("removes a memory (DELETE) and returns 204", async () => {
    const intelligence = { removeMemory: vi.fn().mockResolvedValue(undefined) };
    const runtime = createIntelligenceRuntime({ intelligence });

    const response = await handleRemoveMemory({
      runtime,
      request: jsonRequest("/memories/m-1", "DELETE"),
      memoryId: "m-1",
    });

    expect(response.status).toBe(204);
    expect(intelligence.removeMemory).toHaveBeenCalledWith({
      userId: "user-1",
      id: "m-1",
    });
  });

  it("returns 422 for create when intelligence is not configured", async () => {
    const runtime = new CopilotRuntime({ agents: {} });

    const response = await handleCreateMemory({
      runtime,
      request: jsonRequest("/memories", "POST", {
        content: "x",
        kind: "topical",
        scope: "user",
      }),
    });

    expect(response.status).toBe(422);
  });

  it("subscribes to memories via identifyUser and returns joinToken + joinCode", async () => {
    const intelligence = {
      ɵsubscribeToMemories: vi
        .fn()
        .mockResolvedValue({ joinToken: "jt-1", joinCode: "jc-1" }),
    };
    const identifyUser = createIdentifyUser();
    const runtime = createIntelligenceRuntime({ intelligence, identifyUser });
    const request = jsonRequest("/memories/subscribe", "POST");

    const response = await handleSubscribeToMemories({ runtime, request });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      joinToken: "jt-1",
      joinCode: "jc-1",
    });
    expect(identifyUser).toHaveBeenCalledWith(request);
    expect(intelligence.ɵsubscribeToMemories).toHaveBeenCalledWith({
      userId: "user-1",
    });
  });

  it("forwards project credentials when the platform mints them", async () => {
    const intelligence = {
      ɵsubscribeToMemories: vi.fn().mockResolvedValue({
        joinToken: "jt-1",
        joinCode: "jc-1",
        projectJoinToken: "pjt-1",
        projectJoinCode: "pjc-1",
      }),
    };
    const identifyUser = createIdentifyUser();
    const runtime = createIntelligenceRuntime({ intelligence, identifyUser });
    const request = jsonRequest("/memories/subscribe", "POST");

    const response = await handleSubscribeToMemories({ runtime, request });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      joinToken: "jt-1",
      joinCode: "jc-1",
      projectJoinToken: "pjt-1",
      projectJoinCode: "pjc-1",
    });
  });

  it("omits project credentials when the platform does not mint them", async () => {
    const intelligence = {
      ɵsubscribeToMemories: vi
        .fn()
        .mockResolvedValue({ joinToken: "jt-1", joinCode: "jc-1" }),
    };
    const identifyUser = createIdentifyUser();
    const runtime = createIntelligenceRuntime({ intelligence, identifyUser });
    const request = jsonRequest("/memories/subscribe", "POST");

    const response = await handleSubscribeToMemories({ runtime, request });

    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    // Silent-degrade: the keys are absent, not present-with-undefined.
    expect(body).toEqual({ joinToken: "jt-1", joinCode: "jc-1" });
    expect(body).not.toHaveProperty("projectJoinToken");
    expect(body).not.toHaveProperty("projectJoinCode");
  });

  it("returns 422 for subscribe when intelligence is not configured", async () => {
    const runtime = new CopilotRuntime({ agents: {} });

    const response = await handleSubscribeToMemories({
      runtime,
      request: jsonRequest("/memories/subscribe", "POST"),
    });

    expect(response.status).toBe(422);
  });

  it("recalls memories via identifyUser and returns the scored envelope", async () => {
    const intelligence = {
      recallMemories: vi.fn().mockResolvedValue({
        memories: [
          {
            id: "m-1",
            kind: "topical",
            scope: "user",
            content: "User likes jazz.",
            sourceThreadIds: [],
            invalidatedAt: null,
            score: 0.91,
          },
        ],
      }),
    };
    const identifyUser = createIdentifyUser();
    const runtime = createIntelligenceRuntime({ intelligence, identifyUser });
    const request = jsonRequest("/memories/recall", "POST", {
      query: "music taste",
      limit: 3,
      scope: "user",
    });

    const response = await handleRecallMemories({ runtime, request });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      memories: [
        {
          id: "m-1",
          kind: "topical",
          scope: "user",
          content: "User likes jazz.",
          sourceThreadIds: [],
          invalidatedAt: null,
          score: 0.91,
        },
      ],
    });
    expect(identifyUser).toHaveBeenCalledWith(request);
    expect(intelligence.recallMemories).toHaveBeenCalledWith({
      userId: "user-1",
      query: "music taste",
      limit: 3,
      scope: "user",
    });
  });

  it("omits limit/scope when the recall body has none", async () => {
    const intelligence = {
      recallMemories: vi.fn().mockResolvedValue({ memories: [] }),
    };
    const runtime = createIntelligenceRuntime({ intelligence });

    const response = await handleRecallMemories({
      runtime,
      request: jsonRequest("/memories/recall", "POST", { query: "hi" }),
    });

    expect(response.status).toBe(200);
    expect(intelligence.recallMemories).toHaveBeenCalledWith({
      userId: "user-1",
      query: "hi",
    });
  });

  it("returns 400 when recall query is missing", async () => {
    const intelligence = { recallMemories: vi.fn() };
    const runtime = createIntelligenceRuntime({ intelligence });

    const response = await handleRecallMemories({
      runtime,
      request: jsonRequest("/memories/recall", "POST", { limit: 3 }),
    });

    expect(response.status).toBe(400);
    expect(intelligence.recallMemories).not.toHaveBeenCalled();
  });

  it("returns 400 for an out-of-vocabulary recall scope", async () => {
    const intelligence = { recallMemories: vi.fn() };
    const runtime = createIntelligenceRuntime({ intelligence });

    const response = await handleRecallMemories({
      runtime,
      request: jsonRequest("/memories/recall", "POST", {
        query: "hi",
        scope: "global",
      }),
    });

    expect(response.status).toBe(400);
    expect(intelligence.recallMemories).not.toHaveBeenCalled();
  });

  it("returns 400 for a non-number recall limit", async () => {
    const intelligence = { recallMemories: vi.fn() };
    const runtime = createIntelligenceRuntime({ intelligence });

    const response = await handleRecallMemories({
      runtime,
      request: jsonRequest("/memories/recall", "POST", {
        query: "hi",
        limit: "3",
      }),
    });

    expect(response.status).toBe(400);
    expect(intelligence.recallMemories).not.toHaveBeenCalled();
  });

  it("returns 422 for recall when intelligence is not configured", async () => {
    const runtime = new CopilotRuntime({ agents: {} });

    const response = await handleRecallMemories({
      runtime,
      request: jsonRequest("/memories/recall", "POST", { query: "hi" }),
    });

    expect(response.status).toBe(422);
  });

  it("forwards a PlatformRequestError 4xx on recall verbatim", async () => {
    const intelligence = {
      recallMemories: vi
        .fn()
        .mockRejectedValue(new PlatformRequestError("bad", 422)),
    };
    const runtime = createIntelligenceRuntime({ intelligence });

    const response = await handleRecallMemories({
      runtime,
      request: jsonRequest("/memories/recall", "POST", { query: "hi" }),
    });

    expect(response.status).toBe(422);
  });

  it("maps a platform 5xx to 502 on recall", async () => {
    const intelligence = {
      recallMemories: vi
        .fn()
        .mockRejectedValue(new PlatformRequestError("boom", 503)),
    };
    const runtime = createIntelligenceRuntime({ intelligence });

    const response = await handleRecallMemories({
      runtime,
      request: jsonRequest("/memories/recall", "POST", { query: "hi" }),
    });

    expect(response.status).toBe(502);
  });

  it("returns 502 when the recall response has no memories array", async () => {
    const intelligence = {
      recallMemories: vi.fn().mockResolvedValue({ items: [] }),
    };
    const runtime = createIntelligenceRuntime({ intelligence });

    const response = await handleRecallMemories({
      runtime,
      request: jsonRequest("/memories/recall", "POST", { query: "hi" }),
    });

    expect(response.status).toBe(502);
  });
});
