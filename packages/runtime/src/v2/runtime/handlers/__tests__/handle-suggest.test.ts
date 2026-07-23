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
 * The subscriber bag the handler passes to `runAgent`. The suggest handler
 * streams the agent's events, so it consumes `onEvent`.
 */
interface RunAgentSubscriber {
  onEvent?: (params: { event: Record<string, unknown> }) => void;
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
  debugEventBus?: unknown;
  debug?: unknown;
  debugLogger?: unknown;
}

// A `copilotkitSuggest` tool call expressed as the AG-UI event sequence a real
// provider streams. The handler forwards these verbatim onto the SSE response.
const suggestEvents: Array<Record<string, unknown>> = [
  { type: "RUN_STARTED", threadId: "s1", runId: "r1" },
  {
    type: "TOOL_CALL_START",
    toolCallId: "tc1",
    toolCallName: "copilotkitSuggest",
    parentMessageId: "a1",
  },
  {
    type: "TOOL_CALL_ARGS",
    toolCallId: "tc1",
    delta: JSON.stringify({
      suggestions: [{ title: "Hi", message: "Say hi" }],
    }),
  },
  { type: "TOOL_CALL_END", toolCallId: "tc1" },
  { type: "RUN_FINISHED", threadId: "s1", runId: "r1" },
];

/**
 * Builds a fully typed fake agent whose `runAgent` streams the suggest event
 * sequence via `onEvent`.
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
      for (const event of suggestEvents) {
        sub?.onEvent?.({ event });
      }
      return { newMessages: [] };
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
 * signature requires.
 */
function asRuntime(runtime: FakeRuntime): CopilotRuntimeLike {
  return runtime as unknown as CopilotRuntimeLike;
}

/** Drains an SSE `Response` body into the list of parsed `data:` events. */
async function readSseEvents(
  res: Response,
): Promise<Array<Record<string, unknown>>> {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    // The runtime's SSE encoder writes string frames; the byte path is handled
    // for completeness (real HTTP transports emit `Uint8Array`).
    buffer +=
      typeof value === "string"
        ? value
        : decoder.decode(value, { stream: true });
  }
  buffer += decoder.decode();
  const events: Array<Record<string, unknown>> = [];
  for (const frame of buffer.split("\n\n")) {
    const line = frame.trim();
    if (line.startsWith("data:")) {
      events.push(JSON.parse(line.slice("data:".length).trim()));
    }
  }
  return events;
}

/**
 * `handleSuggestAgent` must run the provider agent directly and stream its
 * events as SSE. Crucially it must never touch `runtime.runner`, whose
 * `InMemoryAgentRunner.run()` writes to a module-level store keyed by threadId
 * — leaking a throwaway suggest thread into the local thread endpoints.
 */
describe("handleSuggestAgent", () => {
  it("runs the agent directly and streams its events as SSE, never touching the runner", async () => {
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

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");

    const events = await readSseEvents(res);
    // The provider's tool-call events reach the client verbatim.
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "TOOL_CALL_START",
        toolCallName: "copilotkitSuggest",
      }),
    );
    expect(events.some((e) => e.type === "RUN_FINISHED")).toBe(true);
    expect(fakeAgent.runAgent).toHaveBeenCalledTimes(1);
    expect(runtime.runner.run).not.toHaveBeenCalled();
  });

  it("forwards allowlisted request headers onto the agent but attaches no middleware", async () => {
    const fakeAgent = createFakeAgent();
    cloneAgentForRequest.mockResolvedValue(fakeAgent);
    stubParsedInput();

    const runtime: FakeRuntime = { runner: { run: vi.fn() } };

    const res = await handleSuggestAgent({
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
    // Drain so the run completes before assertions.
    await readSseEvents(res);

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

    // Hold the run open until the signal aborts, so the abort fires while
    // runAgent is still in flight (the real cancellation scenario).
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

    const res = await handleSuggestAgent({
      runtime: asRuntime(runtime),
      request,
      agentId: "default",
    });

    // The SSE response subscribes to the run immediately (no body read needed);
    // that subscription wires the teardown that aborts the run on signal abort.
    // Flush microtasks so the subscription is established before we abort.
    await new Promise((resolve) => setImmediate(resolve));

    controller.abort();

    await vi.waitFor(() => {
      expect(fakeAgent.abortRun).toHaveBeenCalled();
    });

    // Let the (now-aborted) run settle, then release the response body.
    resolveRun({ newMessages: [] });
    await res.body?.cancel().catch(() => {});
  });

  it("logs the failure server-side when the agent run throws, still without touching the runner", async () => {
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

    // The stream's error handler logs via `console.error`. Spy on it and
    // swallow output so the failure trace is asserted without noise.
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await handleSuggestAgent({
      runtime: asRuntime(runtime),
      request: new Request("http://x/agent/failing/suggest", {
        method: "POST",
        body: JSON.stringify({ threadId: "s1", messages: [] }),
      }),
      agentId: "failing",
    });

    // Headers are committed before the run, so the response is a 200 SSE that
    // ends early once the run errors.
    expect(res.status).toBe(200);
    await readSseEvents(res);

    expect(runtime.runner.run).not.toHaveBeenCalled();
    // Operator trace: the failure is logged server-side.
    expect(
      errorSpy.mock.calls.some((call) =>
        call.some(
          (arg) => arg === runError || String(arg).includes("exploded"),
        ),
      ),
    ).toBe(true);

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
    // tests construct. The suggest handler must remain mode-agnostic — it runs
    // the provider agent directly and never consults `intelligence` or the
    // runner (whose `run`/`connect` would acquire a lock / hit the gateway and
    // leak a thread).
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

    expect(res.status).toBe(200);
    const events = await readSseEvents(res);
    expect(events.some((e) => e.type === "RUN_FINISHED")).toBe(true);
    expect(fakeAgent.runAgent).toHaveBeenCalledTimes(1);
    expect(runtime.runner.run).not.toHaveBeenCalled();
    expect(runtime.runner.connect).not.toHaveBeenCalled();
    expect(runtime.intelligence?.getOrCreateThread).not.toHaveBeenCalled();
  });
});
