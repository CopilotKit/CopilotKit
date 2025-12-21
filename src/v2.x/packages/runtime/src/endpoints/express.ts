import express from "express";
import type { Request as ExpressRequest, Response as ExpressResponse, NextFunction, Router } from "express";
import cors from "cors";

import { CopilotRuntime } from "../runtime";
import { handleRunAgent } from "../handlers/handle-run";
import { handleConnectAgent } from "../handlers/handle-connect";
import { handleStopAgent } from "../handlers/handle-stop";
import { handleGetRuntimeInfo } from "../handlers/get-runtime-info";
import { handleTranscribe } from "../handlers/handle-transcribe";
import { logger } from "@copilotkitnext/shared";
import { callBeforeRequestMiddleware, callAfterRequestMiddleware } from "../middleware";
import { createFetchRequestFromExpress, sendFetchResponse } from "./express-utils";

interface CopilotExpressEndpointParams {
  runtime: CopilotRuntime;
  basePath: string;
}

export function createCopilotEndpointExpress({ runtime, basePath }: CopilotExpressEndpointParams): Router {
  const router = express.Router();
  const normalizedBase = normalizeBasePath(basePath);

  router.use(cors({
    origin: "*",
    methods: ["GET", "HEAD", "PUT", "POST", "DELETE", "PATCH", "OPTIONS"],
    allowedHeaders: ["*"],
  }));

  router.post(joinPath(normalizedBase, "/agent/:agentId/run"), createRouteHandler(runtime, async ({ request, req }) => {
    const agentId = req.params.agentId as string;
    return handleRunAgent({ runtime, request, agentId });
  }));

  router.post(joinPath(normalizedBase, "/agent/:agentId/connect"), createRouteHandler(runtime, async ({ request, req }) => {
    const agentId = req.params.agentId as string;
    return handleConnectAgent({ runtime, request, agentId });
  }));

  router.post(joinPath(normalizedBase, "/agent/:agentId/stop/:threadId"), createRouteHandler(runtime, async ({ request, req }) => {
    const agentId = req.params.agentId as string;
    const threadId = req.params.threadId as string;
    return handleStopAgent({ runtime, request, agentId, threadId });
  }));

  router.get(joinPath(normalizedBase, "/info"), createRouteHandler(runtime, async ({ request }) => {
    return handleGetRuntimeInfo({ runtime, request });
  }));

  router.post(joinPath(normalizedBase, "/transcribe"), createRouteHandler(runtime, async ({ request }) => {
    return handleTranscribe({ runtime, request });
  }));

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

function createRouteHandler(runtime: CopilotRuntime, factory: RouteHandlerFactory) {
  return async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
    const path = req.originalUrl ?? req.path;
    let request = createFetchRequestFromExpress(req);
    try {
      const maybeModifiedRequest = await callBeforeRequestMiddleware({ runtime, request, path });
      if (maybeModifiedRequest) {
        request = maybeModifiedRequest;
      }
    } catch (error) {
      logger.error({ err: error, url: request.url, path }, "Error running before request middleware");
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
      await sendFetchResponse(res, response);
      callAfterRequestMiddleware({ runtime, response, path }).catch((error) => {
        logger.error({ err: error, url: req.originalUrl ?? req.url, path }, "Error running after request middleware");
      });
    } catch (error) {
      if (error instanceof Response) {
        try {
          await sendFetchResponse(res, error);
        } catch (streamError) {
          next(streamError);
          return;
        }
        callAfterRequestMiddleware({ runtime, response: error, path }).catch((mwError) => {
          logger.error({ err: mwError, url: req.originalUrl ?? req.url, path }, "Error running after request middleware");
        });
        return;
      }
      logger.error({ err: error, url: request.url, path }, "Error running request handler");
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
