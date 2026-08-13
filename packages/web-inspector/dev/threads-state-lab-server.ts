import type { IncomingMessage, ServerResponse } from "node:http";
import type { Duplex } from "node:stream";

import type { HttpServer, Plugin, ViteDevServer } from "vite";
import { WebSocketServer } from "ws";
import type { WebSocket } from "ws";

import {
  ALL_SCENARIO_KEYS,
  getThreadsStateScenario,
} from "./threads-state-lab.js";
import type {
  ScenarioKey,
  ThreadRequestCounters,
  ThreadRequestKind,
  ThreadsStateScenario,
} from "./threads-state-lab.js";

const BASE_PATH = "/inspector-lab-runtime";
const MAX_HTTP_BODY_BYTES = 4_096;
const MAX_SOCKET_PAYLOAD_BYTES = 8_192;

export type ThreadRequestLogEntry = Readonly<{
  sequence: number;
  kind: ThreadRequestKind;
  method: string;
  path: string;
}>;

export type ThreadRequestLog = Readonly<{
  counters: ThreadRequestCounters;
  entries: readonly ThreadRequestLogEntry[];
}>;

type MutableLedger = {
  counters: Record<ThreadRequestKind, number>;
  entries: ThreadRequestLogEntry[];
  nextSequence: number;
};

type AttachedSocket = Readonly<{
  scenarioKey: ScenarioKey;
  joinedTopics: Set<string>;
}>;

export type ThreadsStateLabRuntime = Readonly<{
  handleRequest: (request: Request) => Promise<Response>;
  handleNodeRequest: (
    request: IncomingMessage,
    response: ServerResponse,
  ) => Promise<void>;
  attachWebSocketServer: (server: HttpServer) => void;
  openSocketCount: () => number;
  dispose: () => Promise<void>;
}>;

export type ThreadsStateLabMiddleware = (
  request: IncomingMessage,
  response: ServerResponse,
  next: () => void,
) => void;

export type ThreadsStateLabServerAdapter = Readonly<{
  httpServer: HttpServer | null;
  useMiddleware: (handler: ThreadsStateLabMiddleware) => void;
}>;

function zeroCounters(): Record<ThreadRequestKind, number> {
  return {
    list: 0,
    subscribe: 0,
    inspect: 0,
    messages: 0,
    events: 0,
    state: 0,
  };
}

function createLedger(): MutableLedger {
  return { counters: zeroCounters(), entries: [], nextSequence: 1 };
}

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      "cache-control": "no-store",
      "content-type": "application/json; charset=utf-8",
    },
  });
}

function emptyResponse(status: number): Response {
  return new Response(null, {
    status,
    headers: { "cache-control": "no-store" },
  });
}

function errorResponse(status: number, error: string): Response {
  return jsonResponse({ error }, status);
}

function cloneFixture<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

/** Keeps the fixture stable while pointing realtime at the active loopback host. */
function runtimeInfoForRequest(
  scenario: ThreadsStateScenario,
  requestUrl: URL,
): ThreadsStateScenario["runtimeInfo"] {
  const runtimeInfo = cloneFixture(scenario.runtimeInfo);
  if (!runtimeInfo.intelligence) return runtimeInfo;
  const protocol = requestUrl.protocol === "https:" ? "wss:" : "ws:";
  return {
    ...runtimeInfo,
    intelligence: {
      ...runtimeInfo.intelligence,
      wsUrl: `${protocol}//${requestUrl.host}${BASE_PATH}/${scenario.key}/realtime`,
    },
  };
}

function isScenarioKey(value: string): value is ScenarioKey {
  return (ALL_SCENARIO_KEYS as readonly string[]).includes(value);
}

