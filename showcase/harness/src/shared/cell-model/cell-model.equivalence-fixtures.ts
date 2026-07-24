/**
 * Committed equivalence fixtures + EXPANDED combinatorial matrix for the
 * cell-model ladder redesign.
 *
 * The original six baseline entries (`red-d0`, `gray-d0`, `stale-column`,
 * `mixed-green-red`, `all-green`, `unsupported`) are RETAINED and — per spec §7
 * step 1 — the green/amber ones are augmented with GREEN_FRESH `health`/`agent`
 * (D1/D2) rows so their pre-change outcome is preserved under the incoming §F
 * liveness gate. On top of that, a pruned reachable combinatorial matrix
 * (spec §6) exercises every axis that drives the classifier: per-rung state ×
 * freshness × infra-class × signalKnown × first-strike, the D1/D2
 * presence/freshness axis, the D6 soft-parity top, the D5-unmapped ceiling, and
 * the starter axis.
 *
 * NOTE: the `feature === null` liveness-only path is NOT in this matrix. The
 * unified `buildCellModel` supports it, but a `keyFor`-derived fixture cannot
 * represent a null `featureId`; that path is proven exclusively in
 * `cell-model-v2.test.ts`.
 *
 * `cell-model.equivalence.test.ts` runs the unified `buildCellModel` over these
 * fixtures and asserts byte-identity with `cell-model.equivalence-baseline.json`
 * (the golden master frozen from the current engine).
 */
import type { StatusRow, State } from "./live-status.js";
import {
  keyFor,
  mergeRowsToMap,
  CATALOG_TO_D5_KEY,
  STARTER_LEVELS,
} from "./live-status.js";
import type { CellModelInput } from "./cell-model.js";
import { E2E_STALE_AFTER_MS, FUTURE_SKEW_TOLERANCE_MS } from "./staleness.js";

/**
 * FIXED reference clock. Every fixture is built relative to this instant so the
 * baseline is deterministic (no `Date.now()`), and the equivalence test threads
 * the SAME value into `buildCellModel` as its `now`.
 */
export const NOW = Date.parse("2026-06-04T12:00:00.000Z");

/** A recent observation (well inside every staleness window). */
const FRESH = new Date(NOW - 60_000).toISOString();
/** An observation aged well past the e2e (6h) window → stale. */
const STALE = new Date(NOW - E2E_STALE_AFTER_MS - 60_000).toISOString();
/** A FUTURE-skewed observation (beyond the skew tolerance) — §E. Derived from
 * the imported tolerance (matching the live-engine tests) so this fixture stays
 * genuinely future-skewed if the tolerance ever changes, rather than silently
 * falling inside a widened window and re-freezing a non-skewed baseline. */
const FUTURE = new Date(NOW + FUTURE_SKEW_TOLERANCE_MS + 60_000).toISOString();

interface RowOpts {
  observedAt?: string;
  signal?: unknown;
  failCount?: number;
}

function row(key: string, state: State, opts: RowOpts = {}): StatusRow {
  const observed = opts.observedAt ?? FRESH;
  const [dimension = ""] = key.split(":");
  const isRed = state === "red";
  return {
    id: `id-${key}`,
    key,
    dimension,
    state,
    signal: "signal" in opts ? opts.signal : null,
    observed_at: observed,
    transitioned_at: observed,
    fail_count: opts.failCount ?? (isRed ? 1 : 0),
    first_failure_at: isRed ? observed : null,
  };
}

const SLUG = "acme";
/** Single-key D5 family. */
const F_SINGLE = "agentic-chat";
/** Multi-key D5 family (fans out to 5 per-pill literals). */
const F_MULTI = "beautiful-chat";
/** A feature with NO CATALOG_TO_D5_KEY entry → structural ceiling 4. */
const F_UNMAPPED = "no-such-d5-feature";

function wired(featureId: string): CellModelInput {
  return { slug: SLUG, featureId, isSupported: true, isWired: true };
}

