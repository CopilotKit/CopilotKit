import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { BasicAgent, type MCPClientProvider } from "../index";
import { EventType, type RunAgentInput } from "@ag-ui/client";
import { streamText } from "ai";
import {
  mockStreamTextResponse,
  textDelta,
  finish,
  collectEvents,
} from "./test-helpers";

// Mock the ai module
vi.mock("ai", () => ({
  streamText: vi.fn(),
  tool: vi.fn((config) => config),
  stepCountIs: vi.fn((count: number) => ({ type: "stepCount", count })),
}));

// Mock the SDK clients
vi.mock("@ai-sdk/openai", () => ({
  createOpenAI: vi.fn(() => (modelId: string) => ({
    modelId,
    provider: "openai",
  })),
}));

// Mock MCP imports so mcpServers code path doesn't fail when tested alongside mcpClients
vi.mock("@ai-sdk/mcp", () => ({
  createMCPClient: vi.fn(),
}));

describe("mcpClients — user-managed MCP clients", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv };
    process.env.OPENAI_API_KEY = "test-key";
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  const baseInput: RunAgentInput = {
    threadId: "thread1",
    runId: "run1",
    messages: [],
    tools: [],
    context: [],
    state: {},
  };

  function makeMockProvider(
    tools: Record<string, any>,
  ): MCPClientProvider & { close: ReturnType<typeof vi.fn> } {
    return {
      tools: vi.fn().mockResolvedValue(tools),
      close: vi.fn(),
    };
  }

  it("tools from mcpClients are passed to streamText", async () => {
    const mockTools = {
      listEnvelopes: { description: "List envelopes", execute: vi.fn() },
    };
    const provider = makeMockProvider(mockTools);

    const agent = new BasicAgent({
      model: "openai/gpt-4o",
      mcpClients: [provider],
    });

    vi.mocked(streamText).mockReturnValue(
      mockStreamTextResponse([textDelta("Hello"), finish()]) as any,
    );

    await collectEvents(agent["run"](baseInput));

    const callArgs = vi.mocked(streamText).mock.calls[0][0];
    expect(callArgs.tools).toHaveProperty("listEnvelopes");
    expect(callArgs.tools.listEnvelopes.description).toBe("List envelopes");
    expect(provider.tools).toHaveBeenCalledOnce();
  });

  it("mcpClients are NOT closed after run completes", async () => {
    const provider = makeMockProvider({
      myTool: { description: "A tool", execute: vi.fn() },
    });

    const agent = new BasicAgent({
      model: "openai/gpt-4o",
      mcpClients: [provider],
    });

    vi.mocked(streamText).mockReturnValue(
      mockStreamTextResponse([finish()]) as any,
    );

    await collectEvents(agent["run"](baseInput));

    expect(provider.close).not.toHaveBeenCalled();
  });

  it("mcpServers tools override mcpClients tools on name collision", async () => {
    const clientExecute = vi.fn();
    const serverExecute = vi.fn();

    const provider = makeMockProvider({
      sharedTool: { description: "from client", execute: clientExecute },
    });

    // Mock mcpServers flow: createMCPClient returns a client with tools()
    const { createMCPClient } = await import("@ai-sdk/mcp");
    vi.mocked(createMCPClient).mockResolvedValue({
      tools: vi.fn().mockResolvedValue({
        sharedTool: { description: "from server", execute: serverExecute },
      }),
      close: vi.fn(),
    } as any);

    const agent = new BasicAgent({
      model: "openai/gpt-4o",
      mcpClients: [provider],
      mcpServers: [{ type: "http", url: "http://localhost:9999" }],
    });

    vi.mocked(streamText).mockReturnValue(
      mockStreamTextResponse([finish()]) as any,
    );

    await collectEvents(agent["run"](baseInput));

    const callArgs = vi.mocked(streamText).mock.calls[0][0];
    // mcpServers runs after mcpClients, so "from server" should win
    expect(callArgs.tools.sharedTool.description).toBe("from server");
  });

  it("multiple mcpClients merge in order (later overrides earlier)", async () => {
    const provider1 = makeMockProvider({
      toolA: { description: "from provider 1", execute: vi.fn() },
      shared: { description: "from provider 1", execute: vi.fn() },
    });
    const provider2 = makeMockProvider({
      toolB: { description: "from provider 2", execute: vi.fn() },
      shared: { description: "from provider 2", execute: vi.fn() },
    });

    const agent = new BasicAgent({
      model: "openai/gpt-4o",
      mcpClients: [provider1, provider2],
    });

    vi.mocked(streamText).mockReturnValue(
      mockStreamTextResponse([finish()]) as any,
    );

    await collectEvents(agent["run"](baseInput));

    const callArgs = vi.mocked(streamText).mock.calls[0][0];
    expect(callArgs.tools).toHaveProperty("toolA");
    expect(callArgs.tools).toHaveProperty("toolB");
    expect(callArgs.tools.shared.description).toBe("from provider 2");
  });

  it("empty mcpClients array is a no-op", async () => {
    const agent = new BasicAgent({
      model: "openai/gpt-4o",
      mcpClients: [],
    });

    vi.mocked(streamText).mockReturnValue(
      mockStreamTextResponse([textDelta("Hi"), finish()]) as any,
    );

    const events = await collectEvents(agent["run"](baseInput));

    // Should still work normally
    const textEvents = events.filter(
      (e: any) => e.type === EventType.TEXT_MESSAGE_CHUNK,
    );
    expect(textEvents.length).toBeGreaterThan(0);
  });

  it("mcpClients .tools() rejection emits RUN_ERROR", async () => {
    const failingProvider: MCPClientProvider = {
      tools: vi.fn().mockRejectedValue(new Error("MCP connection lost")),
    };

    const agent = new BasicAgent({
      model: "openai/gpt-4o",
      mcpClients: [failingProvider],
    });

    vi.mocked(streamText).mockReturnValue(
      mockStreamTextResponse([finish()]) as any,
    );

    // Collect events manually so we can capture RUN_ERROR before the rejection
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
      // Expected — Observable errors after emitting RUN_ERROR
    }

    // streamText should NOT have been called (error before reaching it)
    expect(streamText).not.toHaveBeenCalled();
    // A RUN_ERROR event should have been emitted
    expect(events.some((e) => e.type === EventType.RUN_ERROR)).toBe(true);
  });

  it("clone() shares the same mcpClients references", () => {
    const provider = makeMockProvider({});

    const agent = new BasicAgent({
      model: "openai/gpt-4o",
      mcpClients: [provider],
    });

    const cloned = agent.clone();

    // Access the config to verify same reference
    // Both agents share the same config object (by reference)
    expect((cloned as any).config.mcpClients[0]).toBe(provider);
  });

  it("type compatibility: @ai-sdk/mcp MCPClient satisfies MCPClientProvider", async () => {
    // Compile-time check that `MCPClientProvider` is structurally compatible
    // with `@ai-sdk/mcp`'s `MCPClient`. After the refactor `MCPClientProvider`
    // is an alias for `Pick<MCPClient, "tools">`, so this is trivially true —
    // but keeping the test guards against future divergence.
    type MCPClient = Awaited<
      ReturnType<typeof import("@ai-sdk/mcp").createMCPClient>
    >;
    const _assignable: MCPClientProvider = {} as MCPClient;
    void _assignable;
    expect(true).toBe(true);
  });
});