function decodeSegment(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

function parseRuntimePath(pathname: string): Readonly<{
  scenario?: ThreadsStateScenario;
  route: readonly string[];
  error?: Response;
}> {
  const segments = pathname.split("/").filter(Boolean);
  if (segments[0] !== "inspector-lab-runtime") {
    return { route: [], error: errorResponse(404, "Unknown lab route.") };
  }
  const encodedScenario = segments[1];
  if (!encodedScenario) {
    return { route: [], error: errorResponse(404, "Missing lab scenario.") };
  }
  const decodedScenario = decodeSegment(encodedScenario);
  if (decodedScenario === null || !isScenarioKey(decodedScenario)) {
    return {
      route: [],
      error: errorResponse(404, `Unknown lab scenario: ${encodedScenario}`),
    };
  }
  return {
    scenario: getThreadsStateScenario(decodedScenario),
    route: segments.slice(2),
  };
}

function snapshotLedger(ledger: MutableLedger): ThreadRequestLog {
  return {
    counters: { ...ledger.counters },
    entries: ledger.entries.map((entry) => ({ ...entry })),
  };
}

function recordRequest(
  ledger: MutableLedger,
  kind: ThreadRequestKind,
  request: Request,
): void {
  ledger.counters[kind] += 1;
  ledger.entries.push({
    sequence: ledger.nextSequence,
    kind,
    method: request.method,
    path: new URL(request.url).pathname,
  });
  ledger.nextSequence += 1;
}

function findThread(scenario: ThreadsStateScenario, encodedThreadId: string) {
  const threadId = decodeSegment(encodedThreadId);
  if (threadId === null) return undefined;
  return scenario.threads.find((thread) => thread.id === threadId);
}

async function readBoundedBody(request: IncomingMessage): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let total = 0;
  for await (const chunk of request) {
    const bytes =
      typeof chunk === "string" ? new TextEncoder().encode(chunk) : chunk;
    total += bytes.byteLength;
    if (total > MAX_HTTP_BODY_BYTES) {
      throw new Error("Request body exceeds the lab limit.");
    }
    chunks.push(bytes);
  }
  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

async function writeNodeResponse(
  response: ServerResponse,
  webResponse: Response,
): Promise<void> {
  response.statusCode = webResponse.status;
  for (const [key, value] of webResponse.headers) {
    response.setHeader(key, value);
  }
  const body = new Uint8Array(await webResponse.arrayBuffer());
  response.end(body);
}

function rejectUpgrade(request: IncomingMessage, status: number): void {
  const label =
    status === 401
      ? "Unauthorized"
      : status === 403
        ? "Forbidden"
        : "Bad Request";
  request.socket.write(
    `HTTP/1.1 ${status} ${label}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`,
  );
  request.socket.destroy();
}

function parsePhoenixFrame(value: string): readonly unknown[] | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return null;
  }
  return Array.isArray(parsed) && parsed.length === 5 ? parsed : null;
}