/** All rows needed to make a feature FULLY GREEN through the D3→D6 ladder. */
function greenLadderRows(slug: string, featureId: string, observedAt: string) {
  const rows: StatusRow[] = [
    row(keyFor("e2e", slug, featureId), "green", { observedAt }),
    row(keyFor("chat", slug), "green", { observedAt }),
    row(keyFor("tools", slug), "green", { observedAt }),
  ];
  for (const ft of CATALOG_TO_D5_KEY[featureId] ?? []) {
    rows.push(row(keyFor("d5", slug, ft), "green", { observedAt }));
    rows.push(row(keyFor("d6", slug, ft), "green", { observedAt }));
  }
  return rows;
}

/** Fresh GREEN health + agent (D1/D2) rows. */
function livenessRows(state: State = "green", observedAt: string = FRESH) {
  return [
    row(keyFor("health", SLUG), state, { observedAt }),
    row(keyFor("agent", SLUG), state, { observedAt }),
  ];
}

export interface Fixture {
  name: string;
  input: CellModelInput;
  live: ReturnType<typeof mergeRowsToMap>;
}

// ---------------------------------------------------------------------------
// Base six (augmented per §7 step 1)
// ---------------------------------------------------------------------------

const BASE_FIXTURES: Fixture[] = [
  {
    // red-D0 whole column: e2e + chat red, fresh. (No D1/D2 augmentation — a
    // genuine fresh red must stay red regardless of the incoming gate.)
    name: "red-d0-whole-column",
    input: wired(F_SINGLE),
    live: mergeRowsToMap([
      row(keyFor("e2e", SLUG, F_SINGLE), "red"),
      row(keyFor("chat", SLUG), "red"),
    ]),
  },
  {
    // gray-D0 no-data column: no rows at all.
    name: "gray-d0-no-data-column",
    input: wired(F_SINGLE),
    live: mergeRowsToMap([]),
  },
  {
    // stale column: full green ladder aged past the e2e window; D1/D2 augmented
    // STALE (matching the ladder) so the U8 all-stale fold still folds to gray.
    name: "stale-column",
    input: wired(F_MULTI),
    live: mergeRowsToMap(
      greenLadderRows(SLUG, F_MULTI, STALE),
      livenessRows("green", STALE),
    ),
  },
  {
    // mixed green/red: green D3/D4/D5, red D6 sub-rows → broken top of ladder.
    // Augmented with FRESH green D1/D2.
    name: "mixed-green-red-column",
    input: wired(F_MULTI),
    live: mergeRowsToMap(
      [
        row(keyFor("e2e", SLUG, F_MULTI), "green"),
        row(keyFor("chat", SLUG), "green"),
        row(keyFor("tools", SLUG), "green"),
        ...(CATALOG_TO_D5_KEY[F_MULTI] ?? []).flatMap((ft) => [
          row(keyFor("d5", SLUG, ft), "green"),
          row(keyFor("d6", SLUG, ft), "red"),
        ]),
      ],
      livenessRows("green", FRESH),
    ),
  },
  {
    // all-green column: full green ladder, fresh, + FRESH green D1/D2.
    name: "all-green-column",
    input: wired(F_MULTI),
    live: mergeRowsToMap(
      greenLadderRows(SLUG, F_MULTI, FRESH),
      livenessRows("green", FRESH),
    ),
  },
  {
    // unsupported column: isSupported false → the UNSUPPORTED singleton.
    name: "unsupported-column",
    input: {
      slug: SLUG,
      featureId: F_SINGLE,
      isSupported: false,
      isWired: false,
    },
    live: mergeRowsToMap([
      row(keyFor("e2e", SLUG, F_SINGLE), "green"),
      row(keyFor("chat", SLUG), "green"),
    ]),
  },
];

// ---------------------------------------------------------------------------
// Combinatorial matrix (pruned reachable set, spec §6)
// ---------------------------------------------------------------------------

