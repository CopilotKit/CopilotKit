import { Socket } from "phoenix";

/**
 * Minimal Realtime Gateway session surface used by the delivery/render
 * transport. The connector adapts its private socket implementation to this
 * contract so callers never depend on a protocol client.
 */
export interface RealtimeGatewaySession {
  push(event: string, payload: unknown): Promise<unknown>;
  on(event: string, handler: (payload: unknown) => void): void;
}

/** @internal Options for {@link connectRealtimeGateway}. */
export interface ConnectRealtimeGatewayOptions {
  /** Gateway socket URL, e.g. `wss://gateway.example/socket`. */
  wsUrl: string;
  /** Runtime API key (`cpk-…`) authenticating the socket. */
  apiKey: string;
  /** Numeric project id — the session topic is `channels:project:{id}`. */
  projectId: number;
  /** Listener declaration sent as the channel join payload. */
  join: {
    runtimeInstanceId: string;
    declaredChannels: ReadonlyArray<{
      channelName: string;
      adapter: string;
      renderCapabilities?: readonly string[];
    }>;
    runtimeMetadata?: Record<string, unknown>;
    observedAt: string;
  };
  /** Per-push / join timeout in ms (default 10000). */
  timeoutMs?: number;
  /** WebSocket constructor; defaults to the global (Node 22+/browser). */
  webSocket?: unknown;
  /**
   * Max time (ms) the session may stay `reconnecting` after an unexpected drop
   * before it declares the connection dead and emits `gave_up` (default 60000).
   *
   * Phoenix's `Socket` retries a dropped connection FOREVER by default, so
   * `status()` on a supervising manager would otherwise report `reconnecting`
   * indefinitely for a gateway that never comes back (host down, credentials
   * revoked). This bounds that: if a successful (re)join does not restore the
   * session within this window, the session gives up and the manager can map it
   * to `error`. The window runs from the FIRST drop of an outage episode and is
   * cleared on the next successful (re)join.
   */
  reconnectGiveUpMs?: number;
}

/**
 * Connection-health states a {@link ConnectedRealtimeGatewaySession} surfaces to
 * a supervising manager via {@link ConnectedRealtimeGatewaySession.onStateChange}.
 *
 * - `online`: the managed path can currently send (joined/rejoined).
 * - `reconnecting`: the connection dropped and Phoenix is retrying; not sendable.
 * - `gave_up`: the reconnect window elapsed without a successful rejoin — treated
 *   as "currently not sendable, prolonged" (a supervising manager maps it to
 *   `error`). NOT terminal: Phoenix keeps its socket and auto-retries underneath,
 *   so a later successful rejoin transitions back to `online` and a fresh drop
 *   episode can transition back to `reconnecting`. The connection self-heals from
 *   a transient outage without a process restart.
 */
export type RealtimeGatewayConnectionState =
  | "online"
  | "reconnecting"
  | "gave_up";

/**
 * Signals that a join was rejected because the declared channel/provider is not
 * configured server-side — a setup-required condition, distinct from a generic
 * join failure. Carries `code === "SETUP_REQUIRED"` (the cross-package
 * convention a supervising `ChannelManager` detects to move a channel to
 * `setup_required` rather than `error`) and preserves the raw gateway
 * {@link RealtimeGatewaySetupRequiredError.reason}.
 *
 * A dedicated class is defined here rather than importing the runtime's
 * `ChannelSetupRequiredError` because this pure-ESM package must not take a
 * dependency on the CJS runtime package; the `code` convention keeps the two
 * decoupled.
 */
export class RealtimeGatewaySetupRequiredError extends Error {
  /** Cross-package setup-required marker read by `ChannelManager`. */
  readonly code = "SETUP_REQUIRED";
  /** The raw gateway join-error reason that classified this as setup-required. */
  readonly reason: string;
  /**
   * The non-live per-channel `state`s that classified this as setup-required
   * (e.g. `["adapter_setup_required"]`), preserved for diagnostics. Empty when
   * the gateway reported no per-channel detail. Contains no secrets.
   */
  readonly channelStates: readonly string[];
  /**
   * @param reason - The gateway's setup-required join reason.
   * @param channelStates - The offending non-live per-channel states, if any.
   */
  constructor(reason: string, channelStates: readonly string[] = []) {
    super(
      `realtime gateway session join requires setup: ${reason}` +
        (channelStates.length > 0
          ? ` (channel states: ${channelStates.join(", ")})`
          : ""),
    );
    this.name = "RealtimeGatewaySetupRequiredError";
    this.reason = reason;
    this.channelStates = channelStates;
  }
}

