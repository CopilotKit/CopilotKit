import { describe, it, expect } from "vitest";
import {
  reconstructRequestSequence,
  ReplayError,
  ReplayScopeError,
} from "./cli-replay.js";
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

describe("reconstructRequestSequence — queried-test-id scope assertion", () => {
  const queried = "0190b8a0-0000-7000-8000-000000000001";

  it("hard-errors on an empty result for a known queried test-id (no falsely-authoritative empty timeline)", () => {
    // The live main() path always knows the test-id it queried. Zero rows must
    // be a hard error, not an empty-but-success timeline printed at exit 0.
    expect(() => reconstructRequestSequence([], queried)).toThrow(
      ReplayScopeError,
    );
    expect(() => reconstructRequestSequence([], queried)).toThrow(
      /no rows found/i,
    );
  });

  it("hard-errors when a returned row's test_id diverges from the queried id (no mixed-test timeline)", () => {
    const rows = [
      goodRow({ test_id: queried, mono_ns: 10 }),
      // A divergent-test row that must NOT be silently admitted.
      goodRow({
        test_id: "0190b8a0-0000-7000-8000-0000000000ff",
        mono_ns: 20,
      }),
    ];
    expect(() => reconstructRequestSequence(rows, queried)).toThrow(
      ReplayScopeError,
    );
    expect(() => reconstructRequestSequence(rows, queried)).toThrow(
      /does not match the queried test-id/i,
    );
  });

  it("returns the queried test-id and rows when every row matches", () => {
    const rows = [
      goodRow({ test_id: queried, boundary: "backend.request.ingress" }),
    ];
    const result = reconstructRequestSequence(rows, queried);
    expect(result.testId).toBe(queried);
    expect(result.events).toHaveLength(1);
  });
});
