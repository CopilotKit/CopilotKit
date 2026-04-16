import { describe, it, expect, afterEach } from "vitest";
import * as http from "node:http";
import { DebugStream } from "../debug-stream";
import type { DebugEventEnvelope, ConnectionStatus } from "../inspector-types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface TestServer {
  server: http.Server;
  port: number;
  url: string;
  /** Push an SSE envelope to the currently-connected client. */
  sendEvent(envelope: DebugEventEnvelope): void;
  /** Write raw bytes to the active response (for malformed-data tests). */
  sendRaw(data: string): void;
  /** Queue a non-200 response for the next incoming request. */
  rejectNext(statusCode: number): void;
  /** End the active response stream (simulates server drop). */
  closeResponse(): void;
  /** Shut down the HTTP server. */
  close(): Promise<void>;
}

function makeEnvelope(
  partial?: Partial<DebugEventEnvelope>,
): DebugEventEnvelope {
  return {
    timestamp: Date.now(),
    agentId: "agent-1",
    threadId: "thread-1",
    runId: "run-1",
    event: { type: "test-event" },
    ...partial,
  };
}

function createTestServer(): Promise<TestServer> {
  return new Promise((resolve) => {
    let activeRes: http.ServerResponse | null = null;
    let pendingRejectStatus: number | null = null;

    const server = http.createServer((_req, res) => {
      if (pendingRejectStatus !== null) {
        const code = pendingRejectStatus;
        pendingRejectStatus = null;
        res.writeHead(code);
        res.end();
        return;
      }

      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });
      res.flushHeaders();
      activeRes = res;
    });

    server.listen(0, "127.0.0.1", () => {
      const addr = server.address() as { port: number };
      resolve({
        server,
        port: addr.port,
        url: `http://127.0.0.1:${addr.port}`,

        sendEvent(envelope: DebugEventEnvelope) {
          if (activeRes && !activeRes.writableEnded) {
            activeRes.write(`data: ${JSON.stringify(envelope)}\n\n`);
          }
        },

        sendRaw(data: string) {
          if (activeRes && !activeRes.writableEnded) {
            activeRes.write(data);
          }
        },

        rejectNext(statusCode: number) {
          pendingRejectStatus = statusCode;
        },

        closeResponse() {
          if (activeRes && !activeRes.writableEnded) {
            activeRes.end();
            activeRes = null;
          }
        },

        close() {
          return new Promise<void>((r) => {
            activeRes = null;
            server.close(() => r());
          });
        },
      });
    });
  });
}

