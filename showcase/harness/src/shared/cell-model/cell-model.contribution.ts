/**
 * The per-rung contribution classifier — Stage B of the unified cell-model
 * pipeline (spec §3). Every freshness / first-strike / infra-class / absence /
 * future-skew rule the legacy `resolveD3/D4/D5/D6/resolveStarterChip` scattered
 * across `cell-model.ts` lives HERE and nowhere else, so both the chip and the
 * regression flag read ONE classified `RungContribution` per ladder position.
 *
 * This module is a pure leaf: it imports only data/type modules
 * (`live-status`, `staleness`) plus TYPE-only names from `cell-model.ts`, so it
 * never forms a runtime import cycle with the engine hub (the hub imports the
 * classifier, not vice-versa at runtime).
 */

import type { StatusRow, State, StarterLevel } from "./live-status.js";
import {
  SOFT_MISS_TOLERANCE_THRESHOLD,
  SOFT_STARTER_FAILURE_CLASSES,
  starterErrorClassFromSignal,
} from "./live-status.js";
import {
  isStale,
  isFutureSkewed,
  E2E_STALE_AFTER_MS,
  D4_STALE_AFTER_MS,
  LIVENESS_STALE_AFTER_MS,
  STARTER_STALE_AFTER_MS,
} from "./staleness.js";
import type { TestStatus, ChipColor } from "./cell-model.js";

// ---------------------------------------------------------------------------
// Shared low-level primitives (the single home; the engine hub imports these)
// ---------------------------------------------------------------------------

/**
 * INFRA error classes that fold a red cell to gray (U7). A red row whose ONLY
 * failure attribution is one of these means the probe never produced a real
 * functional result — infra-broken, not product-broken. CONSERVATIVE BY DESIGN
 * (masks-real-red guard): exactly these two.
 */
export const INFRA_ERROR_CLASSES: ReadonlySet<string> = new Set([
  "driver-error",
  "abort",
]);

/**
 * Does a status row's `signal` blob carry an INFRA error class in EITHER
 * `errorClass` or `errorDesc`? D4 writes `driver-error` into `errorDesc` and
 * leaves `errorClass` unset, so BOTH fields are read.
 */
export function signalHasInfraErrorClass(signal: unknown): boolean {
  if (signal === null || typeof signal !== "object" || Array.isArray(signal)) {
    return false;
  }
  const blob = signal as Record<string, unknown>;
  const errorClass = blob.errorClass;
  const errorDesc = blob.errorDesc;
  return (
    (typeof errorClass === "string" && INFRA_ERROR_CLASSES.has(errorClass)) ||
    (typeof errorDesc === "string" && INFRA_ERROR_CLASSES.has(errorDesc))
  );
}

/** Rank for worst-state comparison: higher = worse. */
const STATE_RANK: Readonly<Record<State, number>> = {
  red: 3,
  degraded: 2,
  green: 1,
};

/**
 * Worst-state rank for an arbitrary row state. An out-of-vocabulary runtime
 * value (e.g. `"error"`) ranks ABOVE every known state so it surfaces as the
 * worst rather than being silently dropped from the fold.
 */
const UNKNOWN_STATE_RANK = Number.POSITIVE_INFINITY;
export function rankOfState(state: string): number {
  return STATE_RANK[state as State] ?? UNKNOWN_STATE_RANK;
}
export const RED_RANK = STATE_RANK.red;

/** Map PocketBase State → TestStatus. */
export function stateToTestStatus(state: State): TestStatus {
  switch (state) {
    case "green":
      return "green";
    case "red":
      return "red";
    case "degraded":
      return "amber";
    default: {
      const _exhaustive: never = state;
      void _exhaustive;
      return null;
    }
  }
}

/**
 * State → TestStatus for the rank-fold path: an out-of-vocabulary state maps to
 * `"red"` (never no-data), mirroring the legacy `foldStateToTestStatus`.
 */
export function foldStateToTestStatus(state: State): TestStatus {
  return stateToTestStatus(state) ?? "red";
}

// ---------------------------------------------------------------------------
// Contribution vocabulary + types (spec §3 table)
// ---------------------------------------------------------------------------

export type ContributionKind =
  | "UNSUPPORTED"
  | "STUB"
  | "ABSENT"
  | "NO_DATA"
  | "GREEN_FRESH"
  | "STALE_DEGRADED"
  | "FIRST_STRIKE_FRESH"
  | "INFRA_RED_FRESH"
  | "FAIL_FRESH";

