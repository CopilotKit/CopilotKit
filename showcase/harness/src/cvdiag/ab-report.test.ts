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

describe("ab-report — `info` is a non-failure (success-class) outcome", () => {
  // The closed CvdiagOutcome enum is {ok, err, timeout, info}. Only `err` and
  // `timeout` are failures; `info` is an informational terminal (see
  // classifier.ts:341-344 + emit.ts/pb-writer.ts `info` accounting rows).
  it("does NOT flag edge-only-failure when edge=info and internal=ok", () => {
    const report = computeAbReport([
      rec({ ab_pair_id: "i1", arm: "edge", outcome: "info" }),
      rec({ ab_pair_id: "i1", arm: "internal", outcome: "ok" }),
    ]);
    const pair = report.pairs[0]!;
    // RED (old isSuccess === "ok"): edge `info` is treated as a failure →
    // "edge-only-failure" and edge_interference_suspected === 1.
    expect(pair.divergence).toBe("agree");
    expect(report.edge_interference_suspected).toBe(0);
  });

  it("treats info/info as agreement, NOT both-failed", () => {
    const report = computeAbReport([
      rec({ ab_pair_id: "i2", arm: "edge", outcome: "info" }),
      rec({ ab_pair_id: "i2", arm: "internal", outcome: "info" }),
    ]);
    // RED (old): both non-`ok` → "both-failed".
    expect(report.pairs[0]!.divergence).toBe("agree");
    expect(report.edge_interference_suspected).toBe(0);
  });

  it("still flags edge-only-failure for err/timeout edge arms (info change is narrow)", () => {
    const report = computeAbReport([
      rec({ ab_pair_id: "i3", arm: "edge", outcome: "err" }),
      rec({ ab_pair_id: "i3", arm: "internal", outcome: "info" }),
    ]);
    // edge err (failure) vs internal info (success-class) → edge-only-failure.
    expect(report.pairs[0]!.divergence).toBe("edge-only-failure");
    expect(report.edge_interference_suspected).toBe(1);
  });
});

describe("ab-report — slug/demo mis-correlation between arms", () => {
  it("surfaces a mismatch instead of silently picking one arm's identity", () => {
    const report = computeAbReport([
      rec({
        ab_pair_id: "x1",
        arm: "edge",
        slug: "langgraph-python",
        outcome: "ok",
      }),
      rec({
        ab_pair_id: "x1",
        arm: "internal",
        slug: "crewai-python",
        outcome: "ok",
      }),
    ]);
    const pair = report.pairs[0]!;
    // RED (old): silently uses edge ?? internal → slug "langgraph-python",
    // divergence "agree", and the corruption is hidden.
    expect(pair.divergence).toBe("mis-correlated");
    expect(pair.mis_correlated).toBe(true);
    // The discrepancy is recorded so an operator can locate the corruption.
    expect(pair.correlation_mismatch).toEqual({
      edge: { slug: "langgraph-python", demo: "agentic-chat" },
      internal: { slug: "crewai-python", demo: "agentic-chat" },
    });
    // A mis-correlated pair MUST NOT count toward the interference verdict.
    expect(report.edge_interference_suspected).toBe(0);
  });

  it("detects a demo mismatch as well as a slug mismatch", () => {
    const report = computeAbReport([
      rec({
        ab_pair_id: "x2",
        arm: "edge",
        demo: "agentic-chat",
        outcome: "timeout",
      }),
      rec({
        ab_pair_id: "x2",
        arm: "internal",
        demo: "human-in-the-loop",
        outcome: "ok",
      }),
    ]);
    const pair = report.pairs[0]!;
    // Even though edge=timeout/internal=ok would normally be edge-only-failure,
    // a cross-layer mis-correlation MUST override + be excluded from the verdict.
    expect(pair.divergence).toBe("mis-correlated");
    expect(report.edge_interference_suspected).toBe(0);
  });

  it("does NOT flag mis-correlation when both arms agree on slug/demo", () => {
    const report = computeAbReport([
      rec({ ab_pair_id: "x3", arm: "edge", outcome: "ok" }),
      rec({ ab_pair_id: "x3", arm: "internal", outcome: "ok" }),
    ]);
    expect(report.pairs[0]!.divergence).toBe("agree");
    expect(report.pairs[0]!.mis_correlated).toBe(false);
  });
});

