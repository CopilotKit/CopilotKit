import type { RunAgentInput } from "@ag-ui/client";
import type { JSONRPCMessage, MCPTransport } from "@ai-sdk/mcp";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { StreamableHTTPClientTransportOptions } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { FetchLike } from "@modelcontextprotocol/sdk/shared/transport.js";

/**
 * Context handed to {@link MCPClientConfigHTTP.getHeaders} on every outbound
 * MCP HTTP request. The resolver is invoked fresh per request — initialize,
 * tools/list, tools/call, and reconnects — so values it depends on are never
 * cached across calls.
 */
export interface MCPRequestContext {
  /**
   * Headers forwarded onto the agent for this run. Populated by the runtime's
   * `extractForwardableHeaders` (`authorization` + every `x-*` header from the
   * incoming HTTP request). Keys are lower-cased.
   */
  requestHeaders: Record<string, string>;
  /** The {@link RunAgentInput} the agent is currently running. */
  input: RunAgentInput;
  /** URL of the MCP server this request is going to. */
  mcpServerUrl: string;
}

/**
 * Thrown when an MCP {@link MCPClientConfigHTTP.getHeaders} resolver throws.
 * Wraps the underlying error so `RUN_ERROR` carries clear attribution instead
 * of a generic transport failure. The original error is preserved on the
 * standard ES2022 `Error.cause` chain.
 */
export class MCPHeaderResolverError extends Error {
  constructor(message: string, cause: unknown) {
    super(message, { cause });
    this.name = "MCPHeaderResolverError";
  }
}

export interface CopilotKitMCPTransportOptions {
  /** URL of the MCP server. */
  url: string;
  /** Static HTTP headers, merged into every outbound request. */
  headers?: Record<string, string>;
  /**
   * Per-call header resolver. Invoked on **every** outbound HTTP request to
   * this server (initialize, tools/list, tools/call, reconnects). Returned
   * headers are merged on top of `headers`, so a resolver can override either.
   */
  getHeaders?: (
    ctx: MCPRequestContext,
  ) => Record<string, string> | Promise<Record<string, string>>;
  /**
   * Pre-existing escape hatch: low-level options for the underlying
   * `StreamableHTTPClientTransport`. Forwarded as-is, except `fetch` is
   * wrapped so static `headers` and `getHeaders` resolution still apply.
   */
  options?: StreamableHTTPClientTransportOptions;
  /** Snapshot of the agent's per-run forwarded headers, captured at run-start. */
  requestHeaders: Record<string, string>;
  /** RunAgentInput for the current run, exposed to the resolver via context. */
  input: RunAgentInput;
}

/**
 * MCP transport for CopilotKit's BuiltInAgent that adds per-call header
 * resolution on top of the standard Streamable HTTP transport.
 *
 * Implements `@ai-sdk/mcp`'s {@link MCPTransport} interface so it can be
 * passed straight to `createMCPClient({ transport })`. Internally delegates
 * to `@modelcontextprotocol/sdk`'s `StreamableHTTPClientTransport` with a
 * wrapped `fetch` that runs the static-header + per-call resolver pipeline
 * before each outbound request.
 */
export class CopilotKitMCPTransport implements MCPTransport {
  private readonly inner: StreamableHTTPClientTransport;

  constructor(options: CopilotKitMCPTransportOptions) {
    const transportOptions: StreamableHTTPClientTransportOptions = {
      ...options.options,
      fetch: buildWrappedFetch(options),
    };
    this.inner = new StreamableHTTPClientTransport(
      new URL(options.url),
      transportOptions,
    );
  }

  get onclose(): (() => void) | undefined {
    return this.inner.onclose;
  }
  set onclose(handler: (() => void) | undefined) {
    this.inner.onclose = handler;
  }

  get onerror(): ((error: Error) => void) | undefined {
    return this.inner.onerror;
  }
  set onerror(handler: ((error: Error) => void) | undefined) {
    this.inner.onerror = handler;
  }

  get onmessage(): ((message: JSONRPCMessage) => void) | undefined {
    return this.inner.onmessage as
      | ((message: JSONRPCMessage) => void)
      | undefined;
  }
  set onmessage(handler: ((message: JSONRPCMessage) => void) | undefined) {
    this.inner.onmessage = handler as
      | ((message: JSONRPCMessage) => void)
      | undefined;
  }

  start(): Promise<void> {
    return this.inner.start();
  }

  send(message: JSONRPCMessage): Promise<void> {
    return this.inner.send(message as Parameters<typeof this.inner.send>[0]);
  }

  close(): Promise<void> {
    return this.inner.close();
  }
}

function buildWrappedFetch(options: CopilotKitMCPTransportOptions): FetchLike {
  const {
    headers: staticHeaders,
    getHeaders,
    requestHeaders,
    input,
    url: mcpServerUrl,
    options: transportOptions,
  } = options;
  const baseFetch: FetchLike = transportOptions?.fetch ?? globalThis.fetch;

  return async (fetchUrl, init) => {
    // SDK passes a Headers instance via init.headers — start fresh from it so
    // we don't mutate the SDK's object, then layer headers on top via .set()
    // (last write wins).
    const merged = new Headers(init?.headers);
    if (staticHeaders) {
      for (const [key, value] of Object.entries(staticHeaders)) {
        merged.set(key, value);
      }
    }
    if (getHeaders) {
      let resolved: Record<string, string>;
      try {
        resolved = await getHeaders({
          requestHeaders,
          input,
          mcpServerUrl,
        });
      } catch (err) {
        throw new MCPHeaderResolverError(
          `MCP header resolver for ${mcpServerUrl} threw: ${
            err instanceof Error ? err.message : String(err)
          }`,
          err,
        );
      }
      for (const [key, value] of Object.entries(resolved)) {
        merged.set(key, value);
      }
    }
    return baseFetch(fetchUrl, { ...init, headers: merged });
  };
}
