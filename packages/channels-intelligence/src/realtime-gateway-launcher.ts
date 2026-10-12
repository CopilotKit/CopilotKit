import type {
  Channel,
  ReplyContinuationOptions,
} from "@copilotkit/channels-core";
import type { Message } from "@ag-ui/client";
import {
  assertValidChannelNames,
  buildChannelActivationMetadata,
  resolveChannelActivationEnv,
} from "./runtime.js";
import type { ChannelsHandle, ChannelActivationEnv } from "./runtime.js";
import { connectRealtimeGateway } from "./realtime-gateway.js";
import type { RealtimeGatewaySession } from "./realtime-gateway.js";
import { CHANNEL_DELIVERY_PROTOCOL } from "./delivery-contracts.js";
import { ChannelDeliveryTransport } from "./delivery-transport.js";
import { DeliveryAdapter } from "./delivery-adapter.js";
import type { CanonicalChannelRunArgs } from "./delivery-adapter.js";
import { IntelligenceStateStore } from "./intelligence-state-store.js";

/** Project and declared Channel used for the Gateway join. */
export interface ChannelRealtimeScope {
  projectId: number;
  channelName: string;
}

const CHANNEL_NAME_RE = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

/** Validate the project-scoped delivery control join before opening a socket. */
export function assertValidChannelRealtimeScope(
  scope: ChannelRealtimeScope,
): void {
  if (!Number.isSafeInteger(scope.projectId) || scope.projectId <= 0) {
    throw new Error(
      "Realtime Gateway Channel scope requires a positive projectId",
    );
  }
  if (
    scope.channelName.length < 3 ||
    scope.channelName.length > 64 ||
    !CHANNEL_NAME_RE.test(scope.channelName)
  ) {
    throw new Error(
      `Realtime Gateway Channel scope requires a lowercase kebab-case channelName, got ${JSON.stringify(scope.channelName)}`,
    );
  }
}

/**
 * Phase 1 runs exactly one framework {@link Channel} per gateway control link.
 */
