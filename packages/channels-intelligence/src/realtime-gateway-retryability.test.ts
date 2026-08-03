import { expect, test, vi } from "vitest";
import {
  connectRealtimeGateway,
  RealtimeGatewayUnreachableError,
} from "./realtime-gateway.js";

interface RetryabilitySetup {
  connection: ReturnType<typeof connectRealtimeGateway>;
  diagnosticFetch: ReturnType<typeof vi.fn<typeof fetch>>;
}

/** Build one socket that cannot upgrade and an HTTP diagnosis for its host. */
function setupRetryability(status: number): RetryabilitySetup {
  class RefusedWebSocket {
    static readonly CONNECTING = 0;
    static readonly OPEN = 1;
    static readonly CLOSING = 2;
    static readonly CLOSED = 3;
    readyState = RefusedWebSocket.CONNECTING;
    binaryType = "arraybuffer";
    onopen: (() => void) | null = null;
    onmessage: ((event: { data: string }) => void) | null = null;
    onerror: ((error: Error) => void) | null = null;
    onclose: ((event: { code: number }) => void) | null = null;

    constructor() {
      queueMicrotask(() => this.onerror?.(new Error("upgrade refused")));
    }

    send(): void {}

    close(): void {
      this.readyState = RefusedWebSocket.CLOSED;
      queueMicrotask(() => this.onclose?.({ code: 1000 }));
    }
  }

  const diagnosticFetch = vi.fn<typeof fetch>(async () =>
    Promise.resolve(new Response(null, { status })),
  );
  const connection = connectRealtimeGateway({
    wsUrl: "wss://gateway.example/channels",
    apiKey: "cpk-test",
    projectId: 7,
    join: {
      protocol: "channel_delivery_v1",
      runtimeInstanceId: "rti_1",
      channels: [{ channelName: "support", adapter: "slack" }],
    },
    connectTimeoutMs: 10,
    diagnosticFetch,
    webSocket: RefusedWebSocket,
  });

  return { connection, diagnosticFetch };
}

test("an HTTP 502 gateway diagnosis is retryable", async () => {
  const { connection, diagnosticFetch } = setupRetryability(502);

  const error = await connection.catch((cause: unknown) => cause);

  expect(diagnosticFetch).toHaveBeenCalledOnce();
  expect(error).toBeInstanceOf(RealtimeGatewayUnreachableError);
  expect((error as RealtimeGatewayUnreachableError).retryable).toBe(true);
});

test("an HTTP 403 gateway diagnosis is terminal", async () => {
  const { connection, diagnosticFetch } = setupRetryability(403);

  const error = await connection.catch((cause: unknown) => cause);

  expect(diagnosticFetch).toHaveBeenCalledOnce();
  expect(error).toBeInstanceOf(RealtimeGatewayUnreachableError);
  expect((error as RealtimeGatewayUnreachableError).retryable).toBe(false);
});
