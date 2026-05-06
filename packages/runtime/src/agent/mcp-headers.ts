import type { RunAgentInput } from "@ag-ui/client";
import type { FetchLike } from "@modelcontextprotocol/sdk/shared/transport.js";

/**
 * Context handed to {@link MCPClientConfigHTTP.getHeaders} on every outbound
 * MCP HTTP request. The resolver is invoked fresh per request — initialize,
 * tools/list, tools/call, and reconnects — so values it depends on are
 * never cached across calls.
 */
export interface MCPRequestContext {
  /**
   * Headers the runtime forwarded onto the agent for this run. Populated by
   * the runtime's `extractForwardableHeaders` (`authorization` + every
   * `x-*` header from the incoming HTTP request). Lower-cased keys.
   */
  forwardedRequestHeaders: Record<string, string>;
  /** The {@link RunAgentInput} the agent is currently running. */
  input: RunAgentInput;
  /** URL of the MCP server this request is going to. */
  mcpServerUrl: string;
}

/**
 * Thrown when an MCP {@link MCPClientConfigHTTP.getHeaders} resolver throws.
 * Wraps the underlying error so `RUN_ERROR` carries clear attribution
 * instead of a generic transport failure. The original error is preserved
 * on the standard ES2022 `Error.cause` chain.
 */
export class MCPHeaderResolverError extends Error {
  constructor(message: string, cause: unknown) {
    super(message, { cause });
    this.name = "MCPHeaderResolverError";
  }
}

/**
 * Options for {@link withDynamicMcpHeaders}.
 */
export interface WithDynamicMcpHeadersOptions {
  /**
   * Static HTTP headers, merged into every outbound request. Same value on
   * every call — set at MCP-server-config time, not derived from request
   * state.
   */
  staticHeaders?: Record<string, string>;
  /**
   * Per-call header resolver. Invoked on every outbound HTTP request to
   * the underlying transport. Returned headers are merged on top of
   * `staticHeaders`, so the resolver can intentionally override either.
   *
   * Throwing surfaces as {@link MCPHeaderResolverError}, which the run
   * pipeline turns into a `RUN_ERROR` event with clear attribution.
   */
  getHeaders?: (
    ctx: MCPRequestContext,
  ) => Record<string, string> | Promise<Record<string, string>>;
  /**
   * Snapshot of the agent's per-run forwarded headers, captured at
   * run-start. Passed to the resolver as
   * {@link MCPRequestContext.forwardedRequestHeaders}.
   */
  forwardedRequestHeaders: Record<string, string>;
  /**
   * RunAgentInput for the current run, exposed to the resolver via context.
   */
  input: RunAgentInput;
  /** URL of the MCP server this transport is going to. */
  mcpServerUrl: string;
  /**
   * Fetch implementation to delegate to once header merging is done.
   * Defaults to `globalThis.fetch`.
   */
  baseFetch?: FetchLike;
}

/**
 * Build a `fetch` that injects static + dynamic headers on every outbound
 * MCP HTTP request, then delegates to
 * {@link WithDynamicMcpHeadersOptions.baseFetch}.
 *
 * Pass the result to `StreamableHTTPClientTransport`'s `fetch` option — the
 * MCP TypeScript SDK's documented extension point for per-request
 * customization
 * (see https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/client.md):
 *
 * ```ts
 * const transport = new StreamableHTTPClientTransport(new URL(url), {
 *   fetch: withDynamicMcpHeaders({
 *     staticHeaders: { Authorization: `Bearer ${apiKey}` },
 *     getHeaders: ({ forwardedRequestHeaders }) => ({
 *       "X-User-Id": forwardedRequestHeaders["x-user-id"]!,
 *     }),
 *     forwardedRequestHeaders,
 *     input,
 *     mcpServerUrl: url,
 *   }),
 * });
 * ```
 *
 * The wrapper does not own the transport lifecycle — it only adds headers.
 */
export function withDynamicMcpHeaders(
  options: WithDynamicMcpHeadersOptions,
): FetchLike {
  const {
    staticHeaders,
    getHeaders,
    forwardedRequestHeaders,
    input,
    mcpServerUrl,
    baseFetch = globalThis.fetch,
  } = options;

  return async (fetchUrl, init) => {
    // SDK passes a Headers instance via init.headers — start fresh from it
    // so we don't mutate the SDK's object, then layer headers on top via
    // .set() (last write wins).
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
          forwardedRequestHeaders,
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
