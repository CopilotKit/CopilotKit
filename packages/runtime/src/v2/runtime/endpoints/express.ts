import express from "express";
import type {
  Request as ExpressRequest,
  Response as ExpressResponse,
  NextFunction,
  Router,
} from "express";
import cors from "cors";
import type { CorsOptions } from "cors";
import type { CopilotRuntimeLike } from "../core/runtime";
import { createCopilotRuntimeHandler } from "../core/fetch-handler";
import { createExpressNodeHandler } from "./express-fetch-bridge";
import type { CopilotRuntimeHooks } from "../core/hooks";

export interface CopilotExpressEndpointParams {
  runtime: CopilotRuntimeLike;
  basePath: string;

  /**
   * Endpoint mode.
   * - `"multi-route"` (default): separate routes for each operation
   * - `"single-route"`: single POST endpoint with JSON envelope dispatch
   */
  mode?: "multi-route" | "single-route";

  /**
   * CORS configuration for the Express router.
   * - `true` (default): permissive CORS (`origin: "*"`, all methods, all headers).
   * - `false`: no CORS middleware is applied — handle it yourself.
   * - object: passed directly to the Express `cors()` middleware.
   */
  cors?: boolean | CorsOptions;

  /**
   * Lifecycle hooks for request processing.
   */
  hooks?: CopilotRuntimeHooks;
}

/**
 * Creates an Express router that serves the CopilotKit runtime.
 *
 * In **multi-route** mode (default) the router exposes:
 * - `GET  {basePath}/info` — runtime info
 * - `POST {basePath}/agent/:agentId/run` — start an agent run
 * - `POST {basePath}/agent/:agentId/connect` — connect to an agent run
 * - `POST {basePath}/agent/:agentId/stop/:threadId` — stop an agent run
 * - `POST {basePath}/transcribe` — transcribe audio
 *
 * In **single-route** mode a single `POST {basePath}` endpoint accepts a JSON
 * envelope `{ method, params, body }` and dispatches to the appropriate handler.
 *
 * @example
 * ```typescript
 * import express from "express";
 * import { CopilotRuntime } from "@copilotkit/runtime/v2";
 * import { createCopilotExpressHandler } from "@copilotkit/runtime/v2/express";
 *
 * const runtime = new CopilotRuntime({
 *   agents: { default: new BuiltInAgent({ model: "openai/gpt-4o-mini" }) },
 * });
 *
 * const app = express();
 * app.use(createCopilotExpressHandler({
 *   runtime,
 *   basePath: "/api/copilotkit",
 *   cors: true,
 * }));
 * app.listen(4000);
 * ```
 *
 * @example Single-route mode with lifecycle hooks
 * ```typescript
 * app.use(createCopilotExpressHandler({
 *   runtime,
 *   basePath: "/api/copilotkit",
 *   mode: "single-route",
 *   hooks: {
 *     onRequest: ({ request }) => {
 *       if (!request.headers.get("authorization")) {
 *         throw new Response("Unauthorized", { status: 401 });
 *       }
 *     },
 *   },
 * }));
 * ```
 */
/** @deprecated Use `createCopilotExpressHandler` instead. */
export { createCopilotExpressHandler as createCopilotEndpointExpress };

export function createCopilotExpressHandler({
  runtime,
  basePath,
  mode = "multi-route",
  cors: corsOption = true,
  hooks,
}: CopilotExpressEndpointParams): Router {
  const normalizedBase = normalizeBasePath(basePath);

  const handler = createCopilotRuntimeHandler({
    runtime,
    basePath: normalizedBase,
    mode,
    cors: false, // CORS is handled at the Express middleware layer
    hooks,
  });

  const nodeHandler = createExpressNodeHandler(handler);

  const expressHandler = async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ) => {
    try {
      await nodeHandler(req, res);
    } catch (err) {
      next(err);
    }
  };

  const router = express.Router();

  // CORS middleware
  if (corsOption) {
    const corsConfig: CorsOptions =
      corsOption === true
        ? {
            origin: "*",
            methods: [
              "GET",
              "HEAD",
              "PUT",
              "POST",
              "DELETE",
              "PATCH",
              "OPTIONS",
            ],
            allowedHeaders: ["*"],
          }
        : corsOption;
    router.use(cors(corsConfig));
  }

  // Route mounting
  if (mode === "single-route") {
    router.post(normalizedBase, expressHandler);
    router.options(normalizedBase, expressHandler);
  } else if (normalizedBase === "/") {
    router.all("*", expressHandler);
  } else {
    router.all(`${normalizedBase}/*`, expressHandler);
    router.all(normalizedBase, expressHandler);
  }

  return router;
}

function normalizeBasePath(path: string): string {
  if (!path) {
    throw new Error("basePath must be provided for Express endpoint");
  }

  if (!path.startsWith("/")) {
    return `/${path}`;
  }

  if (path.length > 1 && path.endsWith("/")) {
    return path.slice(0, -1);
  }

  return path;
}
