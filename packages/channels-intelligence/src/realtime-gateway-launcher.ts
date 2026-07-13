import type { Channel } from "@copilotkit/channels-core";
import {
  startChannels,
  assertValidChannelNames,
  buildChannelActivationMetadata,
  resolveChannelActivationEnv,
} from "./runtime.js";
import type { ChannelsHandle, ChannelActivationEnv } from "./runtime.js";
import { connectRealtimeGateway } from "./realtime-gateway.js";
import {
  RealtimeGatewayTransport,
  assertValidChannelRealtimeScope,
} from "./realtime-gateway-transport.js";
import type { ChannelRealtimeScope } from "./realtime-gateway-transport.js";
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
 * Phase 1 runs exactly one framework {@link Channel} per gateway session.
 * {@link RealtimeGatewayTransport} is a single-delivery-callback object bound
 * to one session; attaching more than one Channel's `intelligenceAdapter` to the
 * same transport would make every delivery dispatch through the last Channel's
 * callback (and earlier Channels receive
 * nothing). Multi-Channel routing over a shared session is not implemented yet —
 * until then, run one Channel per gateway session/runner and fail loudly on more.
 */
function assertSingleChannelForPhase1(channels: readonly Channel[]): void {
  if (channels.length !== 1) {
    throw new Error(
      `Channel Realtime Gateway runtime supports exactly one Channel per gateway session, got ${channels.length} — ` +
        "multi-Channel routing over a shared RealtimeGatewayTransport is not implemented yet (OSS-459); " +
        "run one Channel per gateway session/runner",
    );
  }
}

function assertScopeMatchesChannel(
  channels: readonly Channel[],
  scope: ChannelRealtimeScope,
): void {
  assertValidChannelRealtimeScope(scope);
  assertValidChannelNames(channels);
  assertSingleChannelForPhase1(channels);
  if (channels[0]!.name !== scope.channelName) {
    throw new Error(
      `Channel Realtime Gateway scope channelName ${JSON.stringify(scope.channelName)} must match Channel name ${JSON.stringify(channels[0]!.name)}`,
    );
  }
}

/** Options for {@link startChannelsWithGatewaySession}. */
export interface StartChannelsWithGatewaySessionOptions {
  /** The joined Realtime Gateway session. */
  session: RealtimeGatewaySession;
  /** Authoritative org/project/channel scope echoed on every SDK→gateway envelope. */
  scope: ChannelRealtimeScope;
  /** Stable runtime instance id (`rti_…`), echoed on every envelope. */
  runtimeInstanceId: string;
  /** Activation env overrides forwarded to the runtime (so `handle.metadata`
   * matches what the caller declared on join); omitted fields are gathered from
   * the process. `runtimeInstanceId` is excluded — the required
   * {@link StartChannelsWithGatewaySessionOptions.runtimeInstanceId} above is authoritative
   * and is merged in, so the transport (which stamps it on every envelope) and
   * `handle.metadata` always report the same id. */
  env?: Partial<Omit<ChannelActivationEnv, "runtimeInstanceId">>;
  /** Diagnostic sink for dropped deliveries / transport events. */
  log?: (message: string, meta?: unknown) => void;
}

/**
 * Compose the Channel runtime over an already-connected gateway session: wrap
 * the session in a {@link RealtimeGatewayTransport} (delivery source + render
 * sink) and start the declared Channels against it via {@link startChannels}.
 *
 * Split out from {@link startChannelsOverRealtimeGateway} so the composition —
 * the part with behavior — is unit-testable against a fake session, leaving the
 * connector as thin glue. `intelligenceAdapter` is exclusive, so the gateway
 * transport is each Channel's ONLY adapter; egress is served by the render sink,
 * not the generic {@link EgressSink} (see {@link realtimeGatewayEgress}).
 */
