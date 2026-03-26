import express from "express";
import type {
  Request as ExpressRequest,
  Response as ExpressResponse,
  NextFunction,
  Router,
} from "express";
import cors from "cors";

import { CopilotRuntimeLike } from "../runtime";
import { telemetry } from "../telemetry";
import { handleRunAgent } from "../handlers/handle-run";
import { handleConnectAgent } from "../handlers/handle-connect";
import { handleStopAgent } from "../handlers/handle-stop";
import { handleGetRuntimeInfo } from "../handlers/get-runtime-info";
import { handleTranscribe } from "../handlers/handle-transcribe";
import {
  handleListThreads,
  handleSubscribeToThreads,
  handleUpdateThread,
  handleArchiveThread,
  handleDeleteThread,
} from "../handlers/handle-threads";
import { logger, getLicenseWarningHeader } from "@copilotkitnext/shared";
import {
  callBeforeRequestMiddleware,
  callAfterRequestMiddleware,
} from "../middleware";
import {
  createFetchRequestFromExpress,
  sendFetchResponse,
} from "./express-utils";

interface CopilotExpressEndpointParams {
  runtime: CopilotRuntimeLike;
  basePath: string;
}

export function createCopilotEndpointExpress({
  runtime,
  basePath,
}: CopilotExpressEndpointParams): Router {
  const router = express.Router();
  const normalizedBase = normalizeBasePath(basePath);

  // Fire instance_created telemetry - resolve agents if needed
  Promise.resolve(runtime.agents)
    .then((agents) => {
      telemetry.capture("oss.runtime.instance_created", {
        actionsAmount: 0,
        endpointTypes: [],
        endpointsAmount: 0,
        agentsAmount: Object.keys(agents).length,
        "cloud.api_key_provided": false,
      });
    })
    .catch(() => {
      // Silently fail - telemetry should not break the application
    });

  router.use(
    cors({
      origin: "*",
      methods: ["GET", "HEAD", "PUT", "POST", "DELETE", "PATCH", "OPTIONS"],
      allowedHeaders: ["*"],
    }),
  );

  router.post(
    joinPath(normalizedBase, "/agent/:agentId/run"),
    createRouteHandler(runtime, async ({ request, req }) => {
      const agentId = req.params.agentId as string;
      return handleRunAgent({ runtime, request, agentId });
    }),
  );

  router.post(
    joinPath(normalizedBase, "/agent/:agentId/connect"),
    createRouteHandler(runtime, async ({ request, req }) => {
      const agentId = req.params.agentId as string;
      return handleConnectAgent({ runtime, request, agentId });
    }),
  );

  router.post(
    joinPath(normalizedBase, "/agent/:agentId/stop/:threadId"),
    createRouteHandler(runtime, async ({ request, req }) => {
      const agentId = req.params.agentId as string;
      const threadId = req.params.threadId as string;
      return handleStopAgent({ runtime, request, agentId, threadId });
    }),
  );

  router.get(
    joinPath(normalizedBase, "/info"),
    createRouteHandler(runtime, async ({ request }) => {
      return handleGetRuntimeInfo({ runtime, request });
    }),
  );

  router.post(
    joinPath(normalizedBase, "/transcribe"),
    createRouteHandler(runtime, async ({ request }) => {
      return handleTranscribe({ runtime, request });
    }),
  );

  router.get(
    joinPath(normalizedBase, "/threads"),
    createRouteHandler(runtime, async ({ request }) => {
      return handleListThreads({ runtime, request });
    }),
  );

  router.post(
    joinPath(normalizedBase, "/threads/subscribe"),
    createRouteHandler(runtime, async ({ request }) => {
      return handleSubscribeToThreads({ runtime, request });
    }),
  );

  router.patch(
    joinPath(normalizedBase, "/threads/:threadId"),
    createRouteHandler(runtime, async ({ request, req }) => {
      const threadId = req.params.threadId as string;
      return handleUpdateThread({ runtime, request, threadId });
    }),
  );

  router.post(
    joinPath(normalizedBase, "/threads/:threadId/archive"),
    createRouteHandler(runtime, async ({ request, req }) => {
      const threadId = req.params.threadId as string;
      return handleArchiveThread({ runtime, request, threadId });
    }),
  );

  router.delete(
    joinPath(normalizedBase, "/threads/:threadId"),
    createRouteHandler(runtime, async ({ request, req }) => {
      const threadId = req.params.threadId as string;
      return handleDeleteThread({ runtime, request, threadId });
    }),
  );

  router.use(joinPath(normalizedBase, "*"), (req, res) => {
    res.status(404).json({ error: "Not found" });
  });

  return router;
}

type RouteHandlerContext = {
  request: Request;
  req: ExpressRequest;
};

type RouteHandlerFactory = (ctx: RouteHandlerContext) => Promise<Response>;

function createRouteHandler(
  runtime: CopilotRuntimeLike,
  factory: RouteHandlerFactory,
) {
  return async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ) => {
    const path = req.originalUrl ?? req.path;
    let request = createFetchRequestFromExpress(req);

    const warning = getLicenseWarningHeader(runtime.licenseChecker);
    if (warning) res.setHeader(warning.key, warning.value);

    try {
      const maybeModifiedRequest = await callBeforeRequestMiddleware({
        runtime,
        request,
        path,
      });
      if (maybeModifiedRequest) {
        request = maybeModifiedRequest;
      }
    } catch (error) {
      logger.error(
        { err: error, url: request.url, path },
        "Error running before request middleware",
      );
      if (error instanceof Response) {
        try {
          await sendFetchResponse(res, error);
        } catch (streamError) {
          next(streamError);
        }
        return;
      }
      next(error);
      return;
    }

    try {
      const response = await factory({ request, req });
      const responseForMiddleware = response.clone();
      await sendFetchResponse(res, response);
      callAfterRequestMiddleware({
        runtime,
        response: responseForMiddleware,
        path,
      }).catch((error) => {
        logger.error(
          { err: error, url: req.originalUrl ?? req.url, path },
          "Error running after request middleware",
        );
      });
    } catch (error) {
      if (error instanceof Response) {
        const errorResponseForMiddleware = error.clone();
        try {
          await sendFetchResponse(res, error);
        } catch (streamError) {
          next(streamError);
          return;
        }
        callAfterRequestMiddleware({
          runtime,
          response: errorResponseForMiddleware,
          path,
        }).catch((mwError) => {
          logger.error(
            { err: mwError, url: req.originalUrl ?? req.url, path },
            "Error running after request middleware",
          );
        });
        return;
      }
      logger.error(
        { err: error, url: request.url, path },
        "Error running request handler",
      );
      next(error);
    }
  };
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

function joinPath(basePath: string, suffix: string): string {
  if (basePath === "/") {
    return suffix.startsWith("/") ? suffix : `/${suffix}`;
  }

  if (!suffix) {
    return basePath;
  }

  if (suffix === "*") {
    return `${basePath}/*`;
  }

  return `${basePath}${suffix.startsWith("/") ? suffix : `/${suffix}`}`;
}
