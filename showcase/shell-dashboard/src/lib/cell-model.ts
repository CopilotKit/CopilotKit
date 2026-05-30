/**
 * CellModel — single source of truth for Coverage-tab cell rendering.
 *
 * Replaces scattered inline derivation logic with one pure function
 * (`buildCellModel`) that computes every value a cell needs to render:
 * per-depth test levels, achieved/ceiling depths, chip color, and
 * regression flag.
 */

import type { LiveStatusMap, StatusRow, State } from "./live-status";
import { keyFor, CATALOG_TO_D5_KEY } from "./live-status";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type TestStatus = "green" | "red" | "amber" | null;
export type ChipColor = "green" | "amber" | "red" | "gray";

/**
 * Staleness window for the `e2e:` dimension. The e2e-demos driver writes
 * `e2e:<slug>/<feature>` rows hourly (`schedule: "10 * * * *"`, see
 * harness/config/probes/e2e-demos.yml). When the driver stops writing
 * (a wedged browser pool, a dead probe pipeline), the last row freezes —
 * a green row then reads as a healthy D3 forever, masking the outage as a
 * false-green. Mirroring the original ">6h stale" model (see
 * live-status.ts), a green e2e row whose `observed_at` is older than this
 * window is downgraded to `degraded` (amber) so the staleness surfaces
 * instead of presenting as green. 6h tolerates several missed hourly ticks
 * before flagging, avoiding flapping on a single skipped run.
 */
export const E2E_STALE_AFTER_MS = 6 * 60 * 60 * 1000;

export interface TestLevel {
  exists: boolean;
  status: TestStatus;
  row: StatusRow | null;
}

export interface CellModel {
  supported: boolean;
  d3: TestLevel | null;
  d4: TestLevel | null;
  d5: TestLevel | null;
  d6: TestLevel | null;
  achievedDepth: 0 | 3 | 4 | 5 | 6;
  ceilingDepth: 0 | 3 | 4 | 5 | 6;
  chipColor: ChipColor;
  isRegression: boolean;
}