/** Rows for a single ladder position on the F_SINGLE (single-key) feature. */
type RungPos = "d3" | "d4" | "d5" | "d6";

function rungKeys(pos: RungPos, feature: string): string[] {
  switch (pos) {
    case "d3":
      return [keyFor("e2e", SLUG, feature)];
    case "d4":
      return [keyFor("chat", SLUG), keyFor("tools", SLUG)];
    case "d5":
      return (CATALOG_TO_D5_KEY[feature] ?? []).map((ft) =>
        keyFor("d5", SLUG, ft),
      );
    case "d6":
      return (CATALOG_TO_D5_KEY[feature] ?? []).map((ft) =>
        keyFor("d6", SLUG, ft),
      );
  }
}

/** A green-fresh row for every key of a rung. */
function greenRung(pos: RungPos, feature: string): StatusRow[] {
  return rungKeys(pos, feature).map((k) => row(k, "green"));
}

interface Variant {
  suffix: string;
  build: (pos: RungPos, feature: string) => StatusRow[];
}

const VARIANTS: Variant[] = [
  {
    suffix: "red-fresh",
    build: (p, f) => rungKeys(p, f).map((k) => row(k, "red")),
  },
  {
    suffix: "red-infra",
    build: (p, f) =>
      rungKeys(p, f).map((k) =>
        row(k, "red", { signal: { errorClass: "driver-error" } }),
      ),
  },
  {
    suffix: "red-signal-unknown",
    build: (p, f) =>
      rungKeys(p, f).map((k) => row(k, "red", { signal: undefined })),
  },
  {
    suffix: "degraded",
    build: (p, f) => rungKeys(p, f).map((k) => row(k, "degraded")),
  },
  {
    suffix: "stale-green",
    build: (p, f) =>
      rungKeys(p, f).map((k) => row(k, "green", { observedAt: STALE })),
  },
  { suffix: "absent", build: () => [] },
  {
    suffix: "future-skew-green",
    build: (p, f) =>
      rungKeys(p, f).map((k) => row(k, "green", { observedAt: FUTURE })),
  },
];

/** D4-only first-strike variants (fail_count crosses D4_FIRST_STRIKE_THRESHOLD=2). */
const D4_FIRST_STRIKE_VARIANTS: Variant[] = [
  {
    suffix: "d4-firststrike-fc1",
    build: (p, f) => rungKeys(p, f).map((k) => row(k, "red", { failCount: 1 })),
  },
  {
    suffix: "d4-firststrike-fc2",
    build: (p, f) => rungKeys(p, f).map((k) => row(k, "red", { failCount: 2 })),
  },
];

/**
 * Build an agent-axis fixture where all rungs below `pos` are green-fresh, all
 * rungs above are green-fresh, `pos` is the variant, and D1/D2 are green-fresh.
 */
function positionFixture(
  pos: RungPos,
  feature: string,
  variant: Variant,
): Fixture {
  const order: RungPos[] = ["d3", "d4", "d5", "d6"];
  const rows: StatusRow[] = [...livenessRows("green", FRESH)];
  for (const p of order) {
    if (p === pos) {
      rows.push(...variant.build(p, feature));
    } else {
      rows.push(...greenRung(p, feature));
    }
  }
  return {
    name: `pos-${pos}-${variant.suffix}`,
    input: wired(feature),
    live: mergeRowsToMap(rows),
  };
}

function positionSweep(): Fixture[] {
  const out: Fixture[] = [];
  const positions: RungPos[] = ["d3", "d4", "d5", "d6"];
  for (const pos of positions) {
    for (const v of VARIANTS) out.push(positionFixture(pos, F_SINGLE, v));
  }
  // D4 first-strike is D4-specific.
  for (const v of D4_FIRST_STRIKE_VARIANTS) {
    out.push(positionFixture("d4", F_SINGLE, v));
  }
  return out;
}

