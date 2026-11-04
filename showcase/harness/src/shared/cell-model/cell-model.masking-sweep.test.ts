/**
 * EXHAUSTIVE MASKING SWEEP — INV7 promoted from six fixtures to a whole input
 * domain, with a shape-exact allowlist of the residue that survives today.
 *
 * ── The invariant ─────────────────────────────────────────────────────────
 *
 * No combination of status rows may render a RED depth pill under a chip that
 * makes no failure claim (`gray`, or the clean `green`) UNLESS every red row the
 * cell contributes from carries POSITIVE `INFRA_ERROR_CLASSES` attribution.
 *
 * That is exactly INV7 (`cell-model.coherence.test.ts`), including its U8
 * all-stale carve-out. The difference is quantification: INV7 runs over the
 * hand-written fixture matrix, and round 1 of PR #6156's review found it passed
 * "only by fixture accident". This file runs the SAME predicate over the FULL
 * cross-product of the seven status rows one agent-axis cell is derived from ×
 * six row variants = 6^7 = 279,936 combinations. A new masking shape cannot ship
 * without landing in this file's diff.
 *
 * ── Provenance ────────────────────────────────────────────────────────────
 *
 * This sweep is the committed form of the one-off diagnostic that produced the
 * highest-severity finding of PR #6156's round-2 review (slot 1-A, finding #1).
 * That diagnostic reconstructed BOTH engines (branch + `origin/main`) in scratch
 * dirs and diffed them field-by-field; that form is not committable, because it
 * depends on `origin/main` at a moment in time. What IS committable is the
 * invariant plus an allowlist — one engine, no cross-revision diff.
 *
 * The reconstruction here reproduces slot 1-A's measurement EXACTLY: 19,328 of
 * 279,936 combinations mask a real red, in the same eight red-pill buckets
 * (`SLOT_1A_RED_PILL_BUCKETS` below pins all eight). Any drift in the row
 * variants would move those numbers, so they double as a fidelity pin on the
 * domain.
 *
 * ── Three mechanisms, ONE of which is excused ──────────────────────────────
 *
 * The invariant does not hold today. The 19,328 violations come from THREE
 * distinct engine mechanisms, all pre-dating this PR (`cell-model.combine.ts` is
 * byte-identical to `origin/main`). They are NOT excused alike:
 *
 *   M1 GAP BELOW THE RED — 17,088 combos — ALLOWLISTED as debt.
 *        `scanWorst` folds the first ABSENT/STUB rung of `["D3","D4","D5"]` as
 *        ABSENT and `break`s, so a rung ABOVE the gap is never folded. `ABSENT` →
 *        `gray`, and a genuine fresh RED above the gap is painted over. The chip
 *        provably never read that red, so demanding infra evidence for it is a
 *        false failure — the same reasoning as INV7's own ladder-gap carve-out.
 *        Documented as deliberate (invariant I1, "rungs above the gap are not
 *        contiguous"), which is why reversing it is a design change and not an
 *        in-scope fix: round-2 partition bucket **(d4)**.
 *        Reachability is real: `chat:`/`tools:` are integration-scoped, so ONE
 *        red `chat:` row is shared by every feature cell of the column, and any
 *        feature whose `e2e:<slug>/<featureId>` row was never emitted (new
 *        feature, rotation slot, D3 driver never ran) gets a gray chip over a
 *        red D4 pill.
 *
 *   M2 D6 OUTSIDE THE WALK — 2,048 combos — QUARANTINED, NOT excused.
 *        `scanWorst` covers `["D3","D4","D5"]` only. With the lower ladder fully
 *        observed and its reds all infra-attributed, `INFRA_RED_FRESH` re-maps to
 *        `NO_DATA` severity and grays the chip — while a non-infra red D6 row,
 *        which the walk never visits, still paints its pill red. The chip DID
 *        read a verdict here; nothing about contiguity excuses it.
 *
 *   M3 GAP NOT BELOW THE RED — 192 combos — QUARANTINED, NOT excused.
 *        The gray comes from the `NO_DATA`/infra severity fold rather than from
 *        contiguity below the red (the shallowest red pill sits BELOW the gap, so
 *        the walk DID reach a verdict before stopping).
 *
 * M2 and M3 live in `QUARANTINED_NON_GAP_MASKING`, a SEPARATE table with its own
 * total and its own failure wording, precisely so the I1 debt note cannot be read
 * as covering them. Each is its own defect with its own fix. `UNEXPLAINED` must
 * stay 0 — a FOURTH mechanism appearing is itself a failure.
 *
 * ── Why an ALLOWLIST, and why it is TWO-SIDED ─────────────────────────────
 *
 * Both tables pin EXACT per-shape counts, so:
 *   (a) a masking shape in no table FAILS ("NEW masking shape"), and
 *   (b) a listed shape that STOPS masking FAILS ("RATCHET" / "QUARANTINE
 *       SHRANK"), forcing whoever fixes a mechanism to delete the entries rather
 *       than leave a stale excuse behind. An allowlist that silently keeps
 *       excusing a fixed condition is permanent cover; this one shrinks or
 *       breaks.
 * Both directions are proven by the teeth tests at the bottom of this file, and
 * were additionally mutation-proven against the real engine before commit.
 *
 * ── Shared-predicate debt (READ BEFORE EDITING `ladderGapDepth`) ───────────
 *
 * `ladderGapDepth` / `redPillDepth` below are a deliberate, line-for-line mirror
 * of the predicate `cell-model.coherence.test.ts` gained in commit `49bf40943f`
 * ("stop INV7 false-failing on the I1 ladder-gap shape"), which is not an
 * ancestor of this branch. Same concept, same semantics: a rung is a GAP when NO
 * row exists for ANY of its keys (provably equivalent to `classifyRung`'s
 * `ABSENT` for D3/D4/D5), and NOT the strip's `status === null`, which would also
 * swallow the `anyExpectedMissing` NO_DATA collapse — a rung that DOES have an
 * observation and does NOT stop the walk. Keying off the strip instead would
 * mis-file 192 M3 combinations as excused gap-breaks, which is exactly the
 * over-broad allowance this file must not grant.
 *
 * WHEN BOTH LAND, IMPORT THE SHARED HELPER AND DELETE THIS COPY. A second,
 * divergent formulation of one concept is the exact failure this review keeps
 * finding (three PocketBase evaluators, two byte bases).
 *
 * ── Runtime and determinism ───────────────────────────────────────────────
 *
 * The full 279,936-combination sweep runs in ~2.5 s, so it is committed
 * EXHAUSTIVE — no covering array, no sampling, no `SWEEP=` env switch. The
 * `LiveStatusMap` is built ONCE and mutated one key per step in mixed-radix
 * reflected Gray-code order (Knuth 7.2.1.1 Algorithm H), so each successive
 * combination is a single-field delta instead of a full rebuild. That
 * optimization is not taken on trust: one test re-runs the whole domain building
 * a FRESH map per combination and asserts an identical histogram.
 *
 * Determinism: `NOW` is a fixed literal, every row timestamp is derived from it,
 * `buildCellModel` is pure and takes `now` as a parameter, the walk order is
 * fully determined by Algorithm H, and there is no randomness, no I/O and no
 * wall-clock read anywhere in this file. The domain identity is itself asserted
 * (every one of the 6^7 digit tuples visited exactly once, every (slot, variant)
 * pair visited 6^6 times, every step a single-slot delta), so the sweep cannot
 * silently degenerate into a subset.
 *
 * ── CI DEPENDENCY (read this before trusting the gate) ────────────────────
 *
 * Until PR #6168 ("run the harness and shell-dashboard unit suites in CI") lands,
 * NO CI job runs this suite — the harness tests were excluded twice over, by
 * `paths-ignore: showcase/**` and by `--projects='packages/**'` — so this file
 * GATES NOTHING and is a local + `cr-loop` pre-audit instrument only.
 */
