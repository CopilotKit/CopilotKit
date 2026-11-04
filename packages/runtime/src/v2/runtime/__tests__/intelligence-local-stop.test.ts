import { createServer } from "node:http";
import type { IncomingMessage, Server } from "node:http";
import type { AddressInfo } from "node:net";
import { AbstractAgent, EventType } from "@ag-ui/client";
import type { BaseEvent, RunAgentInput } from "@ag-ui/client";
import { Observable, Subject } from "rxjs";
import { WebSocket, WebSocketServer } from "ws";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createCopilotRuntimeHandler } from "../core/fetch-handler";
import { CopilotIntelligenceRuntime } from "../core/runtime";
import { CopilotKitIntelligence } from "../intelligence-platform/client";
import { STOP_RECORD_DEADLINE_MS } from "../runner/intelligence";

/**
 * A run the runtime stops itself (its stop route, or a server-side caller of
 * `runner.stop`) never passes through Intelligence. Intelligence's gateway
 * counts a run as cancelled only when its own stop record names the run when
 * the terminal event arrives, so the runtime records the stop the way a
 * browser's Stop does (`stop_run` on the thread's client channel) before it
 * sends the terminal event.
 *
 * The real runtime, runner and Phoenix client run against a fake Intelligence
 * on 127.0.0.1 that serves the REST API, the runner socket and the client
 * socket on one port and logs what arrives, in order.
 */

type Frame = [string | null, string | null, string, string, unknown];

const threadId = "550e8400-e29b-41d4-a716-446655440000";
const runId = "run-1";

type ConnectMode = "ok" | "http-error";
type StopMode = "ok" | "error" | "silent";

