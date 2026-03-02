/**
 * Integration tests for Deno server runtime.
 *
 * Run with:
 *   deno test --allow-net --allow-read --allow-env \
 *     src/__tests__/integration/deno/deno-servers.integration.test.ts
 *
 * These tests import the runtime from the built dist (not source) to avoid
 * Deno's strict JSON import attribute requirement on package.json imports.
 */

import { createDenoMultiServer } from "./deno-multi.ts";
import { createDenoSingleServer } from "./deno-single.ts";
import { readSSEStream, extractEventTypes } from "../helpers/sse-reader.ts";
import { assertEquals, assert } from "https://deno.land/std/assert/mod.ts";

// ─── Helpers ────────────────────────────────────────────────────────

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

// ─── Multi-Endpoint Tests ───────────────────────────────────────────

Deno.test("[Deno] Multi-Endpoint - GET /info returns 200 with runtime info", async () => {
  const h = await createDenoMultiServer();
  try {
    const res = await fetch(`${h.baseUrl}${h.basePath}/info`);
    assertEquals(res.status, 200);
    const body = await res.json();
    assert(body.version);
    assert(body.agents.default);
    assertEquals(body.audioFileTranscriptionEnabled, false);
  } finally {
    await h.close();
  }
});

Deno.test("[Deno] Multi-Endpoint - POST /agent/default/run returns SSE stream", async () => {
  const h = await createDenoMultiServer();
  try {
    const res = await fetch(`${h.baseUrl}${h.basePath}/agent/default/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: runBody(),
    });
    assertEquals(res.status, 200);
    assert(res.headers.get("content-type")?.includes("text/event-stream"));
    const payload = await readSSEStream(res.body!);
    const types = extractEventTypes(payload);
    assert(types.includes("RUN_STARTED"));
    assert(types.includes("TEXT_MESSAGE_CONTENT"));
    assert(types.includes("RUN_FINISHED"));
    assert(payload.includes("Hello from test"));
  } finally {
    await h.close();
  }
});

Deno.test("[Deno] Multi-Endpoint - returns 404 for unknown agent", async () => {
  const h = await createDenoMultiServer();
  try {
    const res = await fetch(`${h.baseUrl}${h.basePath}/agent/nonexistent/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: runBody(),
    });
    assertEquals(res.status, 404);
    await res.body?.cancel();
  } finally {
    await h.close();
  }
});

Deno.test("[Deno] Multi-Endpoint - POST /agent/default/connect returns SSE stream", async () => {
  const h = await createDenoMultiServer();
  try {
    const res = await fetch(`${h.baseUrl}${h.basePath}/agent/default/connect`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: connectBody(),
    });
    assertEquals(res.status, 200);
    assert(res.headers.get("content-type")?.includes("text/event-stream"));
    if (res.body) await readSSEStream(res.body);
  } finally {
    await h.close();
  }
});

Deno.test("[Deno] Multi-Endpoint - POST /agent/default/stop returns JSON", async () => {
  const h = await createDenoMultiServer();
  try {
    const res = await fetch(`${h.baseUrl}${h.basePath}/agent/default/stop/thread-1`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
    assertEquals(res.status, 200);
    const body = await res.json();
    assertEquals(typeof body.stopped, "boolean");
  } finally {
    await h.close();
  }
});

Deno.test("[Deno] Multi-Endpoint - POST /transcribe returns 503", async () => {
  const h = await createDenoMultiServer();
  try {
    const res = await fetch(`${h.baseUrl}${h.basePath}/transcribe`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    assertEquals(res.status, 503);
    await res.body?.cancel();
  } finally {
    await h.close();
  }
});

Deno.test("[Deno] Multi-Endpoint - OPTIONS preflight returns CORS headers", async () => {
  const h = await createDenoMultiServer();
  try {
    const res = await fetch(`${h.baseUrl}${h.basePath}/info`, {
      method: "OPTIONS",
      headers: {
        Origin: "https://example.com",
        "Access-Control-Request-Method": "GET",
      },
    });
    assertEquals(res.headers.get("access-control-allow-origin"), "*");
    await res.body?.cancel();
  } finally {
    await h.close();
  }
});

Deno.test("[Deno] Multi-Endpoint - POST /info returns 405", async () => {
  const h = await createDenoMultiServer();
  try {
    const res = await fetch(`${h.baseUrl}${h.basePath}/info`, { method: "POST" });
    assertEquals(res.status, 405);
    await res.body?.cancel();
  } finally {
    await h.close();
  }
});

Deno.test("[Deno] Multi-Endpoint - GET /nonexistent returns 404", async () => {
  const h = await createDenoMultiServer();
  try {
    const res = await fetch(`${h.baseUrl}${h.basePath}/nonexistent`);
    assertEquals(res.status, 404);
    await res.body?.cancel();
  } finally {
    await h.close();
  }
});

// ─── Single-Endpoint Tests ──────────────────────────────────────────

Deno.test("[Deno] Single-Endpoint - method: info returns runtime info", async () => {
  const h = await createDenoSingleServer();
  try {
    const res = await fetch(`${h.baseUrl}${h.basePath}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ method: "info" }),
    });
    assertEquals(res.status, 200);
    const body = await res.json();
    assert(body.version);
    assert(body.agents.default);
    assertEquals(body.audioFileTranscriptionEnabled, false);
  } finally {
    await h.close();
  }
});

Deno.test("[Deno] Single-Endpoint - method: agent/run returns SSE stream", async () => {
  const h = await createDenoSingleServer();
  try {
    const res = await fetch(`${h.baseUrl}${h.basePath}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        method: "agent/run",
        params: { agentId: "default" },
        body: JSON.parse(runBody()),
      }),
    });
    assertEquals(res.status, 200);
    assert(res.headers.get("content-type")?.includes("text/event-stream"));
    const payload = await readSSEStream(res.body!);
    assert(payload.includes("RUN_STARTED"));
    assert(payload.includes("Hello from test"));
    assert(payload.includes("RUN_FINISHED"));
  } finally {
    await h.close();
  }
});

