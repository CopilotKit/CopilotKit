import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { StreamableHTTPClientTransportOptions } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { describeEndpoint } from "../runtime/handlers/shared/describe-endpoint";
import {
  RUNTIME_PACKAGE_NAME,
  RUNTIME_PACKAGE_VERSION,
} from "../runtime/core/package-info";
import { resolveMCPToolNames, toToolNamePrefix } from "./mcp-tool-names";
import type { AgentToolSpec } from "./tool-spec";

/**
 * MCP Client configuration for HTTP transport
 */
export interface MCPClientConfigHTTP {
  /** Type of MCP client */
  type: "http";
  /**
   * Optional name for this server. When a tool name collides with another
   * MCP server's tool or with an app tool, the MCP tool is exposed as
   * `<name>_<tool>`. Without a name, the prefix is `mcp<N>`, where N is the
   * server's position among `mcpClients` and then `mcpServers`, from 1.
   * Give each server a different name: if a prefixed name is already in use,
   * a number is added (`<name>_<tool>_2`).
   */
  name?: string;
  /** URL of the MCP server */
  url: string;
  /**
   * Optional transport options for the underlying
   * `StreamableHTTPClientTransport`. The SDK's documented extension point
   * for per-request customization is `options.fetch`. Pass a wrapped fetch
   * here if you need static + dynamic headers on outbound MCP requests.
   */
  options?: StreamableHTTPClientTransportOptions;
}

/**
 * MCP Client configuration for SSE transport
 */
export interface MCPClientConfigSSE {
  /** Type of MCP client */
  type: "sse";
  /**
   * Optional name for this server. When a tool name collides with another
   * MCP server's tool or with an app tool, the MCP tool is exposed as
   * `<name>_<tool>`. Without a name, the prefix is `mcp<N>`, where N is the
   * server's position among `mcpClients` and then `mcpServers`, from 1.
   * Give each server a different name: if a prefixed name is already in use,
   * a number is added (`<name>_<tool>_2`).
   */
  name?: string;
  /** URL of the MCP server */
  url: string;
  /** Optional HTTP headers (e.g., for authentication) */
  headers?: Record<string, string>;
}

/**
 * MCP Client configuration
 */
export type MCPClientConfig = MCPClientConfigHTTP | MCPClientConfigSSE;

/** Options for {@link connectMCPServers}. */
export interface ConnectMCPServersOptions {
  /**
   * The run's abort signal. Connecting stops when it aborts, and the
   * connected clients close.
   */
  signal: AbortSignal;
  /**
   * How many MCP sources come before these servers. An unnamed server at
   * index `i` gets the prefix `mcp<labelOffset + i + 1>`. Default: 0.
   */
  labelOffset?: number;
  /**
   * Names of the agent's own tools. An MCP tool with one of these names is
   * prefixed, so the agent's tool keeps the name. Default: none.
   */
  appToolNames?: Iterable<string>;
}

async function createTransport(config: MCPClientConfig) {
  switch (config.type) {
    case "http":
      return new StreamableHTTPClientTransport(
        new URL(config.url),
        config.options,
      );
    case "sse": {
      // Imported lazily: the SDK's SSE transport pulls in `eventsource`,
      // whose `bun` export condition resolves to ESM and breaks the SDK's own
      // CJS `require()` under Bun. Keeping it out of this module's static
      // graph means only configs that actually ask for SSE ever load it.
      const { SSEClientTransport } =
        await import("@modelcontextprotocol/sdk/client/sse.js");
      // SSEClientTransport's second arg is SSEClientTransportOptions
      // (`requestInit.headers`), not a raw header map. Passing
      // `{ Authorization: ... }` as options is silently ignored.
      return new SSEClientTransport(
        new URL(config.url),
        config.headers
          ? { requestInit: { headers: config.headers } }
          : undefined,
      );
    }
  }
}

async function listAllTools(client: Client, signal: AbortSignal) {
  const tools: Tool[] = [];
  let cursor: string | undefined;
  do {
    const page = await client.listTools({ cursor }, { signal });
    tools.push(...page.tools);
    cursor = page.nextCursor;
  } while (cursor !== undefined);
  return tools;
}

