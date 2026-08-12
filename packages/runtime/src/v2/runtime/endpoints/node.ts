import { createCopilotRuntimeHandler } from "../core/fetch-handler";
import type { CopilotRuntimeHandlerOptions } from "../core/fetch-handler";
import type { RuntimeWithDeclaredChannels } from "../core/runtime";
import type { ChannelsControl } from "../core/channel-manager";
import { createCopilotNodeHandler } from "./node-fetch-handler";
import type { NodeFetchHandler } from "./node-fetch-handler";
import { autoStartChannels } from "./auto-start-channels";

/**
 * A Node.js HTTP request listener that is also a callable object carrying an
 * optional {@link ChannelsControl} surface, mirroring
 * `CopilotRuntimeFetchHandler.channels`. Node is the long-running,
 * lifecycle-owning entry point for the runtime, so it is the surface that
 * exposes `.channels` for callers that need to observe or stop the managed
 * Channel activation the listener starts at creation.
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
 * Creating the listener STARTS activation — which opens the persistent Realtime
 * Gateway WebSocket and starts every direct adapter on the declared Channels.
 * Node owns its own process lifetime, so there is nothing to defer to and no
 * required incantation: a declared Channel connects because it was declared.
 * (The generic `createCopilotRuntimeHandler` is the opposite — it stays lazy for
 * serverless/edge safety; see its TSDoc.)
 *
 * `await listener.channels.ready()` is therefore OPTIONAL and purely
 * await-and-observe: it resolves once every declared Channel has settled to
 * `online`/`setup_required` and rejects with the activation failure, observing
 * the activation started at creation rather than triggering a second one. Await
 * it when startup should block on Channels being live (or should exit non-zero
 * when they are not); skip it and activation failures land in the logs instead.
 * `listener.channels.stop()` tears activation down.
 *
 * Pass `activateChannels: false` to build no control surface and open no socket
 * — the clean opt-out for a test or a short-lived script that mounts the
 * listener without wanting its Channels connected.
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
 * // Declared managed Channels are already connecting at this point.
 *
 * // Optional: block startup on them being live. Bound it so one wedged adapter
 * // cannot hang startup forever.
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
  autoStartChannels(listener.channels);
  return listener;
}