export type RungKind = "D1" | "D2" | "D3" | "D4" | "D5" | "D6" | "starter";

/** Stage A output — the raw PB rows a ladder position reads, no interpretation. */
export interface RawRung {
  kind: RungKind;
  /** The present family rows for this position (absent rows are omitted). */
  rows: StatusRow[];
  /** In-scope/expected for this cell (drives ABSENT vs STUB/UNSUPPORTED). */
  mapped: boolean;
  /**
   * `true` when a mapped/unconditional sub-key produced NO row — the STRICT
   * `anyMissing` collapse (D4 missing-chat; D5/D6 missing sub-row).
   */
  anyExpectedMissing: boolean;
  /** `false` when the projection stripped `signal` from a contributing row (I5/§D). */
  signalKnown: boolean;
}

/** Stage B output — one classified contribution per rung. */
export interface RungContribution {
  kind: RungKind;
  contribution: ContributionKind;
  /** Raw folded color for d6Effective passthrough (green|red|amber|null). */
  rawStatus: TestStatus;
  /** Freshest contributing-row age, future-skew-clamped (§E); null = no datable row. */
  freshestAgeMs: number | null;
}

/**
 * §4a chip severity, MOST-SEVERE FIRST (lower index = worse). `INFRA_RED_FRESH`
 * is re-mapped to `NO_DATA` severity BEFORE the fold (it is not a product red),
 * so it is not listed here.
 */
export const CHIP_SEVERITY: ReadonlyArray<ContributionKind> = [
  "FAIL_FRESH",
  "STALE_DEGRADED",
  "FIRST_STRIKE_FRESH",
  "NO_DATA",
  "ABSENT",
  "GREEN_FRESH",
];

/** Compile-time exhaustiveness guard — an added `ContributionKind` that no
 * `switch` handles narrows to `never` here and becomes a build error. */
function assertNever(x: never): never {
  throw new Error(`Unhandled ContributionKind: ${String(x)}`);
}

/**
 * Re-map a contribution to its chip-severity peer (INFRA_RED_FRESH → NO_DATA;
 * UNSUPPORTED/STUB → ABSENT). Exhaustive over the closed `ContributionKind`
 * union: every kind is handled, so `severityIndex` below can never miss and
 * sort an unrecognized kind as "worst but gray" (the fail-safe polarity bug).
 */
function severityKind(c: ContributionKind): ContributionKind {
  switch (c) {
    case "INFRA_RED_FRESH":
      return "NO_DATA";
    case "UNSUPPORTED":
    case "STUB":
      return "ABSENT";
    case "ABSENT":
    case "NO_DATA":
    case "GREEN_FRESH":
    case "STALE_DEGRADED":
    case "FIRST_STRIKE_FRESH":
    case "FAIL_FRESH":
      return c;
    default:
      return assertNever(c);
  }
}

/**
 * Severity index (lower = worse). `severityKind` is exhaustive over the closed
 * union, so every kind maps into `CHIP_SEVERITY` and `indexOf` never returns
 * -1 — `worseOf` therefore can never rank an unknown kind above a real
 * `FAIL_FRESH`.
 */
export function severityIndex(c: ContributionKind): number {
  return CHIP_SEVERITY.indexOf(severityKind(c));
}

/** Return the WORSE (more severe) of two contributions by §4a chip severity. */
export function worseOf(
  a: ContributionKind,
  b: ContributionKind,
): ContributionKind {
  return severityIndex(a) <= severityIndex(b) ? a : b;
}

/** §4a contribution → chip color. */
export function contributionToColor(c: ContributionKind): ChipColor {
  switch (severityKind(c)) {
    case "FAIL_FRESH":
      return "red";
    case "STALE_DEGRADED":
    case "FIRST_STRIKE_FRESH":
      return "amber";
    case "NO_DATA":
    case "ABSENT":
      return "gray";
    case "GREEN_FRESH":
      return "green";
    default:
      return "gray";
  }
}

// ---------------------------------------------------------------------------
// First-strike config (spec §3 rule 3)
// ---------------------------------------------------------------------------

export interface FirstStrikeRule {
  enabled: boolean;
  threshold?: number;
  requireSoftClass?: boolean;
}

/** D4 crosses to a hard red on the SECOND consecutive strike. */
export const D4_FIRST_STRIKE_THRESHOLD = 2;