/**
 * Signals that a `channel_declaration_unavailable` join reject named at least
 * one declared channel in a HARD-error per-channel `state` (e.g.
 * `runtime_conflict`, `platform_setup_failed`) — a genuine failure the caller
 * must surface, NOT a setup-waiting condition. Deliberately does NOT carry the
 * `SETUP_REQUIRED` marker, so a supervising `ChannelManager` routes it to
 * `error` (rejecting `ready()`) rather than resolving to `setup_required`.
 */
export class RealtimeGatewayChannelStateError extends Error {
  /** The raw gateway join-error reason (`channel_declaration_unavailable`). */
  readonly reason: string;
  /**
   * The offending hard-error per-channel `state`s (e.g. `["runtime_conflict"]`),
   * preserved for diagnostics. Contains no secrets.
   */
  readonly channelStates: readonly string[];
  /**
   * @param reason - The gateway's join-error reason.
   * @param channelStates - The offending hard-error per-channel states.
   */
  constructor(reason: string, channelStates: readonly string[]) {
    super(
      `realtime gateway session join failed: ${reason} (channel states: ${channelStates.join(", ")})`,
    );
    this.name = "RealtimeGatewayChannelStateError";
    this.reason = reason;
    this.channelStates = channelStates;
  }
}

/**
 * Per-channel `state` values (from the gateway's `CHANNEL_STATE_KINDS`) that
 * mean a declared channel is genuinely unconfigured or waiting — a degraded
 * `setup_required` condition, not a hard failure. Any other non-`channel_live`
 * state (`runtime_conflict`, `platform_setup_failed`, `delivery_failed`,
 * `egress_failed`, `runtime_offline`, `runtime_not_declared`) is treated as a
 * hard error; see {@link classifyJoinError}.
 *
 * Verified against Intelligence `sdk_channel.ex` +
 * `libs/app-api-contracts/src/channels.ts`: the gateway rejects a join with
 * `{:error, %{"reason" => "channel_declaration_unavailable", "channels" =>
 * [%{"state" => <state>, ...}, ...]}}` whenever ANY declared channel's
 * `state != "channel_live"`, so the per-channel `state` — not the top-level
 * reason — is the real signal.
 */
const SETUP_REQUIRED_CHANNEL_STATES: ReadonlySet<string> = new Set([
  "no_channels_yet",
  "adapter_setup_required",
  "slack_setup_complete_waiting_for_runtime",
  "channel_setup_complete_waiting_for_runtime",
  "disabled_by_entitlement",
  "disabled_by_feature_flag",
]);

/**
 * TOP-LEVEL join-error reasons (distinct from the per-channel
 * `channel_declaration_unavailable` shape) that app-api may use to signal an
 * unconfigured provider. Modeled defensively for non-
 * `channel_declaration_unavailable` rejects; the canonical live-gateway signal
 * is the per-channel state classified via {@link SETUP_REQUIRED_CHANNEL_STATES}.
 */
const SETUP_REQUIRED_TOP_LEVEL_REASONS: ReadonlySet<string> = new Set([
  "adapter_setup_required",
  "not_configured",
]);

/** A connected {@link RealtimeGatewaySession} plus a shutdown operation. */
export interface ConnectedRealtimeGatewaySession extends RealtimeGatewaySession {
  disconnect(): void;
  /**
   * Register a callback to fire when the underlying Phoenix connection drops
   * unexpectedly (a real network/server-side disconnect), NOT when it drops as
   * a result of our own {@link disconnect}. Phoenix surfaces a drop through
   * both the socket's `onClose`/`onError` and the channel's `onClose`/`onError`
   * for the very same event, so the callback fires exactly once per drop
   * episode. Because Phoenix's `Socket` auto-reconnects and this session
   * persists across reconnects, the dedupe latch resets on a successful
   * reopen — so a later, distinct drop notifies again rather than being
   * silently absorbed by the first drop's latch.
   */
  onClose(cb: () => void): void;
  /**
   * Register a connection-health observer. The callback fires on each
   * transition between {@link RealtimeGatewayConnectionState} values (never with
   * the same state twice in a row):
   *
   * - an unexpected socket-level OR channel-level drop → `reconnecting` (Phoenix
   *   begins retrying). Phoenix can error/rejoin a Channel while the socket stays
   *   open (pushes still can't send), so both are routed through the same health
   *   transition, deduped so one drop episode = one `reconnecting` transition;
   * - a successful (re)join → `online` (the recHooks registered on the join push
   *   survive Phoenix's `resend`, so every auto-rejoin re-fires the `"ok"` hook);
   * - the {@link ConnectRealtimeGatewayOptions.reconnectGiveUpMs} window elapsing
   *   while still reconnecting → `gave_up`. NOT terminal — a later successful
   *   rejoin transitions back to `online` (a transient outage self-heals), and a
   *   fresh drop episode can transition back to `reconnecting`.
   *
   * Our own {@link disconnect} is silent (it is not a drop). Distinct from
   * {@link onClose}, which is a single per-episode drop breadcrumb; this observer
   * tracks the full health lifecycle so a manager's `status()` can reflect it.
   */
  onStateChange(cb: (state: RealtimeGatewayConnectionState) => void): void;
}

