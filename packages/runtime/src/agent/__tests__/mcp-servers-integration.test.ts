import { describe, it, expect, vi, afterEach } from "vitest";
import http from "node:http";
import { EventType } from "@ag-ui/client";
import { LLMock, MCPMock } from "@copilotkit/aimock";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import type { TextOptions } from "@tanstack/ai";
import type { FakeResponse } from "@tanstack/ai/testing";
import type { MCPClientConfig } from "../index";
import {
  collectEvents,
  collectEventsIncludingErrors,
  createClassicAgent,
  createDefaultInput,
  eventsOfType,
  requestToolNames,
  runClassicAgent,
} from "./agent-test-helpers";

// Real MCP servers in this process, real `@tanstack/ai-mcp` clients, and a
// scripted fake model. Nothing in the MCP path is mocked.

interface ToolSpec {
  name: string;
  description: string;
}

const WEATHER: ToolSpec = {
  name: "get_weather",
  description: "Get the weather",
};

const QUERY_SCHEMA = {
  type: "object",
  properties: { query: { type: "string" } },
} as const;

/** What every test server's tool answers, so a test can tell who ran it. */
function toolResultText(label: string, args: unknown) {
  const query =
    typeof args === "object" && args !== null && "query" in args
      ? String(args.query)
      : "";
  return `result from ${label} for ${query}`;
}

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  const pending = cleanups.splice(0);
  await Promise.all(pending.map((cleanup) => cleanup().catch(() => {})));
});

/** An MCPMock with `tools`; each tool answers with {@link toolResultText}. */
function createMCPMock(tools: ToolSpec[], label = "server") {
  const mock = new MCPMock();
  for (const tool of tools) {
    mock.addTool({ ...tool, inputSchema: QUERY_SCHEMA });
    mock.onToolCall(tool.name, (args) => toolResultText(label, args));
  }
  return mock;
}

/**
 * Serves each MCPMock over Streamable HTTP at its path. Returns the base URL.
 */
async function startHttpServer(mounts: Record<string, MCPMock>) {
  const server = new LLMock({ port: 0 });
  for (const [path, mock] of Object.entries(mounts)) server.mount(path, mock);
  await server.start();
  cleanups.push(() => server.stop());
  return server.url;
}

/** One HTTP MCP server at `/mcp` with `tools`. Returns its URL. */
async function startHttpMCPServer(tools: ToolSpec[], label = "server") {
  const url = await startHttpServer({ "/mcp": createMCPMock(tools, label) });
  return `${url}/mcp`;
}

interface SseServerOptions {
  label?: string;
  /** The SSE stream opens only after this settles. */
  connectGate?: Promise<void>;
  /** `tools/list` answers only after this settles. */
  toolListGate?: Promise<void>;
}

/**
 * An MCP server on the SSE transport. It counts the SSE streams that are
 * open, so a test can see when a client closes its connection.
 */
