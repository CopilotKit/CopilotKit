/**
 * D6 — Parity vs Reference / Comparison engine.
 *
 * Pure-logic comparator over the four parity axes the D6 driver tracks
 * for each showcase (DOM, tools, stream, contract). Inputs are two
 * `ParitySnapshot` objects (a known-good reference + a freshly captured
 * snapshot) and an optional `ParityTolerances` override; output is a
 * structured `ParityReport` with a per-axis verdict, an aggregate
 * verdict, and per-axis details for the dashboard / Slack writer to
 * present.
 *
 * No I/O, no Playwright, no fetch — this module exists so the parity
 * verdict logic can be unit-tested with synthetic snapshots and so the
 * D6 driver / reference-capture script can share one canonical scoring
 * implementation.
 *
 * Axis rules (per D5-D6 spec, Notion 34c3aa38):
 *
 *   - **DOM** — captured DOM must be a SUPERSET of reference. Each
 *     reference element matches a captured element by `(tag, testId)`
 *     when `testId` is set, falling back to `(tag, classes)` (set-equal
 *     comparison) otherwise. Missing reference elements fail the axis;
 *     extra captured elements are tolerated and reported as a count.
 *
 *   - **Tools** — exact ordered sequence match between
 *     `reference.toolCalls` and `captured.toolCalls`. The first
 *     diverging index (or the first missing/extra slot when lengths
 *     differ) is reported so the dashboard can surface which tool call
 *     drifted.
 *
 *   - **Stream** — captured TTFT and P50 inter-chunk latency must each
 *     be within a configurable ratio of the reference. Both ratios
 *     default to "spec defaults" (TTFT 2x, P50 chunk 3x); these defaults
 *     are NOT empirically calibrated yet — see `DEFAULT_PARITY_TOLERANCES`
 *     for the calibration TODO. A reference value of 0 is treated as a
 *     fail (we cannot meaningfully compute a ratio against zero).
 *
 *   - **Contract** — the captured contract shape must contain every
 *     field path present in the reference, with a matching JS-type
 *     string (the snapshot producer reports `typeof` plus a few hand-
 *     rolled `"array"` / `"null"` distinctions). Missing fields fail the
 *     axis; extra captured fields are tolerated and reported as a count.
 */

/**
 * One element captured from the live DOM by the D6 driver. Children are
 * intentionally NOT modelled here — comparison is order-independent at a
 * given `(tag, testId)` / `(tag, classes)` level, so a flat list of
 * elements is sufficient and avoids brittle structural matching.
 */
export interface DomElement {
  tag: string;
  classes: string[];
  testId?: string;
}

/**
 * Snapshot produced by both the reference-capture script and the live
 * D6 driver. The four fields map 1:1 to the four parity axes; the
 * comparator only consumes these four and returns one verdict per axis.
 */
export interface ParitySnapshot {
  domElements: DomElement[];
  toolCalls: string[];
  streamProfile: {
    ttft_ms: number;
    p50_chunk_ms: number;
    total_chunks: number;
  };
  /** Field path → JS-type string (`"string"`, `"number"`, `"array"`, …). */
  contractShape: Record<string, string>;
}

/**
 * Per-axis tolerance knobs. Stream ratios are configurable so showcases
 * with known latency variance (e.g. cold-start providers) can override
 * the defaults without forking the comparator.
 */
export interface ParityTolerances {
  /**
   * Captured TTFT (ms) divided by reference TTFT (ms) must be ≤ this.
   * Default 2.0 — needs empirical calibration; see
   * `DEFAULT_PARITY_TOLERANCES` below.
   */
  ttft_ratio: number;
  /**
   * Captured P50 inter-chunk latency divided by reference P50 must be
   * ≤ this. Default 3.0 — needs empirical calibration.
   */
  p50_chunk_ratio: number;
}

export type AxisVerdict = "pass" | "fail";

