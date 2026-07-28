import { createCopilotRuntimeHandler } from "../core/fetch-handler";
import type { CopilotRuntimeHandlerOptions } from "../core/fetch-handler";
import type { RuntimeWithDeclaredChannels } from "../core/runtime";
import type { ChannelsControl } from "../core/channel-manager";
import { createCopilotNodeHandler } from "./node-fetch-handler";
import type { NodeFetchHandler } from "./node-fetch-handler";

/**
 * A Node.js HTTP request listener that is also a callable object carrying an
 * optional {@link ChannelsControl} surface, mirroring
 * `CopilotRuntimeFetchHandler.channels`. Node is the long-running,
 * lifecycle-owning entry point for the runtime, so it is the surface that
 * exposes `.channels` for callers that need to start, observe, or stop managed
 * Channel activation.
 */
export type NodeCopilotListener = NodeFetchHandler & {
  channels?: ChannelsControl;
};

/**
 * A {@link NodeCopilotListener} whose {@link ChannelsControl} surface is
 * guaranteed present. Returned when the runtime was constructed with at least
 * one declared Intelligence Channel and activation was not opted out of, so the
 * documented `listener.channels.ready(...)` call type-checks without a `!` or a
 * `?.` under strict TypeScript — the Node mirror of
 * `CopilotRuntimeFetchHandlerWithChannels`.
 */
export type NodeCopilotListenerWithChannels = NodeFetchHandler & {
  /** Lifecycle control surface for the runtime's declared managed Channels. */
  channels: ChannelsControl;
};

/**
 * Convenience wrapper for creating a Node.js HTTP request listener
 * from CopilotKit runtime handler options.
 *
 * When the runtime declares managed Channels (and activation was not opted
 * out of via `activateChannels: false`), the returned listener exposes
 * `.channels` — the same {@link ChannelsControl} surface carried by the
 * underlying fetch handler.
 *
 * ## Managed Channels lifecycle
 *
 * Creating the listener opens NO connection. Activation — which opens the
 * persistent Realtime Gateway WebSocket and starts every direct adapter on the
 * declared Channels — is LAZY: it is triggered by the first
 * `await listener.channels.ready()` and never before, neither at creation nor on
 * the first HTTP request. On a long-running host that call is REQUIRED, not
 * optional: without it the process serves HTTP but no Channel is ever connected.
 * `listener.channels.stop()` tears activation down. See the
 * `createCopilotRuntimeHandler` TSDoc for why activation is deferred
 * (serverless/edge safety).
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
 * // Required to connect declared managed Channels. Bound it so one wedged
 * // adapter cannot hang startup forever.
 * await listener.channels.ready({ timeoutMs: 30_000 });
 * ```
 */
/**
 * Overload: a runtime constructed with at least one declared Intelligence
 * Channel (a {@link RuntimeWithDeclaredChannels}-branded runtime), when
 * activation is not disabled, yields a listener with a **non-optional**
 * {@link ChannelsControl}. `activateChannels` is constrained to
 * `true | undefined` here so passing `activateChannels: false` (which leaves no
 * `.channels`) falls through to the optional-shape overload below rather than
 * dishonestly promising a control surface that will not exist. Mirrors the
 * `createCopilotRuntimeHandler` overload pair so the brand survives the wrapper.
 *
 * The brand comes from constructing the runtime with a literal non-empty
 * `channels` list (`readonly [Channel, ...Channel[]]`). A runtime built from a
 * dynamically-assembled `Channel[]` is not branded, so it falls to the
 * optional-shape overload and its call sites still need `?.`.
 */
export function createCopilotNodeListener(
  options: CopilotRuntimeHandlerOptions & {
    runtime: RuntimeWithDeclaredChannels;
    activateChannels?: true | undefined;
  },
): NodeCopilotListenerWithChannels;
/**
 * Overload: every other runtime (SSE, Intelligence without channels, or with
 * activation disabled) yields a listener whose `.channels` is optional.
 */
export function createCopilotNodeListener(
  options: CopilotRuntimeHandlerOptions,
): NodeCopilotListener;
export function createCopilotNodeListener(
  options: CopilotRuntimeHandlerOptions,
): NodeCopilotListener {
  const handler = createCopilotRuntimeHandler(options);
  const listener: NodeCopilotListener = createCopilotNodeHandler(handler);
  listener.channels = handler.channels;
  return listener;
}
