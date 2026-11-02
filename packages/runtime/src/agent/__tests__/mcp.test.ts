import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import type { CallToolResult, Tool } from "@modelcontextprotocol/sdk/types.js";
import { connectMCPServers } from "../mcp";
import type { MCPClientConfig } from "../mcp";
import type { AgentToolSpec } from "../tool-spec";

interface ServerTool {
  name: string;
  inputSchema?: Tool["inputSchema"];
  run?: (args: Record<string, unknown>) => CallToolResult;
}

interface ServerOptions {
  tools: ServerTool[];
  /** Tools per `tools/list` page. Default: all on one page. */
  pageSize?: number;
  /** Answer `tools/list` with a JSON-RPC error. */
  failListTools?: boolean;
}

const echoArgs = (args: Record<string, unknown>): CallToolResult => ({
  content: [{ type: "text", text: JSON.stringify(args) }],
});

const servers: http.Server[] = [];

/** Starts an HTTP server on a random local port and returns its base URL. */
async function listen(handler: http.RequestListener) {
  const httpServer = http.createServer(handler);
  await new Promise<void>((resolve) =>
    httpServer.listen(0, "127.0.0.1", resolve),
  );
  servers.push(httpServer);
  const { port } = httpServer.address() as AddressInfo;
  return `http://127.0.0.1:${port}`;
}

function createMcpServer({
  tools,
  pageSize = tools.length,
  failListTools = false,
}: ServerOptions) {
  const mcp = new Server(
    { name: "test-server", version: "1.0.0" },
    { capabilities: { tools: {} } },
  );
  mcp.setRequestHandler(ListToolsRequestSchema, (request) => {
    if (failListTools) throw new Error("tools/list is broken");
    const start = Number(request.params?.cursor ?? 0);
    const end = start + pageSize;
    return {
      tools: tools.slice(start, end).map((tool) => ({
        name: tool.name,
        description: `${tool.name} tool`,
        inputSchema: tool.inputSchema ?? { type: "object" },
      })),
      nextCursor: end < tools.length ? String(end) : undefined,
    };
  });
  mcp.setRequestHandler(CallToolRequestSchema, (request) => {
    const tool = tools.find((t) => t.name === request.params.name);
    if (!tool) throw new Error(`unknown tool ${request.params.name}`);
    return (tool.run ?? echoArgs)(request.params.arguments ?? {});
  });
  return mcp;
}

/** A real MCP server over streamable HTTP (stateless). */
async function startMcpServer(options: ServerOptions) {
  let requestCount = 0;
  const baseUrl = await listen(async (req, res) => {
    requestCount++;
    const mcp = createMcpServer(options);
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    res.on("close", () => {
      void transport.close();
      void mcp.close();
    });
    await mcp.connect(transport);
    await transport.handleRequest(req, res);
  });
  return {
    url: `${baseUrl}/mcp`,
    requestCount: () => requestCount,
  };
}

/**
 * A real MCP server over SSE. Records the `Authorization` header of the
 * event stream request, and resolves `streamClosed` when the client closes
 * that stream.
 */
async function startSseMcpServer(options: ServerOptions) {
  const transports = new Map<string, SSEServerTransport>();
  let authorization: string | undefined;
  let resolveStreamClosed = () => {};
  const streamClosed = new Promise<void>((resolve) => {
    resolveStreamClosed = resolve;
  });
  const baseUrl = await listen(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    if (req.method === "GET") {
      authorization = req.headers.authorization;
      const transport = new SSEServerTransport("/messages", res);
      transports.set(transport.sessionId, transport);
      res.on("close", () => resolveStreamClosed());
      await createMcpServer(options).connect(transport);
      return;
    }
    const transport = transports.get(url.searchParams.get("sessionId") ?? "");
    if (!transport) {
      res.writeHead(404).end();
      return;
    }
    await transport.handlePostMessage(req, res);
  });
  return {
    url: `${baseUrl}/sse`,
    authorization: () => authorization,
    streamClosed,
  };
}

/** A URL on which nothing listens. */
async function unreachableUrl() {
  const httpServer = http.createServer();
  await new Promise<void>((resolve) =>
    httpServer.listen(0, "127.0.0.1", resolve),
  );
  const { port } = httpServer.address() as AddressInfo;
  await new Promise((resolve) => httpServer.close(resolve));
  return `http://127.0.0.1:${port}/mcp`;
}

function connect(
  configs: MCPClientConfig[],
  options: { labelOffset?: number; appToolNames?: string[] } = {},
) {
  return connectMCPServers(configs, {
    signal: new AbortController().signal,
    ...options,
  });
}

const toolNames = (tools: { name: string }[]) => tools.map((tool) => tool.name);

function toolNamed(tools: AgentToolSpec[], name: string) {
  const tool = tools.find((t) => t.name === name);
  if (!tool) throw new Error(`no tool named ${name}`);
  return tool;
}