import { describe, it, expect } from "vitest";
import { buildCellModel } from "./cell-model.js";
import type { CellModel, CellModelInput, TestLevel } from "./cell-model.js";
import {
  signalHasInfraErrorClass,
  rankOfState,
  RED_RANK,
} from "./cell-model.contribution.js";
import { keyFor, CATALOG_TO_D5_KEY } from "./live-status.js";
import type { LiveStatusMap, State, StatusRow } from "./live-status.js";

// ── The domain ──────────────────────────────────────────────────────────────

/**
 * Fixed reference instant. Every timestamp below is derived from it and
 * `buildCellModel` receives it explicitly, so no assertion in this file depends
 * on the wall clock.
 */
const NOW = Date.parse("2026-07-24T12:00:00.000Z");

const SLUG = "acme";
/**
 * `agentic-chat` maps to exactly ONE D5 feature type, so the D5 and D6 families
 * are single-key and each sweep slot controls exactly one row. A multi-key
 * feature (e.g. `beautiful-chat`, 5 literals) would make one slot set five rows
 * at once and change the combination space — hence the single-key assertion in
 * the domain test.
 */
const FEATURE = "agentic-chat";
const D5_FEATURE_TYPE = CATALOG_TO_D5_KEY[FEATURE]?.[0] ?? "";

/** The seven rows ONE agent-axis cell's chip and depth strip are derived from. */
const SLOTS = ["health", "agent", "e2e", "chat", "tools", "d5", "d6"] as const;

const SLOT_KEYS: readonly string[] = [
  keyFor("health", SLUG),
  keyFor("agent", SLUG),
  keyFor("e2e", SLUG, FEATURE),
  keyFor("chat", SLUG),
  keyFor("tools", SLUG),
  keyFor("d5", SLUG, D5_FEATURE_TYPE),
  keyFor("d6", SLUG, D5_FEATURE_TYPE),
];

/**
 * The keys of each LOWER-LADDER rung — the rungs `scanWorst` actually walks.
 * D4 is the two-key `chat`/`tools` family, so D4 is a GAP only when BOTH are
 * missing (which is exactly when `classifyRung` sees `rows.length === 0`).
 */
const LOWER_RUNG_KEYS: Readonly<Record<3 | 4 | 5, readonly string[]>> = {
  3: [SLOT_KEYS[2] as string],
  4: [SLOT_KEYS[3] as string, SLOT_KEYS[4] as string],
  5: [SLOT_KEYS[5] as string],
};

/**
 * Six row variants per slot. These are the axes that decide whether a gray chip
 * over a red pill is honest:
 *  - `absent`      — no row at all (the cold-load / never-ran case that opens a
 *                    ladder gap)
 *  - `green`       — fresh green
 *  - `greenStale`  — green, older than every family window (a stale-green rung
 *                    classifies degraded, not red)
 *  - `redFresh`    — fresh red with a PRESENT, non-infra `signal` (product fail)
 *  - `redInfra`    — fresh red carrying `errorClass: "driver-error"`, the
 *                    positive infra attribution that legitimises a gray
 *  - `redStripped` — fresh red whose `signal` is UNDEFINED, i.e. projected away
 *                    by the bulk fetch. THE PR'S SUBJECT: an unknown cause is a
 *                    PENDING attribution and must surface red, never gray.
 * `fail_count: 3` on every red keeps D4 above `D4_FIRST_STRIKE_THRESHOLD`, so no
 * red is softened to first-strike amber (the first-strike path has its own
 * fixtures; conflating the two would make these counts unreadable).
 */
const VARIANTS = [
  "absent",
  "green",
  "greenStale",
  "redFresh",
  "redInfra",
  "redStripped",
] as const;

const FRESH_AT = new Date(NOW - 60_000).toISOString();
/** Older than the widest family window (E2E, 6 h), so EVERY rung reads it stale. */
const STALE_AT = new Date(NOW - 7 * 24 * 60 * 60 * 1000).toISOString();

function mkRow(
  key: string,
  state: State,
  observedAt: string,
  signal: unknown,
): StatusRow {
  const isRed = state === "red";
  return {
    id: `id-${key}`,
    key,
    dimension: key.split(":")[0] ?? "",
    state,
    signal,
    observed_at: observedAt,
    transitioned_at: observedAt,
    fail_count: isRed ? 3 : 0,
    first_failure_at: isRed ? observedAt : null,
  };
}

/**
 * `ROWS[slot][variant]` — every row object the sweep will ever need, built once.
 * The sweep then only `set`s/`delete`s these, allocating nothing per
 * combination. Rows are never mutated, so sharing them across combinations is
 * safe (`buildCellModel` and the classifier are read-only over their input).
 */
const ROWS: readonly (StatusRow | null)[][] = SLOT_KEYS.map((key) =>
  VARIANTS.map((v): StatusRow | null => {
    switch (v) {
      case "absent":
        return null;
      case "green":
        return mkRow(key, "green", FRESH_AT, null);
      case "greenStale":
        return mkRow(key, "green", STALE_AT, null);
      case "redFresh":
        return mkRow(key, "red", FRESH_AT, null);
      case "redInfra":
        return mkRow(key, "red", FRESH_AT, { errorClass: "driver-error" });
      case "redStripped":
        // `signal: undefined` is exactly what the bulk `fields` projection
        // leaves behind (the field is absent on the wire); the engine
        // discriminates on `!== undefined`, not on property presence.
        return mkRow(key, "red", FRESH_AT, undefined);
    }
  }),
);

