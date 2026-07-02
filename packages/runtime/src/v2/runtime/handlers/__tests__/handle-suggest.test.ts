import { describe, it, expect, vi } from "vitest";
import type { RunAgentInput } from "@ag-ui/client";

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

vi.mock("../shared/agent-utils", () => ({
  cloneAgentForRequest: (...args: unknown[]) => cloneAgentForRequest(...args),
  parseRunRequest: (...args: unknown[]) => parseRunRequest(...args),
}));

import { handleSuggestAgent } from "../handle-suggest";
import type { CopilotRuntimeLike } from "../../core/runtime";

/**
 * A minimal `AgentSubscriber`-shaped callback bag the handler passes to
 * `runAgent`. Only `onMessagesChanged` is exercised, matching the real
 * subscriber surface without pulling in the full type.
 */
interface RunAgentSubscriber {
  onMessagesChanged?: (event: { messages: unknown[] }) => void;
}

/**
 * The subset of `AbstractAgent` the suggest handler touches on the clone
 * returned by `cloneAgentForRequest`. Typed so the tests avoid `as any` while
 * exposing the spies the assertions inspect (`use`, `abortRun`, `runAgent`).
 */
interface FakeAgent {
  agentId: string;
  headers?: Record<string, string>;
  messages: unknown[];
  setMessages: ReturnType<typeof vi.fn>;
  setState: ReturnType<typeof vi.fn>;
  threadId: string | undefined;
  /** Middleware registration — must never be called by the suggest path. */
  use: ReturnType<typeof vi.fn>;
  /** Server-side run cancellation — wired to the request's abort signal. */
  abortRun: ReturnType<typeof vi.fn>;
  runAgent: ReturnType<typeof vi.fn>;
}

/**
 * The runtime surface the tests construct. `runner.run`/`runner.connect` are
 * typed `vi.fn()`s so the "never routes through the runner" assertions are
 * checked without casting the runtime to `any`.
 */
interface FakeRuntime {
  mode?: string;
  runner: { run: ReturnType<typeof vi.fn>; connect?: ReturnType<typeof vi.fn> };
  intelligence?: {
    getOrCreateThread: ReturnType<typeof vi.fn>;
    listThreads: ReturnType<typeof vi.fn>;
  };
}

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
 * Builds a fully typed fake agent whose `runAgent` echoes the running message
 * set (including the `copilotkitSuggest` tool call) via `onMessagesChanged`.
 */
function createFakeAgent(): FakeAgent {
  return {
    agentId: "default",
    messages: [],
    setMessages: vi.fn(),
    setState: vi.fn(),
    threadId: undefined,
    use: vi.fn(),
    abortRun: vi.fn(),
    runAgent: vi.fn(async (_input: RunAgentInput, sub?: RunAgentSubscriber) => {
      sub?.onMessagesChanged?.({
        messages: [{ id: "m0", role: "user", content: "hi" }, suggestMsg],
      });
      return { newMessages: [suggestMsg] };
    }),
  };
}

/** Standard parsed run input used across the happy-path tests. */
function stubParsedInput() {
  parseRunRequest.mockResolvedValue({
    threadId: "s1",
    runId: "r1",
    messages: [{ id: "m0", role: "user", content: "hi" }],
    state: {},
    tools: [],
    context: [],
    forwardedProps: {},
  });
}

/**
 * Bridges a typed fake runtime to the `CopilotRuntimeLike` the handler's
 * signature requires. The fake only carries the members the tests assert on
 * (typed `vi.fn()` runner spies); the single test-double cast is isolated here
 * rather than sprinkled at each call site, and no `any` is introduced.
 */
function asRuntime(runtime: FakeRuntime): CopilotRuntimeLike {
  return runtime as unknown as CopilotRuntimeLike;
}

/**
 * `handleSuggestAgent` must run the provider agent directly and return the
 * resulting messages. Crucially it must never touch `runtime.runner`, whose
 * `InMemoryAgentRunner.run()` writes to a module-level store keyed by threadId
 * — leaking a throwaway suggest thread into the local thread endpoints.
 */
