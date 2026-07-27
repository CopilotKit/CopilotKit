import { createCopilotRuntimeHandler } from "../core/fetch-handler";
import type { CopilotRuntimeHandlerOptions } from "../core/fetch-handler";
import type { ChannelsControl } from "../core/channel-manager";
import { createCopilotNodeHandler } from "./node-fetch-handler";
import type { NodeFetchHandler } from "./node-fetch-handler";

/**
 * A Node.js HTTP request listener that is also a callable object carrying an
 * optional {@link ChannelsControl} surface, mirroring
 * `CopilotRuntimeFetchHandler.channels`. Node is the long-running,
 * lifecycle-owning entry point for the runtime, so it is the surface that
 * exposes `.channels` for callers that need to observe or stop managed
 * Channel activation.
 */
export type NodeCopilotListener = NodeFetchHandler & {
  channels?: ChannelsControl;
};

/**
 * Convenience wrapper for creating a Node.js HTTP request listener
 * from CopilotKit runtime handler options.
 *
 * When the runtime declares managed Channels (and activation was not opted
 * out of via `activateChannels: false`), the returned listener exposes
 * `.channels` — the same {@link ChannelsControl} surface the underlying
 * fetch handler activates at creation time.
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
 *
 * // Optional: observe/stop managed Channel activation.
 * await listener.channels?.ready();
 * ```
 */
export function createCopilotNodeListener(
  options: CopilotRuntimeHandlerOptions,
): NodeCopilotListener {
  const handler = createCopilotRuntimeHandler(options);
  const listener: NodeCopilotListener = createCopilotNodeHandler(handler);
  listener.channels = handler.channels;
  return listener;
}