describe("connectMCPServers", () => {
  let consoleError: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    const open = servers.splice(0);
    await Promise.all(
      open.map(
        (server) =>
          new Promise((resolve) => {
            server.closeAllConnections();
            server.close(resolve);
          }),
      ),
    );
  });

  it("lists every tool across tools/list pages, with its input schema", async () => {
    const server = await startMcpServer({
      pageSize: 2,
      tools: [
        {
          name: "search",
          inputSchema: {
            type: "object",
            properties: { query: { type: "string" } },
            required: ["query"],
          },
        },
        { name: "fetch" },
        { name: "summarize" },
      ],
    });

    const mcp = await connect([{ type: "http", url: server.url }]);

    expect(
      mcp.tools.map(({ name, description, parameters }) => ({
        name,
        description,
        parameters,
      })),
    ).toEqual([
      {
        name: "search",
        description: "search tool",
        parameters: {
          type: "object",
          properties: { query: { type: "string" } },
          required: ["query"],
          additionalProperties: false,
        },
      },
      {
        name: "fetch",
        description: "fetch tool",
        parameters: {
          type: "object",
          properties: {},
          additionalProperties: false,
        },
      },
      {
        name: "summarize",
        description: "summarize tool",
        parameters: {
          type: "object",
          properties: {},
          additionalProperties: false,
        },
      },
    ]);
    await mcp.close();
  });

  it("calls the tool on the server and returns its CallToolResult", async () => {
    const server = await startMcpServer({
      tools: [
        {
          name: "greet",
          run: (args) => ({
            content: [{ type: "text", text: `hello ${String(args.who)}` }],
          }),
        },
      ],
    });
    const mcp = await connect([{ type: "http", url: server.url }]);

    const result = await toolNamed(mcp.tools, "greet").execute?.({
      who: "ada",
    });

    expect(result).toEqual({
      content: [{ type: "text", text: "hello ada" }],
    });
    await mcp.close();
  });

  it("prefixes colliding names with the server name or mcp<N>, and calls the original tool", async () => {
    const named = await startMcpServer({
      tools: [{ name: "search" }, { name: "lookup" }, { name: "only_named" }],
    });
    const unnamed = await startMcpServer({ tools: [{ name: "search" }] });

    const mcp = await connect(
      [
        { type: "http", url: named.url, name: "my docs" },
        { type: "http", url: unnamed.url },
      ],
      { labelOffset: 1, appToolNames: ["lookup"] },
    );

    expect(toolNames(mcp.tools)).toEqual([
      "my_docs_search",
      "my_docs_lookup",
      "only_named",
      "mcp3_search",
    ]);
    const result = await toolNamed(mcp.tools, "mcp3_search").execute?.({
      q: "x",
    });
    expect(result).toEqual({ content: [{ type: "text", text: '{"q":"x"}' }] });
    await mcp.close();
  });

  it("skips a server that fails to connect and keeps the healthy one", async () => {
    const healthy = await startMcpServer({ tools: [{ name: "healthy" }] });
    const down = await unreachableUrl();

    const mcp = await connect([
      { type: "http", url: `${down}?token=secret` },
      { type: "http", url: healthy.url },
    ]);

    expect(toolNames(mcp.tools)).toEqual(["healthy"]);
    expect(consoleError).toHaveBeenCalledWith(
      `[CopilotKit] MCP server ${down} failed to connect, skipping it for this run:`,
      expect.anything(),
    );
    await mcp.close();
  });

  it("skips a server whose tools/list fails and keeps the healthy one", async () => {
    const broken = await startMcpServer({
      tools: [{ name: "broken" }],
      failListTools: true,
    });
    const healthy = await startMcpServer({ tools: [{ name: "healthy" }] });

    const mcp = await connect([
      { type: "http", url: broken.url },
      { type: "http", url: healthy.url },
    ]);

    expect(toolNames(mcp.tools)).toEqual(["healthy"]);
    expect(consoleError).toHaveBeenCalledWith(
      `[CopilotKit] MCP server ${broken.url} failed to list its tools, skipping them for this run:`,
      expect.anything(),
    );
    await mcp.close();
  });

  it("close() disconnects, so tools can no longer be called", async () => {
    const server = await startMcpServer({ tools: [{ name: "echo" }] });
    const mcp = await connect([{ type: "http", url: server.url }]);

    await mcp.close();

    await expect(toolNamed(mcp.tools, "echo").execute?.({})).rejects.toThrow(
      "Not connected",
    );
  });

  it("connects over SSE with the configured headers", async () => {
    const server = await startSseMcpServer({ tools: [{ name: "echo" }] });

    const mcp = await connect([
      {
        type: "sse",
        url: server.url,
        headers: { Authorization: "Bearer test-token" },
      },
    ]);

    expect(server.authorization()).toBe("Bearer test-token");
    expect(await toolNamed(mcp.tools, "echo").execute?.({ a: 1 })).toEqual({
      content: [{ type: "text", text: '{"a":1}' }],
    });
    await mcp.close();
  });

  it("closes the clients when the signal aborts after connecting", async () => {
    const server = await startSseMcpServer({ tools: [{ name: "echo" }] });
    const controller = new AbortController();
    await connectMCPServers([{ type: "sse", url: server.url }], {
      signal: controller.signal,
    });

    controller.abort(new Error("run cancelled"));

    // Resolves only when the client closes its event stream.
    await server.streamClosed;
  });

  it("rejects with the abort reason and contacts no server when aborted before connecting", async () => {
    const server = await startMcpServer({ tools: [{ name: "echo" }] });
    const controller = new AbortController();
    controller.abort(new Error("run cancelled"));

    await expect(
      connectMCPServers([{ type: "http", url: server.url }], {
        signal: controller.signal,
      }),
    ).rejects.toThrow("run cancelled");
    expect(server.requestCount()).toBe(0);
  });
});
