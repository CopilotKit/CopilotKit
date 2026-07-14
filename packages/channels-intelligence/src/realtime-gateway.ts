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
}

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

  await new Promise<void>((resolve, reject) => {
    channel
      .join(timeout)
      .receive("ok", () => resolve())
      .receive("error", (reason: unknown) => {
        // The join failed, so the caller never gets a session it could
        // disconnect — tear the socket down here rather than leak it.
        socket.disconnect();
        reject(
          new Error(
            `realtime gateway session join failed: ${safeReason(reason)}`,
          ),
        );
      })
      .receive("timeout", () => {
        socket.disconnect();
        reject(new Error("realtime gateway session join timed out"));
      });
  });

  // Drop notification: Phoenix fires the socket's `onClose`/`onError` AND the
  // channel's `onError` for the same underlying drop (see `socket.js`'s
  // `onConnClose` → `triggerChanError`), so guard with a fired flag rather
  // than invoking every registered callback once per event. `disconnect()`
  // below flips `closingIntentionally` first, so our own teardown — which
  // also runs these same Phoenix close/error hooks — is never mistaken for an
  // unexpected drop.
  //
  // `closeFired` only dedupes the hooks *within* a single drop episode.
  // Phoenix's `Socket` auto-reconnects under the hood and this session
  // persists across that reconnect, so the latch is reset on `socket.onOpen`
  // — otherwise a second, later drop after a successful rejoin would never
  // notify again.
  let closingIntentionally = false;
  let closeFired = false;
  const closeCallbacks: Array<() => void> = [];
  const notifyClose = (): void => {
    if (closingIntentionally || closeFired) return;
    closeFired = true;
    for (const cb of closeCallbacks) {
      cb();
    }
  };
  socket.onOpen(() => {
    closeFired = false;
  });
  socket.onClose(() => notifyClose());
  socket.onError(() => notifyClose());
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
    disconnect: () => {
      closingIntentionally = true;
      socket.disconnect();
    },
  };
}

/** Render an unknown channel reply reason as a short string for errors. */
function safeReason(reason: unknown): string {
  if (typeof reason === "string") return reason;
  try {
    return JSON.stringify(reason);
  } catch {
    return "unknown";
  }
}
