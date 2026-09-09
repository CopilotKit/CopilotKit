import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";
import { WebSocket } from "ws";
import { startPlatform } from "../platform.mjs";

test("platform rejects foreign identity and never creates a thread during connect", async (t) => {
  const platform = await startPlatform();
  t.after(() => platform.close());
  const headers = {
    Authorization: `Bearer ${platform.apiKey}`,
    "Content-Type": "application/json",
  };
  const missing = await fetch(`${platform.url}/api/threads/missing/connect`, {
    method: "POST",
    headers,
    body: JSON.stringify({ userId: "alice", agentId: "default" }),
  });
  assert.equal(missing.status, 204);
  assert.equal(platform.threads.size, 0);
  platform.seedThread("private", "bob");
  const foreign = await fetch(
    `${platform.url}/api/threads/private?userId=alice`,
    { headers },
  );
  assert.equal(foreign.status, 403);
  assert.equal(
    (
      await fetch(`${platform.url}/api/threads/private?userId=bob`, {
        headers: { Authorization: "Bearer wrong" },
      })
    ).status,
    401,
  );
});

test("gateway requires Phoenix bearer proof and a live matching lock", async (t) => {
  const platform = await startPlatform();
  t.after(() => platform.close());
  const socket = new WebSocket(`${platform.wsUrl}/runner/websocket?vsn=2.0.0`, [
    "phoenix",
  ]);
  socket.on("error", () => {});
  await new Promise((resolve) => socket.once("close", resolve));
  assert.equal(platform.joins.length, 0);
  const valid = new WebSocket(`${platform.wsUrl}/runner/websocket?vsn=2.0.0`, [
    "phoenix",
    `base64url.bearer.phx.${Buffer.from(platform.apiKey).toString("base64url")}`,
  ]);
  t.after(() => valid.terminate());
  await once(valid, "open");
  const reply = once(valid, "message");
  valid.send(
    JSON.stringify([
      "1",
      "1",
      "ingestion:run",
      "phx_join",
      { thread_id: "thread", run_id: "run" },
    ]),
  );
  assert.equal(JSON.parse(String((await reply)[0]))[4].status, "error");
});

test("lost ACK replay retains one durable event and rejects changed duplicate content", async (t) => {
  const platform = await startPlatform();
  t.after(() => platform.close());
  platform.seedThread("thread", "alice");
  platform.locks.set("thread", {
    runId: "run",
    userId: "alice",
    agentId: "default",
  });
  platform.faults.dropAcks = 1;
  const socket = new WebSocket(`${platform.wsUrl}/runner/websocket?vsn=2.0.0`, [
    "phoenix",
    `base64url.bearer.phx.${Buffer.from(platform.apiKey).toString("base64url")}`,
  ]);
  t.after(() => socket.terminate());
  await once(socket, "open");
  let reply = once(socket, "message");
  socket.send(
    JSON.stringify([
      "1",
      "1",
      "ingestion:run",
      "phx_join",
      { thread_id: "thread", run_id: "run" },
    ]),
  );
  assert.equal(JSON.parse(String((await reply)[0]))[4].status, "ok");
  const event = {
    type: "RUN_STARTED",
    threadId: "thread",
    runId: "run",
    thread_id: "thread",
    run_id: "run",
    metadata: { cpki_event_id: "stable", cpki_event_seq: 1 },
  };
  socket.send(JSON.stringify(["1", "2", "ingestion:run", "event", event]));
  await platform.waitFor(() => platform.events.length === 1);
  reply = once(socket, "message");
  socket.send(JSON.stringify(["1", "3", "ingestion:run", "event", event]));
  assert.equal(JSON.parse(String((await reply)[0]))[4].status, "ok");
  assert.equal(platform.events.length, 1);
  reply = once(socket, "message");
  socket.send(
    JSON.stringify([
      "1",
      "4",
      "ingestion:run",
      "event",
      { ...event, type: "RUN_ERROR" },
    ]),
  );
  assert.equal(JSON.parse(String((await reply)[0]))[4].status, "error");
});