const CELL_INPUT: CellModelInput = {
  slug: SLUG,
  featureId: FEATURE,
  isSupported: true,
  isWired: true,
};

// ── The predicate ───────────────────────────────────────────────────────────

const PILLS = ["d3", "d4", "d5", "d6"] as const;

const pillReadsRed = (l: TestLevel | null): boolean =>
  l !== null && l.exists && l.status === "red";

/**
 * Shallowest LOWER-LADDER rung with no observation at all, or `null`.
 *
 * MIRRORS `ladderGapDepth` from `cell-model.coherence.test.ts` @ `49bf40943f`
 * — see "Shared-predicate debt" in the file header. "No row for any of the
 * rung's keys" is the ABSENT condition `scanWorst` breaks on; the strip's
 * `status === null` is a DIFFERENT (wider) condition and must not be used here.
 */
function ladderGapDepth(live: LiveStatusMap): 3 | 4 | 5 | null {
  for (const depth of [3, 4, 5] as const) {
    if (LOWER_RUNG_KEYS[depth].every((k) => live.get(k) === undefined)) {
      return depth;
    }
  }
  return null;
}

/** Shallowest depth whose pill renders red, or `null` if the strip has none. */
function redPillDepth(m: CellModel): 3 | 4 | 5 | 6 | null {
  for (const [depth, lvl] of [
    [3, m.d3],
    [4, m.d4],
    [5, m.d5],
    [6, m.d6],
  ] as const) {
    if (pillReadsRed(lvl)) return depth;
  }
  return null;
}

type ModelBuilder = (
  live: LiveStatusMap,
  input: CellModelInput,
  now: number,
) => CellModel;

type Mechanism =
  /** Gap strictly BELOW the shallowest red pill — invariant I1's gap-break. */
  | "M1_GAP_BELOW_RED"
  /** No such gap; the only non-infra red is a D6 row `scanWorst` never walks. */
  | "M2_D6_OUTSIDE_WALK"
  /** No such gap; the gray came from the NO_DATA/infra severity fold. */
  | "M3_GAP_NOT_BELOW_RED"
  | "UNEXPLAINED";

interface Violation {
  /** `${mechanism}::${redPills}|gap=${gapDepth}` — the table key. */
  shapeKey: string;
  mechanism: Mechanism;
  chipColor: CellModel["chipColor"];
  /**
   * Renders the human-readable example. LAZY on purpose: the sweep only needs a
   * string for the FIRST violation of each shape, and building one eagerly for
   * all ~19k violations dominated the sweep's runtime.
   */
  describe: () => string;
}

interface Evaluation {
  violation: Violation | null;
  staleCarveOut: boolean;
  drift: boolean;
}

/**
 * Evaluate the invariant for ONE combination. Returns no violation when the
 * combination is coherent (or legitimately exempt), a `Violation` when a red is
 * masked without positive infra evidence.
 */
function evaluate(
  m: CellModel,
  live: LiveStatusMap,
  digits: ArrayLike<number>,
): Evaluation {
  const clean: Evaluation = {
    violation: null,
    staleCarveOut: false,
    drift: false,
  };
  const redDepth = redPillDepth(m);
  if (redDepth === null) return clean;
  // Only a NON-COMMITTAL chip masks: `gray` ("no live verdict") and the clean
  // `green`. `amber` and `red` are failure claims the strip agrees with, and
  // INV1/INV4 relate them to the derived fields.
  if (m.chipColor !== "gray" && m.chipColor !== "green") return clean;
  // U8 EXEMPTION, identical to INV7's: `buildCellModel` force-grays an ALL-STALE
  // cell, folding ANY stale colour — red included — to the "re-sweep pending"
  // gray. That gray is a RECENCY claim about the cell, not an infra attribution
  // for the pill, so it owes no infra evidence. In THIS domain every red variant
  // is fresh, so one red row always keeps the cell fresh and the carve-out never
  // fires (asserted: `staleCarveOuts === 0`). It is kept for parity with INV7 —
  // if a future variant adds a stale red, the two predicates must not diverge.
  if (m.isStaleCell) return { ...clean, staleCarveOut: true };

  const nonInfraRedKeys: string[] = [];
  let sawContributingRed = false;
  for (const k of SLOT_KEYS) {
    const r = live.get(k);
    if (r === undefined || rankOfState(r.state) < RED_RANK) continue;
    sawContributingRed = true;
    if (!signalHasInfraErrorClass(r.signal)) nonInfraRedKeys.push(k);
  }
  // The strip can only read red because a contributing row folded red, so an
  // empty set here means `SLOT_KEYS` has drifted from the keyspace
  // `buildCellModel` collects and the whole sweep has gone vacuous.
  if (!sawContributingRed) return { ...clean, drift: true };
  // Every red row positively says "infra" — a gray chip is honest here.
  if (nonInfraRedKeys.length === 0) return clean;

  const gapDepth = ladderGapDepth(live);
  let mechanism: Mechanism;
  if (gapDepth !== null && gapDepth < redDepth) {
    mechanism = "M1_GAP_BELOW_RED";
  } else if (
    pillReadsRed(m.d6) &&
    nonInfraRedKeys.every((k) => k.startsWith("d6:"))
  ) {
    mechanism = "M2_D6_OUTSIDE_WALK";
  } else {
    mechanism = "M3_GAP_NOT_BELOW_RED";
  }

  const redPills = PILLS.filter((p) => pillReadsRed(m[p]));
  const gapLabel = gapDepth === null ? "none" : `D${gapDepth}`;
  // Snapshot the digits (7 bytes): the sweep reuses one mutable digit array, so
  // the lazy renderer cannot read it later.
  const digitSnapshot = Uint8Array.from(digits);
  return {
    violation: {
      shapeKey: `${mechanism}::${redPills.join("+")}|gap=${gapLabel}`,
      mechanism,
      chipColor: m.chipColor,
      describe: () =>
        `chip=${m.chipColor} redPills=[${redPills.join(",")}] ` +
        `shallowestRed=D${redDepth} ladderGap=${gapLabel} ` +
        `nonInfraRedRows=[${nonInfraRedKeys.join(",")}] :: ` +
        SLOTS.map((s, i) => `${s}=${VARIANTS[digitSnapshot[i] ?? 0]}`).join(
          " ",
        ),
    },
    staleCarveOut: false,
    drift: false,
  };
}