describe("ab-report — edge_interference_signal is consumed in the verdict", () => {
  it("flags interference when the edge arm SUCCEEDED yet observed an interference signal", () => {
    const report = computeAbReport([
      rec({
        ab_pair_id: "s1",
        arm: "edge",
        outcome: "ok",
        edge_interference_signal: true,
      }),
      rec({ ab_pair_id: "s1", arm: "internal", outcome: "ok" }),
    ]);
    const pair = report.pairs[0]!;
    // RED (old): outcome diff is "agree" and the captured signal is ignored,
    // so a real edge-interference data point is hidden.
    expect(pair.edge_interference_signal).toBe(true);
    expect(report.edge_interference_suspected).toBe(1);
  });

  it("does not double-count a pair already classified edge-only-failure", () => {
    const report = computeAbReport([
      rec({
        ab_pair_id: "s2",
        arm: "edge",
        outcome: "timeout",
        edge_interference_signal: true,
      }),
      rec({ ab_pair_id: "s2", arm: "internal", outcome: "ok" }),
    ]);
    // edge-only-failure already counts once; the signal must not add a second.
    expect(report.edge_interference_suspected).toBe(1);
  });

  it("leaves the verdict unchanged when no interference signal is present", () => {
    const report = computeAbReport([
      rec({
        ab_pair_id: "s3",
        arm: "edge",
        outcome: "ok",
        edge_interference_signal: false,
      }),
      rec({ ab_pair_id: "s3", arm: "internal", outcome: "ok" }),
    ]);
    expect(report.pairs[0]!.divergence).toBe("agree");
    expect(report.edge_interference_suspected).toBe(0);
  });

  // Fix 1a: the signal-based interference COUNT is attributed to the EDGE arm
  // only. An internal-only signal (edge arm clean) must NOT inflate the verdict
  // — `edge_interference_suspected` is documented as edge-arm-only (the metric
  // attributes interference to the edge). The informational
  // `edge_interference_signal` field still reflects EITHER arm.
  it("does NOT count interference from an internal-only signal (edge arm clean)", () => {
    const report = computeAbReport([
      rec({
        ab_pair_id: "n1",
        arm: "edge",
        outcome: "ok",
        edge_interference_signal: false,
      }),
      rec({
        ab_pair_id: "n1",
        arm: "internal",
        outcome: "ok",
        edge_interference_signal: true,
      }),
    ]);
    const pair = report.pairs[0]!;
    expect(pair.divergence).toBe("agree");
    // The field still surfaces that SOME arm saw a signal (informational).
    expect(pair.edge_interference_signal).toBe(true);
    // RED (old OR): internal-only signal counted → 1. GREEN: edge-arm-only → 0.
    expect(report.edge_interference_suspected).toBe(0);
  });

  // Fix 1b: the signal increment applies only to SUCCEEDING/`agree` pairs. A
  // both-failed pair is documented as "NOT edge interference" (the fault is
  // upstream of the edge), so an edge signal on a both-failed pair must NOT be
  // counted.
  it("does NOT count an edge signal on a both-failed pair", () => {
    const report = computeAbReport([
      rec({
        ab_pair_id: "n2",
        arm: "edge",
        outcome: "err",
        edge_interference_signal: true,
      }),
      rec({ ab_pair_id: "n2", arm: "internal", outcome: "timeout" }),
    ]);
    expect(report.pairs[0]!.divergence).toBe("both-failed");
    // RED (old): edge signal counted on a both-failed pair → 1. GREEN: 0.
    expect(report.edge_interference_suspected).toBe(0);
  });

  it("does NOT count an edge signal on an incomplete pair (internal arm missing)", () => {
    const report = computeAbReport([
      rec({
        ab_pair_id: "n3",
        arm: "edge",
        outcome: "ok",
        edge_interference_signal: true,
      }),
    ]);
    expect(report.pairs[0]!.divergence).toBe("incomplete");
    // RED (old): edge signal counted on an incomplete pair → 1. GREEN: 0.
    expect(report.edge_interference_suspected).toBe(0);
  });
});

describe("ab-report — mis-correlated pair has no authoritative identity", () => {
  // Fix 2: a mis-correlated pair must not present one arm's slug/demo as the
  // authoritative top-level identity (rationale: "do not silently pick one
  // arm's identity"). The conflicting identities live in `correlation_mismatch`.
  it("does NOT stamp the edge arm's slug/demo into the authoritative top-level pair", () => {
    const report = computeAbReport([
      rec({
        ab_pair_id: "m1",
        arm: "edge",
        slug: "langgraph-python",
        demo: "agentic-chat",
        outcome: "ok",
      }),
      rec({
        ab_pair_id: "m1",
        arm: "internal",
        slug: "crewai-python",
        demo: "human-in-the-loop",
        outcome: "ok",
      }),
    ]);
    const pair = report.pairs[0]!;
    expect(pair.mis_correlated).toBe(true);
    // RED (old): top-level slug/demo == the edge arm's values. GREEN: null
    // (no single authoritative identity for a corrupted pair).
    expect(pair.slug).toBeNull();
    expect(pair.demo).toBeNull();
    // Both arms' identities remain recoverable from the mismatch record.
    expect(pair.correlation_mismatch).toEqual({
      edge: { slug: "langgraph-python", demo: "agentic-chat" },
      internal: { slug: "crewai-python", demo: "human-in-the-loop" },
    });
  });
});
