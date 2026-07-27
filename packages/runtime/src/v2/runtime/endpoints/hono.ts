import { Hono } from "hono";
import type { CopilotRuntimeLike } from "../core/runtime";
import { createCopilotRuntimeHandler } from "../core/fetch-handler";
import type { CopilotCorsConfig } from "../core/fetch-cors";
import type { CopilotRuntimeHooks } from "../core/hooks";
import type {
  ActivateChannelEngine,
  ChannelsControl,
} from "../core/channel-manager";

/**
 * A Hono app that may also carry an optional {@link ChannelsControl} surface.
 * Hono's app object is request-scoped routing config, not a long-running
 * process owner — Node (`createCopilotNodeListener`) is the lifecycle-owning
 * surface for `.channels`. It is attached here too, best-effort, for callers
 * that mount the Hono app directly and want to observe/stop managed Channel
 * activation without also standing up a Node listener.
 */
export type CopilotHonoApp = Hono & { channels?: ChannelsControl };

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

  /**
   * Whether the underlying handler activates the runtime's declared managed
   * Channels at creation time. Defaults to `true`. See
   * `CopilotRuntimeHandlerOptions.activateChannels`.
   */
  activateChannels?: boolean;

  /**
   * @internal Test seam: inject a fake Channel activation engine. Forwarded
   * to `createCopilotRuntimeHandler`. Not part of the public API.
   */
  __channelEngine?: ActivateChannelEngine;
}
/** @deprecated Use `createCopilotHonoHandler` instead. */
export const createCopilotEndpoint = createCopilotHonoHandler;

export function createCopilotHonoHandler({
  runtime,
  basePath,
  mode = "multi-route",
  cors: corsConfig,
  hooks,
  activateChannels,
  __channelEngine,
}: CopilotEndpointParams): CopilotHonoApp {
  const handler = createCopilotRuntimeHandler({
    runtime,
    basePath,
    mode,
    cors: corsConfig ? toFetchCorsConfig(corsConfig) : true,
    hooks,
    activateChannels,
    __channelEngine,
  });

  const app = new Hono();

  const scopedApp: CopilotHonoApp = app
    .basePath(basePath)
    .all("*", async (c) => handler(c.req.raw));
  scopedApp.channels = handler.channels;
  return scopedApp;
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
