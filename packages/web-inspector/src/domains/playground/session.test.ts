import { HttpAgent } from "@ag-ui/client";
import { describe, expect, it, vi } from "vitest";
import { deferred } from "../../testing/deferred.js";
import {
  clearPlaygroundSession,
  createPlaygroundSession,
  createPlaygroundSubscriber,
  loadPlaygroundThread,
  runPlaygroundAgent,
} from "./session.js";
import { createPlaygroundState } from "./state.js";

function createAgent(agentId = "default") {
  return new HttpAgent({
    agentId,
    description: "Test agent",
    url: `http://localhost/agents/${agentId}`,
  });
}

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function createSessionFor(state: ReturnType<typeof createPlaygroundState>) {
  const source = createAgent();
  const session = createPlaygroundSession(state, {
    agents: { default: source },
    runtimeMode: "sse",
    showEphemeralNotice: false,
    createThreadId: () => "scratch-thread",
  });
  if (!session) throw new Error("Expected a Playground session.");
  return session;
}

describe("Playground sessions", () => {
  it("leaves the session unavailable when no agent can be resolved", () => {
    const state = createPlaygroundState();

    expect(
      createPlaygroundSession(state, {
        agents: {},
        runtimeMode: "sse",
        showEphemeralNotice: false,
        createThreadId: () => "scratch-thread",
      }),
    ).toBeNull();
    expect(state.agent).toBeNull();
  });

  it("clones the source agent without mutating its thread or messages", () => {
    const state = createPlaygroundState();
    const source = createAgent();
    source.threadId = "app-thread";
    source.setMessages([{ id: "app-message", role: "user", content: "App" }]);

    const session = createPlaygroundSession(state, {
      agents: { default: source },
      runtimeMode: "sse",
      showEphemeralNotice: false,
      seedMessages: [{ id: "seed-message", role: "user", content: "Scratch" }],
      createThreadId: () => "scratch-thread",
    });

    expect(session?.agent).not.toBe(source);
    expect(session?.agent.threadId).toBe("scratch-thread");
    expect(source.threadId).toBe("app-thread");
    expect(source.messages).toEqual([
      { id: "app-message", role: "user", content: "App" },
    ]);
  });

  it("reports a failed run and clears the busy state", async () => {
    const state = createPlaygroundState();
    createSessionFor(state);

    await runPlaygroundAgent(state, {
      runAgent: () => Promise.reject(new Error("Run unavailable")),
      syncMessages: vi.fn(),
      requestUpdate: vi.fn(),
    });

    expect(state.error).toBe("Run unavailable");
    expect(state.isRunning).toBe(false);
  });

  it("ignores a run completion from a replaced session", async () => {
    const state = createPlaygroundState();
    createSessionFor(state);
    const run = deferred<unknown>();
    const pending = runPlaygroundAgent(state, {
      runAgent: () => run.promise,
      syncMessages: vi.fn(),
      requestUpdate: vi.fn(),
    });

    clearPlaygroundSession(state);
    state.error = "New session state";
    run.reject(new Error("Stale failure"));
    await pending;

    expect(state.error).toBe("New session state");
    expect(state.isRunning).toBe(false);
  });

  it("ignores message callbacks from a replaced session", () => {
    const state = createPlaygroundState();
    const oldSession = createSessionFor(state);
    const syncMessages = vi.fn();
    const subscriber = createPlaygroundSubscriber(state, oldSession.agent, {
      syncMessages,
      requestUpdate: vi.fn(),
    });

    clearPlaygroundSession(state);
    createSessionFor(state);
    subscriber.onMessagesChanged?.({
      agent: oldSession.agent,
      messages: oldSession.agent.messages,
      state: oldSession.agent.state,
    });

    expect(syncMessages).not.toHaveBeenCalled();
  });
});

describe("Playground thread loading", () => {
  it("reports a failed persisted thread load", async () => {
    const state = createPlaygroundState();
    const fetchThread: typeof globalThis.fetch = (input) =>
      Promise.resolve(
        String(input).endsWith("/messages")
          ? jsonResponse({}, 503)
          : jsonResponse({ state: {} }),
      );

    const result = await loadPlaygroundThread(state, {
      thread: { id: "thread-1", agentId: "default" },
      runtimeUrl: "http://localhost/runtime",
      headers: {},
      fetch: fetchThread,
      requestUpdate: vi.fn(),
    });

    expect(result).toBeNull();
    expect(state.error).toBe("Failed to load thread (HTTP 503).");
    expect(state.isLoadingThread).toBe(false);
  });

  it("ignores a thread load completion after the session changes", async () => {
    const state = createPlaygroundState();
    const messages = deferred<Response>();
    const fetchThread: typeof globalThis.fetch = (input) =>
      String(input).endsWith("/messages")
        ? messages.promise
        : Promise.resolve(jsonResponse({ state: { topic: "old" } }));
    const pending = loadPlaygroundThread(state, {
      thread: { id: "thread-1", agentId: "default" },
      runtimeUrl: "http://localhost/runtime",
      headers: {},
      fetch: fetchThread,
      requestUpdate: vi.fn(),
    });

    clearPlaygroundSession(state);
    state.error = "New session state";
    messages.resolve(
      jsonResponse({
        messages: [{ id: "old-message", role: "user", content: "Old" }],
      }),
    );

    await expect(pending).resolves.toBeNull();
    expect(state.error).toBe("New session state");
    expect(state.messages).toEqual([]);
  });
});