export interface ParityReport {
  axes: {
    dom: AxisVerdict;
    tools: AxisVerdict;
    stream: AxisVerdict;
    contract: AxisVerdict;
  };
  details: {
    dom?: {
      missing: DomElement[];
      extra_count: number;
    };
    tools?: {
      reference: string[];
      captured: string[];
      first_divergence_index?: number;
    };
    stream?: {
      ttft_ratio: number;
      p50_chunk_ratio: number;
      /**
       * Populated when a divisor is zero or NaN — the axis fails and
       * downstream consumers surface the message instead of a numeric
       * ratio. `ttft_ratio` / `p50_chunk_ratio` are still reported as
       * `Infinity` in that case so the dashboard's existing numeric
       * formatter doesn't crash on `undefined`.
       */
      reason?: string;
    };
    contract?: {
      /** Field paths absent in captured (`captured[path] === undefined`). */
      missing_fields: string[];
      /**
       * Field paths present in captured but with a JS-type that does not
       * equal the reference type. Distinct from `missing_fields` because
       * a type drift (e.g. `string` → `number`) is operationally a
       * different signal than an outright missing field — the dashboard
       * surfaces the two separately so triagers can tell whether a field
       * vanished or its shape regressed.
       */
      type_mismatched_fields: string[];
      extra_field_count: number;
    };
  };
  overall: AxisVerdict;
  failure_count: number;
}

/**
 * Spec-default tolerances. **NEEDS EMPIRICAL CALIBRATION** — these
 * numbers are placeholders pulled from the D5-D6 spec text and have
 * NOT been validated against actual showcase reference captures yet.
 * Post-merge, the calibration agents (B13+) should:
 *   1. Capture reference snapshots for all 17 showcase frameworks.
 *   2. Run the live D6 driver against each, multiple times, under
 *      typical Railway / aimock conditions.
 *   3. Plot captured/reference ratios; pick a tolerance that passes
 *      ~99th-percentile healthy runs and fails the demonstrably broken
 *      ones.
 *   4. Update these constants (or land per-framework overrides on the
 *      D6 driver).
 *
 * Until then, treat these as conservative-but-arbitrary.
 */
export const DEFAULT_PARITY_TOLERANCES: Readonly<ParityTolerances> = {
  ttft_ratio: 2.0,
  p50_chunk_ratio: 3.0,
};

/**
 * Compare a captured snapshot against a reference snapshot and return
 * a per-axis + aggregate verdict.
 *
 * The function is total: any input shape that satisfies the type
 * signature returns a `ParityReport`. Invalid numeric inputs (NaN,
 * negative, zero divisor) are surfaced as axis-level failures with a
 * `reason` field on the relevant detail, not thrown.
 */
export function compareParity(
  reference: ParitySnapshot,
  captured: ParitySnapshot,
  tolerances?: Partial<ParityTolerances>,
): ParityReport {
  const effectiveTolerances: ParityTolerances = {
    ttft_ratio: tolerances?.ttft_ratio ?? DEFAULT_PARITY_TOLERANCES.ttft_ratio,
    p50_chunk_ratio:
      tolerances?.p50_chunk_ratio ?? DEFAULT_PARITY_TOLERANCES.p50_chunk_ratio,
  };

  const dom = compareDom(reference.domElements, captured.domElements);
  const tools = compareTools(reference.toolCalls, captured.toolCalls);
  const stream = compareStream(
    reference.streamProfile,
    captured.streamProfile,
    effectiveTolerances,
  );
  const contract = compareContract(
    reference.contractShape,
    captured.contractShape,
  );

  const axes = {
    dom: dom.verdict,
    tools: tools.verdict,
    stream: stream.verdict,
    contract: contract.verdict,
  };

  const failure_count =
    (axes.dom === "fail" ? 1 : 0) +
    (axes.tools === "fail" ? 1 : 0) +
    (axes.stream === "fail" ? 1 : 0) +
    (axes.contract === "fail" ? 1 : 0);

  return {
    axes,
    details: {
      dom: dom.details,
      tools: tools.details,
      stream: stream.details,
      contract: contract.details,
    },
    overall: failure_count === 0 ? "pass" : "fail",
    failure_count,
  };
}

// ─── DOM ─────────────────────────────────────────────────────────────

