"use client";
/**
 * CellMatrix — 38-feature x 17-integration grid.
 *
 * Rows grouped by FeatureCategory with collapsible category separators.
 * Integration columns auto-sorted by parity tier (reference first,
 * then at_parity, partial, minimal, not_wired), alphabetical within tier.
 * Each cell renders a DepthChip.
 *
 * Uses a single flat <table> — category headers and feature rows are
 * sibling <tr> elements sharing the same column structure.
 */
import { useMemo, useState, useCallback, useRef, useEffect } from "react";
import { DepthChip } from "./depth-chip";
import { CellDrilldown } from "./cell-drilldown";
import { IntegrationHeader } from "./integration-header";
import { useCollapsible, CategoryHeaderRow } from "./collapsible-category";
import { deriveDepth } from "./depth-utils";
import type { CatalogCell, DepthResult } from "./depth-utils";
import type { ParityTier } from "./parity-badge";
import type { FilterMode } from "./filter-chips";
import { resolveCell } from "@/lib/live-status";
import type { LiveStatusMap, ConnectionStatus } from "@/lib/live-status";
import type { FeatureCategory } from "@/lib/registry";

/** Identifies a selected cell for drilldown. */
export interface SelectedCell {
  slug: string;
  featureId: string;
  integrationName: string;
  featureName: string;
}

export interface IntegrationInfo {
  slug: string;
  name: string;
  tier: ParityTier;
}

export interface FeatureInfo {
  id: string;
  name: string;
  category: string;
}

export interface CellMatrixProps {
  cells: CatalogCell[];
  categories: FeatureCategory[];
  features: FeatureInfo[];
  integrations: IntegrationInfo[];
  liveStatus: LiveStatusMap;
  defaultOpenCategories: Set<string>;
  filter: FilterMode;
  referenceSlug: string;
  connection?: ConnectionStatus;
}

/** Tier sort order — reference first. */
const TIER_ORDER: Record<ParityTier, number> = {
  reference: 0,
  at_parity: 1,
  partial: 2,
  minimal: 3,
  not_wired: 4,
};

function sortIntegrations(integrations: IntegrationInfo[]): IntegrationInfo[] {
  return [...integrations].sort((a, b) => {
    const tierDiff = TIER_ORDER[a.tier] - TIER_ORDER[b.tier];
    if (tierDiff !== 0) return tierDiff;
    return a.name.localeCompare(b.name);
  });
}

/* ------------------------------------------------------------------ */
/*  CategorySection — one collapsible group of feature rows            */
/* ------------------------------------------------------------------ */

interface CategorySectionProps {
  cat: FeatureCategory & { features: FeatureInfo[] };
  visibleIntegrations: IntegrationInfo[];
  cellIndex: Map<string, CatalogCell>;
  liveStatus: LiveStatusMap;
  defaultOpen: boolean;
  filter: FilterMode;
  filterFeatureRow: (featureId: string) => boolean;
  selectedCell: SelectedCell | null;
  onCellClick: (cell: SelectedCell | null) => void;
  connection: ConnectionStatus;
}

function CategorySection({
  cat,
  visibleIntegrations,
  cellIndex,
  liveStatus,
  defaultOpen,
  filter,
  filterFeatureRow,
  selectedCell,
  onCellClick,
  connection,
}: CategorySectionProps) {
  const { isOpen, toggle } = useCollapsible({
    name: cat.name,
    defaultOpen,
  });

  const wiredInCat = cat.features.reduce((acc, f) => {
    return (
      acc +
      visibleIntegrations.filter((int) => {
        const cell = cellIndex.get(`${int.slug}/${f.id}`);
        return cell?.status === "wired";
      }).length
    );
  }, 0);
  const totalInCat = cat.features.length * visibleIntegrations.length;

  const visibleFeatures = cat.features.filter((f) => filterFeatureRow(f.id));
  const displayFeatures =
    filter === "all" || filter === "reference" ? cat.features : visibleFeatures;

  return (
    <>
      <CategoryHeaderRow
        name={cat.name}
        count={`${wiredInCat}/${totalInCat}`}
        colSpan={visibleIntegrations.length + 1}
        isOpen={isOpen}
        onToggle={toggle}
      />
      {isOpen &&
        displayFeatures.map((feature) => (
          <tr
            key={feature.id}
            className="border-t border-[var(--border)] hover:bg-[var(--bg-hover)]"
          >
            <td className="sticky left-0 z-10 bg-[var(--bg-surface)] px-4 py-1.5 border-r border-[var(--border)] align-middle min-w-[200px]">
              <span className="text-xs text-[var(--text)]" title={feature.name}>
                {feature.name}
              </span>
            </td>
            {visibleIntegrations.map((int) => {
              const cell = cellIndex.get(`${int.slug}/${feature.id}`);
              const depth: DepthResult = cell
                ? deriveDepth(cell, liveStatus)
                : {
                    achieved: 0,
                    maxPossible: 0,
                    isRegression: false,
                    unsupported: false,
                  };
              const cellStatus = depth.unsupported
                ? "unsupported"
                : (cell?.status ?? "unshipped");

              const isSelected =
                selectedCell?.slug === int.slug &&
                selectedCell?.featureId === feature.id;

              return (
                <td
                  key={int.slug}
                  className="border-l border-[var(--border)] px-3 py-1.5 align-middle text-center relative"
                >
                  <button
                    type="button"
                    data-testid={`cell-btn-${int.slug}-${feature.id}`}
                    className="cursor-pointer bg-transparent border-none p-0"
                    onClick={() =>
                      isSelected
                        ? onCellClick(null)
                        : onCellClick({
                            slug: int.slug,
                            featureId: feature.id,
                            integrationName: int.name,
                            featureName: feature.name,
                          })
                    }
                  >
                    <DepthChip
                      depth={depth.achieved}
                      status={cellStatus}
                      maxDepth={depth.maxPossible}
                    />
                  </button>
                  {isSelected && (
                    <CellDrilldown
                      slug={int.slug}
                      featureId={feature.id}
                      integrationName={int.name}
                      featureName={feature.name}
                      liveStatus={liveStatus}
                      connection={connection}
                      onClose={() => onCellClick(null)}
                    />
                  )}
                </td>
              );
            })}
          </tr>
        ))}
    </>
  );
}

