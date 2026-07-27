/**
 * FAC-121 repeated-run auth-token integration test.
 *
 * Proves that `x-copilotkit-auth` headers forwarded by the CopilotKit
 * runtime reach the LangGraph backend on consecutive runs and that the
 * backend graph node can read the token from the configurable channel
 * without the raw token ever appearing in the model-visible SSE stream.
 *
 * Proof path (mirrors the documented CopilotKit self-hosted auth path):
 *
 *   Test client
 *     → POST /api/copilotkit/agent/default/run  (with x-copilotkit-auth header)
 *     → CopilotKit Express runtime
 *         configureAgentForRequest merges x-* headers onto agent.headers
 *     → HttpAgent → POST <backend-fixture-url>  (x-copilotkit-auth forwarded)
 *     → Node.js backend fixture
 *         extracts x-copilotkit-auth from incoming request headers
 *         builds configurable = { "x-copilotkit-auth": "<token>" }
 *         invokes graphNode(configurable) — reads token from configurable
 *         returns SSE events with proof: token_present:<bool>
 *     → SSE stream flows back to test client
 *   Test asserts:
 *     - Run 1 and Run 2 both report token_present:true  (repeated-run proof)
 *     - No-auth run reports token_present:false
 *     - Raw token value never appears in any SSE stream
 *
 * The Node.js backend fixture implements the same configurable-header
 * admission layer that langgraph-api applies when
 * `configurable_headers.include: ["x-*"]` is set in langgraph.json.
 * It invokes a real JavaScript graph node function (not a hardcoded stub)
 * so the proof is bound to the actual received header value.
 *
 * @see packages/runtime/src/v2/runtime/__tests__/integration/fixtures/fac121-langgraph/
 *   langgraph.json — LangGraph server config documenting the x-* admission rule
 *   agent.py       — Python equivalent for running with langgraph-api or FastAPI
 */

import { createHash } from "node:crypto";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import type { AddressInfo } from "node:net";

import express from "express";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { HttpAgent } from "@ag-ui/client";
import { EventEncoder } from "@ag-ui/encoder";

import { CopilotRuntime } from "../core/runtime";
import { createCopilotExpressHandler } from "../endpoints/express";
import { InMemoryAgentRunner } from "../runner/in-memory";
import { readSSEStream } from "./integration/helpers/sse-reader";

// ---------------------------------------------------------------------------
// Graph node (JavaScript equivalent of the Python auth_node in agent.py).
// Reads x-copilotkit-auth from a configurable object and returns only a
// boolean flag and a 12-char SHA-256 hash prefix.  Never returns the raw token.
// ---------------------------------------------------------------------------

function graphNode(configurable: Record<string, string>): {
  token_present: boolean;
  token_hash_prefix: string;
} {
  const rawToken = configurable["x-copilotkit-auth"];
  const tokenPresent = typeof rawToken === "string" && rawToken.length > 0;
  const tokenHashPrefix = tokenPresent
    ? createHash("sha256").update(rawToken).digest("hex").slice(0, 12)
    : "";
  return { token_present: tokenPresent, token_hash_prefix: tokenHashPrefix };
}

// ---------------------------------------------------------------------------
// Backend fixture server.
//
// Simulates the documented langgraph-api configurable-header admission layer:
//   x-* request headers → config["configurable"]["x-copilotkit-auth"]
//   → graph node reads token from configurable
//   → returns AG-UI SSE events with safe proof output
//
// The response is bound to the actual received header value (not hard-coded).
// ---------------------------------------------------------------------------

interface BackendHandle {
  url: string;
  close: () => Promise<void>;
}

