/**
 * validate-pins-core: pure drift-comparison logic extracted from the
 * validate-pins CI shell ratchet in `.github/workflows/showcase_validate.yml`.
 *
 * The CI job hashes the sorted, deduplicated `[FAIL] ...` stderr lines from
 * `validate-pins.ts` and compares the count + SHA-256 against the baseline
 * in `showcase/scripts/fail-baseline.json`. That comparison lived only in
 * shell — meaning: unreachable from the CLI, unreachable from
 * `showcase-harness`' pin-drift probe driver, and impossible to unit-test
 * without spinning up a shell harness. This module lifts the comparison
 * into TypeScript so both the CLI and the driver consume identical logic.
 *
 * The CLI itself still prints per-slug [FAIL]/[OK] lines exactly as before
 * — this module only handles the *comparison* against the baseline. The
 * CLI re-exports `computePinDrift` so the existing `validate-pins.ts`
 * import surface stays the single public entry point.
 *
 * Legacy-parity cross-check: `__tests__/validate-pins-core.test.ts`
 * drives the committed fail-baseline.json + a captured CLI stdout/stderr
 * snapshot through `computePinDrift` and asserts the structural result
 * matches what the CI shell would compute.
 */

import { createHash } from "crypto";

/** Raw baseline schema from `fail-baseline.json`. */
interface FailBaselineShape {
  validatePinsFailCount: number;
  validatePinsFailHash: string;
  // Other fields (_comment, baselineDemoCount) are allowed but not used here.
  [k: string]: unknown;
}

export interface PinDriftInput {
  /**
   * Contents of `showcase/scripts/fail-baseline.json` as a UTF-8 string.
   * Passed as a string (not a parsed object) so the caller doesn't have
   * to pre-parse — `computePinDrift` owns parsing + schema validation and
   * throws a typed error on bad input. An empty string means "no baseline
   * yet" (first-run seed) and yields `status: "no_baseline"`.
   */
  failBaselineJson: string;
  /**
   * The observable pin-drift state at call time. Two accepted shapes:
   *   - `{ failLines: string[] }`: the raw `[FAIL] ...` stderr lines from
   *     a validate-pins CLI invocation (matches what the CI shell hashes).
   *   - `{ failed: string[] }`: the already-sorted/deduped FAIL tuples
   *     (matches the probe driver's structured shape).
   *
   * Other shapes throw a schema error — we don't silently accept malformed
   * input because that would mask the case where the driver forgot to
   * collect FAIL lines entirely and would produce a spurious "improved".
   */
  currentWorkingState: unknown;
}

export type PinDriftStatus =
  | "stable"
  | "regressed"
  | "improved"
  | "no_baseline";

export interface PinDriftResult {
  status: PinDriftStatus;
  /** Current FAIL count from `currentWorkingState`. */
  actualCount: number;
  /** Baseline FAIL count from `fail-baseline.json`; `0` when no baseline. */
  baselineCount: number;
  /** `actualCount - baselineCount`. `0` on first run (no baseline). */
  delta: number;
  /**
   * SHA-256 of sorted, deduplicated, newline-joined FAIL lines — identical
   * to what the CI shell computes via `sort -u | shasum -a 256`. Empty
   * string when `actualCount === 0`.
   */
  hash: string;
  /** Sorted, deduplicated FAIL lines (the set underlying `hash`). */
  failed: string[];
}

/**
 * Raised when `failBaselineJson` is present but unparseable or schema-
 * invalid. Distinct class so callers can `instanceof`-route this to a
 * clear error exit rather than treating it as a legit "no_baseline"
 * (which would silently seed a wrong baseline on the next ratchet).
 */
export class PinDriftBaselineError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PinDriftBaselineError";
  }
}

/**
 * Parse the baseline file contents. Empty / whitespace-only input means
 * "no baseline has been seeded yet" and is NOT an error — the first-run
 * flow writes a seed baseline after a clean validate-pins run. Anything
 * else that fails schema validation throws `PinDriftBaselineError` so a
 * corrupted baseline never masquerades as a clean slate.
 */
