import { describe, it, expect, vi } from "vitest";

vi.mock("pino", () => ({
  default: vi.fn(() => ({
    child: vi.fn(() => ({ debug: vi.fn() })),
    debug: vi.fn(),
  })),
}));
vi.mock("pino-pretty", () => ({ default: vi.fn() }));
vi.mock("../../telemetry", () => ({
  telemetry: { capture: vi.fn() },
}));

const cloneAgentForRequest = vi.fn();
const parseRunRequest = vi.fn();
const configureAgentForRequest = vi.fn();

vi.mock("../shared/agent-utils", () => ({
  cloneAgentForRequest: (...args: unknown[]) => cloneAgentForRequest(...args),
  parseRunRequest: (...args: unknown[]) => parseRunRequest(...args),
  configureAgentForRequest: (...args: unknown[]) =>
    configureAgentForRequest(...args),
}));

import { handleSuggestAgent } from "../handle-suggest";

const suggestMsg = {
  id: "a1",
  role: "assistant",
  toolCalls: [
    {
      id: "t1",
      function: {
        name: "copilotkitSuggest",
        arguments: JSON.stringify({
          suggestions: [{ title: "Hi", message: "Say hi" }],
        }),
      },
    },
  ],
};

/**
 * `handleSuggestAgent` must run the provider agent directly and return the
 * resulting messages. Crucially it must never touch `runtime.runner`, whose
 * `InMemoryAgentRunner.run()` writes to a module-level store keyed by threadId
 * — leaking a throwaway suggest thread into the local thread endpoints.
 */
describe("handleSuggestAgent", () => {
  it("runs the agent directly and returns its messages as JSON, never touching the runner", async () => {
    const runnerRun = vi.fn();
    const fakeAgent = {
      agentId: "default",
      messages: [],
      setMessages: vi.fn(),
      setState: vi.fn(),
      threadId: undefined as string | undefined,
      runAgent: vi.fn(async (_input: unknown, sub?: any) => {
        sub?.onMessagesChanged?.({
          messages: [{ id: "m0", role: "user", content: "hi" }, suggestMsg],
        });
        return { newMessages: [suggestMsg] };
      }),
    };

    cloneAgentForRequest.mockResolvedValue(fakeAgent);
    parseRunRequest.mockResolvedValue({
      threadId: "s1",
      runId: "r1",
      messages: [{ id: "m0", role: "user", content: "hi" }],
      state: {},
      tools: [],
      context: [],
      forwardedProps: {},
    });

    const runtime = { runner: { run: runnerRun } } as any;

    const res = await handleSuggestAgent({
      runtime,
      request: new Request("http://x/agent/default/suggest", {
        method: "POST",
        body: JSON.stringify({
          threadId: "s1",
          messages: [],
          forwardedProps: {},
          tools: [],
        }),
      }),
      agentId: "default",
    });

    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.messages).toContainEqual(suggestMsg);
    expect(fakeAgent.runAgent).toHaveBeenCalledTimes(1);
    expect(runnerRun).not.toHaveBeenCalled();
  });

  it("returns 502 when the agent run throws, still without touching the runner", async () => {
    const runnerRun = vi.fn();
    const fakeAgent = {
      agentId: "default",
      messages: [],
      setMessages: vi.fn(),
      setState: vi.fn(),
      threadId: undefined as string | undefined,
      runAgent: vi.fn(async () => {
        throw new Error("provider exploded");
      }),
    };

    cloneAgentForRequest.mockResolvedValue(fakeAgent);
    parseRunRequest.mockResolvedValue({
      threadId: "s1",
      runId: "r1",
      messages: [],
      state: {},
      tools: [],
      context: [],
      forwardedProps: {},
    });

    const runtime = { runner: { run: runnerRun } } as any;

    const res = await handleSuggestAgent({
      runtime,
      request: new Request("http://x/agent/default/suggest", {
        method: "POST",
        body: JSON.stringify({ threadId: "s1", messages: [] }),
      }),
      agentId: "default",
    });

    expect(res.status).toBe(502);
    expect(runnerRun).not.toHaveBeenCalled();
  });

  it("returns the Response from cloneAgentForRequest when agent resolution fails", async () => {
    parseRunRequest.mockClear();
    const runnerRun = vi.fn();
    cloneAgentForRequest.mockResolvedValue(
      new Response(JSON.stringify({ error: "Agent not found" }), {
        status: 404,
      }),
    );

    const runtime = { runner: { run: runnerRun } } as any;

    const res = await handleSuggestAgent({
      runtime,
      request: new Request("http://x/agent/missing/suggest", {
        method: "POST",
        body: "{}",
      }),
      agentId: "missing",
    });

    expect(res.status).toBe(404);
    expect(parseRunRequest).not.toHaveBeenCalled();
    expect(runnerRun).not.toHaveBeenCalled();
  });

  it("behaves identically under an Intelligence-configured runtime, still never touching the runner", async () => {
    const runnerRun = vi.fn();
    const runnerConnect = vi.fn();
    const fakeAgent = {
      agentId: "default",
      messages: [],
      setMessages: vi.fn(),
      setState: vi.fn(),
      threadId: undefined as string | undefined,
      runAgent: vi.fn(async (_input: unknown, sub?: any) => {
        sub?.onMessagesChanged?.({
          messages: [{ id: "m0", role: "user", content: "hi" }, suggestMsg],
        });
        return { newMessages: [suggestMsg] };
      }),
    };

    cloneAgentForRequest.mockResolvedValue(fakeAgent);
    parseRunRequest.mockResolvedValue({
      threadId: "s1",
      runId: "r1",
      messages: [{ id: "m0", role: "user", content: "hi" }],
      state: {},
      tools: [],
      context: [],
      forwardedProps: {},
    });

    // Intelligence-mode runtime shaped like the ones the thread/run handler
    // tests construct: `mode: "intelligence"` plus an `intelligence` platform
    // handle. The suggest handler must remain mode-agnostic — it runs the
    // provider agent directly and never consults `intelligence` or the runner
    // (whose `run`/`connect` would acquire a lock / hit the gateway and leak a
    // thread). Spying on both proves the direct-run path is taken regardless
    // of mode.
    const runtime = {
      mode: "intelligence",
      intelligence: { getOrCreateThread: vi.fn(), listThreads: vi.fn() },
      runner: { run: runnerRun, connect: runnerConnect },
    } as any;

    const res = await handleSuggestAgent({
      runtime,
      request: new Request("http://x/agent/default/suggest", {
        method: "POST",
        body: JSON.stringify({
          threadId: "s1",
          messages: [],
          forwardedProps: {},
          tools: [],
        }),
      }),
      agentId: "default",
    });

    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.messages).toContainEqual(suggestMsg);
    expect(fakeAgent.runAgent).toHaveBeenCalledTimes(1);
    expect(runnerRun).not.toHaveBeenCalled();
    expect(runnerConnect).not.toHaveBeenCalled();
    expect(runtime.intelligence.getOrCreateThread).not.toHaveBeenCalled();
  });
});
