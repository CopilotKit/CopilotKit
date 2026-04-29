import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { BasicAgent, MCPHeaderResolverError } from "../index";
import { EventType } from "@ag-ui/client";
import { streamText } from "ai";
import { LLMock, MCPMock } from "@copilotkit/aimock";
import {
  mockStreamTextResponse,
  textDelta,
  finish,
  collectEvents,
  toolCall,
  toolResult,
} from "./test-helpers";

// Mock the ai module — we don't want real LLM calls
vi.mock("ai", () => ({
  streamText: vi.fn(),
  tool: vi.fn((config) => config),
  stepCountIs: vi.fn((count: number) => ({ type: "stepCount", count })),
}));

vi.mock("@ai-sdk/openai", () => ({
  createOpenAI: vi.fn(() => (modelId: string) => ({
    modelId,
    provider: "openai",
  })),
}));

// Do NOT mock @ai-sdk/mcp or @modelcontextprotocol/sdk transports —
// we want real HTTP connections to the MCPMock server.

/**
 * Spin up an LLMock-mounted MCPMock with a real HTTP listener — the mock
 * has to actually respond so the agent's MCP init + tools/list can
 * complete and the run progresses to streamText.
 */
async function startMcpServerWithJournal(
  tools: Array<{ name: string; description?: string }>,
): Promise<{ mcpUrl: string; llm: LLMock; mcpMock: MCPMock }> {
  const mock = new MCPMock();
  for (const t of tools) {
    mock.addTool({
      name: t.name,
      description: t.description ?? `${t.name} tool`,
      inputSchema: {
        type: "object",
        properties: { query: { type: "string" } },
      },
    });
    mock.onToolCall(t.name, () => `result from ${t.name}`);
  }
  const server = new LLMock({ port: 0 });
  server.mount("/mcp", mock);
  await server.start();
  return { mcpUrl: `${server.url}/mcp`, llm: server, mcpMock: mock };
}

/**
 * `server.getRequests()` redacts `Authorization` to `[REDACTED]` (aimock
 * privacy feature) — useless when the test needs to see the actual outgoing
 * auth value. Spy on `globalThis.fetch` instead and read the headers off
 * each call's `RequestInit`. The spy preserves the real fetch so MCPMock
 * still responds. Filter to MCP-bound requests by URL substring to ignore
 * any unrelated traffic that might land on the recorder.
 */
function spyOnFetch(mcpUrl: string): {
  records: Array<Record<string, string>>;
  restore: () => void;
} {
  const records: Array<Record<string, string>> = [];
  const realFetch = globalThis.fetch;
  const spy = vi
    .spyOn(globalThis, "fetch")
    .mockImplementation(async (input, init) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;
      if (url.startsWith(mcpUrl)) {
        const seen: Record<string, string> = {};
        new Headers(init?.headers ?? {}).forEach((value, key) => {
          seen[key.toLowerCase()] = value;
        });
        records.push(seen);
      }
      return realFetch(input, init);
    });
  return {
    records,
    restore: () => spy.mockRestore(),
  };
}

/**
 * x-cpki-user-id is NOT in aimock's redaction list, so journal entries
 * carry the real value. Use this when comparing per-call values.
 */
function userIdsFrom(server: LLMock): string[] {
  return server
    .getRequests()
    .map((entry) => entry.headers?.["x-cpki-user-id"])
    .filter((v): v is string => typeof v === "string");
}

