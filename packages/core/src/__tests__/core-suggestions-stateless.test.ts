/**
 * Tests the stateless suggestion path: when the runtime advertises
 * `suggestions: true` via `/info`, the engine runs a stock `HttpAgent` pointed
 * at `/agent/:providerId/suggest` (which streams AG-UI SSE from a direct,
 * non-persisting provider run) instead of cloning the client provider agent.
 * When the capability is absent (or transport is single-route), it falls back to
 * the clone + `runAgent` path.
 *
 * The `/suggest` responses here are real SSE streams (`text/event-stream`) so the
 * `HttpAgent`'s own event pipeline drives `onMessagesChanged` — exercising the
 * progressive-streaming behavior end to end rather than a buffered JSON parse.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AbstractAgent } from "@ag-ui/client";
import { CopilotKitCore, isAbortError } from "../core";
import {
  MockAgent,
  createSuggestionsConfig,
  createSuggestionToolCall,
  createMessage,
  waitForCondition,
} from "./test-utils";

const encoder = new TextEncoder();

/**
 * A JSON-serializable request captured from a `fetch` call so tests can assert
 * on the URL, method, and parsed body without `as any` casts.
 */
interface CapturedRequest {
  url: string;
  method: string;
  body: SuggestRequestBody | undefined;
  signal: AbortSignal | undefined;
  headers: Record<string, string> | undefined;
  credentials: RequestCredentials | undefined;
}

/**
 * The subset of the stateless `/suggest` request body the engine sends. Mirrors
 * a `RunAgentInput` but only types the fields the tests inspect.
 */
interface SuggestRequestBody {
  messages: Array<{ id: string; role: string; content?: string }>;
  threadId: string;
  runId: string;
  tools: Array<{ name: string }>;
  forwardedProps: { toolChoice?: unknown } & Record<string, unknown>;
}

/**
 * Normalizes a `fetch` `HeadersInit` into a plain string record so tests can
 * assert on individual header values without `as any`.
 */
function toHeaderRecord(
  headers: HeadersInit | undefined,
): Record<string, string> | undefined {
  if (!headers) {
    return undefined;
  }
  if (headers instanceof Headers) {
    return Object.fromEntries(headers.entries());
  }
  if (Array.isArray(headers)) {
    return Object.fromEntries(headers);
  }
  return { ...headers };
}

