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
 * - `gave_up`: the reconnect window elapsed without a successful rejoin — the
 *   connection is treated as dead. Terminal: no further transitions are emitted.
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
  /** @param reason - The gateway's setup-required join reason. */
  constructor(reason: string) {
    super(`realtime gateway session join requires setup: ${reason}`);
    this.name = "RealtimeGatewaySetupRequiredError";
    this.reason = reason;
  }
}

/**
 * Gateway join-error reasons that mean "the declared channel/provider is not
 * configured server-side" rather than a hard failure. The canonical signal is
 * `channel_declaration_unavailable` (Intelligence gateway `sdk_channel.ex`
 * `validate_heartbeat_response` → `{:error, %{"reason" =>
 * "channel_declaration_unavailable", ...}}`). `adapter_setup_required` and
 * `not_configured` are modeled defensively (app-api uses those shapes); the
 * exact string set should be coordinated with the gateway owner.
 */
const SETUP_REQUIRED_JOIN_REASONS: ReadonlySet<string> = new Set([
  "channel_declaration_unavailable",
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
   * - an unexpected socket drop → `reconnecting` (Phoenix begins retrying);
   * - a successful (re)join → `online` (the recHooks registered on the join push
   *   survive Phoenix's `resend`, so every auto-rejoin re-fires the `"ok"` hook);
   * - the {@link ConnectRealtimeGatewayOptions.reconnectGiveUpMs} window elapsing
   *   while still reconnecting → `gave_up` (terminal).
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
  // unexpected drop. `gave_up` is terminal: once declared dead, no further
  // transition is emitted.
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
    if (
      closingIntentionally ||
      connectionState === "gave_up" ||
      connectionState === next
    ) {
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
    if (closingIntentionally || connectionState === "gave_up") return;
    // Arm the give-up window on the FIRST drop of an outage episode; a later
    // drop while still reconnecting keeps the original deadline so a flapping
    // connection that never stabilizes still gives up after one bounded window.
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
          const reasonCode = extractReasonCode(reason);
          if (
            reasonCode !== undefined &&
            SETUP_REQUIRED_JOIN_REASONS.has(reasonCode)
          ) {
            // Distinguishable setup-required signal: an unconfigured managed
            // provider must degrade to `setup_required`, not `error`.
            reject(new RealtimeGatewaySetupRequiredError(reasonCode));
          } else {
            reject(
              new Error(
                `realtime gateway session join failed: ${safeReason(reason)}`,
              ),
            );
          }
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
  channel.onClose(() => notifyClose());
  channel.onError(() => notifyClose());

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