function assertSingleChannelForPhase1(channels: readonly Channel[]): void {
  if (channels.length !== 1) {
    throw new Error(
      `Channel Realtime Gateway runtime supports exactly one Channel per gateway session, got ${channels.length} — ` +
        "multi-Channel routing over one control link is not implemented; " +
        "run one Channel per control link",
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

/** Options for {@link startChannelsWithGatewayControl}. */
export interface StartChannelsWithGatewayControlOptions {
  /** The joined Realtime Gateway control link. */
  session: RealtimeGatewaySession;
  /** Authoritative org/project/channel scope echoed on every SDK→gateway envelope. */
  scope: ChannelRealtimeScope;
  /**
   * One Channel activation id (`rti_…`), echoed on every packet.
   * Unique across concurrent replicas, stable across reconnects for this
   * activation, and re-minted on process/ChannelManager restart.
   */
  runtimeInstanceId: string;
  /** Maximum deliveries this Runtime may claim and execute at once. */
  maxConcurrentDeliveries?: number;
  /** Maximum claimed deliveries buffered behind active execution. */
  maxPendingDeliveries?: number;
  /** Intelligence app-api HTTP base URL — enables file/history parity on the
   * realtime path (OSS-476), which are HTTP-only. With {@link apiKey}. */
  appApiBaseUrl?: string;
  /** Project runtime API key (`cpk-…`) for the app-api file/history calls. */
  apiKey?: string;
  /** Injectable App API fetch used by managed file and transcript calls. */
  appApiFetch?: typeof fetch;
  /** Activation env overrides forwarded to the runtime (so `handle.metadata`
   * matches what the caller declared on join); omitted fields are gathered from
   * the process. `runtimeInstanceId` is excluded — the required
   * {@link StartChannelsWithGatewayControlOptions.runtimeInstanceId} above is authoritative
   * and is merged in, so the transport (which stamps it on every envelope) and
   * `handle.metadata` always report the same id. */
  env?: Partial<Omit<ChannelActivationEnv, "runtimeInstanceId">>;
  /** Diagnostic sink for dropped deliveries / transport events. */
  log?: (message: string, meta?: unknown) => void;
  /** Override managed provider tool-call visibility; omission is forwarded. */
  showToolStatus?: boolean;
  /** Continuation-message tuning forwarded to the Slack renderer. */
  replyContinuation?: ReplyContinuationOptions;
  /** Execute one outer Channel run through the runtime's standard runner. */
  runCanonical(
    args: CanonicalChannelRunArgs,
  ): ReturnType<CanonicalChannelRunArgs["execute"]>;
  /** Load canonical Intelligence thread history before each public run. */
  loadHistory(args: {
    deliveryId: string;
    threadId: string;
    appUserId: string;
  }): Promise<Message[]>;
}

/**
 * Compose the Channel runtime over an already-connected gateway control link.
 *
 * Split out from {@link startChannelsOverRealtimeGateway} so the composition —
 * the part with behavior — is unit-testable against a fake session, leaving the
 * connector as thin glue. The delivery adapter is the Channel's managed adapter.
 */
export async function startChannelsWithGatewayControl(
  channels: Channel[],
  opts: StartChannelsWithGatewayControlOptions,
): Promise<ChannelsHandle> {
  assertScopeMatchesChannel(channels, opts.scope);
  const transport = new ChannelDeliveryTransport({
    runtimeInstanceId: opts.runtimeInstanceId,
    session: opts.session,
    ...(opts.maxConcurrentDeliveries !== undefined
      ? { maxConcurrentDeliveries: opts.maxConcurrentDeliveries }
      : {}),
    ...(opts.maxPendingDeliveries !== undefined
      ? { maxPendingDeliveries: opts.maxPendingDeliveries }
      : {}),
    ...(opts.appApiBaseUrl ? { appApiBaseUrl: opts.appApiBaseUrl } : {}),
    ...(opts.apiKey ? { apiKey: opts.apiKey } : {}),
    ...(opts.appApiFetch ? { fileFetch: opts.appApiFetch } : {}),
    ...(opts.log ? { log: opts.log } : {}),
  });
  const store =
    opts.appApiBaseUrl && opts.apiKey
      ? new IntelligenceStateStore({
          baseUrl: opts.appApiBaseUrl,
          apiKey: opts.apiKey,
        })
      : undefined;
  const channel = channels[0]!;
  channel.ɵruntime.addAdapter(
    new DeliveryAdapter({
      channelName: opts.scope.channelName,
      transport,
      runCanonical: opts.runCanonical,
      loadHistory: opts.loadHistory,
      ...(store ? { store } : {}),
      ...(opts.log ? { log: opts.log } : {}),
      showToolStatus: opts.showToolStatus ?? channel.showToolStatus,
      replyContinuation: opts.replyContinuation ?? channel.replyContinuation,
    }),
  );
  await channel.ɵruntime.start();
  const metadata = buildChannelActivationMetadata(
    channels,
    resolveChannelActivationEnv({
      ...opts.env,
      runtimeInstanceId: opts.runtimeInstanceId,
    }),
  );
  const handle: ChannelsHandle = {
    metadata,
    stop: () => channel.ɵruntime.stop(),
  };
  // This variant does not own the socket (the caller passed an
  // already-joined session), so it neither connects nor disconnects it. Still
  // pass through drop notification when the session supports it (it does not
  // own teardown either way — the caller's session decides when `onClose`
  // fires), so callers composing over a session they manage themselves still
  // get reconnect signaling.
  //
  // `providerStates` is forwarded for the same reason and MUST NOT be omitted:
  // this helper is exported precisely so callers can compose over a session they
  // manage themselves, and a handle without the provider seam makes
  // `ChannelManager.providerLeg` fall back to `unknown` — which keeps the
  // transport-derived status and so reports `online` for a Channel with no
  // provider bound. That is exactly the false green OSS-739 exists to remove.
  const observableSession = opts.session as Partial<{
    onClose(cb: () => void): void;
    onStateChange(
      cb: (
        state: "online" | "reconnecting" | "gave_up",
        detail?: { reason?: string; code?: string },
      ) => void,
    ): void;
    providerStates(): Readonly<Record<string, string>> | undefined;
  }>;
  // Call the seams ON the session (not via detached references) so a
  // class-based RealtimeGatewaySession whose `onClose`/`onStateChange`/
  // `providerStates` read `this` still works — the interface permits class-based
  // implementations even though the concrete closure-based session happens not to
  // need `this`.
  if (
    observableSession.onClose ||
    observableSession.onStateChange ||
    observableSession.providerStates
  ) {
    return {
      ...handle,
      ...(observableSession.onClose
        ? { onClose: (cb: () => void) => observableSession.onClose!(cb) }
        : {}),
      ...(observableSession.onStateChange
        ? {
            onStateChange: (
              cb: (
                state: "online" | "reconnecting" | "gave_up",
                detail?: { reason?: string; code?: string },
              ) => void,
            ) => observableSession.onStateChange!(cb),
          }
        : {}),
      // Delegated as a getter, not a captured snapshot: the control join hooks
      // re-fire on every Phoenix auto-rejoin, so a Channel provisioned while the
      // runtime was disconnected is reflected on the next read.
      ...(observableSession.providerStates
        ? { providerStates: () => observableSession.providerStates!() }
        : {}),
    };
  }
  return handle;
}

/** Config for {@link startChannelsOverRealtimeGateway}. */
export interface StartChannelsOverRealtimeGatewayOptions {
  /** Gateway Channels WebSocket URL at the dedicated `/channels` endpoint. */
  wsUrl: string;
  /** Project runtime API key (`cpk-…`), presented as the socket `authToken`. */
  apiKey: string;
  /** Authoritative org/project/channel scope echoed on every SDK→gateway envelope. */
  scope: ChannelRealtimeScope;
  /**
   * One Channel activation id (`rti_…`). Must be unique across concurrent
   * replicas; reuse it only for transport reconnects of this activation.
   */
  runtimeInstanceId: string;
  /** Maximum deliveries this Runtime may claim and execute at once. */
  maxConcurrentDeliveries?: number;
  /** Maximum claimed deliveries buffered behind active execution. */
  maxPendingDeliveries?: number;
  /** Intelligence app-api HTTP base URL for managed file and Thread history
   * calls made with the {@link apiKey} above. Omit it to leave those calls
   * unavailable. */
  appApiBaseUrl?: string;
  /** Activation env overrides (package versions, runtimeEnv); omitted fields
   * are gathered from the process and exposed in `handle.metadata`.
   * `runtimeInstanceId` is intentionally excluded — the
   * required top-level {@link StartChannelsOverRealtimeGatewayOptions.runtimeInstanceId} is
   * authoritative for both the join and `handle.metadata` (they must agree). */
  env?: Partial<Omit<ChannelActivationEnv, "runtimeInstanceId">>;
  /** Join timeout in ms. */
  timeoutMs?: number;
  /** Initial-connect window in ms (default 30000). When the socket never opens
   * within it, the connect rejects as unreachable instead of hanging on
   * Phoenix's forever-retry — see `ConnectRealtimeGatewayOptions.connectTimeoutMs`. */
  connectTimeoutMs?: number;
  /** Injectable `WebSocket` ctor (non-global hosts / tests). */
  webSocket?: unknown;
  /** Diagnostic sink for dropped deliveries / transport events. */
  log?: (message: string, meta?: unknown) => void;
  /** Override managed provider tool-call visibility; omission is forwarded. */
  showToolStatus?: boolean;
  /** Continuation-message tuning forwarded to the Slack renderer. */
  replyContinuation?: ReplyContinuationOptions;
  /** Execute one outer Channel run through the runtime's standard runner. */
  runCanonical(
    args: CanonicalChannelRunArgs,
  ): ReturnType<CanonicalChannelRunArgs["execute"]>;
  /** Load canonical Intelligence thread history before each public run. */
  loadHistory(args: {
    deliveryId: string;
    threadId: string;
    appUserId: string;
  }): Promise<Message[]>;
}

/**
 * Connect a Realtime Gateway session, then run the declared framework Channels
 * against it via {@link startChannelsWithGatewayControl}. This is the
 * composition that runs a Channel over the realtime path. The returned
 * handle's `stop()` stops the Channels and then disconnects the session.
 */
export async function startChannelsOverRealtimeGateway(
  channels: Channel[],
  config: StartChannelsOverRealtimeGatewayOptions,
): Promise<ChannelsHandle> {
  // Fail fast BEFORE opening the socket: a missing/duplicate name would
  // otherwise send a broken channel declaration and — because the same
  // check inside startChannels runs only after we've connected — throw with
  // the socket already open and never closed (a leak). Validating here means a
  // bad declaration never opens a connection at all.
  assertScopeMatchesChannel(channels, config.scope);

  // Build activation metadata once for the local handle and control declaration.
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
      protocol: CHANNEL_DELIVERY_PROTOCOL,
      runtimeInstanceId: config.runtimeInstanceId,
      ...(config.maxConcurrentDeliveries !== undefined
        ? { maxConcurrentDeliveries: config.maxConcurrentDeliveries }
        : {}),
      channels: activation.declaredChannels.flatMap((channel) => [
        { channelName: channel.channelName, adapter: "slack" },
        { channelName: channel.channelName, adapter: "teams" },
        { channelName: channel.channelName, adapter: "discord" },
      ]),
    },
    ...(config.timeoutMs !== undefined ? { timeoutMs: config.timeoutMs } : {}),
    ...(config.connectTimeoutMs !== undefined
      ? { connectTimeoutMs: config.connectTimeoutMs }
      : {}),
    ...(config.webSocket !== undefined ? { webSocket: config.webSocket } : {}),
  });
  // The session is now joined. If starting the Channels throws (e.g. a Channel
  // was already started, or a conflicting adapter), the caller never receives a
  // handle — so disconnect the socket here rather than leak it, then rethrow.
  let handle: ChannelsHandle;
  try {
    handle = await startChannelsWithGatewayControl(channels, {
      session,
      scope: config.scope,
      runtimeInstanceId: config.runtimeInstanceId,
      ...(config.maxConcurrentDeliveries !== undefined
        ? { maxConcurrentDeliveries: config.maxConcurrentDeliveries }
        : {}),
      ...(config.maxPendingDeliveries !== undefined
        ? { maxPendingDeliveries: config.maxPendingDeliveries }
        : {}),
      // File/history parity is HTTP-only; forward the app-api coordinates (the
      // apiKey is the same one used as the socket authToken) so the transport
      // can reach the file/history REST endpoints directly.
      ...(config.appApiBaseUrl ? { appApiBaseUrl: config.appApiBaseUrl } : {}),
      apiKey: config.apiKey,
      runCanonical: config.runCanonical,
      loadHistory: config.loadHistory,
      // The session-start helper re-merges the authoritative runtimeInstanceId,
      // so forward only the caller's overrides here (they cannot carry the id).
      ...(config.env ? { env: config.env } : {}),
      ...(config.log ? { log: config.log } : {}),
      showToolStatus: config.showToolStatus,
      replyContinuation: config.replyContinuation,
    });
  } catch (err) {
    session.disconnect();
    throw err;
  }
  return {
    ...handle,
    // Delegate explicitly to the launcher's own `session` (rather than relying
    // on the seams passed through from `startChannelsWithGatewayControl` above)
    // so they stay correct even if that helper's internals change.
    onClose: (cb: () => void) => session.onClose(cb),
    onStateChange: (
      cb: (
        state: "online" | "reconnecting" | "gave_up",
        detail?: { reason?: string; code?: string },
      ) => void,
    ) => session.onStateChange(cb),
    // Delegated as a getter, not a captured snapshot: the control join hooks
    // re-fire on every Phoenix auto-rejoin, so a Channel provisioned while the
    // runtime was disconnected is reflected on the next read.
    providerStates: () => session.providerStates(),
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
