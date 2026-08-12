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
import type { PoolCommError } from "@/lib/live-status";
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

function TestBadge({
  name,
  level,
  gated = false,
}: {
  name: string;
  level: TestLevel | null;
  /**
   * When true, the rung EXISTS but is ladder-blocked by a lower rung (its
   * effective status collapsed to `null`). Render a real, VISIBLE not-achieved
   * indicator ("—", gray) rather than the no-data "?" — the latter is hidden
   * by `Badge` (label === "?" → null), which would make a gated D6 vanish.
   */
  gated?: boolean;
}) {
  if (!level || !level.exists) return null;

  // Gated rung: exists but blocked below → visible em-dash, not a hidden "?".
  if (gated) {
    return (
      <FlashOnChange tone="gray">
        <Badge
          name={name}
          state={{ tone: "gray", label: "—" }}
          title={`${name}: gated — blocked by a lower rung`}
        />
      </FlashOnChange>
    );
  }

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
        title={`${name}: ${level.status ?? "no data"}`}
      />
    </FlashOnChange>
  );
}

// ---------------------------------------------------------------------------
// Pool comm-error tooltip (REQ-B)
// ---------------------------------------------------------------------------

/**
 * Format the "couldn't reach the pool" tooltip for the unreachable chip,
 * NAMING the `PoolCommErrorKind` and (when known) the worker so an operator
 * can triage which pool member dropped. Falls back to the raw message when no
 * structured detail is available.
 */
export function commErrorTooltip(err: PoolCommError): string {
  const worker = err.workerId ? ` — worker ${err.workerId}` : "";
  // A re-queued (reclaimed-pending) job is NOT an outage — the lease lapsed and
  // the control-plane re-queued it (back in flight), which the sweep boundary
  // cannot tell apart from an expected platform teardown. Phrase it neutrally
  // (flap-band #70) so the tooltip doesn't read as "unreachable".
  const lead =
    err.kind === "worker-reclaimed-pending"
      ? "re-queued (pending)"
      : "pool unreachable";
  return `${lead}: ${err.kind}${worker} — ${err.message}`;
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
          unreachable={model.surfaceState === "unreachable"}
          pending={model.surfaceState === "pending"}
          commTooltip={
            model.commError ? commErrorTooltip(model.commError) : undefined
          }
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
      {/* Legend-correct names: D3 = UI (frontend renders in a browser; the
          "API" name belongs to the D2 agent badge), D4 = BE (chat/tools
          round-trip). */}
      <TestBadge name="UI" level={model.d3} />
      <TestBadge name="BE" level={model.d4} />
      <TestBadge name="1P" level={model.d5} />
      {/*
        D6 is the TOP of the verification ladder, so its badge must reflect the
        LADDER-GATED status (`model.d6Effective`), NOT the raw per-dimension
        `model.d6.status`. When the ladder is broken/unverified below D6,
        `d6Effective` collapses to null. We distinguish three cases:
          - GATED-BY-FAILURE (d6 EXISTS, d6Effective === null, AND a lower rung
            is genuinely FAILING — D3/D4 non-green or a mapped D5 red/amber):
            render a VISIBLE not-achieved indicator ("—", gray) — NOT the
            no-data "?" (which the real Badge hides → the badge would vanish).
            The actual lower-rung failure is already shown by the 1P/API/BE
            badges.
          - NO-DATA (d6 does not exist, OR d6Effective null only because the
            ladder is unverified/no-data — e.g. empty live map → D5 mapped but
            no rows → status null): keep the normal hide behavior, rendering NO
            badge. A no-data ladder is NOT a failure, so it shows nothing.
          - LADDER INTACT (d6Effective non-null): pass d6Effective through so a
            genuine D6 red/amber/green renders per-dimension.
        API/BE/1P stay per-dimension (diagnostic); only D6 is gated. See
        `d6Effective` in cell-model.ts.
      */}
      {(() => {
        // A gated "—" is only meaningful when D6 is blocked by a genuine
        // FAILING lower rung — not merely absent data. `d6Effective === null`
        // is too broad: it collapses to null both when (a) a lower rung is
        // actually failing (D3/D4 non-green, or a mapped D5 red/amber) AND
        // when (b) the ladder is simply unverified/no-data (empty live map →
        // D5 mapped-but-no-rows → status null). Case (b) must render NO badge
        // (D6 falls back to the hidden "?" no-data treatment), so the gated
        // indicator fires ONLY on case (a). This mirrors `cell-model.ts`'s
        // `d1d4GateFails` predicate plus a present, failing D5.
        const lowerRungFailing =
          Boolean(model.d3?.exists && model.d3.status !== "green") ||
          Boolean(model.d4?.exists && model.d4.status !== "green") ||
          Boolean(
            model.d5?.exists &&
            (model.d5.status === "red" || model.d5.status === "amber"),
          );
        const d6Gated = Boolean(
          model.d6?.exists && model.d6Effective === null && lowerRungFailing,
        );
        return (
          <TestBadge
            name="D6"
            level={
              model.d6 && model.d6.exists
                ? { ...model.d6, status: model.d6Effective }
                : model.d6
            }
            gated={d6Gated}
          />
        );
      })()}
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
  const hasHealth = overlays.has("health");
  const hasDocs = overlays.has("docs");

  // The d6 pill is primarily a stats-bar overlay (only AdaptiveStatsBar reads
  // overlays.has("d6")). Per-cell it has no section of its own, so a
  // {d6}-only set would otherwise produce a blank matrix (hasContent false).
  // Treat d6 as content-bearing for the cell by surfacing the depth chip +
  // health badges (the health row already renders the per-cell D6 badge), so
  // an active d6 pill always shows meaningful per-cell content.
  const hasD6 = overlays.has("d6");
  const hasDepth = overlays.has("depth") || hasD6;

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

  // d6 surfaces the health row too, so its per-cell D6 badge is visible.
  const showHealth = hasHealth || hasD6;

  // Check if any layer will produce content
  const hasContent = hasLinks || hasDepth || showHealth || hasDocs;

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
      {showHealth && !ctx.demo.command && <HealthLayer model={model} />}
      {hasDocs && <DocsLayer ctx={ctx} />}
    </div>
  );
}

