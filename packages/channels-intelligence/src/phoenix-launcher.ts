import type { Bot } from "@copilotkit/channels";
import {
  startManagedBots,
  assertValidBotNames,
  buildActivationMetadata,
  resolveActivationEnv,
} from "./runtime.js";
import type { ManagedBotsHandle, ActivationEnv } from "./runtime.js";
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
  /** Activation env overrides forwarded to the runtime (so `handle.metadata`
   * matches what the caller declared on join); omitted fields are gathered from
   * the process. */
  env?: Partial<ActivationEnv>;
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
    ...(opts.env ? { env: opts.env } : {}),
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
  /** Activation env overrides (package versions, runtimeEnv); omitted fields
   * are gathered from the process. Included in the join's `runtimeMetadata` and
   * in `handle.metadata`. */
  env?: Partial<ActivationEnv>;
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

  // Fail fast BEFORE opening the socket: a missing/duplicate name would
  // otherwise send a broken join (`botName: undefined`) and — because the same
  // check inside startManagedBots runs only after we've connected — throw with
  // the socket already open and never closed (a leak). Validating here means a
  // bad declaration never opens a connection at all.
  assertValidBotNames(bots);

  // Build activation metadata up front so the join carries the Runtime
  // Activation data Intelligence's health view expects (runtime env, node
  // version, per-bot commands) rather than just name+adapter. The same
  // `envOverrides` is forwarded to startManagedBots so `handle.metadata` agrees
  // with what we declared on join.
  const envOverrides: Partial<ActivationEnv> = {
    runtimeInstanceId: config.runtimeInstanceId,
    ...(config.env ?? {}),
  };
  const activation = buildActivationMetadata(
    bots,
    resolveActivationEnv(envOverrides),
  );

  const channel = await connectPhoenixHostedBotChannel({
    wsUrl: config.wsUrl,
    apiKey: config.apiKey,
    projectId: config.scope.projectId,
    join: {
      runtimeInstanceId: config.runtimeInstanceId,
      declaredBots: activation.declaredBots.map((b) => ({
        botName: b.name,
        adapter,
        // renderCapabilities: reserved — bots don't expose capabilities yet
        // (tracked with the richer per-bot metadata in OSS-377).
      })),
      runtimeMetadata: {
        runtimeEnv: activation.runtimeEnv,
        ...(activation.nodeVersion
          ? { nodeVersion: activation.nodeVersion }
          : {}),
        ...(activation.runtimePackageVersion
          ? { runtimePackageVersion: activation.runtimePackageVersion }
          : {}),
        ...(activation.botPackageVersion
          ? { botPackageVersion: activation.botPackageVersion }
          : {}),
        commands: Object.fromEntries(
          activation.declaredBots.map((b) => [b.name, b.commands]),
        ),
      },
      observedAt: new Date().toISOString(),
    },
    ...(config.timeoutMs !== undefined ? { timeoutMs: config.timeoutMs } : {}),
    ...(config.webSocket !== undefined ? { webSocket: config.webSocket } : {}),
  });
  const handle = await startManagedBotsOnChannel(bots, {
    channel,
    scope: config.scope,
    runtimeInstanceId: config.runtimeInstanceId,
    env: envOverrides,
    ...(config.log ? { log: config.log } : {}),
  });
  return {
    ...handle,
    stop: async () => {
      // Always close the connection even if stopping the bots throws — the
      // launcher owns the socket (the transport is handed the channel and does
      // not disconnect it itself).
      try {
        await handle.stop();
      } finally {
        channel.disconnect();
      }
    },
  };
}
