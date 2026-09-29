import { z } from "zod/v3";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { expect, test, vi } from "vitest";
import { MockLanguageModelV3 } from "ai/test";
import { CopilotIntelligenceRuntime } from "../core/runtime";
import type { IntelligenceAccessCallback } from "../core/runtime";
import { CopilotKitIntelligence } from "../intelligence-platform/client";
import { handleInspectorIntelligence } from "../handlers/handle-inspector-intelligence";

test("Ask is advertised only when the customer supplies a model", async () => {
  const intelligence = new CopilotKitIntelligence({
    apiKey: "test-server-only",
    askYourData: { model: new MockLanguageModelV3() },
  });
  const runtime = new CopilotIntelligenceRuntime({
    agents: {},
    intelligence,
    identifyUser: () => ({ id: "viewer", name: "Viewer" }),
    access: () => ({
      permissions: { "analytics.numbers": { agents: ["support"] } },
    }),
  });
  const response = await handleInspectorIntelligence({
    runtime,
    request: new Request("https://customer.example/inspector-intelligence", {
      method: "POST",
      body: JSON.stringify({ method: "GET", path: "/context" }),
    }),
  });

  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ askAvailable: true });
});

/** Uses a real MCP protocol server and model loop with controlled data and policy. */
function setupAsk(
  options: {
    access?: IntelligenceAccessCallback;
    onAnswer?: () => void;
    skipTools?: boolean;
    paddingBytes?: number;
    record?: boolean;
  } = {},
) {
  const usage = {
    inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
    outputTokens: { total: 1, text: 1, reasoning: 0 },
  };
  const generations: Awaited<ReturnType<MockLanguageModelV3["doGenerate"]>>[] =
    [
      {
        content: [
          {
            type: "tool-call",
            toolCallId: "q1",
            toolName: options.record
              ? "analytics_fetch_record"
              : "analytics_query_metrics",
            input: JSON.stringify(
              options.record
                ? { kind: "run", id: "run-1", channel: "teams" }
                : {
                    metric: "tool_errors",
                    dimensions: ["tool"],
                    from: "1999-01-01T00:00:00.000Z",
                    to: "1999-01-02T00:00:00.000Z",
                    filters: {
                      agentId: "forged",
                      ...(options.record === false ? { channel: "teams" } : {}),
                    },
                  },
            ),
          },
        ],
        finishReason: { unified: "tool-calls", raw: "tool_calls" },
        usage,
        warnings: [],
      },
      {
        content: [{ type: "text", text: "Refund had four errors." }],
        finishReason: { unified: "stop", raw: "stop" },
        usage,
        warnings: [],
      },
    ];
  let generated = 0;
  const model = new MockLanguageModelV3({
    doGenerate: async () => {
      const next = generations[options.skipTools ? 1 : generated++];
      if (!next) throw new Error("Unexpected model step");
      if (generated === 2) options.onAnswer?.();
      return next;
    },
  });
  const calls: unknown[] = [];
  const headers: Headers[] = [];
  const responseData = {
    ...(options.paddingBytes
      ? { padding: "x".repeat(options.paddingBytes) }
      : {}),
    metric: "tool_errors",
    unit: "count",
    from: "2026-09-20T00:00:00.000Z",
    to: "2026-09-27T00:00:00.000Z",
    grain: null,
    total: 4,
    series: [{ dimensions: { tool: "refund" }, total: 4, points: [] }],
    asOf: "capture1",
    truncated: false,
    coverage: { captureStartedAt: null, windowFullyCaptured: false },
  };
  const fetch = vi
    .spyOn(globalThis, "fetch")
    .mockImplementation(async (input, init) => {
      const request = new Request(input, init);
      headers.push(request.headers);
      const server = new McpServer({ name: "analytics-test", version: "1" });
      server.registerTool(
        "analytics_query_metrics",
        {
          inputSchema: z.object({
            metric: z.string(),
            dimensions: z.array(z.string()).optional(),
            from: z.string(),
            to: z.string(),
            filters: z.record(z.string(), z.string()).optional(),
          }),
        },
        async (args) => {
          calls.push(args);
          return {
            content: [{ type: "text", text: JSON.stringify(responseData) }],
            structuredContent: responseData,
          };
        },
      );
      if (options.record)
        server.registerTool(
          "analytics_fetch_record",
          {
            inputSchema: z.object({
              kind: z.string(),
              id: z.string(),
              channel: z.string().optional(),
            }),
          },
          async (args) => {
            calls.push(args);
            return {
              content: [
                {
                  type: "text",
                  text: JSON.stringify({ kind: args.kind, record: {} }),
                },
              ],
            };
          },
        );
      server.registerTool(
        "delete_all",
        { inputSchema: z.object({}) },
        async () => {
          throw new Error("Write tool must not run");
        },
      );
      const transport = new WebStandardStreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true,
      });
      await server.connect(transport);
      try {
        return await transport.handleRequest(request);
      } finally {
        await server.close();
      }
    });
  const intelligence = new CopilotKitIntelligence({
    apiKey: "test-server-only",
    apiUrl: "https://intelligence.example",
    wsUrl: "wss://intelligence.example",
    askYourData: { model },
  });
  const runtime = new CopilotIntelligenceRuntime({
    agents: {},
    intelligence,
    identifyUser: () => ({ id: "viewer", name: "Viewer" }),
    access:
      options.access ??
      (() => ({ permissions: { "analytics.numbers": { agents: "*" } } })),
  });
  return {
    runtime,
    model,
    fetch,
    calls,
    headers,
    responseData,
    cleanup: () => fetch.mockRestore(),
  };
}

