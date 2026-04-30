/**
 * Pure depth-derivation utility for the D0-D6 depth ladder.
 *
 * Walks D0 through D6 checking PocketBase live-status rows:
 *   D0 = cell exists with status wired or stub (static, no PB)
 *   D1 = health:<slug> green (integration-scoped)
 *   D2 = agent:<slug> green (integration-scoped)
 *   D3 = e2e:<slug>/<featureId> green (per-cell)
 *   D4 = chat:<slug> OR tools:<slug> green (integration-scoped)
 *   D5 = d5:<slug>/<d5FeatureType> green (per-cell, mapped via CATALOG_TO_D5_KEY)
 *   D6 = d6:<slug>/<featureId> green (per-cell)
 *
 * Achieved depth = highest D where ALL lower depths are also green.
 * Short-circuits: if any level is not green, stop there.
 */
import {
  keyFor,
  CATALOG_TO_D5_KEY,
  type LiveStatusMap,
} from "@/lib/live-status";

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
  /** Whether achieved depth is below the historical high-water mark (max_depth). */
  isRegression: boolean;
  /**
   * True when the cell's catalog status is "unsupported". Unsupported cells
   * never advance on the depth ladder — their `achieved` is always 0 and
   * `isRegression` is always false. Consumers should render the unsupported
   * indicator (e.g. the no-entry chip) instead of a numeric depth.
   */
  unsupported: boolean;
}

function isGreen(live: LiveStatusMap, key: string): boolean {
  const row = live.get(key);
  return row?.state === "green";
}

/**
 * Check whether all D5 PB rows for a given (slug, catalogFeatureId) are green.
 * Returns false if the feature has no D5 mapping or any mapped row is missing/non-green.
 */
function isD5Green(
  live: LiveStatusMap,
  slug: string,
  featureId: string,
): boolean {
  const d5Keys = CATALOG_TO_D5_KEY[featureId];
  if (!d5Keys || d5Keys.length === 0) {
    return isGreen(live, keyFor("d5", slug, featureId));
  }
  return d5Keys.every((d5Key) => isGreen(live, keyFor("d5", slug, d5Key)));
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
): DepthResult {
  // Unsupported cells never enter the depth ladder at all — they're
  // architectural exclusions, not "cells at D0". Flag them explicitly
  // so consumers render the unsupported indicator instead of D0.
  if (cell.status === "unsupported") {
    return { achieved: 0, isRegression: false, unsupported: true };
  }

  // Unshipped cells never advance past D0 — no probes attached, no
  // possibility of regression.
  if (cell.status === "unshipped") {
    return { achieved: 0, isRegression: false, unsupported: false };
  }

  // D0: cell exists (wired or stub) — always true if we reach here.
  let achieved: AchievedDepth = 0;

  // D1: health:<slug> green
  if (!isGreen(live, keyFor("health", cell.integration))) {
    return {
      achieved,
      isRegression: achieved < cell.max_depth,
      unsupported: false,
    };
  }
  achieved = 1;

  // D2: agent:<slug> green
  if (!isGreen(live, keyFor("agent", cell.integration))) {
    return {
      achieved,
      isRegression: achieved < cell.max_depth,
      unsupported: false,
    };
  }
  achieved = 2;

  // D3: e2e:<slug>/<featureId> green (per-cell)
  // Guard: skip D3+ if feature is null (no per-cell e2e to evaluate).
  if (cell.feature === null) {
    return {
      achieved,
      isRegression: achieved < cell.max_depth,
      unsupported: false,
    };
  }
  if (!isGreen(live, keyFor("e2e", cell.integration, cell.feature))) {
    return {
      achieved,
      isRegression: achieved < cell.max_depth,
      unsupported: false,
    };
  }
  achieved = 3;

  // D4: chat:<slug> OR tools:<slug> green (integration-scoped)
  const chatGreen = isGreen(live, keyFor("chat", cell.integration));
  const toolsGreen = isGreen(live, keyFor("tools", cell.integration));
  if (!(chatGreen || toolsGreen)) {
    return {
      achieved,
      isRegression: achieved < cell.max_depth,
      unsupported: false,
    };
  }
  achieved = 4;

  // D5: d5:<slug>/<d5FeatureType> green (per-cell, mapped via CATALOG_TO_D5_KEY)
  if (!isD5Green(live, cell.integration, cell.feature)) {
    return {
      achieved,
      isRegression: achieved < cell.max_depth,
      unsupported: false,
    };
  }
  achieved = 5;

  // D6: d6:<slug>/<featureId> green (per-cell)
  if (isGreen(live, keyFor("d6", cell.integration, cell.feature))) {
    achieved = 6;
  }

  return {
    achieved,
    isRegression: achieved < cell.max_depth,
    unsupported: false,
  };
}
