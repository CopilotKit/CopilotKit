/**
 * cvdiag-backend.test.ts — L1-E red→green for the backend instrumentation
 * wrapper. Asserts that a synthetic handler invocation emits all 11 backend
 * boundaries, that secrets are scrubbed from captured metadata, and that the
 * per-(test_id, boundary) sequence_num ordering on SSE events is monotonic.
 *
 * Capture strategy: inject a DEBUG-tier `CvdiagEmitter` (all boundaries pass
 * the §6 tier matrix at debug, incl. the debug-only backend.sse.event) wired
 * to a fake PB writer seam, then read the flushed envelopes.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CvdiagEmitter } from "@/cvdiag/cvdiag-emitter";
import type { CvdiagEnvelope } from "@/cvdiag/cvdiag-emitter";
import { withCvdiagBackend } from "@/cvdiag-backend";

/** Collect every envelope the emitter flushes. */
function makeCapturingEmitter(): {
  emitter: CvdiagEmitter;
  captured: CvdiagEnvelope[];
} {
  const captured: CvdiagEnvelope[] = [];
  const emitter = new CvdiagEmitter({
    debug: true,
    layer: "backend",
    env: {
      SHOWCASE_ENV: "test",
      CVDIAG_DEBUG_ALLOW_LIST: "langgraph-typescript",
    },
    pbWriter: {
      async writeBatch(events) {
        captured.push(...events);
      },
    },
  });
  return { emitter, captured };
}

/** A handler that returns a small SSE-ish streamed body. */
function streamingHandler(
  chunks: string[],
): (req: Request) => Promise<Response> {
  return async () => {
    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const c of chunks) controller.enqueue(encoder.encode(c));
        controller.close();
      },
    });
    return new Response(body, {
      status: 200,
      headers: { "content-type": "text/event-stream" },
    });
  };
}

function makeRequest(): Request {
  return new Request("https://example.test/api/copilotkit", {
    method: "POST",
    headers: { "content-length": "42", "cf-ray": "abc-iad" },
  });
}

/** Drain a Response body fully so the stream-wrapper terminals fire. */
async function drain(res: Response): Promise<void> {
  if (!res.body) return;
  const reader = res.body.getReader();
  for (;;) {
    const { done } = await reader.read();
    if (done) break;
  }
}

const OPTS = {
  slug: "langgraph-typescript",
  agentName: "starterAgent",
  modelId: "gpt-4o",
  provider: "openai",
} as const;

describe("L1-E withCvdiagBackend: 11 backend boundaries", () => {
  beforeEach(() => {
    delete process.env.CVDIAG_BACKEND_EMITTER;
  });
  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.CVDIAG_BACKEND_EMITTER;
  });

  it("emits all 11 backend boundaries for a streaming handler", async () => {
    const { emitter, captured } = makeCapturingEmitter();
    const wrapped = withCvdiagBackend(
      streamingHandler(["data: a\n\n", "data: b\n\n"]),
      { ...OPTS, emitter },
    );

    const res = await wrapped(makeRequest());
    await drain(res);
    await emitter.flush();

    const boundaries = new Set(captured.map((e) => e.boundary));
    for (const expected of [
      "backend.request.ingress",
      "backend.agent.enter",
      "backend.llm.call.start",
      "backend.llm.call.response",
      "backend.sse.first_byte",
      "backend.sse.event",
      "backend.agent.exit",
      "backend.response.complete",
    ]) {
      expect(boundaries.has(expected)).toBe(true);
    }
    // Every emitted row is layer=backend with the integration slug.
    for (const env of captured) {
      expect(env.layer).toBe("backend");
      expect(env.slug).toBe("langgraph-typescript");
    }
  });

  it("emits backend.error.caught + err agent.exit when the handler throws", async () => {
    const { emitter, captured } = makeCapturingEmitter();
    const boom = new Error("backend exploded with sk-ABCDEFGHIJKLMNOP1234");
    const wrapped = withCvdiagBackend(
      async () => {
        throw boom;
      },
      { ...OPTS, emitter },
    );

    await expect(wrapped(makeRequest())).rejects.toThrow(/exploded/);
    await emitter.flush();

    const err = captured.find((e) => e.boundary === "backend.error.caught");
    expect(err).toBeDefined();
    // PII scrub: the sk- key must NOT appear in the captured message.
    expect(JSON.stringify(err?.metadata)).not.toContain("sk-ABCDEFGHIJKLMNOP");
    expect(JSON.stringify(err?.metadata)).toContain("[REDACTED]");

    const exit = captured.find((e) => e.boundary === "backend.agent.exit");
    expect(exit?.outcome).toBe("err");
  });

  it("emits monotonic sequence_num on backend.sse.event", async () => {
    const { emitter, captured } = makeCapturingEmitter();
    const wrapped = withCvdiagBackend(streamingHandler(["x", "y", "z"]), {
      ...OPTS,
      emitter,
    });
    await drain(await wrapped(makeRequest()));
    await emitter.flush();

    const seqs = captured
      .filter((e) => e.boundary === "backend.sse.event")
      .map((e) => e.metadata.sequence_num as number);
    expect(seqs).toEqual([0, 1, 2]);
  });

  it("emits backend.sse.first_byte exactly once", async () => {
    const { emitter, captured } = makeCapturingEmitter();
    const wrapped = withCvdiagBackend(streamingHandler(["a", "b", "c"]), {
      ...OPTS,
      emitter,
    });
    await drain(await wrapped(makeRequest()));
    await emitter.flush();

    const firstBytes = captured.filter(
      (e) => e.boundary === "backend.sse.first_byte",
    );
    expect(firstBytes).toHaveLength(1);
  });
});

describe("L1-E withCvdiagBackend: CVDIAG_BACKEND_EMITTER gate (default OFF)", () => {
  afterEach(() => {
    delete process.env.CVDIAG_BACKEND_EMITTER;
  });

  it("returns the handler UNWRAPPED when the env flag is unset", () => {
    const handler = async () => new Response("ok");
    const wrapped = withCvdiagBackend(handler, {
      slug: "langgraph-typescript",
      agentName: "starterAgent",
    });
    // Same function reference => transparent pass-through, zero overhead.
    expect(wrapped).toBe(handler);
  });

  it("wraps the handler when CVDIAG_BACKEND_EMITTER=1", () => {
    process.env.CVDIAG_BACKEND_EMITTER = "1";
    const handler = async () => new Response("ok");
    const wrapped = withCvdiagBackend(handler, {
      slug: "langgraph-typescript",
      agentName: "starterAgent",
    });
    expect(wrapped).not.toBe(handler);
  });
});
