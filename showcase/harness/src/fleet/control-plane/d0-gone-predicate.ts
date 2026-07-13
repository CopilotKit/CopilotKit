/**
 * Prod D0-gone predicate (spec §2.4) — a PURE fold over the per-cell `CellModel`
 * objects the shared `buildCellModel` fold produces (the SAME objects the
 * dashboard renders as DepthChips). There is NO standalone raw-DB re-derivation
 * here: "gone" is defined ENTIRELY in terms of `buildCellModel`'s outputs, so
 * the monitor's column verdict equals what the dashboard paints BY CONSTRUCTION.
 *
 * Two pure concerns live here, kept out of the monitor's stateful `tick()` so
 * they are unit-testable in isolation (spec §6.1):
 *
 *   1. `cellGone` / `columnGone` — the §2.4 predicate over `CellModel` fields.
 *   2. `wiredSupportedCells` — the per-slug (slug, featureId) enumeration the
 *      monitor runs `buildCellModel` over, derived from the SAME registry the
 *      dashboard's catalog is generated from (`showcase/scripts/generate-registry.ts`
 *      `determineCellStatus`), so the monitor evaluates the same wired+supported
 *      cell universe the dashboard's `page-stats` iterates.
 */

import type { CellModel } from "../../shared/cell-model/cell-model.js";

/**
 * The subset of `CellModel` the column-gone predicate reads. Declared as a
 * structural pick (not the whole `CellModel`) so the predicate is trivially
 * exercisable from a fixture without constructing a full model, and so a test
 * can assert these EXACT fields equal what `buildCellModel` produces (the §10.1
 * "no divergence" property).
 */
export interface CellGoneInput {
  achievedDepth: CellModel["achievedDepth"];
  chipColor: CellModel["chipColor"];
  isStaleCell: CellModel["isStaleCell"];
  surfaceState: CellModel["surfaceState"];
}

/**
 * §2.4 per-cell "gone" verdict — the backend-gone signature a human reads as a
 * red-D0 cell:
 *
 *   achievedDepth === 0   — the ladder collapsed to the floor (no rung passed)
 *   chipColor === "red"   — ran-and-failed (backend gone), NOT gray no-data/stale
 *   !isStaleCell          — fresh, not stale-by-age (a stale column is
 *                           inconclusive, handled by the producer-liveness gate)
 *   surfaceState ∉ { "unreachable", "pending" }
 *                         — the comm-error overlay is handled by the monitor's
 *                           §2.5 producer-liveness gate, NOT counted as spec-red
 *                           here (a `pending` teardown is not an outage; an
 *                           `unreachable` overlay is decided at the column/
 *                           producer level, never as a per-cell spec failure).
 */
export function cellGone(model: CellGoneInput): boolean {
  return (
    model.achievedDepth === 0 &&
    model.chipColor === "red" &&
    !model.isStaleCell &&
    model.surfaceState !== "unreachable" &&
    model.surfaceState !== "pending"
  );
}

/**
 * §2.4 column-gone predicate: a column is fully gone ONLY when it has at least
 * one wired+supported cell AND every such cell is `cellGone`. Fails safe: a
 * zero-wired column, an all-gray/no-data column, or a stale column returns
 * `false` (those are the producer-idle / no-data case, handled by the §2.5
 * producer-liveness gate — never paged as an outage).
 */
export function columnGone(cells: readonly CellGoneInput[]): boolean {
  if (cells.length === 0) return false;
  return cells.every(cellGone);
}

/**
 * §5.2 fresh-healthy predicate: a column is fresh-healthy when it has ≥1
 * wired+supported cell, NO cell is `cellGone`, and NO cell is stale (the whole
 * column has fresh evidence). This is the positive evidence a CLOSE/recovery
 * requires (§2.5/§5.2 F1 hardening) — absence-of-gone is NOT recovery when the
 * evidence itself went stale. A column with any stale cell is neither gone nor
 * fresh-healthy — it is inconclusive and HOLDs.
 */
export function columnFreshHealthy(cells: readonly CellGoneInput[]): boolean {
  if (cells.length === 0) return false;
  if (cells.some((c) => c.isStaleCell)) return false;
  return !cells.some(cellGone);
}

// ───────────────────────────────────────────────────────────────────────
// Wired+supported cell enumeration (registry-derived)
// ───────────────────────────────────────────────────────────────────────

/**
 * One (slug, featureId) cell the monitor evaluates. Mirrors the dashboard
 * `page-stats` iteration: a `status === "wired"` catalog cell, evaluated with
 * `isSupported: true` (a wired cell can never also be unsupported — see
 * `computeHealthStats`).
 */
export interface WiredCell {
  slug: string;
  featureId: string;
}

/**
 * The minimal registry-integration shape the enumeration reads. Matches the
 * `integrations[]` entries in the generated `registry.json` (which the harness
 * runtime ships at `/app/data/registry.json`).
 */
export interface RegistryIntegration {
  slug: string;
  features?: string[];
  not_supported_features?: string[];
  demos?: Array<{ id: string; route?: string }>;
}

/**
 * The minimal `registry.json` shape: the integrations list plus the
 * feature-registry feature ids (the cross-join axis the catalog is built over).
 */
export interface RegistryDoc {
  feature_registry?: {
    features?: Array<{ id: string; kind?: string }>;
  };
  integrations?: RegistryIntegration[];
}

/**
 * The `status === "wired"` classification, byte-for-byte the rule
 * `showcase/scripts/generate-registry.ts` `determineCellStatus` applies (which
 * is what the dashboard catalog — and therefore `page-stats` — enumerates over).
 * Pinned against the generator by `d0-gone-predicate.test.ts` so the monitor's
 * wired-cell universe cannot drift from the dashboard's.
 *
 *   unsupported — feature listed in `not_supported_features`
 *   unshipped   — feature not in `features`, OR no matching demo, OR a demo
 *                 with no route
 *   wired       — feature in `features` AND a matching demo WITH a route
 */
function isWiredCell(
  featureId: string,
  integration: RegistryIntegration,
): boolean {
  const notSupported = integration.not_supported_features ?? [];
  if (notSupported.includes(featureId)) return false;
  const features = integration.features ?? [];
  if (!features.includes(featureId)) return false;
  const demo = (integration.demos ?? []).find((d) => d.id === featureId);
  if (!demo) return false;
  return typeof demo.route === "string" && demo.route.length > 0;
}

/**
 * Enumerate the wired+supported (slug, featureId) cells for a registry doc,
 * grouped per slug. Cross-joins the feature-registry feature ids against every
 * integration (the same cross-join the catalog generator performs), keeping
 * only `wired` cells — EXCLUDING `docs-only` features (they have no route/probe
 * and are excluded from the catalog's wired/stub/unshipped/unsupported
 * accounting, so a slug's wired set matches the dashboard exactly).
 *
 * The result is keyed by slug; a slug with zero wired cells is present with an
 * empty array (the column-gone predicate fails safe on it).
 */
export function wiredSupportedCells(
  registry: RegistryDoc,
): Map<string, WiredCell[]> {
  const featureEntries = registry.feature_registry?.features ?? [];
  const featureIds = featureEntries
    .filter((f) => f.kind !== "docs-only")
    .map((f) => f.id);
  const byslug = new Map<string, WiredCell[]>();
  for (const integration of registry.integrations ?? []) {
    const cells: WiredCell[] = [];
    for (const featureId of featureIds) {
      if (isWiredCell(featureId, integration)) {
        cells.push({ slug: integration.slug, featureId });
      }
    }
    byslug.set(integration.slug, cells);
  }
  return byslug;
}