/**
 * Slot 1-A bucketed the residue by RED-PILL SET ALONE, collapsing every
 * D3-red set into one bucket. Recover that view from a shape key so the
 * historical measurement stays pinned even though the tables below partition the
 * same combinations by MECHANISM instead.
 */
function redPillBucketOf(shapeKey: string): string {
  const redPills = (shapeKey.split("::")[1] ?? "").split("|")[0] ?? "";
  return redPills.includes("d3") ? "d3-mixed" : redPills;
}

// ── The sweep ───────────────────────────────────────────────────────────────

interface SweepResult {
  combos: number;
  /** Distinct digit tuples visited (must equal `combos` and 6^7). */
  distinctCombos: number;
  /** Steps whose predecessor differed in exactly one slot (Gray-code property). */
  singleSlotDeltas: number;
  /** `pairCoverage[slot][variant]` — visits per (slot, variant) pair. */
  pairCoverage: number[][];
  maskingCount: number;
  /** `shapeKey` → count. */
  byShape: Map<string, number>;
  /** `shapeKey` → first violation seen, for failure messages. */
  examples: Map<string, string>;
  /** Red-pill signature (ignoring mechanism) → count: slot 1-A's bucketing. */
  byRedPillBucket: Map<string, number>;
  greenChipMasking: number;
  staleCarveOuts: number;
  drift: number;
  byMechanism: Map<Mechanism, number>;
  unexplainedExamples: string[];
}

/**
 * Walk the whole 6^7 domain and evaluate the invariant on every combination.
 *
 * `build` is injectable ONLY so the teeth tests can perturb the engine's output
 * (prove a new shape fails) or emulate a fix (prove the ratchet fires). The
 * default is the real `buildCellModel`.
 *
 * `freshMapPerCombination` rebuilds the `LiveStatusMap` from scratch each step
 * instead of mutating one key — the control that proves the Gray-code
 * optimization changes no result.
 */
function runSweep(
  build: ModelBuilder = buildCellModel,
  freshMapPerCombination = false,
): SweepResult {
  const n = SLOTS.length;
  const radix = VARIANTS.length;
  const r: SweepResult = {
    combos: 0,
    distinctCombos: 0,
    singleSlotDeltas: 0,
    pairCoverage: SLOTS.map(() => VARIANTS.map(() => 0)),
    maskingCount: 0,
    byShape: new Map(),
    examples: new Map(),
    byRedPillBucket: new Map(),
    greenChipMasking: 0,
    staleCarveOuts: 0,
    drift: 0,
    byMechanism: new Map(),
    unexplainedExamples: [],
  };

  // Algorithm H state: digits `a`, focus pointers `f`, directions `o`.
  const a = new Uint8Array(n);
  const prev = new Uint8Array(n);
  const f = new Int32Array(n + 1).map((_, i) => i);
  const o = new Int8Array(n).fill(1);
  const seen = new Uint8Array(radix ** n);

  let live: LiveStatusMap = new Map();
  for (let i = 0; i < n; i++) {
    const row = ROWS[i]?.[0];
    if (row) live.set(SLOT_KEYS[i] as string, row);
  }

  for (;;) {
    r.combos++;
    // Domain instrumentation: tuple identity, single-delta, pair coverage.
    let rank = 0;
    for (let i = n - 1; i >= 0; i--) rank = rank * radix + (a[i] as number);
    if (seen[rank] === 0) {
      seen[rank] = 1;
      r.distinctCombos++;
    }
    if (r.combos > 1) {
      let changed = 0;
      for (let i = 0; i < n; i++) if (a[i] !== prev[i]) changed++;
      if (changed === 1) r.singleSlotDeltas++;
    }
    prev.set(a);
    for (let i = 0; i < n; i++) {
      const cov = r.pairCoverage[i] as number[];
      cov[a[i] as number] = (cov[a[i] as number] as number) + 1;
    }

    const model = build(live, CELL_INPUT, NOW);
    const { violation, staleCarveOut, drift } = evaluate(model, live, a);
    if (staleCarveOut) r.staleCarveOuts++;
    if (drift) r.drift++;
    if (violation) {
      r.maskingCount++;
      if (violation.chipColor === "green") r.greenChipMasking++;
      r.byShape.set(
        violation.shapeKey,
        (r.byShape.get(violation.shapeKey) ?? 0) + 1,
      );
      const bucket = redPillBucketOf(violation.shapeKey);
      r.byRedPillBucket.set(bucket, (r.byRedPillBucket.get(bucket) ?? 0) + 1);
      if (!r.examples.has(violation.shapeKey)) {
        r.examples.set(violation.shapeKey, violation.describe());
      }
      r.byMechanism.set(
        violation.mechanism,
        (r.byMechanism.get(violation.mechanism) ?? 0) + 1,
      );
      if (
        violation.mechanism === "UNEXPLAINED" &&
        r.unexplainedExamples.length < 5
      ) {
        r.unexplainedExamples.push(violation.describe());
      }
    }

    // Knuth 7.2.1.1 Algorithm H — loopless reflected mixed-radix Gray code.
    // Successive combinations differ in exactly one digit, so the map needs a
    // single `set`/`delete` per step instead of a full rebuild.
    const j = f[0] as number;
    f[0] = 0;
    if (j === n) break;
    a[j] = (a[j] as number) + (o[j] as number);
    if (freshMapPerCombination) {
      live = new Map();
      for (let i = 0; i < n; i++) {
        const row = ROWS[i]?.[a[i] as number];
        if (row) live.set(SLOT_KEYS[i] as string, row);
      }
    } else {
      const row = ROWS[j]?.[a[j] as number];
      if (row) live.set(SLOT_KEYS[j] as string, row);
      else live.delete(SLOT_KEYS[j] as string);
    }
    if (a[j] === 0 || a[j] === radix - 1) {
      o[j] = -(o[j] as number);
      f[j] = f[j + 1] as number;
      f[j + 1] = j + 1;
    }
  }
  return r;
}

// ── The tables ──────────────────────────────────────────────────────────────

interface MaskingShapeEntry {
  mechanism: Mechanism;
  /** Human name for the red-pill bucket. */
  shape: string;
  /** Exact number of combinations in this entry. */
  combinations: number;
  /**
   * `${redPills}|gap=${gapDepth}` → exact count. Keyed at full shape resolution
   * so a SWAP inside a bucket (one sub-shape fixed, another introduced, bucket
   * total unchanged) cannot slip through.
   */
  breakdown: Readonly<Record<string, number>>;
}