/** Creates one isolated HTTP/Phoenix Runtime used by Vite and the flat spec. */
export function createThreadsStateLabRuntime(): ThreadsStateLabRuntime {
  const ledgers = new Map<ScenarioKey, MutableLedger>(
    ALL_SCENARIO_KEYS.map((key) => [key, createLedger()]),
  );
  const sockets = new Map<WebSocket, AttachedSocket>();
  const webSocketServer = new WebSocketServer({
    noServer: true,
    maxPayload: MAX_SOCKET_PAYLOAD_BYTES,
  });
  let attachedServer: HttpServer | null = null;
  let disposed = false;

  const closeScenarioSockets = (scenarioKey: ScenarioKey): void => {
    for (const [socket, attached] of sockets) {
      if (attached.scenarioKey === scenarioKey) {
        sockets.delete(socket);
        socket.terminate();
      }
    }
  };

  const resetScenario = (scenarioKey: ScenarioKey): ThreadRequestLog => {
    closeScenarioSockets(scenarioKey);
    ledgers.set(scenarioKey, createLedger());
    return snapshotLedger(ledgers.get(scenarioKey) ?? createLedger());
  };

  const handleRequest = async (request: Request): Promise<Response> => {
    const url = new URL(request.url);
    const parsed = parseRuntimePath(url.pathname);
    if (parsed.error) return parsed.error;
    const scenario = parsed.scenario;
    if (!scenario) return errorResponse(404, "Missing lab scenario.");
    const ledger = ledgers.get(scenario.key);
    if (!ledger) return errorResponse(500, "Missing scenario ledger.");
    const [first, second, third] = parsed.route;

    if (request.method === "GET" && first === "info" && !second) {
      return jsonResponse(runtimeInfoForRequest(scenario, url));
    }
    if (request.method === "GET" && first === "inspector-metadata" && !second) {
      return scenario.inspectorMetadataBody === undefined
        ? emptyResponse(204)
        : jsonResponse(cloneFixture(scenario.inspectorMetadataBody));
    }
    if (request.method === "GET" && first === "request-log" && !second) {
      return jsonResponse(snapshotLedger(ledger));
    }
    if (
      request.method === "POST" &&
      first === "request-log" &&
      second === "reset" &&
      !third
    ) {
      return jsonResponse(resetScenario(scenario.key));
    }

    if (scenario.capability !== "enabled") {
      return errorResponse(404, "Threads are unavailable in this scenario.");
    }

    if (request.method === "GET" && first === "threads" && !second) {
      if (url.searchParams.get("agentId") !== scenario.agentId) {
        return errorResponse(400, "The lab requires its fixed agentId.");
      }
      recordRequest(ledger, "list", request);
      if (scenario.listError) {
        return errorResponse(
          scenario.listError.status,
          scenario.listError.message,
        );
      }
      return jsonResponse({
        threads: cloneFixture(scenario.threads),
        joinCode: scenario.joinCode,
        nextCursor: null,
      });
    }

    if (
      request.method === "POST" &&
      first === "threads" &&
      second === "subscribe" &&
      !third
    ) {
      const body = await request.text();
      if (new TextEncoder().encode(body).byteLength > MAX_HTTP_BODY_BYTES) {
        return errorResponse(413, "Request body exceeds the lab limit.");
      }
      return jsonResponse({ joinToken: scenario.joinToken });
    }

    if (first === "threads" && second) {
      const thread = findThread(scenario, second);
      if (!thread) return errorResponse(404, "Unknown fixture thread ID.");
      if (request.method === "GET" && !third) {
        recordRequest(ledger, "inspect", request);
        return jsonResponse(cloneFixture(thread));
      }
      if (
        request.method === "GET" &&
        (third === "messages" || third === "events" || third === "state") &&
        parsed.route.length === 3
      ) {
        const details = scenario.details[thread.id];
        if (!details) return errorResponse(404, "Missing fixture details.");
        recordRequest(ledger, third, request);
        return jsonResponse({ [third]: cloneFixture(details[third]) });
      }
    }

    return errorResponse(404, "Unknown lab Runtime route.");
  };

  const handleNodeRequest = async (
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> => {
    try {
      const host = request.headers.host ?? "127.0.0.1";
      const url = new URL(request.url ?? "/", `http://${host}`);
      const body =
        request.method === "GET" || request.method === "HEAD"
          ? undefined
          : await readBoundedBody(request);
      const webRequest = new Request(url, {
        method: request.method ?? "GET",
        headers: request.headers as HeadersInit,
        ...(body && body.byteLength > 0 ? { body: Buffer.from(body) } : {}),
      });
      await writeNodeResponse(response, await handleRequest(webRequest));
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Invalid lab request.";
      await writeNodeResponse(response, errorResponse(413, message));
    }
  };

  const upgradeListener = (
    request: IncomingMessage,
    socket: Duplex,
    head: Buffer,
  ): void => {
    const host = request.headers.host ?? "127.0.0.1";
    const url = new URL(request.url ?? "/", `http://${host}`);
    const match = url.pathname.match(
      /^\/inspector-lab-runtime\/([^/]+)\/realtime\/websocket$/,
    );
    if (!match) return;
    const decodedScenario = decodeSegment(match[1] ?? "");
    if (decodedScenario === null || !isScenarioKey(decodedScenario)) {
      rejectUpgrade(request, 400);
      return;
    }
    const scenario = getThreadsStateScenario(decodedScenario);
    if (scenario.capability !== "enabled") {
      rejectUpgrade(request, 403);
      return;
    }
    const tokens = url.searchParams.getAll("join_token");
    if (
      tokens.length !== 1 ||
      tokens[0] !== scenario.joinToken ||
      url.searchParams.get("vsn") !== "2.0.0"
    ) {
      rejectUpgrade(request, 401);
      return;
    }
    webSocketServer.handleUpgrade(request, socket, head, (webSocket) => {
      webSocketServer.emit("connection", webSocket, request, scenario.key);
    });
  };

  const closeListener = (): void => {
    void dispose();
  };

  webSocketServer.on(
    "connection",
    (
      socket: WebSocket,
      _request: IncomingMessage,
      scenarioKey: ScenarioKey,
    ) => {
      const attached: AttachedSocket = {
        scenarioKey,
        joinedTopics: new Set<string>(),
      };
      sockets.set(socket, attached);
      socket.on("close", () => sockets.delete(socket));
      socket.on("message", (data, isBinary) => {
        if (isBinary) {
          socket.close(1003, "Text frames only");
          return;
        }
        const frame = parsePhoenixFrame(data.toString());
        if (!frame) {
          socket.close(1007, "Invalid Phoenix frame");
          return;
        }
        const [joinRef, ref, topic, event] = frame;
        if (
          event === "heartbeat" &&
          topic === "phoenix" &&
          (typeof ref === "string" || ref === null)
        ) {
          socket.send(
            JSON.stringify([
              null,
              ref,
              "phoenix",
              "phx_reply",
              { status: "ok", response: {} },
            ]),
          );
          return;
        }
        const scenario = getThreadsStateScenario(attached.scenarioKey);
        const expectedTopic = `user_meta:${scenario.joinCode}`;
        if (event === "phx_join" && topic === expectedTopic) {
          if (!attached.joinedTopics.has(expectedTopic)) {
            attached.joinedTopics.add(expectedTopic);
            const ledger = ledgers.get(attached.scenarioKey);
            if (ledger) {
              const syntheticRequest = new Request(
                `http://127.0.0.1${BASE_PATH}/${scenario.key}/realtime`,
                { method: "GET" },
              );
              recordRequest(ledger, "subscribe", syntheticRequest);
            }
          }
          socket.send(
            JSON.stringify([
              joinRef,
              ref,
              expectedTopic,
              "phx_reply",
              { status: "ok", response: {} },
            ]),
          );
          return;
        }
        if (event === "phx_leave" && topic === expectedTopic) {
          socket.send(
            JSON.stringify([
              joinRef,
              ref,
              expectedTopic,
              "phx_reply",
              { status: "ok", response: {} },
            ]),
          );
          return;
        }
        socket.close(1008, "Invalid Phoenix topic or event");
      });
    },
  );

  const attachWebSocketServer = (server: HttpServer): void => {
    if (disposed) throw new Error("The lab Runtime is disposed.");
    if (attachedServer === server) return;
    if (attachedServer) {
      throw new Error("The lab Runtime is already attached to an HTTP server.");
    }
    attachedServer = server;
    server.on("upgrade", upgradeListener);
    server.on("close", closeListener);
  };

  async function dispose(): Promise<void> {
    if (disposed) return;
    disposed = true;
    if (attachedServer) {
      attachedServer.removeListener("upgrade", upgradeListener);
      attachedServer.removeListener("close", closeListener);
      attachedServer = null;
    }
    for (const socket of sockets.keys()) socket.terminate();
    sockets.clear();
    await new Promise<void>((resolve) => {
      try {
        webSocketServer.close(() => resolve());
      } catch {
        resolve();
      }
    });
  }

  return {
    handleRequest,
    handleNodeRequest,
    attachWebSocketServer,
    openSocketCount: () => sockets.size,
    dispose,
  };
}

/** Vite plugin that serves the deterministic loopback Runtime and Phoenix V2. */
export type ThreadsStateLabPlugin = Plugin &
  Readonly<{
    closeBundle: () => Promise<void>;
    configureLabServer: (server: ThreadsStateLabServerAdapter) => void;
    name: "web-inspector-threads-state-lab";
    transform?: never;
  }>;

export function createThreadsStateLabPlugin(): ThreadsStateLabPlugin {
  const runtime = createThreadsStateLabRuntime();
  const configureLabServer = (server: ThreadsStateLabServerAdapter): void => {
    if (!server.httpServer) {
      throw new Error("The Threads state lab requires Vite's HTTP server.");
    }
    runtime.attachWebSocketServer(server.httpServer);
    server.useMiddleware((request, response, next) => {
      const host = request.headers.host ?? "127.0.0.1";
      const url = new URL(request.url ?? "/", `http://${host}`);
      if (
        request.method === "GET" &&
        url.pathname === "/" &&
        url.searchParams.get("scenario") === "video-error"
      ) {
        response.setHeader("Content-Security-Policy", "media-src 'none'");
      }
      if (
        url.pathname !== BASE_PATH &&
        !url.pathname.startsWith(`${BASE_PATH}/`)
      ) {
        next();
        return;
      }
      void runtime.handleNodeRequest(request, response);
    });
  };
  return {
    name: "web-inspector-threads-state-lab",
    closeBundle() {
      return runtime.dispose();
    },
    configureLabServer,
    configureServer(server: ViteDevServer) {
      configureLabServer({
        httpServer: server.httpServer,
        useMiddleware(handler) {
          server.middlewares.use(handler);
        },
      });
    },
  };
}
