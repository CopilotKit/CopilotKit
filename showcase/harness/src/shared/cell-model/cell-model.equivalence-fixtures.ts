/**
 * Committed equivalence fixtures for the `buildCellModel` relocation.
 *
 * These inputs exercise the pure cell-classification fold across the outcome
 * space the dashboard depends on: a red-D0 whole column, a gray-D0 no-data
 * column, a stale column, a mixed green/red column, an all-green column, and an
 * unsupported column. The `cell-model.equivalence.test.ts` runs `buildCellModel`
 * from the RELOCATED harness location over these SAME fixtures and asserts the
 * serialized output is byte-identical to the pre-move baseline captured in
 * `cell-model.equivalence-baseline.json` — proving the move preserved behavior.
 *
 * The row/input helpers mirror the shell-dashboard fixture style exactly (see
 * `shell-dashboard/src/lib/cell-model.test.ts` and its `__tests__` sibling): a
 * `row(key, state, {observedAt})` builder and `mergeRowsToMap(...groups)` to
 * assemble the `LiveStatusMap`.
 */
import type { StatusRow, State } from "./live-status";
import { keyFor, mergeRowsToMap, CATALOG_TO_D5_KEY } from "./live-status";
import type { CellModelInput } from "./cell-model";
import { E2E_STALE_AFTER_MS } from "./staleness";

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

function row(
  key: string,
  state: State,
  opts: { observedAt?: string } = {},
): StatusRow {
  const observed = opts.observedAt ?? FRESH;
  const [dimension = ""] = key.split(":");
  return {
    id: `id-${key}`,
    key,
    dimension,
    state,
    signal: null,
    observed_at: observed,
    transitioned_at: observed,
    fail_count: state === "red" ? 1 : 0,
    first_failure_at: state === "red" ? observed : null,
  };
}

const SLUG = "acme";
/** Single-key D5 family. */
const F_SINGLE = "agentic-chat";
/** Multi-key D5 family (fans out to 5 per-pill literals). */
const F_MULTI = "beautiful-chat";

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

export interface Fixture {
  name: string;
  input: CellModelInput;
  live: ReturnType<typeof mergeRowsToMap>;
}

/**
 * The committed fixture set. Order is stable and load-bearing — the baseline
 * JSON is keyed by `name`.
 */
export const FIXTURES: Fixture[] = [
  {
    // red-D0 whole column: every wired cell's e2e row is red, fresh.
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
    // stale column: a full green ladder, but every row aged past the e2e
    // window → the U8 matrix-staleness fold collapses the chip to gray.
    name: "stale-column",
    input: wired(F_MULTI),
    live: mergeRowsToMap(greenLadderRows(SLUG, F_MULTI, STALE)),
  },
  {
    // mixed green/red column: green D3/D4/D5, red D6 sub-rows → broken top of
    // ladder (chip amber, d6Effective red on the badge).
    name: "mixed-green-red-column",
    input: wired(F_MULTI),
    live: mergeRowsToMap([
      row(keyFor("e2e", SLUG, F_MULTI), "green"),
      row(keyFor("chat", SLUG), "green"),
      row(keyFor("tools", SLUG), "green"),
      ...(CATALOG_TO_D5_KEY[F_MULTI] ?? []).flatMap((ft) => [
        row(keyFor("d5", SLUG, ft), "green"),
        row(keyFor("d6", SLUG, ft), "red"),
      ]),
    ]),
  },
  {
    // all-green column: full green ladder, fresh.
    name: "all-green-column",
    input: wired(F_MULTI),
    live: mergeRowsToMap(greenLadderRows(SLUG, F_MULTI, FRESH)),
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

/**
 * Serialize the load-bearing fields of a `CellModel` deterministically. Covers
 * the fields the prompt calls out (achievedDepth, chipColor, isStaleCell,
 * surfaceState) PLUS the rest of the classification surface so the equivalence
 * assertion is broad, not narrow. Key order is fixed for byte-stable output.
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
