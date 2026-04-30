"use client";
/**
 * ParityMatrix — 38-feature rows x 17-integration columns.
 *
 * The reference integration's depth appears as a frozen first column
 * labeled "Ref Depth" regardless of alphabetical position. Each cell
 * shows a DepthChip colored by parity tier. Same collapsible category
 * grouping as CellMatrix.
 *
 * Uses a single flat <table> — category headers and feature rows are
 * sibling <tr> elements sharing the same column structure.
 */
import { useMemo } from "react";
import { DepthChip } from "./depth-chip";
import { IntegrationHeader } from "./integration-header";
import { useCollapsible, CategoryHeaderRow } from "./collapsible-category";
import { deriveDepth } from "./depth-utils";
import type { CatalogCell, DepthResult } from "./depth-utils";
import type { ParityTier } from "./parity-badge";
import type { LiveStatusMap } from "@/lib/live-status";
import type { FeatureCategory } from "@/lib/registry";

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

export interface ParityMatrixProps {
  cells: CatalogCell[];
  categories: FeatureCategory[];
  features: FeatureInfo[];
  integrations: IntegrationInfo[];
  liveStatus: LiveStatusMap;
  defaultOpenCategories: Set<string>;
  referenceSlug: string;
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

interface ParityCategorySectionProps {
  cat: FeatureCategory & { features: FeatureInfo[] };
  nonRefIntegrations: IntegrationInfo[];
  sortedIntegrations: IntegrationInfo[];
  cellIndex: Map<string, CatalogCell>;
  liveStatus: LiveStatusMap;
  defaultOpen: boolean;
  referenceSlug: string;
}

function ParityCategorySection({
  cat,
  nonRefIntegrations,
  sortedIntegrations,
  cellIndex,
  liveStatus,
  defaultOpen,
  referenceSlug,
}: ParityCategorySectionProps) {
  const { isOpen, toggle } = useCollapsible({
    name: cat.name,
    defaultOpen,
  });

  const wiredInCat = cat.features.reduce((acc, f) => {
    return (
      acc +
      sortedIntegrations.filter((int) => {
        const cell = cellIndex.get(`${int.slug}/${f.id}`);
        return cell?.status === "wired";
      }).length
    );
  }, 0);
  const totalInCat = cat.features.length * sortedIntegrations.length;

  // colSpan = Feature col + Ref Depth col + non-ref integration cols
  const colSpan = nonRefIntegrations.length + 2;

  return (
    <>
      <CategoryHeaderRow
        name={cat.name}
        count={`${wiredInCat}/${totalInCat}`}
        colSpan={colSpan}
        isOpen={isOpen}
        onToggle={toggle}
      />
      {isOpen &&
        cat.features.map((feature) => {
          const refCell = cellIndex.get(`${referenceSlug}/${feature.id}`);
          const refDepth: DepthResult = refCell
            ? deriveDepth(refCell, liveStatus)
            : { achieved: 0, isRegression: false, unsupported: false };
          const refStatus = refDepth.unsupported
            ? "unsupported"
            : (refCell?.status ?? "unshipped");

          return (
            <tr
              key={feature.id}
              className="border-t border-[var(--border)] hover:bg-[var(--bg-hover)]"
            >
              <td className="sticky left-0 z-10 bg-[var(--bg-surface)] px-4 py-1.5 border-r border-[var(--border)] align-middle min-w-[200px]">
                <span className="text-xs text-[var(--text)]">
                  {feature.name}
                </span>
              </td>
              <td className="border-l border-[var(--border)] px-3 py-1.5 align-middle text-center bg-purple-900/5">
                <DepthChip
                  depth={refDepth.achieved}
                  status={refStatus}
                  regression={refDepth.isRegression}
                />
              </td>
              {nonRefIntegrations.map((int) => {
                const cell = cellIndex.get(`${int.slug}/${feature.id}`);
                const depth: DepthResult = cell
                  ? deriveDepth(cell, liveStatus)
                  : { achieved: 0, isRegression: false, unsupported: false };
                const cellStatus = depth.unsupported
                  ? "unsupported"
                  : (cell?.status ?? "unshipped");

                return (
                  <td
                    key={int.slug}
                    className="border-l border-[var(--border)] px-3 py-1.5 align-middle text-center"
                  >
                    <DepthChip
                      depth={depth.achieved}
                      status={cellStatus}
                      regression={depth.isRegression}
                    />
                  </td>
                );
              })}
            </tr>
          );
        })}
    </>
  );
}

/* ------------------------------------------------------------------ */
/*  ParityMatrix                                                       */
/* ------------------------------------------------------------------ */

export function ParityMatrix({
  cells,
  categories,
  features,
  integrations,
  liveStatus,
  defaultOpenCategories,
  referenceSlug,
}: ParityMatrixProps) {
  const sortedIntegrations = useMemo(
    () => sortIntegrations(integrations),
    [integrations],
  );

  // Separate reference from the rest — reference shows as frozen "Ref Depth" column
  const nonRefIntegrations = useMemo(
    () => sortedIntegrations.filter((i) => i.slug !== referenceSlug),
    [sortedIntegrations, referenceSlug],
  );

  // Index cells by integration+feature for O(1) lookup.
  // Skip starter cells (feature === null) — they have no feature row to render
  // and would otherwise produce a bogus "<slug>/null" key that orphans them.
  const cellIndex = useMemo(() => {
    const idx = new Map<string, CatalogCell>();
    for (const c of cells) {
      if (c.feature === null) continue;
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

  return (
    <div
      data-testid="parity-matrix"
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
            <th className="sticky top-0 z-20 bg-[var(--bg-muted)] px-3 py-3 text-center border-b border-l border-[var(--border)] font-normal min-w-[80px]">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-purple-400">
                Ref Depth
              </span>
            </th>
            {nonRefIntegrations.map((int) => (
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
          {featuresByCategory.map((cat) => (
            <ParityCategorySection
              key={cat.id}
              cat={cat}
              nonRefIntegrations={nonRefIntegrations}
              sortedIntegrations={sortedIntegrations}
              cellIndex={cellIndex}
              liveStatus={liveStatus}
              defaultOpen={defaultOpenCategories.has(cat.id)}
              referenceSlug={referenceSlug}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}