/**
 * M1 — the 17,088 combinations excused as invariant-I1 debt.
 *
 * EVERY ENTRY HERE IS DEBT, NOT INTENDED BEHAVIOUR. The gray is only excused
 * because the chip provably never READ the masked red: the walk stopped for want
 * of any observation strictly BELOW the shallowest red pill. That is the same
 * allowance `cell-model.coherence.test.ts` gained in `49bf40943f`, and it is
 * one-directional — a gap AT or ABOVE the red excuses nothing (those land in
 * `QUARANTINED_NON_GAP_MASKING`).
 *
 * FOLLOW-UP: round-2 partition bucket **(d4)** — `scanWorst` should keep folding
 * past a gap (`continue` instead of `break`) so a present red above the gap wins.
 * `worseOf` already ranks `FAIL_FRESH` above `ABSENT`, so no severity-table
 * change is needed. It is a separate PR because it reverses documented invariant
 * I1, re-verdicts an unbounded share of the 857 matrix cells, and therefore needs
 * its own golden-master re-freeze, a fixture per shape, and a ≥3-cell live value
 * test.
 *
 * WHEN THAT LANDS, THIS TABLE MUST SHRINK. `auditAgainstAllowlist` asserts EXACT
 * counts, so a fixed shape fails with "RATCHET" until its entry is deleted. Do
 * not "repair" such a failure by re-freezing the numbers.
 */
const KNOWN_I1_GAP_BREAK_SHAPES: readonly MaskingShapeEntry[] = [
  {
    // The headline production shape: a red `chat:`/`tools:` row (D4,
    // integration-scoped, shared by every feature cell of the column) under a
    // gray chip because the cell's `e2e:` row was never emitted.
    // e.g. health=redInfra agent=redInfra e2e=absent chat=redFresh tools=absent d5=absent d6=absent
    mechanism: "M1_GAP_BELOW_RED",
    shape: "red-D4-only",
    combinations: 2880,
    breakdown: { "d4|gap=D3": 2880 },
  },
  {
    // e.g. health=absent agent=absent e2e=absent chat=absent tools=redStripped d5=redFresh d6=absent
    mechanism: "M1_GAP_BELOW_RED",
    shape: "red-D4+D5",
    combinations: 3552,
    breakdown: { "d4+d5|gap=D3": 3552 },
  },
  {
    // e.g. health=absent agent=absent e2e=absent chat=absent tools=redStripped d5=greenStale d6=redFresh
    mechanism: "M1_GAP_BELOW_RED",
    shape: "red-D4+D6",
    combinations: 3552,
    breakdown: { "d4+d6|gap=D3": 3552 },
  },
  {
    // e.g. health=redInfra agent=redInfra e2e=absent chat=redFresh tools=absent d5=redStripped d6=redFresh
    mechanism: "M1_GAP_BELOW_RED",
    shape: "red-D4+D5+D6",
    combinations: 3776,
    breakdown: { "d4+d5+d6|gap=D3": 3776 },
  },
  {
    // e.g. health=redInfra agent=redInfra e2e=absent chat=greenStale tools=greenStale d5=redFresh d6=absent
    mechanism: "M1_GAP_BELOW_RED",
    shape: "red-D5-only",
    combinations: 960,
    breakdown: { "d5|gap=D3": 864, "d5|gap=D4": 96 },
  },
  {
    // e.g. health=redInfra agent=redInfra e2e=absent chat=greenStale tools=greenStale d5=greenStale d6=redFresh
    mechanism: "M1_GAP_BELOW_RED",
    shape: "red-D6-only",
    combinations: 1088,
    breakdown: { "d6|gap=D3": 864, "d6|gap=D4": 96, "d6|gap=D5": 128 },
  },
  {
    // e.g. health=absent agent=absent e2e=absent chat=absent tools=absent d5=redStripped d6=redFresh
    mechanism: "M1_GAP_BELOW_RED",
    shape: "red-D5+D6",
    combinations: 1280,
    breakdown: { "d5+d6|gap=D3": 1152, "d5+d6|gap=D4": 128 },
  },
];

/**
 * M2 + M3 — the 2,240 combinations that are NOT gap-induced and are therefore
 * NOT excused by the I1 debt note above.
 *
 * They are listed only so this file can be GREEN on a branch that does not fix
 * them; the listing is a QUARANTINE, not an allowance. Each entry is a live
 * defect: the chip read a verdict and still failed to surface a red the strip
 * shows. INV7 (post-`49bf40943f`) keeps its teeth on exactly these — its
 * ladder-gap allowance does not reach them either.
 *
 * FOLLOW-UPs, one per mechanism, both distinct from bucket (d4):
 *  - M2: extend `scanWorst`'s scan (or the D6 soft-parity top rule) so a
 *    non-infra red D6 cannot hide under an infra-grayed lower ladder. Same root
 *    as the round-2 finding that `INFRA_RED_FRESH` re-mapping to `NO_DATA`
 *    severity makes a family LESS severe by acquiring a failing row.
 *  - M3: the `NO_DATA`/infra severity fold grays the chip while a red pill that
 *    the walk DID reach past still reads red.
 *
 * THIS TABLE MUST GO TO ZERO. A shrink fails loudly ("QUARANTINE SHRANK"), which
 * is the signal to delete the entry — never to re-freeze it.
 */
