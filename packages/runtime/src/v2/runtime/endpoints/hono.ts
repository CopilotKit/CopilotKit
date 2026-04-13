import { Hono } from "hono";
import type { CopilotRuntimeLike } from "../core/runtime";
import { createCopilotRuntimeHandler } from "../core/fetch-handler";
import type { CopilotCorsConfig } from "../core/fetch-cors";
import type { CopilotRuntimeHooks } from "../core/hooks";

/**
 * CORS configuration for CopilotKit endpoints.
 * When using credentials (e.g., HTTP-only cookies), you must specify an explicit origin.
 */
export interface CopilotEndpointCorsConfig {
  /**
   * Allowed origin(s) for CORS. Can be:
   * - A string: exact origin (e.g., "https://myapp.com")
   * - An array: list of allowed origins
   * - A function: dynamic origin resolution
   *
   * Note: When credentials is true, origin cannot be "*"
   */
  origin:
    | string
    | string[]
    | ((origin: string, c: any) => string | undefined | null);
  /**
   * Whether to allow credentials (cookies, HTTP authentication).
   * When true, origin must be explicitly specified (not "*").
   */
  credentials?: boolean;
}

interface CopilotEndpointParams {
  runtime: CopilotRuntimeLike;
  basePath: string;

  /**
   * Endpoint mode.
   * - `"multi-route"` (default): separate routes for each operation
   * - `"single-route"`: single POST endpoint with JSON envelope dispatch
   */
  mode?: "multi-route" | "single-route";

  /**
   * Optional CORS configuration. When not provided, defaults to allowing all origins without credentials.
   * To support HTTP-only cookies, provide cors config with credentials: true and explicit origin.
   */
  cors?: CopilotEndpointCorsConfig;
  /**
   * Lifecycle hooks for request processing.
   */
  hooks?: CopilotRuntimeHooks;
}
/** @deprecated Use `createCopilotHonoHandler` instead. */
export const createCopilotEndpoint = createCopilotHonoHandler;

export function createCopilotHonoHandler({
  runtime,
  basePath,
  mode = "multi-route",
  cors: corsConfig,
  hooks,
}: CopilotEndpointParams) {
  const handler = createCopilotRuntimeHandler({
    runtime,
    basePath,
    mode,
    cors: corsConfig ? toFetchCorsConfig(corsConfig) : true,
    hooks,
  });

  const app = new Hono();

  return app.basePath(basePath).all("*", async (c) => handler(c.req.raw));
}

/**
 * Convert Hono-specific CORS config to the fetch handler's CopilotCorsConfig.
 */
export function toFetchCorsConfig(
  config: CopilotEndpointCorsConfig,
): CopilotCorsConfig {
  const origin = config.origin;
  return {
    origin:
      typeof origin === "function"
        ? (reqOrigin: string) => origin(reqOrigin, undefined) ?? null
        : origin,
    credentials: config.credentials,
  };
}
