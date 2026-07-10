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

/**
 * Phase 1 runs exactly one bot per channel. {@link PhoenixRealtimeTransport} is
 * a single-delivery-callback object bound to one channel; attaching more than
 * one bot's `intelligenceAdapter` to the same transport would make every
 * delivery dispatch through the last bot's callback (and earlier bots receive
 * nothing). Multi-bot routing over a shared channel is Phase 2 (OSS-459) — until
 * then, run one bot per channel/runner and fail loudly on more.
 */
function assertSingleBotForPhase1(bots: readonly Bot[]): void {
  if (bots.length !== 1) {
    throw new Error(
      `managed Phoenix runtime supports exactly one bot per channel, got ${bots.length} — ` +
        "multi-bot routing over a shared PhoenixRealtimeTransport is not implemented yet (OSS-459); " +
        "run one bot per channel/runner",
    );
  }
}

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
  assertSingleBotForPhase1(bots);
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
   * in `handle.metadata`. `runtimeInstanceId` is intentionally excluded — the
   * required top-level {@link ManagedPhoenixConfig.runtimeInstanceId} is
   * authoritative for both the join and `handle.metadata` (they must agree). */
  env?: Partial<Omit<ActivationEnv, "runtimeInstanceId">>;
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
  // Fail fast before opening a socket for an unsupported multi-bot call.
  assertSingleBotForPhase1(bots);

  // Build activation metadata up front so the join carries the Runtime
  // Activation data Intelligence's health view expects (runtime env, node
  // version, per-bot commands) rather than just name+adapter. The same
  // `envOverrides` is forwarded to startManagedBots so `handle.metadata` agrees
  // with what we declared on join. The required `config.runtimeInstanceId` is
  // spread LAST so it stays authoritative even though `config.env` cannot carry
  // it (type-excluded) — belt and suspenders for the join↔metadata invariant.
  const envOverrides: Partial<ActivationEnv> = {
    ...(config.env ?? {}),
    runtimeInstanceId: config.runtimeInstanceId,
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
  // The channel is now joined. If starting the bots throws (e.g. a bot was
  // already started, or a conflicting adapter), the caller never receives a
  // handle — so disconnect the socket here rather than leak it, then rethrow.
  let handle: ManagedBotsHandle;
  try {
    handle = await startManagedBotsOnChannel(bots, {
      channel,
      scope: config.scope,
      runtimeInstanceId: config.runtimeInstanceId,
      env: envOverrides,
      ...(config.log ? { log: config.log } : {}),
    });
  } catch (err) {
    channel.disconnect();
    throw err;
  }
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