async function startFakeIntelligence(options: {
  connect: ConnectMode;
  stop: StopMode;
}) {
  const timeline: string[] = [];
  const connectBodies: unknown[] = [];
  const runnerSockets: WebSocket[] = [];
  const mintedTokens = new Set<string>();

  const server: Server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const raw = Buffer.concat(chunks).toString("utf8");
    const body = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const method = req.method ?? "GET";
    const send = (status: number, payload?: unknown) => {
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(payload === undefined ? "" : JSON.stringify(payload));
    };
    const match = url.pathname.match(/^\/api\/threads\/([^/]+)(\/[^/]+)?$/);
    if (!match) return send(404, { error: "not found" });
    const [, id, rest] = match;
    if (method === "GET" && rest === undefined) {
      return send(200, { thread: { id, name: "Existing", agentId: "test" } });
    }
    if (method === "GET" && rest === "/messages") {
      return send(200, { messages: [] });
    }
    if (rest === "/lock" && method === "POST") {
      return send(200, {
        threadId: id,
        runId: body.runId,
        joinToken: "browser-join-token",
        ttlSeconds: 120,
      });
    }
    if (rest === "/lock" && method === "PATCH") {
      return send(200, { ttlSeconds: 120, status: "renewed" });
    }
    if (rest === "/lock" && method === "DELETE") return send(204);
    if (rest === "/connect" && method === "POST") {
      timeline.push("POST /connect");
      connectBodies.push(body);
      if (options.connect === "http-error") {
        return send(500, { error: "internal" });
      }
      const joinToken = `stop-token-${mintedTokens.size + 1}`;
      mintedTokens.add(joinToken);
      return send(200, { threadId: id, joinToken });
    }
    return send(404, { error: "not found" });
  });

  const sockets = new WebSocketServer({ server });
  sockets.on("connection", (socket: WebSocket, req: IncomingMessage) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const isClient = url.pathname.startsWith("/client");
    if (isClient) {
      // The client socket admits only a token Intelligence minted, once.
      const token = url.searchParams.get("join_token") ?? "";
      if (!mintedTokens.delete(token)) {
        socket.close(1008);
        return;
      }
    } else {
      runnerSockets.push(socket);
    }
    socket.on("message", (data) => {
      const frame = JSON.parse(data.toString()) as Frame;
      const [joinRef, ref, topic, event, payload] = frame;
      const reply = (status: string) =>
        socket.send(
          JSON.stringify([
            joinRef,
            ref,
            topic,
            "phx_reply",
            { status, response: {} },
          ]),
        );
      if (event === "event" || event === "events") {
        const received = (
          event === "events"
            ? (payload as { events: BaseEvent[] }).events
            : [payload]
        ) as BaseEvent[];
        for (const item of received) timeline.push(`runner ${item.type}`);
        reply("ok");
        return;
      }
      if (isClient && event === "stop_run") {
        timeline.push(`stop_run ${(payload as { run_id: string }).run_id}`);
        if (options.stop === "ok") reply("ok");
        if (options.stop === "error") reply("error");
        return;
      }
      if (isClient && event === "phx_join") {
        timeline.push(`client join ${topic}`);
      }
      reply("ok");
    });
  });

  await new Promise<void>((resolve) =>
    server.listen(0, "127.0.0.1", () => resolve()),
  );
  const { port } = server.address() as AddressInfo;

  return {
    apiUrl: `http://127.0.0.1:${port}`,
    wsUrl: `ws://127.0.0.1:${port}`,
    timeline,
    connectBodies,
    /** Sends the stop Intelligence relays after its own stop to the runner. */
    relayGatewayStop() {
      for (const socket of runnerSockets) {
        socket.send(
          JSON.stringify([
            null,
            null,
            `ingestion:${runId}`,
            "ag-ui",
            { type: EventType.CUSTOM, name: "stop" },
          ]),
        );
      }
    },
    async close() {
      sockets.clients.forEach((socket) => socket.terminate());
      await new Promise<void>((resolve) => sockets.close(() => resolve()));
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

/** Starts a run and keeps producing until the test finishes it. */
const outputs: Subject<BaseEvent>[] = [];

class ControlledAgent extends AbstractAgent {
  run(input: RunAgentInput): Observable<BaseEvent> {
    const output = new Subject<BaseEvent>();
    outputs.push(output);
    return new Observable<BaseEvent>((subscriber) => {
      subscriber.next({
        type: EventType.RUN_STARTED,
        threadId: input.threadId,
        runId: input.runId,
      } as BaseEvent);
      return output.subscribe(subscriber);
    });
  }
}

let fake: Awaited<ReturnType<typeof startFakeIntelligence>>;
const previousTelemetrySetting = process.env.COPILOTKIT_TELEMETRY_DISABLED;
const needsWebSocket = typeof globalThis.WebSocket === "undefined";

beforeEach(() => {
  process.env.COPILOTKIT_TELEMETRY_DISABLED = "true";
  // Node 20 has no global WebSocket; Node 22+ uses its native one.
  if (needsWebSocket) vi.stubGlobal("WebSocket", WebSocket);
});

afterEach(async () => {
  for (const output of outputs.splice(0)) output.complete();
  await fake?.close();
  if (needsWebSocket) vi.unstubAllGlobals();
  if (previousTelemetrySetting === undefined) {
    delete process.env.COPILOTKIT_TELEMETRY_DISABLED;
  } else {
    process.env.COPILOTKIT_TELEMETRY_DISABLED = previousTelemetrySetting;
  }
});

function post(path: string, body: unknown) {
  return new Request(`http://127.0.0.1/api/copilotkit${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

/** Starts one run through the real runtime and waits for its first event. */
async function startRun(options: { connect: ConnectMode; stop: StopMode }) {
  fake = await startFakeIntelligence(options);
  const runtime = new CopilotIntelligenceRuntime({
    agents: { test: new ControlledAgent({ threadId }) },
    intelligence: new CopilotKitIntelligence({
      apiKey: "test-key",
      apiUrl: fake.apiUrl,
      wsUrl: fake.wsUrl,
    }),
    identifyUser: () => ({ id: "user-1", name: "User One" }),
    generateThreadNames: false,
  });
  const handler = createCopilotRuntimeHandler({
    runtime,
    basePath: "/api/copilotkit",
  });
  const response = await handler(
    post("/agent/test/run", {
      threadId,
      runId,
      messages: [{ id: "msg-1", role: "user", content: "Hello" }],
      tools: [],
      context: [],
      state: {},
      forwardedProps: {},
    }),
  );
  expect(response.status).toBe(200);
  await vi.waitFor(() =>
    expect(fake.timeline).toContain(`runner ${EventType.RUN_STARTED}`),
  );
  return {
    handler,
    stop: async () => {
      const started = Date.now();
      const stopped = await handler(
        post(`/agent/test/stop/${threadId}`, { runId }),
      );
      return {
        body: (await stopped.json()) as { stopped: boolean },
        elapsedMs: Date.now() - started,
      };
    },
  };
}

const terminal = `runner ${EventType.RUN_FINISHED}`;

describe("a run the runtime stops itself", () => {
  it("records the stop with Intelligence before the terminal event", async () => {
    const run = await startRun({ connect: "ok", stop: "ok" });

    const { body } = await run.stop();

    expect(body.stopped).toBe(true);
    expect(fake.connectBodies).toEqual([{ userId: "user-1", agentId: "test" }]);
    const stopAt = fake.timeline.indexOf(`stop_run ${runId}`);
    expect(stopAt).toBeGreaterThan(-1);
    expect(
      fake.timeline.indexOf(`client join thread:${threadId}`),
    ).toBeLessThan(stopAt);
    expect(fake.timeline.indexOf(terminal)).toBeGreaterThan(stopAt);
  });

  it("still stops at once when Intelligence refuses the join token", async () => {
    const run = await startRun({ connect: "http-error", stop: "ok" });

    const { body, elapsedMs } = await run.stop();

    expect(body.stopped).toBe(true);
    expect(fake.timeline).toContain("POST /connect");
    expect(fake.timeline).not.toContain(`stop_run ${runId}`);
    expect(fake.timeline).toContain(terminal);
    expect(elapsedMs).toBeLessThan(STOP_RECORD_DEADLINE_MS);
  });

  it("still stops at once when Intelligence refuses the stop", async () => {
    const run = await startRun({ connect: "ok", stop: "error" });

    const { body, elapsedMs } = await run.stop();

    expect(body.stopped).toBe(true);
    const stopAt = fake.timeline.indexOf(`stop_run ${runId}`);
    expect(stopAt).toBeGreaterThan(-1);
    expect(fake.timeline.indexOf(terminal)).toBeGreaterThan(stopAt);
    expect(elapsedMs).toBeLessThan(STOP_RECORD_DEADLINE_MS);
  });

  it("stops within the deadline when Intelligence never answers the stop", async () => {
    const run = await startRun({ connect: "ok", stop: "silent" });

    const { body, elapsedMs } = await run.stop();

    expect(body.stopped).toBe(true);
    expect(fake.timeline).toContain(terminal);
    expect(elapsedMs).toBeGreaterThanOrEqual(STOP_RECORD_DEADLINE_MS - 50);
    expect(elapsedMs).toBeLessThan(STOP_RECORD_DEADLINE_MS + 2_000);
  });
});

describe("runs that need no stop record", () => {
  it("sends none when the run finishes normally", async () => {
    await startRun({ connect: "ok", stop: "ok" });

    outputs[0]!.next({
      type: EventType.RUN_FINISHED,
      threadId,
      runId,
    } as BaseEvent);
    outputs[0]!.complete();

    await vi.waitFor(() => expect(fake.timeline).toContain(terminal));
    expect(fake.timeline).not.toContain("POST /connect");
    expect(fake.timeline).not.toContain(`stop_run ${runId}`);
  });

  it("sends none when Intelligence relayed the stop itself", async () => {
    await startRun({ connect: "ok", stop: "ok" });

    fake.relayGatewayStop();

    await vi.waitFor(() => expect(fake.timeline).toContain(terminal));
    expect(fake.timeline).not.toContain("POST /connect");
    expect(fake.timeline).not.toContain(`stop_run ${runId}`);
  });
});
