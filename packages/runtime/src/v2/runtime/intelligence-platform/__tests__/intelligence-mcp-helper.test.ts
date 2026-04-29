import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { CopilotKitIntelligence } from "../client";
import { BasicAgent } from "../../../../agent";
import { EventType } from "@ag-ui/client";
import { LLMock, MCPMock } from "@copilotkit/aimock";
import { streamText } from "ai";
import {
  mockStreamTextResponse,
  textDelta,
  finish,
  collectEvents,
} from "../../../../agent/__tests__/test-helpers";

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

async function startMcpMock(): Promise<{ url: string; server: LLMock }> {
  const mock = new MCPMock();
  mock.addTool({
    name: "bash",
    description: "Run a bash command",
    inputSchema: {
      type: "object",
      properties: { command: { type: "string" } },
    },
  });
  mock.onToolCall("bash", () => "ok");
  const server = new LLMock({ port: 0 });
  server.mount("/mcp", mock);
  await server.start();
  return { url: server.url, server };
}

/**
 * aimock redacts `Authorization` to `[REDACTED]` in its journal. Spy on
 * `globalThis.fetch` to read unredacted headers off each outbound request to
 * `mcpUrl`. The spy delegates to the real fetch so the round-trip completes.
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
  return { records, restore: () => spy.mockRestore() };
}

describe("CopilotKitIntelligence.toMCPServer()", () => {
  const baseInput = {
    threadId: "thread1",
    runId: "run1",
    messages: [],
    tools: [],
    context: [],
    state: {},
  };

  let llm: LLMock | undefined;
  const originalEnv = process.env;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv };
    process.env.OPENAI_API_KEY = "test-key";
  });

  afterEach(async () => {
    process.env = originalEnv;
    if (llm) {
      await llm.stop().catch(() => {});
      llm = undefined;
    }
  });

  it("emits Authorization (Bearer apiKey) and X-Cpki-User-Id (resolved user) on every MCP request", async () => {
    const { url, server } = await startMcpMock();
    llm = server;

    const intelligence = new CopilotKitIntelligence({
      apiUrl: url,
      wsUrl: "wss://unused.example.com/socket",
      apiKey: "cpk-proj_short_long",
    });

    const recorder = spyOnFetch(url);
    try {
      const agent = new BasicAgent({
        model: "openai/gpt-4o",
        mcpServers: [intelligence.toMCPServer()],
      });
      // The runtime would normally populate this via `identifyUser` after
      // resolveIntelligenceUser. Simulate the same outcome here.
      agent.user = { id: "jordan-beamson", name: "Jordan Beamson" };

      vi.mocked(streamText).mockReturnValue(
        mockStreamTextResponse([textDelta("hi"), finish()]) as any,
      );

      await collectEvents(agent["run"](baseInput));

      expect(recorder.records.length).toBeGreaterThan(0);
      for (const headers of recorder.records) {
        expect(headers["authorization"]).toBe("Bearer cpk-proj_short_long");
        expect(headers["x-cpki-user-id"]).toBe("jordan-beamson");
      }
    } finally {
      recorder.restore();
    }
  });

  it("throws when no user has been resolved (runtime missing identifyUser)", async () => {
    const { url, server } = await startMcpMock();
    llm = server;

    const intelligence = new CopilotKitIntelligence({
      apiUrl: url,
      wsUrl: "wss://unused.example.com/socket",
      apiKey: "cpk-proj_short_long",
    });

    const agent = new BasicAgent({
      model: "openai/gpt-4o",
      mcpServers: [intelligence.toMCPServer()],
    });
    // Deliberately leave `agent.user` unset — this is the case the helper
    // must reject loudly so a misconfigured runtime doesn't silently collapse
    // every browser session into one shared bash sandbox.

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
      // expected
    }

    const runError = events.find((e: any) => e.type === EventType.RUN_ERROR);
    expect(runError).toBeDefined();
    expect(runError?.message).toContain("no user resolved");
    expect(runError?.message).toContain("identifyUser");
  });

  it("URL is composed from apiUrl + /mcp (trailing slash on apiUrl is normalized)", () => {
    const intelligence = new CopilotKitIntelligence({
      apiUrl: "https://api.example.com/",
      wsUrl: "wss://ws.example.com",
      apiKey: "k",
    });
    expect(intelligence.toMCPServer().url).toBe("https://api.example.com/mcp");
  });
});
