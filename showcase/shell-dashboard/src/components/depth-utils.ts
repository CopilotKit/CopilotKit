/**
 * @deprecated deriveDepth() has been replaced by buildCellModel() in @/lib/cell-model.ts.
 * CatalogCell type is still used by cell-matrix.tsx and other consumers.
 *
 * Pure depth-derivation utility for the D0-D6 depth ladder.
 *
 * Walks D0 through D6 checking PocketBase live-status rows:
 *   D0 = cell exists with status wired or stub (static, no PB)
 *   D1 = health:<slug> green (integration-scoped)
 *   D2 = agent:<slug> green (integration-scoped)
 *   D3 = e2e:<slug>/<featureId> green (per-cell)
 *   D4 = chat:<slug> OR tools:<slug> green (integration-scoped)
 *   D5 = d5:<slug>/<d5FeatureType> green (per-cell, mapped via CATALOG_TO_D5_KEY)
 *   D6 = d6:<slug> green (integration-scoped aggregate)
 *
 * Achieved depth = highest D where ALL lower depths are also green.
 * Short-circuits: if any level is not green, stop there.
 */
import { keyFor, CATALOG_TO_D5_KEY } from "@/lib/live-status";
import type { LiveStatusMap } from "@/lib/live-status";
import {
  E2E_STALE_AFTER_MS,
  D4_STALE_AFTER_MS,
  LIVENESS_STALE_AFTER_MS,
  isStale,
} from "@/lib/staleness";

/** Minimal catalog cell shape consumed by depth derivation. */
export interface CatalogCell {
  id: string;
  integration: string;
  integration_name: string;
  feature: string | null;
  feature_name: string | null;
  status: "wired" | "stub" | "unshipped" | "unsupported";
  /** Historical high-water mark for this cell's depth. */
  max_depth: number;
  category: string | null;
  category_name: string | null;
}

/** Achieved depth on the D0-D6 ladder. */
export type AchievedDepth = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export interface DepthResult {
  /** Highest contiguous depth achieved (0-6). */
  achieved: AchievedDepth;
  /**
   * Maximum possible depth for this cell based on probe EXISTENCE — not
   * whether probes are currently green, but whether a mapping/key exists
   * at each depth level. A feature with no entry in CATALOG_TO_D5_KEY
   * can never reach D5, so maxPossible caps at 4. This drives chip color:
   * green when achieved === maxPossible (cell is at its ceiling).
   */
  maxPossible: AchievedDepth;
  /** Whether achieved depth is below maxPossible (not historical max_depth). */
  isRegression: boolean;
  /**
   * True when the cell's catalog status is "unsupported". Unsupported cells
   * never advance on the depth ladder — their `achieved` is always 0 and
   * `isRegression` is always false. Consumers should render the unsupported
   * indicator (e.g. the no-entry chip) instead of a numeric depth.
   */
  unsupported: boolean;
}

/**
 * A row counts as green only when it is green AND fresh. A frozen-green row
 * from a stalled driver must NOT credit its depth — otherwise the depth ladder
 * reads a dead probe pipeline as a false-green (e.g. a D3 e2e signal whose
 * driver stopped writing). Mirrors the staleness downgrade `cell-model.ts`
 * applies to every dimension so both consumers agree.
 *
 * Each dimension supplies its own staleness window: D1/D2 (liveness) use
 * `LIVENESS_STALE_AFTER_MS`, D4 uses `D4_STALE_AFTER_MS`, and D3/D5/D6 use the
 * default `E2E_STALE_AFTER_MS`.
 */
function isGreenAndFresh(
  live: LiveStatusMap,
  key: string,
  now: number,
  maxAgeMs: number = E2E_STALE_AFTER_MS,
): boolean {
  const row = live.get(key);
  if (row?.state !== "green") return false;
  return !isStale(row, now, maxAgeMs);
}

/**
 * Check whether all D5 PB rows for a given (slug, catalogFeatureId) are green
 * AND fresh. Returns false if the feature has no D5 mapping or any mapped row
 * is missing/non-green/stale. The staleness gate mirrors `cell-model.ts` so a
 * frozen-green CV row from a stalled driver no longer credits D5.
 */
function isD5Green(
  live: LiveStatusMap,
  slug: string,
  featureId: string,
  now: number,
): boolean {
  const d5Keys = CATALOG_TO_D5_KEY[featureId];
  // No D5 mapping = no CV test exists for this feature = cannot be D5.
  // Previously fell back to a direct key lookup which could resolve true
  // from stale/shared PB rows, granting D5 to cells without CV tests.
  if (!d5Keys || d5Keys.length === 0) {
    return false;
  }
  return d5Keys.every((d5Key) =>
    isGreenAndFresh(live, keyFor("d5", slug, d5Key), now),
  );
}