async function startSseMCPServer(
  tools: ToolSpec[],
  options: SseServerOptions = {},
) {
  const label = options.label ?? "server";
  const transports = new Map<string, SSEServerTransport>();
  const streamHeaders: http.IncomingHttpHeaders[] = [];
  let openStreams = 0;
  let toolListRequests = 0;

  function createToolServer() {
    const server = new Server(
      { name: "sse-test-server", version: "1.0.0" },
      { capabilities: { tools: {} } },
    );
    server.setRequestHandler(ListToolsRequestSchema, async () => {
      toolListRequests++;
      await options.toolListGate;
      return {
        tools: tools.map((tool) => ({ ...tool, inputSchema: QUERY_SCHEMA })),
      };
    });
    server.setRequestHandler(CallToolRequestSchema, async (request) => ({
      content: [
        {
          type: "text",
          text: toolResultText(label, request.params.arguments),
        },
      ],
    }));
    return server;
  }

  async function openStream(res: http.ServerResponse) {
    await options.connectGate;
    if (res.destroyed) return;
    const transport = new SSEServerTransport("/messages", res);
    transports.set(transport.sessionId, transport);
    await createToolServer().connect(transport);
  }

  const httpServer = http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    if (req.method === "GET" && url.pathname === "/sse") {
      streamHeaders.push(req.headers);
      openStreams++;
      res.on("close", () => {
        openStreams--;
      });
      void openStream(res);
      return;
    }
    const transport = transports.get(url.searchParams.get("sessionId") ?? "");
    if (req.method === "POST" && url.pathname === "/messages" && transport) {
      void transport.handlePostMessage(req, res);
      return;
    }
    res.writeHead(404).end();
  });

  await new Promise<void>((resolve) => {
    httpServer.listen(0, "127.0.0.1", () => resolve());
  });
  cleanups.push(
    () =>
      new Promise<void>((resolve) => {
        httpServer.closeAllConnections();
        httpServer.close(() => resolve());
      }),
  );
  const address = httpServer.address();
  if (address === null || typeof address === "string") {
    throw new Error("The SSE test server has no TCP port");
  }

  return {
    url: `http://127.0.0.1:${address.port}/sse`,
    openStreams: () => openStreams,
    streamHeaders,
    toolListRequests: () => toolListRequests,
  };
}

/** A promise and the function that settles it. */
function createGate() {
  let open!: () => void;
  const promise = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { promise, open };
}

function findTool(request: TextOptions, name: string) {
  return request.tools?.find((tool) => tool.name === name);
}

/** The model calls `name` once, then answers with `text`. */
function callToolThenAnswer(name: string, text = "done") {
  return [
    { toolCalls: [{ id: "tc1", name, input: { query: "NYC" } }] },
    { text },
  ];
}

const transports = [
  {
    type: "http",
    start: (tools: ToolSpec[]) => startHttpMCPServer(tools, "http"),
  },
  {
    type: "sse",
    start: async (tools: ToolSpec[]) =>
      (await startSseMCPServer(tools, { label: "sse" })).url,
  },
] as const;

describe("mcpServers: real MCP servers", () => {
  it.each(transports)(
    "lists the tools of a $type server to the model",
    async ({ type, start }) => {
      const url = await start([WEATHER]);

      const { requests } = await runClassicAgent({
        mcpServers: [{ type, url }],
      });

      expect(findTool(requests[0], "get_weather")?.description).toBe(
        "Get the weather",
      );
    },
  );

  it.each(transports)(
    "runs a $type server's tool when the model calls it",
    async ({ type, start }) => {
      const url = await start([WEATHER]);

      const { events } = await runClassicAgent(
        { mcpServers: [{ type, url }], maxSteps: 2 },
        callToolThenAnswer("get_weather", "The weather is sunny."),
      );

      const [result] = eventsOfType(events, EventType.TOOL_CALL_RESULT);
      expect(result.toolCallId).toBe("tc1");
      expect(result.content).toContain(`result from ${type} for NYC`);
      const text = eventsOfType(events, EventType.TEXT_MESSAGE_CHUNK)
        .map((event) => event.delta)
        .join("");
      expect(text).toBe("The weather is sunny.");
    },
  );

  it("sends the configured headers to an SSE server", async () => {
    const server = await startSseMCPServer([WEATHER]);

    await runClassicAgent({
      mcpServers: [
        {
          type: "sse",
          url: server.url,
          headers: { Authorization: "Bearer SENTINEL-TOKEN" },
        },
      ],
    });

    expect(server.streamHeaders[0]?.authorization).toBe(
      "Bearer SENTINEL-TOKEN",
    );
  });

  it("merges the tools of several servers", async () => {
    const weatherUrl = await startHttpMCPServer([WEATHER]);
    const docsUrl = await startHttpMCPServer([
      { name: "search_docs", description: "Search documentation" },
    ]);

    const { requests } = await runClassicAgent({
      mcpServers: [
        { type: "http", url: weatherUrl },
        { type: "http", url: docsUrl },
      ],
    });

    expect(requestToolNames(requests[0])).toEqual(
      expect.arrayContaining(["get_weather", "search_docs"]),
    );
  });

  it("keeps a tool that two named servers share, and each copy calls its own server", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const search = { name: "search", description: "search" };
    const url = await startHttpServer({
      "/staging": createMCPMock([search], "staging"),
      "/production": createMCPMock([search], "production"),
    });

    try {
      const { events, requests } = await runClassicAgent(
        {
          mcpServers: [
            { type: "http", url: `${url}/staging`, name: "staging" },
            { type: "http", url: `${url}/production`, name: "production" },
          ],
          maxSteps: 2,
        },
        callToolThenAnswer("production_search"),
      );

      const names = requestToolNames(requests[0]);
      expect(names).toEqual(
        expect.arrayContaining(["staging_search", "production_search"]),
      );
      expect(names).not.toContain("search");
      const [result] = eventsOfType(events, EventType.TOOL_CALL_RESULT);
      expect(result.content).toContain("result from production for NYC");
    } finally {
      warn.mockRestore();
    }
  });
});

