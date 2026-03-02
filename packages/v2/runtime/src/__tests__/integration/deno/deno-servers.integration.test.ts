/**
 * Integration tests for the Deno server runtime.
 *
 * Strategy: Deno runs the HTTP server as a subprocess, vitest runs the tests.
 * This avoids all Deno module-resolution issues (JSON imports, sloppy imports)
 * while still verifying the runtime works under Deno's HTTP server.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawn, ChildProcess } from "node:child_process";
import { resolve } from "node:path";
import { readSSEStream, extractEventTypes } from "../helpers/sse-reader";

// ─── Deno Process Helpers ─────────────────────────────────────────────

const DENO_SERVER_SCRIPT = resolve(
  __dirname,
  "deno-server.ts",
);

interface DenoServer {
  baseUrl: string;
  basePath: string;
  process: ChildProcess;
  close: () => Promise<void>;
}

/**
 * Spawn a Deno subprocess that runs the server and return once it's ready.
 */
function startDenoServer(mode: "multi" | "single"): Promise<DenoServer> {
  return new Promise((resolve, reject) => {
    const proc = spawn("deno", [
      "run",
      "--allow-net",
      "--allow-read",
      "--allow-env",
      "--sloppy-imports",
      DENO_SERVER_SCRIPT,
      mode,
    ], {
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stderr = "";
    proc.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    const timeout = setTimeout(() => {
      proc.kill();
      reject(new Error(`Deno server (${mode}) failed to start within 30s.\nstderr: ${stderr}`));
    }, 30_000);

    proc.stdout?.once("data", (chunk: Buffer) => {
      clearTimeout(timeout);
      try {
        const { port } = JSON.parse(chunk.toString().trim());
        resolve({
          baseUrl: `http://localhost:${port}`,
          basePath: "/api/copilotkit",
          process: proc,
          close: async () => {
            proc.kill();
            // Wait for process exit
            await new Promise<void>((r) => proc.on("close", r));
          },
        });
      } catch (err) {
        proc.kill();
        reject(new Error(`Failed to parse Deno server output: ${chunk.toString()}\nstderr: ${stderr}`));
      }
    });

    proc.on("error", (err) => {
      clearTimeout(timeout);
      reject(new Error(`Failed to spawn Deno: ${err.message}`));
    });

    proc.on("close", (code) => {
      clearTimeout(timeout);
      if (code !== null && code !== 0) {
        reject(new Error(`Deno server exited with code ${code}.\nstderr: ${stderr}`));
      }
    });
  });
}

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
  let h: DenoServer;

  beforeAll(async () => {
    h = await startDenoServer("multi");
  }, 35_000);

  afterAll(async () => {
    await h?.close();
  });

  // Info
  it("GET /info returns 200 with runtime info", async () => {
    const res = await fetch(`${h.baseUrl}${h.basePath}/info`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty("version");
    expect(body).toHaveProperty("agents");
    expect(body.agents).toHaveProperty("default");
    expect(body).toHaveProperty("audioFileTranscriptionEnabled", false);
  });

  // Agent Run
  it("POST /agent/default/run returns SSE stream", async () => {
    const res = await fetch(`${h.baseUrl}${h.basePath}/agent/default/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: runBody(),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
  });

  it("SSE stream contains correct event sequence", async () => {
    const res = await fetch(`${h.baseUrl}${h.basePath}/agent/default/run`, {
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
    const res = await fetch(`${h.baseUrl}${h.basePath}/agent/default/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: runBody(),
    });
    const payload = await readSSEStream(res.body!);
    expect(payload).toContain("Hello from test");
  });

  it("returns 404 for unknown agent", async () => {
    const res = await fetch(`${h.baseUrl}${h.basePath}/agent/nonexistent/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: runBody(),
    });
    expect(res.status).toBe(404);
  });

  // Agent Connect
  it("POST /agent/default/connect returns SSE stream", async () => {
    const res = await fetch(`${h.baseUrl}${h.basePath}/agent/default/connect`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: connectBody(),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
  });

  // Agent Stop
  it("POST /agent/default/stop returns stop result", async () => {
    const res = await fetch(`${h.baseUrl}${h.basePath}/agent/default/stop/thread-1`, {
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
    const res = await fetch(`${h.baseUrl}${h.basePath}/transcribe`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(503);
  });

  // CORS
  it("OPTIONS preflight returns CORS headers", async () => {
    const res = await fetch(`${h.baseUrl}${h.basePath}/info`, {
      method: "OPTIONS",
      headers: {
        Origin: "https://example.com",
        "Access-Control-Request-Method": "GET",
      },
    });
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
  });

  it("POST response includes CORS headers", async () => {
    const res = await fetch(`${h.baseUrl}${h.basePath}/info`);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
  });

  // Error Handling
  it("POST /info returns 405", async () => {
    const res = await fetch(`${h.baseUrl}${h.basePath}/info`, { method: "POST" });
    expect(res.status).toBe(405);
  });

  it("GET /nonexistent returns 404", async () => {
    const res = await fetch(`${h.baseUrl}${h.basePath}/nonexistent`);
    expect(res.status).toBe(404);
  });
});

// ─── Single-Endpoint Tests ────────────────────────────────────────────

describe("[Deno] Single-Endpoint", () => {
  let h: DenoServer;

  beforeAll(async () => {
    h = await startDenoServer("single");
  }, 35_000);

  afterAll(async () => {
    await h?.close();
  });

  function postEnvelope(envelope: Record<string, unknown>) {
    return fetch(`${h.baseUrl}${h.basePath}`, {
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
    const res = await fetch(`${h.baseUrl}${h.basePath}`, {
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
    const res = await fetch(`${h.baseUrl}${h.basePath}`);
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
