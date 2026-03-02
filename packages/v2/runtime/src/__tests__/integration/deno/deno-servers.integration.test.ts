/**
 * Integration tests for the Deno server runtime.
 *
 * These tests expect the Deno servers to already be running:
 *   - Multi-endpoint on http://localhost:3000
 *   - Single-endpoint on http://localhost:4000
 *
 * Start them with:
 *   deno run --allow-net --allow-read --allow-env --node-modules-dir=auto \
 *     src/__tests__/integration/deno/deno-server.ts
 *
 * Then run these tests:
 *   npx vitest run --config vitest.deno.config.mjs
 */

import { describe, it, expect } from "vitest";
import { readSSEStream, extractEventTypes } from "../helpers/sse-reader";

const MULTI_BASE = "http://localhost:3000/api/copilotkit";
const SINGLE_BASE = "http://localhost:4000/api/copilotkit";

// ─── Helpers ──────────────────────────────────────────────────────────

function runBody() {
  return JSON.stringify({
    threadId: `t-${crypto.randomUUID()}`,
    runId: `r-${crypto.randomUUID()}`,
    messages: [],
    state: {},
    tools: [],
    context: [],
    forwardedProps: {},
  });
}

function connectBody() {
  return JSON.stringify({
    threadId: `t-${crypto.randomUUID()}`,
    runId: `r-${crypto.randomUUID()}`,
    messages: [],
    state: {},
    tools: [],
    context: [],
    forwardedProps: {},
  });
}

// ─── Multi-Endpoint Tests ─────────────────────────────────────────────

describe("[Deno] Multi-Endpoint", () => {
  // Info
  it("GET /info returns 200 with runtime info", async () => {
    const res = await fetch(`${MULTI_BASE}/info`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty("version");
    expect(body).toHaveProperty("agents");
    expect(body.agents).toHaveProperty("default");
    expect(body).toHaveProperty("audioFileTranscriptionEnabled", false);
  });

  // Agent Run
  it("POST /agent/default/run returns SSE stream", async () => {
    const res = await fetch(`${MULTI_BASE}/agent/default/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: runBody(),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
  });

  it("SSE stream contains correct event sequence", async () => {
    const res = await fetch(`${MULTI_BASE}/agent/default/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: runBody(),
    });
    const payload = await readSSEStream(res.body!);
    const types = extractEventTypes(payload);
    expect(types).toContain("RUN_STARTED");
    expect(types).toContain("TEXT_MESSAGE_CONTENT");
    expect(types).toContain("RUN_FINISHED");
  });

  it("SSE stream contains expected delta text", async () => {
    const res = await fetch(`${MULTI_BASE}/agent/default/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: runBody(),
    });
    const payload = await readSSEStream(res.body!);
    expect(payload).toContain("Hello from test");
  });

  it("returns 404 for unknown agent", async () => {
    const res = await fetch(`${MULTI_BASE}/agent/nonexistent/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: runBody(),
    });
    expect(res.status).toBe(404);
  });

  // Agent Connect
  it("POST /agent/default/connect returns SSE stream", async () => {
    const res = await fetch(`${MULTI_BASE}/agent/default/connect`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: connectBody(),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
  });

  // Agent Stop
  it("POST /agent/default/stop returns stop result", async () => {
    const res = await fetch(`${MULTI_BASE}/agent/default/stop/thread-1`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty("stopped");
    expect(typeof body.stopped).toBe("boolean");
  });

  // Transcribe
  it("POST /transcribe returns 503 without transcription service", async () => {
    const res = await fetch(`${MULTI_BASE}/transcribe`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(503);
  });

  // CORS
  it("OPTIONS preflight returns CORS headers", async () => {
    const res = await fetch(`${MULTI_BASE}/info`, {
      method: "OPTIONS",
      headers: {
        Origin: "https://example.com",
        "Access-Control-Request-Method": "GET",
      },
    });
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
  });

  it("POST response includes CORS headers", async () => {
    const res = await fetch(`${MULTI_BASE}/info`);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
  });

  // Error Handling
  it("POST /info returns 405", async () => {
    const res = await fetch(`${MULTI_BASE}/info`, { method: "POST" });
    expect(res.status).toBe(405);
  });

  it("GET /nonexistent returns 404", async () => {
    const res = await fetch(`${MULTI_BASE}/nonexistent`);
    expect(res.status).toBe(404);
  });
});

// ─── Single-Endpoint Tests ────────────────────────────────────────────

describe("[Deno] Single-Endpoint", () => {
  function postEnvelope(envelope: Record<string, unknown>) {
    return fetch(SINGLE_BASE, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(envelope),
    });
  }

  // Info
  it("method: info returns 200 with runtime info", async () => {
    const res = await postEnvelope({ method: "info" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty("version");
    expect(body).toHaveProperty("agents");
    expect(body.agents).toHaveProperty("default");
    expect(body).toHaveProperty("audioFileTranscriptionEnabled", false);
  });

  // Agent Run
  it("method: agent/run returns SSE stream", async () => {
    const res = await postEnvelope({
      method: "agent/run",
      params: { agentId: "default" },
      body: JSON.parse(runBody()),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
  });

  it("SSE stream contains correct event sequence", async () => {
    const res = await postEnvelope({
      method: "agent/run",
      params: { agentId: "default" },
      body: JSON.parse(runBody()),
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
      body: JSON.parse(runBody()),
    });
    const payload = await readSSEStream(res.body!);
    expect(payload).toContain("Hello from test");
  });

  it("returns 404 for unknown agent", async () => {
    const res = await postEnvelope({
      method: "agent/run",
      params: { agentId: "nonexistent" },
      body: JSON.parse(runBody()),
    });
    expect(res.status).toBe(404);
  });

  // Agent Connect
  it("method: agent/connect returns SSE stream", async () => {
    const res = await postEnvelope({
      method: "agent/connect",
      params: { agentId: "default" },
      body: JSON.parse(connectBody()),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
  });

  // Agent Stop
  it("method: agent/stop returns stop result", async () => {
    const res = await postEnvelope({
      method: "agent/stop",
      params: { agentId: "default", threadId: "t-1" },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty("stopped");
    expect(typeof body.stopped).toBe("boolean");
  });

  // Transcribe
  it("method: transcribe returns 503 without transcription service", async () => {
    const res = await postEnvelope({
      method: "transcribe",
      body: {},
    });
    expect(res.status).toBe(503);
  });

  // CORS
  it("OPTIONS preflight returns CORS headers", async () => {
    const res = await fetch(SINGLE_BASE, {
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

  // Error Handling
  it("GET returns 405", async () => {
    const res = await fetch(SINGLE_BASE);
    expect(res.status).toBe(405);
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