/**
 * Custom equality check for UnifiedCell. Skipping a cell render when its
 * underlying inputs are unchanged is the difference between a single PB SSE
 * delta re-rendering 1 cell vs. all ~720 cells in the matrix.
 */
/** Shallow-compare the primitive fields of two TestLevel values. */
function testLevelsEqual(a: TestLevel | null, b: TestLevel | null): boolean {
  if (a === b) return true;
  if (a == null || b == null) return false;
  return a.exists === b.exists && a.status === b.status;
}

/** Structural comparison of CellModel scalar + per-depth primitive fields. */
function modelsEqual(a: CellModel, b: CellModel): boolean {
  if (a === b) return true;
  return (
    a.supported === b.supported &&
    a.achievedDepth === b.achievedDepth &&
    a.ceilingDepth === b.ceilingDepth &&
    a.chipColor === b.chipColor &&
    a.surfaceState === b.surfaceState &&
    a.commError?.kind === b.commError?.kind &&
    a.commError?.workerId === b.commError?.workerId &&
    a.commError?.message === b.commError?.message &&
    a.d6Effective === b.d6Effective &&
    a.isRegression === b.isRegression &&
    testLevelsEqual(a.d3, b.d3) &&
    testLevelsEqual(a.d4, b.d4) &&
    testLevelsEqual(a.d5, b.d5) &&
    testLevelsEqual(a.d6, b.d6)
  );
}

/**
 * Memo equality used by `UnifiedCell`. Exported for direct unit testing of the
 * `directKeys` watch (a comm error landing solely on the aggregate `d6:<slug>`
 * row must force a re-render even when the precomputed `model` reference is
 * reused). Returns `true` to SKIP the re-render, `false` to re-render.
 */
export function arePropsEqual(
  prev: UnifiedCellProps,
  next: UnifiedCellProps,
): boolean {
  if (prev.overlays !== next.overlays) return false;

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

  if (p.liveStatus === n.liveStatus) return modelsEqual(prev.model, next.model);

  // Map identity changed -- verify only the rows this cell reads.
  const slug = p.integration.slug;
  const featureId = p.feature.id;
  const directKeys = [
    keyFor("e2e", slug, featureId),
    keyFor("chat", slug),
    keyFor("tools", slug),
    // health:<slug> is a pool comm-error carrier (REQ-B) even though it does
    // not feed the depth ladder — watch it so an incoming comm-error signal
    // repaints the cell's unreachable overlay.
    keyFor("health", slug),
    // d6:<slug> is the integration-level AGGREGATE row. It does not feed the
    // per-cell depth ladder (that reads `d6:<slug>/<featureType>`), but it IS
    // a pool comm-error carrier (REQ-B): a worker-death comm error lands solely
    // on the aggregate row, and `decodeCellCommError` in buildCellModel reads it
    // to light the cell's "unreachable" overlay. Watch it here so that signal
    // actually triggers a re-render — keep in sync with buildCellModel.
    keyFor("d6", slug),
  ];

  // Add D5 + D6 sub-keys from CATALOG_TO_D5_KEY. D6 is per-cell (not the
  // integration aggregate), resolved through the SAME featureType bridge as
  // D5 — see resolveD6Row/resolveD6. Keep in sync with resolveCell +
  // buildCellModel. An unmapped feature contributes no D5/D6 keys: the
  // resolvers (resolveD5/resolveD6) return exists:false and never read a
  // direct `d5:/d6:<slug>/<featureId>` key, so there is no direct-key
  // fallback to watch here.
  const featureKeys = CATALOG_TO_D5_KEY[featureId];
  if (featureKeys && featureKeys.length > 0) {
    for (const ft of featureKeys) {
      directKeys.push(keyFor("d5", slug, ft));
      directKeys.push(keyFor("d6", slug, ft));
    }
  }

  for (const k of directKeys) {
    if (prev.ctx.liveStatus.get(k) !== next.ctx.liveStatus.get(k)) return false;
  }
  return modelsEqual(prev.model, next.model);
}

export const UnifiedCell = memo(UnifiedCellInner, arePropsEqual);