function waitFor(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Collect N status transitions, rejecting on timeout. */
function collectStatuses(
  stream: DebugStream,
  count: number,
  timeoutMs = 3000,
): Promise<ConnectionStatus[]> {
  return new Promise((resolve, reject) => {
    const collected: ConnectionStatus[] = [];
    const timer = setTimeout(
      () =>
        reject(
          new Error(
            `Timed out waiting for ${count} statuses, got ${collected.length}: [${collected}]`,
          ),
        ),
      timeoutMs,
    );
    const unsub = stream.onStatus((s) => {
      collected.push(s);
      if (collected.length >= count) {
        clearTimeout(timer);
        unsub();
        resolve(collected);
      }
    });
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("DebugStream", () => {
  let ts: TestServer | null = null;
  let stream: DebugStream | null = null;

  afterEach(async () => {
    stream?.dispose();
    stream = null;
    if (ts) {
      await ts.close();
      ts = null;
    }
  });

  it("connects and receives events", async () => {
    ts = await createTestServer();
    stream = new DebugStream();

    const events: DebugEventEnvelope[] = [];
    stream.onEvent((e) => events.push(e));

    const statusP = collectStatuses(stream, 2);
    stream.connect(ts.url);
    const statuses = await statusP;
    expect(statuses).toEqual(["connecting", "connected"]);

    ts.sendEvent(makeEnvelope({ agentId: "a1" }));
    await waitFor(50);

    expect(events).toHaveLength(1);
    expect(events[0].agentId).toBe("a1");
    expect(events[0].event.type).toBe("test-event");
  });

  it("transitions through connecting, connected, disconnected", async () => {
    ts = await createTestServer();
    stream = new DebugStream();

    const statusP = collectStatuses(stream, 3);
    stream.connect(ts.url);
    await waitFor(100);
    stream.disconnect();

    const statuses = await statusP;
    expect(statuses).toEqual(["connecting", "connected", "disconnected"]);
  });

  it("disconnect stops reconnection", async () => {
    ts = await createTestServer();
    stream = new DebugStream();

    const statuses: ConnectionStatus[] = [];
    stream.onStatus((s) => statuses.push(s));

    stream.connect(ts.url);
    await waitFor(100);
    stream.disconnect();

    // Wait longer than the initial 1s reconnect delay
    await waitFor(1500);

    // Nothing should appear after the final "disconnected"
    const lastIdx = statuses.lastIndexOf("disconnected");
    expect(statuses.slice(lastIdx + 1)).toEqual([]);
  });

  it("handles server error response (non-200)", async () => {
    ts = await createTestServer();
    stream = new DebugStream();

    ts.rejectNext(503);

    const statusP = collectStatuses(stream, 2);
    stream.connect(ts.url);
    const statuses = await statusP;

    expect(statuses).toEqual(["connecting", "disconnected"]);
  });

  it("skips malformed JSON without crashing", async () => {
    ts = await createTestServer();
    stream = new DebugStream();

    const events: DebugEventEnvelope[] = [];
    stream.onEvent((e) => events.push(e));

    const statusP = collectStatuses(stream, 2);
    stream.connect(ts.url);
    await statusP;

    ts.sendRaw("data: {not valid json}\n\n");
    ts.sendEvent(makeEnvelope({ agentId: "valid" }));
    await waitFor(100);

    expect(events).toHaveLength(1);
    expect(events[0].agentId).toBe("valid");
  });

  it("dispose clears callbacks and prevents further events", async () => {
    ts = await createTestServer();
    stream = new DebugStream();

    const events: DebugEventEnvelope[] = [];
    const statuses: ConnectionStatus[] = [];
    stream.onEvent((e) => events.push(e));
    stream.onStatus((s) => statuses.push(s));

    const connected = collectStatuses(stream, 2);
    stream.connect(ts.url);
    await connected;

    stream.dispose();

    // Sending after dispose should not trigger callbacks
    ts.sendEvent(makeEnvelope());
    await waitFor(100);

    expect(events).toHaveLength(0);
    // disconnect() fires "disconnected" before callbacks are cleared
    expect(statuses).toContain("connecting");
    expect(statuses).toContain("connected");
    expect(statuses).toContain("disconnected");
  });

  it("onEvent unsubscribe removes the callback", async () => {
    ts = await createTestServer();
    stream = new DebugStream();

    const events: DebugEventEnvelope[] = [];
    const unsub = stream.onEvent((e) => events.push(e));

    const statusP = collectStatuses(stream, 2);
    stream.connect(ts.url);
    await statusP;

    ts.sendEvent(makeEnvelope({ agentId: "before" }));
    await waitFor(50);
    expect(events).toHaveLength(1);

    unsub();
    ts.sendEvent(makeEnvelope({ agentId: "after" }));
    await waitFor(50);

    expect(events).toHaveLength(1);
    expect(events[0].agentId).toBe("before");
  });

  it("onStatus unsubscribe removes the callback", async () => {
    ts = await createTestServer();
    stream = new DebugStream();

    const statuses: ConnectionStatus[] = [];
    const unsub = stream.onStatus((s) => statuses.push(s));

    const statusP = collectStatuses(stream, 2);
    stream.connect(ts.url);
    await statusP;

    unsub();
    statuses.length = 0;

    stream.disconnect();
    await waitFor(50);

    expect(statuses).toHaveLength(0);
  });

  it("auto-reconnects after server closes the connection", async () => {
    ts = await createTestServer();
    stream = new DebugStream();

    const connected1 = collectStatuses(stream, 2);
    stream.connect(ts.url);
    await connected1;

    const reconnected = collectStatuses(stream, 3, 5000);
    ts.closeResponse();

    const statuses = await reconnected;
    expect(statuses).toEqual(["disconnected", "connecting", "connected"]);
  });

  it("receives multiple events in sequence", async () => {
    ts = await createTestServer();
    stream = new DebugStream();

    const events: DebugEventEnvelope[] = [];
    stream.onEvent((e) => events.push(e));

    const statusP = collectStatuses(stream, 2);
    stream.connect(ts.url);
    await statusP;

    ts.sendEvent(makeEnvelope({ agentId: "a1", runId: "r1" }));
    ts.sendEvent(makeEnvelope({ agentId: "a2", runId: "r2" }));
    ts.sendEvent(makeEnvelope({ agentId: "a3", runId: "r3" }));
    await waitFor(100);

    expect(events).toHaveLength(3);
    expect(events.map((e) => e.agentId)).toEqual(["a1", "a2", "a3"]);
  });
});