describe("mcpServers — real MCP server integration", () => {
  const originalEnv = process.env;
  let llm: LLMock;
  let mcpMock: MCPMock;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv };
    process.env.OPENAI_API_KEY = "test-key";
  });

  afterEach(async () => {
    process.env = originalEnv;
    if (llm) {
      await llm.stop().catch(() => {});
    }
  });

  const baseInput = {
    threadId: "thread1",
    runId: "run1",
    messages: [],
    tools: [],
    context: [],
    state: {},
  };

  /**
   * Start an LLMock with an MCPMock mounted at /mcp.
   * Returns the full MCP endpoint URL.
   */
  async function startMcpServer(
    tools: Array<{ name: string; description?: string }>,
  ): Promise<{ mcpUrl: string; llm: LLMock; mcpMock: MCPMock }> {
    const mock = new MCPMock();
    for (const t of tools) {
      mock.addTool({
        name: t.name,
        description: t.description ?? `${t.name} tool`,
        inputSchema: {
          type: "object",
          properties: { query: { type: "string" } },
        },
      });
      mock.onToolCall(t.name, () => `result from ${t.name}`);
    }

    const server = new LLMock({ port: 0 });
    server.mount("/mcp", mock);
    await server.start();

    return {
      mcpUrl: `${server.url}/mcp`,
      llm: server,
      mcpMock: mock,
    };
  }

  it("HTTP transport fetches tools from MCPMock", async () => {
    const result = await startMcpServer([
      { name: "get_weather", description: "Get the weather" },
    ]);
    llm = result.llm;
    mcpMock = result.mcpMock;

    const agent = new BasicAgent({
      model: "openai/gpt-4o",
      mcpServers: [{ type: "http", url: result.mcpUrl }],
    });

    vi.mocked(streamText).mockReturnValue(
      mockStreamTextResponse([textDelta("Hello"), finish()]) as any,
    );

    await collectEvents(agent["run"](baseInput));

    const callArgs = vi.mocked(streamText).mock.calls[0][0];
    expect(callArgs.tools).toHaveProperty("get_weather");
  });

  it("SSE transport against MCPMock emits RUN_ERROR or completes without crash", async () => {
    // MCPMock only supports Streamable HTTP, not SSE.
    // The agent should emit RUN_ERROR when SSE connection fails.
    const result = await startMcpServer([
      { name: "get_weather", description: "Get the weather" },
    ]);
    llm = result.llm;
    mcpMock = result.mcpMock;

    const agent = new BasicAgent({
      model: "openai/gpt-4o",
      mcpServers: [{ type: "sse", url: result.mcpUrl }],
    });

    vi.mocked(streamText).mockReturnValue(
      mockStreamTextResponse([finish()]) as any,
    );

    // Collect events manually — the Observable may error after emitting RUN_ERROR
    const events: any[] = [];
    try {
      await new Promise((resolve, reject) => {
        agent["run"](baseInput).subscribe({
          next: (event: any) => events.push(event),
          error: (err: any) => reject(err),
          complete: () => resolve(events),
        });
      });
      // If it completes without error, that's also acceptable (graceful fallthrough)
    } catch {
      // Expected — SSE transport failure should emit RUN_ERROR then error
    }

    const hasRunError = events.some((e) => e.type === EventType.RUN_ERROR);
    // Either we got a RUN_ERROR or streamText was never called (connection failed before tools fetch)
    expect(hasRunError || !vi.mocked(streamText).mock.calls.length).toBe(true);
  });

  it("tool call round-trip emits TOOL_CALL_START, TOOL_CALL_RESULT, and TEXT_MESSAGE_CHUNK", async () => {
    const result = await startMcpServer([
      { name: "get_weather", description: "Get the weather" },
    ]);
    llm = result.llm;
    mcpMock = result.mcpMock;

    const agent = new BasicAgent({
      model: "openai/gpt-4o",
      mcpServers: [{ type: "http", url: result.mcpUrl }],
    });

    vi.mocked(streamText).mockReturnValue(
      mockStreamTextResponse([
        toolCall("tc1", "get_weather", { query: "NYC" }),
        toolResult("tc1", "get_weather", "Sunny 72F"),
        textDelta("The weather is sunny."),
        finish(),
      ]) as any,
    );

    const events = await collectEvents(agent["run"](baseInput));

    const types = events.map((e: any) => e.type);
    expect(types).toContain(EventType.TOOL_CALL_START);
    expect(types).toContain(EventType.TOOL_CALL_RESULT);
    expect(types).toContain(EventType.TEXT_MESSAGE_CHUNK);

    // Verify the tool call result content
    const resultEvent = events.find(
      (e: any) => e.type === EventType.TOOL_CALL_RESULT,
    ) as any;
    expect(resultEvent.toolCallId).toBe("tc1");
    expect(resultEvent.content).toContain("Sunny 72F");
  });

  it("MCP clients are cleaned up after completion — second run creates fresh connections", async () => {
    const result = await startMcpServer([
      { name: "get_weather", description: "Get the weather" },
    ]);
    llm = result.llm;
    mcpMock = result.mcpMock;

    const agent = new BasicAgent({
      model: "openai/gpt-4o",
      mcpServers: [{ type: "http", url: result.mcpUrl }],
    });

    // First run
    vi.mocked(streamText).mockReturnValue(
      mockStreamTextResponse([textDelta("Run 1"), finish()]) as any,
    );
    const events1 = await collectEvents(agent["run"](baseInput));
    expect(events1.some((e: any) => e.type === EventType.RUN_FINISHED)).toBe(
      true,
    );

    // Second run — should succeed with fresh MCP client connections
    vi.mocked(streamText).mockReturnValue(
      mockStreamTextResponse([textDelta("Run 2"), finish()]) as any,
    );
    const events2 = await collectEvents(agent["run"](baseInput));
    expect(events2.some((e: any) => e.type === EventType.RUN_FINISHED)).toBe(
      true,
    );

    // streamText was called twice (once per run), each time with MCP tools
    expect(vi.mocked(streamText).mock.calls).toHaveLength(2);
    expect(vi.mocked(streamText).mock.calls[0][0].tools).toHaveProperty(
      "get_weather",
    );
    expect(vi.mocked(streamText).mock.calls[1][0].tools).toHaveProperty(
      "get_weather",
    );
  });

  it("unreachable MCP server emits RUN_ERROR", async () => {
    const agent = new BasicAgent({
      model: "openai/gpt-4o",
      mcpServers: [{ type: "http", url: "http://localhost:59999" }],
    });

    vi.mocked(streamText).mockReturnValue(
      mockStreamTextResponse([finish()]) as any,
    );

    const events: any[] = [];
    try {
      await new Promise((resolve, reject) => {
        agent["run"](baseInput).subscribe({
          next: (event: any) => events.push(event),
          error: (err: any) => reject(err),
          complete: () => resolve(events),
        });
      });
    } catch {
      // Expected — connection refused should cause an error
    }

    expect(events.some((e) => e.type === EventType.RUN_ERROR)).toBe(true);
    // streamText should not have been called since MCP init failed
    expect(streamText).not.toHaveBeenCalled();
  });

  it("MCP clients are cleaned up after streamText error — subsequent run still works", async () => {
    const result = await startMcpServer([
      { name: "get_weather", description: "Get the weather" },
    ]);
    llm = result.llm;
    mcpMock = result.mcpMock;

    const agent = new BasicAgent({
      model: "openai/gpt-4o",
      mcpServers: [{ type: "http", url: result.mcpUrl }],
    });

    // First run — streamText throws an error
    vi.mocked(streamText).mockImplementation(() => {
      throw new Error("LLM connection failed");
    });

    const events1: any[] = [];
    try {
      await new Promise((resolve, reject) => {
        agent["run"](baseInput).subscribe({
          next: (event: any) => events1.push(event),
          error: (err: any) => reject(err),
          complete: () => resolve(events1),
        });
      });
    } catch {
      // Expected — streamText threw
    }

    // Should have emitted RUN_ERROR
    expect(events1.some((e) => e.type === EventType.RUN_ERROR)).toBe(true);

    // Second run — streamText works normally, proving MCP cleanup happened
    vi.mocked(streamText).mockReturnValue(
      mockStreamTextResponse([textDelta("Recovery"), finish()]) as any,
    );
    const events2 = await collectEvents(agent["run"](baseInput));
    expect(events2.some((e: any) => e.type === EventType.RUN_FINISHED)).toBe(
      true,
    );

    // The second run should have MCP tools available
    const secondCallArgs = vi.mocked(streamText).mock.calls[1][0];
    expect(secondCallArgs.tools).toHaveProperty("get_weather");
  });

  it("MCP tool descriptions are passed to streamText tools config", async () => {
    const result = await startMcpServer([
      { name: "get_weather", description: "Get the weather" },
    ]);
    llm = result.llm;
    mcpMock = result.mcpMock;

    const agent = new BasicAgent({
      model: "openai/gpt-4o",
      mcpServers: [{ type: "http", url: result.mcpUrl }],
    });

    vi.mocked(streamText).mockReturnValue(
      mockStreamTextResponse([textDelta("Hello"), finish()]) as any,
    );

    await collectEvents(agent["run"](baseInput));

    const callArgs = vi.mocked(streamText).mock.calls[0][0];
    expect(callArgs.tools).toHaveProperty("get_weather");
    // The MCP tool should include the description from the MCPMock server
    expect(callArgs.tools.get_weather.description).toBe("Get the weather");
  });

  it("multiple MCP servers merge tools from both", async () => {
    // First server with get_weather
    const result1 = await startMcpServer([
      { name: "get_weather", description: "Get the weather" },
    ]);
    llm = result1.llm;

    // Second server with search_docs
    const mock2 = new MCPMock();
    mock2.addTool({
      name: "search_docs",
      description: "Search documentation",
      inputSchema: {
        type: "object",
        properties: { query: { type: "string" } },
      },
    });
    mock2.onToolCall("search_docs", () => "doc results");

    const llm2 = new LLMock({ port: 0 });
    llm2.mount("/mcp", mock2);
    await llm2.start();

    try {
      const agent = new BasicAgent({
        model: "openai/gpt-4o",
        mcpServers: [
          { type: "http", url: result1.mcpUrl },
          { type: "http", url: `${llm2.url}/mcp` },
        ],
      });

      vi.mocked(streamText).mockReturnValue(
        mockStreamTextResponse([
          textDelta("Both tools available"),
          finish(),
        ]) as any,
      );

      await collectEvents(agent["run"](baseInput));

      const callArgs = vi.mocked(streamText).mock.calls[0][0];
      expect(callArgs.tools).toHaveProperty("get_weather");
      expect(callArgs.tools).toHaveProperty("search_docs");
    } finally {
      await llm2.stop().catch(() => {});
    }
  });

  describe("static headers + per-call getHeaders", () => {
    it("static `headers` are sent on every outbound MCP request (HTTP)", async () => {
      const result = await startMcpServerWithJournal([{ name: "get_weather" }]);
      llm = result.llm;
      mcpMock = result.mcpMock;

      const recorder = spyOnFetch(result.mcpUrl);
      try {
        const agent = new BasicAgent({
          model: "openai/gpt-4o",
          mcpServers: [
            {
              type: "http",
              url: result.mcpUrl,
              headers: { Authorization: "Bearer cpk-test-token" },
            },
          ],
        });

        vi.mocked(streamText).mockReturnValue(
          mockStreamTextResponse([textDelta("Hello"), finish()]) as any,
        );

        await collectEvents(agent["run"](baseInput));

        expect(recorder.records.length).toBeGreaterThan(0);
        for (const headers of recorder.records) {
          expect(headers["authorization"]).toBe("Bearer cpk-test-token");
        }
      } finally {
        recorder.restore();
      }
    });

    it("getHeaders runs per outbound HTTP request, not once per session", async () => {
      const result = await startMcpServerWithJournal([{ name: "get_weather" }]);
      llm = result.llm;
      mcpMock = result.mcpMock;

      // Counter-based resolver: returns a different user-id on every
      // invocation. If the SDK opened the connection once and reused
      // headers (i.e. cached across calls), all requests would carry
      // the same user-id.
      let counter = 0;
      const resolverInvocations: string[] = [];
      const agent = new BasicAgent({
        model: "openai/gpt-4o",
        mcpServers: [
          {
            type: "http",
            url: result.mcpUrl,
            getHeaders: () => {
              const id = `user-${counter++}`;
              resolverInvocations.push(id);
              return { "X-Cpki-User-Id": id };
            },
          },
        ],
      });

      vi.mocked(streamText).mockReturnValue(
        mockStreamTextResponse([textDelta("ok"), finish()]) as any,
      );
      await collectEvents(agent["run"](baseInput));

      // The MCP SDK opens with `initialize` and `tools/list`. Both are
      // wrapped-fetch invocations, both must hit the resolver.
      expect(resolverInvocations.length).toBeGreaterThanOrEqual(2);

      // Distinct values across requests on the wire prove no caching
      // happened. x-cpki-user-id is NOT redacted by aimock so we can read
      // the actual values from the journal.
      const userIds = userIdsFrom(result.llm);
      expect(new Set(userIds).size).toBeGreaterThanOrEqual(2);
    });

    it("getHeaders receives requestHeaders snapshot + input + mcpServerUrl", async () => {
      const result = await startMcpServerWithJournal([{ name: "get_weather" }]);
      llm = result.llm;
      mcpMock = result.mcpMock;

      const seenContexts: Array<{
        requestHeaders: Record<string, string>;
        threadId: string;
        mcpServerUrl: string;
      }> = [];

      const agent = new BasicAgent({
        model: "openai/gpt-4o",
        mcpServers: [
          {
            type: "http",
            url: result.mcpUrl,
            getHeaders: ({ requestHeaders, input, mcpServerUrl }) => {
              seenContexts.push({
                requestHeaders: { ...requestHeaders },
                threadId: input.threadId,
                mcpServerUrl,
              });
              return { "X-Cpki-User-Id": "anyone" };
            },
          },
        ],
      });
      // Simulate the runtime's `extractForwardableHeaders` populating headers.
      agent.headers = { "x-cpki-user-id": "from-bff" };

      vi.mocked(streamText).mockReturnValue(
        mockStreamTextResponse([finish()]) as any,
      );
      await collectEvents(agent["run"](baseInput));

      expect(seenContexts.length).toBeGreaterThan(0);
      const ctx = seenContexts[0];
      expect(ctx.requestHeaders["x-cpki-user-id"]).toBe("from-bff");
      expect(ctx.threadId).toBe("thread1");
      expect(ctx.mcpServerUrl).toBe(result.mcpUrl);
    });

    it("getHeaders throwing surfaces RUN_ERROR carrying MCPHeaderResolverError", async () => {
      const result = await startMcpServerWithJournal([{ name: "get_weather" }]);
      llm = result.llm;
      mcpMock = result.mcpMock;

      const agent = new BasicAgent({
        model: "openai/gpt-4o",
        mcpServers: [
          {
            type: "http",
            url: result.mcpUrl,
            getHeaders: () => {
              throw new Error("BFF forgot to forward X-Cpki-User-Id");
            },
          },
        ],
      });

      vi.mocked(streamText).mockReturnValue(
        mockStreamTextResponse([finish()]) as any,
      );

      const events: any[] = [];
      try {
        await new Promise((resolve, reject) => {
          agent["run"](baseInput).subscribe({
            next: (event) => events.push(event),
            error: (err) => reject(err),
            complete: () => resolve(events),
          });
        });
      } catch {
        // Expected — resolver threw, fetch wrapper rethrew, transport failed.
      }

      const runError = events.find((e) => e.type === EventType.RUN_ERROR);
      expect(runError).toBeDefined();
      // The wrapped fetch reports through MCPHeaderResolverError so the
      // run-error message attributes the failure to the resolver, not the
      // transport. We assert message content here; the original cause is
      // preserved on the thrown class instance via ES2022 Error.cause
      // (visible to subscribers of the Observable error notification, not
      // on the AG-UI run-error event payload).
      expect(runError?.message).toContain("MCP header resolver");
      expect(runError?.message).toContain("BFF forgot to forward");
      // The thrown error class is exported so user code can branch on it.
      expect(MCPHeaderResolverError).toBeDefined();
    });

    it("backwards-compat: existing config with no auth fields still loads tools", async () => {
      const result = await startMcpServerWithJournal([{ name: "get_weather" }]);
      llm = result.llm;
      mcpMock = result.mcpMock;

      const recorder = spyOnFetch(result.mcpUrl);
      try {
        const agent = new BasicAgent({
          model: "openai/gpt-4o",
          mcpServers: [{ type: "http", url: result.mcpUrl }],
        });

        vi.mocked(streamText).mockReturnValue(
          mockStreamTextResponse([textDelta("ok"), finish()]) as any,
        );
        await collectEvents(agent["run"](baseInput));

        const callArgs = vi.mocked(streamText).mock.calls[0][0];
        expect(callArgs.tools).toHaveProperty("get_weather");
        // No Authorization or X-Cpki-User-Id on the wire when no auth fields
        // are configured.
        for (const headers of recorder.records) {
          expect(headers["authorization"]).toBeUndefined();
          expect(headers["x-cpki-user-id"]).toBeUndefined();
        }
      } finally {
        recorder.restore();
      }
    });

    it("getHeaders overrides static `headers` when both set Authorization", async () => {
      const result = await startMcpServerWithJournal([{ name: "get_weather" }]);
      llm = result.llm;
      mcpMock = result.mcpMock;

      const recorder = spyOnFetch(result.mcpUrl);
      try {
        const agent = new BasicAgent({
          model: "openai/gpt-4o",
          mcpServers: [
            {
              type: "http",
              url: result.mcpUrl,
              headers: { Authorization: "Bearer cpk-static" },
              getHeaders: () => ({ Authorization: "Bearer cpk-resolver-wins" }),
            },
          ],
        });

        vi.mocked(streamText).mockReturnValue(
          mockStreamTextResponse([finish()]) as any,
        );
        await collectEvents(agent["run"](baseInput));

        expect(recorder.records.length).toBeGreaterThan(0);
        for (const headers of recorder.records) {
          expect(headers["authorization"]).toBe("Bearer cpk-resolver-wins");
        }
      } finally {
        recorder.restore();
      }
    });

    it("static headers reach the wire on the SSE transport (regression for the silently-dropped-headers bug)", async () => {
      // MCPMock doesn't speak SSE so the connection ultimately fails, but the
      // initial GET still goes out via fetch — that's enough to verify the
      // transport actually attaches `headers` to the outbound request, which
      // a previous direct-SDK construction silently dropped.
      const result = await startMcpServerWithJournal([{ name: "get_weather" }]);
      llm = result.llm;
      mcpMock = result.mcpMock;

      const recorder = spyOnFetch(result.mcpUrl);
      try {
        const agent = new BasicAgent({
          model: "openai/gpt-4o",
          mcpServers: [
            {
              type: "sse",
              url: result.mcpUrl,
              headers: { "X-Test-Auth": "sse-static-token" },
            },
          ],
        });

        vi.mocked(streamText).mockReturnValue(
          mockStreamTextResponse([finish()]) as any,
        );

        try {
          await new Promise((resolve, reject) => {
            agent["run"](baseInput).subscribe({
              next: () => {},
              error: (err) => reject(err),
              complete: () => resolve(undefined),
            });
          });
        } catch {
          // Expected — SSE init fails because MCPMock doesn't speak SSE.
        }

        expect(recorder.records.length).toBeGreaterThan(0);
        for (const headers of recorder.records) {
          expect(headers["x-test-auth"]).toBe("sse-static-token");
        }
      } finally {
        recorder.restore();
      }
    });
  });
});
