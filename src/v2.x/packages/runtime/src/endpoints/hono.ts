import { Hono } from "hono";
import { cors } from "hono/cors";
import { CopilotRuntime } from "../runtime";
import { handleRunAgent } from "../handlers/handle-run";
import { handleGetRuntimeInfo } from "../handlers/get-runtime-info";
import { handleTranscribe } from "../handlers/handle-transcribe";
import { logger } from "@copilotkitnext/shared";
import { callBeforeRequestMiddleware, callAfterRequestMiddleware } from "../middleware";
import { handleConnectAgent } from "../handlers/handle-connect";
import { handleStopAgent } from "../handlers/handle-stop";

interface CopilotEndpointParams {
  runtime: CopilotRuntime;
  basePath: string;
}

// Define the context variables type
type CopilotEndpointContext = {
  Variables: {
    modifiedRequest?: Request;
  };
};

export function createCopilotEndpoint({ runtime, basePath }: CopilotEndpointParams) {
  const app = new Hono<CopilotEndpointContext>();

  return app
    .basePath(basePath)
    .use(
      "*",
      cors({
        origin: "*",
        allowMethods: ["GET", "HEAD", "PUT", "POST", "DELETE", "PATCH", "OPTIONS"],
        allowHeaders: ["*"],
      }),
    )
    .use("*", async (c, next) => {
      const request = c.req.raw;
      const path = c.req.path;

      try {
        const maybeModifiedRequest = await callBeforeRequestMiddleware({
          runtime,
          request,
          path,
        });
        if (maybeModifiedRequest) {
          c.set("modifiedRequest", maybeModifiedRequest);
        }
      } catch (error) {
        logger.error({ err: error, url: request.url, path }, "Error running before request middleware");
        if (error instanceof Response) {
          return error;
        }
        throw error;
      }

      await next();
    })
    .use("*", async (c, next) => {
      await next();

      const response = c.res;
      const path = c.req.path;

      // Non-blocking after middleware
      callAfterRequestMiddleware({
        runtime,
        response,
        path,
      }).catch((error) => {
        logger.error({ err: error, url: c.req.url, path }, "Error running after request middleware");
      });
    })
    .post("/agent/:agentId/run", async (c) => {
      const agentId = c.req.param("agentId");
      const request = c.get("modifiedRequest") || c.req.raw;

      try {
        return await handleRunAgent({
          runtime,
          request,
          agentId,
        });
      } catch (error) {
        logger.error({ err: error, url: request.url, path: c.req.path }, "Error running request handler");
        throw error;
      }
    })
    .post("/agent/:agentId/connect", async (c) => {
      const agentId = c.req.param("agentId");
      const request = c.get("modifiedRequest") || c.req.raw;

      try {
        return await handleConnectAgent({
          runtime,
          request,
          agentId,
        });
      } catch (error) {
        logger.error({ err: error, url: request.url, path: c.req.path }, "Error running request handler");
        throw error;
      }
    })

    .post("/agent/:agentId/stop/:threadId", async (c) => {
      const agentId = c.req.param("agentId");
      const threadId = c.req.param("threadId");
      const request = c.get("modifiedRequest") || c.req.raw;

      try {
        return await handleStopAgent({
          runtime,
          request,
          agentId,
          threadId,
        });
      } catch (error) {
        logger.error({ err: error, url: request.url, path: c.req.path }, "Error running request handler");
        throw error;
      }
    })
    .get("/info", async (c) => {
      const request = c.get("modifiedRequest") || c.req.raw;

      try {
        return await handleGetRuntimeInfo({
          runtime,
          request,
        });
      } catch (error) {
        logger.error({ err: error, url: request.url, path: c.req.path }, "Error running request handler");
        throw error;
      }
    })
    .post("/transcribe", async (c) => {
      const request = c.get("modifiedRequest") || c.req.raw;

      try {
        return await handleTranscribe({
          runtime,
          request,
        });
      } catch (error) {
        logger.error({ err: error, url: request.url, path: c.req.path }, "Error running request handler");
        throw error;
      }
    })
    .notFound((c) => {
      return c.json({ error: "Not found" }, 404);
    });

  // return app;
}
