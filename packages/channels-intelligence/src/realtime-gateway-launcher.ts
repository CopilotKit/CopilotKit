import type { Bot } from "@copilotkit/channels";
import {
  startManagedBots,
  assertValidBotNames,
  buildActivationMetadata,
  resolveActivationEnv,
} from "./runtime.js";
import type { ManagedBotsHandle, ActivationEnv } from "./runtime.js";
import { connectRealtimeGateway } from "./realtime-gateway.js";
import { RealtimeGatewayTransport } from "./realtime-gateway-transport.js";
import type { HostedBotRealtimeScope } from "./realtime-gateway-transport.js";
import type { RealtimeGatewaySession } from "./realtime-gateway.js";
import type { EgressSink } from "./transports.js";

/**
 * Realtime Gateway egress is vestigial: with a render sink wired (the transport
 * itself), the adapter routes every `post`/`update` and the run-render stream
 * through the render sink and never through the generic {@link EgressSink}. Fail
 * loud if that invariant is ever broken, rather than silently dropping an op.
 */
const realtimeGatewayEgress: EgressSink = {
  emit: async () => {
    throw new Error(
      "startChannelsOverRealtimeGateway: EgressSink.emit was called, but the Realtime Gateway " +
        "path routes all egress through the render sink — this indicates a " +
        "wiring bug (the render sink was not set on the adapter).",
    );
  },
};

/**
 * Phase 1 runs exactly one framework {@link Bot} per gateway session.
 * {@link RealtimeGatewayTransport} is a single-delivery-callback object bound
 * to one session; attaching more than one Bot's `intelligenceAdapter` to the
 * same transport would make every delivery dispatch through the last Bot's
 * callback (and earlier Bots receive
 * nothing). Multi-Bot routing over a shared session is not implemented yet —
 * until then, run one Bot per gateway session/runner and fail loudly on more.
 */
function assertSingleBotForPhase1(bots: readonly Bot[]): void {
  if (bots.length !== 1) {
    throw new Error(
      `managed Realtime Gateway runtime supports exactly one Bot per gateway session, got ${bots.length} — ` +
        "multi-Bot routing over a shared RealtimeGatewayTransport is not implemented yet (OSS-459); " +
        "run one Bot per gateway session/runner",
    );
  }
}

/** Options for {@link startChannelsWithGatewaySession}. */
export interface StartChannelsWithGatewaySessionOptions {
  /** The joined Realtime Gateway session. */
  session: RealtimeGatewaySession;
  /** Authoritative org/project/channel scope echoed on every SDK→gateway envelope. */
  scope: HostedBotRealtimeScope;
  /** Stable runtime instance id (`rti_…`), echoed on every envelope. */
  runtimeInstanceId: string;
  /** Activation env overrides forwarded to the runtime (so `handle.metadata`
   * matches what the caller declared on join); omitted fields are gathered from
   * the process. `runtimeInstanceId` is excluded — the required
   * {@link StartChannelsWithGatewaySessionOptions.runtimeInstanceId} above is authoritative
   * and is merged in, so the transport (which stamps it on every envelope) and
   * `handle.metadata` always report the same id. */
  env?: Partial<Omit<ActivationEnv, "runtimeInstanceId">>;
  /** Diagnostic sink for dropped deliveries / transport events. */
  log?: (message: string, meta?: unknown) => void;
}

/**
 * Compose the managed runtime over an already-connected gateway session: wrap
 * the session in a {@link RealtimeGatewayTransport} (delivery source + render
 * sink) and start the declared Bots against it via {@link startManagedBots}.
 *
 * Split out from {@link startChannelsOverRealtimeGateway} so the composition —
 * the part with behavior — is unit-testable against a fake session, leaving the
 * connector as thin glue. `intelligenceAdapter` is exclusive, so the gateway
 * transport is each Bot's ONLY adapter; egress is served by the render sink,
 * not the generic {@link EgressSink} (see {@link realtimeGatewayEgress}).
 */
