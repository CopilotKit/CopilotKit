/**
 * ab-report.test.ts — A/B comparison report for the CVDIAG Railway-internal
 * routing A/B (flap-observability spec Phase 8). Pins the pairing-diff engine:
 * group A/B outcome records by `ab_pair_id`, diff the edge-arm vs the
 * internal-arm outcome, and classify each pair's divergence.
 *
 * RED→GREEN focus: the pairing diff. A pair whose edge arm timed out but whose
 * internal arm completed `ok` is the canonical "edge interference" signature
 * and MUST be reported as `edge-only-failure`; a pair that agrees on both arms
 * must NOT be flagged as divergent.
 */

import { describe, it, expect } from "vitest";

import { computeAbReport } from "./ab-report.js";
import type { AbOutcomeRecord } from "./ab-report.js";

function rec(overrides: Partial<AbOutcomeRecord>): AbOutcomeRecord {
  return {
    ab_pair_id: "pair-1",
    arm: "edge",
    test_id: "017f22e2-79b0-7cc3-98c4-dc0c0c07398f",
    slug: "langgraph-python",
    demo: "agentic-chat",
    outcome: "ok",
    edge_interference_signal: false,
    ...overrides,
  };
}

describe("ab-report — computeAbReport pairing diff", () => {
  it("flags edge-only-failure when edge=timeout but internal=ok (edge interference)", () => {
    const report = computeAbReport([
      rec({ ab_pair_id: "p1", arm: "edge", outcome: "timeout" }),
      rec({ ab_pair_id: "p1", arm: "internal", outcome: "ok" }),
    ]);
    expect(report.pairs).toHaveLength(1);
    const pair = report.pairs[0]!;
    expect(pair.ab_pair_id).toBe("p1");
    expect(pair.edge_outcome).toBe("timeout");
    expect(pair.internal_outcome).toBe("ok");
    expect(pair.divergence).toBe("edge-only-failure");
    expect(report.edge_interference_suspected).toBe(1);
  });

  it("reports agreement (no divergence) when both arms succeed", () => {
    const report = computeAbReport([
      rec({ ab_pair_id: "p2", arm: "edge", outcome: "ok" }),
      rec({ ab_pair_id: "p2", arm: "internal", outcome: "ok" }),
    ]);
    const pair = report.pairs[0]!;
    expect(pair.divergence).toBe("agree");
    expect(report.edge_interference_suspected).toBe(0);
  });

  it("reports internal-only-failure when internal fails but edge succeeds", () => {
    const report = computeAbReport([
      rec({ ab_pair_id: "p3", arm: "edge", outcome: "ok" }),
      rec({ ab_pair_id: "p3", arm: "internal", outcome: "err" }),
    ]);
    expect(report.pairs[0]!.divergence).toBe("internal-only-failure");
    expect(report.edge_interference_suspected).toBe(0);
  });

  it("reports both-failed when both arms fail (NOT edge interference)", () => {
    const report = computeAbReport([
      rec({ ab_pair_id: "p4", arm: "edge", outcome: "err" }),
      rec({ ab_pair_id: "p4", arm: "internal", outcome: "timeout" }),
    ]);
    expect(report.pairs[0]!.divergence).toBe("both-failed");
    expect(report.edge_interference_suspected).toBe(0);
  });

  it("reports incomplete when a pair is missing an arm (skipped internal run)", () => {
    const report = computeAbReport([
      rec({ ab_pair_id: "p5", arm: "edge", outcome: "ok" }),
    ]);
    const pair = report.pairs[0]!;
    expect(pair.divergence).toBe("incomplete");
    expect(pair.internal_outcome).toBeNull();
  });

  it("groups multiple pairs and aggregates the edge-interference count", () => {
    const report = computeAbReport([
      rec({ ab_pair_id: "a", arm: "edge", outcome: "timeout" }),
      rec({ ab_pair_id: "a", arm: "internal", outcome: "ok" }),
      rec({ ab_pair_id: "b", arm: "edge", outcome: "ok" }),
      rec({ ab_pair_id: "b", arm: "internal", outcome: "ok" }),
      rec({ ab_pair_id: "c", arm: "edge", outcome: "err" }),
      rec({ ab_pair_id: "c", arm: "internal", outcome: "ok" }),
    ]);
    expect(report.pairs).toHaveLength(3);
    expect(report.total_pairs).toBe(3);
    // a (timeout vs ok) and c (err vs ok) are both edge-only failures.
    expect(report.edge_interference_suspected).toBe(2);
    // Pairs are returned in a stable (sorted-by-id) order.
    expect(report.pairs.map((p) => p.ab_pair_id)).toEqual(["a", "b", "c"]);
  });

  it("returns an empty report for no records", () => {
    const report = computeAbReport([]);
    expect(report.pairs).toEqual([]);
    expect(report.total_pairs).toBe(0);
    expect(report.edge_interference_suspected).toBe(0);
  });
});
