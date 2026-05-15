import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { BasicAgent } from "../../../../agent";
import { INTELLIGENCE_USER_ID_HEADER } from "../client";
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

const baseInput = {
  threadId: "thread1",
  runId: "run1",
  messages: [],
  tools: [],
  context: [],
  state: {},
};

describe("BuiltInAgent — Intelligence MCP auto-attach via forwardedProps", () => {
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

  it("attaches the Intelligence MCP server when forwardedProps carries userId + apiKey + mcpUrl", async () => {
    const { url, server } = await startMcpMock();
    llm = server;

    const recorder = spyOnFetch(`${url}/mcp`);
    try {
      const agent = new BasicAgent({ model: "openai/gpt-4o" });

      vi.mocked(streamText).mockReturnValue(
        mockStreamTextResponse([textDelta("hi"), finish()]) as any,
      );

      await collectEvents(
        agent["run"]({
          ...baseInput,
          forwardedProps: {
            auth: {
              copilotkitIntelligence: {
                userId: "jordan-beamson",
                apiKey: "cpk-proj_short_long",
                mcpUrl: `${url}/mcp`,
              },
            },
          },
        }),
      );

      expect(recorder.records.length).toBeGreaterThan(0);
      for (const headers of recorder.records) {
        expect(headers["authorization"]).toBe("Bearer cpk-proj_short_long");
        expect(headers[INTELLIGENCE_USER_ID_HEADER]).toBe("jordan-beamson");
      }
    } finally {
      recorder.restore();
    }
  });

  it("does NOT attach when forwardedProps is empty (no Intelligence wiring this run)", async () => {
    const { url, server } = await startMcpMock();
    llm = server;

    const recorder = spyOnFetch(`${url}/mcp`);
    try {
      const agent = new BasicAgent({ model: "openai/gpt-4o" });

      vi.mocked(streamText).mockReturnValue(
        mockStreamTextResponse([finish()]) as any,
      );
      await collectEvents(agent["run"](baseInput));

      expect(recorder.records.length).toBe(0);
    } finally {
      recorder.restore();
    }
  });

  it("does NOT attach when only some of the three props are present", async () => {
    const { url, server } = await startMcpMock();
    llm = server;

    const recorder = spyOnFetch(`${url}/mcp`);
    try {
      const agent = new BasicAgent({ model: "openai/gpt-4o" });

      vi.mocked(streamText).mockReturnValue(
        mockStreamTextResponse([finish()]) as any,
      );
      await collectEvents(
        agent["run"]({
          ...baseInput,
          forwardedProps: {
            auth: {
              copilotkitIntelligence: {
                // userId + apiKey but no mcpUrl — should not attach.
                userId: "jordan",
                apiKey: "cpk-proj_xx",
              },
            },
          },
        }),
      );

      expect(recorder.records.length).toBe(0);
    } finally {
      recorder.restore();
    }
  });

  it("does NOT attach when the user has already configured a server pointing at the same URL (explicit opt-in wins)", async () => {
    const { url, server } = await startMcpMock();
    llm = server;
    const mcpUrl = `${url}/mcp`;

    let userFetchCalls = 0;
    const agent = new BasicAgent({
      model: "openai/gpt-4o",
      mcpServers: [
        {
          type: "http",
          url: mcpUrl,
          options: {
            fetch: async (input, init) => {
              userFetchCalls++;
              const h = new Headers(init?.headers ?? {});
              h.set("Authorization", "Bearer user-supplied");
              h.set(INTELLIGENCE_USER_ID_HEADER, "explicit-user");
              return globalThis.fetch(input, { ...init, headers: h });
            },
          },
        },
      ],
    });

    const recorder = spyOnFetch(mcpUrl);
    try {
      vi.mocked(streamText).mockReturnValue(
        mockStreamTextResponse([finish()]) as any,
      );
      await collectEvents(
        agent["run"]({
          ...baseInput,
          forwardedProps: {
            auth: {
              copilotkitIntelligence: {
                userId: "from-runtime",
                apiKey: "cpk-proj_runtime",
                mcpUrl,
              },
            },
          },
        }),
      );

      expect(recorder.records.length).toBeGreaterThan(0);
      // Only the user's fetch wrapper hit the wire — auto-attach skipped.
      for (const headers of recorder.records) {
        expect(headers["authorization"]).toBe("Bearer user-supplied");
        expect(headers[INTELLIGENCE_USER_ID_HEADER]).toBe("explicit-user");
      }
      expect(userFetchCalls).toBeGreaterThan(0);
    } finally {
      recorder.restore();
    }
  });
});