/**
 * Compute the maximum possible depth for a cell based on probe EXISTENCE.
 * This checks whether the structural prerequisites for each depth level
 * exist (key mappings, feature ID), NOT whether probes are currently green.
 *
 * - D0: always possible for wired/stub cells
 * - D1-D4: always possible if the cell has a feature ID
 * - D5: possible only if CATALOG_TO_D5_KEY[featureId] exists and has entries
 * - D6: possible when a D5 mapping exists (D6 uses an integration-scoped
 *   aggregate key, so no additional per-feature mapping is needed)
 */
function computeMaxPossible(cell: CatalogCell): AchievedDepth {
  // Unsupported/unshipped: max possible is 0.
  if (cell.status === "unsupported" || cell.status === "unshipped") {
    return 0;
  }

  // No feature ID: can only reach D2 (integration-scoped probes).
  if (cell.feature === null) {
    return 2;
  }

  // Check if D5 is structurally possible (mapping exists).
  const d5Keys = CATALOG_TO_D5_KEY[cell.feature];
  if (!d5Keys || d5Keys.length === 0) {
    // No D5 mapping: max possible is D4.
    return 4;
  }

  // D5 mapping exists and D6 is reachable.
  return 6;
}

/**
 * Derive the achieved depth for a single catalog cell.
 *
 * The walk is contiguous: if D1 is not green, achieved = D0 regardless
 * of D2/D3/D4/D5/D6 status (short-circuit).
 */
export function deriveDepth(
  cell: CatalogCell,
  live: LiveStatusMap,
  now: number = Date.now(),
): DepthResult {
  const maxPossible = computeMaxPossible(cell);

  // Unsupported cells never enter the depth ladder at all — they're
  // architectural exclusions, not "cells at D0". Flag them explicitly
  // so consumers render the unsupported indicator instead of D0.
  if (cell.status === "unsupported") {
    return { achieved: 0, maxPossible, isRegression: false, unsupported: true };
  }

  // Unshipped cells never advance past D0 — no probes attached, no
  // possibility of regression.
  if (cell.status === "unshipped") {
    return {
      achieved: 0,
      maxPossible,
      isRegression: false,
      unsupported: false,
    };
  }

  // D0: cell exists (wired or stub) — always true if we reach here.
  let achieved: AchievedDepth = 0;

  // D1: health:<slug> green (liveness window)
  if (
    !isGreenAndFresh(
      live,
      keyFor("health", cell.integration),
      now,
      LIVENESS_STALE_AFTER_MS,
    )
  ) {
    return {
      achieved,
      maxPossible,
      isRegression: achieved < maxPossible,
      unsupported: false,
    };
  }
  achieved = 1;

  // D2: agent:<slug> green (liveness window)
  if (
    !isGreenAndFresh(
      live,
      keyFor("agent", cell.integration),
      now,
      LIVENESS_STALE_AFTER_MS,
    )
  ) {
    return {
      achieved,
      maxPossible,
      isRegression: achieved < maxPossible,
      unsupported: false,
    };
  }
  achieved = 2;

  // D3: e2e:<slug>/<featureId> green (per-cell)
  // Guard: skip D3+ if feature is null (no per-cell e2e to evaluate).
  if (cell.feature === null) {
    return {
      achieved,
      maxPossible,
      isRegression: achieved < maxPossible,
      unsupported: false,
    };
  }
  if (
    !isGreenAndFresh(live, keyFor("e2e", cell.integration, cell.feature), now)
  ) {
    return {
      achieved,
      maxPossible,
      isRegression: achieved < maxPossible,
      unsupported: false,
    };
  }
  achieved = 3;

  // D4: chat:<slug> OR tools:<slug> green (real-time window)
  const chatGreen = isGreenAndFresh(
    live,
    keyFor("chat", cell.integration),
    now,
    D4_STALE_AFTER_MS,
  );
  const toolsGreen = isGreenAndFresh(
    live,
    keyFor("tools", cell.integration),
    now,
    D4_STALE_AFTER_MS,
  );
  if (!(chatGreen || toolsGreen)) {
    return {
      achieved,
      maxPossible,
      isRegression: achieved < maxPossible,
      unsupported: false,
    };
  }
  achieved = 4;

  // D5: d5:<slug>/<d5FeatureType> green (per-cell, mapped via CATALOG_TO_D5_KEY)
  if (!isD5Green(live, cell.integration, cell.feature, now)) {
    return {
      achieved,
      maxPossible,
      isRegression: achieved < maxPossible,
      unsupported: false,
    };
  }
  achieved = 5;

  // D6: d6:<slug> green (integration-scoped aggregate)
  if (isGreenAndFresh(live, keyFor("d6", cell.integration), now)) {
    achieved = 6;
  }

  return {
    achieved,
    maxPossible,
    isRegression: achieved < maxPossible,
    unsupported: false,
  };
}