Deno.test("[Deno] Single-Endpoint - returns 404 for unknown agent", async () => {
  const h = await createDenoSingleServer();
  try {
    const res = await fetch(`${h.baseUrl}${h.basePath}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        method: "agent/run",
        params: { agentId: "nonexistent" },
        body: JSON.parse(runBody()),
      }),
    });
    assertEquals(res.status, 404);
    await res.body?.cancel();
  } finally {
    await h.close();
  }
});

Deno.test("[Deno] Single-Endpoint - method: agent/connect returns SSE stream", async () => {
  const h = await createDenoSingleServer();
  try {
    const res = await fetch(`${h.baseUrl}${h.basePath}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        method: "agent/connect",
        params: { agentId: "default" },
        body: JSON.parse(connectBody()),
      }),
    });
    assertEquals(res.status, 200);
    assert(res.headers.get("content-type")?.includes("text/event-stream"));
    if (res.body) await readSSEStream(res.body);
  } finally {
    await h.close();
  }
});

Deno.test("[Deno] Single-Endpoint - method: agent/stop returns stop result", async () => {
  const h = await createDenoSingleServer();
  try {
    const res = await fetch(`${h.baseUrl}${h.basePath}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        method: "agent/stop",
        params: { agentId: "default", threadId: "t-1" },
      }),
    });
    assertEquals(res.status, 200);
    const body = await res.json();
    assertEquals(typeof body.stopped, "boolean");
  } finally {
    await h.close();
  }
});

Deno.test("[Deno] Single-Endpoint - method: transcribe returns 503", async () => {
  const h = await createDenoSingleServer();
  try {
    const res = await fetch(`${h.baseUrl}${h.basePath}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ method: "transcribe", body: {} }),
    });
    assertEquals(res.status, 503);
    await res.body?.cancel();
  } finally {
    await h.close();
  }
});

Deno.test("[Deno] Single-Endpoint - OPTIONS preflight returns CORS headers", async () => {
  const h = await createDenoSingleServer();
  try {
    const res = await fetch(`${h.baseUrl}${h.basePath}`, {
      method: "OPTIONS",
      headers: {
        Origin: "https://example.com",
        "Access-Control-Request-Method": "POST",
      },
    });
    assertEquals(res.headers.get("access-control-allow-origin"), "*");
    await res.body?.cancel();
  } finally {
    await h.close();
  }
});

Deno.test("[Deno] Single-Endpoint - GET returns 405", async () => {
  const h = await createDenoSingleServer();
  try {
    const res = await fetch(`${h.baseUrl}${h.basePath}`);
    assertEquals(res.status, 405);
    await res.body?.cancel();
  } finally {
    await h.close();
  }
});

Deno.test("[Deno] Single-Endpoint - unknown method returns 400", async () => {
  const h = await createDenoSingleServer();
  try {
    const res = await fetch(`${h.baseUrl}${h.basePath}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ method: "unknown/method" }),
    });
    assertEquals(res.status, 400);
    await res.body?.cancel();
  } finally {
    await h.close();
  }
});