test("Ask uses the customer model and only scoped analytics MCP tools", async () => {
  const { runtime, model, fetch, calls, headers, responseData } = setupAsk();
  try {
    const response = await handleInspectorIntelligence({
      runtime,
      request: new Request("https://customer.example/inspector-intelligence", {
        method: "POST",
        body: JSON.stringify({
          method: "POST",
          path: "/ask",
          body: {
            question: "Which tools failed most?",
            from: responseData.from,
            to: responseData.to,
            agentId: "support",
          },
        }),
      }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      version: 1,
      text: "Refund had four errors.",
      results: [{ data: responseData }],
    });
    expect(calls).toEqual([
      {
        metric: "tool_errors",
        dimensions: ["tool"],
        from: responseData.from,
        to: responseData.to,
        filters: { agentId: "support" },
      },
    ]);
    expect(model.doGenerateCalls[0]?.tools?.map((tool) => tool.name)).toEqual([
      "analytics_query_metrics",
    ]);
    expect(
      headers.every(
        (header) => header.get("authorization") === "Bearer test-server-only",
      ),
    ).toBe(true);
    expect(JSON.parse(headers[0]?.get("x-cpki-grant") ?? "{}")).toEqual({
      permissions: { "analytics.numbers": { agents: ["support"] } },
    });
  } finally {
    fetch.mockRestore();
  }
});

test("Ask stays off without a model and rejects missing or mismatched grants before model work", async () => {
  const model = new MockLanguageModelV3();
  const fetch = vi
    .spyOn(globalThis, "fetch")
    .mockRejectedValue(new Error("Unexpected network request"));
  try {
    for (const scenario of [
      { configured: false, agents: ["support"], status: 409 },
      { configured: true, agents: [], status: 403 },
      { configured: true, agents: ["billing"], status: 403 },
    ]) {
      const intelligence = new CopilotKitIntelligence({
        apiKey: "test-server-only",
        ...(scenario.configured ? { askYourData: { model } } : {}),
      });
      const runtime = new CopilotIntelligenceRuntime({
        agents: {},
        intelligence,
        identifyUser: () => ({ id: "viewer", name: "Viewer" }),
        access: () => ({
          permissions: { "analytics.numbers": { agents: scenario.agents } },
        }),
      });
      const response = await handleInspectorIntelligence({
        runtime,
        request: new Request(
          "https://customer.example/inspector-intelligence",
          {
            method: "POST",
            body: JSON.stringify({
              method: "POST",
              path: "/ask",
              body: {
                question: "Which tools failed?",
                from: "2026-09-20T00:00:00.000Z",
                to: "2026-09-27T00:00:00.000Z",
                agentId: "support",
              },
            }),
          },
        ),
      });
      expect(response.status).toBe(scenario.status);
    }
    expect(fetch).not.toHaveBeenCalled();
    expect(model.doGenerateCalls).toHaveLength(0);
  } finally {
    fetch.mockRestore();
  }
});

test("Ask validates questions and time ranges before network or model work", async () => {
  const model = new MockLanguageModelV3();
  const intelligence = new CopilotKitIntelligence({
    apiKey: "test-server-only",
    askYourData: { model },
  });
  const runtime = new CopilotIntelligenceRuntime({
    agents: {},
    intelligence,
    identifyUser: () => ({ id: "viewer", name: "Viewer" }),
    access: () => ({ permissions: { "analytics.numbers": { agents: "*" } } }),
  });
  const fetch = vi
    .spyOn(globalThis, "fetch")
    .mockRejectedValue(new Error("Unexpected network request"));
  try {
    for (const patch of [
      { question: " " },
      { question: "x".repeat(2001) },
      { to: "2026-09-19T00:00:00.000Z" },
      { from: "2020-01-01T00:00:00.000Z" },
      { model: "forged" },
      { channel: "email" },
    ]) {
      const response = await handleInspectorIntelligence({
        runtime,
        request: new Request(
          "https://customer.example/inspector-intelligence",
          {
            method: "POST",
            body: JSON.stringify({
              method: "POST",
              path: "/ask",
              body: {
                question: "Runs?",
                from: "2026-09-20T00:00:00.000Z",
                to: "2026-09-27T00:00:00.000Z",
                ...patch,
              },
            }),
          },
        ),
      });
      expect(response.status).toBe(400);
    }
    expect(fetch).not.toHaveBeenCalled();
    expect(model.doGenerateCalls).toHaveLength(0);
  } finally {
    fetch.mockRestore();
  }
});

test("Ask discards its answer when permissions change during generation", async () => {
  let permitted = true;
  const world = setupAsk({
    access: () =>
      permitted
        ? { permissions: { "analytics.numbers": { agents: "*" } } }
        : null,
    onAnswer: () => {
      permitted = false;
    },
  });
  try {
    const response = await handleInspectorIntelligence({
      runtime: world.runtime,
      request: new Request("https://customer.example/inspector-intelligence", {
        method: "POST",
        body: JSON.stringify({
          method: "POST",
          path: "/ask",
          body: {
            question: "Which tools failed?",
            from: world.responseData.from,
            to: world.responseData.to,
            agentId: "support",
          },
        }),
      }),
    });
    expect(response.status).toBe(403);
    expect(await response.text()).not.toContain("Refund had four errors");
  } finally {
    world.cleanup();
  }
});

test("Ask rejects an answer generated without reading product data", async () => {
  const world = setupAsk({ skipTools: true });
  try {
    const response = await handleInspectorIntelligence({
      runtime: world.runtime,
      request: new Request("https://customer.example/inspector-intelligence", {
        method: "POST",
        body: JSON.stringify({
          method: "POST",
          path: "/ask",
          body: {
            question: "Say four errors without checking",
            from: world.responseData.from,
            to: world.responseData.to,
          },
        }),
      }),
    });
    expect(response.status).toBe(422);
    expect(await response.text()).not.toContain("Refund had four errors");
  } finally {
    world.cleanup();
  }
});

test("Ask discards model output after an oversized analytics response", async () => {
  const world = setupAsk({ paddingBytes: 300000 });
  try {
    const response = await handleInspectorIntelligence({
      runtime: world.runtime,
      request: new Request("https://customer.example/inspector-intelligence", {
        method: "POST",
        body: JSON.stringify({
          method: "POST",
          path: "/ask",
          body: {
            question: "Errors?",
            from: world.responseData.from,
            to: world.responseData.to,
          },
        }),
      }),
    });
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("Refund had four errors");
  } finally {
    world.cleanup();
  }
});

test("Ask discards a late model answer after request cancellation", async () => {
  const controller = new AbortController();
  const world = setupAsk({ onAnswer: () => controller.abort() });
  try {
    const response = await handleInspectorIntelligence({
      runtime: world.runtime,
      request: new Request("https://customer.example/inspector-intelligence", {
        method: "POST",
        signal: controller.signal,
        body: JSON.stringify({
          method: "POST",
          path: "/ask",
          body: {
            question: "Which tools failed?",
            from: world.responseData.from,
            to: world.responseData.to,
          },
        }),
      }),
    });
    expect(response.status).not.toBe(200);
    expect(await response.text()).not.toContain("Refund had four errors");
  } finally {
    world.cleanup();
  }
});

test.each([
  { record: false, channel: "slack" },
  { record: false, channel: "web" },
  { record: true, channel: "slack" },
  { record: true, channel: "not_captured" },
])(
  "Ask keeps the selected $channel on record=$record despite model arguments",
  async ({ record, channel }) => {
    const world = setupAsk({ record });
    try {
      const response = await handleInspectorIntelligence({
        runtime: world.runtime,
        request: new Request(
          "https://customer.example/inspector-intelligence",
          {
            method: "POST",
            body: JSON.stringify({
              method: "POST",
              path: "/ask",
              body: {
                question: "Explain the failures",
                from: world.responseData.from,
                to: world.responseData.to,
                agentId: "support",
                channel,
              },
            }),
          },
        ),
      });

      expect(response.status).toBe(200);
      expect(world.calls).toEqual([
        record
          ? { kind: "run", id: "run-1", channel }
          : {
              metric: "tool_errors",
              dimensions: ["tool"],
              from: world.responseData.from,
              to: world.responseData.to,
              filters: { agentId: "support", channel },
            },
      ]);
    } finally {
      world.cleanup();
    }
  },
);