const QUARANTINED_NON_GAP_MASKING: readonly MaskingShapeEntry[] = [
  {
    // e.g. health=absent agent=absent e2e=green chat=absent tools=green d5=green d6=redFresh
    mechanism: "M2_D6_OUTSIDE_WALK",
    shape: "red-D6-only",
    combinations: 64,
    breakdown: { "d6|gap=none": 64 },
  },
  {
    // e.g. health=redInfra agent=redInfra e2e=green chat=redInfra tools=absent d5=green d6=redFresh
    mechanism: "M2_D6_OUTSIDE_WALK",
    shape: "red-D4+D6",
    combinations: 448,
    breakdown: { "d4+d6|gap=D5": 224, "d4+d6|gap=none": 224 },
  },
  {
    // e.g. health=absent agent=absent e2e=green chat=absent tools=greenStale d5=redInfra d6=redFresh
    mechanism: "M2_D6_OUTSIDE_WALK",
    shape: "red-D5+D6",
    combinations: 128,
    breakdown: { "d5+d6|gap=none": 128 },
  },
  {
    // e.g. health=absent agent=absent e2e=green chat=redInfra tools=redInfra d5=redInfra d6=redFresh
    mechanism: "M2_D6_OUTSIDE_WALK",
    shape: "red-D4+D5+D6",
    combinations: 224,
    breakdown: { "d4+d5+d6|gap=none": 224 },
  },
  {
    // A red D3 can sit under a gray chip only when its own contribution is
    // infra-classed (`INFRA_RED_FRESH` → `NO_DATA` severity); the non-infra red
    // that is actually masked is the D6 row.
    // e.g. health=redInfra agent=redInfra e2e=redInfra chat=redInfra tools=redInfra d5=redInfra d6=redFresh
    mechanism: "M2_D6_OUTSIDE_WALK",
    shape: "red-strip-includes-D3",
    combinations: 1184,
    breakdown: {
      "d3+d4+d5+d6|gap=none": 224,
      "d3+d4+d6|gap=D5": 224,
      "d3+d4+d6|gap=none": 224,
      "d3+d5+d6|gap=D4": 32,
      "d3+d5+d6|gap=none": 128,
      "d3+d6|gap=D4": 96,
      "d3+d6|gap=D5": 128,
      "d3+d6|gap=none": 128,
    },
  },
  {
    // The gap (D4) sits ABOVE the shallowest red pill (an infra-classed D3), so
    // the contiguity allowance does not apply — yet a non-infra red D5 is still
    // painted over.
    // e.g. health=redInfra agent=redInfra e2e=redInfra chat=absent tools=absent d5=redFresh d6=absent
    mechanism: "M3_GAP_NOT_BELOW_RED",
    shape: "red-strip-includes-D3",
    combinations: 192,
    breakdown: { "d3+d5+d6|gap=D4": 96, "d3+d5|gap=D4": 96 },
  },
];

/** Totals, split by whether the mechanism is excused or quarantined. */
const I1_GAP_BREAK_TOTAL = 17_088;
const M2_D6_OUTSIDE_WALK_TOTAL = 2048;
const M3_GAP_NOT_BELOW_RED_TOTAL = 192;
const QUARANTINED_TOTAL = M2_D6_OUTSIDE_WALK_TOTAL + M3_GAP_NOT_BELOW_RED_TOTAL;
/** Slot 1-A's headline number: 19,328 of 279,936. */
const RESIDUAL_MASKING_TOTAL = I1_GAP_BREAK_TOTAL + QUARANTINED_TOTAL;

/**
 * Slot 1-A's ORIGINAL bucketing — red-pill set alone, D3-red sets collapsed.
 * Pinned so the historical measurement this file descends from stays verifiable
 * even as the tables above re-partition the same combinations by mechanism.
 */
const SLOT_1A_RED_PILL_BUCKETS: Readonly<Record<string, number>> = {
  d4: 2880,
  "d4+d5": 3552,
  "d4+d6": 4000,
  "d4+d5+d6": 4000,
  d5: 960,
  d6: 1152,
  "d5+d6": 1408,
  "d3-mixed": 1376,
};

/**
 * Compare a sweep's shape histogram against both tables, BOTH DIRECTIONS.
 * Returns one message per discrepancy; an empty array is the pass condition.
 */
function auditAgainstAllowlist(r: SweepResult): string[] {
  const failures: string[] = [];
  const unaccounted = new Map(r.byShape);

  for (const [table, entries] of [
    ["allowlist", KNOWN_I1_GAP_BREAK_SHAPES],
    ["quarantine", QUARANTINED_NON_GAP_MASKING],
  ] as const) {
    for (const entry of entries) {
      let observedTotal = 0;
      for (const [suffix, expected] of Object.entries(entry.breakdown)) {
        const key = `${entry.mechanism}::${suffix}`;
        const observed = unaccounted.get(key) ?? 0;
        unaccounted.delete(key);
        observedTotal += observed;
        if (observed === expected) continue;
        if (observed > expected) {
          failures.push(
            `REGRESSION: ${entry.shape} / ${key} masked ${expected} combinations when frozen ` +
              `and masks ${observed} now (+${observed - expected}). A change WIDENED an ` +
              `already-known masking shape. example: ${r.examples.get(key) ?? "(none captured)"}`,
          );
        } else if (table === "allowlist") {
          failures.push(
            `RATCHET (allowlist is now OVER-BROAD): ${entry.shape} / ${key} masked ${expected} ` +
              `combinations when this table was frozen, but only ${observed} now. Something ` +
              `FIXED part of the I1 gap-break masking — that is the intended direction. DELETE ` +
              `(or lower) this entry instead of re-freezing the number, so the allowlist ` +
              `ratchets down. See the FOLLOW-UP note on KNOWN_I1_GAP_BREAK_SHAPES.`,
          );
        } else {
          failures.push(
            `QUARANTINE SHRANK: ${entry.shape} / ${key} masked ${expected} combinations when ` +
              `this table was frozen and masks only ${observed} now. This mechanism is a ` +
              `DEFECT, not an allowance — a shrink is the goal. DELETE (or lower) this entry. ` +
              `See the FOLLOW-UPs on QUARANTINED_NON_GAP_MASKING.`,
          );
        }
      }
      if (observedTotal !== entry.combinations) {
        failures.push(
          `${entry.mechanism} ${entry.shape}: breakdown observed ${observedTotal} combinations ` +
            `but the entry declares ${entry.combinations} — the entry's own total is ` +
            `inconsistent with its breakdown.`,
        );
      }
    }
  }

  for (const [key, count] of [...unaccounted].sort((x, y) =>
    x[0] < y[0] ? -1 : 1,
  )) {
    failures.push(
      `NEW masking shape ${key} × ${count} combinations — a gray/green chip renders over a ` +
        `RED depth pill with NO positive infra attribution on every contributing red row, ` +
        `in a shape no table covers. This is the defect class INV7 exists to stop. ` +
        `FIX THE ENGINE — do not add a table entry unless the reason is documented debt ` +
        `with a follow-up. example: ${r.examples.get(key) ?? "(none captured)"}`,
    );
  }
  return failures;
}

// ── Shared sweep runs ───────────────────────────────────────────────────────

/**
 * One full 279,936-combination sweep takes ~2.5 s locally (~3-5 s in the
 * fresh-map control). A CI runner can be several times slower, and vitest's 5 s
 * default would make a CORRECT test flake — which is exactly how an invariant of
 * this size gets disabled within a week. Generous, explicit, and applied to
 * every test that runs a sweep of its own.
 */