export const firstStrikeConfig: Readonly<Record<RungKind, FirstStrikeRule>> = {
  starter: {
    enabled: true,
    threshold: SOFT_MISS_TOLERANCE_THRESHOLD,
    requireSoftClass: true,
  },
  D4: {
    enabled: true,
    threshold: D4_FIRST_STRIKE_THRESHOLD,
    requireSoftClass: false,
  },
  D1: { enabled: false },
  D2: { enabled: false },
  D3: { enabled: false },
  D5: { enabled: false },
  D6: { enabled: false },
};

// ---------------------------------------------------------------------------
// Family fold (§3 rule 1) — the shared core lifted from the legacy resolvers
// ---------------------------------------------------------------------------

/** Family window per rung kind (spec §3 rule 2). */
export function staleWindowFor(kind: RungKind): number {
  switch (kind) {
    case "D1":
    case "D2":
      return LIVENESS_STALE_AFTER_MS;
    case "D4":
      return D4_STALE_AFTER_MS;
    case "starter":
      return STARTER_STALE_AFTER_MS;
    default:
      // D3/D5/D6 (e2e cadence)
      return E2E_STALE_AFTER_MS;
  }
}

interface FamilyFold {
  /** Worst effective state after the per-row stale/skew→degraded downgrade. */
  worstState: State | null;
  /**
   * The contributing row that PRODUCED `worstState` (the effective "winner"
   * row), or null when no rows. This is the representative row surfaced as
   * `TestLevel.row` — origin/main's resolvers returned the winner (worst) row,
   * NOT the first row, and `d0-gone-monitor` reads it to time an outage onset
   * off the SAME row the fold verdict came from. Its `.state` is the RAW row
   * state (a stale-green winner reads `green`, not a synthesized `degraded` —
   * the downgrade lives in the classified `status`, §7 I2).
   */
  worstRow: StatusRow | null;
  /** Freshest datable age (future-skew clamped, §E), or null. */
  freshestAgeMs: number | null;
  /** At least one contributing red row was NOT infra-classed. */
  hasNonInfraRed: boolean;
  /** At least one contributing row ranks at/above red. */
  hasRed: boolean;
  /**
   * HIGHEST `fail_count` across the NON-INFRA contributing red rows (for
   * first-strike de-amplification), or null when there is no non-infra red.
   *
   * MAX (not min), and NON-INFRA only, are both load-bearing (spec §3 rule 2:
   * a confirmed sustained red is never masked to amber). First-strike
   * de-amplification tolerates a *single transient blip*, so a family may only
   * de-amplify when its WORST genuine (non-infra) red is itself still a first
   * strike. Taking the minimum would let one fresh sibling re-arm tolerance for
   * an already-confirmed failure; folding infra reds in would let an unrelated
   * infra hiccup's low count do the same. Infra reds are excluded here for the
   * same reason `hasNonInfraRed` excludes them from the product-red verdict —
   * they carry no product-failure signal.
   */
  maxNonInfraRedFailCount: number | null;
  /** Every contributing NON-INFRA red row carries a SOFT starter failure class. */
  allRedSoftClass: boolean;
}

/**
 * Fold the present rows of a family worst-wins, applying the per-row
 * stale-green/future-skew → degraded downgrade BEFORE comparing (so a
 * fresh-green sibling can never mask a stale-green one — mirrors the legacy
 * resolvers). Future-skewed rows are excluded from `freshestAgeMs` (§E).
 */
export function foldFamily(
  rows: StatusRow[],
  staleWindow: number,
  now: number,
): FamilyFold {
  let worstState: State | null = null;
  let worstRow: StatusRow | null = null;
  let freshestAgeMs: number | null = null;
  let hasNonInfraRed = false;
  let hasRed = false;
  let maxNonInfraRedFailCount: number | null = null;
  let allRedSoftClass = true;

  for (const row of rows) {
    const skewed = isFutureSkewed(row, now);
    const stale = skewed || isStale(row, now, staleWindow);
    const effState: State =
      row.state === "green" && stale ? "degraded" : row.state;

    if (
      worstState === null ||
      rankOfState(effState) > rankOfState(worstState)
    ) {
      worstState = effState;
      worstRow = row;
    }

    // Freshest age — skip unparseable AND future-skewed rows (§E: never "0ms ago").
    const observedMs = Date.parse(row.observed_at);
    if (!Number.isNaN(observedMs) && !skewed) {
      // Clamp a within-tolerance future-dated row to 0 so the surfaced age
      // ("last swept N ago") can never go negative on sub-5m clock drift.
      const ageMs = Math.max(0, now - observedMs);
      if (freshestAgeMs === null || ageMs < freshestAgeMs)
        freshestAgeMs = ageMs;
    }

    // Red bookkeeping (rank-based, so an out-of-vocab "error" counts as red).
    // The fail_count / soft-class accounting that drives first-strike
    // de-amplification is scoped to NON-INFRA reds only, and tracks the MAX
    // (spec §3 rule 2): an infra red carries no product signal, and a fresh
    // sibling must not re-arm tolerance for an already-confirmed sustained red.
    if (rankOfState(row.state) >= RED_RANK) {
      hasRed = true;
      if (!signalHasInfraErrorClass(row.signal)) {
        hasNonInfraRed = true;
        maxNonInfraRedFailCount =
          maxNonInfraRedFailCount === null
            ? row.fail_count
            : Math.max(maxNonInfraRedFailCount, row.fail_count);
        const cls = starterErrorClassFromSignal(row.signal);
        if (cls === undefined || !SOFT_STARTER_FAILURE_CLASSES.has(cls)) {
          allRedSoftClass = false;
        }
      }
    }
  }

  return {
    worstState,
    worstRow,
    freshestAgeMs,
    hasNonInfraRed,
    hasRed,
    maxNonInfraRedFailCount,
    allRedSoftClass,
  };
}

