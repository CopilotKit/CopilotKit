import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { ServerHandle } from "../servers/types";
import { readSSEStream, extractEventTypes } from "../helpers/sse-reader";

/**
 * Shared multi-endpoint test suite.
 *
 * @param name      Display name, e.g. "Express"
 * @param factory   Creates & starts the server; returns a handle
 * @param requestFn Optional custom fetch function (for direct handler tests)
 */
export function multiEndpointSuite(
  name: string,
  factory: (opts?: {
    capturedHeaders?: Record<string, string>[];
  }) => Promise<ServerHandle & { handler?: (r: Request) => Promise<Response> }>,
  requestFn?: (
    input: RequestInfo | URL,
    init?: RequestInit,
  ) => Promise<Response>,
) {
  describe(`[${name}] Multi-Endpoint`, () => {
    let handle: ServerHandle & { handler?: (r: Request) => Promise<Response> };
    let doFetch: (
      input: RequestInfo | URL,
      init?: RequestInit,
    ) => Promise<Response>;

    beforeAll(async () => {
      handle = await factory();
      doFetch =
        requestFn ??
        (handle.handler
          ? (input, init) =>
              handle.handler!(
                new Request(
                  typeof input === "string" || input instanceof URL
                    ? input
                    : input,
                  init,
                ),
              )
          : fetch);
    });

    afterAll(async () => {
      await handle?.close();
    });

    const url = (path: string) => `${handle.baseUrl}${handle.basePath}${path}`;

    // ─── Info Endpoint ───────────────────────────────────────────────

    describe("Info endpoint", () => {
      it("GET /info returns 200", async () => {
        const res = await doFetch(url("/info"));
        expect(res.status).toBe(200);
      });

      it("GET /info returns version, agents, and audioFileTranscriptionEnabled", async () => {
        const res = await doFetch(url("/info"));
        const body = await res.json();
        expect(body).toHaveProperty("version");
        expect(typeof body.version).toBe("string");
        expect(body).toHaveProperty("agents");
        expect(body.agents).toHaveProperty("default");
        expect(body).toHaveProperty("audioFileTranscriptionEnabled", false);
      });

      it("GET /info agents.default has name field", async () => {
        const res = await doFetch(url("/info"));
        const body = await res.json();
        expect(body.agents.default).toHaveProperty("name");
      });
    });

    // ─── Agent Run ───────────────────────────────────────────────────

    describe("Agent Run", () => {
      it("POST /agent/default/run returns SSE stream", async () => {
        const res = await doFetch(url("/agent/default/run"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            threadId: "t-run-1",
            runId: "r-run-1",
            messages: [],
            state: {},
            tools: [],
            context: [],
            forwardedProps: {},
          }),
        });
        expect(res.status).toBe(200);
        expect(res.headers.get("content-type")).toContain("text/event-stream");
      });

      it("SSE stream contains correct event sequence", async () => {
        const res = await doFetch(url("/agent/default/run"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            threadId: "t-run-2",
            runId: "r-run-2",
            messages: [],
            state: {},
            tools: [],
            context: [],
            forwardedProps: {},
          }),
        });
        const payload = await readSSEStream(res.body!);
        const types = extractEventTypes(payload);

        expect(types).toContain("RUN_STARTED");
        expect(types).toContain("TEXT_MESSAGE_START");
        expect(types).toContain("TEXT_MESSAGE_CONTENT");
        expect(types).toContain("TEXT_MESSAGE_END");
        expect(types).toContain("RUN_FINISHED");
      });

      it("SSE stream TEXT_MESSAGE_CONTENT contains expected delta", async () => {
        const res = await doFetch(url("/agent/default/run"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            threadId: "t-run-3",
            runId: "r-run-3",
            messages: [],
            state: {},
            tools: [],
            context: [],
            forwardedProps: {},
          }),
        });
        const payload = await readSSEStream(res.body!);
        expect(payload).toContain("Hello from test");
      });

      it("returns 404 for unknown agent", async () => {
        const res = await doFetch(url("/agent/nonexistent/run"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            threadId: "t-404",
            runId: "r-404",
            messages: [],
            state: {},
            tools: [],
            context: [],
            forwardedProps: {},
          }),
        });
        expect(res.status).toBe(404);
      });
    });

    // ─── Agent Connect ───────────────────────────────────────────────

    describe("Agent Connect", () => {
      it("POST /agent/default/connect returns SSE stream", async () => {
        const res = await doFetch(url("/agent/default/connect"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            threadId: "t-conn-1",
            runId: "r-conn-1",
            messages: [],
            state: {},
            tools: [],
            context: [],
            forwardedProps: {},
          }),
        });
        expect(res.status).toBe(200);
        expect(res.headers.get("content-type")).toContain("text/event-stream");
      });

      it("returns 404 for unknown agent", async () => {
        const res = await doFetch(url("/agent/nonexistent/connect"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            threadId: "t-conn-404",
            runId: "r-conn-404",
            messages: [],
            state: {},
            tools: [],
            context: [],
            forwardedProps: {},
          }),
        });
        expect(res.status).toBe(404);
      });
    });

    // ─── Agent Stop ──────────────────────────────────────────────────

    describe("Agent Stop", () => {
      it("POST /agent/default/stop/:threadId returns JSON", async () => {
        const res = await doFetch(url("/agent/default/stop/thread-1"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
        });
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body).toHaveProperty("stopped");
        expect(typeof body.stopped).toBe("boolean");
      });

      it("returns 404 for unknown agent", async () => {
        const res = await doFetch(url("/agent/nonexistent/stop/thread-1"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
        });
        expect(res.status).toBe(404);
      });
    });

    // ─── Transcribe ──────────────────────────────────────────────────

    describe("Transcribe", () => {
      it("POST /transcribe returns 503 without transcription service", async () => {
        const res = await doFetch(url("/transcribe"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        });
        expect(res.status).toBe(503);
      });
    });

    // ─── CORS ────────────────────────────────────────────────────────

    describe("CORS", () => {
      it("OPTIONS preflight returns Access-Control-Allow-Origin", async () => {
        const res = await doFetch(url("/info"), {
          method: "OPTIONS",
          headers: {
            Origin: "https://example.com",
            "Access-Control-Request-Method": "GET",
          },
        });
        expect(res.headers.get("access-control-allow-origin")).toBe("*");
      });

      it("GET /info response includes CORS headers", async () => {
        const res = await doFetch(url("/info"), {
          headers: { Origin: "https://example.com" },
        });
        expect(res.headers.get("access-control-allow-origin")).toBe("*");
      });
    });

    // ─── HTTP Method Validation ──────────────────────────────────────

    describe("HTTP Method Validation", () => {
      it("POST /info returns 405", async () => {
        const res = await doFetch(url("/info"), { method: "POST" });
        expect(res.status).toBe(405);
      });

      it("GET /agent/default/run returns 405", async () => {
        const res = await doFetch(url("/agent/default/run"));
        expect(res.status).toBe(405);
      });
    });

    // ─── 404 Handling ────────────────────────────────────────────────

    describe("404 Handling", () => {
      it("GET /nonexistent returns 404", async () => {
        const res = await doFetch(url("/nonexistent"));
        expect(res.status).toBe(404);
      });
    });

    // ─── Header Forwarding ───────────────────────────────────────────

    describe("Header Forwarding", () => {
      it("forwards Authorization header to agent", async () => {
        const captured: Record<string, string>[] = [];
        const h = await factory({ capturedHeaders: captured });
        const localFetch =
          requestFn ??
          ((h as any).handler
            ? (input: any, init: any) =>
                (h as any).handler(new Request(input, init))
            : fetch);

        try {
          const res = await localFetch(
            `${h.baseUrl}${h.basePath}/agent/default/run`,
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: "Bearer test-token",
              },
              body: JSON.stringify({
                threadId: "t-hdr-1",
                runId: "r-hdr-1",
                messages: [],
                state: {},
                tools: [],
                context: [],
                forwardedProps: {},
              }),
            },
          );
          if (res.body) await readSSEStream(res.body);
          expect(captured.length).toBeGreaterThan(0);
          expect(captured[0]!.authorization).toBe("Bearer test-token");
        } finally {
          await h.close();
        }
      });

      it("forwards x-custom headers to agent", async () => {
        const captured: Record<string, string>[] = [];
        const h = await factory({ capturedHeaders: captured });
        const localFetch =
          requestFn ??
          ((h as any).handler
            ? (input: any, init: any) =>
                (h as any).handler(new Request(input, init))
            : fetch);

        try {
          const res = await localFetch(
            `${h.baseUrl}${h.basePath}/agent/default/run`,
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "X-Custom-Value": "my-value",
              },
              body: JSON.stringify({
                threadId: "t-hdr-2",
                runId: "r-hdr-2",
                messages: [],
                state: {},
                tools: [],
                context: [],
                forwardedProps: {},
              }),
            },
          );
          if (res.body) await readSSEStream(res.body);
          expect(captured.length).toBeGreaterThan(0);
          expect(captured[0]!["x-custom-value"]).toBe("my-value");
        } finally {
          await h.close();
        }
      });
    });
  });
}