function compareDom(
  reference: DomElement[],
  captured: DomElement[],
): {
  verdict: AxisVerdict;
  details: NonNullable<ParityReport["details"]["dom"]>;
} {
  // Track which captured elements have already been claimed so two
  // reference elements with the same `(tag, testId)` can't both be
  // satisfied by a single captured slot. Linear scan is fine — DOM
  // snapshots in showcase parity are O(100) elements.
  const claimed = new Set<number>();
  const missing: DomElement[] = [];

  for (const refEl of reference) {
    const idx = findMatch(refEl, captured, claimed);
    if (idx === -1) {
      missing.push(refEl);
    } else {
      claimed.add(idx);
    }
  }

  const extra_count = captured.length - claimed.size;
  const verdict: AxisVerdict = missing.length === 0 ? "pass" : "fail";

  return {
    verdict,
    details: { missing, extra_count },
  };
}

function findMatch(
  refEl: DomElement,
  captured: DomElement[],
  claimed: Set<number>,
): number {
  for (let i = 0; i < captured.length; i++) {
    if (claimed.has(i)) continue;
    const capEl = captured[i];
    if (!capEl) continue;
    if (matchesElement(refEl, capEl)) {
      return i;
    }
  }
  return -1;
}

function matchesElement(refEl: DomElement, capEl: DomElement): boolean {
  if (refEl.tag !== capEl.tag) return false;

  if (refEl.testId !== undefined) {
    // testId is the strong key — compare exactly. If the captured side
    // is missing testId (or has a different one) it's not a match.
    return capEl.testId === refEl.testId;
  }

  // No testId on the reference side — fall back to "every reference
  // class is present in captured" (captured is a superset). This
  // matches the module docstring's "captured is superset of reference"
  // rule for the DOM axis: a captured element with EXTRA classes
  // beyond what the reference declared is still a valid match.
  return capturedClassesIncludeReference(refEl.classes, capEl.classes);
}

/**
 * Multiset-aware "captured is a superset of reference" check.
 *
 * Returns true iff every class in `referenceClasses` appears in
 * `capturedClasses` AT LEAST as many times. Duplicates count: if the
 * reference declares the class `"item"` twice, captured must declare
 * it twice too. Captured may have additional classes beyond the
 * reference set; those are tolerated (the DOM axis treats captured
 * extras as a non-failure per the module docstring).
 *
 * Multiset semantics fix the historical bug where set-membership +
 * length-equality would erroneously declare `["a","a","b"]` ≡
 * `["a","b","b"]` (same length, same set `{a,b}`) — and the relaxed
 * length pre-filter contradicted the "captured is superset" doc.
 */
function capturedClassesIncludeReference(
  referenceClasses: string[],
  capturedClasses: string[],
): boolean {
  if (referenceClasses.length === 0) return true;
  // Build a multiset (count map) of the captured classes; decrement as
  // we consume each reference class. If any reference class can't be
  // satisfied (count <= 0 or absent), it's not a superset.
  const capturedCounts = new Map<string, number>();
  for (const cls of capturedClasses) {
    capturedCounts.set(cls, (capturedCounts.get(cls) ?? 0) + 1);
  }
  for (const cls of referenceClasses) {
    const remaining = capturedCounts.get(cls);
    if (remaining === undefined || remaining <= 0) return false;
    capturedCounts.set(cls, remaining - 1);
  }
  return true;
}

// ─── TOOLS ───────────────────────────────────────────────────────────

function compareTools(
  reference: string[],
  captured: string[],
): {
  verdict: AxisVerdict;
  details: NonNullable<ParityReport["details"]["tools"]>;
} {
  const len = Math.max(reference.length, captured.length);
  let firstDivergence: number | undefined;

  for (let i = 0; i < len; i++) {
    if (reference[i] !== captured[i]) {
      firstDivergence = i;
      break;
    }
  }

  const verdict: AxisVerdict = firstDivergence === undefined ? "pass" : "fail";

  const details: NonNullable<ParityReport["details"]["tools"]> = {
    reference: [...reference],
    captured: [...captured],
  };
  if (firstDivergence !== undefined) {
    details.first_divergence_index = firstDivergence;
  }

  return { verdict, details };
}

// ─── STREAM ──────────────────────────────────────────────────────────

