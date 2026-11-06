import { Hono } from "hono";
import type { CopilotRuntimeLike } from "../core/runtime";
import { createCopilotRuntimeHandler } from "../core/fetch-handler";
import type { CopilotRuntimeHooks } from "../core/hooks";
import type { RuntimeInstanceCreatedInfo } from "../telemetry/events";
import type { CopilotEndpointCorsConfig } from "./hono";
import { toFetchCorsConfig } from "./hono";

interface CopilotSingleEndpointParams {
  runtime: CopilotRuntimeLike;
  /**
   * Absolute path at which to mount the single-route endpoint (e.g. "/api/copilotkit").
   */
  basePath: string;
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
   * @internal Payload for `oss.runtime.instance_created`. See
   * `CopilotRuntimeHandlerOptions.__instanceCreatedInfo`.
   */
  __instanceCreatedInfo?: RuntimeInstanceCreatedInfo;
}

/** @deprecated Use `createCopilotHonoHandler` with `mode: "single-route"` instead. */
export function createCopilotEndpointSingleRoute({
  runtime,
  basePath,
  cors: corsConfig,
  hooks,
  __instanceCreatedInfo,
}: CopilotSingleEndpointParams) {
  const routePath = normalizePath(basePath);

  const handler = createCopilotRuntimeHandler({
    runtime,
    basePath: routePath,
    mode: "single-route",
    cors: corsConfig ? toFetchCorsConfig(corsConfig) : true,
    hooks,
    __instanceCreatedInfo,
  });

  const app = new Hono();

  return app.basePath(routePath).all("*", async (c) => handler(c.req.raw));
}

function normalizePath(path: string): string {
  if (!path) {
    throw new Error("basePath must be provided for single-route endpoint");
  }

  if (!path.startsWith("/")) {
    return `/${path}`;
  }

  if (path.length > 1 && path.endsWith("/")) {
    return path.slice(0, -1);
  }

  return path;
}
