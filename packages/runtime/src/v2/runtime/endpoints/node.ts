import { createCopilotRuntimeHandler } from "../core/fetch-handler";
import type { CopilotRuntimeHandlerOptions } from "../core/fetch-handler";
import { createCopilotNodeHandler } from "./node-fetch-handler";
import type { NodeFetchHandler } from "./node-fetch-handler";
/**
 * Convenience wrapper for creating a Node.js HTTP request listener
 * from CopilotKit runtime handler options.
 *
 * @example
 * ```typescript
 * import { createServer } from "node:http";
 * import { CopilotRuntime } from "@copilotkit/runtime/v2";
 * import { createCopilotNodeListener } from "@copilotkit/runtime/v2/node";
 *
 * const listener = createCopilotNodeListener({
 *   runtime: new CopilotRuntime({ agents: { ... } }),
 *   basePath: "/api/copilotkit",
 *   cors: true,
 * });
 * createServer(listener).listen(3000);
 * ```
 */
export function createCopilotNodeListener(
  options: CopilotRuntimeHandlerOptions,
): NodeFetchHandler {
  const handler = createCopilotRuntimeHandler(options);
  return createCopilotNodeHandler(handler);
}