export async function startChannelsWithGatewaySession(
  channels: Channel[],
  opts: StartChannelsWithGatewaySessionOptions,
): Promise<ChannelsHandle> {
  assertScopeMatchesChannel(channels, opts.scope);
  const transport = new RealtimeGatewayTransport({
    scope: opts.scope,
    runtimeInstanceId: opts.runtimeInstanceId,
    session: opts.session,
    ...(opts.log ? { log: opts.log } : {}),
  });
  const handle = await startChannels({
    channels,
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
  // This variant does not own the socket (the caller passed an
  // already-joined session), so it neither connects nor disconnects it. Still
  // pass through drop notification when the session supports it (it does not
  // own teardown either way — the caller's session decides when `onClose`
  // fires), so callers composing over a session they manage themselves still
  // get reconnect signaling.
  const observableSession = opts.session as Partial<{
    onClose(cb: () => void): void;
    onStateChange(
      cb: (state: "online" | "reconnecting" | "gave_up") => void,
    ): void;
  }>;
  // Call the seams ON the session (not via detached references) so a
  // class-based RealtimeGatewaySession whose `onClose`/`onStateChange` read
  // `this` still works — the interface permits class-based implementations even
  // though the concrete closure-based session happens not to need `this`.
  if (observableSession.onClose || observableSession.onStateChange) {
    return {
      ...handle,
      ...(observableSession.onClose
        ? { onClose: (cb: () => void) => observableSession.onClose!(cb) }
        : {}),
      ...(observableSession.onStateChange
        ? {
            onStateChange: (
              cb: (state: "online" | "reconnecting" | "gave_up") => void,
            ) => observableSession.onStateChange!(cb),
          }
        : {}),
    };
  }
  return handle;
}

/** Config for {@link startChannelsOverRealtimeGateway}. */
export interface StartChannelsOverRealtimeGatewayOptions {
  /** Gateway runner WebSocket URL — the `/runner` endpoint hosting the
   * `channels:project:<id>` session. */
  wsUrl: string;
  /** Project runtime API key (`cpk-…`), presented as the socket `authToken`. */
  apiKey: string;
  /** Authoritative org/project/channel scope echoed on every SDK→gateway envelope. */
  scope: ChannelRealtimeScope;
  /** Stable runtime instance id (`rti_…`). */
  runtimeInstanceId: string;
  /** Adapter kind declared to the gateway on join (default `"slack"`). */
  adapter?: string;
  /** Activation env overrides (package versions, runtimeEnv); omitted fields
   * are gathered from the process. Included in the join's `runtimeMetadata` and
   * in `handle.metadata`. `runtimeInstanceId` is intentionally excluded — the
   * required top-level {@link StartChannelsOverRealtimeGatewayOptions.runtimeInstanceId} is
   * authoritative for both the join and `handle.metadata` (they must agree). */
  env?: Partial<Omit<ChannelActivationEnv, "runtimeInstanceId">>;
  /** Join timeout in ms. */
  timeoutMs?: number;
  /** Injectable `WebSocket` ctor (non-global hosts / tests). */
  webSocket?: unknown;
  /** Diagnostic sink for dropped deliveries / transport events. */
  log?: (message: string, meta?: unknown) => void;
}

/**
 * Connect a Realtime Gateway session, then run the declared framework Channels
 * against it via {@link startChannelsWithGatewaySession}. This is the
 * composition that runs a Channel over the realtime path. The returned
 * handle's `stop()` stops the Channels and then disconnects the session.
 */
export async function startChannelsOverRealtimeGateway(
  channels: Channel[],
  config: StartChannelsOverRealtimeGatewayOptions,
): Promise<ChannelsHandle> {
  const adapter = config.adapter ?? "slack";

  // Fail fast BEFORE opening the socket: a missing/duplicate name would
  // otherwise send a broken channel declaration and — because the same
  // check inside startChannels runs only after we've connected — throw with
  // the socket already open and never closed (a leak). Validating here means a
  // bad declaration never opens a connection at all.
  assertScopeMatchesChannel(channels, config.scope);

  // Build activation metadata up front so the join carries the Runtime
  // Activation data Intelligence's health view expects (runtime env, node
  // version, per-channel commands) rather than just name+adapter. The same
  // `envOverrides` is forwarded to startChannels so `handle.metadata` agrees
  // with what we declared on join. The required `config.runtimeInstanceId` is
  // spread LAST so it stays authoritative even though `config.env` cannot carry
  // it (type-excluded) — belt and suspenders for the join↔metadata invariant.
  const envOverrides: Partial<ChannelActivationEnv> = {
    ...config.env,
    runtimeInstanceId: config.runtimeInstanceId,
  };
  const activation = buildChannelActivationMetadata(
    channels,
    resolveChannelActivationEnv(envOverrides),
  );

  const session = await connectRealtimeGateway({
    wsUrl: config.wsUrl,
    apiKey: config.apiKey,
    projectId: config.scope.projectId,
    join: {
      runtimeInstanceId: config.runtimeInstanceId,
      declaredChannels: activation.declaredChannels.map((channel) => ({
        channelName: channel.channelName,
        adapter,
        // renderCapabilities: reserved — channels don't expose capabilities yet
        // (tracked with the richer per-channel metadata in OSS-377).
      })),
      runtimeMetadata: {
        runtimeEnv: activation.runtimeEnv,
        ...(activation.nodeVersion
          ? { nodeVersion: activation.nodeVersion }
          : {}),
        ...(activation.runtimePackageVersion
          ? { runtimePackageVersion: activation.runtimePackageVersion }
          : {}),
        ...(activation.channelsPackageVersion
          ? { channelsPackageVersion: activation.channelsPackageVersion }
          : {}),
        commands: Object.fromEntries(
          activation.declaredChannels.map((channel) => [
            channel.channelName,
            channel.commands,
          ]),
        ),
      },
      observedAt: new Date().toISOString(),
    },
    ...(config.timeoutMs !== undefined ? { timeoutMs: config.timeoutMs } : {}),
    ...(config.webSocket !== undefined ? { webSocket: config.webSocket } : {}),
  });
  // The session is now joined. If starting the Channels throws (e.g. a Channel
  // was already started, or a conflicting adapter), the caller never receives a
  // handle — so disconnect the socket here rather than leak it, then rethrow.
  let handle: ChannelsHandle;
  try {
    handle = await startChannelsWithGatewaySession(channels, {
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
    // Delegate explicitly to the launcher's own `session` (rather than relying
    // on the seams passed through from `startChannelsWithGatewaySession` above)
    // so they stay correct even if that helper's internals change.
    onClose: (cb: () => void) => session.onClose(cb),
    onStateChange: (
      cb: (state: "online" | "reconnecting" | "gave_up") => void,
    ) => session.onStateChange(cb),
    stop: async () => {
      // Always close the connection even if stopping the channels throws — the
      // launcher owns the socket (the transport is handed the session and does
      // not disconnect it itself). `session.disconnect()` marks the drop
      // intentional internally, so this teardown never fires `onClose`.
      try {
        await handle.stop();
      } finally {
        session.disconnect();
      }
    },
  };
}
