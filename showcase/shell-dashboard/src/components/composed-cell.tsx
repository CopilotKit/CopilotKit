"use client";
/**
 * ComposedCell — overlay-aware cell renderer.
 *
 * Composes different content layers (Links, Depth, Health, Docs) based on
 * which overlays are currently active. Replaces per-tab cell renderers with
 * a single composable component that stacks only the active layers.
 */

import { memo, useState, useEffect, useRef, useCallback } from "react";
import type { CellContext } from "@/components/feature-grid";
import { CellStatus, DocsRow, urlsFor } from "@/components/cell-pieces";
import { CellDrilldown } from "@/components/cell-drilldown";
import { CommandCell } from "@/components/command-cell";
import { DepthChip } from "@/components/depth-chip";
import { deriveDepth } from "@/components/depth-utils";
import type { CatalogCell } from "@/components/depth-utils";
import { keyFor } from "@/lib/live-status";

/** Overlay types — defined locally; canonical types live in a sibling module. */
export type Overlay = "links" | "depth" | "health" | "parity" | "docs";

export interface ComposedCellProps {
  ctx: CellContext;
  overlays: Set<Overlay>;
  catalogCell?: CatalogCell;
}

/**
 * Render the Links layer: Demo + Code links.
 * For command demos, renders CommandCell instead.
 */