// ── D1/D2 (liveness) axis over a green D3–D6 ladder ────────────────────────
function livenessSweep(): Fixture[] {
  const ladder = greenLadderRows(SLUG, F_SINGLE, FRESH);
  const mk = (name: string, liveness: StatusRow[]): Fixture => ({
    name,
    input: wired(F_SINGLE),
    live: mergeRowsToMap(ladder, liveness),
  });
  return [
    mk("liveness-absent-over-green", []),
    mk("liveness-stale-over-green", livenessRows("green", STALE)),
    mk("liveness-green-over-green", livenessRows("green", FRESH)),
    mk("liveness-fresh-red-d1", [
      row(keyFor("health", SLUG), "red"),
      row(keyFor("agent", SLUG), "green"),
    ]),
    mk("liveness-fresh-red-d2", [
      row(keyFor("health", SLUG), "green"),
      row(keyFor("agent", SLUG), "red"),
    ]),
  ];
}

// ── D6 soft-parity top: green D3–D5, D6 varies ─────────────────────────────
function d6SoftParitySweep(): Fixture[] {
  const lower = [
    ...livenessRows("green", FRESH),
    row(keyFor("e2e", SLUG, F_SINGLE), "green"),
    row(keyFor("chat", SLUG), "green"),
    row(keyFor("tools", SLUG), "green"),
    row(keyFor("d5", SLUG, "agentic-chat"), "green"),
  ];
  const d6Key = keyFor("d6", SLUG, "agentic-chat");
  const mk = (name: string, d6: StatusRow[]): Fixture => ({
    name,
    input: wired(F_SINGLE),
    live: mergeRowsToMap(lower, d6),
  });
  return [
    mk("d6top-green", [row(d6Key, "green")]),
    mk("d6top-red-fresh", [row(d6Key, "red")]),
    mk("d6top-degraded", [row(d6Key, "degraded")]),
    mk("d6top-absent", []),
  ];
}

// ── D5-unmapped ceiling (structural ceiling 4) ─────────────────────────────
function unmappedD5Sweep(): Fixture[] {
  const base = [...livenessRows("green", FRESH)];
  const mk = (name: string, d4: StatusRow[]): Fixture => ({
    name,
    input: wired(F_UNMAPPED),
    live: mergeRowsToMap(
      base,
      [row(keyFor("e2e", SLUG, F_UNMAPPED), "green")],
      d4,
    ),
  });
  return [
    mk("unmapped-d5-green-d3d4", [
      row(keyFor("chat", SLUG), "green"),
      row(keyFor("tools", SLUG), "green"),
    ]),
    mk("unmapped-d5-red-d4", [
      row(keyFor("chat", SLUG), "red"),
      row(keyFor("tools", SLUG), "green"),
    ]),
  ];
}

// ── Multi-key D5 partial/red sub-row handling ──────────────────────────────
function multiKeyD5Sweep(): Fixture[] {
  const fts = CATALOG_TO_D5_KEY[F_MULTI] ?? [];
  const base = [
    ...livenessRows("green", FRESH),
    row(keyFor("e2e", SLUG, F_MULTI), "green"),
    row(keyFor("chat", SLUG), "green"),
    row(keyFor("tools", SLUG), "green"),
  ];
  // one d5 sub-row red, rest green; all d6 green
  const oneD5Red = fts.map((ft, i) =>
    row(keyFor("d5", SLUG, ft), i === 0 ? "red" : "green"),
  );
  // one d5 sub-row MISSING (omit index 0), rest green
  const oneD5Missing = fts
    .filter((_, i) => i !== 0)
    .map((ft) => row(keyFor("d5", SLUG, ft), "green"));
  const allD6 = fts.map((ft) => row(keyFor("d6", SLUG, ft), "green"));
  return [
    {
      name: "multikey-d5-one-red",
      input: wired(F_MULTI),
      live: mergeRowsToMap(base, oneD5Red, allD6),
    },
    {
      name: "multikey-d5-one-missing",
      input: wired(F_MULTI),
      live: mergeRowsToMap(base, oneD5Missing, allD6),
    },
  ];
}

