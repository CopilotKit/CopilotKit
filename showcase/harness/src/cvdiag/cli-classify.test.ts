import { describe, it, expect } from "vitest";
import { classifyRows } from "./cli-classify.js";
import type { CvdiagEnvelope } from "./schema.js";

function ev(
  boundary: CvdiagEnvelope["boundary"],
  layer: CvdiagEnvelope["layer"],
  overrides: Partial<CvdiagEnvelope> = {},
): CvdiagEnvelope {
  return {
    schema_version: 1,
    test_id: "0190b8a0-0000-7000-8000-0000000000aa",
    trace_id: "0190b8a0-0000-7000-8000-0000000000aa",
    span_id: "0000000000000001",
    parent_span_id: null,
    layer,
    boundary,
    slug: "langgraph-python",
    demo: "chat",
    ts: "2026-06-18T00:00:00.000Z",
    mono_ns: 1,
    duration_ms: null,
    outcome: "info",
    edge_headers: {
      "cf-ray": null,
      "cf-mitigated": null,
      "cf-cache-status": null,
      "x-railway-edge": null,
      "x-railway-request-id": null,
      "x-hikari-trace": null,
      "retry-after": null,
      via: null,
      server: null,
    },
    metadata: {},
    ...overrides,
  };
}

describe("classifyRows — glue over the L2-A classifier", () => {
  it("classifies (h) provider-empty from a structurally-empty completion", () => {
    const rows: CvdiagEnvelope[] = [
      ev("backend.request.ingress", "backend", { mono_ns: 1 }),
      ev("backend.llm.call.start", "backend", { mono_ns: 2 }),
      ev("backend.llm.call.response", "backend", {
        mono_ns: 3,
        metadata: {
          provider: "anthropic",
          model: "claude",
          response_token_count: 0,
          latency_ms: 100,
          error_class: null,
        },
      }),
      // A genuine empty-200: the backend completed with outcome "ok" and emitted
      // NO backend.sse.event rows. ruleH gates on backendResponseOutcome === "ok"
      // so this success completion is required for (h) to fire.
      ev("backend.response.complete", "backend", {
        mono_ns: 4,
        outcome: "ok",
        metadata: { sse_event_count: 0 },
      }),
    ];
    const result = classifyRows(rows[0].test_id, rows);
    expect(result.flapClass).toBe("provider-empty");
    expect(result.letter).toBe("h");
  });

  it("strips cvdiag.* accounting rows before classifying", () => {
    const rows: CvdiagEnvelope[] = [
      ev("cvdiag.purge_audit", "backend", {
        mono_ns: 0,
        metadata: { row_count_events: 5 },
      }),
      ev("backend.request.ingress", "backend", { mono_ns: 1 }),
      ev("backend.llm.call.start", "backend", { mono_ns: 2 }),
      ev("backend.llm.call.response", "backend", {
        mono_ns: 3,
        metadata: {
          provider: "anthropic",
          model: "claude",
          response_token_count: 0,
          latency_ms: 100,
          error_class: null,
        },
      }),
      // Genuine empty-200 success completion (see (h) test above): required for
      // ruleH to fire under the corrected success-outcome gate.
      ev("backend.response.complete", "backend", {
        mono_ns: 4,
        outcome: "ok",
        metadata: { sse_event_count: 0 },
      }),
    ];
    const result = classifyRows(rows[0].test_id, rows);
    // The purge_audit row must NOT appear in the per-layer/boundary evidence.
    expect(
      result.evidence.boundaryHistogram["cvdiag.purge_audit"],
    ).toBeUndefined();
    expect(result.flapClass).toBe("provider-empty");
  });

  it("returns unclassified for an empty event set", () => {
    const result = classifyRows("0190b8a0-0000-7000-8000-0000000000aa", []);
    expect(result.flapClass).toBe("unclassified");
  });
});