/**
 * @internal Connect the SDK to a Realtime Gateway session. Socket/client
 * values stay private here; callers receive only {@link RealtimeGatewaySession}.
 *
 * The session is joined (declaring the runtime's channels) before the promise
 * resolves, so the caller can immediately stream render frames.
 *
 * @param config - Gateway URL, auth, project scope, and join declaration.
 * @returns The connected channel with a `disconnect()` teardown.
 */
export async function connectRealtimeGateway(
  config: ConnectRealtimeGatewayOptions,
): Promise<ConnectedRealtimeGatewaySession> {
  if (!Number.isInteger(config.projectId) || config.projectId <= 0) {
    throw new Error(
      "connectRealtimeGateway: projectId must be a positive integer",
    );
  }
  const timeout = config.timeoutMs ?? 10_000;
  const giveUpMs = config.reconnectGiveUpMs ?? 60_000;
  const transport =
    config.webSocket ??
    (globalThis as unknown as { WebSocket?: unknown }).WebSocket;
  if (!transport) {
    throw new Error(
      "connectRealtimeGateway: no WebSocket available — pass config.webSocket or run on Node 22+",
    );
  }

  const socket = new Socket(config.wsUrl, {
    authToken: config.apiKey,
    transport: transport as ConstructorParameters<typeof Socket>[1] extends {
      transport?: infer T;
    }
      ? T
      : never,
  });
  socket.connect();

  const channel = socket.channel(
    `channels:project:${config.projectId}`,
    config.join as object,
  );

  // --- Connection-health state machine -------------------------------------
  // `disconnect()` flips `closingIntentionally` first so our own teardown —
  // which also runs these Phoenix close/error hooks — is never mistaken for an
  // unexpected drop. `gave_up` is NOT terminal: Phoenix keeps its socket and
  // auto-retries underneath, so a successful rejoin after give-up restores
  // `online` and a fresh drop episode restores `reconnecting` — state always
  // agrees with the transport rather than latching `error` forever.
  let closingIntentionally = false;
  let connectionState: RealtimeGatewayConnectionState = "online";
  const stateCallbacks: Array<(s: RealtimeGatewayConnectionState) => void> = [];
  let giveUpTimer: ReturnType<typeof setTimeout> | undefined;
  const clearGiveUpTimer = (): void => {
    if (giveUpTimer !== undefined) {
      clearTimeout(giveUpTimer);
      giveUpTimer = undefined;
    }
  };
  const emitState = (next: RealtimeGatewayConnectionState): void => {
    if (closingIntentionally || connectionState === next) {
      return;
    }
    connectionState = next;
    for (const cb of stateCallbacks) {
      try {
        cb(next);
      } catch {
        // Isolate observers: a throwing callback must not skip later ones or
        // propagate back into Phoenix's socket/join dispatch.
      }
    }
  };
  const enterReconnecting = (): void => {
    if (closingIntentionally) return;
    // Arm the give-up window on the FIRST drop of an outage episode; a later
    // drop while still reconnecting keeps the original deadline so a flapping
    // connection that never stabilizes still gives up after one bounded window.
    // After a `gave_up` the timer has already cleared itself, so a subsequent
    // drop episode re-arms a fresh window (give-up is recoverable, not sticky).
    if (giveUpTimer === undefined) {
      giveUpTimer = setTimeout(() => {
        giveUpTimer = undefined;
        emitState("gave_up");
      }, giveUpMs);
      (giveUpTimer as unknown as { unref?: () => void }).unref?.();
    }
    emitState("reconnecting");
  };
  const enterOnline = (): void => {
    clearGiveUpTimer();
    emitState("online");
  };

  // Capture the join push so both the initial join AND every Phoenix auto-rejoin
  // are observed: `Push.resend` (used by `channel.rejoin`) resets the received
  // response but PRESERVES `recHooks`, so the `"ok"`/`"error"`/`"timeout"` hooks
  // registered here re-fire on each rejoin reply. `initialJoinSettled` gates the
  // one-shot connect promise vs. the ongoing health transitions.
  let initialJoinSettled = false;
  const joinPush = channel.join(timeout);
  await new Promise<void>((resolve, reject) => {
    joinPush
      .receive("ok", () => {
        if (!initialJoinSettled) {
          initialJoinSettled = true;
          resolve();
        } else {
          // A Phoenix auto-rejoin succeeded — the managed path can send again.
          enterOnline();
        }
      })
      .receive("error", (reason: unknown) => {
        if (!initialJoinSettled) {
          initialJoinSettled = true;
          // The join failed, so the caller never gets a session it could
          // disconnect — tear the socket down here rather than leak it. Mark
          // the teardown intentional so it does not arm the give-up window.
          closingIntentionally = true;
          socket.disconnect();
          // Classify per-channel state (setup-waiting vs hard error) rather than
          // blanket-mapping the whole reject — a duplicate-listener conflict must
          // NOT be downgraded to `setup_required`.
          reject(classifyJoinError(reason));
        } else {
          // A rejoin failed (e.g. credentials revoked server-side). Phoenix
          // keeps retrying; surface reconnecting and let the window bound it.
          enterReconnecting();
        }
      })
      .receive("timeout", () => {
        if (!initialJoinSettled) {
          initialJoinSettled = true;
          closingIntentionally = true;
          socket.disconnect();
          reject(new Error("realtime gateway session join timed out"));
        } else {
          enterReconnecting();
        }
      });
  });

  // Drop notification: Phoenix fires the socket's `onClose`/`onError` AND the
  // channel's `onError` for the same underlying drop (see `socket.js`'s
  // `onConnClose` → `triggerChanError`), so guard with a fired flag rather
  // than invoking every registered callback once per event.
  //
  // `closeFired` only dedupes the hooks *within* a single drop episode.
  // Phoenix's `Socket` auto-reconnects under the hood and this session
  // persists across that reconnect, so the latch is reset on `socket.onOpen`
  // — otherwise a second, later drop after a successful rejoin would never
  // notify again.
  let closeFired = false;
  const closeCallbacks: Array<() => void> = [];
  const notifyClose = (): void => {
    if (closingIntentionally || closeFired) return;
    closeFired = true;
    for (const cb of closeCallbacks) {
      try {
        cb();
      } catch {
        // Fire-and-forget notification path invoked from inside Phoenix's
        // socket/channel close/error dispatch — a throwing callback must not
        // skip later callbacks or propagate back into Phoenix's dispatch.
      }
    }
  };
  socket.onOpen(() => {
    closeFired = false;
  });
  // A socket-level drop begins a reconnect episode; the "back online" signal
  // comes from a successful (re)join (the join-push `"ok"` hook above), NOT from
  // the socket merely reopening — the channel may still be rejoining.
  socket.onClose(() => {
    notifyClose();
    enterReconnecting();
  });
  socket.onError(() => {
    notifyClose();
    enterReconnecting();
  });
  // A CHANNEL-level close/error is ALSO non-sendable: Phoenix can error and
  // rejoin a channel while the socket stays open (so the socket handlers above
  // never fire), yet pushes can't send in the meantime. Route it through the
  // same health transition. `enterReconnecting`/`emitState` dedupe naturally, so
  // when a socket drop co-fires the socket AND channel hooks it is still one
  // `reconnecting` transition; a channel-only drop is now covered too.
  channel.onClose(() => {
    notifyClose();
    enterReconnecting();
  });
  channel.onError(() => {
    notifyClose();
    enterReconnecting();
  });

  return {
    push: (event, payload) =>
      new Promise((resolve, reject) => {
        channel
          .push(event, payload as object, timeout)
          .receive("ok", (reply: unknown) => resolve(reply))
          .receive("error", (reason: unknown) =>
            reject(
              new Error(
                `realtime gateway session push ${event} failed: ${safeReason(reason)}`,
              ),
            ),
          )
          .receive("timeout", () =>
            reject(
              new Error(`realtime gateway session push ${event} timed out`),
            ),
          );
      }),
    on: (event, handler) => {
      channel.on(event, handler);
    },
    onClose: (cb) => {
      closeCallbacks.push(cb);
    },
    onStateChange: (cb) => {
      stateCallbacks.push(cb);
    },
    disconnect: () => {
      closingIntentionally = true;
      clearGiveUpTimer();
      socket.disconnect();
    },
  };
}