function LinksLayer({ ctx }: { ctx: CellContext }) {
  if (ctx.demo.command) {
    return <CommandCell ctx={ctx} />;
  }

  const links = urlsFor(ctx);

  return (
    <div className="flex items-center justify-center gap-1.5">
      <a
        href={links.demoUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="whitespace-nowrap text-[var(--accent)] hover:underline"
      >
        <span className="text-[var(--text-muted)]">Demo</span> <span>↗</span>
      </a>
      <a
        href={links.codeUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="whitespace-nowrap text-[var(--accent)] hover:underline"
      >
        <span className="text-[var(--text-muted)]">Code</span>{" "}
        <span>{"</>"}</span>
      </a>
    </div>
  );
}

/**
 * Render the Depth layer: DepthChip showing D0-D6 with regression marker.
 * Clicking the chip opens a CellDrilldown popup with per-badge dimension details.
 */
function DepthLayer({
  ctx,
  catalogCell,
}: {
  ctx: CellContext;
  catalogCell?: CatalogCell;
}) {
  const [drilldownOpen, setDrilldownOpen] = useState<boolean>(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const closeDrilldown = useCallback(() => setDrilldownOpen(false), []);

  // Close drilldown on click-outside
  useEffect(() => {
    if (!drilldownOpen) return;
    function handleClickOutside(e: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setDrilldownOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [drilldownOpen]);

  if (!catalogCell) return null;

  const depth = deriveDepth(catalogCell, ctx.liveStatus);

  return (
    <div
      ref={containerRef}
      className="flex items-center gap-1 relative"
      data-testid="depth-layer"
    >
      <button
        type="button"
        data-testid={`depth-btn-${ctx.integration.slug}-${ctx.feature.id}`}
        className="cursor-pointer bg-transparent border-none p-0"
        onClick={() => setDrilldownOpen((prev) => !prev)}
      >
        <DepthChip
          depth={depth.achieved}
          status={catalogCell.status}
          maxDepth={depth.maxPossible}
        />
      </button>
      {drilldownOpen && (
        <CellDrilldown
          slug={ctx.integration.slug}
          featureId={ctx.feature.id}
          integrationName={ctx.integration.name}
          featureName={ctx.feature.name}
          liveStatus={ctx.liveStatus}
          connection={ctx.connection}
          onClose={closeDrilldown}
        />
      )}
    </div>
  );
}

/**
 * Render the Health layer: RT, CV, FP badge chips via CellStatus.
 */
function HealthLayer({ ctx }: { ctx: CellContext }) {
  return (
    <div data-testid="health-layer">
      <CellStatus ctx={ctx} />
    </div>
  );
}

/**
 * Render the Docs layer: docs-og + docs-shell row.
 */
function DocsLayer({ ctx }: { ctx: CellContext }) {
  return (
    <div data-testid="docs-layer">
      <DocsRow
        integration={ctx.integration}
        feature={ctx.feature}
        shellUrl={ctx.shellUrl}
      />
    </div>
  );
}

/**
 * ComposedCell — stacks active overlay layers top-to-bottom:
 *   1. Links (when "links" active)
 *   2. Depth (when "depth" active)
 *   3. Health (when "health" active)
 *   4. Docs (when "docs" active)
 *
 * "parity" overlay adds no per-cell content — if only parity is active,
 * the cell renders empty.
 */
function ComposedCellInner({ ctx, overlays, catalogCell }: ComposedCellProps) {
  const isTesting = ctx.feature.kind === "testing";
  const isDocsOnly = ctx.feature.kind === "docs-only";
  const hasLinks = overlays.has("links");
  const hasDepth = overlays.has("depth");
  const hasHealth = overlays.has("health");
  const hasDocs = overlays.has("docs");

  // docs-only features show only the docs row — no links, depth, or health.
  // They exist in the registry purely for docs-coverage tracking.
  // The docs row is their ONLY content, so display it whenever any
  // content-producing overlay is active (not just the "docs" toggle).
  // Without this, docs-only rows render as empty cells under the
  // default overlay set (links + health) which has no docs toggle.
  if (isDocsOnly) {
    const hasDocsOnlyContent = hasLinks || hasDocs;
    if (!hasDocsOnlyContent) {
      return <div data-testid="composed-cell-empty" />;
    }
    return (
      <div
        data-testid="composed-cell"
        className="flex flex-col items-center gap-0.5 text-[11px] opacity-60"
      >
        {hasLinks && <LinksLayer ctx={ctx} />}
        {hasDocs && <DocsLayer ctx={ctx} />}
      </div>
    );
  }

  // Check if any layer will produce content
  const hasContent = hasLinks || hasDepth || hasHealth || hasDocs;

  if (!hasContent) {
    return <div data-testid="composed-cell-empty" />;
  }

  return (
    <div
      data-testid="composed-cell"
      className={`flex flex-col items-center gap-0.5 text-[11px] ${isTesting ? "opacity-60" : ""}`}
    >
      {hasLinks && <LinksLayer ctx={ctx} />}
      {hasDepth && <DepthLayer ctx={ctx} catalogCell={catalogCell} />}
      {hasHealth && !ctx.demo.command && <HealthLayer ctx={ctx} />}
      {hasDocs && <DocsLayer ctx={ctx} />}
    </div>
  );
}

/**
 * Custom equality check for ComposedCell. Skipping a cell render when its
 * underlying inputs are unchanged is the difference between a single PB SSE
 * delta re-rendering 1 cell vs. all ~720 cells in the matrix.
 *
 * `ctx.liveStatus` is a fresh Map on every parent render (mergeRowsToMap is
 * called in the page component on each `rows` array change), so a naive
 * shallow-equal would always invalidate. Instead, we compare the specific
 * row references this cell actually reads from the map. The upstream
 * `upsertByKey` reducer preserves row identity for unchanged keys, so the
 * per-key lookups are reference-stable across deltas that don't touch this
 * cell's slug/featureId.
 */
function arePropsEqual(
  prev: ComposedCellProps,
  next: ComposedCellProps,
): boolean {
  if (prev.overlays !== next.overlays) return false;
  if (prev.catalogCell !== next.catalogCell) return false;

  const p = prev.ctx;
  const n = next.ctx;
  if (
    p.connection !== n.connection ||
    p.hostedUrl !== n.hostedUrl ||
    p.shellUrl !== n.shellUrl ||
    p.integration !== n.integration ||
    p.feature !== n.feature ||
    p.demo !== n.demo
  ) {
    return false;
  }

  if (p.liveStatus === n.liveStatus) return true;

  // Map identity changed — verify only the rows this cell reads. Mirrors
  // the lookups in resolveCell + LevelStrip-adjacent helpers; D5 is
  // resolved through CATALOG_TO_D5_KEY, so we walk the same indirection
  // here to avoid false-negative skips. Keep this list in sync with
  // resolveCell + resolveD5Row in lib/live-status.ts.
  const slug = p.integration.slug;
  const featureId = p.feature.id;
  const directKeys = [
    keyFor("health", slug),
    keyFor("e2e", slug, featureId),
    keyFor("smoke", slug),
    keyFor("d5", slug, featureId),
    keyFor("d6", slug, featureId),
  ];
  for (const k of directKeys) {
    if (prev.ctx.liveStatus.get(k) !== next.ctx.liveStatus.get(k)) return false;
  }
  return true;
}

export const ComposedCell = memo(ComposedCellInner, arePropsEqual);
