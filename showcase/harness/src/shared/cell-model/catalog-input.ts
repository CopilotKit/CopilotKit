/**
 * The ONE shared mapping from a catalog cell's STRUCTURAL axes to a
 * `CellModelInput` (spec §5a). Both the dashboard render path (`deriveDepth`
 * adapter) and the harness `/api/matrix` read-model import this single function
 * so the two derivations can never diverge on how a cell becomes an engine
 * input (finding 2).
 *
 * It is defined over a MINIMAL structural type (`CellStructuralInput`) — NOT
 * the dashboard `data/catalog-types.CatalogCell`. The harness must never import
 * the dashboard (the dashboard depends on the harness via the barrel, not the
 * reverse). The dashboard `CatalogCell` superset is structurally assignable to
 * `CellStructuralInput` (it has `integration`/`feature`/`manifestation`/
 * `status`/`parity_tier`), so dashboard consumers pass their full cell directly
 * and TypeScript narrows (finding 6).
 */
import type { CellModelInput } from "./cell-model.js";

/**
 * The minimal STRUCTURAL axes the mapping needs. Field names match the
 * dashboard `CatalogCell` (`integration`/`feature`) so that superset is
 * structurally assignable here. The per-rung status is read from the
 * `LiveStatusMap` at build time, so this type carries only structure, not
 * results.
 */
export interface CellStructuralInput {
  /** The integration column slug (for a starter cell, its dashboard column slug). */
  integration: string;
  /** Catalog feature ID, or `null` for a liveness-only cell. */
  feature: string | null;
  manifestation: "integrated" | "starter";
  /** Wiring status: `wired` | `stub` | `unshipped` | `unsupported`. */
  status: string;
  /** Parity tier — not consumed by the engine; carried for parity views only. */
  parity_tier?: string;
}

/**
 * Map a catalog cell's structure to the engine's `CellModelInput` (§5a):
 *   - `probeAxis` — `"starter"` for a starter cell, else `"agent"`.
 *   - `slug` — the integration/column slug (`cell.integration`).
 *   - `featureId` — `cell.feature`; `null` (liveness-only) is passed through,
 *     and an EMPTY string is normalized to `null` (an empty per-feature segment
 *     is not a real feature and would make `keyFor` throw on the agent path).
 *   - `isSupported` — `status !== "unsupported"`.
 *   - `isWired` — `status === "wired" || status === "stub"` (a stub is
 *     wired-but-not-built).
 */
export function catalogCellToInput(cell: CellStructuralInput): CellModelInput {
  const probeAxis = cell.manifestation === "starter" ? "starter" : "agent";
  return {
    slug: cell.integration,
    featureId: cell.feature === "" ? null : cell.feature,
    isSupported: cell.status !== "unsupported",
    isWired: cell.status === "wired" || cell.status === "stub",
    probeAxis,
  };
}