describe("handleSuggestAgent", () => {
  it("runs the agent directly and returns its messages as JSON, never touching the runner", async () => {
    const fakeAgent = createFakeAgent();
    cloneAgentForRequest.mockResolvedValue(fakeAgent);
    stubParsedInput();

    const runtime: FakeRuntime = { runner: { run: vi.fn() } };

    const res = await handleSuggestAgent({
      runtime: asRuntime(runtime),
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
    expect(runtime.runner.run).not.toHaveBeenCalled();
  });

  it("forwards allowlisted request headers onto the agent but attaches no middleware", async () => {
    const fakeAgent = createFakeAgent();
    cloneAgentForRequest.mockResolvedValue(fakeAgent);
    stubParsedInput();

    const runtime: FakeRuntime = { runner: { run: vi.fn() } };

    await handleSuggestAgent({
      runtime: asRuntime(runtime),
      request: new Request("http://x/agent/default/suggest", {
        method: "POST",
        headers: {
          authorization: "Bearer secret",
          "x-custom-header": "custom-value",
          // A non-allowlisted header must be dropped, not forwarded.
          "content-type": "application/json",
        },
        body: JSON.stringify({ threadId: "s1", messages: [] }),
      }),
      agentId: "default",
    });

    // The forced `copilotkitSuggest` tool choice makes middleware dead weight,
    // and MCPApps setup can incur a `listTools` network round-trip — so the
    // suggest path must register no middleware at all.
    expect(fakeAgent.use).not.toHaveBeenCalled();

    // Allowlisted headers land on the agent; other headers do not.
    expect(fakeAgent.headers).toMatchObject({
      authorization: "Bearer secret",
      "x-custom-header": "custom-value",
    });
    expect(fakeAgent.headers?.["content-type"]).toBeUndefined();
  });

  it("cancels the server-side run by calling agent.abortRun when the request signal aborts", async () => {
    const controller = new AbortController();
    const fakeAgent = createFakeAgent();

    // Hold the run open until the signal aborts, so the abort listener fires
    // while runAgent is still in flight (the real cancellation scenario).
    let resolveRun: (result: { newMessages: unknown[] }) => void = () => {};
    fakeAgent.runAgent.mockImplementation(
      () =>
        new Promise<{ newMessages: unknown[] }>((resolve) => {
          resolveRun = resolve;
        }),
    );

    cloneAgentForRequest.mockResolvedValue(fakeAgent);
    stubParsedInput();

    const runtime: FakeRuntime = { runner: { run: vi.fn() } };

    const request = new Request("http://x/agent/default/suggest", {
      method: "POST",
      body: JSON.stringify({ threadId: "s1", messages: [] }),
      signal: controller.signal,
    });
    const signalSpy = vi.spyOn(request.signal, "addEventListener");

    const pending = handleSuggestAgent({
      runtime: asRuntime(runtime),
      request,
      agentId: "default",
    });

    // Flush the handler's `await cloneAgentForRequest` + `await parseRunRequest`
    // microtasks so it reaches the abort-listener registration before we assert.
    await new Promise((resolve) => setImmediate(resolve));

    expect(signalSpy).toHaveBeenCalledWith(
      "abort",
      expect.any(Function),
      expect.objectContaining({ once: true }),
    );

    controller.abort();

    expect(fakeAgent.abortRun).toHaveBeenCalledTimes(1);

    // Let the (now-aborted) run settle so the handler can respond.
    resolveRun({ newMessages: [suggestMsg] });
    await pending;
  });

  it("returns 502 and logs the failure server-side when the agent run throws, still without touching the runner", async () => {
    const fakeAgent = createFakeAgent();
    const runError = new Error("provider exploded");
    fakeAgent.runAgent.mockRejectedValue(runError);

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

    const runtime: FakeRuntime = { runner: { run: vi.fn() } };

    // The handler logs via `logger` from `@copilotkit/shared`, which is
    // `console`. Spy on `console.error` and swallow output so the failure
    // trace is asserted without polluting test output.
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await handleSuggestAgent({
      runtime: asRuntime(runtime),
      request: new Request("http://x/agent/failing/suggest", {
        method: "POST",
        body: JSON.stringify({ threadId: "s1", messages: [] }),
      }),
      agentId: "failing",
    });

    expect(res.status).toBe(502);
    expect(runtime.runner.run).not.toHaveBeenCalled();

    // Operator trace: the error and the agentId must be logged server-side.
    expect(errorSpy).toHaveBeenCalledWith(
      expect.objectContaining({ err: runError, agentId: "failing" }),
      expect.stringContaining("Suggestion run failed"),
    );

    errorSpy.mockRestore();
  });

  it("returns the Response from cloneAgentForRequest when agent resolution fails", async () => {
    parseRunRequest.mockClear();
    cloneAgentForRequest.mockResolvedValue(
      new Response(JSON.stringify({ error: "Agent not found" }), {
        status: 404,
      }),
    );

    const runtime: FakeRuntime = { runner: { run: vi.fn() } };

    const res = await handleSuggestAgent({
      runtime: asRuntime(runtime),
      request: new Request("http://x/agent/missing/suggest", {
        method: "POST",
        body: "{}",
      }),
      agentId: "missing",
    });

    expect(res.status).toBe(404);
    expect(parseRunRequest).not.toHaveBeenCalled();
    expect(runtime.runner.run).not.toHaveBeenCalled();
  });

  it("behaves identically under an Intelligence-configured runtime, still never touching the runner", async () => {
    const fakeAgent = createFakeAgent();
    cloneAgentForRequest.mockResolvedValue(fakeAgent);
    stubParsedInput();

    // Intelligence-mode runtime shaped like the ones the thread/run handler
    // tests construct: `mode: "intelligence"` plus an `intelligence` platform
    // handle. The suggest handler must remain mode-agnostic — it runs the
    // provider agent directly and never consults `intelligence` or the runner
    // (whose `run`/`connect` would acquire a lock / hit the gateway and leak a
    // thread). Spying on both proves the direct-run path is taken regardless
    // of mode.
    const runtime: FakeRuntime = {
      mode: "intelligence",
      intelligence: { getOrCreateThread: vi.fn(), listThreads: vi.fn() },
      runner: { run: vi.fn(), connect: vi.fn() },
    };

    const res = await handleSuggestAgent({
      runtime: asRuntime(runtime),
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
    expect(runtime.runner.run).not.toHaveBeenCalled();
    expect(runtime.runner.connect).not.toHaveBeenCalled();
    expect(runtime.intelligence?.getOrCreateThread).not.toHaveBeenCalled();
  });

  it("preserves the client instruction marker before the copilotkitSuggest tool call in the returned transcript", async () => {
    // The fragile client/server seam: the client sends an instruction message
    // (id === threadId === suggestionId) as the LAST input message, then reads
    // suggestions from the response's `messages` AFTER that marker. A realistic
    // full-transcript agent echoes the input messages plus the new tool call,
    // so the marker must survive the round trip AND stay before the tool call.
    const markerMessage = {
      id: "sugg-marker",
      role: "user",
      content: "Generate suggestions for the conversation above.",
    };
    const priorUserMessage = { id: "m0", role: "user", content: "hi" };

    const fakeAgent = createFakeAgent();
    fakeAgent.runAgent.mockImplementation(
      async (input: RunAgentInput, sub?: RunAgentSubscriber) => {
        // Realistic transcript: the full input messages (including the trailing
        // marker) plus the new assistant tool-call message.
        sub?.onMessagesChanged?.({
          messages: [...input.messages, suggestMsg],
        });
        return { newMessages: [suggestMsg] };
      },
    );

    cloneAgentForRequest.mockResolvedValue(fakeAgent);
    parseRunRequest.mockResolvedValue({
      threadId: "sugg-marker",
      runId: "r1",
      messages: [priorUserMessage, markerMessage],
      state: {},
      tools: [],
      context: [],
      forwardedProps: {},
    });

    const runtime: FakeRuntime = { runner: { run: vi.fn() } };

    const res = await handleSuggestAgent({
      runtime: asRuntime(runtime),
      request: new Request("http://x/agent/default/suggest", {
        method: "POST",
        body: JSON.stringify({
          threadId: "sugg-marker",
          messages: [priorUserMessage, markerMessage],
        }),
      }),
      agentId: "default",
    });

    const body = (await res.json()) as { messages: Array<{ id: string }> };

    expect(res.status).toBe(200);

    // (a) The marker survives the round trip.
    expect(body.messages).toContainEqual(markerMessage);

    // (b) The copilotkitSuggest tool-call message appears AFTER the marker —
    // the exact ordering `extractSuggestions` depends on.
    const markerIndex = body.messages.findIndex(
      (m) => m.id === markerMessage.id,
    );
    const suggestIndex = body.messages.findIndex((m) => m.id === suggestMsg.id);
    expect(markerIndex).toBeGreaterThanOrEqual(0);
    expect(suggestIndex).toBeGreaterThan(markerIndex);
  });
});
