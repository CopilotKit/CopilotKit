/**
 * ab-report.ts — A/B comparison report engine for the CVDIAG Railway-internal
 * routing A/B (flap-observability spec Phase 8). The A/B issues an OPTIONAL
 * second probe run against the backend over Railway's INTERNAL network
 * (bypassing the public edge), correlated to the public-edge run by a shared
 * `ab_pair_id`. Diffing the two arms' terminal outcomes detects whether a flap
 * is caused by EDGE-LAYER interference (Cloudflare-WAF-style): if the edge arm
 * fails but the internal arm succeeds, the edge is the proximate cause.
 *
 * This module is the engine behind a future `cvdiag --ab-report` subcommand
 * (the CLI dispatch line is wired separately at integration time — this module
 * exports a clean callable and does NOT touch the CLI).
 *
 * WHY a dedicated record type (not `CvdiagEnvelope.metadata`): `ab_pair_id` and
 * the per-arm role are NOT declared in the closed-world per-boundary metadata
 * key set in `schema.ts` (owned by another slot), so they would be DROPPED by
 * the emit-time metadata validator if smuggled into a data-plane boundary's
 * `metadata`. The A/B correlation therefore rides on this module's OWN
 * `AbOutcomeRecord` wrapper, which the d4 A/B hook produces directly (one per
 * arm) and this engine consumes. Pure function: no I/O, no input mutation.
 */

import type { CvdiagOutcome } from "./schema.js";

/** Which network path an A/B arm took. */
export type AbArm = "edge" | "internal";

/**
 * One A/B arm's terminal outcome. Produced by the d4 A/B hook (one per arm),
 * correlated to its sibling by `ab_pair_id`. This is a STANDALONE record, not a
 * `CvdiagEnvelope` (see module header for the closed-world rationale).
 */
export interface AbOutcomeRecord {
  /** Shared correlation id linking the edge arm to the internal arm. */
  ab_pair_id: string;
  /** Which network path this arm exercised. */
  arm: AbArm;
  /** The probe-layer `test_id` for this arm (lowercase UUIDv7). */
  test_id: string;
  slug: string;
  demo: string;
  /** Terminal outcome of this arm's probe run. */
  outcome: CvdiagOutcome;
  /**
   * Whether an edge-interference signal (cf-mitigated / retry-after / a
   * cf-ray mismatch) was observed on this arm. Informational; the divergence
   * classification keys on the outcome diff, not on this flag.
   */
  edge_interference_signal: boolean;
}

/**
 * Per-pair divergence classification:
 *   - `agree`                 both arms reached the same success/failure verdict
 *                             (both succeeded, OR both failed but treated as
 *                             agreement only when BOTH are non-`ok`; see below).
 *   - `edge-only-failure`     edge arm failed, internal arm succeeded — the
 *                             canonical edge-interference signature.
 *   - `internal-only-failure` internal arm failed, edge arm succeeded — points
 *                             AWAY from the edge (internal network / backend).
 *   - `both-failed`           both arms failed (NOT edge interference; the
 *                             fault is upstream of the edge).
 *   - `incomplete`            a pair is missing one of its two arms (e.g. the
 *                             internal run was skipped on an unreachable target).
 */
export type AbDivergence =
  | "agree"
  | "edge-only-failure"
  | "internal-only-failure"
  | "both-failed"
  | "incomplete";

/** One reconciled A/B pair. */
export interface AbPairResult {
  ab_pair_id: string;
  slug: string;
  demo: string;
  /** Edge-arm outcome, or `null` when the edge arm is missing. */
  edge_outcome: CvdiagOutcome | null;
  /** Internal-arm outcome, or `null` when the internal arm is missing. */
  internal_outcome: CvdiagOutcome | null;
  divergence: AbDivergence;
}

/** The aggregate A/B report. */
export interface AbReport {
  /** Reconciled pairs, sorted by `ab_pair_id` for stable output. */
  pairs: AbPairResult[];
  /** Total number of distinct `ab_pair_id`s observed. */
  total_pairs: number;
  /** Count of pairs classified `edge-only-failure` (edge interference). */
  edge_interference_suspected: number;
}

/** A probe outcome counts as "success" only when it terminated cleanly. */
function isSuccess(outcome: CvdiagOutcome): boolean {
  return outcome === "ok";
}

/** Classify a fully-populated pair's divergence from its two arm outcomes. */
function classifyDivergence(
  edge: CvdiagOutcome,
  internal: CvdiagOutcome,
): AbDivergence {
  const edgeOk = isSuccess(edge);
  const internalOk = isSuccess(internal);
  if (edgeOk && internalOk) return "agree";
  if (!edgeOk && internalOk) return "edge-only-failure";
  if (edgeOk && !internalOk) return "internal-only-failure";
  return "both-failed";
}

/**
 * Compute the A/B comparison report from a flat list of arm outcome records.
 * Groups by `ab_pair_id`, diffs the edge arm against the internal arm, and
 * classifies each pair's divergence. Pairs missing an arm are `incomplete`.
 * Pure: does not mutate `records`.
 *
 * When a pair carries duplicate records for the same arm (e.g. a retried run),
 * the LAST record for that arm wins — the most-recent terminal outcome is the
 * authoritative one for the diff.
 */
export function computeAbReport(records: readonly AbOutcomeRecord[]): AbReport {
  const byPair = new Map<
    string,
    { edge?: AbOutcomeRecord; internal?: AbOutcomeRecord }
  >();
  for (const r of records) {
    let entry = byPair.get(r.ab_pair_id);
    if (entry === undefined) {
      entry = {};
      byPair.set(r.ab_pair_id, entry);
    }
    // Last write wins per arm (most-recent terminal outcome).
    entry[r.arm] = r;
  }

  const pairs: AbPairResult[] = [];
  let edgeInterferenceSuspected = 0;

  for (const ab_pair_id of [...byPair.keys()].sort()) {
    const { edge, internal } = byPair.get(ab_pair_id)!;
    const ref = edge ?? internal!;
    const edgeOutcome = edge?.outcome ?? null;
    const internalOutcome = internal?.outcome ?? null;

    let divergence: AbDivergence;
    if (edgeOutcome === null || internalOutcome === null) {
      divergence = "incomplete";
    } else {
      divergence = classifyDivergence(edgeOutcome, internalOutcome);
      if (divergence === "edge-only-failure") edgeInterferenceSuspected += 1;
    }

    pairs.push({
      ab_pair_id,
      slug: ref.slug,
      demo: ref.demo,
      edge_outcome: edgeOutcome,
      internal_outcome: internalOutcome,
      divergence,
    });
  }

  return {
    pairs,
    total_pairs: pairs.length,
    edge_interference_suspected: edgeInterferenceSuspected,
  };
}
