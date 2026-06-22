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
 * Per-pair divergence classification. "Failure" means the CvdiagOutcome closed
 * enum's failure subset {`err`, `timeout`} — `ok` AND `info` are success-class
 * (`info` is an informational terminal, see `isSuccess`).
 *   - `agree`                 both arms reached the same success/failure verdict
 *                             (both succeeded, OR both failed).
 *   - `edge-only-failure`     edge arm failed, internal arm succeeded — the
 *                             canonical edge-interference signature.
 *   - `internal-only-failure` internal arm failed, edge arm succeeded — points
 *                             AWAY from the edge (internal network / backend).
 *   - `both-failed`           both arms failed (NOT edge interference; the
 *                             fault is upstream of the edge).
 *   - `incomplete`            a pair is missing one of its two arms (e.g. the
 *                             internal run was skipped on an unreachable target).
 *   - `mis-correlated`        the two arms disagree on `slug`/`demo` — a
 *                             cross-layer correlation corruption. The pair is
 *                             excluded from the interference verdict and its
 *                             discrepancy is recorded (see `correlation_mismatch`).
 */
export type AbDivergence =
  | "agree"
  | "edge-only-failure"
  | "internal-only-failure"
  | "both-failed"
  | "incomplete"
  | "mis-correlated";

/** The per-arm identity recorded when a pair is mis-correlated. */
export interface AbArmIdentity {
  slug: string;
  demo: string;
}

/** One reconciled A/B pair. */
export interface AbPairResult {
  ab_pair_id: string;
  /**
   * The pair's authoritative slug, or `null` when the pair is `mis-correlated`
   * — a corrupted pair has NO single authoritative identity, so we do not
   * silently present one arm's slug. The conflicting per-arm values are
   * recoverable from `correlation_mismatch`.
   */
  slug: string | null;
  /** Authoritative demo; `null` for a `mis-correlated` pair (see `slug`). */
  demo: string | null;
  /** Edge-arm outcome, or `null` when the edge arm is missing. */
  edge_outcome: CvdiagOutcome | null;
  /** Internal-arm outcome, or `null` when the internal arm is missing. */
  internal_outcome: CvdiagOutcome | null;
  divergence: AbDivergence;
  /**
   * True when the edge and internal arms disagree on `slug`/`demo` (a
   * cross-layer mis-correlation). A mis-correlated pair is NOT counted toward
   * `edge_interference_suspected` — its outcome diff is untrustworthy.
   */
  mis_correlated: boolean;
  /**
   * The conflicting per-arm identities, present ONLY when `mis_correlated` is
   * true (both arms are present and disagree). Lets an operator locate the
   * correlation corruption. Absent for well-correlated or incomplete pairs.
   */
  correlation_mismatch?: {
    edge: AbArmIdentity;
    internal: AbArmIdentity;
  };
  /**
   * Whether EITHER arm observed an edge-interference signal (cf-mitigated /
   * retry-after / cf-ray mismatch). Surfaced so an edge arm that SUCCEEDED yet
   * observed interference is still reflected in the verdict.
   */
  edge_interference_signal: boolean;
}

/** The aggregate A/B report. */
export interface AbReport {
  /** Reconciled pairs, sorted by `ab_pair_id` for stable output. */
  pairs: AbPairResult[];
  /** Total number of distinct `ab_pair_id`s observed. */
  total_pairs: number;
  /**
   * Count of pairs that signal edge interference, attributed to the EDGE arm:
   *   - pairs classified `edge-only-failure` (edge failed, internal succeeded);
   *   - PLUS `agree` pairs whose EDGE arm observed an `edge_interference_signal`
   *     (a succeeding edge arm that nevertheless saw interference).
   * An INTERNAL-only signal does NOT count (interference is attributed to the
   * edge), and a both-failed / incomplete pair does NOT count from a signal (a
   * both-failed pair is documented as NOT edge interference). Mis-correlated
   * pairs are EXCLUDED — their diff is untrustworthy. Each qualifying pair is
   * counted at most once.
   */
  edge_interference_suspected: number;
}

