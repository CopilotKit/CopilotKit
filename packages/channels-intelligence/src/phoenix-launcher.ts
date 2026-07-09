import type { Bot } from "@copilotkit/channels";
import { startManagedBots } from "./runtime.js";
import type { ManagedBotsHandle } from "./runtime.js";
import { connectPhoenixHostedBotChannel } from "./phoenix-channel.js";
import { PhoenixRealtimeTransport } from "./phoenix-transport.js";
import type {
  HostedBotChannel,
  HostedBotRealtimeScope,
} from "./phoenix-transport.js";
import type { EgressSink } from "./transports.js";

/**
 * Phoenix-path egress is vestigial: with a render sink wired (the transport
 * itself), the adapter routes every `post`/`update` and the run-render stream
 * through the render sink and never through the generic {@link EgressSink}. Fail
 * loud if that invariant is ever broken, rather than silently dropping an op.
 */
const phoenixEgress: EgressSink = {
  emit: async () => {
    throw new Error(
      "startManagedBotsOverPhoenix: EgressSink.emit was called, but the Phoenix " +
        "path routes all egress through the render sink — this indicates a " +
        "wiring bug (the render sink was not set on the adapter).",
    );
  },
};

/** Options for {@link startManagedBotsOnChannel} — an already-connected channel. */
export interface ManagedBotsOnChannelOptions {
  /** The joined realtime-gateway bot-IO channel (`hosted_bots:project:<id>`). */
  channel: HostedBotChannel;
  /** Authoritative org/project/bot scope echoed on every SDK→gateway envelope. */
  scope: HostedBotRealtimeScope;
  /** Stable runtime instance id (`rti_…`), echoed on every envelope. */
  runtimeInstanceId: string;
  /** Diagnostic sink for dropped deliveries / transport events. */
  log?: (message: string, meta?: unknown) => void;
}

/**
 * Compose the managed runtime over an already-connected Phoenix channel: wrap
 * the channel in a {@link PhoenixRealtimeTransport} (delivery source + render
 * sink) and start the declared bots against it via {@link startManagedBots}.
 *
 * Split out from {@link startManagedBotsOverPhoenix} so the composition — the
 * part with behavior — is unit-testable against a fake channel, leaving the
 * socket connect as thin glue. `intelligenceAdapter` is exclusive, so the
 * Phoenix transport is each bot's ONLY adapter; egress is served by the render
 * sink, not the generic {@link EgressSink} (see {@link phoenixEgress}).
 */
export async function startManagedBotsOnChannel(
  bots: Bot[],
  opts: ManagedBotsOnChannelOptions,
): Promise<ManagedBotsHandle> {
  const transport = new PhoenixRealtimeTransport({
    scope: opts.scope,
    runtimeInstanceId: opts.runtimeInstanceId,
    channel: opts.channel,
    ...(opts.log ? { log: opts.log } : {}),
  });
  return startManagedBots({
    bots,
    resolveTransport: () => ({
      source: transport,
      renderSink: transport,
      egress: phoenixEgress,
    }),
  });
}

/** Config for {@link startManagedBotsOverPhoenix}. */
export interface ManagedPhoenixConfig {
  /** Gateway runner WebSocket URL — the `/runner` socket hosting the
   * `hosted_bots:project:<id>` channel. */
  wsUrl: string;
  /** Project runtime API key (`cpk-…`), presented as the socket `authToken`. */
  apiKey: string;
  /** Authoritative org/project/bot scope echoed on every SDK→gateway envelope. */
  scope: HostedBotRealtimeScope;
  /** Stable runtime instance id (`rti_…`). */
  runtimeInstanceId: string;
  /** Adapter kind declared to the gateway on join (default `"slack"`). */
  adapter?: string;
  /** Join timeout in ms. */
  timeoutMs?: number;
  /** Injectable `WebSocket` ctor (non-global hosts / tests). */
  webSocket?: unknown;
  /** Diagnostic sink for dropped deliveries / transport events. */
  log?: (message: string, meta?: unknown) => void;
}

/**
 * The managed-over-Phoenix launcher (OSS-406): connect the realtime-gateway
 * bot-IO channel, then run the declared bots against it via
 * {@link startManagedBotsOnChannel}. This is the composition that runs a
 * managed bot over the realtime path — the transport primitives are unit-tested;
 * this wires them for a live run. The returned handle's `stop()` stops the bots
 * and then disconnects the socket.
 */
export async function startManagedBotsOverPhoenix(
  bots: Bot[],
  config: ManagedPhoenixConfig,
): Promise<ManagedBotsHandle> {
  const adapter = config.adapter ?? "slack";
  const channel = await connectPhoenixHostedBotChannel({
    wsUrl: config.wsUrl,
    apiKey: config.apiKey,
    projectId: config.scope.projectId,
    join: {
      runtimeInstanceId: config.runtimeInstanceId,
      declaredBots: bots.map((bot) => ({ botName: bot.name!, adapter })),
      observedAt: new Date().toISOString(),
    },
    ...(config.timeoutMs !== undefined ? { timeoutMs: config.timeoutMs } : {}),
    ...(config.webSocket !== undefined ? { webSocket: config.webSocket } : {}),
  });
  const handle = await startManagedBotsOnChannel(bots, {
    channel,
    scope: config.scope,
    runtimeInstanceId: config.runtimeInstanceId,
    ...(config.log ? { log: config.log } : {}),
  });
  return {
    ...handle,
    stop: async () => {
      await handle.stop();
      // The launcher owns the connection, so it closes it — the transport is
      // handed the channel and doesn't disconnect it itself.
      channel.disconnect();
    },
  };
}