// ── Starter axis ───────────────────────────────────────────────────────────
const STARTER_COL = "langgraph-python";
function starterInput(): CellModelInput {
  return {
    slug: STARTER_COL,
    featureId: "starter",
    isSupported: true,
    isWired: true,
    probeAxis: "starter",
  };
}
function starterRows(
  build: (level: string, i: number) => StatusRow | null,
): StatusRow[] {
  const out: StatusRow[] = [];
  STARTER_LEVELS.forEach((level, i) => {
    const r = build(level, i);
    if (r) out.push(r);
  });
  return out;
}
function starterSweep(): Fixture[] {
  const k = (level: string) => keyFor("starter", STARTER_COL, level);
  const mk = (name: string, rows: StatusRow[]): Fixture => ({
    name,
    input: starterInput(),
    live: mergeRowsToMap(rows),
  });
  return [
    mk(
      "starter-all-green",
      starterRows((l) => row(k(l), "green")),
    ),
    mk(
      "starter-soft-red-fc1",
      starterRows((l, i) =>
        i === 0
          ? row(k(l), "red", {
              signal: { errorClass: "transport-error" },
              failCount: 1,
            })
          : row(k(l), "green"),
      ),
    ),
    mk(
      "starter-soft-red-fc2",
      starterRows((l, i) =>
        i === 0
          ? row(k(l), "red", {
              signal: { errorClass: "transport-error" },
              failCount: 2,
            })
          : row(k(l), "green"),
      ),
    ),
    mk(
      "starter-hard-red",
      starterRows((l, i) =>
        i === 0
          ? row(k(l), "red", { signal: { errorClass: "smoke-failed" } })
          : row(k(l), "green"),
      ),
    ),
    mk(
      "starter-all-stale",
      starterRows((l) => row(k(l), "green", { observedAt: STALE })),
    ),
    mk(
      "starter-one-missing",
      starterRows((l, i) => (i === 0 ? null : row(k(l), "green"))),
    ),
    mk("starter-empty", []),
  ];
}

/**
 * The full committed fixture set — base six + the combinatorial matrix, sorted
 * by name so the baseline JSON key order is stable.
 */
export const FIXTURES: Fixture[] = [
  ...BASE_FIXTURES,
  ...positionSweep(),
  ...livenessSweep(),
  ...d6SoftParitySweep(),
  ...unmappedD5Sweep(),
  ...multiKeyD5Sweep(),
  ...starterSweep(),
].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

/**
 * Serialize the load-bearing fields of a `CellModel` deterministically. Key
 * order is fixed for byte-stable output.
 */
export function serializeModel(m: {
  supported: boolean;
  achievedDepth: number;
  ceilingDepth: number;
  chipColor: string;
  d6Effective: string | null;
  isRegression: boolean;
  isStaleCell: boolean;
  observedAtAgeMs: number | null;
  surfaceState: string;
  commError?: { kind: string } | undefined;
  d3: { exists: boolean; status: string | null } | null;
  d4: { exists: boolean; status: string | null } | null;
  d5: { exists: boolean; status: string | null } | null;
  d6: { exists: boolean; status: string | null } | null;
}): Record<string, unknown> {
  const lvl = (l: { exists: boolean; status: string | null } | null) =>
    l === null ? null : { exists: l.exists, status: l.status };
  return {
    supported: m.supported,
    achievedDepth: m.achievedDepth,
    ceilingDepth: m.ceilingDepth,
    chipColor: m.chipColor,
    d6Effective: m.d6Effective,
    isRegression: m.isRegression,
    isStaleCell: m.isStaleCell,
    observedAtAgeMs: m.observedAtAgeMs,
    surfaceState: m.surfaceState,
    commErrorKind: m.commError?.kind ?? null,
    d3: lvl(m.d3),
    d4: lvl(m.d4),
    d5: lvl(m.d5),
    d6: lvl(m.d6),
  };
}
