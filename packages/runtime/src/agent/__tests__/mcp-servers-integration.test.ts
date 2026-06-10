import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { BasicAgent } from "../index";
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

  it("an unreachable MCP server (SSE vs HTTP-only mock) is skipped, not fatal", async () => {
    // MCPMock only supports Streamable HTTP, not SSE — so the SSE client
    // fails to connect. The run must degrade gracefully: no RUN_ERROR, and
    // streamText still runs (just without that server's tools).
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
      mockStreamTextResponse([textDelta("ok"), finish()]) as any,
    );

    const events = await collectEvents(agent["run"](baseInput));

    expect(events.some((e: any) => e.type === EventType.RUN_ERROR)).toBe(false);
    expect(vi.mocked(streamText).mock.calls.length).toBeGreaterThan(0);
    // The failed server contributed no tools.
    const callArgs = vi.mocked(streamText).mock.calls[0][0];
    expect(callArgs.tools ?? {}).not.toHaveProperty("get_weather");
  });

  it("a down MCP server is skipped while a healthy one still loads its tools", async () => {
    const result = await startMcpServer([
      { name: "get_weather", description: "Get the weather" },
    ]);
    llm = result.llm;
    mcpMock = result.mcpMock;

    const agent = new BasicAgent({
      model: "openai/gpt-4o",
      mcpServers: [
        { type: "http", url: "http://127.0.0.1:1/mcp" }, // unreachable
        { type: "http", url: result.mcpUrl }, // healthy
      ],
    });

    vi.mocked(streamText).mockReturnValue(
      mockStreamTextResponse([textDelta("ok"), finish()]) as any,
    );

    const events = await collectEvents(agent["run"](baseInput));

    // The dead server is skipped; the run completes and the healthy server's
    // tools are present.
    expect(events.some((e: any) => e.type === EventType.RUN_ERROR)).toBe(false);
    const callArgs = vi.mocked(streamText).mock.calls[0][0];
    expect(callArgs.tools).toHaveProperty("get_weather");
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

  it("the only MCP server being unreachable does NOT fail the run", async () => {
    const agent = new BasicAgent({
      model: "openai/gpt-4o",
      mcpServers: [{ type: "http", url: "http://localhost:59999" }],
    });

    vi.mocked(streamText).mockReturnValue(
      mockStreamTextResponse([textDelta("ok"), finish()]) as any,
    );

    const events = await collectEvents(agent["run"](baseInput));

    // Graceful degradation: the unreachable server is skipped, no RUN_ERROR,
    // and the run still proceeds (just with no MCP tools).
    expect(events.some((e: any) => e.type === EventType.RUN_ERROR)).toBe(false);
    expect(vi.mocked(streamText).mock.calls.length).toBeGreaterThan(0);
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
});
