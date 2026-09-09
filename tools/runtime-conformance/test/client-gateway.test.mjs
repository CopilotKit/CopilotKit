import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";
import { WebSocket } from "ws";
import { createClientGateway } from "../client-gateway.mjs";

/** Give every test an isolated real client gateway and explicit cleanup. */
async function setup() {
  const events = [];
  const locks = new Map();
  const stops = [];
  const sockets = [];
  const gateway = createClientGateway({
    events,
    locks,
    stopRun: (...args) => stops.push(args),
  });
  const server = createServer();
  server.on("upgrade", (request, socket, head) =>
    gateway.handleUpgrade(request, socket, head),
  );
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const url = `ws://127.0.0.1:${server.address().port}/client/websocket`;
  return {
    events,
    locks,
    stops,
    gateway,
    async connect(token) {
      const socket = new WebSocket(
        `${url}?vsn=2.0.0&join_token=${encodeURIComponent(token)}`,
      );
      sockets.push(socket);
      const received = [];
      socket.on("message", (raw) => received.push(JSON.parse(String(raw))));
      await once(socket, "open");
      return { socket, received };
    },
    async teardown() {
      for (const socket of sockets) socket.terminate();
      await gateway.close();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

/** Wait for actual socket delivery, with a bounded failure diagnostic. */
async function waitFor(predicate) {
  const deadline = Date.now() + 2000;
  while (!predicate()) {
    assert.ok(Date.now() < deadline, "Expected client frame did not arrive");
    await delay(5);
  }
}

test("client token cannot join another thread", async () => {
  const fixture = await setup();
  try {
    fixture.gateway.registerToken("token", "owned", "user");
    const client = await fixture.connect("token");

    client.socket.send(
      JSON.stringify(["1", "1", "thread:other", "phx_join", {}]),
    );
    await waitFor(() => client.received.length > 0);

    assert.deepEqual(client.received[0][4], {
      status: "error",
      response: { reason: "token_thread_mismatch" },
    });
    assert.equal(client.received.length, 1);
  } finally {
    await fixture.teardown();
  }
});

test("client token is consumed by the first authenticated socket", async () => {
  const fixture = await setup();
  try {
    fixture.gateway.registerToken("once", "owned", "user");
    await fixture.connect("once");

    await assert.rejects(fixture.connect("once"), /401/);

    assert.equal(fixture.stops.length, 0);
  } finally {
    await fixture.teardown();
  }
});

test("thread token cannot relay stop for another thread's run", async () => {
  const fixture = await setup();
  try {
    fixture.gateway.registerToken("token", "owned", "user");
    fixture.locks.set("owned", { runId: "owned-run" });
    fixture.locks.set("other", { runId: "victim-run" });
    const client = await fixture.connect("token");
    client.socket.send(
      JSON.stringify([
        "1",
        "1",
        "thread:owned",
        "phx_join",
        { stream_mode: "connect" },
      ]),
    );
    await waitFor(() =>
      client.received.some((frame) => frame[3] === "replay_complete"),
    );

    client.socket.send(
      JSON.stringify([
        "1",
        "2",
        "thread:owned",
        "stop_run",
        { run_id: "victim-run" },
      ]),
    );
    await waitFor(() => client.received.some((frame) => frame[1] === "2"));

    assert.equal(fixture.stops.length, 0);
    assert.equal(
      client.received.find((frame) => frame[1] === "2")[4].status,
      "error",
    );
  } finally {
    await fixture.teardown();
  }
});

test("connect replay ends with durable cursor and idle control after history", async () => {
  const fixture = await setup();
  try {
    fixture.gateway.registerToken("token", "owned", "user");
    fixture.events.push(
      ...["RUN_STARTED", "RUN_FINISHED"].map((type, index) => ({
        type,
        threadId: "owned",
        runId: "run",
        metadata: {
          cpki_event_id: `event-${index + 1}`,
          cpki_event_seq: index + 1,
        },
      })),
    );
    const client = await fixture.connect("token");

    client.socket.send(
      JSON.stringify([
        "1",
        "1",
        "thread:owned",
        "phx_join",
        { stream_mode: "connect", last_seen_event_id: null },
      ]),
    );
    await waitFor(() =>
      client.received.some((frame) => frame[3] === "stream_idle"),
    );

    assert.deepEqual(
      client.received.map((frame) => frame[3]),
      [
        "phx_reply",
        "connected",
        "ag_ui_event",
        "ag_ui_event",
        "replay_complete",
        "stream_idle",
      ],
    );
    assert.equal(client.received.at(-1)[4].latestEventId, "event-2");
    assert.equal(client.received.at(-2)[4].latestEventId, "event-2");
  } finally {
    await fixture.teardown();
  }
});
