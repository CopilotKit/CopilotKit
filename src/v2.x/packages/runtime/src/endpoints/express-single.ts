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
import { createJsonRequest, expectString, MethodCall, parseMethodCall } from "./single-route-helpers";

interface CopilotSingleRouteExpressParams {
  runtime: CopilotRuntime;
  basePath: string;
}

export function createCopilotEndpointSingleRouteExpress({
  runtime,
  basePath,
}: CopilotSingleRouteExpressParams): Router {
  const router = express.Router();
  const routePath = normalizeSingleRoutePath(basePath);

  router.use(cors({
    origin: "*",
    methods: ["GET", "HEAD", "PUT", "POST", "DELETE", "PATCH", "OPTIONS"],
    allowedHeaders: ["*"],
  }));

  router.post(routePath, createSingleRouteHandler(runtime));

  router.use((req, res) => {
    res.status(404).json({ error: "Not found" });
  });

  return router;
}

function createSingleRouteHandler(runtime: CopilotRuntime) {
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

    let methodCall: MethodCall;
    try {
      methodCall = await parseMethodCall(request);
    } catch (error) {
      if (error instanceof Response) {
        logger.warn({ url: request.url }, "Invalid single-route payload");
        try {
          await sendFetchResponse(res, error);
        } catch (streamError) {
          next(streamError);
        }
        return;
      }
      logger.warn({ err: error, url: request.url }, "Invalid single-route payload");
      res.status(400).json({
        error: "invalid_request",
        message: error instanceof Error ? error.message : "Invalid request payload",
      });
      return;
    }

    try {
      let response: Response;
      switch (methodCall.method) {
        case "agent/run": {
          const agentId = expectString(methodCall.params, "agentId");
          const handlerRequest = createJsonRequest(request, methodCall.body);
          response = await handleRunAgent({ runtime, request: handlerRequest, agentId });
          break;
        }
        case "agent/connect": {
          const agentId = expectString(methodCall.params, "agentId");
          const handlerRequest = createJsonRequest(request, methodCall.body);
          response = await handleConnectAgent({ runtime, request: handlerRequest, agentId });
          break;
        }
        case "agent/stop": {
          const agentId = expectString(methodCall.params, "agentId");
          const threadId = expectString(methodCall.params, "threadId");
          response = await handleStopAgent({ runtime, request, agentId, threadId });
          break;
        }
        case "info": {
          response = await handleGetRuntimeInfo({ runtime, request });
          break;
        }
        case "transcribe": {
          response = await handleTranscribe({ runtime, request });
          break;
        }
        default: {
          const exhaustive: never = methodCall.method;
          return exhaustive;
        }
      }

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
      logger.error({ err: error, url: request.url, path }, "Error running single-route handler");
      next(error);
    }
  };
}

function normalizeSingleRoutePath(path: string): string {
  if (!path) {
    throw new Error("basePath must be provided for Express single-route endpoint");
  }

  if (!path.startsWith("/")) {
    return `/${path}`;
  }

  if (path.length > 1 && path.endsWith("/")) {
    return path.slice(0, -1);
  }

  return path;
}
