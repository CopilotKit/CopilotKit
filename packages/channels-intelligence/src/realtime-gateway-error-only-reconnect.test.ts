import { expect, test, vi } from "vitest";
import { connectRealtimeGateway } from "./realtime-gateway.js";

interface ErrorOnlyReconnectSetup {
  disconnect(): void;
  dropInitialConnection(): void;
  isOnline(): boolean;
  socketCount(): number;
}

/** Make the first reconnect emit only `error`, then let the next one recover. */
async function setupErrorOnlyReconnect(): Promise<ErrorOnlyReconnectSetup> {
  const sockets: ErrorOnlyWebSocket[] = [];

  class ErrorOnlyWebSocket {
    static readonly CONNECTING = 0;
    static readonly OPEN = 1;
    static readonly CLOSING = 2;
    static readonly CLOSED = 3;
    readyState = ErrorOnlyWebSocket.CONNECTING;
    bufferedAmount = 0;
    binaryType = "arraybuffer";
    onopen: (() => void) | null = null;
    onmessage: ((event: { data: string }) => void) | null = null;
    onerror: ((error: Error) => void) | null = null;
    onclose: ((event: { code: number }) => void) | null = null;

    constructor() {
      sockets.push(this);
      const shouldOpen = sockets.length === 1 || sockets.length >= 3;
      queueMicrotask(() => {
        if (shouldOpen) {
          this.readyState = ErrorOnlyWebSocket.OPEN;
          this.onopen?.();
          return;
        }
        this.readyState = ErrorOnlyWebSocket.CLOSED;
        this.onerror?.(new Error("upgrade refused"));
      });
    }

    send(data: string): void {
      const frame = JSON.parse(data) as [string, string, string, string];
      const [joinRef, ref, topic, event] = frame;
      if (event !== "phx_join") return;
      queueMicrotask(() =>
        this.onmessage?.({
          data: JSON.stringify([
            joinRef,
            ref,
            topic,
            "phx_reply",
            { status: "ok", response: {} },
          ]),
        }),
      );
    }

    drop(code: number): void {
      this.readyState = ErrorOnlyWebSocket.CLOSED;
      this.onclose?.({ code });
    }

    close(): void {
      this.readyState = ErrorOnlyWebSocket.CLOSED;
    }
  }

  const session = await connectRealtimeGateway({
    wsUrl: "wss://gateway.example/channels",
    apiKey: "cpk-test",
    projectId: 7,
    join: {
      protocol: "channel_delivery_v1",
      runtimeInstanceId: "rti_1",
      channels: [{ channelName: "opentag", adapter: "slack" }],
    },
    diagnosticFetch: vi.fn(async () => new Response(null, { status: 503 })),
    webSocket: ErrorOnlyWebSocket,
  });
  let isOnline = false;
  session.onStateChange((state) => {
    isOnline = state === "online";
  });

  return {
    disconnect: () => session.disconnect(),
    dropInitialConnection: () => sockets[0]!.drop(1006),
    isOnline: () => isOnline,
    socketCount: () => sockets.length,
  };
}

/** Wait for a condition while Phoenix drives its real reconnect timers. */
async function waitUntil(
  predicate: () => boolean,
  timeoutMs: number,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate() && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

test("keeps reconnecting when Node WebSocket emits error without close", async () => {
  const setup = await setupErrorOnlyReconnect();

  try {
    setup.dropInitialConnection();
    await waitUntil(() => setup.socketCount() >= 3 && setup.isOnline(), 2_000);

    expect(setup.socketCount()).toBeGreaterThanOrEqual(3);
    expect(setup.isOnline()).toBe(true);
  } finally {
    setup.disconnect();
  }
});