async function startBackendFixture(): Promise<BackendHandle> {
  return new Promise((resolve) => {
    const server = createServer(
      async (req: IncomingMessage, res: ServerResponse) => {
        // Consume request body (RunAgentInput sent by HttpAgent)
        const chunks: Buffer[] = [];
        for await (const chunk of req) {
          chunks.push(chunk as Buffer);
        }

        let runId = `run-${Date.now()}`;
        // threadId is required in RUN_STARTED / RUN_FINISHED by AG-UI EventSchemas.
        // The HttpAgent sends it as a top-level camelCase field in the body.
        let threadId = "default-thread";
        try {
          const body = JSON.parse(
            Buffer.concat(chunks).toString("utf-8"),
          ) as Record<string, unknown>;
          if (typeof body.runId === "string") runId = body.runId;
          if (typeof body.threadId === "string") threadId = body.threadId;
        } catch {
          /* ignore body parse errors — we only care about headers */
        }

        // Configurable-header admission layer (mirrors langgraph-api behavior):
        // copy admitted x-* request headers into a configurable object that the
        // graph node reads from.  langgraph-api does this when
        // configurable_headers.include: ["x-*"] is set in langgraph.json.
        const configurable: Record<string, string> = {};
        for (const [name, value] of Object.entries(req.headers)) {
          if (
            typeof name === "string" &&
            name.toLowerCase().startsWith("x-") &&
            typeof value === "string"
          ) {
            configurable[name.toLowerCase()] = value;
          }
        }

        // Invoke the real graph node function with the configurable.
        // The result depends on what the request actually contained — not
        // hard-coded.
        const proof = graphNode(configurable);

        const encoder = new EventEncoder({ accept: "text/event-stream" });
        res.writeHead(200, {
          "Content-Type": encoder.getContentType(),
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
          "X-Accel-Buffering": "no",
        });

        // RUN_STARTED and RUN_FINISHED both require threadId per AG-UI EventSchemas.
        res.write(
          encoder.encode({ type: "RUN_STARTED", runId, threadId } as never),
        );
        res.write(
          encoder.encode({
            type: "TEXT_MESSAGE_START",
            messageId: "m1",
          } as never),
        );
        // Proof in message content — only boolean flag and 12-char hash prefix,
        // never the raw token value.
        const proofText = `token_present:${proof.token_present} token_hash_prefix:${proof.token_hash_prefix}`;
        res.write(
          encoder.encode({
            type: "TEXT_MESSAGE_CONTENT",
            messageId: "m1",
            delta: proofText,
          } as never),
        );
        res.write(
          encoder.encode({
            type: "TEXT_MESSAGE_END",
            messageId: "m1",
          } as never),
        );
        res.write(
          encoder.encode({ type: "RUN_FINISHED", runId, threadId } as never),
        );
        res.end();
      },
    );

    server.listen(0, () => {
      const { port } = server.address() as AddressInfo;
      resolve({
        url: `http://localhost:${port}`,
        close: () =>
          new Promise<void>((res, rej) =>
            server.close((err) => (err ? rej(err) : res())),
          ),
      });
    });
  });
}

// ---------------------------------------------------------------------------
// CopilotKit Express runtime server.
// Uses an HttpAgent pointing to the backend fixture so that
// configureAgentForRequest merges x-* headers onto the outgoing request.
// ---------------------------------------------------------------------------

interface RuntimeServerHandle {
  baseUrl: string;
  basePath: string;
  close: () => Promise<void>;
}