/**
 * Classify a Phoenix join-error reject into the error the caller should see.
 *
 * The live gateway rejects with `{ reason: "channel_declaration_unavailable",
 * channels: [{ state, … }, …] }` whenever ANY declared channel's
 * `state != "channel_live"`, so the per-channel `state` is the real signal —
 * NOT the top-level reason. Blanket-mapping the whole reject to
 * `setup_required` (the previous behavior) hid genuine failures such as a
 * duplicate-listener `runtime_conflict`.
 *
 * Classification for `channel_declaration_unavailable`:
 * - Setup-waiting (→ {@link RealtimeGatewaySetupRequiredError}) ONLY when every
 *   non-live channel is in {@link SETUP_REQUIRED_CHANNEL_STATES}.
 * - Hard error (→ {@link RealtimeGatewayChannelStateError}) if ANY non-live
 *   channel is in a hard-error state (`runtime_conflict`, `platform_setup_failed`,
 *   `delivery_failed`, `egress_failed`, `runtime_offline`, `runtime_not_declared`)
 *   — fail loud on the worst even if other channels are merely waiting.
 *
 * `runtime_not_declared` is treated as a HARD error here: during our own join
 * the runtime IS declaring itself, so the gateway reporting the channel as
 * runtime-not-declared is a server/runtime disagreement, not user setup. TODO
 * (gateway-owner): confirm this is never a benign join-vs-heartbeat race; if it
 * is, add it to {@link SETUP_REQUIRED_CHANNEL_STATES} and document why.
 *
 * When a `channel_declaration_unavailable` reject carries no parseable
 * per-channel detail, we degrade to `setup_required` (the conservative
 * "waiting" reading, matching prior behavior) rather than fail loud on absent
 * diagnostics.
 *
 * Non-`channel_declaration_unavailable` rejects fall back to the defensive
 * top-level {@link SETUP_REQUIRED_TOP_LEVEL_REASONS} set, else a generic error.
 */
