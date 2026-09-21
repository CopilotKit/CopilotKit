import type {
  Request as ExpressRequest,
  Response as ExpressResponse,
  NextFunction,
} from "express";
import cors from "cors";
import type { CorsOptions } from "cors";
import type { CopilotRuntimeLike } from "../core/runtime";
import { createCopilotRuntimeHandler } from "../core/fetch-handler";
import type {
  ActivateChannelEngine,
  ChannelsControl,
} from "../core/channel-manager";
import { createExpressNodeHandler } from "./express-fetch-bridge";
import { loadExpress } from "./load-express";
import { autoStartChannels } from "./auto-start-channels";
import type { CopilotRuntimeHooks } from "../core/hooks";

/**
 * The middleware `createCopilotExpressHandler` returns: an Express router that
 * may also carry an optional {@link ChannelsControl} surface. The router object
 * itself is request-scoped middleware, but an Express app can only run inside a
 * long-running `http.Server` — so this wrapper is a lifecycle-owning host like
 * `createCopilotNodeListener`: it STARTS activation of the runtime's declared
 * managed Channels at creation, and `.channels` is here to observe (`ready()`)
 * or tear down (`stop()`) that activation.
 *
 * Deliberately NOT typed as Express's own `Router`. Pinning that type binds our
 * public surface to a single Express major: `@types/express@4` declares
 * `Request.param()` and `@types/express@5` does not, so a v4-typed router is not
 * assignable to a v5 `app.use()` and an Express 5 app cannot compile against us
 * at all (#7276). The call signature below is what `use()` accepts in both
 * majors, and the methods beside it are the router surface both majors share.
 *
 * The runtime value is still a real `express.Router()`; only the declared type
 * is widened.
 */
export type CopilotExpressRouter = ((
  req: any,
  res: any,
  next: (err?: unknown) => void,
) => void) & {
  channels?: ChannelsControl;

  // The common router-configuration surface, declared structurally so that
  // consumers who add their own middleware or routes to the returned value keep
  // compiling. These are NOT taken from either Express major's `Router`, because
  // that is exactly what makes the type un-mountable across majors.
  use(...handlers: any[]): CopilotExpressRouter;
  get(...handlers: any[]): CopilotExpressRouter;
  post(...handlers: any[]): CopilotExpressRouter;
  put(...handlers: any[]): CopilotExpressRouter;
  patch(...handlers: any[]): CopilotExpressRouter;
  delete(...handlers: any[]): CopilotExpressRouter;
  options(...handlers: any[]): CopilotExpressRouter;
  all(...handlers: any[]): CopilotExpressRouter;

  // `route()` is the one remaining Router-configuration method consumers reach
  // for, and dropping it would break `router.route("/x").get(...)` callers for
  // no gain: a re-pin to either Express major is caught by
  // `scripts/validate-dts-imports.ts`, which fails on any published declaration
  // that names `express` at all.
  route(path: any): any;
};

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

  /**
   * Whether the underlying handler builds the control surface for the runtime's
   * declared managed Channels — and, because Express is a long-running host,
   * starts their activation at creation. Defaults to `true`. Set `false` to
   * build no surface and open no socket (tests, short-lived scripts). See
   * `CopilotRuntimeHandlerOptions.activateChannels`.
   */
  activateChannels?: boolean;

  /**
   * @internal Test seam: inject a fake Channel activation engine. Forwarded
   * to `createCopilotRuntimeHandler`. Not part of the public API.
   */
  __channelEngine?: ActivateChannelEngine;
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
  activateChannels,
  __channelEngine,
}: CopilotExpressEndpointParams): CopilotExpressRouter {
  const normalizedBase = normalizeBasePath(basePath);

  const handler = createCopilotRuntimeHandler({
    runtime,
    basePath: normalizedBase,
    mode,
    cors: false, // CORS is handled at the Express middleware layer
    hooks,
    activateChannels,
    __channelEngine,
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

  const router = loadExpress().Router();

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
    router.all(/.*/, expressHandler);
  } else {
    router.all(
      new RegExp(`^${escapeRegExp(normalizedBase)}(\\/.*)?$`),
      expressHandler,
    );
  }

  const exposedRouter: CopilotExpressRouter = router;
  exposedRouter.channels = handler.channels;
  autoStartChannels(exposedRouter.channels);
  return exposedRouter;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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