export interface CellModelInput {
  slug: string;
  featureId: string;
  isSupported: boolean;
  isWired: boolean;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Map PocketBase State → TestStatus. */
function stateToTestStatus(state: State): TestStatus {
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

/** Rank for worst-state comparison: higher = worse. */
const STATE_RANK: Readonly<Record<State, number>> = {
  red: 3,
  degraded: 2,
  green: 1,
};

/**
 * Resolve the D4 (real-time) test level for `slug`.
 *
 * D4 checks both `chat:<slug>` and `tools:<slug>`. When both exist the
 * worst-state wins — a green chat + red tools yields red D4, not green.
 */
function resolveD4(live: LiveStatusMap, slug: string): TestLevel {
  const chatRow = live.get(keyFor("chat", slug)) ?? null;
  const toolsRow = live.get(keyFor("tools", slug)) ?? null;

  if (!chatRow && !toolsRow) {
    return { exists: false, status: null, row: null };
  }

  // Pick the worst row when both exist.
  let winner: StatusRow;
  if (chatRow && toolsRow) {
    winner =
      STATE_RANK[toolsRow.state] > STATE_RANK[chatRow.state]
        ? toolsRow
        : chatRow;
  } else {
    winner = (chatRow ?? toolsRow)!;
  }

  return {
    exists: true,
    status: stateToTestStatus(winner.state),
    row: winner,
  };
}

/**
 * Resolve the D5 (conversation verification) test level for
 * `(slug, featureId)`.
 *
 * Uses `CATALOG_TO_D5_KEY` to map catalog feature IDs to D5 PB row key
 * suffixes. When multiple sub-keys exist (e.g. `beautiful-chat` fans out
 * to 5 pills), worst-state wins.
 *
 * Staleness applies the same downgrade as `resolveD3`: a green D5 row whose
 * `observed_at` is older than `E2E_STALE_AFTER_MS` is downgraded to `amber`
 * (degraded). When the driver stops writing, a frozen-green row would
 * otherwise credit D5 forever — the same false-green mode one dimension up.
 * Only green is downgraded; a stale red/degraded row already signals a
 * problem and is left as-is.
 */
function resolveD5(
  live: LiveStatusMap,
  slug: string,
  featureId: string,
  now: number,
): TestLevel {
  const d5Keys = CATALOG_TO_D5_KEY[featureId];

  // No mapping → test doesn't exist for this feature.
  if (!d5Keys || d5Keys.length === 0) {
    return { exists: false, status: null, row: null };
  }

  let worst: StatusRow | null = null;
  for (const d5Key of d5Keys) {
    const row = live.get(keyFor("d5", slug, d5Key)) ?? null;
    if (!row) continue;
    if (!worst || STATE_RANK[row.state] > STATE_RANK[worst.state]) {
      worst = row;
    }
  }

  if (!worst) {
    // Keys are mapped but no rows emitted yet — test exists but has no
    // data. Treat as exists=true so ceilingDepth reflects it.
    return { exists: true, status: null, row: null };
  }

  if (worst.state === "green" && isStale(worst, now, E2E_STALE_AFTER_MS)) {
    return { exists: true, status: "amber", row: worst };
  }

  return {
    exists: true,
    status: stateToTestStatus(worst.state),
    row: worst,
  };
}

/**
 * Determine whether a row's `observed_at` is older than `maxAgeMs` relative
 * to `now`. An unparseable/missing timestamp is treated as NOT stale —
 * staleness must be a positive signal, never inferred from bad data.
 */
function isStale(row: StatusRow, now: number, maxAgeMs: number): boolean {
  const observedMs = Date.parse(row.observed_at);
  if (Number.isNaN(observedMs)) return false;
  return now - observedMs > maxAgeMs;
}

/**
 * Resolve the D3 (API / e2e) test level for `(slug, featureId)`.
 *
 * A green e2e row that has not been refreshed within `E2E_STALE_AFTER_MS`
 * is downgraded to `amber` (degraded): the driver has stopped writing, so
 * the frozen-green row is no longer trustworthy evidence of health. Only
 * green is downgraded — a stale red/degraded row already signals a problem
 * and is left as-is.
 */
function resolveD3(
  live: LiveStatusMap,
  slug: string,
  featureId: string,
  now: number,
): TestLevel {
  const row = live.get(keyFor("e2e", slug, featureId)) ?? null;
  if (!row) {
    return { exists: false, status: null, row: null };
  }
  if (row.state === "green" && isStale(row, now, E2E_STALE_AFTER_MS)) {
    return { exists: true, status: "amber", row };
  }
  return {
    exists: true,
    status: stateToTestStatus(row.state),
    row,
  };
}

/**
 * Resolve the D6 (parity-vs-reference) test level for `slug`.
 *
 * D6 is an aggregate integration-level signal (`d6:<slug>`), NOT per-cell.
 * The e2e-full driver emits a single row per integration that covers
 * the entire parity comparison against the reference implementation.
 *
 * Staleness applies the same downgrade as `resolveD3`: a green D6 row whose
 * `observed_at` is older than `E2E_STALE_AFTER_MS` is downgraded to `amber`
 * (degraded), so a frozen-green row from a stalled driver no longer credits
 * D6 forever. Only green is downgraded; stale red/degraded is left as-is.
 */
function resolveD6(live: LiveStatusMap, slug: string, now: number): TestLevel {
  const row = live.get(keyFor("d6", slug)) ?? null;
  if (!row) {
    return { exists: false, status: null, row: null };
  }
  if (row.state === "green" && isStale(row, now, E2E_STALE_AFTER_MS)) {
    return { exists: true, status: "amber", row };
  }
  return {
    exists: true,
    status: stateToTestStatus(row.state),
    row,
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

const NOT_WIRED_LEVEL: TestLevel = { exists: false, status: null, row: null };

const UNSUPPORTED: CellModel = {
  supported: false,
  d3: null,
  d4: null,
  d5: null,
  d6: null,
  achievedDepth: 0,
  ceilingDepth: 0,
  chipColor: "gray",
  isRegression: false,
};

/**
 * Build the complete cell model for a single (integration, feature) pair.
 *
 * This is the ONLY function that should derive cell rendering state —
 * every Coverage-tab component should call this instead of doing inline
 * resolution.
 */
export function buildCellModel(
  live: LiveStatusMap,
  input: CellModelInput,
  now: number = Date.now(),
): CellModel {
  const { slug, featureId, isSupported, isWired } = input;

  // ── Unsupported cell ──────────────────────────────────────────────
  if (!isSupported) {
    return UNSUPPORTED;
  }

  // ── Not wired (supported but no test harness configured) ──────────
  if (!isWired) {
    return {
      supported: true,
      d3: NOT_WIRED_LEVEL,
      d4: NOT_WIRED_LEVEL,
      d5: NOT_WIRED_LEVEL,
      d6: NOT_WIRED_LEVEL,
      achievedDepth: 0,
      ceilingDepth: 0,
      chipColor: "gray",
      isRegression: false,
    };
  }

  // ── Wired + supported: resolve each depth independently ───────────
  const d3 = resolveD3(live, slug, featureId, now);
  const d4 = resolveD4(live, slug);
  const d5 = resolveD5(live, slug, featureId, now);
  const d6 = resolveD6(live, slug, now);

  // ceilingDepth: highest CONTIGUOUS depth where a test EXISTS.
  // D4 only counts if D3 exists; D5 only counts if D4 counts; D6 only
  // counts if D5 counts.
  let ceilingDepth: 0 | 3 | 4 | 5 | 6 = 0;
  if (d3.exists) {
    ceilingDepth = 3;
    if (d4.exists) {
      ceilingDepth = 4;
      if (d5.exists) {
        ceilingDepth = 5;
        if (d6.exists) ceilingDepth = 6;
      }
    }
  }

  // achievedDepth: highest CONTIGUOUS passing depth.
  // D3 must pass before D4 counts, D4 before D5, D5 before D6.
  let achievedDepth: 0 | 3 | 4 | 5 | 6 = 0;
  if (d3.status === "green") {
    achievedDepth = 3;
    if (d4.status === "green") {
      achievedDepth = 4;
      if (d5.status === "green") {
        achievedDepth = 5;
        if (d6.status === "green") {
          achievedDepth = 6;
        }
      }
    }
  }

  // chipColor derivation — D6-ceiling algorithm:
  // NOTE: D1/D2 (liveness) failure causes D3 (e2e-demos) to also fail,
  // so checking d3.status implicitly covers the D1/D2 gate.
  const d1d4GateFails =
    (d3.exists && d3.status !== "green") ||
    (d4.exists && d4.status !== "green");

  let chipColor: ChipColor;
  if (d1d4GateFails) {
    chipColor = "red";
  } else if (d6.status === "green") {
    chipColor = "green";
  } else if (d5.status === "green") {
    chipColor = "amber";
  } else if (!d5.exists && !d6.exists) {
    chipColor = "gray";
  } else {
    chipColor = "red";
  }

  return {
    supported: true,
    d3,
    d4,
    d5,
    d6,
    achievedDepth,
    ceilingDepth,
    chipColor,
    isRegression: false,
  };
}
