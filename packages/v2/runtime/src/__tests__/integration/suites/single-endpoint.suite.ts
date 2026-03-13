import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { ServerHandle } from "../servers/types";
import { readSSEStream, extractEventTypes } from "../helpers/sse-reader";

/**
 * Shared single-endpoint test suite.
 *
 * In single-route mode, all operations go through a single POST endpoint
 * with a JSON envelope: { method, params?, body? }
 */
export function singleEndpointSuite(
  name: string,
  factory: (opts?: {
    capturedHeaders?: Record<string, string>[];
  }) => Promise<ServerHandle & { handler?: (r: Request) => Promise<Response> }>,
  requestFn?: (
    input: RequestInfo | URL,
    init?: RequestInit,
  ) => Promise<Response>,
) {
  describe(`[${name}] Single-Endpoint`, () => {
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

    const endpoint = () => `${handle.baseUrl}${handle.basePath}`;

    function postEnvelope(
      envelope: Record<string, unknown>,
      extraHeaders?: Record<string, string>,
    ) {
      return doFetch(endpoint(), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...extraHeaders,
        },
        body: JSON.stringify(envelope),
      });
    }

    // ─── Info ────────────────────────────────────────────────────────

    describe("Info", () => {
      it("method: info returns 200 with runtime info", async () => {
        const res = await postEnvelope({ method: "info" });
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body).toHaveProperty("version");
        expect(body).toHaveProperty("agents");
        expect(body.agents).toHaveProperty("default");
        expect(body).toHaveProperty("audioFileTranscriptionEnabled", false);
      });
    });

    // ─── Agent Run ───────────────────────────────────────────────────

    describe("Agent Run", () => {
      it("method: agent/run returns SSE stream", async () => {
        const res = await postEnvelope({
          method: "agent/run",
          params: { agentId: "default" },
          body: {
            threadId: "t-srun-1",
            runId: "r-srun-1",
            messages: [],
            state: {},
            tools: [],
            context: [],
            forwardedProps: {},
          },
        });
        expect(res.status).toBe(200);
        expect(res.headers.get("content-type")).toContain("text/event-stream");
      });

      it("SSE stream contains correct event sequence", async () => {
        const res = await postEnvelope({
          method: "agent/run",
          params: { agentId: "default" },
          body: {
            threadId: "t-srun-2",
            runId: "r-srun-2",
            messages: [],
            state: {},
            tools: [],
            context: [],
            forwardedProps: {},
          },
        });
        const payload = await readSSEStream(res.body!);
        const types = extractEventTypes(payload);

        expect(types).toContain("RUN_STARTED");
        expect(types).toContain("TEXT_MESSAGE_CONTENT");
        expect(types).toContain("RUN_FINISHED");
      });

      it("SSE stream contains expected delta text", async () => {
        const res = await postEnvelope({
          method: "agent/run",
          params: { agentId: "default" },
          body: {
            threadId: "t-srun-3",
            runId: "r-srun-3",
            messages: [],
            state: {},
            tools: [],
            context: [],
            forwardedProps: {},
          },
        });
        const payload = await readSSEStream(res.body!);
        expect(payload).toContain("Hello from test");
      });

      it("returns 404 for unknown agent", async () => {
        const res = await postEnvelope({
          method: "agent/run",
          params: { agentId: "nonexistent" },
          body: {
            threadId: "t-s404",
            runId: "r-s404",
            messages: [],
            state: {},
            tools: [],
            context: [],
            forwardedProps: {},
          },
        });
        expect(res.status).toBe(404);
      });
    });

    // ─── Agent Connect ───────────────────────────────────────────────

    describe("Agent Connect", () => {
      it("method: agent/connect returns SSE stream", async () => {
        const res = await postEnvelope({
          method: "agent/connect",
          params: { agentId: "default" },
          body: {
            threadId: "t-sconn-1",
            runId: "r-sconn-1",
            messages: [],
            state: {},
            tools: [],
            context: [],
            forwardedProps: {},
          },
        });
        expect(res.status).toBe(200);
        expect(res.headers.get("content-type")).toContain("text/event-stream");
      });

      it("returns 404 for unknown agent", async () => {
        const res = await postEnvelope({
          method: "agent/connect",
          params: { agentId: "nonexistent" },
          body: {
            threadId: "t-sconn-404",
            runId: "r-sconn-404",
            messages: [],
            state: {},
            tools: [],
            context: [],
            forwardedProps: {},
          },
        });
        expect(res.status).toBe(404);
      });
    });

    // ─── Agent Stop ──────────────────────────────────────────────────

    describe("Agent Stop", () => {
      it("method: agent/stop returns stop result", async () => {
        const res = await postEnvelope({
          method: "agent/stop",
          params: { agentId: "default", threadId: "t-sstop-1" },
        });
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body).toHaveProperty("stopped");
        expect(typeof body.stopped).toBe("boolean");
      });

      it("returns 404 for unknown agent", async () => {
        const res = await postEnvelope({
          method: "agent/stop",
          params: { agentId: "nonexistent", threadId: "t-sstop-404" },
        });
        expect(res.status).toBe(404);
      });
    });

    // ─── Transcribe ──────────────────────────────────────────────────

    describe("Transcribe", () => {
      it("method: transcribe returns 503 without transcription service", async () => {
        const res = await postEnvelope({
          method: "transcribe",
          body: {},
        });
        expect(res.status).toBe(503);
      });
    });

    // ─── CORS ────────────────────────────────────────────────────────

    describe("CORS", () => {
      it("OPTIONS preflight returns CORS headers", async () => {
        const res = await doFetch(endpoint(), {
          method: "OPTIONS",
          headers: {
            Origin: "https://example.com",
            "Access-Control-Request-Method": "POST",
          },
        });
        expect(res.headers.get("access-control-allow-origin")).toBe("*");
      });

      it("POST response includes CORS headers", async () => {
        const res = await postEnvelope({ method: "info" });
        expect(res.headers.get("access-control-allow-origin")).toBe("*");
      });
    });

    // ─── Error Handling ──────────────────────────────────────────────

    describe("Error Handling", () => {
      it("GET returns 405 or 404 (only POST allowed)", async () => {
        const res = await doFetch(endpoint());
        // Express single-route only mounts POST/OPTIONS, so GET may 404 at the
        // framework layer before the fetch handler can return 405.
        expect([404, 405]).toContain(res.status);
      });

      it("unknown method returns 400", async () => {
        const res = await postEnvelope({ method: "unknown/method" });
        expect(res.status).toBe(400);
      });

      it("missing agentId for agent/run returns 400", async () => {
        const res = await postEnvelope({
          method: "agent/run",
          body: {
            threadId: "t-err-1",
            runId: "r-err-1",
            messages: [],
            state: {},
          },
        });
        expect(res.status).toBe(400);
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
          const res = await localFetch(`${h.baseUrl}${h.basePath}`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: "Bearer test-token",
            },
            body: JSON.stringify({
              method: "agent/run",
              params: { agentId: "default" },
              body: {
                threadId: "t-shdr-1",
                runId: "r-shdr-1",
                messages: [],
                state: {},
                tools: [],
                context: [],
                forwardedProps: {},
              },
            }),
          });
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
          const res = await localFetch(`${h.baseUrl}${h.basePath}`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-Custom-Value": "my-value",
            },
            body: JSON.stringify({
              method: "agent/run",
              params: { agentId: "default" },
              body: {
                threadId: "t-shdr-2",
                runId: "r-shdr-2",
                messages: [],
                state: {},
                tools: [],
                context: [],
                forwardedProps: {},
              },
            }),
          });
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
