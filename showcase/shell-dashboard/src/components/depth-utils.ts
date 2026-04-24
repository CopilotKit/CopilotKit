/**
 * Pure depth-derivation utility for the D0-D4 depth ladder.
 *
 * Walks D0 through D4 checking PocketBase live-status rows:
 *   D0 = cell exists with status wired or stub (static, no PB)
 *   D1 = health:<slug> green (integration-scoped)
 *   D2 = agent:<slug> green (integration-scoped)
 *   D3 = e2e:<slug>/<featureId> green (per-cell)
 *   D4 = chat:<slug> OR tools:<slug> green (integration-scoped)
 *
 * Achieved depth = highest D where ALL lower depths are also green.
 * Short-circuits: if any level is not green, stop there.
 */
import { keyFor, type LiveStatusMap } from "@/lib/live-status";

/** Minimal catalog cell shape consumed by depth derivation. */
export interface CatalogCell {
  id: string;
  integration: string;
  integration_name: string;
  feature: string | null;
  feature_name: string | null;
  status: "wired" | "stub" | "unshipped";
  category: string | null;
  category_name: string | null;
}

export interface DepthResult {
  /** Highest contiguous depth achieved (0-4). */
  achieved: number;
  /** Whether depth has regressed from a previous high-water mark. Always false for now. */
  isRegression: boolean;
}

function isGreen(live: LiveStatusMap, key: string): boolean {
  const row = live.get(key);
  return row?.state === "green";
}

/**
 * Derive the achieved depth for a single catalog cell.
 *
 * The walk is contiguous: if D1 is not green, achieved = D0 regardless
 * of D2/D3/D4 status (short-circuit).
 */
export function deriveDepth(
  cell: CatalogCell,
  live: LiveStatusMap,
): DepthResult {
  // Unshipped cells never advance past D0.
  if (cell.status === "unshipped") {
    return { achieved: 0, isRegression: false };
  }

  // D0: cell exists (wired or stub) — always true if we reach here.
  let achieved = 0;

  // D1: health:<slug> green
  if (!isGreen(live, keyFor("health", cell.integration))) {
    return { achieved, isRegression: false };
  }
  achieved = 1;

  // D2: agent:<slug> green
  if (!isGreen(live, keyFor("agent", cell.integration))) {
    return { achieved, isRegression: false };
  }
  achieved = 2;

  // D3: e2e:<slug>/<featureId> green (per-cell)
  // Starter cells have null feature — skip D3, cap at D2.
  if (cell.feature === null) {
    return { achieved, isRegression: false };
  }
  if (!isGreen(live, keyFor("e2e", cell.integration, cell.feature))) {
    return { achieved, isRegression: false };
  }
  achieved = 3;

  // D4: chat:<slug> OR tools:<slug> green (integration-scoped)
  const chatGreen = isGreen(live, keyFor("chat", cell.integration));
  const toolsGreen = isGreen(live, keyFor("tools", cell.integration));
  if (chatGreen || toolsGreen) {
    achieved = 4;
  }

  return { achieved, isRegression: false };
}