const SWEEP_TIMEOUT_MS = 120_000;

/**
 * The real engine's sweep. Runs once at module load (~2.5 s) because many
 * assertions read it; re-running it per test would cost 20 s for nothing.
 */
const REAL = runSweep();

describe("masking sweep — domain identity", () => {
  it("covers 6^7 combinations exactly once, one slot-delta per step", () => {
    expect(SLOTS).toHaveLength(7);
    expect(VARIANTS).toHaveLength(6);
    expect(SLOT_KEYS).toHaveLength(SLOTS.length);
    expect(new Set(SLOT_KEYS).size).toBe(SLOTS.length);
    // A multi-key D5 feature would make one slot drive several rows and silently
    // change the combination space.
    expect(
      CATALOG_TO_D5_KEY[FEATURE],
      `${FEATURE} must map to exactly ONE D5 feature type for the 7-slot domain to hold`,
    ).toHaveLength(1);
    // Every lower-ladder rung's keys must be sweep slots, or `ladderGapDepth`
    // would test rows the sweep never varies.
    for (const keys of Object.values(LOWER_RUNG_KEYS)) {
      for (const k of keys) expect(SLOT_KEYS).toContain(k);
    }

    expect(REAL.combos, "combinations visited").toBe(6 ** 7);
    expect(REAL.combos).toBe(279_936);
    expect(REAL.distinctCombos, "DISTINCT combinations visited").toBe(6 ** 7);
    expect(
      REAL.singleSlotDeltas,
      "every step after the first must be a single-slot Gray-code delta",
    ).toBe(6 ** 7 - 1);
    // Balanced coverage: every (slot, variant) pair appears in 6^6 combinations.
    for (const [i, slot] of SLOTS.entries()) {
      for (const [v, variant] of VARIANTS.entries()) {
        expect(
          REAL.pairCoverage[i]?.[v],
          `(slot ${slot}, variant ${variant}) coverage`,
        ).toBe(6 ** 6);
      }
    }
  });

  it("never goes vacuous: a red strip always has a contributing red row", () => {
    // If this fires, `SLOT_KEYS` has drifted from the keyspace
    // `buildCellModel` collects and the sweep is measuring nothing.
    expect(
      REAL.drift,
      "combinations where the strip read red but no SLOT_KEYS row did",
    ).toBe(0);
  });
});

describe("masking sweep — the invariant, with the shape-exact tables", () => {
  it("masks a real red ONLY in the listed shapes", () => {
    const failures = auditAgainstAllowlist(REAL);
    expect(
      failures,
      `masking sweep found ${failures.length} discrepancies:\n  - ${failures.join("\n  - ")}`,
    ).toEqual([]);
  });

  it("pins the excused, quarantined and total counts separately", () => {
    const declaredAllow = KNOWN_I1_GAP_BREAK_SHAPES.reduce(
      (sum, s) => sum + s.combinations,
      0,
    );
    const declaredQuarantine = QUARANTINED_NON_GAP_MASKING.reduce(
      (sum, s) => sum + s.combinations,
      0,
    );
    expect(declaredAllow, "I1 gap-break entries must sum to their total").toBe(
      I1_GAP_BREAK_TOTAL,
    );
    expect(
      declaredQuarantine,
      "quarantine entries must sum to their total",
    ).toBe(QUARANTINED_TOTAL);
    expect(REAL.maskingCount, "residual masking combinations").toBe(
      RESIDUAL_MASKING_TOTAL,
    );
    expect(REAL.maskingCount).toBe(19_328);
  });

  it("attributes every violation to M1, M2 or M3 — no fourth mechanism", () => {
    expect(
      REAL.byMechanism.get("UNEXPLAINED") ?? 0,
      `violations matching none of the three known mechanisms:\n  - ${REAL.unexplainedExamples.join("\n  - ")}`,
    ).toBe(0);
    // Excused: the walk stopped for want of an observation BELOW the red.
    expect(
      REAL.byMechanism.get("M1_GAP_BELOW_RED") ?? 0,
      "M1 gap strictly below the shallowest red pill (invariant I1's gap-break)",
    ).toBe(I1_GAP_BREAK_TOTAL);
    // NOT excused: the chip read a verdict and still hid a red.
    expect(
      REAL.byMechanism.get("M2_D6_OUTSIDE_WALK") ?? 0,
      "M2 non-infra red D6 outside scanWorst's [D3,D4,D5] walk",
    ).toBe(M2_D6_OUTSIDE_WALK_TOTAL);
    expect(
      REAL.byMechanism.get("M3_GAP_NOT_BELOW_RED") ?? 0,
      "M3 gray from the NO_DATA/infra fold, gap not below the red",
    ).toBe(M3_GAP_NOT_BELOW_RED_TOTAL);
  });

  it("reproduces slot 1-A's original eight red-pill buckets", () => {
    // The tables above partition by MECHANISM; this pins the ORIGINAL 8-bucket
    // measurement the sweep descends from, so the two views stay reconciled.
    expect(Object.fromEntries([...REAL.byRedPillBucket].sort())).toEqual(
      Object.fromEntries(Object.entries(SLOT_1A_RED_PILL_BUCKETS).sort()),
    );
    expect(
      Object.values(SLOT_1A_RED_PILL_BUCKETS).reduce((x, y) => x + y, 0),
    ).toBe(RESIDUAL_MASKING_TOTAL);
  });

  it("never masks a red under a GREEN chip (only the no-data gray)", () => {
    // Stronger than INV7, which only inspects gray. A green chip over a red pill
    // would additionally violate INV2/INV3.
    expect(REAL.greenChipMasking).toBe(0);
  });

  it("does not lean on the U8 stale carve-out (every red variant is fresh)", () => {
    // Documents WHY the carve-out is present-but-silent: if a stale-red variant
    // is ever added, this number moves and the divergence between this predicate
    // and INV7's must be revisited deliberately.
    expect(REAL.staleCarveOuts).toBe(0);
  });

  it(
    "is independent of the Gray-code map reuse (fresh map per combination)",
    () => {
      const fresh = runSweep(buildCellModel, /*freshMapPerCombination*/ true);
      expect(fresh.combos).toBe(REAL.combos);
      expect(fresh.maskingCount).toBe(REAL.maskingCount);
      expect([...fresh.byMechanism].sort()).toEqual(
        [...REAL.byMechanism].sort(),
      );
      expect(
        [...fresh.byShape].sort(),
        "mutating one map key per step must give the same histogram as rebuilding it",
      ).toEqual([...REAL.byShape].sort());
    },
    SWEEP_TIMEOUT_MS,
  );
});

