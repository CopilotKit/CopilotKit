import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { ServerHandle } from "../servers/types";
import { readSSEStream } from "../helpers/sse-reader";

/**
 * Envelope shape returned in the debug SSE stream.
 */
interface DebugEnvelope {
  timestamp: number;
  agentId: string;
  threadId: string;
  runId: string;
  event: { type: string; [key: string]: unknown };
}

/**
 * Parse debug envelopes from SSE payload text.
 * Each `data:` line contains a JSON DebugEventEnvelope.
 */
function parseDebugEnvelopes(ssePayload: string): DebugEnvelope[] {
  const envelopes: DebugEnvelope[] = [];
  for (const line of ssePayload.split("\n")) {
    if (!line.startsWith("data:")) continue;
    const json = line.slice("data:".length).trim();
    if (!json) continue;
    try {
      envelopes.push(JSON.parse(json));
    } catch {
      // skip malformed lines
    }
  }
  return envelopes;
}

/**
 * Read from a long-lived debug SSE stream until we see a RUN_FINISHED envelope
 * or a timeout elapses. Returns the raw text accumulated.
 *
 * IMPORTANT: The debug SSE stream is long-lived and never closes on its own.
 * We MUST use a timeout to stop reading, and cancel the reader afterwards.
 */
async function readDebugStream(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  stream: ReadableStream<any>,
  opts: { waitMs?: number } = {},
): Promise<string> {
  const waitMs = opts.waitMs ?? 4_000;
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let output = "";
  let stopped = false;

  const timer = setTimeout(() => {
    stopped = true;
    reader.cancel().catch(() => {});
  }, waitMs);

  try {
    while (!stopped) {
      const result = await reader.read().catch(() => ({
        done: true as const,
        value: undefined,
      }));
      if (result.done) break;
      if (result.value) {
        output +=
          typeof result.value === "string"
            ? result.value
            : decoder.decode(result.value as Uint8Array, { stream: true });
        if (output.includes("RUN_FINISHED")) {
          stopped = true;
          break;
        }
      }
    }
  } finally {
    clearTimeout(timer);
    // Do NOT await reader.cancel() — on tee'd streams (created by response.clone()
    // inside the fetch handler), awaiting cancel hangs indefinitely because the
    // other tee branch is never consumed.
    reader.cancel().catch(() => {});
    output += decoder.decode();
  }

  return output;
}

/**
 * Shared debug-events integration test suite.
 *
 * @param name      Display name, e.g. "Express"
 * @param factory   Creates & starts the server; returns a handle
 */
export function debugEventsSuite(
  name: string,
  factory: (opts?: {
    capturedHeaders?: Record<string, string>[];
  }) => Promise<ServerHandle & { handler?: (r: Request) => Promise<Response> }>,
) {
  describe(`[${name}] Debug Events`, () => {
    let handle: ServerHandle & { handler?: (r: Request) => Promise<Response> };
    let doFetch: (
      input: RequestInfo | URL,
      init?: RequestInit,
    ) => Promise<Response>;

    beforeAll(async () => {
      handle = await factory();
      doFetch = handle.handler
        ? (input, init) =>
            handle.handler!(
              new Request(
                typeof input === "string" || input instanceof URL
                  ? input
                  : input,
                init,
              ),
            )
        : fetch;
    });

    afterAll(async () => {
      await handle?.close();
    });

    const url = (path: string) => `${handle.baseUrl}${handle.basePath}${path}`;

    // ─── SSE Format + Events + Envelope Structure ────────────────────
    // Combined into a single test to avoid orphaned debug-stream subscribers
    // across tests (the debug SSE endpoint is long-lived and its cleanup
    // depends on the request signal being aborted).

    it("streams debug event envelopes with correct structure during an agent run", async () => {
      const controller = new AbortController();

      // Start the debug stream. For real HTTP servers, fetch blocks until
      // the first chunk arrives, so we also start the agent run concurrently.
      const debugFetchPromise = doFetch(url("/cpk-debug-events"), {
        signal: controller.signal,
      });

      // Give the subscription a tick to register
      await new Promise((r) => setTimeout(r, 50));

      // Trigger an agent run. We start it AND begin consuming its stream
      // concurrently with reading the debug stream.
      const runRes = await doFetch(url("/agent/default/run"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          threadId: "t-debug-1",
          runId: "r-debug-1",
          messages: [],
          state: {},
          tools: [],
          context: [],
          forwardedProps: {},
        }),
      });

      // Consume the run stream and the debug stream concurrently.
      // Both are needed: the debug stream blocks until events arrive,
      // and the run stream must be consumed to avoid backpressure.
      const [debugRes, runPayload] = await Promise.all([
        debugFetchPromise,
        readSSEStream(runRes.body!),
      ]);

      // ── SSE response format ──
      expect(debugRes.status).toBe(200);
      expect(debugRes.headers.get("content-type")).toContain(
        "text/event-stream",
      );

      // Run completed — events should be buffered in the debug stream.
      expect(runPayload).toContain("RUN_FINISHED");

      // Read the debug stream (events are already in the buffer)
      const debugPayload = await readDebugStream(debugRes.body!, {
        waitMs: 4_000,
      });

      const envelopes = parseDebugEnvelopes(debugPayload);

      // ── Events flow through ──
      expect(envelopes.length).toBeGreaterThan(0);

      const eventTypes = envelopes.map((e) => e.event.type);
      expect(eventTypes).toContain("RUN_STARTED");
      expect(eventTypes).toContain("RUN_FINISHED");

      // ── Envelope structure ──
      for (const envelope of envelopes) {
        expect(typeof envelope.timestamp).toBe("number");
        expect(envelope.timestamp).toBeGreaterThan(0);
        expect(envelope.agentId).toBe("default");
        expect(typeof envelope.threadId).toBe("string");
        expect(typeof envelope.runId).toBe("string");
        expect(envelope.event).toBeDefined();
        expect(typeof envelope.event.type).toBe("string");
      }

      // Full event sequence
      expect(eventTypes).toContain("TEXT_MESSAGE_START");
      expect(eventTypes).toContain("TEXT_MESSAGE_CONTENT");
      expect(eventTypes).toContain("TEXT_MESSAGE_END");

      // Clean up: abort the request so the debug subscriber is removed
      controller.abort();
    }, 15_000);

    // ─── HTTP Method Validation ──────────────────────────────────────

    it("POST /cpk-debug-events returns 405", async () => {
      const res = await doFetch(url("/cpk-debug-events"), { method: "POST" });
      expect(res.status).toBe(405);
    });
  });
}

/**
 * Production guard test -- only needs the fetch-direct handler since
 * it doesn't require a real server. Tests that NODE_ENV=production
 * returns 404 for the debug-events endpoint.
 */
export function debugEventsProductionGuardSuite(
  createHandler: () => { handler: (r: Request) => Promise<Response> },
  baseUrl: string,
  basePath: string,
) {
  describe("[Fetch] Debug Events – production guard", () => {
    it("returns 404 when NODE_ENV=production", async () => {
      const originalEnv = process.env.NODE_ENV;
      try {
        process.env.NODE_ENV = "production";
        const { handler } = createHandler();
        const res = await handler(
          new Request(`${baseUrl}${basePath}/cpk-debug-events`),
        );
        expect(res.status).toBe(404);
      } finally {
        process.env.NODE_ENV = originalEnv;
      }
    });
  });
}