function parseBaseline(jsonText: string): FailBaselineShape | null {
  if (jsonText.trim() === "") return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new PinDriftBaselineError(
      `fail-baseline.json: JSON syntax error: ${msg}`,
    );
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new PinDriftBaselineError(
      "fail-baseline.json: expected top-level object",
    );
  }
  const obj = parsed as Record<string, unknown>;
  const c = obj.validatePinsFailCount;
  const h = obj.validatePinsFailHash;
  if (typeof c !== "number" || !Number.isInteger(c) || c < 0) {
    throw new PinDriftBaselineError(
      "fail-baseline.json: validatePinsFailCount must be a non-negative integer",
    );
  }
  if (typeof h !== "string" || !/^[0-9a-f]{64}$/.test(h)) {
    throw new PinDriftBaselineError(
      "fail-baseline.json: validatePinsFailHash must be a 64-char lowercase hex SHA-256",
    );
  }
  return obj as FailBaselineShape;
}

/**
 * Extract the sorted, deduplicated FAIL-tuple list from the caller's
 * current-working-state payload. Accepts either `{ failLines: string[] }`
 * (raw CLI stderr, matches CI shell) or `{ failed: string[] }` (already
 * normalized, matches driver output). Anything else throws.
 */
function extractFailed(state: unknown): string[] {
  if (typeof state !== "object" || state === null) {
    throw new PinDriftBaselineError(
      "currentWorkingState: expected object with failLines or failed array",
    );
  }
  const obj = state as Record<string, unknown>;
  let lines: string[] | undefined;
  if (Array.isArray(obj.failLines)) {
    lines = obj.failLines.filter((l): l is string => typeof l === "string");
  } else if (Array.isArray(obj.failed)) {
    lines = obj.failed.filter((l): l is string => typeof l === "string");
  }
  if (!lines) {
    throw new PinDriftBaselineError(
      "currentWorkingState: missing failLines or failed array",
    );
  }
  // Only count actual `[FAIL]` lines when the caller passed raw stderr;
  // if the input is already the `failed` tuple set, every entry counts.
  // The CI shell filters `grep -E '^\[FAIL\]'`; we mirror that iff the
  // caller supplied `failLines` (raw stderr may include other text).
  const normalized = Array.isArray(obj.failLines)
    ? lines.filter((l) => /^\[FAIL\]/.test(l))
    : lines;
  // `LC_ALL=C sort -u` mirrors CI shell: byte-order sort + dedup.
  const deduped = Array.from(new Set(normalized));
  deduped.sort();
  return deduped;
}

/**
 * Compute the SHA-256 hash over the sorted, newline-joined failed set
 * and trailing newline, matching the CI `sort -u | shasum -a 256`
 * pipeline. Empty failed set → empty hash (nothing to ratchet against),
 * same as a green run in CI.
 */
function computeHash(failed: string[]): string {
  if (failed.length === 0) return "";
  // shasum of `sort -u` output includes a trailing newline after the last
  // line because `sort` always emits one. Match that so the hash matches
  // the CI shell byte-for-byte.
  const payload = failed.join("\n") + "\n";
  return createHash("sha256").update(payload).digest("hex");
}

/**
 * Main entry point. Determines drift status against the baseline:
 *   - `no_baseline`: empty baseline file (first-run seed path)
 *   - `stable`: count AND hash match baseline
 *   - `regressed`: count went up, OR count equal but hash differs
 *     (the "set drifted" case — one healed, another regressed)
 *   - `improved`: count went down
 *
 * The "equal count, different set → regressed" rule mirrors the CI shell
 * which fails the build on hash mismatch even when the count matches.
 * Treating it as "stable" would let a silent FAIL-set rotation slip
 * through — exactly the regression the hash ratchet exists to catch.
 */
export function computePinDrift(input: PinDriftInput): PinDriftResult {
  const baseline = parseBaseline(input.failBaselineJson);
  const failed = extractFailed(input.currentWorkingState);
  const actualCount = failed.length;
  const hash = computeHash(failed);

  if (baseline === null) {
    return {
      status: "no_baseline",
      actualCount,
      baselineCount: 0,
      delta: 0,
      hash,
      failed,
    };
  }

  const baselineCount = baseline.validatePinsFailCount;
  const baselineHash = baseline.validatePinsFailHash;
  const delta = actualCount - baselineCount;

  let status: PinDriftStatus;
  if (delta > 0) {
    status = "regressed";
  } else if (delta < 0) {
    status = "improved";
  } else if (hash !== baselineHash) {
    // Count equal, set drifted — the ratchet treats this as a regression
    // because one FAIL was fixed but another appeared. Never silently
    // green.
    status = "regressed";
  } else {
    status = "stable";
  }

  return {
    status,
    actualCount,
    baselineCount,
    delta,
    hash,
    failed,
  };
}