// ── Teeth: BOTH directions of the two-sided gate ────────────────────────────
//
// The tables are only worth committing if they fail in both directions. These
// perturb the ENGINE OUTPUT (never the engine) and assert the audit reacts.

describe("masking sweep — teeth (a): a NEW masking shape fails", () => {
  /**
   * Regress the fix this PR made: paint a gray chip over a red D3 pill while the
   * rest of the ladder is fully green. No table entry covers a lone red D3, so
   * the audit must report it as a NEW shape rather than absorb it.
   */
  const grayOverCleanD3: ModelBuilder = (live, input, now) => {
    const m = buildCellModel(live, input, now);
    const higherPillsClean = (["d4", "d5", "d6"] as const).every(
      (p) => m[p]?.status === "green",
    );
    if (pillReadsRed(m.d3) && higherPillsClean) {
      return { ...m, chipColor: "gray" };
    }
    return m;
  };

  it(
    "reports the unlisted shape and does not absorb it",
    () => {
      const perturbed = runSweep(grayOverCleanD3);
      expect(
        perturbed.maskingCount,
        "the perturbation must actually produce extra masking",
      ).toBeGreaterThan(REAL.maskingCount);

      const failures = auditAgainstAllowlist(perturbed);
      const newShape = failures.filter((f) =>
        f.startsWith("NEW masking shape"),
      );
      expect(
        newShape,
        `expected a NEW-shape failure, got:\n  - ${failures.join("\n  - ")}`,
      ).toHaveLength(1);
      expect(newShape[0]).toContain("d3|gap=none");
      expect(newShape[0]).toContain("FIX THE ENGINE");
      // A new shape must not be silently netted off against the known ones.
      expect(failures.filter((f) => f.startsWith("RATCHET"))).toEqual([]);
      expect(failures.filter((f) => f.startsWith("QUARANTINE SHRANK"))).toEqual(
        [],
      );
    },
    SWEEP_TIMEOUT_MS,
  );
});

describe("masking sweep — teeth (b): a listed shape that STOPS masking fails", () => {
  /**
   * Emulate the bucket-(d4) M1 fix (`scanWorst` folding past the gap so a
   * present red above it wins): whenever the real engine grays a chip over a red
   * pill strictly above a ladder gap, the fixed engine would colour that chip
   * RED. Applied to the whole domain this clears all 17,088 M1 combinations and
   * MUST leave the 2,240 quarantined ones untouched.
   */
  const m1Fixed: ModelBuilder = (live, input, now) => {
    const m = buildCellModel(live, input, now);
    if (m.chipColor !== "gray") return m;
    const redDepth = redPillDepth(m);
    const gapDepth = ladderGapDepth(live);
    if (redDepth === null || gapDepth === null || gapDepth >= redDepth)
      return m;
    return { ...m, chipColor: "red" };
  };

  /**
   * The same emulation restricted to ONE shape (`red-D5-only`), to prove the
   * ratchet is per-shape and not just a global total check.
   */
  const m1FixedForD5Only: ModelBuilder = (live, input, now) => {
    const m = buildCellModel(live, input, now);
    const redPills = PILLS.filter((p) => pillReadsRed(m[p]));
    if (redPills.length !== 1 || redPills[0] !== "d5") return m;
    return m1Fixed(live, input, now);
  };

  it(
    "fires RATCHET on every allowlisted shape the emulated M1 fix clears, and leaves the quarantine intact",
    () => {
      const fixed = runSweep(m1Fixed);
      // Only the non-gap-induced residue survives — the shape of a landed (d4) fix.
      expect(fixed.maskingCount).toBe(QUARANTINED_TOTAL);
      expect(fixed.byMechanism.get("M1_GAP_BELOW_RED") ?? 0).toBe(0);
      expect(fixed.byMechanism.get("M2_D6_OUTSIDE_WALK") ?? 0).toBe(
        M2_D6_OUTSIDE_WALK_TOTAL,
      );
      expect(fixed.byMechanism.get("M3_GAP_NOT_BELOW_RED") ?? 0).toBe(
        M3_GAP_NOT_BELOW_RED_TOTAL,
      );

      const failures = auditAgainstAllowlist(fixed);
      const ratchets = failures.filter((f) => f.startsWith("RATCHET"));
      expect(
        ratchets.length,
        `a landed fix must fail LOUDLY, not silently pass:\n  - ${failures.join("\n  - ")}`,
      ).toBeGreaterThan(0);
      expect(ratchets[0]).toContain("OVER-BROAD");
      expect(ratchets[0]).toContain("ratchets down");
      // All seven allowlisted shapes must report — the table cannot survive the
      // fix partially intact.
      for (const entry of KNOWN_I1_GAP_BREAK_SHAPES) {
        expect(
          ratchets.some(
            (f) =>
              f.includes(`${entry.mechanism}::`) && f.includes(entry.shape),
          ),
          `${entry.shape} must report a RATCHET failure once M1 is fixed`,
        ).toBe(true);
      }
      // The quarantined mechanisms are a DIFFERENT defect: fixing M1 must not
      // touch them, and they must keep being detected rather than excused away.
      expect(
        failures.filter((f) => f.startsWith("QUARANTINE SHRANK")),
        "an M1 fix must not disturb the quarantined M2/M3 counts",
      ).toEqual([]);
      expect(failures.filter((f) => f.startsWith("NEW masking shape"))).toEqual(
        [],
      );
      expect(failures.filter((f) => f.startsWith("REGRESSION"))).toEqual([]);
    },
    SWEEP_TIMEOUT_MS,
  );

  it(
    "fires RATCHET on exactly the ONE shape a narrow fix clears",
    () => {
      const fixed = runSweep(m1FixedForD5Only);
      expect(fixed.maskingCount).toBe(RESIDUAL_MASKING_TOTAL - 960);

      const failures = auditAgainstAllowlist(fixed);
      const ratchets = failures.filter((f) => f.startsWith("RATCHET"));
      expect(ratchets.length).toBeGreaterThan(0);
      for (const f of ratchets) expect(f).toContain("red-D5-only");
      // `red-D5-only` has 2 breakdown keys, both cleared by the narrow fix, plus
      // the entry-total mismatch.
      expect(
        failures.filter((f) => !f.includes("red-D5-only")),
        `a narrow fix must not implicate other shapes:\n  - ${failures.join("\n  - ")}`,
      ).toEqual([]);
    },
    SWEEP_TIMEOUT_MS,
  );
});
