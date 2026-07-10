import { Socket } from "phoenix";
import type { HostedBotChannel } from "./phoenix-transport.js";

/**
 * @internal Config for {@link connectPhoenixHostedBotChannel} — the live
 * realtime-gateway connection behind {@link PhoenixRealtimeTransport}.
 */
export interface PhoenixConnectConfig {
  /** Gateway socket URL, e.g. `wss://gateway.example/socket`. */
  wsUrl: string;
  /** Runtime API key (`cpk-…`) authenticating the socket. */
  apiKey: string;
  /** Numeric project id — the channel topic is `hosted_bots:project:{id}`. */
  projectId: number;
  /** Listener declaration sent as the channel join payload. */
  join: {
    runtimeInstanceId: string;
    declaredBots: ReadonlyArray<{
      botName: string;
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

/** A connected {@link HostedBotChannel} plus a `disconnect()` for shutdown. */
export interface ConnectedHostedBotChannel extends HostedBotChannel {
  disconnect(): void;
}

/**
 * @internal Connect the SDK to the realtime-gateway hosted-bot IO channel and
 * adapt the Phoenix `Channel` to the minimal {@link HostedBotChannel} contract
 * {@link PhoenixRealtimeTransport} consumes: `push` resolves with the server's
 * "ok" reply (rejects on "error"/"timeout"); `on` subscribes to a pushed event.
 *
 * The channel is joined (declaring the runtime's bots) before the promise
 * resolves, so the caller can immediately stream render frames.
 *
 * @param config - Gateway URL, auth, project scope, and join declaration.
 * @returns The connected channel with a `disconnect()` teardown.
 */
export async function connectPhoenixHostedBotChannel(
  config: PhoenixConnectConfig,
): Promise<ConnectedHostedBotChannel> {
  const timeout = config.timeoutMs ?? 10_000;
  const transport =
    config.webSocket ??
    (globalThis as unknown as { WebSocket?: unknown }).WebSocket;
  if (!transport) {
    throw new Error(
      "connectPhoenixHostedBotChannel: no WebSocket available — pass config.webSocket or run on Node 22+",
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
    `hosted_bots:project:${config.projectId}`,
    config.join as object,
  );

  await new Promise<void>((resolve, reject) => {
    channel
      .join(timeout)
      .receive("ok", () => resolve())
      .receive("error", (reason: unknown) =>
        reject(
          new Error(`hosted-bot channel join failed: ${safeReason(reason)}`),
        ),
      )
      .receive("timeout", () =>
        reject(new Error("hosted-bot channel join timed out")),
      );
  });

  return {
    push: (event, payload) =>
      new Promise((resolve, reject) => {
        channel
          .push(event, payload as object, timeout)
          .receive("ok", (reply: unknown) => resolve(reply))
          .receive("error", (reason: unknown) =>
            reject(new Error(`push ${event} failed: ${safeReason(reason)}`)),
          )
          .receive("timeout", () =>
            reject(new Error(`push ${event} timed out`)),
          );
      }),
    on: (event, handler) => {
      channel.on(event, handler);
    },
    disconnect: () => socket.disconnect(),
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
