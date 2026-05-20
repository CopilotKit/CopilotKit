"use client";
/**
 * UnifiedCell -- single rendering codepath for Coverage-tab cells.
 *
 * Consumes a pre-computed `CellModel` and renders:
 *   - Unsupported cells: only a ban icon, no badges, no depth chip (Bug 3 fix)
 *   - Supported cells: depth chip (with pre-computed chipColor) + test badges
 *     only for levels where `exists === true`
 *
 * Replaces ComposedCell's independent DepthLayer/HealthLayer that don't
 * cross-check support status or test-level existence.
 */

import { memo, useState, useEffect, useRef, useCallback } from "react";
import type { CellContext } from "@/components/feature-grid";
import type { CellModel, TestLevel } from "@/lib/cell-model";
import { DepthChip } from "@/components/depth-chip";
import { Badge, FlashOnChange } from "@/components/badges";
import type { BadgeTone } from "@/lib/live-status";
import { keyFor, CATALOG_TO_D5_KEY } from "@/lib/live-status";
import type { Overlay } from "@/lib/overlay-types";
import { CellDrilldown } from "@/components/cell-drilldown";
import { CommandCell } from "@/components/command-cell";
import { DocsRow, urlsFor } from "@/components/cell-pieces";
import { LinkPreview } from "@/components/link-preview";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface UnifiedCellProps {
  ctx: CellContext;
  model: CellModel;
  overlays: Set<Overlay>;
}

// ---------------------------------------------------------------------------
// TestBadge helper
// ---------------------------------------------------------------------------

function TestBadge({ name, level }: { name: string; level: TestLevel | null }) {
  if (!level || !level.exists) return null;

  const tone: BadgeTone =
    level.status === "green"
      ? "green"
      : level.status === "red"
        ? "red"
        : level.status === "amber"
          ? "amber"
          : "gray";

  const label =
    level.status === "green"
      ? "✓"
      : level.status === "red"
        ? "✗"
        : level.status === "amber"
          ? "~"
          : "?";

  return (
    <FlashOnChange tone={tone}>
      <Badge
        name={name}
        state={{ tone, label }}
        title={`${name}: ${level.status ?? "pending"}`}
      />
    </FlashOnChange>
  );
}

// ---------------------------------------------------------------------------
// Layer renderers
// ---------------------------------------------------------------------------

function LinksLayer({ ctx }: { ctx: CellContext }) {
  if (ctx.demo.command) {
    return <CommandCell ctx={ctx} />;
  }

  const links = urlsFor(ctx);

  return (
    <div className="flex items-center justify-center gap-1.5">
      <LinkPreview href={links.demoUrl}>
        <a
          href={links.demoUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="whitespace-nowrap text-[var(--accent)] hover:underline"
        >
          <span className="text-[var(--text-muted)]">Demo</span>{" "}
          <span>&#8599;</span>
        </a>
      </LinkPreview>
      <LinkPreview href={links.codeUrl}>
        <a
          href={links.codeUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="whitespace-nowrap text-[var(--accent)] hover:underline"
        >
          <span className="text-[var(--text-muted)]">Code</span>{" "}
          <span>{"</>"}</span>
        </a>
      </LinkPreview>
    </div>
  );
}

function DepthLayer({ ctx, model }: { ctx: CellContext; model: CellModel }) {
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
          chipColor={model.chipColor}
          depth={model.achievedDepth}
          status="wired"
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

function HealthLayer({ model }: { model: CellModel }) {
  return (
    <div
      data-testid="health-layer"
      className="flex items-center justify-center gap-2.5"
    >
      <TestBadge name="API" level={model.d3} />
      <TestBadge name="RT" level={model.d4} />
      <TestBadge name="CV" level={model.d5} />
    </div>
  );
}

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

// ---------------------------------------------------------------------------
// UnifiedCell
// ---------------------------------------------------------------------------

function UnifiedCellInner({ ctx, model, overlays }: UnifiedCellProps) {
  // ── Unsupported cell: ban icon only (Bug 3 fix) ─────────────────────
  if (!model.supported) {
    return (
      <div data-testid="unified-cell-unsupported" className="text-center">
        <span
          className="inline-flex items-center justify-center px-1.5 py-0.5 rounded text-base border border-slate-500/40 bg-slate-500/10 text-slate-400"
          title="Not supported by this framework"
        >
          &#128683;
        </span>
      </div>
    );
  }

  const isDocsOnly = ctx.feature.kind === "docs-only";
  const isTesting = ctx.feature.kind === "testing";
  const hasLinks = overlays.has("links");
  const hasDepth = overlays.has("depth");
  const hasHealth = overlays.has("health");
  const hasDocs = overlays.has("docs");

  // docs-only features: only links and docs layers, no depth or health.
  if (isDocsOnly) {
    const hasDocsOnlyContent = hasLinks || hasDocs;
    if (!hasDocsOnlyContent) {
      return <div data-testid="unified-cell-empty" />;
    }
    return (
      <div
        data-testid="unified-cell"
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
    return <div data-testid="unified-cell-empty" />;
  }

  return (
    <div
      data-testid="unified-cell"
      className={`flex flex-col items-center gap-0.5 text-[11px] ${isTesting ? "opacity-60" : ""}`}
    >
      {hasLinks && <LinksLayer ctx={ctx} />}
      {hasDepth && <DepthLayer ctx={ctx} model={model} />}
      {hasHealth && !ctx.demo.command && <HealthLayer model={model} />}
      {hasDocs && <DocsLayer ctx={ctx} />}
    </div>
  );
}

/**
 * Custom equality check for UnifiedCell. Skipping a cell render when its
 * underlying inputs are unchanged is the difference between a single PB SSE
 * delta re-rendering 1 cell vs. all ~720 cells in the matrix.
 */
function arePropsEqual(
  prev: UnifiedCellProps,
  next: UnifiedCellProps,
): boolean {
  if (prev.overlays !== next.overlays) return false;
  if (prev.model !== next.model) return false;

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

  // Map identity changed -- verify only the rows this cell reads.
  const slug = p.integration.slug;
  const featureId = p.feature.id;
  const directKeys = [
    keyFor("e2e", slug, featureId),
    keyFor("chat", slug),
    keyFor("tools", slug),
  ];

  // Add D5 sub-keys from CATALOG_TO_D5_KEY
  const d5Keys = CATALOG_TO_D5_KEY[featureId];
  if (d5Keys && d5Keys.length > 0) {
    for (const d5Key of d5Keys) {
      directKeys.push(keyFor("d5", slug, d5Key));
    }
  } else {
    directKeys.push(keyFor("d5", slug, featureId));
  }

  for (const k of directKeys) {
    if (prev.ctx.liveStatus.get(k) !== next.ctx.liveStatus.get(k)) return false;
  }
  return true;
}

export const UnifiedCell = memo(UnifiedCellInner, arePropsEqual);
