import { describe, expect, it, vi } from "vitest";

import { handleListMemories } from "../handlers/handle-memories";
import { CopilotRuntime } from "../core/runtime";

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
    expect(intelligence.listMemories).toHaveBeenCalledWith({ userId: "user-1" });
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

  it("returns 500 when the platform call throws", async () => {
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
});