/** Builds the `/info` payload advertising the stateless suggest capability. */
function infoResponse(extra: Record<string, unknown> = {}): Response {
  return new Response(
    JSON.stringify({
      version: "1.0.0",
      mode: "sse",
      agents: {},
      suggestions: true,
      ...extra,
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

/**
 * Builds the AG-UI event sequence for a `copilotkitSuggest` tool call. The tool
 * arguments can be split across multiple `TOOL_CALL_ARGS` deltas to exercise
 * progressive parsing.
 */
function suggestEvents(
  suggestions: Array<{ title: string; message: string }>,
  argChunks?: string[],
): object[] {
  const toolCallId = "tc-suggest-1";
  const chunks = argChunks ?? [JSON.stringify({ suggestions })];
  return [
    { type: "RUN_STARTED", threadId: "suggest-thread", runId: "suggest-run" },
    {
      type: "TOOL_CALL_START",
      toolCallId,
      toolCallName: "copilotkitSuggest",
      parentMessageId: "assistant-suggest-1",
    },
    ...chunks.map((delta) => ({ type: "TOOL_CALL_ARGS", toolCallId, delta })),
    { type: "TOOL_CALL_END", toolCallId },
    {
      type: "RUN_FINISHED",
      threadId: "suggest-thread",
      runId: "suggest-run",
      result: { newMessages: [] },
    },
  ];
}

/** Wraps a list of AG-UI events into an SSE `Response`. */
function sseResponse(events: object[], status = 200): Response {
  const stream = new ReadableStream({
    start(controller) {
      const payload = events
        .map((event) => `data: ${JSON.stringify(event)}\n\n`)
        .join("");
      controller.enqueue(encoder.encode(payload));
      controller.close();
    },
  });
  return new Response(stream, {
    status,
    headers: { "content-type": "text/event-stream" },
  });
}

interface FetchStubOptions {
  /** HTTP status for `/suggest` responses. Defaults to 200. */
  suggestStatus?: number;
  /** Suggestions the `/suggest` SSE stream emits. */
  suggestions?: Array<{ title: string; message: string }>;
  /** Split the tool-call arguments across these deltas (progressive streaming). */
  argChunks?: string[];
}

/**
 * Builds a typed `fetch` stub that routes `/info` (advertising
 * `suggestions: true`) and `/suggest` (an SSE stream), recording every
 * `/suggest` request so tests can assert on it.
 */
function setupRoutedFetch(options: FetchStubOptions = {}): {
  fetchMock: ReturnType<typeof vi.fn>;
  suggestRequests: CapturedRequest[];
} {
  const suggestRequests: CapturedRequest[] = [];
  const fetchMock = vi.fn(
    async (input: unknown, init?: RequestInit): Promise<Response> => {
      const url = String(input);
      if (url.includes("/suggest")) {
        const rawBody = init?.body;
        const body =
          typeof rawBody === "string"
            ? (JSON.parse(rawBody) as SuggestRequestBody)
            : undefined;
        suggestRequests.push({
          url,
          method: init?.method ?? "GET",
          body,
          signal: init?.signal ?? undefined,
          headers: toHeaderRecord(init?.headers),
          credentials: init?.credentials ?? undefined,
        });
        const status = options.suggestStatus ?? 200;
        if (status < 200 || status >= 300) {
          return new Response("suggest failed", { status });
        }
        return sseResponse(
          suggestEvents(options.suggestions ?? [], options.argChunks),
        );
      }
      // `/info`
      return infoResponse();
    },
  );
  return { fetchMock, suggestRequests };
}

/**
 * Registers a provider + consumer MockAgent on a core and returns them.
 */
function registerAgents(
  core: CopilotKitCore,
  consumerMessages: ReturnType<typeof createMessage>[] = [],
): { providerAgent: MockAgent; consumerAgent: MockAgent } {
  const providerAgent = new MockAgent({ agentId: "default" });
  const consumerAgent = new MockAgent({
    agentId: "consumer",
    messages: consumerMessages,
  });
  core.addAgent__unsafe_dev_only({
    id: "default",
    agent: providerAgent as unknown as AbstractAgent,
  });
  core.addAgent__unsafe_dev_only({
    id: "consumer",
    agent: consumerAgent as unknown as AbstractAgent,
  });
  return { providerAgent, consumerAgent };
}

describe("CopilotKitCore - Stateless Suggestions", () => {
  const originalFetch = global.fetch;
  const originalWindow = (global as unknown as { window?: unknown }).window;

  beforeEach(() => {
    vi.restoreAllMocks();
    (global as unknown as { window?: unknown }).window = {};
  });

  afterEach(() => {
    if (originalFetch) {
      global.fetch = originalFetch;
    } else {
      delete (global as unknown as { fetch?: typeof fetch }).fetch;
    }
    if (originalWindow === undefined) {
      delete (global as unknown as { window?: unknown }).window;
    } else {
      (global as unknown as { window?: unknown }).window = originalWindow;
    }
  });

  it("runs a stateless HttpAgent against /agent/:providerId/suggest and parses the streamed suggestions", async () => {
    const { fetchMock, suggestRequests } = setupRoutedFetch({
      suggestions: [{ title: "Hi", message: "Say hi" }],
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const core = new CopilotKitCore({ runtimeUrl: "https://runtime.example" });
    await waitForCondition(() => core.suggestions === true);
    const { providerAgent } = registerAgents(core, [
      createMessage({ content: "User asked something" }),
    ]);
    core.addSuggestionsConfig(
      createSuggestionsConfig({
        providerAgentId: "default",
        consumerAgentId: "consumer",
      }),
    );

    core.reloadSuggestions("consumer");

    await vi.waitFor(() => {
      const result = core.getSuggestions("consumer");
      expect(result.suggestions.length).toBeGreaterThan(0);
    });

    expect(suggestRequests).toHaveLength(1);
    expect(suggestRequests[0]!.url).toContain("/agent/default/suggest");
    expect(suggestRequests[0]!.method).toBe("POST");
    // The client provider agent must NOT be cloned/run: the stateless path uses
    // a dedicated HttpAgent transport, not the registered provider instance.
    expect(providerAgent.runAgentCalls).toHaveLength(0);
    expect(core.getSuggestions("consumer").suggestions).toEqual([
      { title: "Hi", message: "Say hi", isLoading: false },
    ]);
  });

  it("streams suggestions progressively as tool-call args arrive", async () => {
    // Two arg deltas → `onMessagesChanged` fires more than once → suggestions
    // grow incrementally rather than appearing all at once.
    const { fetchMock } = setupRoutedFetch({
      suggestions: [],
      argChunks: [
        '{"suggestions":[{"title":"A","message":"a"}',
        ',{"title":"B","message":"b"}]}',
      ],
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const changeCounts: number[] = [];
    const core = new CopilotKitCore({ runtimeUrl: "https://runtime.example" });
    core.subscribe({
      onSuggestionsChanged: ({ suggestions }) => {
        changeCounts.push(suggestions.length);
      },
    });
    await waitForCondition(() => core.suggestions === true);
    registerAgents(core, [createMessage({ content: "hello" })]);
    core.addSuggestionsConfig(
      createSuggestionsConfig({ consumerAgentId: "consumer" }),
    );

    core.reloadSuggestions("consumer");

    await vi.waitFor(() => {
      expect(core.getSuggestions("consumer").suggestions).toEqual([
        { title: "A", message: "a", isLoading: false },
        { title: "B", message: "b", isLoading: false },
      ]);
    });
    // Progressive: at least one intermediate notification carried a single
    // suggestion before the pair was complete.
    expect(changeCounts).toContain(1);
  });

  it("forwards custom headers and credentials onto the /suggest request", async () => {
    // Pins the cookie/self-hosted auth critical path: core-level `headers` and
    // `credentials` must ride along on the stateless `/suggest` fetch so a
    // self-hosted backend behind auth can authenticate the request.
    const { fetchMock, suggestRequests } = setupRoutedFetch({
      suggestions: [{ title: "Hi", message: "Say hi" }],
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const core = new CopilotKitCore({
      runtimeUrl: "https://runtime.example",
      headers: { authorization: "Bearer x" },
      credentials: "include",
    });
    await waitForCondition(() => core.suggestions === true);
    registerAgents(core, [createMessage({ content: "hello" })]);
    core.addSuggestionsConfig(
      createSuggestionsConfig({
        providerAgentId: "default",
        consumerAgentId: "consumer",
      }),
    );

    core.reloadSuggestions("consumer");

    await vi.waitFor(() => {
      expect(suggestRequests).toHaveLength(1);
    });
    expect(suggestRequests[0]!.headers?.authorization).toBe("Bearer x");
    expect(suggestRequests[0]!.headers?.["Content-Type"]).toBe(
      "application/json",
    );
    expect(suggestRequests[0]!.credentials).toBe("include");
  });

  it("sends the consumer state, appends the instruction marker, and forces toolChoice", async () => {
    const { fetchMock, suggestRequests } = setupRoutedFetch({
      suggestions: [],
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const core = new CopilotKitCore({ runtimeUrl: "https://runtime.example" });
    await waitForCondition(() => core.suggestions === true);
    // Seed the consumer agent with state so we can assert it is forwarded (the
    // stateless path must not drop it — regression guard).
    const { consumerAgent } = registerAgents(core, [
      createMessage({ content: "hello" }),
    ]);
    consumerAgent.setState({ counter: 7 });
    core.addSuggestionsConfig(
      createSuggestionsConfig({
        instructions: "Focus on data analysis",
        minSuggestions: 2,
        maxSuggestions: 4,
        providerAgentId: "default",
        consumerAgentId: "consumer",
      }),
    );

    core.reloadSuggestions("consumer");

    await vi.waitFor(() => {
      expect(suggestRequests).toHaveLength(1);
    });
    const body = suggestRequests[0]!.body!;
    const instruction = body.messages.at(-1)!;
    expect(instruction.role).toBe("user");
    expect(instruction.id).toBe(body.threadId);
    const content = instruction.content ?? "";
    expect(content).toContain("copilotkitSuggest");
    expect(content).toContain("at least 2");
    expect(content).toContain("at most 4");
    expect(content).toContain("Focus on data analysis");
    expect(body.tools.map((t) => t.name)).toContain("copilotkitSuggest");
    expect(body.forwardedProps.toolChoice).toEqual({
      type: "function",
      function: { name: "copilotkitSuggest" },
    });
    // The consumer's state rides along (not dropped to `{}`).
    expect((body as unknown as { state?: unknown }).state).toEqual({
      counter: 7,
    });
  });

  it("falls back to clone + runAgent when the capability is absent", async () => {
    const fetchMock = vi.fn(async (input: unknown): Promise<Response> => {
      const url = String(input);
      if (url.includes("/suggest")) {
        throw new Error("stateless path should not be used");
      }
      // No `suggestions` field advertised.
      return new Response(
        JSON.stringify({ version: "1.0.0", mode: "sse", agents: {} }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const core = new CopilotKitCore({ runtimeUrl: "https://runtime.example" });
    await waitForCondition(() => core.runtimeVersion !== undefined);
    expect(core.suggestions).toBeUndefined();

    const { providerAgent } = registerAgents(core, [
      createMessage({ content: "hello" }),
    ]);
    providerAgent.setNewMessages([
      createSuggestionToolCall([{ title: "Fb", message: "Fallback" }]),
    ]);
    core.addSuggestionsConfig(
      createSuggestionsConfig({
        providerAgentId: "default",
        consumerAgentId: "consumer",
      }),
    );

    core.reloadSuggestions("consumer");

    await vi.waitFor(() => {
      expect(providerAgent.runAgentCalls).toHaveLength(1);
    });
    const suggestCalls = fetchMock.mock.calls.filter((c) =>
      String(c[0]).includes("/suggest"),
    );
    expect(suggestCalls).toHaveLength(0);
  });

  it("warns and finalizes empty when /suggest responds non-2xx", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { fetchMock } = setupRoutedFetch({ suggestStatus: 502 });
    global.fetch = fetchMock as unknown as typeof fetch;

    const core = new CopilotKitCore({ runtimeUrl: "https://runtime.example" });
    await waitForCondition(() => core.suggestions === true);
    registerAgents(core, [createMessage({ content: "hello" })]);
    core.addSuggestionsConfig(
      createSuggestionsConfig({ consumerAgentId: "consumer" }),
    );

    core.reloadSuggestions("consumer");

    await vi.waitFor(() => {
      expect(core.getSuggestions("consumer").isLoading).toBe(false);
    });
    expect(core.getSuggestions("consumer").suggestions).toEqual([]);
    // A real server failure (not an abort) is surfaced as a warning, not thrown.
    expect(
      warnSpy.mock.calls.some((call) =>
        String(call[0]).includes("Error generating suggestions"),
      ),
    ).toBe(true);
  });

  it("aborts the in-flight /suggest run when clearSuggestions is called", async () => {
    // A /suggest fetch that only settles when its signal aborts keeps the run in
    // flight so clearSuggestions can abort it.
    const suggestRequests: CapturedRequest[] = [];
    const fetchMock = vi.fn(
      (input: unknown, init?: RequestInit): Promise<Response> => {
        const url = String(input);
        if (url.includes("/suggest")) {
          suggestRequests.push({
            url,
            method: init?.method ?? "GET",
            body: undefined,
            signal: init?.signal ?? undefined,
            headers: toHeaderRecord(init?.headers),
            credentials: init?.credentials ?? undefined,
          });
          return new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => {
              reject(new DOMException("Aborted", "AbortError"));
            });
          });
        }
        return Promise.resolve(infoResponse());
      },
    );
    global.fetch = fetchMock as unknown as typeof fetch;

    const core = new CopilotKitCore({ runtimeUrl: "https://runtime.example" });
    await waitForCondition(() => core.suggestions === true);
    registerAgents(core, [createMessage({ content: "hello" })]);
    core.addSuggestionsConfig(
      createSuggestionsConfig({ consumerAgentId: "consumer" }),
    );

    core.reloadSuggestions("consumer");
    await vi.waitFor(() => {
      expect(suggestRequests).toHaveLength(1);
    });

    core.clearSuggestions("consumer");

    expect(suggestRequests[0]!.signal?.aborted).toBe(true);
  });

  it("falls back to clone + runAgent on a single-route runtime even when suggestions is advertised", async () => {
    // A single-route runtime answers `/info` over a POST `{method:"info"}`
    // envelope (no GET `/info`, no `/agent/:id/suggest` path). It advertises
    // `suggestions: true`, but the stateless `/suggest` POST would 404 there —
    // so the engine must take the clone+runAgent fallback instead.
    const suggestCalls: string[] = [];
    const fetchMock = vi.fn(async (input: unknown): Promise<Response> => {
      const url = String(input);
      if (url.includes("/suggest")) {
        suggestCalls.push(url);
        throw new Error("single-route runtime has no /suggest path");
      }
      // Single-route info envelope: reject GET /info, accept POST envelope.
      if (url.endsWith("/info")) {
        return new Response("{}", { status: 404 });
      }
      return infoResponse();
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const core = new CopilotKitCore({
      runtimeUrl: "https://runtime.example",
      runtimeTransport: "single",
    });
    await waitForCondition(() => core.suggestions === true);
    expect(core.runtimeTransport).toBe("single");

    const { providerAgent } = registerAgents(core, [
      createMessage({ content: "hello" }),
    ]);
    providerAgent.setNewMessages([
      createSuggestionToolCall([{ title: "Fb", message: "Fallback" }]),
    ]);
    core.addSuggestionsConfig(
      createSuggestionsConfig({
        providerAgentId: "default",
        consumerAgentId: "consumer",
      }),
    );

    core.reloadSuggestions("consumer");

    await vi.waitFor(() => {
      expect(providerAgent.runAgentCalls).toHaveLength(1);
    });
    expect(suggestCalls).toHaveLength(0);
  });

  it("fires finished-loading when generation throws before a run handle is assigned", async () => {
    // Consumer resolves (so `started` fires) but the provider agent is missing,
    // so `generateSuggestions` throws at provider lookup before assigning a run
    // handle. `finished` must still fire so subscribers don't hang in loading.
    const { fetchMock } = setupRoutedFetch();
    global.fetch = fetchMock as unknown as typeof fetch;

    const startedAgents: string[] = [];
    const finishedAgents: string[] = [];
    const core = new CopilotKitCore({ runtimeUrl: "https://runtime.example" });
    core.subscribe({
      onSuggestionsStartedLoading: ({ agentId }) => {
        startedAgents.push(agentId);
      },
      onSuggestionsFinishedLoading: ({ agentId }) => {
        finishedAgents.push(agentId);
      },
    });
    await waitForCondition(() => core.suggestions === true);

    // Register ONLY the consumer; the provider ("missing-provider") is absent.
    const consumerAgent = new MockAgent({
      agentId: "consumer",
      messages: [createMessage({ content: "hello" })],
    });
    core.addAgent__unsafe_dev_only({
      id: "consumer",
      agent: consumerAgent as unknown as AbstractAgent,
    });
    core.addSuggestionsConfig(
      createSuggestionsConfig({
        providerAgentId: "missing-provider",
        consumerAgentId: "consumer",
      }),
    );

    core.reloadSuggestions("consumer");

    await vi.waitFor(() => {
      expect(finishedAgents).toContain("consumer");
    });
    expect(startedAgents).toContain("consumer");
    expect(core.getSuggestions("consumer").isLoading).toBe(false);
  });

  it("does not warn on an aborted stateless generation", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const suggestRequests: CapturedRequest[] = [];
    const fetchMock = vi.fn(
      (input: unknown, init?: RequestInit): Promise<Response> => {
        const url = String(input);
        if (url.includes("/suggest")) {
          suggestRequests.push({
            url,
            method: init?.method ?? "GET",
            body: undefined,
            signal: init?.signal ?? undefined,
            headers: toHeaderRecord(init?.headers),
            credentials: init?.credentials ?? undefined,
          });
          return new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => {
              reject(new DOMException("Aborted", "AbortError"));
            });
          });
        }
        return Promise.resolve(infoResponse());
      },
    );
    global.fetch = fetchMock as unknown as typeof fetch;

    const core = new CopilotKitCore({ runtimeUrl: "https://runtime.example" });
    await waitForCondition(() => core.suggestions === true);
    registerAgents(core, [createMessage({ content: "hello" })]);
    core.addSuggestionsConfig(
      createSuggestionsConfig({ consumerAgentId: "consumer" }),
    );

    core.reloadSuggestions("consumer");
    await vi.waitFor(() => {
      expect(suggestRequests).toHaveLength(1);
    });

    core.clearSuggestions("consumer");

    await vi.waitFor(() => {
      expect(core.getSuggestions("consumer").isLoading).toBe(false);
    });
    const suggestionWarnings = warnSpy.mock.calls.filter((call) =>
      String(call[0]).includes("Error generating suggestions"),
    );
    expect(suggestionWarnings).toHaveLength(0);
  });

  it("does not throw and finalizes empty when the /suggest run emits no suggestions", async () => {
    // A well-formed SSE run that produces no copilotkitSuggest tool call.
    const { fetchMock } = setupRoutedFetch({ suggestions: [] });
    global.fetch = fetchMock as unknown as typeof fetch;

    const core = new CopilotKitCore({ runtimeUrl: "https://runtime.example" });
    await waitForCondition(() => core.suggestions === true);
    registerAgents(core, [createMessage({ content: "hello" })]);
    core.addSuggestionsConfig(
      createSuggestionsConfig({ consumerAgentId: "consumer" }),
    );

    core.reloadSuggestions("consumer");

    await vi.waitFor(() => {
      expect(core.getSuggestions("consumer").isLoading).toBe(false);
    });
    expect(core.getSuggestions("consumer").suggestions).toEqual([]);
  });

  it("does not warn when an aborted /suggest run rejects with a non-AbortError", async () => {
    // Some runtimes/polyfills (undici, some React Native engines) reject an
    // aborted `fetch` with a differently-named error (here a `TypeError`) rather
    // than a DOMException named "AbortError". The engine must still recognize
    // the abort via the run handle's `aborted` flag and stay quiet.
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const suggestRequests: CapturedRequest[] = [];
    const fetchMock = vi.fn(
      (input: unknown, init?: RequestInit): Promise<Response> => {
        const url = String(input);
        if (url.includes("/suggest")) {
          suggestRequests.push({
            url,
            method: init?.method ?? "GET",
            body: undefined,
            signal: init?.signal ?? undefined,
            headers: toHeaderRecord(init?.headers),
            credentials: init?.credentials ?? undefined,
          });
          return new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => {
              reject(new TypeError("network error"));
            });
          });
        }
        return Promise.resolve(infoResponse());
      },
    );
    global.fetch = fetchMock as unknown as typeof fetch;

    const core = new CopilotKitCore({ runtimeUrl: "https://runtime.example" });
    await waitForCondition(() => core.suggestions === true);
    registerAgents(core, [createMessage({ content: "hello" })]);
    core.addSuggestionsConfig(
      createSuggestionsConfig({ consumerAgentId: "consumer" }),
    );

    core.reloadSuggestions("consumer");
    await vi.waitFor(() => {
      expect(suggestRequests).toHaveLength(1);
    });

    core.clearSuggestions("consumer");

    await vi.waitFor(() => {
      expect(core.getSuggestions("consumer").isLoading).toBe(false);
    });
    expect(suggestRequests[0]!.signal?.aborted).toBe(true);
    const suggestionWarnings = warnSpy.mock.calls.filter((call) =>
      String(call[0]).includes("Error generating suggestions"),
    );
    expect(suggestionWarnings).toHaveLength(0);
  });

  it("isAbortError detects a plain object with name AbortError", () => {
    expect(isAbortError({ name: "AbortError" })).toBe(true);
    expect(isAbortError(new DOMException("Aborted", "AbortError"))).toBe(true);
    expect(isAbortError(new Error("boom"))).toBe(false);
    expect(isAbortError(null)).toBe(false);
    expect(isAbortError("AbortError")).toBe(false);
  });
});
