import type { Router } from "express";
import { createCopilotExpressHandler } from "./express";
import type { CopilotRuntimeLike } from "../core/runtime";
import type { CopilotRuntimeHooks } from "../core/hooks";

interface CopilotSingleRouteExpressParams {
  runtime: CopilotRuntimeLike;
  basePath: string;
  /**
   * Lifecycle hooks for request processing.
   */
  hooks?: CopilotRuntimeHooks;
}

/**
 * Creates an Express router that serves the CopilotKit runtime as a single
 * POST endpoint. Clients send a JSON envelope with `{ method, params, body }`
 * to dispatch to the appropriate handler.
 *
 * This is a convenience wrapper around {@link createCopilotExpressHandler}
 * with `mode: "single-route"` and `cors: true`.
 *
 * @example
 * ```typescript
 * import express from "express";
 * import { CopilotRuntime } from "@copilotkit/runtime/v2";
 * import { createCopilotEndpointSingleRouteExpress } from "@copilotkit/runtime/v2/express";
 *
 * const runtime = new CopilotRuntime({
 *   agents: { default: new BuiltInAgent({ model: "openai/gpt-4o-mini" }) },
 * });
 *
 * const app = express();
 * app.use(createCopilotEndpointSingleRouteExpress({
 *   runtime,
 *   basePath: "/api/copilotkit",
 * }));
 * app.listen(4000);
 * ```
 */
/** @deprecated Use `createCopilotExpressHandler` with `mode: "single-route"` instead. */
export function createCopilotEndpointSingleRouteExpress({
  runtime,
  basePath,
  hooks,
}: CopilotSingleRouteExpressParams): Router {
  return createCopilotExpressHandler({
    runtime,
    basePath,
    mode: "single-route",
    cors: true,
    hooks,
  });
}