async function startRuntimeServer(
  backendUrl: string,
): Promise<RuntimeServerHandle> {
  const basePath = "/api/copilotkit";

  // HttpAgent uses the documented header-forwarding path:
  // configureAgentForRequest reads x-* from the inbound request and
  // sets agent.headers so HttpAgent includes them on the outgoing call.
  const agent = new HttpAgent({ url: backendUrl });

  // The default forwardHeaders policy (undefined) already admits
  // authorization + custom x-* headers (including x-copilotkit-auth)
  // while blocking known infra headers (x-forwarded-*, x-copilotcloud-*, etc.).
  const runtime = new CopilotRuntime({
    agents: { default: agent as any },
    runner: new InMemoryAgentRunner(),
  });

  const app = express();
  app.use(
    createCopilotExpressHandler({
      runtime,
      basePath,
      cors: true,
    }),
  );

  return new Promise((resolve) => {
    const server = app.listen(0, () => {
      const { port } = server.address() as AddressInfo;
      resolve({
        baseUrl: `http://localhost:${port}`,
        basePath,
        close: () =>
          new Promise<void>((res, rej) =>
            server.close((err) => (err ? rej(err) : res())),
          ),
      });
    });
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Minimal RunAgentInput body for a CopilotKit /agent/default/run request. */
function makeRunBody(threadId: string, runId: string): string {
  return JSON.stringify({
    threadId,
    runId,
    messages: [],
    state: {},
    tools: [],
    context: [],
    forwardedProps: {},
  });
}

async function runAgent(
  runtimeBaseUrl: string,
  basePath: string,
  threadId: string,
  runId: string,
  extraHeaders: Record<string, string> = {},
): Promise<string> {
  const url = `${runtimeBaseUrl}${basePath}/agent/default/run`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...extraHeaders,
    },
    body: makeRunBody(threadId, runId),
  });

  if (!res.ok) {
    throw new Error(`Runtime returned ${res.status}: ${await res.text()}`);
  }

  if (!res.body) {
    throw new Error("No response body");
  }

  return readSSEStream(res.body);
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe("FAC-121: x-copilotkit-auth forwarding through CopilotKit runtime", () => {
  let backend: BackendHandle;
  let runtime: RuntimeServerHandle;

  /**
   * Token value used for repeated-run proof.  Only a boolean flag and a
   * 12-char hash prefix appear in SSE output — never the raw value.
   */
  const TEST_TOKEN = "fac121-integration-proof-token";
  const EXPECTED_HASH_PREFIX = createHash("sha256")
    .update(TEST_TOKEN)
    .digest("hex")
    .slice(0, 12);

  beforeAll(async () => {
    backend = await startBackendFixture();
    runtime = await startRuntimeServer(backend.url);
  });

  afterAll(async () => {
    await runtime.close();
    await backend.close();
  });

  it("Run 1: token accessible via configurable channel — token_present:true", async () => {
    const sseOutput = await runAgent(
      runtime.baseUrl,
      runtime.basePath,
      "fac121-thread",
      "run-1",
      { "x-copilotkit-auth": TEST_TOKEN },
    );

    expect(sseOutput).toContain("token_present:true");
    expect(sseOutput).toContain(`token_hash_prefix:${EXPECTED_HASH_PREFIX}`);
    // Raw token must never appear in the SSE stream.
    expect(sseOutput).not.toContain(TEST_TOKEN);
  });

  it("Run 2 (same thread): token still accessible on repeated run — token_present:true", async () => {
    // Second run on the same thread simulates the multi-turn scenario.
    const sseOutput = await runAgent(
      runtime.baseUrl,
      runtime.basePath,
      "fac121-thread",
      "run-2",
      { "x-copilotkit-auth": TEST_TOKEN },
    );

    expect(sseOutput).toContain("token_present:true");
    expect(sseOutput).toContain(`token_hash_prefix:${EXPECTED_HASH_PREFIX}`);
    expect(sseOutput).not.toContain(TEST_TOKEN);
  });

  it("Runs 1 and 2 report the same token identity (stable across turns)", async () => {
    // Run two more requests in sequence and compare hash prefixes.
    const sseA = await runAgent(
      runtime.baseUrl,
      runtime.basePath,
      "fac121-stability-thread",
      "run-a",
      { "x-copilotkit-auth": TEST_TOKEN },
    );
    const sseB = await runAgent(
      runtime.baseUrl,
      runtime.basePath,
      "fac121-stability-thread",
      "run-b",
      { "x-copilotkit-auth": TEST_TOKEN },
    );

    // Both runs must report the same hash prefix (same token, same identity).
    const extractHash = (sse: string): string => {
      const match = sse.match(/token_hash_prefix:([a-f0-9]+)/);
      return match?.[1] ?? "";
    };

    expect(extractHash(sseA)).toBe(EXPECTED_HASH_PREFIX);
    expect(extractHash(sseB)).toBe(EXPECTED_HASH_PREFIX);
    expect(extractHash(sseA)).toBe(extractHash(sseB));
  });

  it("No-header run: token_present:false when x-copilotkit-auth is absent", async () => {
    const sseOutput = await runAgent(
      runtime.baseUrl,
      runtime.basePath,
      "fac121-no-auth-thread",
      "run-no-auth",
      // No x-copilotkit-auth header.
    );

    expect(sseOutput).toContain("token_present:false");
    // Hash prefix must be empty (no token to hash).
    expect(sseOutput).toContain("token_hash_prefix:");
    // The hash prefix must not contain any hex characters after the colon —
    // it should be "token_hash_prefix:" followed immediately by a non-hex
    // character (space, newline, quote, etc.).  When the prefix is empty,
    // the value ends at the colon with no trailing hex digits.
    expect(sseOutput).toMatch(/token_hash_prefix:[^0-9a-f]/);
    expect(sseOutput).not.toContain(TEST_TOKEN);
  });

  it("Raw token never appears in SSE stream for any run", async () => {
    const runs = await Promise.all([
      runAgent(runtime.baseUrl, runtime.basePath, "leak-check-1", "lc-1", {
        "x-copilotkit-auth": TEST_TOKEN,
      }),
      runAgent(runtime.baseUrl, runtime.basePath, "leak-check-2", "lc-2", {
        "x-copilotkit-auth": TEST_TOKEN,
      }),
      runAgent(runtime.baseUrl, runtime.basePath, "leak-check-3", "lc-3"),
    ]);

    for (const sseOutput of runs) {
      expect(sseOutput).not.toContain(TEST_TOKEN);
    }
  });
});