// ---------------------------------------------------------------------------
// classifyRung (§3) — the single per-rung decision point
// ---------------------------------------------------------------------------

/**
 * Classify one raw rung into exactly one `RungContribution` (spec §3 rules
 * 1–5). This is the ONLY place freshness, first-strike, infra-class, absence,
 * and future-skew are decided.
 */
export function classifyRung(raw: RawRung, now: number): RungContribution {
  const { kind } = raw;
  const window = staleWindowFor(kind);

  // Rule: no rows emitted for a mapped rung → ABSENT (never verified).
  if (raw.rows.length === 0) {
    return {
      kind,
      contribution: raw.mapped ? "ABSENT" : "STUB",
      rawStatus: null,
      freshestAgeMs: null,
    };
  }

  const fold = foldFamily(raw.rows, window, now);
  const worst = fold.worstState;
  if (worst === null) {
    return {
      kind,
      contribution: "ABSENT",
      rawStatus: null,
      freshestAgeMs: null,
    };
  }

  const rawStatus = foldStateToTestStatus(worst);
  const base = { kind, freshestAgeMs: fold.freshestAgeMs } as const;

  // ── Not a red (green or degraded fold winner) ──────────────────────
  if (rankOfState(worst) < RED_RANK) {
    // STRICT anyMissing collapse: a missing mapped/unconditional sub-row makes
    // the family unverified → NO_DATA (unless a present red dominates — handled
    // in the red branch below).
    if (raw.anyExpectedMissing) {
      return { ...base, contribution: "NO_DATA", rawStatus: null };
    }
    if (worst === "green") {
      return { ...base, contribution: "GREEN_FRESH", rawStatus };
    }
    // degraded — a stale-green fold OR a natively-degraded row (§4a amber tier).
    return { ...base, contribution: "STALE_DEGRADED", rawStatus };
  }

  // ── Red fold winner (rank ≥ red) ───────────────────────────────────
  // §3 rule 4 / §D: infra-ness unknown (signal stripped) → NO_DATA, never a
  // manufactured product-red.
  if (!raw.signalKnown) {
    return { ...base, contribution: "NO_DATA", rawStatus: null };
  }
  // U7: every contributing red row is infra-classed → INFRA_RED_FRESH (→ gray).
  if (!fold.hasNonInfraRed) {
    return { ...base, contribution: "INFRA_RED_FRESH", rawStatus };
  }
  // §3 rule 3: first-strike de-amplification, per rung kind. Gate on the WORST
  // non-infra red: de-amplify to amber only when EVERY genuine (non-infra) red
  // is still a first strike (below threshold). A sustained non-infra red keeps
  // the family red even alongside a fresh first-strike or infra sibling.
  const rule = firstStrikeConfig[kind];
  if (
    rule.enabled &&
    rule.threshold !== undefined &&
    fold.maxNonInfraRedFailCount !== null &&
    fold.maxNonInfraRedFailCount < rule.threshold &&
    (!rule.requireSoftClass || fold.allRedSoftClass)
  ) {
    return { ...base, contribution: "FIRST_STRIKE_FRESH", rawStatus };
  }
  // A genuine ran-and-failed red.
  return { ...base, contribution: "FAIL_FRESH", rawStatus };
}

// Re-export STARTER_LEVELS' element type for the collect stage's convenience.
export type { StarterLevel };
