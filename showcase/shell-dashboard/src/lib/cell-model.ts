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
  achievedDepth: 0 | 3 | 4 | 5;
  ceilingDepth: 0 | 3 | 4 | 5;
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
 */
function resolveD5(
  live: LiveStatusMap,
  slug: string,
  featureId: string,
): TestLevel {
  const d5Keys = CATALOG_TO_D5_KEY[featureId];

  // No mapping and no fallback row → test doesn't exist for this feature.
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

  return {
    exists: true,
    status: stateToTestStatus(worst.state),
    row: worst,
  };
}

/**
 * Resolve the D3 (API / e2e) test level for `(slug, featureId)`.
 */
function resolveD3(
  live: LiveStatusMap,
  slug: string,
  featureId: string,
): TestLevel {
  const row = live.get(keyFor("e2e", slug, featureId)) ?? null;
  if (!row) {
    return { exists: false, status: null, row: null };
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
      achievedDepth: 0,
      ceilingDepth: 0,
      chipColor: "gray",
      isRegression: false,
    };
  }

  // ── Wired + supported: resolve each depth independently ───────────
  const d3 = resolveD3(live, slug, featureId);
  const d4 = resolveD4(live, slug);
  const d5 = resolveD5(live, slug, featureId);

  // ceilingDepth: highest CONTIGUOUS depth where a test EXISTS.
  // D4 only counts if D3 exists; D5 only counts if D4 counts.
  let ceilingDepth: 0 | 3 | 4 | 5 = 0;
  if (d3.exists) {
    ceilingDepth = 3;
    if (d4.exists) {
      ceilingDepth = 4;
      if (d5.exists) ceilingDepth = 5;
    }
  }

  // achievedDepth: highest CONTIGUOUS passing depth.
  // D3 must pass before D4 counts, D4 must pass before D5 counts.
  let achievedDepth: 0 | 3 | 4 | 5 = 0;
  if (d3.status === "green") {
    achievedDepth = 3;
    if (d4.status === "green") {
      achievedDepth = 4;
      if (d5.status === "green") {
        achievedDepth = 5;
      }
    }
  }

  // chipColor derivation:
  //   gray   → no tests exist at all (ceilingDepth === 0)
  //   red    → tests exist but none pass (achievedDepth === 0, ceiling > 0)
  //   green  → achieved === ceiling (all passing)
  //   amber  → ceiling - achieved <= 1 (close gap)
  //   red    → ceiling - achieved > 1 (wide gap)
  let chipColor: ChipColor;
  if (ceilingDepth === 0) {
    chipColor = "gray";
  } else if (achievedDepth === 0) {
    chipColor = "red";
  } else if (achievedDepth >= ceilingDepth) {
    chipColor = "green";
  } else if (ceilingDepth - achievedDepth <= 1) {
    chipColor = "amber";
  } else {
    chipColor = "red";
  }

  return {
    supported: true,
    d3,
    d4,
    d5,
    achievedDepth,
    ceilingDepth,
    chipColor,
    isRegression: false,
  };
}