/**
 * Whether a probe outcome is success-class (NOT a failure).
 *
 * The `CvdiagOutcome` closed enum is {`ok`, `err`, `timeout`, `info`}. The
 * FAILURE subset is {`err`, `timeout`} — this mirrors the classifier's failure
 * detection (`classifier.ts`: `ev.outcome === "err" || ev.outcome === "timeout"`).
 * `info` is an INFORMATIONAL terminal (e.g. the `info` accounting rows written
 * by `emit.ts` / `pb-writer.ts`), NOT a failure, so it is success-class here.
 * Treating `info` as a failure would misclassify an `info`-edge/`ok`-internal
 * pair as `edge-only-failure` and inflate `edge_interference_suspected`.
 */
function isSuccess(outcome: CvdiagOutcome): boolean {
  return outcome === "ok" || outcome === "info";
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

    // A pair carries an interference signal if EITHER arm observed one. Edge is
    // the primary source, but an internal-arm signal is informative too.
    const edgeInterferenceSignal =
      (edge?.edge_interference_signal ?? false) ||
      (internal?.edge_interference_signal ?? false);

    // Cross-layer mis-correlation: both arms present but disagreeing on
    // slug/demo means the correlation is corrupt and the outcome diff cannot be
    // trusted. Surface it (record the conflict, exclude from the verdict)
    // instead of silently picking one arm's identity.
    const misCorrelated =
      edge !== undefined &&
      internal !== undefined &&
      (edge.slug !== internal.slug || edge.demo !== internal.demo);

    let divergence: AbDivergence;
    let countsAsInterference = false;
    if (misCorrelated) {
      divergence = "mis-correlated";
    } else if (edgeOutcome === null || internalOutcome === null) {
      divergence = "incomplete";
    } else {
      divergence = classifyDivergence(edgeOutcome, internalOutcome);
      if (divergence === "edge-only-failure") countsAsInterference = true;
    }

    // Consume the per-pair interference signal toward the verdict, attributing
    // interference to the EDGE arm only and only for SUCCEEDING/`agree` pairs:
    //   - edge-arm-only: `edge_interference_suspected` attributes interference
    //     to the edge, so an INTERNAL-only signal (edge arm clean) must NOT
    //     inflate it (the OR'd `edgeInterferenceSignal` field above stays
    //     informational; the COUNT keys on the edge arm's own signal).
    //   - succeeding/`agree`-only: a both-failed pair is documented as NOT edge
    //     interference (the fault is upstream of the edge), and an incomplete
    //     pair has no diff to trust — so the signal increment applies only when
    //     the pair AGREES (both arms success-class). An `edge-only-failure`
    //     pair already counts via `countsAsInterference`, so the signal does
    //     not double-count it.
    const edgeArmSignal = edge?.edge_interference_signal ?? false;
    if (edgeArmSignal && divergence === "agree") countsAsInterference = true;
    if (countsAsInterference) edgeInterferenceSuspected += 1;

    const pair: AbPairResult = {
      ab_pair_id,
      // A mis-correlated pair has no single authoritative identity — do not
      // silently pick one arm's slug/demo (both live in correlation_mismatch).
      slug: misCorrelated ? null : ref.slug,
      demo: misCorrelated ? null : ref.demo,
      edge_outcome: edgeOutcome,
      internal_outcome: internalOutcome,
      divergence,
      mis_correlated: misCorrelated,
      edge_interference_signal: edgeInterferenceSignal,
    };
    if (misCorrelated) {
      pair.correlation_mismatch = {
        edge: { slug: edge.slug, demo: edge.demo },
        internal: { slug: internal.slug, demo: internal.demo },
      };
    }
    pairs.push(pair);
  }

  return {
    pairs,
    total_pairs: pairs.length,
    edge_interference_suspected: edgeInterferenceSuspected,
  };
}
