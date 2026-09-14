import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";
import { WebSocket } from "ws";
import { startPlatform } from "../platform.mjs";

test("MCP fixture preserves UI metadata and enforces configured server auth", async (t) => {
  const platform = await startPlatform();
  t.after(() => platform.close());
  const rpc = (method, params, headers = {}) =>
    fetch(platform.mcpUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        ...headers,
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    });
  assert.equal((await rpc("initialize", {})).status, 401);
  const auth = { "x-fixture-auth": "mcp-fixture-token" };
  const initialized = await rpc(
    "initialize",
    {
      protocolVersion: "2025-03-26",
      capabilities: {},
      clientInfo: { name: "fixture-test", version: "1" },
    },
    auth,
  );
  assert.equal(initialized.status, 200);
  const session = initialized.headers.get("mcp-session-id");
  const headers = { ...auth, "mcp-session-id": session };
  await rpc("notifications/initialized", {}, headers);
  const listed = await rpc("tools/list", {}, headers);
  const data = await listed.json();
  assert.equal(
    data.result.tools.find((tool) => tool.name === "show_card")._meta[
      "ui/resourceUri"
    ],
    "ui://fixture/card",
  );
  const called = await rpc(
    "tools/call",
    { name: "show_card", arguments: { title: "Example" } },
    headers,
  );
  assert.equal((await called.json()).result.content[0].text, "Card: Example");
  assert.deepEqual(platform.mcpCalls, [{ title: "Example" }]);
});

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
  assert.equal(foreign.status, 404);
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

test("empty lock mutation body returns conflict rather than internal error", async (t) => {
  const platform = await startPlatform();
  t.after(() => platform.close());
  platform.seedThread("thread", "alice");
  platform.locks.set("thread", {
    runId: "run",
    userId: "alice",
    agentId: "default",
  });
  for (const method of ["PATCH", "DELETE"]) {
    const response = await fetch(`${platform.url}/api/threads/thread/lock`, {
      method,
      headers: {
        Authorization: `Bearer ${platform.apiKey}`,
        "x-cpki-user-id": "alice",
      },
    });
    assert.equal(response.status, 409);
  }
});
