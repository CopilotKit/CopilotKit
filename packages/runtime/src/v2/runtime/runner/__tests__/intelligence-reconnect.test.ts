import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { AbstractAgent } from "@ag-ui/client";
import { Socket } from "phoenix";
import { EMPTY } from "rxjs";
import { expect, test, vi } from "vitest";
import { WebSocket } from "ws";
import { IntelligenceAgentRunner } from "../intelligence";

class IdleAgent extends AbstractAgent {
  run(): ReturnType<AbstractAgent["run"]> {
    return EMPTY;
  }
}

/** Capture the real Phoenix join payload without opening a network connection. */
function setup() {
  const connect = vi
    .spyOn(Socket.prototype, "connect")
    .mockImplementation(() => {});
  const channel = vi.spyOn(Socket.prototype, "channel");
  const onClose = vi.spyOn(Socket.prototype, "onClose");
  const onError = vi.spyOn(Socket.prototype, "onError");
  const runner = new IntelligenceAgentRunner({
    url: "ws://localhost:4000/runner",
  });
  const subscription = runner
    .run({
      threadId: "thread-reconnect",
      agent: new IdleAgent(),
      input: {
        threadId: "thread-reconnect",
        runId: "run-reconnect",
        messages: [],
        tools: [],
        context: [],
        state: {},
        forwardedProps: {},
      },
    })
    .subscribe();
  return {
    channel,
    connect,
    subscription,
    close: onClose.mock.calls[0][0],
    /** Raise a transport error the way Phoenix reports it, with no close. */
    error() {
      for (const [handler] of onError.mock.calls) {
        void handler(new Event("error"), WebSocket, 0);
      }
    },
    teardown() {
      subscription.unsubscribe();
      onError.mockRestore();
      onClose.mockRestore();
      channel.mockRestore();
      connect.mockRestore();
    },
  };
}

test("runner joins without obsolete reconnect capability negotiation", () => {
  const { channel, teardown } = setup();
  try {
    expect(channel).toHaveBeenCalledWith("ingestion:run-reconnect", {
      thread_id: "thread-reconnect",
      run_id: "run-reconnect",
    });
  } finally {
    teardown();
  }
});

/** Build the browser close event shape without requiring a browser global. */
function normalClose(): CloseEvent {
  return Object.assign(new Event("close"), {
    code: 1000,
    reason: "",
    wasClean: true,
  });
}

test("an unexpected normal close reconnects an active runner", async () => {
  vi.useFakeTimers();
  const { connect, close, teardown } = setup();
  try {
    await close(normalClose());
    await vi.advanceTimersByTimeAsync(1_000);

    expect(connect).toHaveBeenCalledTimes(2);
  } finally {
    teardown();
    vi.useRealTimers();
  }
});

test("intentional runner teardown cancels a pending normal-close reconnect", async () => {
  vi.useFakeTimers();
  const { connect, close, subscription, teardown } = setup();
  try {
    await close(normalClose());
    subscription.unsubscribe();
    await vi.advanceTimersByTimeAsync(1_000);
    await close(normalClose());
    await vi.advanceTimersByTimeAsync(1_000);

    expect(connect).toHaveBeenCalledTimes(1);
  } finally {
    teardown();
    vi.useRealTimers();
  }
});

test("a socket error with no close reconnects an active runner", async () => {
  vi.useFakeTimers();
  const { connect, error, teardown } = setup();
  try {
    error();
    await vi.advanceTimersByTimeAsync(1_000);

    expect(connect).toHaveBeenCalledTimes(2);
  } finally {
    teardown();
    vi.useRealTimers();
  }
});

test("the error raised by closing a failed socket does not reconnect twice", async () => {
  vi.useFakeTimers();
  const { connect, error, teardown } = setup();
  // Node 22 raises one more error, synchronously, when a socket whose opening
  // handshake failed is closed.
  const disconnect = vi
    .spyOn(Socket.prototype, "disconnect")
    .mockImplementation((callback) => {
      error();
      callback?.();
    });
  try {
    error();
    await vi.advanceTimersByTimeAsync(3_000);

    expect(connect).toHaveBeenCalledTimes(2);
  } finally {
    teardown();
    disconnect.mockRestore();
    vi.useRealTimers();
  }
});

test("a refused opening handshake is retried on the real transport", async () => {
  // Node 20 does not expose a global WebSocket. Keep Node 22+ on its native
  // transport and supply the same protocol transport for the older CI lane.
  const needsWebSocket = typeof globalThis.WebSocket === "undefined";
  if (needsWebSocket) vi.stubGlobal("WebSocket", WebSocket);
  let upgrades = 0;
  const server = createServer();
  server.on("upgrade", (_request, socket) => {
    upgrades++;
    socket.on("error", () => {});
    socket.end(
      "HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\nContent-Length: 0\r\n\r\n",
    );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  const runner = new IntelligenceAgentRunner({
    url: `ws://127.0.0.1:${port}/runner`,
  });
  const subscription = runner
    .run({
      threadId: "thread-refused",
      agent: new IdleAgent(),
      input: {
        threadId: "thread-refused",
        runId: "run-refused",
        messages: [],
        tools: [],
        context: [],
        state: {},
        forwardedProps: {},
      },
    })
    .subscribe();
  try {
    await vi.waitFor(() => expect(upgrades).toBeGreaterThanOrEqual(2), {
      timeout: 8_000,
      interval: 50,
    });
  } finally {
    subscription.unsubscribe();
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    if (needsWebSocket) vi.unstubAllGlobals();
  }
}, 10_000);
