"use client";

/**
 * BaselineGrid — the main table component for the Baseline tab.
 *
 * Features (rows) x Partners (columns) with sticky headers, collapsible
 * categories, and inline popover editing.
 */

import { Fragment, useState, useMemo, useCallback } from "react";
import {
  BASELINE_PARTNERS,
  FEATURE_CATEGORIES,
  FEATURE_LABELS,
  type BaselineCell,
  type BaselineStatus,
  type BaselineTag,
} from "@/lib/baseline-types";
import { sortOrder } from "@/lib/sort-order";
import { BaselineCellView } from "@/components/baseline-cell";
import { BaselinePopover } from "@/components/baseline-popover";
import {
  useCollapsible,
  CategoryHeaderRow,
} from "@/components/collapsible-category";

/* ------------------------------------------------------------------ */
/*  Error toast — inline fallback until baseline-toast.tsx lands        */
/* ------------------------------------------------------------------ */

function showErrorToast(msg: string): void {
  // eslint-disable-next-line no-console
  console.error("[BaselineGrid]", msg);
}

/* ------------------------------------------------------------------ */
/*  Props                                                              */
/* ------------------------------------------------------------------ */

interface Props {
  cells: Map<string, BaselineCell>;
  editing: boolean;
  onUpdate: (
    key: string,
    status: BaselineStatus,
    tags: BaselineTag[],
  ) => Promise<void>;
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

/** Sort partners by sortOrder (fallback 500 for unknown slugs). */
function sortedPartners() {
  return [...BASELINE_PARTNERS].sort(
    (a, b) => (sortOrder[a.slug] ?? 500) - (sortOrder[b.slug] ?? 500),
  );
}

/** Get display name for a feature slug, falling back to Title Case. */
function featureLabel(slug: string): string {
  return (
    FEATURE_LABELS[slug] ??
    slug
      .split("-")
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(" ")
  );
}

/* ------------------------------------------------------------------ */
/*  CategorySection                                                    */
/* ------------------------------------------------------------------ */

interface CategorySectionProps {
  categoryName: string;
  featureSlugs: string[];
  partners: readonly { name: string; slug: string }[];
  cells: Map<string, BaselineCell>;
  editing: boolean;
  activeCell: string | null;
  onCellClick: (key: string) => void;
  onSave: (key: string, status: BaselineStatus, tags: BaselineTag[]) => void;
  colSpan: number;
}

function CategorySection({
  categoryName,
  featureSlugs,
  partners,
  cells,
  editing,
  activeCell,
  onCellClick,
  onSave,
  colSpan,
}: CategorySectionProps) {
  const { isOpen, toggle } = useCollapsible({
    name: `baseline:${categoryName}`,
    defaultOpen: true,
  });

  const countString = `${featureSlugs.length} features`;

  return (
    <Fragment>
      <CategoryHeaderRow
        name={categoryName}
        count={countString}
        colSpan={colSpan}
        isOpen={isOpen}
        onToggle={toggle}
      />
      {isOpen &&
        featureSlugs.map((featureSlug, idx) => {
          const stripe = idx % 2 === 1;
          const stripeBg = stripe
            ? "color-mix(in srgb, var(--bg-surface) 50%, var(--bg-muted))"
            : undefined;
          return (
            <tr
              key={featureSlug}
              className="grid-row border-t border-[var(--border)]"
              style={stripeBg ? { backgroundColor: stripeBg } : undefined}
            >
              {/* Feature name — sticky left */}
              <td
                className="sticky left-0 z-10 px-4 py-2 border-r border-[var(--border)] align-top min-w-[140px]"
                style={{ backgroundColor: stripeBg ?? "var(--bg-surface)" }}
              >
                <span className="text-[11px] font-medium text-[var(--text)]">
                  {featureLabel(featureSlug)}
                </span>
              </td>

              {/* Partner cells */}
              {partners.map((partner) => {
                const key = `${partner.slug}:${featureSlug}`;
                const cell = cells.get(key);
                const status = cell?.status ?? "unknown";
                const tags = cell?.tags ?? [];
                const isActive = activeCell === key;

                return (
                  <td
                    key={partner.slug}
                    onClick={editing ? () => onCellClick(key) : undefined}
                    className={`relative border-l border-[var(--border)] px-3 py-2 align-top text-center bg-[var(--bg)] ${
                      editing ? "cursor-pointer hover:bg-[var(--bg-muted)]" : ""
                    }`}
                  >
                    <BaselineCellView
                      status={status}
                      tags={tags}
                      editing={editing}
                    />
                    {isActive && (
                      <span
                        className="absolute inset-0 outline outline-2 outline-[var(--accent)] rounded pointer-events-none"
                        aria-hidden
                      />
                    )}
                    {isActive && editing && (
                      <BaselinePopover
                        status={status}
                        tags={tags}
                        onSave={(s, t) => onSave(key, s, t)}
                        onClose={() => onCellClick("")}
                      />
                    )}
                  </td>
                );
              })}
            </tr>
          );
        })}
    </Fragment>
  );
}

/* ------------------------------------------------------------------ */
/*  BaselineGrid                                                       */
/* ------------------------------------------------------------------ */

export function BaselineGrid({ cells, editing, onUpdate }: Props) {
  const [activeCell, setActiveCell] = useState<string | null>(null);

  const partners = useMemo(() => sortedPartners(), []);

  const handleCellClick = useCallback((key: string) => {
    setActiveCell((prev) => (prev === key ? null : key));
  }, []);

  const handleSave = useCallback(
    (key: string, status: BaselineStatus, tags: BaselineTag[]) => {
      setActiveCell(null);
      onUpdate(key, status, tags).catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : "Failed to save cell";
        showErrorToast(msg);
      });
    },
    [onUpdate],
  );

  const categoryEntries: [string, string[]][] = useMemo(
    () =>
      Object.entries(FEATURE_CATEGORIES).filter(
        ([, feats]) => feats.length > 0,
      ),
    [],
  );

  // +1 for the feature-name column
  const colSpan = partners.length + 1;

  return (
    <div className="overflow-auto px-4">
      <table className="border-collapse text-sm w-full">
        {/* ---- Header ---- */}
        <thead>
          <tr>
            {/* Feature column header — sticky left + top */}
            <th className="sticky left-0 top-0 z-20 bg-[var(--bg-muted)] px-4 py-3 text-left min-w-[140px] border-b border-[var(--border)]">
              <span className="text-[10px] font-medium uppercase tracking-wider text-[var(--text-muted)]">
                Feature
              </span>
            </th>

            {/* Partner column headers — sticky top */}
            {partners.map((partner) => (
              <th
                key={partner.slug}
                className="sticky top-0 z-10 bg-[var(--bg-muted)] px-2 py-3 text-center border-b border-l border-[var(--border)] font-normal min-w-[80px] max-w-[100px]"
              >
                <span
                  className="text-[10px] text-[var(--text-muted)] block truncate"
                  title={partner.name}
                >
                  {partner.name}
                </span>
              </th>
            ))}
          </tr>
        </thead>

        {/* ---- Body: category sections ---- */}
        <tbody>
          {categoryEntries.map(([categoryName, featureSlugs]) => (
            <CategorySection
              key={categoryName}
              categoryName={categoryName}
              featureSlugs={featureSlugs}
              partners={partners}
              cells={cells}
              editing={editing}
              activeCell={activeCell}
              onCellClick={handleCellClick}
              onSave={handleSave}
              colSpan={colSpan}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}
