import { expect, test, vi } from "vitest";
import {
  connectRealtimeGateway,
  RealtimeGatewayUnreachableError,
} from "./realtime-gateway.js";

interface RetryabilitySetup {
  connection: ReturnType<typeof connectRealtimeGateway>;
  diagnosticFetch: ReturnType<typeof vi.fn<typeof fetch>>;
}

/** Build one socket that opens but rejects or never answers its join. */
function setupJoinFailure(
  response?: Record<string, unknown>,
): ReturnType<typeof connectRealtimeGateway> {
  class RejectedWebSocket {
    static readonly CONNECTING = 0;
    static readonly OPEN = 1;
    static readonly CLOSING = 2;
    static readonly CLOSED = 3;
    readyState = RejectedWebSocket.CONNECTING;
    binaryType = "arraybuffer";
    onopen: (() => void) | null = null;
    onmessage: ((event: { data: string }) => void) | null = null;
    onerror: ((error: Error) => void) | null = null;
    onclose: ((event: { code: number }) => void) | null = null;

    constructor() {
      queueMicrotask(() => {
        this.readyState = RejectedWebSocket.OPEN;
        this.onopen?.();
      });
    }

    send(data: string): void {
      const frame = JSON.parse(data) as [string, string, string, string];
      const [joinRef, ref, topic, event] = frame;
      if (event !== "phx_join" || response === undefined) return;
      queueMicrotask(() =>
        this.onmessage?.({
          data: JSON.stringify([
            joinRef,
            ref,
            topic,
            "phx_reply",
            { status: "error", response },
          ]),
        }),
      );
    }

    close(): void {
      this.readyState = RejectedWebSocket.CLOSED;
      queueMicrotask(() => this.onclose?.({ code: 1000 }));
    }
  }

  return connectRealtimeGateway({
    wsUrl: "wss://gateway.example/channels",
    apiKey: "cpk-test",
    projectId: 7,
    join: {
      protocol: "channel_delivery_v1",
      runtimeInstanceId: "rti_1",
      channels: [{ channelName: "support", adapter: "slack" }],
    },
    timeoutMs: 10,
    webSocket: RejectedWebSocket,
  });
}

/** Build one socket that cannot upgrade and an HTTP diagnosis for its host. */
function setupRetryability(
  status: number,
  transportError: Error = new Error("upgrade refused"),
): RetryabilitySetup {
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
      queueMicrotask(() => this.onerror?.(transportError));
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

test("an ENOTFOUND transport failure is terminal without an HTTP probe", async () => {
  const transportError = Object.assign(
    new Error("getaddrinfo ENOTFOUND gateway.example"),
    { code: "ENOTFOUND" },
  );
  const { connection, diagnosticFetch } = setupRetryability(
    502,
    transportError,
  );

  const error = await connection.catch((cause: unknown) => cause);

  expect(diagnosticFetch).not.toHaveBeenCalled();
  expect(error).toBeInstanceOf(RealtimeGatewayUnreachableError);
  expect((error as RealtimeGatewayUnreachableError).retryable).toBe(false);
});

test("a gateway_draining join rejection preserves its retry classification", async () => {
  const response = { reason: "gateway_draining", retryable: true };

  const error = await setupJoinFailure(response).catch(
    (cause: unknown) => cause,
  );

  expect(error).toMatchObject({
    code: "GATEWAY_JOIN_FAILED",
    reason: response,
    retryable: true,
  });
  expect((error as Error).message).toMatch(/gateway_draining/);
});

test("an initial gateway join timeout is retryable", async () => {
  const error = await setupJoinFailure().catch((cause: unknown) => cause);

  expect(error).toMatchObject({
    code: "GATEWAY_JOIN_FAILED",
    retryable: true,
  });
  expect((error as Error).message).toMatch(/join timed out/);
});
