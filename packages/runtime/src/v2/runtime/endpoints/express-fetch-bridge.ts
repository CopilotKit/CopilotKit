/**
 * Express-aware Node ↔ Fetch bridge.
 *
 * When Express body-parsing middleware (e.g. `express.json()`) runs before the
 * CopilotKit router, the Node request stream is already consumed and `req.body`
 * holds the parsed content. The generic `createCopilotNodeHandler` (which uses
 * `@remix-run/node-fetch-server`) would hang because it tries to read from the
 * exhausted stream.
 *
 * This module detects the pre-parsed case and re-serialises `req.body` into the
 * Fetch `Request`, falling back to the generic `createCopilotNodeHandler` when the
 * stream is still available.
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import { createCopilotNodeHandler } from "./node-fetch-handler";
import type { CopilotRuntimeFetchHandler } from "../core/fetch-handler";

export type ExpressNodeHandler = (
  req: IncomingMessage,
  res: ServerResponse,
) => Promise<void>;

/**
 * Creates a Node HTTP handler from a fetch handler, with Express body-parser
 * compatibility.
 *
 * Automatically detects whether the request stream is available or pre-parsed
 * by Express body-parsing middleware.
 */
export function createExpressNodeHandler(
  handler: CopilotRuntimeFetchHandler,
): ExpressNodeHandler {
  return createCopilotNodeHandler(handler);
}
