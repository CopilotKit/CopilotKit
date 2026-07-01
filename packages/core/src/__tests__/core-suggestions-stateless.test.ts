/**
 * Tests the stateless suggestion path: when the runtime advertises
 * `suggestions: true` via `/info`, the engine POSTs to
 * `/agent/:providerId/suggest` instead of cloning + running a client agent.
 * When the capability is absent, the engine falls back to the clone+runAgent
 * path.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AbstractAgent, Message } from "@ag-ui/client";
import { CopilotKitCore } from "../core";
import {
  MockAgent,
  createSuggestionsConfig,
  createSuggestionToolCall,
  createMessage,
  waitForCondition,
} from "./test-utils";

/**
 * A JSON-serializable request captured from a `fetch` call so tests can assert
 * on the URL, method, and parsed body without `as any` casts.
 */
interface CapturedRequest {
  url: string;
  method: string;
  body: SuggestRequestBody | undefined;
  signal: AbortSignal | undefined;
}

/**
 * The subset of the stateless `/suggest` request body the engine sends. Mirrors
 * a `RunAgentInput` but only types the fields the tests inspect.
 */
interface SuggestRequestBody {
  messages: Message[];
  threadId: string;
  runId: string;
  tools: Array<{ name: string }>;
  forwardedProps: { toolChoice?: unknown } & Record<string, unknown>;
}

/**
 * The minimal `Response` surface the engine consumes from a `/suggest` (and
 * `/info`) call: `ok`, `status`, and a `json()` returning the parsed payload.
 */
interface MockResponse {
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
}

/**
 * Options controlling how the routed `fetch` stub responds to `/suggest`.
 */
interface FetchStubOptions {
  /** HTTP status for `/suggest` responses. Defaults to 200. */
  suggestStatus?: number;
  /**
   * The assistant messages returned after the marker message on a successful
   * `/suggest` call. The marker (echoing the instruction message id) is always
   * prepended by the stub.
   */
  suggestAssistantMessages?: Message[];
}

/**
 * Builds a typed `fetch` stub that routes `/info` (advertising
 * `suggestions: true`) and `/suggest`, recording every `/suggest` request so
 * tests can assert on it. The `/suggest` response echoes the marker message id
 * from the request body so `extractSuggestions` can locate it deterministically
 * without spying on the engine's internal `randomUUID` id.
 */
function setupRoutedFetch(options: FetchStubOptions = {}): {
  fetchMock: ReturnType<typeof vi.fn>;
  suggestRequests: CapturedRequest[];
} {
  const suggestRequests: CapturedRequest[] = [];
  const fetchMock = vi.fn(
    async (input: unknown, init?: RequestInit): Promise<MockResponse> => {
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
        });
        const status = options.suggestStatus ?? 200;
        const markerId = body?.messages.at(-1)?.id ?? "marker";
        const markerMessage: Message = {
          id: markerId,
          role: "user",
          content: "instruction",
        };
        return {
          ok: status >= 200 && status < 300,
          status,
          json: async () => ({
            messages: [
              markerMessage,
              ...(options.suggestAssistantMessages ?? []),
            ],
          }),
        };
      }
      // `/info`
      return {
        ok: true,
        status: 200,
        json: async () => ({
          version: "1.0.0",
          mode: "sse",
          agents: {},
          suggestions: true,
        }),
      };
    },
  );
  return { fetchMock, suggestRequests };
}

/**
 * Registers a provider + consumer MockAgent on a core and returns them.
 */
function registerAgents(
  core: CopilotKitCore,
  consumerMessages: Message[] = [],
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

  it("posts to /agent/:providerId/suggest and parses the returned suggestions", async () => {
    const { fetchMock, suggestRequests } = setupRoutedFetch({
      suggestAssistantMessages: [
        createSuggestionToolCall([{ title: "Hi", message: "Say hi" }], {
          id: "a1",
        }),
      ],
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
    expect(providerAgent.runAgentCalls).toHaveLength(0);
    expect(core.getSuggestions("consumer").suggestions).toEqual([
      { title: "Hi", message: "Say hi", isLoading: false },
    ]);
  });

  it("appends the instruction message with the marker id and forces toolChoice", async () => {
    const { fetchMock, suggestRequests } = setupRoutedFetch({
      suggestAssistantMessages: [],
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const core = new CopilotKitCore({ runtimeUrl: "https://runtime.example" });
    await waitForCondition(() => core.suggestions === true);
    registerAgents(core, [createMessage({ content: "hello" })]);
    core.addSuggestionsConfig(
      createSuggestionsConfig({
        instructions: "Focus on data analysis",
        minSuggestions: 2,
        maxSuggestions: 4,
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
  });

  it("falls back to clone + runAgent when the capability is absent", async () => {
    const fetchMock = vi.fn(async (input: unknown): Promise<MockResponse> => {
      const url = String(input);
      if (url.includes("/suggest")) {
        throw new Error("stateless path should not be used");
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          version: "1.0.0",
          mode: "sse",
          agents: {},
          // no `suggestions` field
        }),
      };
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const core = new CopilotKitCore({ runtimeUrl: "https://runtime.example" });
    await waitForCondition(() => core.runtimeVersion !== undefined);
    expect(core.suggestions).toBeUndefined();

    const { providerAgent } = registerAgents(core, [
      createMessage({ content: "hello" }),
    ]);
    providerAgent.setNewMessages([
      createSuggestionToolCall([{ title: "Fb", message: "Fallback" }], {
        id: "a1",
      }),
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

  it("finalizes loading without throwing when /suggest fails", async () => {
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
      const result = core.getSuggestions("consumer");
      expect(result.isLoading).toBe(false);
    });
    const result = core.getSuggestions("consumer");
    expect(result.suggestions).toEqual([]);
  });

  it("aborts the in-flight /suggest fetch when clearSuggestions is called", async () => {
    // A /suggest response that never resolves keeps the request in flight so
    // clearSuggestions can abort its signal.
    const suggestRequests: CapturedRequest[] = [];
    const fetchMock = vi.fn(
      (input: unknown, init?: RequestInit): Promise<MockResponse> => {
        const url = String(input);
        if (url.includes("/suggest")) {
          suggestRequests.push({
            url,
            method: init?.method ?? "GET",
            body: undefined,
            signal: init?.signal ?? undefined,
          });
          return new Promise<MockResponse>((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => {
              reject(new DOMException("Aborted", "AbortError"));
            });
          });
        }
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            version: "1.0.0",
            mode: "sse",
            agents: {},
            suggestions: true,
          }),
        });
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
});
