/**
 * The owner check that guards the Intelligence `_inspect` events and state
 * reads, and error handling on the local thread routes (T10).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { logger } from "@copilotkit/shared";
import {
  handleClearThreads,
  handleGetThreadEvents,
  handleGetThreadMessages,
  handleGetThreadState,
  handleListThreads,
} from "../handlers/handle-threads";
import { CopilotRuntime } from "../core/runtime";
import { InMemoryAgentRunner } from "../runner/in-memory";
import { PlatformRequestError } from "../intelligence-platform/client";

afterEach(() => {
  vi.restoreAllMocks();
});

function intelligenceRuntime(intelligence: Record<string, unknown>) {
  return {
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
    identifyUser: vi.fn().mockResolvedValue({ id: "user-1", name: "User One" }),
    intelligence,
  } as unknown as CopilotRuntime;
}

const request = () => new Request("https://example.com/threads/x/events");

const inspect = [
  ["events", handleGetThreadEvents, "getThreadEvents"],
  ["state", handleGetThreadState, "getThreadState"],
] as const;

describe.each(inspect)("Intelligence %s read", (_name, handler, method) => {
  const inspectResult =
    method === "getThreadEvents"
      ? { events: [], truncated: false }
      : { kind: "no-snapshot" };

  it("checks the user's thread, then reads it by its canonical id", async () => {
    const intelligence = {
      getThread: vi.fn().mockResolvedValue({ id: "canonical-1", name: null }),
      [method]: vi.fn().mockResolvedValue(inspectResult),
    };
    const response = await handler({
      runtime: intelligenceRuntime(intelligence),
      request: request(),
      threadId: "alias-1",
    });
    expect(response.status).toBe(200);
    expect(intelligence.getThread).toHaveBeenCalledWith({
      threadId: "alias-1",
      userId: "user-1",
    });
    expect(intelligence[method]).toHaveBeenCalledWith(
      expect.objectContaining({ threadId: "canonical-1" }),
    );
  });

  it("answers 404 for a thread the user cannot see, logged as a warning", async () => {
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => undefined);
    const error = vi.spyOn(logger, "error").mockImplementation(() => undefined);
    const intelligence = {
      getThread: vi
        .fn()
        .mockRejectedValue(new PlatformRequestError("Thread not found.", 404)),
      [method]: vi.fn(),
    };
    const response = await handler({
      runtime: intelligenceRuntime(intelligence),
      request: request(),
      threadId: "foreign-1",
    });
    expect(response.status).toBe(404);
    expect(intelligence[method]).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });

  it.each([
    ["an empty id", { id: "" }],
    ["no thread", null],
  ])(
    "answers 502 and logs an error when getThread returns %s",
    async (_label, thread) => {
      const error = vi
        .spyOn(logger, "error")
        .mockImplementation(() => undefined);
      const intelligence = {
        getThread: vi.fn().mockResolvedValue(thread),
        [method]: vi.fn(),
      };
      const response = await handler({
        runtime: intelligenceRuntime(intelligence),
        request: request(),
        threadId: "t-1",
      });
      expect(response.status).toBe(502);
      expect(await response.json()).toEqual({
        error: "Invalid thread response",
      });
      expect(intelligence[method]).not.toHaveBeenCalled();
      expect(error).toHaveBeenCalled();
    },
  );

  it("answers 502 and logs an error when the platform fails", async () => {
    const error = vi.spyOn(logger, "error").mockImplementation(() => undefined);
    const intelligence = {
      getThread: vi
        .fn()
        .mockRejectedValue(new PlatformRequestError("upstream down", 503)),
      [method]: vi.fn(),
    };
    const response = await handler({
      runtime: intelligenceRuntime(intelligence),
      request: request(),
      threadId: "t-1",
    });
    expect(response.status).toBe(502);
    expect(intelligence[method]).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalled();
  });
});

describe("local thread routes when the runner throws", () => {
  function localRuntime() {
    const runner = new InMemoryAgentRunner();
    const runtime = new CopilotRuntime({
      agents: {},
      runner,
      threads: { access: "open" },
    });
    return { runner, runtime };
  }

  it.each([
    [
      "list",
      "listThreads",
      (runtime: CopilotRuntime) =>
        handleListThreads({
          runtime,
          request: new Request("https://example.com/threads"),
        }),
      "Failed to list threads",
    ],
    [
      "clear",
      "clearThreads",
      (runtime: CopilotRuntime) =>
        handleClearThreads({
          runtime,
          request: new Request("https://example.com/threads/clear", {
            method: "POST",
          }),
        }),
      "Failed to clear threads",
    ],
    [
      "messages",
      "getThreadMessages",
      (runtime: CopilotRuntime) =>
        handleGetThreadMessages({
          runtime,
          request: new Request("https://example.com/threads/t/messages"),
          threadId: "t",
        }),
      "Failed to fetch thread messages",
    ],
  ] as const)(
    "%s answers 500 with a logged error",
    async (_route, method, call, message) => {
      const error = vi
        .spyOn(logger, "error")
        .mockImplementation(() => undefined);
      const { runner, runtime } = localRuntime();
      vi.spyOn(runner, method).mockImplementation(() => {
        throw new Error("store broke");
      });
      const response = await call(runtime);
      expect(response.status).toBe(500);
      expect(await response.json()).toEqual({ error: message });
      expect(error).toHaveBeenCalled();
    },
  );
});