/* ------------------------------------------------------------------ */
/*  CellMatrix                                                         */
/* ------------------------------------------------------------------ */

export function CellMatrix({
  cells,
  categories,
  features,
  integrations,
  liveStatus,
  defaultOpenCategories,
  filter,
  referenceSlug,
  connection = "live",
}: CellMatrixProps) {
  const [selectedCell, setSelectedCell] = useState<SelectedCell | null>(null);
  const matrixRef = useRef<HTMLDivElement>(null);

  // Close drilldown on click-outside
  useEffect(() => {
    if (!selectedCell) return;
    function handleClickOutside(e: MouseEvent) {
      const target = e.target as Node;
      const drilldown = document.querySelector(
        "[data-testid='cell-drilldown']",
      );
      if (drilldown && !drilldown.contains(target)) {
        // Don't interfere with cell button clicks — their onClick handles toggle
        const cellBtn = (target as Element).closest?.(
          "[data-testid^='cell-btn-']",
        );
        if (cellBtn) return;
        setSelectedCell(null);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [selectedCell]);

  const handleCellClick = useCallback((cell: SelectedCell | null) => {
    setSelectedCell(cell);
  }, []);

  const sortedIntegrations = useMemo(
    () => sortIntegrations(integrations),
    [integrations],
  );

  // Filter integrations by reference if filter=reference
  const visibleIntegrations = useMemo(() => {
    if (filter === "reference") {
      return sortedIntegrations.filter((i) => i.slug === referenceSlug);
    }
    return sortedIntegrations;
  }, [sortedIntegrations, filter, referenceSlug]);

  // Index cells by integration+feature for O(1) lookup.
  const cellIndex = useMemo(() => {
    const idx = new Map<string, CatalogCell>();
    for (const c of cells) {
      idx.set(`${c.integration}/${c.feature}`, c);
    }
    return idx;
  }, [cells]);

  // Group features by category
  const featuresByCategory = useMemo(() => {
    return categories
      .map((cat) => ({
        ...cat,
        features: features.filter((f) => f.category === cat.id),
      }))
      .filter((cat) => cat.features.length > 0);
  }, [categories, features]);

  // Filter features based on mode
  const filterFeatureRow = (featureId: string): boolean => {
    if (filter === "all" || filter === "reference") return true;
    if (filter === "wired") {
      return visibleIntegrations.some((int) => {
        const cell = cellIndex.get(`${int.slug}/${featureId}`);
        return cell && cell.status === "wired";
      });
    }
    if (filter === "gaps") {
      return visibleIntegrations.some((int) => {
        const cell = cellIndex.get(`${int.slug}/${featureId}`);
        // Unshipped = structural gap. Unsupported is NOT a gap — the
        // framework architecturally cannot support it, so it's not work
        // we expect to do.
        if (!cell || cell.status === "unshipped") return true;
        if (cell.status === "unsupported") return false;
        // Red probes = functional gap (cell exists but failing)
        if (cell.feature !== null) {
          const cellState = resolveCell(liveStatus, int.slug, cell.feature);
          if (cellState.rollup === "red") return true;
        }
        return false;
      });
    }
    if (filter === "regressions") {
      return visibleIntegrations.some((int) => {
        const cell = cellIndex.get(`${int.slug}/${featureId}`);
        if (!cell) return false;
        const depth = deriveDepth(cell, liveStatus);
        return depth.isRegression;
      });
    }
    return true;
  };

  return (
    <div
      ref={matrixRef}
      data-testid="cell-matrix"
      className="overflow-auto rounded-lg border border-[var(--border)] bg-[var(--bg-surface)]"
    >
      <table className="border-collapse text-sm w-full">
        <thead>
          <tr>
            <th className="sticky left-0 top-0 z-30 bg-[var(--bg-muted)] px-4 py-3 text-left min-w-[200px] border-b border-[var(--border)]">
              <span className="text-[10px] font-medium uppercase tracking-wider text-[var(--text-muted)]">
                Feature
              </span>
            </th>
            {visibleIntegrations.map((int) => (
              <th
                key={int.slug}
                className="sticky top-0 z-20 bg-[var(--bg-muted)] px-3 py-3 text-left border-b border-l border-[var(--border)] font-normal min-w-[80px]"
              >
                <IntegrationHeader
                  slug={int.slug}
                  name={int.name}
                  tier={int.tier}
                />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {featuresByCategory.map((cat) => {
            const visibleFeatures = cat.features.filter((f) =>
              filterFeatureRow(f.id),
            );
            if (visibleFeatures.length === 0 && filter !== "all") return null;

            return (
              <CategorySection
                key={cat.id}
                cat={cat}
                visibleIntegrations={visibleIntegrations}
                cellIndex={cellIndex}
                liveStatus={liveStatus}
                defaultOpen={defaultOpenCategories.has(cat.id)}
                filter={filter}
                filterFeatureRow={filterFeatureRow}
                selectedCell={selectedCell}
                onCellClick={handleCellClick}
                connection={connection}
              />
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