describe("mcpServers: a server that fails", () => {
  it("skips the only server when it is unreachable, and the run still finishes", async () => {
    const { events, requests } = await runClassicAgent({
      mcpServers: [{ type: "http", url: "http://127.0.0.1:1/mcp" }],
    });

    expect(eventsOfType(events, EventType.RUN_ERROR)).toHaveLength(0);
    expect(eventsOfType(events, EventType.RUN_FINISHED)).toHaveLength(1);
    expect(requests).toHaveLength(1);
  });

  it("skips a down server and still loads the tools of a healthy one", async () => {
    const url = await startHttpMCPServer([WEATHER]);

    const { events, requests } = await runClassicAgent({
      mcpServers: [
        { type: "http", url: "http://127.0.0.1:1/mcp" },
        { type: "http", url },
      ],
    });

    expect(eventsOfType(events, EventType.RUN_ERROR)).toHaveLength(0);
    expect(requestToolNames(requests[0])).toContain("get_weather");
  });

  it("skips a server that does not speak the configured transport", async () => {
    // MCPMock speaks Streamable HTTP only, so an SSE client cannot connect.
    const url = await startHttpMCPServer([WEATHER]);

    const { events, requests } = await runClassicAgent({
      mcpServers: [{ type: "sse", url }],
    });

    expect(eventsOfType(events, EventType.RUN_ERROR)).toHaveLength(0);
    expect(requestToolNames(requests[0])).not.toContain("get_weather");
  });

  it("logs a failed server without the credentials in its URL", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await runClassicAgent({
        mcpServers: [
          {
            type: "http",
            url: "https://user:pass@127.0.0.1:1/mcp?token=secret-123",
          },
        ],
      });

      const logged = error.mock.calls.map((call) => String(call[0])).join("\n");
      expect(logged).toContain("MCP server https://127.0.0.1:1/mcp failed");
      expect(logged).not.toMatch(/secret-123|user:pass/);
    } finally {
      error.mockRestore();
    }
  });
});

