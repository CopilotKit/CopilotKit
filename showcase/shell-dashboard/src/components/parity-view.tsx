"use client";
/**
 * ParityView — top-level container for the Parity tab.
 *
 * Composes: stats bar + parity legend + ParityMatrix.
 */
import { useMemo } from "react";
import { ParityBadge, type ParityTier } from "./parity-badge";
import { ParityMatrix, type IntegrationInfo, type FeatureInfo } from "./parity-matrix";
import type { LiveStatusMap, ConnectionStatus } from "@/lib/live-status";
import type { FeatureCategory } from "@/lib/registry";
import type { CatalogData } from "@/data/catalog-types";

export interface ParityViewProps {
  catalog: CatalogData;
  liveStatus: LiveStatusMap;
  connection: ConnectionStatus;
}

const TIER_LABELS: Array<{ tier: ParityTier; description: string }> = [
  { tier: "reference", description: "Most wired features (auto-detected)" },
  { tier: "at_parity", description: "Superset of reference features" },
  { tier: "partial", description: "3+ shared features with reference" },
  { tier: "minimal", description: "1-2 shared features with reference" },
  { tier: "not_wired", description: "No shared features with reference" },
];

/** Derive categories, features, and integrations from catalog cells. */
function deriveCatalogViews(cells: CatalogData["cells"]) {
  const categoryMap = new Map<string, FeatureCategory>();
  const featureMap = new Map<string, FeatureInfo>();
  const integrationMap = new Map<string, IntegrationInfo>();

  for (const cell of cells) {
    if (cell.category !== null && !categoryMap.has(cell.category)) {
      categoryMap.set(cell.category, { id: cell.category, name: cell.category_name ?? cell.category });
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
 * Compute which categories should be expanded by default (same logic as CellsView).
 */
function computeDefaultOpenCategories(
  cells: CatalogData["cells"],
  categories: FeatureCategory[],
): Set<string> {
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
    return new Set(categories.slice(0, 2).map((c) => c.id));
  }

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

export function ParityView({
  catalog,
  liveStatus,
  connection,
}: ParityViewProps) {
  const referenceSlug = catalog.metadata.reference;
  const { categories, features, integrations } = useMemo(
    () => deriveCatalogViews(catalog.cells),
    [catalog.cells],
  );
  const defaultOpenCategories = useMemo(
    () => computeDefaultOpenCategories(catalog.cells, categories),
    [catalog.cells, categories],
  );

  // Stats: count integrations by tier
  const tierCounts = useMemo(() => {
    const counts: Record<ParityTier, number> = {
      reference: 0,
      at_parity: 0,
      partial: 0,
      minimal: 0,
      not_wired: 0,
    };
    for (const int of integrations) {
      counts[int.tier]++;
    }
    return counts;
  }, [integrations]);

  return (
    <div data-testid="parity-view" className="p-8">
      {/* Stats bar: tier distribution */}
      <div className="flex items-center gap-6 px-4 py-3 mb-4">
        {Object.entries(tierCounts).map(([tier, count]) => (
          <div key={tier} className="flex items-center gap-2">
            <span className="text-lg font-bold tabular-nums text-[var(--text)]">
              {count}
            </span>
            <ParityBadge tier={tier as ParityTier} />
          </div>
        ))}
      </div>

      {/* Parity legend */}
      <div className="mb-4 px-4 flex flex-wrap gap-4 text-[11px] text-[var(--text-muted)]">
        {TIER_LABELS.map(({ tier, description }) => (
          <div key={tier} className="flex items-center gap-1.5">
            <ParityBadge tier={tier} />
            <span>{description}</span>
          </div>
        ))}
      </div>

      {connection === "error" && (
        <div
          role="alert"
          className="mb-4 rounded-md border border-[var(--danger)] bg-[var(--bg-danger)] px-4 py-2 text-xs text-[var(--danger)]"
        >
          dashboard unavailable — check #oss-alerts
        </div>
      )}

      <ParityMatrix
        cells={catalog.cells}
        categories={categories}
        features={features}
        integrations={integrations}
        liveStatus={liveStatus}
        defaultOpenCategories={defaultOpenCategories}
        referenceSlug={referenceSlug}
      />
    </div>
  );
}
