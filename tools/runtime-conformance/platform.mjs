import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { WebSocketServer } from "ws";
import { LLMock, MCPMock } from "@copilotkit/aimock";

/** Read bounded JSON from an actual request, preserving empty bodies. */
async function readBody(request) {
  let text = "";
  for await (const chunk of request) {
    text += chunk;
    if (text.length > 2_000_000)
      throw new Error("Fixture request exceeded 2 MB");
  }
  return text ? JSON.parse(text) : undefined;
}

/** Send the same JSON framing as the real platform. */
function json(response, status, body) {
  response.writeHead(status, { "Content-Type": "application/json" });
  response.end(body === undefined ? undefined : JSON.stringify(body));
}

/**
 * Start a stateful platform double. It enforces identity, locking, and durable
 * ACK rules instead of accepting arbitrary runtime requests. No live key is used.
 */
export async function startPlatform() {
  const threads = new Map();
  const locks = new Map();
  const memories = new Map();
  const requests = [];
  const events = [];
  const attempts = [];
  const joins = [];
  const telemetry = [];
  const agentInputs = [];
  const faults = {
    dropAcks: 0,
    disconnectAfterPersist: 0,
    joinDelayMs: 0,
    joinReject: false,
    http: new Map(),
    agentDelayMs: 0,
    agentEvents: null,
    agentChunkDelayMs: 0,
  };
  const apiKey = "cpki_fixture_key_never_a_real_secret";
  const mock = new LLMock({ port: 0 });
  mock.onMessage(/.*/, { content: "Hello from AIMock." });
  await mock.start();
  const mcpCalls = [];
  const mcp = new MCPMock({ port: 0 });
  mcp.addTool({
    name: "show_card",
    description: "Show a card",
    inputSchema: {
      type: "object",
      properties: { title: { type: "string" } },
      required: ["title"],
    },
    _meta: { "ui/resourceUri": "ui://fixture/card" },
  });
  mcp.addTool({
    name: "internal_tool",
    description: "Not a UI tool",
    inputSchema: { type: "object", properties: {} },
  });
  mcp.onToolCall("show_card", (args) => {
    mcpCalls.push(args);
    return `Card: ${args.title}`;
  });
  mcp.addResource(
    { uri: "ui://fixture/card", name: "Card", mimeType: "text/html+mcp" },
    { text: "<!doctype html><h1>Fixture card</h1>", mimeType: "text/html+mcp" },
  );
  const mcpBase = await mcp.start();

  /** Seed a platform-owned thread without making a runtime-side assumption. */
  function seedThread(id, userId = "test-user", extra = {}) {
    const thread = {
      id,
      threadId: id,
      userId,
      agentId: "default",
      name: null,
      archived: false,
      messages: [],
      ...extra,
    };
    threads.set(id, thread);
    return thread;
  }

  /** Reject cross-user access before returning thread data. */
  function checkOwner(thread, userId, response) {
    if (!thread) {
      json(response, 404, { error: "Thread not found" });
      return false;
    }
    if (thread.userId !== userId) {
      json(response, 403, { error: "Thread access denied" });
      return false;
    }
    return true;
  }

  const server = createServer((request, response) => {
    handle(request, response).catch((error) => {
      if (!response.headersSent) json(response, 500, { error: error.message });
      else response.destroy(error);
    });
  });

  /** Apply platform state changes only through authenticated wire operations. */
  async function handle(request, response) {
    const url = new URL(request.url, "http://fixture.local");
    const body = await readBody(request);
    const record = {
      method: request.method,
      path: url.pathname,
      query: Object.fromEntries(url.searchParams),
      headers: { ...request.headers },
      body,
    };
    requests.push(record);

    if (url.pathname === "/mcp") {
      if (request.headers["x-fixture-auth"] !== "mcp-fixture-token") {
        json(response, 401, { error: "MCP server authentication required" });
        return;
      }
      const headers = {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
      };
      for (const name of ["mcp-session-id", "mcp-protocol-version"])
        if (request.headers[name]) headers[name] = request.headers[name];
      const upstream = await fetch(mcpBase, {
        method: request.method,
        headers,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(5000),
      });
      response.writeHead(
        upstream.status,
        Object.fromEntries(
          [...upstream.headers].filter(([name]) =>
            ["content-type", "mcp-session-id"].includes(name),
          ),
        ),
      );
      response.end(await upstream.text());
      return;
    }

    if (url.pathname === "/telemetry") {
      telemetry.push(body);
      json(response, 202, {});
      return;
    }
    if (url.pathname === "/agent") {
      agentInputs.push(body);
      const agentFault = faults.http.get(`${request.method} /agent`);
      if (agentFault) {
        json(response, agentFault.status, agentFault.body);
        return;
      }
      if (faults.agentEvents) {
        response.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
        });
        const scripted =
          typeof faults.agentEvents === "function"
            ? faults.agentEvents(body)
            : faults.agentEvents;
        for (const event of scripted) {
          if (response.destroyed) break;
          response.write(`data: ${JSON.stringify(event)}\n\n`);
          if (faults.agentChunkDelayMs) await delay(faults.agentChunkDelayMs);
        }
        response.end();
        return;
      }
      const completion = await fetch(`${mock.url}/v1/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "fixture-model",
          messages: [{ role: "user", content: "hello" }],
          stream: false,
        }),
      }).then((r) => r.json());
      const messageId = randomUUID();
      response.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
      });
      const emit = (event) =>
        response.write(`data: ${JSON.stringify(event)}\n\n`);
      emit({ type: "RUN_STARTED", threadId: body.threadId, runId: body.runId });
      if (faults.agentDelayMs) await delay(faults.agentDelayMs);
      if (response.destroyed) return;
      for (const event of [
        { type: "TEXT_MESSAGE_START", messageId, role: "assistant" },
        {
          type: "TEXT_MESSAGE_CONTENT",
          messageId,
          delta: completion.choices[0].message.content,
        },
        { type: "TEXT_MESSAGE_END", messageId },
        { type: "RUN_FINISHED", threadId: body.threadId, runId: body.runId },
      ])
        emit(event);
      response.end();
      return;
    }
    if (request.headers.authorization !== `Bearer ${apiKey}`) {
      json(response, 401, { error: "Bad project key" });
      return;
    }
    const fault = faults.http.get(`${request.method} ${url.pathname}`);
    if (fault) {
      if (fault.once) faults.http.delete(`${request.method} ${url.pathname}`);
      if (fault.delayMs) await delay(fault.delayMs);
      json(response, fault.status, fault.body);
      return;
    }
    if (url.pathname === "/api/entitlements/runtime") {
      json(response, 200, {
        status: "ready",
        entitlement: {
          active: true,
          source: "managedOrgSubscription",
          features: {},
          limits: {},
        },
      });
      return;
    }
    if (url.pathname === "/api/threads/subscribe") {
      json(response, 200, {
        joinToken: `threads-token-${body.userId}`,
        joinCode: `threads-code-${body.userId}`,
      });
      return;
    }
    if (url.pathname === "/api/threads") {
      if (request.method === "GET") {
        json(response, 200, {
          threads: [...threads.values()].filter(
            (thread) =>
              thread.userId === url.searchParams.get("userId") &&
              thread.agentId === url.searchParams.get("agentId") &&
              (!thread.archived ||
                url.searchParams.get("includeArchived") === "true"),
          ),
          nextCursor: null,
        });
      } else if (request.method === "POST") {
        if (threads.has(body.threadId))
          json(response, 409, { error: "Already exists" });
        else
          json(response, 201, {
            thread: seedThread(body.threadId, body.userId, {
              agentId: body.agentId,
            }),
          });
      } else json(response, 405, {});
      return;
    }
    const match = url.pathname.match(
      /^\/api\/(?:_inspect\/)?threads\/([^/]+)(?:\/(connect|lock|messages|events|state))?$/,
    );
    if (match) {
      const id = decodeURIComponent(match[1]);
      const operation = match[2];
      const thread = threads.get(id);
      const userId =
        body?.userId ??
        url.searchParams.get("userId") ??
        request.headers["x-cpki-user-id"];
      if (operation === "lock" && request.method !== "POST") {
        const lock = locks.get(id);
        if (!lock || lock.runId !== body.runId) {
          json(response, 409, { error: "Stale run" });
          return;
        }
        if (request.method === "DELETE") {
          locks.delete(id);
          json(response, 204);
        } else {
          lock.renewals = (lock.renewals ?? 0) + 1;
          json(response, 200, { renewed: true, ttlSeconds: body.ttlSeconds });
        }
        return;
      }
      if (operation === "connect" && !thread) {
        json(response, 204);
        return;
      }
      if (!checkOwner(thread, userId, response)) return;
      if (operation === "connect")
        json(response, 200, { threadId: id, joinToken: `connect-token-${id}` });
      else if (operation === "lock") {
        if (locks.has(id)) {
          json(response, 409, { error: "Thread locked" });
          return;
        }
        locks.set(id, { runId: body.runId, userId, agentId: body.agentId });
        json(response, 200, {
          threadId: id,
          runId: body.runId,
          joinToken: `run-token-${body.runId}`,
        });
      } else if (operation === "messages")
        json(response, 200, { messages: thread.messages });
      else if (operation === "events")
        json(response, 200, {
          events: events.filter((event) => event.threadId === id),
        });
      else if (operation === "state")
        json(response, 200, { kind: "snapshot", state: thread.state ?? {} });
      else if (request.method === "GET") json(response, 200, { thread });
      else if (request.method === "PATCH") {
        Object.assign(thread, body);
        json(response, 200, { thread });
      } else if (request.method === "DELETE") {
        threads.delete(id);
        json(response, 204);
      } else json(response, 405, {});
      return;
    }
    if (url.pathname.startsWith("/api/memories")) {
      const userId = request.headers["x-cpki-user-id"];
      if (!userId) {
        json(response, 401, { error: "Trusted user header required" });
        return;
      }
      const id = decodeURIComponent(
        url.pathname.slice("/api/memories/".length),
      );
      if (url.pathname === "/api/memories/subscribe") {
        json(response, 200, {
          joinToken: "memory-token",
          joinCode: "memory-code",
          projectJoinToken: "project-token",
          projectJoinCode: "project-code",
        });
      } else if (request.method === "GET" || id === "recall") {
        json(response, 200, {
          memories: [...memories.values()].filter(
            (memory) => memory.userId === userId && !memory.invalidated,
          ),
        });
      } else if (request.method === "DELETE") {
        const memory = memories.get(id);
        if (!memory || memory.userId !== userId)
          json(response, 404, { error: "Memory not found" });
        else {
          memory.invalidated = true;
          json(response, 204);
        }
      } else {
        if (request.method === "PATCH") {
          const old = memories.get(id);
          if (!old || old.userId !== userId) {
            json(response, 404, { error: "Memory not found" });
            return;
          }
          old.invalidated = true;
        }
        const memory = { ...body, id: randomUUID(), userId };
        memories.set(memory.id, memory);
        json(response, request.method === "POST" ? 201 : 200, {
          memory,
          ...(request.method === "PATCH" ? { retiredId: id } : {}),
        });
      }
      return;
    }
    if (url.pathname.startsWith("/connector/annotate/")) {
      json(response, 200, {
        clientEventId: decodeURIComponent(url.pathname.split("/").at(-1)),
        ...body,
      });
      return;
    }
    json(response, 404, { error: "Unknown fixture route", path: url.pathname });
  }

  const gateway = new WebSocketServer({
    noServer: true,
    handleProtocols: (protocols) =>
      protocols.has("phoenix") ? "phoenix" : false,
  });
  server.on("upgrade", (request, socket, head) => {
    const protocols = (request.headers["sec-websocket-protocol"] ?? "").split(
      /,\s*/,
    );
    const expected = `base64url.bearer.phx.${Buffer.from(apiKey).toString("base64url")}`;
    if (
      !protocols.includes(expected) ||
      !request.url.startsWith("/runner/websocket")
    ) {
      socket.end("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
      return;
    }
    gateway.handleUpgrade(request, socket, head, (ws) =>
      gateway.emit("connection", ws),
    );
  });
  gateway.on("connection", (socket) => {
    const joined = new Map();
    socket.on("message", (raw) => {
      consume(raw).catch(() => socket.close(1008, "Invalid Phoenix frame"));
    });
    /** ACK only validated, immutable, ordered events after fixture persistence. */
    async function consume(raw) {
      const frame = JSON.parse(String(raw));
      assert.ok(Array.isArray(frame) && frame.length === 5);
      const [joinRef, ref, topic, name, payload] = frame;
      const reply = (status, response = {}) => {
        if (socket.readyState === 1)
          socket.send(
            JSON.stringify([
              joinRef,
              ref,
              topic,
              "phx_reply",
              { status, response },
            ]),
          );
      };
      if (name === "heartbeat") {
        reply("ok");
        return;
      }
      if (name === "phx_leave") {
        joined.delete(topic);
        reply("ok");
        return;
      }
      if (name === "phx_join") {
        if (faults.joinDelayMs) await delay(faults.joinDelayMs);
        const lock = locks.get(payload.thread_id);
        // An ACK-lost terminal replay can rejoin after gateway lock release.
        const replay = events.some(
          (event) =>
            event.runId === payload.run_id &&
            event.threadId === payload.thread_id &&
            ["RUN_FINISHED", "RUN_ERROR"].includes(event.type),
        );
        if (
          faults.joinReject ||
          topic !== `ingestion:${payload.run_id}` ||
          (!replay && lock?.runId !== payload.run_id)
        ) {
          reply("error", { retryable: false, reason: "invalid_lock" });
          return;
        }
        joined.set(topic, payload);
        joins.push({ ...payload, at: Date.now() });
        reply("ok");
        return;
      }
      if (!joined.has(topic) || !["event", "events"].includes(name)) {
        reply("error", { retryable: false });
        return;
      }
      const batch = name === "events" ? payload.events : [payload];
      for (const event of batch) {
        attempts.push(structuredClone(event));
        const scope = joined.get(topic);
        const previous = events.find(
          (value) =>
            value.metadata.cpki_event_id === event.metadata?.cpki_event_id,
        );
        const priorRun = events.filter((value) => value.runId === scope.run_id);
        if (
          event.threadId !== scope.thread_id ||
          event.thread_id !== scope.thread_id ||
          event.runId !== scope.run_id ||
          event.run_id !== scope.run_id ||
          !event.metadata?.cpki_event_id
        ) {
          reply("error", { retryable: false, reason: "bad_scope" });
          return;
        }
        if (previous) {
          try {
            assert.deepEqual(event, previous);
          } catch {
            reply("error", { retryable: false, reason: "changed_replay" });
            return;
          }
        } else {
          if (
            event.metadata.cpki_event_seq !== priorRun.length + 1 ||
            priorRun.some((value) =>
              ["RUN_FINISHED", "RUN_ERROR"].includes(value.type),
            )
          ) {
            reply("error", { retryable: false, reason: "bad_sequence" });
            return;
          }
          events.push(structuredClone(event));
          if (["RUN_FINISHED", "RUN_ERROR"].includes(event.type))
            locks.delete(scope.thread_id);
        }
      }
      if (faults.disconnectAfterPersist > 0) {
        faults.disconnectAfterPersist--;
        socket.terminate();
        return;
      }
      if (faults.dropAcks > 0) {
        faults.dropAcks--;
        return;
      }
      reply("ok");
    }
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const url = `http://127.0.0.1:${server.address().port}`;
  return {
    url,
    wsUrl: url.replace("http:", "ws:"),
    apiKey,
    threads,
    locks,
    memories,
    requests,
    events,
    attempts,
    joins,
    telemetry,
    agentInputs,
    faults,
    mock,
    mcp,
    mcpUrl: `${url}/mcp`,
    mcpCalls,
    seedThread,
    /** Await an observable protocol condition with a bounded diagnostic timeout. */
    async waitFor(predicate, timeoutMs = 5000) {
      const deadline = Date.now() + timeoutMs;
      while (!predicate()) {
        if (Date.now() >= deadline)
          throw new Error(`Platform condition timed out after ${timeoutMs} ms`);
        await delay(10);
      }
    },
    /** Terminate fixture-owned connections and release its listening sockets. */
    async close() {
      for (const socket of gateway.clients) socket.terminate();
      gateway.close();
      server.closeAllConnections();
      await Promise.all([
        new Promise((resolve) => server.close(resolve)),
        mock.stop(),
        mcp.stop(),
      ]);
    },
  };
}