describe("mcpServers: connection lifecycle", () => {
  function sseConfig(url: string): MCPClientConfig[] {
    return [{ type: "sse", url }];
  }

  /**
   * A model answer that records how many SSE streams are open while the
   * model runs, so a test can see the stream was open before it closed.
   */
  function answerRecordingStreams(
    server: { openStreams: () => number },
    seen: number[],
    response: FakeResponse,
  ) {
    return () => {
      seen.push(server.openStreams());
      return response;
    };
  }

  it("closes its clients after a run, and opens fresh ones on the next run", async () => {
    const server = await startSseMCPServer([WEATHER]);
    const seen: number[] = [];
    const { agent, requests } = createClassicAgent(
      { mcpServers: sseConfig(server.url) },
      [
        answerRecordingStreams(server, seen, { text: "Run 1" }),
        answerRecordingStreams(server, seen, { text: "Run 2" }),
      ],
    );

    await collectEvents(agent.run(createDefaultInput()));
    await vi.waitFor(() => expect(server.openStreams()).toBe(0));
    await collectEvents(agent.run(createDefaultInput({ runId: "run2" })));
    await vi.waitFor(() => expect(server.openStreams()).toBe(0));

    expect(seen).toEqual([1, 1]);
    expect(server.streamHeaders).toHaveLength(2);
    expect(requestToolNames(requests[1])).toContain("get_weather");
  });

  it("closes its clients after the model fails, and the next run still works", async () => {
    const server = await startSseMCPServer([WEATHER]);
    const seen: number[] = [];
    const { agent, requests } = createClassicAgent(
      { mcpServers: sseConfig(server.url) },
      [
        answerRecordingStreams(server, seen, {
          error: "LLM connection failed",
        }),
        { text: "Recovery" },
      ],
    );

    const failed = await collectEventsIncludingErrors(
      agent.run(createDefaultInput()),
    );
    expect(eventsOfType(failed.events, EventType.RUN_ERROR)).toHaveLength(1);
    expect(seen).toEqual([1]);
    await vi.waitFor(() => expect(server.openStreams()).toBe(0));

    const events = await collectEvents(
      agent.run(createDefaultInput({ runId: "run2" })),
    );
    expect(eventsOfType(events, EventType.RUN_FINISHED)).toHaveLength(1);
    expect(requestToolNames(requests[1])).toContain("get_weather");
  });

  it("closes its clients when the run is cancelled during the model call", async () => {
    const server = await startSseMCPServer([WEATHER]);
    const modelGate = createGate();
    const { agent, requests } = createClassicAgent(
      { mcpServers: sseConfig(server.url) },
      [
        async () => {
          await modelGate.promise;
          return { text: "too late" };
        },
      ],
    );

    const subscription = agent.run(createDefaultInput()).subscribe();
    await vi.waitFor(() => expect(requests).toHaveLength(1));
    expect(server.openStreams()).toBe(1);
    subscription.unsubscribe();

    await vi.waitFor(() => expect(server.openStreams()).toBe(0));
    modelGate.open();
  });

  it("closes a client that connects after the run is cancelled, without loading its tools", async () => {
    const connectGate = createGate();
    const server = await startSseMCPServer([WEATHER], {
      connectGate: connectGate.promise,
    });
    const { agent, requests } = createClassicAgent({
      mcpServers: sseConfig(server.url),
    });

    const run = collectEvents(agent.run(createDefaultInput()));
    await vi.waitFor(() => expect(server.streamHeaders).toHaveLength(1));
    agent.abortRun();
    connectGate.open();
    await run;

    await vi.waitFor(() => expect(server.openStreams()).toBe(0));
    expect(server.toolListRequests()).toBe(0);
    expect(requests).toHaveLength(0);
  });

  it("stops connecting to later servers when the run is cancelled during a tool lookup", async () => {
    const toolListGate = createGate();
    const first = await startSseMCPServer([WEATHER], {
      toolListGate: toolListGate.promise,
    });
    const second = await startSseMCPServer([WEATHER]);
    const { agent, requests } = createClassicAgent({
      mcpServers: [...sseConfig(first.url), ...sseConfig(second.url)],
    });

    const run = collectEvents(agent.run(createDefaultInput()));
    await vi.waitFor(() => expect(first.toolListRequests()).toBe(1));
    agent.abortRun();
    toolListGate.open();
    await run;

    await vi.waitFor(() => expect(first.openStreams()).toBe(0));
    expect(second.streamHeaders).toHaveLength(0);
    expect(requests).toHaveLength(0);
  });
});