function classifyJoinError(reason: unknown): Error {
  const reasonCode = extractReasonCode(reason);
  if (reasonCode === "channel_declaration_unavailable") {
    const nonLive = extractNonLiveChannelStates(reason);
    const hardErrorStates = nonLive.filter(
      (state) => !SETUP_REQUIRED_CHANNEL_STATES.has(state),
    );
    if (hardErrorStates.length > 0) {
      return new RealtimeGatewayChannelStateError(reasonCode, hardErrorStates);
    }
    return new RealtimeGatewaySetupRequiredError(reasonCode, nonLive);
  }
  if (
    reasonCode !== undefined &&
    SETUP_REQUIRED_TOP_LEVEL_REASONS.has(reasonCode)
  ) {
    return new RealtimeGatewaySetupRequiredError(reasonCode);
  }
  return new Error(
    `realtime gateway session join failed: ${safeReason(reason)}`,
  );
}

/**
 * Extract the non-`channel_live` per-channel `state`s from a join-error reject
 * payload (`{ channels: [{ state, … }, …] }`). Non-string / missing states and
 * a missing `channels` array yield an empty list (handled defensively by
 * {@link classifyJoinError}).
 */
function extractNonLiveChannelStates(reason: unknown): string[] {
  if (typeof reason !== "object" || reason === null) return [];
  const channels = (reason as { channels?: unknown }).channels;
  if (!Array.isArray(channels)) return [];
  return channels
    .map((entry) =>
      typeof entry === "object" && entry !== null
        ? (entry as { state?: unknown }).state
        : undefined,
    )
    .filter(
      (state): state is string =>
        typeof state === "string" && state !== "channel_live",
    );
}

/**
 * Extract the string reason code from a Phoenix join-error payload. The gateway
 * replies with `{ reason: "<code>" }` (surfaced as the `.receive("error", …)`
 * argument), but a bare string reason is tolerated defensively.
 */
function extractReasonCode(reason: unknown): string | undefined {
  if (typeof reason === "string") return reason;
  if (typeof reason === "object" && reason !== null) {
    const inner = (reason as { reason?: unknown }).reason;
    if (typeof inner === "string") return inner;
  }
  return undefined;
}

/** Render an unknown channel reply reason as a short string for errors. */
function safeReason(reason: unknown): string {
  if (typeof reason === "string") return reason;
  try {
    // `JSON.stringify` returns the *value* `undefined` (not the string
    // "undefined") for `undefined`, functions, and symbols, so guard against
    // that here — this function must never return anything but a string.
    const serialized = JSON.stringify(reason);
    return serialized ?? "unknown";
  } catch {
    return "unknown";
  }
}
