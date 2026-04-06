/**
 * Generic Node ↔ Fetch bridge for CopilotKit runtime.
 *
 * Wraps a `CopilotRuntimeFetchHandler` as a Node HTTP handler using
 * `@remix-run/node-fetch-server` for reliable streaming and conversion.
 *
 * @example
 * ```typescript
 * import { createServer } from "node:http";
 * import { createCopilotRuntimeHandler } from "@copilotkit/runtime/v2";
 * import { createCopilotNodeHandler } from "@copilotkit/runtime/v2/node";
 *
 * const handler = createCopilotRuntimeHandler({ runtime, basePath: "/api/copilotkit", cors: true });
 * const nodeHandler = createCopilotNodeHandler(handler);
 * createServer(nodeHandler).listen(3000);
 * ```
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import { createRequest, sendResponse } from "@remix-run/node-fetch-server";
import type { CopilotRuntimeFetchHandler } from "../core/fetch-handler";
import { logger } from "@copilotkit/shared";

export type NodeFetchHandler = (
  req: IncomingMessage,
  res: ServerResponse,
) => Promise<void>;

export function createCopilotNodeHandler(
  handler: CopilotRuntimeFetchHandler,
): NodeFetchHandler {
  return async (req: IncomingMessage, res: ServerResponse) => {
    try {
      const fetchReq = createRequest(req, res);
      const fetchRes = await handler(fetchReq);
      await sendResponse(res, fetchRes);
    } catch (err: unknown) {
      logger.error({ err }, "Error in Node fetch handler");
      if (!res.headersSent) {
        res.statusCode = 500;
        res.end("Internal Server Error");
      }
    }
  };
}

/** @deprecated Use `createCopilotNodeHandler` instead. */
export const createNodeFetchHandler = createCopilotNodeHandler;