export async function startChannelsWithGatewaySession(
  bots: Bot[],
  opts: StartChannelsWithGatewaySessionOptions,
): Promise<ManagedBotsHandle> {
  assertSingleBotForPhase1(bots);
  const transport = new RealtimeGatewayTransport({
    scope: opts.scope,
    runtimeInstanceId: opts.runtimeInstanceId,
    session: opts.session,
    ...(opts.log ? { log: opts.log } : {}),
  });
  return startManagedBots({
    bots,
    resolveTransport: () => ({
      source: transport,
      renderSink: transport,
      egress: realtimeGatewayEgress,
    }),
    // The required runtimeInstanceId is authoritative: merge it in LAST so
    // `handle.metadata` reports the same id the transport stamps on every
    // envelope, regardless of any `env` overrides (which cannot carry it).
    env: { ...opts.env, runtimeInstanceId: opts.runtimeInstanceId },
  });
}

/** Config for {@link startChannelsOverRealtimeGateway}. */
export interface StartChannelsOverRealtimeGatewayOptions {
  /** Gateway runner WebSocket URL — the `/runner` endpoint hosting the
   * `channels:project:<id>` session. */
  wsUrl: string;
  /** Project runtime API key (`cpk-…`), presented as the socket `authToken`. */
  apiKey: string;
  /** Authoritative org/project/channel scope echoed on every SDK→gateway envelope. */
  scope: HostedBotRealtimeScope;
  /** Stable runtime instance id (`rti_…`). */
  runtimeInstanceId: string;
  /** Adapter kind declared to the gateway on join (default `"slack"`). */
  adapter?: string;
  /** Activation env overrides (package versions, runtimeEnv); omitted fields
   * are gathered from the process. Included in the join's `runtimeMetadata` and
   * in `handle.metadata`. `runtimeInstanceId` is intentionally excluded — the
   * required top-level {@link StartChannelsOverRealtimeGatewayOptions.runtimeInstanceId} is
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
 * Connect a Realtime Gateway session, then run the declared framework Bots
 * against it via {@link startChannelsWithGatewaySession}. This is the
 * composition that runs a managed channel over the realtime path. The returned
 * handle's `stop()` stops the Bots and then disconnects the session.
 */
export async function startChannelsOverRealtimeGateway(
  bots: Bot[],
  config: StartChannelsOverRealtimeGatewayOptions,
): Promise<ManagedBotsHandle> {
  const adapter = config.adapter ?? "slack";

  // Fail fast BEFORE opening the socket: a missing/duplicate name would
  // otherwise send a broken channel declaration and — because the same
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
    ...config.env,
    runtimeInstanceId: config.runtimeInstanceId,
  };
  const activation = buildActivationMetadata(
    bots,
    resolveActivationEnv(envOverrides),
  );

  const session = await connectRealtimeGateway({
    wsUrl: config.wsUrl,
    apiKey: config.apiKey,
    projectId: config.scope.projectId,
    join: {
      runtimeInstanceId: config.runtimeInstanceId,
      declaredChannels: activation.declaredBots.map((b) => ({
        channelName: b.name,
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
  // The session is now joined. If starting the Bots throws (e.g. a Bot was
  // already started, or a conflicting adapter), the caller never receives a
  // handle — so disconnect the socket here rather than leak it, then rethrow.
  let handle: ManagedBotsHandle;
  try {
    handle = await startChannelsWithGatewaySession(bots, {
      session,
      scope: config.scope,
      runtimeInstanceId: config.runtimeInstanceId,
      // The session-start helper re-merges the authoritative runtimeInstanceId,
      // so forward only the caller's overrides here (they cannot carry the id).
      ...(config.env ? { env: config.env } : {}),
      ...(config.log ? { log: config.log } : {}),
    });
  } catch (err) {
    session.disconnect();
    throw err;
  }
  return {
    ...handle,
    stop: async () => {
      // Always close the connection even if stopping the bots throws — the
      // launcher owns the socket (the transport is handed the session and does
      // not disconnect it itself).
      try {
        await handle.stop();
      } finally {
        session.disconnect();
      }
    },
  };
}