function toToolSpec(client: Client, tool: Tool, signal: AbortSignal) {
  const spec: AgentToolSpec = {
    name: tool.name,
    description: tool.description ?? "",
    // Same normalization as `@ai-sdk/mcp`: models expect `properties`, and
    // the model may only send the arguments the server declared.
    parameters: {
      ...tool.inputSchema,
      properties: tool.inputSchema.properties ?? {},
      additionalProperties: false,
    },
    execute: (args) =>
      client.callTool({ name: tool.name, arguments: args }, undefined, {
        signal,
      }),
  };
  return spec;
}

/**
 * Connects to MCP servers and lists their tools as {@link AgentToolSpec}s.
 *
 * Each tool's `parameters` is the server's JSON Schema `inputSchema`. Its
 * `execute` calls the tool on the server and resolves to the MCP
 * `CallToolResult` (`{ content, structuredContent?, isError? }`). A tool
 * error comes back as a result with `isError: true`, not as a throw.
 *
 * A server that fails to connect or to list its tools is logged and skipped,
 * so one unavailable server does not fail the run. Tool names that collide
 * with another server's tool or with `appToolNames` are prefixed with the
 * server's `name` (or `mcp<N>`), under the rules of `resolveMCPToolNames`.
 *
 * The clients close when `close()` is called or when `signal` aborts. Call
 * `close()` when the run ends.
 *
 * @param configs - The servers to connect to, in order.
 * @param options - The run's abort signal, the label offset for unnamed
 *   servers, and the agent's own tool names.
 * @throws The abort reason when `signal` aborts before all servers are
 *   connected. Clients connected so far are closed first.
 * @throws TypeError when a server `url` is not a valid URL.
 *
 * @example
 * ```ts
 * const mcp = await connectMCPServers(
 *   [{ type: "http", url: "https://example.com/mcp", name: "docs" }],
 *   { signal: abortController.signal, appToolNames: ["getWeather"] },
 * );
 * try {
 *   // Map mcp.tools to your SDK's tools and run the model.
 * } finally {
 *   await mcp.close();
 * }
 * ```
 */
export async function connectMCPServers(
  configs: MCPClientConfig[],
  options: ConnectMCPServersOptions,
) {
  const { signal, labelOffset = 0, appToolNames = [] } = options;
  const clients: Client[] = [];
  const sources: { label: string; tools: AgentToolSpec[] }[] = [];

  let closing: Promise<void> | undefined;
  const close = () => {
    signal.removeEventListener("abort", close);
    closing ??= Promise.allSettled(
      clients.map((client) => client.close()),
    ).then(() => undefined);
    return closing;
  };

  try {
    signal.throwIfAborted();
    for (const [index, config] of configs.entries()) {
      const label = config.name
        ? toToolNamePrefix(config.name)
        : `mcp${labelOffset + index + 1}`;
      const endpoint = describeEndpoint(config.url);
      const transport = await createTransport(config);
      signal.throwIfAborted();

      const client = new Client({
        name: RUNTIME_PACKAGE_NAME,
        version: RUNTIME_PACKAGE_VERSION,
      });
      try {
        await client.connect(transport, { signal });
      } catch (err) {
        signal.throwIfAborted();
        console.error(
          `[CopilotKit] MCP server ${endpoint} failed to connect, skipping it for this run:`,
          err,
        );
        continue;
      }
      // Tracked before listing, so it is closed even if listing fails.
      clients.push(client);
      try {
        const tools = await listAllTools(client, signal);
        signal.throwIfAborted();
        sources.push({
          label,
          tools: tools.map((tool) => toToolSpec(client, tool, signal)),
        });
      } catch (err) {
        signal.throwIfAborted();
        console.error(
          `[CopilotKit] MCP server ${endpoint} failed to list its tools, skipping them for this run:`,
          err,
        );
      }
    }
  } catch (err) {
    await close();
    throw err;
  }

  signal.addEventListener("abort", close, { once: true });

  const names = resolveMCPToolNames(
    new Set(appToolNames),
    sources.map((source) => ({
      label: source.label,
      names: source.tools.map((tool) => tool.name),
    })),
  );
  const tools = sources.flatMap((source, i) =>
    source.tools.map((tool, j) => ({ ...tool, name: names[i]![j]! })),
  );

  return { tools, close };
}
