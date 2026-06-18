import { describe, it, expect } from "vitest";
import { reconstructRequestSequence, ReplayError } from "./cli-replay.js";
import type { StoredCvdiagRow } from "./cli-replay.js";

// A minimal well-formed stored row (mirrors the cvdiag_events PB schema: the
// JSON columns arrive as already-parsed objects from pb-client's res.json()).
function goodRow(overrides: Partial<StoredCvdiagRow> = {}): StoredCvdiagRow {
  return {
    schema_version: 1,
    test_id: "0190b8a0-0000-7000-8000-000000000001",
    trace_id: "0190b8a0-0000-7000-8000-000000000001",
    span_id: "0000000000000001",
    parent_span_id: null,
    layer: "backend",
    boundary: "backend.request.ingress",
    slug: "langgraph-python",
    demo: "chat",
    ts: "2026-06-18T00:00:00.000Z",
    mono_ns: 1000,
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
    metadata: { method: "POST", path: "/agent", content_length: 42 },
    ...overrides,
  };
}

describe("reconstructRequestSequence — happy path", () => {
  it("reconstructs an ordered envelope sequence from well-formed rows", () => {
    const rows = [
      goodRow({ boundary: "backend.request.ingress", mono_ns: 10 }),
      goodRow({ boundary: "backend.response.complete", mono_ns: 20 }),
    ];
    const result = reconstructRequestSequence(rows);
    expect(result.events).toHaveLength(2);
    expect(result.events[0].boundary).toBe("backend.request.ingress");
    expect(result.events[1].boundary).toBe("backend.response.complete");
  });
});

describe("reconstructRequestSequence — malformed-row rejection", () => {
  it("rejects a row that is not a JSON object (bad JSON row) with a clear error", () => {
    // A row that failed JSON parsing upstream surfaces as a raw string.
    const rows: unknown[] = ["{not valid json"];
    expect(() => reconstructRequestSequence(rows)).toThrow(ReplayError);
    expect(() => reconstructRequestSequence(rows)).toThrow(/malformed/i);
  });

  it("rejects a row missing a required envelope field (test_id) with a clear error", () => {
    const broken = goodRow();
    // Remove a required field; the validator must reject, not crash.
    delete (broken as unknown as Record<string, unknown>)["test_id"];
    expect(() => reconstructRequestSequence([broken])).toThrow(ReplayError);
    expect(() => reconstructRequestSequence([broken])).toThrow(/test_id/i);
  });

  it("names the offending row index in the rejection message", () => {
    const rows: unknown[] = [goodRow(), { boundary: "x" }];
    expect(() => reconstructRequestSequence(rows)).toThrow(/row 1/i);
  });
});
