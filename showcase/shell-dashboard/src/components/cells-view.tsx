"use client";
/**
 * CellsView — top-level container for the Cells tab.
 *
 * Composes: StatsBar + CoverageBar + FilterChips + CellMatrix.
 * Props: catalog cells, liveStatus, connection status.
 */
import { useMemo, useState } from "react";
import { StatsBar } from "./stats-bar";
import { CoverageBar } from "./coverage-bar";
import { ChipsExplainer } from "./chips-explainer";
import { FilterChips, type FilterMode } from "./filter-chips";
import {
  CellMatrix,
  type IntegrationInfo,
  type FeatureInfo,
} from "./cell-matrix";
import { deriveDepth } from "./depth-utils";
import type { LiveStatusMap, ConnectionStatus } from "@/lib/live-status";
import type { FeatureCategory } from "@/lib/registry";
import type { CatalogData } from "@/data/catalog-types";

export interface CellsViewProps {
  catalog: CatalogData;
  liveStatus: LiveStatusMap;
  connection: ConnectionStatus;
}

/** Derive categories, features, and integrations from catalog cells. */
function deriveCatalogViews(cells: CatalogData["cells"]) {
  const categoryMap = new Map<string, FeatureCategory>();
  const featureMap = new Map<string, FeatureInfo>();
  const integrationMap = new Map<string, IntegrationInfo>();

  for (const cell of cells) {
    if (cell.category !== null && !categoryMap.has(cell.category)) {
      categoryMap.set(cell.category, {
        id: cell.category,
        name: cell.category_name ?? cell.category,
      });
    }
    if (cell.feature !== null && !featureMap.has(cell.feature)) {
      featureMap.set(cell.feature, {
        id: cell.feature,
        name: cell.feature_name ?? cell.feature,
        category: cell.category ?? "",
      });
    }
    if (!integrationMap.has(cell.integration)) {
      integrationMap.set(cell.integration, {
        slug: cell.integration,
        name: cell.integration_name ?? cell.integration,
        tier: cell.parity_tier,
      });
    }
  }

  return {
    categories: [...categoryMap.values()],
    features: [...featureMap.values()],
    integrations: [...integrationMap.values()],
  };
}

/**
 * Compute which categories should be expanded by default.
 * Auto-derived: top N categories by wired-cell count that collectively
 * cover 60%+ of wired cells, minimum 2.
 */
function computeDefaultOpenCategories(
  cells: CatalogData["cells"],
  categories: FeatureCategory[],
): Set<string> {
  // Count wired cells per category
  const wiredByCategory = new Map<string, number>();
  for (const cell of cells) {
    if (cell.status === "wired" && cell.category !== null) {
      wiredByCategory.set(
        cell.category,
        (wiredByCategory.get(cell.category) ?? 0) + 1,
      );
    }
  }

  const totalWired = cells.filter((c) => c.status === "wired").length;
  if (totalWired === 0) {
    // Open first 2 categories if no wired cells
    return new Set(categories.slice(0, 2).map((c) => c.id));
  }

  // Sort categories by wired count descending
  const sorted = [...categories]
    .map((cat) => ({ id: cat.id, wired: wiredByCategory.get(cat.id) ?? 0 }))
    .sort((a, b) => b.wired - a.wired);

  const result = new Set<string>();
  let accumulated = 0;
  const threshold = totalWired * 0.6;

  for (const cat of sorted) {
    result.add(cat.id);
    accumulated += cat.wired;
    if (result.size >= 2 && accumulated >= threshold) break;
  }

  return result;
}

export function CellsView({ catalog, liveStatus, connection }: CellsViewProps) {
  const referenceSlug = catalog.metadata.reference;
  const { categories, features, integrations } = useMemo(
    () => deriveCatalogViews(catalog.cells),
    [catalog.cells],
  );
  const [filter, setFilter] = useState<FilterMode>("all");

  const stats = useMemo(() => {
    const wired = catalog.cells.filter((c) => c.status === "wired").length;
    const stub = catalog.cells.filter((c) => c.status === "stub").length;
    const unshipped = catalog.cells.filter(
      (c) => c.status === "unshipped",
    ).length;

    // Max achieved depth across all cells
    let maxDepth = 0;
    for (const cell of catalog.cells) {
      if (cell.status !== "unshipped") {
        const d = deriveDepth(cell, liveStatus);
        if (d.achieved > maxDepth) maxDepth = d.achieved;
      }
    }

    return { wired, stub, unshipped, maxDepth, regressions: 0 };
  }, [catalog.cells, liveStatus]);

  const defaultOpenCategories = useMemo(
    () => computeDefaultOpenCategories(catalog.cells, categories),
    [catalog.cells, categories],
  );

  return (
    <div data-testid="cells-view" className="p-8">
      <ChipsExplainer />
      <StatsBar
        wired={stats.wired}
        stub={stats.stub}
        unshipped={stats.unshipped}
        maxDepth={stats.maxDepth}
        regressions={stats.regressions}
      />
      <div className="my-4 px-4">
        <CoverageBar
          wired={stats.wired}
          stub={stats.stub}
          unshipped={stats.unshipped}
        />
      </div>
      <div className="mb-4 px-4">
        <FilterChips onChange={setFilter} />
      </div>
      {connection === "error" && (
        <div
          role="alert"
          className="mb-4 rounded-md border border-[var(--danger)] bg-[var(--bg-danger)] px-4 py-2 text-xs text-[var(--danger)]"
        >
          dashboard unavailable — check #oss-alerts
        </div>
      )}
      <CellMatrix
        cells={catalog.cells}
        categories={categories}
        features={features}
        integrations={integrations}
        liveStatus={liveStatus}
        defaultOpenCategories={defaultOpenCategories}
        filter={filter}
        referenceSlug={referenceSlug}
      />
    </div>
  );
}