function compareStream(
  reference: ParitySnapshot["streamProfile"],
  captured: ParitySnapshot["streamProfile"],
  tolerances: ParityTolerances,
): {
  verdict: AxisVerdict;
  details: NonNullable<ParityReport["details"]["stream"]>;
} {
  // Fail-loud guard: a captured stream that produced ZERO chunks (5xx
  // response, network dead, CDP detached mid-flight) emits a
  // total_chunks=0 / ttft=0 / p50=0 profile from `computeStreamProfile`.
  // Without this guard, `computeRatio(0, refTtft)` returns 0, which is
  // ≤ the default 2.0/3.0 tolerances, so the axis would PASS while
  // masking total stream failure. Surface zero-chunk captures as a
  // dedicated reason so dashboards / Slack readers see "captured
  // produced no chunks" instead of an inscrutable "ratio 0.0".
  if (captured.total_chunks === 0 && reference.total_chunks > 0) {
    return {
      verdict: "fail",
      details: {
        ttft_ratio: Number.POSITIVE_INFINITY,
        p50_chunk_ratio: Number.POSITIVE_INFINITY,
        reason: "captured stream produced zero chunks",
      },
    };
  }

  const { ttftRatio, ttftReason } = computeRatio(
    captured.ttft_ms,
    reference.ttft_ms,
    "ttft_ms",
  );
  const { ttftRatio: p50Ratio, ttftReason: p50Reason } = computeRatio(
    captured.p50_chunk_ms,
    reference.p50_chunk_ms,
    "p50_chunk_ms",
  );

  const ttftPass =
    ttftReason === undefined && ttftRatio <= tolerances.ttft_ratio;
  const p50Pass =
    p50Reason === undefined && p50Ratio <= tolerances.p50_chunk_ratio;

  const verdict: AxisVerdict = ttftPass && p50Pass ? "pass" : "fail";

  const details: NonNullable<ParityReport["details"]["stream"]> = {
    ttft_ratio: ttftRatio,
    p50_chunk_ratio: p50Ratio,
  };
  // Surface the FIRST reason — both fields fail simultaneously rarely
  // and a single string is easier to render in Slack than a list.
  const reason = ttftReason ?? p50Reason;
  if (reason !== undefined) {
    details.reason = reason;
  }

  return { verdict, details };
}

/**
 * Helper: compute `numerator / denominator`, returning a sentinel
 * `Infinity` ratio + a human-readable `reason` whenever the inputs
 * can't yield a meaningful ratio (zero divisor, NaN, negative). The
 * caller treats any non-undefined `reason` as an axis failure
 * regardless of the numeric ratio value.
 */
function computeRatio(
  numerator: number,
  denominator: number,
  field: string,
): { ttftRatio: number; ttftReason?: string } {
  if (!Number.isFinite(numerator) || numerator < 0) {
    return {
      ttftRatio: Number.POSITIVE_INFINITY,
      ttftReason: `captured.${field} is not a non-negative finite number (got ${numerator})`,
    };
  }
  if (!Number.isFinite(denominator) || denominator <= 0) {
    return {
      ttftRatio: Number.POSITIVE_INFINITY,
      ttftReason: `reference.${field} must be > 0 to compute a ratio (got ${denominator})`,
    };
  }
  return { ttftRatio: numerator / denominator };
}

// ─── CONTRACT ────────────────────────────────────────────────────────

function compareContract(
  reference: Record<string, string>,
  captured: Record<string, string>,
): {
  verdict: AxisVerdict;
  details: NonNullable<ParityReport["details"]["contract"]>;
} {
  // Split the two failure modes — "field is absent" and "field is
  // present but typed differently" are distinct operational signals.
  // Conflating them (the pre-fix behaviour) made it impossible for
  // triagers to tell whether a field had vanished from the contract
  // versus merely changed shape.
  const missing_fields: string[] = [];
  const type_mismatched_fields: string[] = [];

  for (const [path, refType] of Object.entries(reference)) {
    const capType = captured[path];
    if (capType === undefined) {
      missing_fields.push(path);
    } else if (capType !== refType) {
      type_mismatched_fields.push(path);
    }
  }

  const referenceKeys = new Set(Object.keys(reference));
  let extra_field_count = 0;
  for (const key of Object.keys(captured)) {
    if (!referenceKeys.has(key)) extra_field_count += 1;
  }

  // Both buckets fail the axis — the verdict cares about parity break,
  // not which flavour of break. The split only exists for the details.
  const verdict: AxisVerdict =
    missing_fields.length === 0 && type_mismatched_fields.length === 0
      ? "pass"
      : "fail";
  return {
    verdict,
    details: { missing_fields, type_mismatched_fields, extra_field_count },
  };
}
