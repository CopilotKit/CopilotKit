"use client";
import React, { Fragment, useMemo } from "react";
import {
  getIntegrations,
  getFeatures,
  getFeatureCategories,
} from "@/lib/registry";
import type {
  Integration,
  Feature,
  Demo,
  FeatureCategory,
} from "@/lib/registry";
import { keyFor, resolveCell } from "@/lib/live-status";
import type { ConnectionStatus, LiveStatusMap } from "@/lib/live-status";
import { LevelStrip } from "@/components/level-strip";
import { OverlayColumnHeader } from "@/components/overlay-column-header";
import { RefDepthHeader, RefDepthCell } from "@/components/ref-depth-column";
import { deriveDepth } from "@/components/depth-utils";
import type { CatalogCell } from "@/components/depth-utils";
import type { Overlay } from "@/lib/overlay-types";
import type { ParityTier } from "@/components/parity-badge";
import type { CatalogData } from "@/data/catalog-types";
import type { TallyDetail, TallyItem } from "@/components/tally-types";
import {
  useCollapsible,
  CategoryHeaderRow,
} from "@/components/collapsible-category";

export interface CellContext {
  integration: Integration;
  feature: Feature;
  demo: Demo;
  /** Hosted URL for runnable demos; empty string for informational (command) demos. */
  hostedUrl: string;
  shellUrl: string;
  /** Live-status map merged across all subscribed dimensions. */
  liveStatus: LiveStatusMap;
  /** Aggregated SSE connection status — worst across dimensions. */
  connection: ConnectionStatus;
}

export type CellRenderer = (ctx: CellContext) => React.ReactNode;

/**
 * Counts green / amber / red signals for a single integration column across
 * all features.
 *
 * Signal scoping (spec §5.4):
 *   - Feature-level dimensions (`e2e`) are counted per feature.
 *   - Integration-level dimensions (`health`) are counted EXACTLY ONCE
 *     per integration — the health row keyed `health:<slug>` is a single
 *     signal for the whole column, not one signal per feature.
 *
 * When the SSE stream is down (`connection === "error"`) we return all-zero —
 * the column header falls back to an "unknown" rendering so stale counts
 * don't read as authoritative while the dashboard is offline.
 */
export function computeColumnTally(
  integration: Integration,
  features: Feature[],
  liveStatus: LiveStatusMap,
  connection: ConnectionStatus = "live",
): { green: number; amber: number; red: number; unknown: boolean } {
  if (connection === "error") {
    return { green: 0, amber: 0, red: 0, unknown: true };
  }

  let green = 0;
  let amber = 0;
  let red = 0;

  const tallyTone = (tone: string): void => {
    if (tone === "green") green++;
    else if (tone === "amber") amber++;
    else if (tone === "red") red++;
  };

  // Integration-level health — count once, regardless of how many features
  // the integration declares.
  const healthRow = liveStatus.get(keyFor("health", integration.slug)) ?? null;
  if (healthRow) {
    switch (healthRow.state) {
      case "green":
        tallyTone("green");
        break;
      case "red":
        tallyTone("red");
        break;
      case "degraded":
        tallyTone("amber");
        break;
    }
  }

  // Feature-level dimensions: e2e per feature-with-demo.
  for (const feature of features) {
    const demo = integration.demos.find((d) => d.id === feature.id);
    if (!demo) continue;

    const cell = resolveCell(liveStatus, integration.slug, feature.id, {
      connection,
    });

    tallyTone(cell.e2e.tone);
  }

  return { green, amber, red, unknown: false };
}

/**
 * Per-bucket feature lists for a single integration column — companion to
 * `computeColumnTally()` that returns `TallyItem[]` arrays instead of counts.
 *
 * Logic mirrors `computeColumnTally()` exactly: same signal scoping (health
 * counted once, e2e per feature-with-demo) and same connection-error guard.
 */
export function computeColumnTallyDetail(
  integration: Integration,
  features: Feature[],
  liveStatus: LiveStatusMap,
  connection: ConnectionStatus,
): TallyDetail {
  if (connection === "error") {
    return { green: [], amber: [], red: [], unknown: true };
  }

  const green: TallyItem[] = [];
  const amber: TallyItem[] = [];
  const red: TallyItem[] = [];

  // Integration-level health — counted once per integration.
  const healthRow = liveStatus.get(keyFor("health", integration.slug)) ?? null;
  if (healthRow) {
    const item: TallyItem = { label: "Health (Up)", dimension: "health" };
    switch (healthRow.state) {
      case "green":
        green.push(item);
        break;
      case "red":
        red.push(item);
        break;
      case "degraded":
        amber.push(item);
        break;
    }
  }

  // Feature-level dimensions: e2e per feature-with-demo.
  for (const feature of features) {
    const demo = integration.demos.find((d) => d.id === feature.id);
    if (!demo) continue;

    const cell = resolveCell(liveStatus, integration.slug, feature.id, {
      connection,
    });

    const item: TallyItem = {
      label: feature.name,
      dimension: "e2e",
      featureId: feature.id,
    };

    if (cell.e2e.tone === "green") green.push(item);
    else if (cell.e2e.tone === "amber") amber.push(item);
    else if (cell.e2e.tone === "red") red.push(item);
  }

  return { green, amber, red, unknown: false };
}

/**
 * Resolve the shell URL used to build Demo/Code links.
 *
 * `NEXT_PUBLIC_SHELL_URL` is inlined at build time. In production builds we
 * REFUSE to silently fall back to `http://localhost:3000` — those links ship
 * in the deployed bundle and render as broken "localhost:3000" references
 * for every visitor on Vercel/Railway. Instead, surface a sentinel URL
 * (`about:blank#shell-url-missing`) so the link visibly breaks and operators
 * see the misconfiguration on first click; also emit a build-time warning
 * on the server render path.
 *
 * In development/test we retain the historical localhost fallback to keep
 * local iteration friction-free.
 */
function resolveShellUrl(): string {
  const env = process.env.NEXT_PUBLIC_SHELL_URL;
  if (env && env.length > 0) return env;
  if (process.env.NODE_ENV === "production") {
    // eslint-disable-next-line no-console
    console.error(
      "[feature-grid] FATAL-CONFIG: NEXT_PUBLIC_SHELL_URL is unset in a " +
        "production build; Demo / Code / docs-shell links will render as " +
        "about:blank#shell-url-missing. Rebuild with the env var set.",
    );
    return "about:blank#shell-url-missing";
  }
  return "http://localhost:3000";
}

/* ------------------------------------------------------------------ */
/*  Shared style constant — avoids re-creating object on every row    */
/* ------------------------------------------------------------------ */

const STRIPE_STYLE = {
  backgroundColor: "color-mix(in srgb, var(--bg-surface) 50%, var(--bg-muted))",
} as const;

const SURFACE_STYLE = {
  backgroundColor: "var(--bg-surface)",
} as const;

/* ------------------------------------------------------------------ */
/*  CategorySection — one collapsible group of feature rows            */
/* ------------------------------------------------------------------ */

interface CategorySectionProps {
  cat: FeatureCategory & { features: Feature[] };
  integrations: Integration[];
  renderCell: CellRenderer;
  shellUrl: string;
  liveStatus: LiveStatusMap;
  connection: ConnectionStatus;
  showRefDepth: boolean;
  refCellsByFeature: Map<string, CatalogCell>;
  categoryColSpan: number;
}

const CategorySection = React.memo(
  function CategorySection({
    cat,
    integrations,
    renderCell,
    shellUrl,
    liveStatus,
    connection,
    showRefDepth,
    refCellsByFeature,
    categoryColSpan,
  }: CategorySectionProps) {
    const { isOpen, toggle } = useCollapsible({
      name: cat.name,
      defaultOpen: true,
    });

    const wiredCount = cat.features.reduce((acc, feature) => {
      return (
        acc +
        integrations.filter((int) => int.demos.some((d) => d.id === feature.id))
          .length
      );
    }, 0);
    const totalCount = cat.features.length * integrations.length;
    const countString = `${wiredCount}/${totalCount}`;

    return (
      <Fragment>
        <CategoryHeaderRow
          name={cat.name}
          count={countString}
          colSpan={categoryColSpan}
          isOpen={isOpen}
          onToggle={toggle}
        />
        {isOpen &&
          cat.features.map((feature, idx) => {
            const testing = feature.kind === "testing";
            const docsOnly = feature.kind === "docs-only";
            const muted = testing;
            const stripe = idx % 2 === 1;
            const refCell = showRefDepth
              ? refCellsByFeature.get(feature.id)
              : undefined;
            const refDepth = refCell
              ? deriveDepth(refCell, liveStatus)
              : undefined;
            return (
              <tr
                key={feature.id}
                className="grid-row border-t border-[var(--border)]"
                style={stripe ? STRIPE_STYLE : undefined}
              >
                <td
                  className="sticky left-0 z-10 px-1 py-1 border-r border-[var(--border)] align-top"
                  style={stripe ? STRIPE_STYLE : SURFACE_STYLE}
                >
                  <div
                    className={
                      muted
                        ? "font-normal text-[var(--text-muted)] italic"
                        : "font-medium text-[var(--text)]"
                    }
                    title={feature.description}
                  >
                    {feature.name}
                    {testing && (
                      <span className="ml-2 text-[9px] uppercase tracking-wider text-[var(--text-muted)]">
                        testing
                      </span>
                    )}
                    {docsOnly && (
                      <span className="ml-2 text-[9px] uppercase tracking-wider text-[var(--text-muted)]">
                        docs-only
                      </span>
                    )}
                  </div>
                </td>
                {showRefDepth &&
                  (refCell && refDepth && !docsOnly ? (
                    <RefDepthCell
                      depth={refDepth.achieved}
                      status={
                        refDepth.unsupported ? "unsupported" : refCell.status
                      }
                      maxDepth={refDepth.maxPossible}
                    />
                  ) : (
                    <td
                      className="sticky left-[160px] z-10 px-1 py-1 border-r-2 border-r-[#c4b5fd] border-l border-[var(--border)] align-top"
                      style={{ backgroundColor: "#f5f0ff" }}
                    >
                      <span className="text-[var(--text-muted)] text-[10px]">
                        --
                      </span>
                    </td>
                  ))}
                {integrations.map((integration) => {
                  const demo = integration.demos.find(
                    (d) => d.id === feature.id,
                  );
                  const isNotSupported =
                    integration.not_supported_features?.includes(feature.id) ??
                    false;
                  return (
                    <td
                      key={integration.slug}
                      className="border-l border-[var(--border)] px-1 py-1 align-top text-center"
                    >
                      {demo ? (
                        renderCell({
                          integration,
                          feature,
                          demo,
                          hostedUrl: demo.route
                            ? `${integration.backend_url}${demo.route}`
                            : "",
                          shellUrl,
                          liveStatus,
                          connection,
                        })
                      ) : isNotSupported ? (
                        // Architectural limit — framework cannot support this
                        // feature. Distinct from the unshipped "no demo" ✗ so
                        // viewers can tell "won't be done" apart from "to do".
                        <span
                          className="inline-flex items-center justify-center px-1.5 py-0.5 rounded text-base border border-slate-500/40 bg-slate-500/10 text-slate-400"
                          title="Not supported by this framework"
                        >
                          🚫
                        </span>
                      ) : (
                        <div
                          className="text-center text-base text-[var(--danger)]"
                          title="No demo"
                        >
                          ✗
                        </div>
                      )}
                    </td>
                  );
                })}
              </tr>
            );
          })}
      </Fragment>
    );
  },
  (prev, next) => {
    return (
      prev.liveStatus === next.liveStatus &&
      prev.connection === next.connection &&
      prev.cat === next.cat &&
      prev.renderCell === next.renderCell &&
      prev.integrations === next.integrations &&
      prev.shellUrl === next.shellUrl &&
      prev.showRefDepth === next.showRefDepth &&
      prev.refCellsByFeature === next.refCellsByFeature &&
      prev.categoryColSpan === next.categoryColSpan
    );
  },
);

/* ------------------------------------------------------------------ */
/*  FeatureGrid                                                        */
/* ------------------------------------------------------------------ */

export interface FeatureGridProps {
  title: string;
  subtitle?: string;
  renderCell: CellRenderer;
  minColWidth?: number;
  /** Merged live-status map from all subscribed dimensions (lifted to page). */
  liveStatus: LiveStatusMap;
  /** Aggregated SSE connection status (lifted to page). */
  connection: ConnectionStatus;
  /** When provided, use overlay-aware column headers and ref-depth column. */
  overlays?: Set<Overlay>;
  /** Catalog data — required when overlays is provided, for ref-depth and parity. */
  catalog?: CatalogData;
}

export function FeatureGrid({
  title,
  subtitle,
  renderCell,
  minColWidth = 220,
  liveStatus,
  connection,
  overlays,
  catalog,
}: FeatureGridProps) {
  const shellUrl = resolveShellUrl();
  // `getIntegrations()` / `getFeatures()` call `.sort()` / array spread on
  // every invocation, returning a fresh array identity. Memoize once per
  // mount so downstream `useMemo`s keyed on these arrays don't identity-
  // invalidate every render (C5 F9).
  const integrations = useMemo(() => getIntegrations(), []);
  const features = useMemo(() => getFeatures(), []);
  const categories = useMemo(() => getFeatureCategories(), []);

  // O(features × integrations) per render is avoidable — the inputs only
  // change when live rows or connection shift, so memoize across the whole
  // integration list in one pass.
  const tallies = useMemo(() => {
    const out = new Map<string, ReturnType<typeof computeColumnTally>>();
    for (const integration of integrations) {
      out.set(
        integration.slug,
        computeColumnTally(integration, features, liveStatus, connection),
      );
    }
    return out;
  }, [integrations, features, liveStatus, connection]);

  // Per-bucket feature lists — mirrors tallies but with TallyItem arrays.
  const tallyDetails = useMemo(() => {
    const out = new Map<string, TallyDetail>();
    for (const integration of integrations) {
      out.set(
        integration.slug,
        computeColumnTallyDetail(integration, features, liveStatus, connection),
      );
    }
    return out;
  }, [integrations, features, liveStatus, connection]);

  // Whether to show the parity ref-depth column
  const showRefDepth = overlays ? overlays.has("parity") : false;

  // Build parity tier map for overlay column headers (integration slug -> ParityTier)
  const parityTierMap = useMemo(() => {
    if (!catalog) return new Map<string, ParityTier>();
    const map = new Map<string, ParityTier>();
    const seen = new Set<string>();
    for (const cell of catalog.cells) {
      if (!seen.has(cell.integration)) {
        seen.add(cell.integration);
        map.set(cell.integration, cell.parity_tier as ParityTier);
      }
    }
    return map;
  }, [catalog]);

  // Build catalog cell lookup for ref-depth column
  const refCellsByFeature = useMemo(() => {
    if (!catalog || !showRefDepth) return new Map<string, CatalogCell>();
    const referenceSlug = catalog.metadata.reference;
    const map = new Map<string, CatalogCell>();
    for (const cell of catalog.cells) {
      if (cell.integration === referenceSlug && cell.feature !== null) {
        map.set(cell.feature, cell);
      }
    }
    return map;
  }, [catalog, showRefDepth]);

  const featuresByCategory = useMemo(
    () =>
      categories
        .map((cat) => ({
          ...cat,
          features: features.filter((f) => f.category === cat.id),
        }))
        .filter((cat) => cat.features.length > 0),
    [categories, features],
  );

  // Colspan for category separator row: base (Feature col) + integrations + optional ref-depth
  const categoryColSpan = integrations.length + 1 + (showRefDepth ? 1 : 0);

  return (
    <div className="px-8 pt-3 pb-8">
      <header className="mb-3">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
          <LiveIndicator status={connection} />
        </div>
        <p className="mt-1 text-sm text-[var(--text-secondary)]">
          {subtitle ? <>{subtitle} · </> : null}
          {features.length} features × {integrations.length} integrations.
        </p>
      </header>

      {connection === "error" && <OfflineBanner />}

      <div
        className="rounded-lg border border-[var(--border)] bg-[var(--bg-surface)]"
        style={{ width: "fit-content", minWidth: "100%" }}
      >
        <table className="border-collapse text-sm">
          <thead>
            <tr>
              <th className="sticky left-0 top-0 z-30 bg-[var(--bg-muted)] px-1 py-1.5 text-left min-w-[160px] border-b border-[var(--border)]">
                <span className="text-[10px] font-medium uppercase tracking-wider text-[var(--text-muted)]">
                  Feature
                </span>
              </th>
              {showRefDepth && <RefDepthHeader />}
              {integrations.map((integration) => {
                const tally = tallies.get(integration.slug) ?? {
                  green: 0,
                  amber: 0,
                  red: 0,
                  unknown: false,
                };

                // Overlay-aware header when overlays prop is provided
                if (overlays) {
                  return (
                    <OverlayColumnHeader
                      key={integration.slug}
                      integration={integration}
                      tally={tally}
                      tallyDetail={tallyDetails.get(integration.slug)}
                      overlays={overlays}
                      liveStatus={liveStatus}
                      connection={connection}
                      parityTier={parityTierMap.get(integration.slug)}
                      minWidth={minColWidth}
                    />
                  );
                }

                // Legacy header rendering (backwards compat when overlays not provided)
                const total = tally.green + tally.amber + tally.red;
                const tallyTitle = tally.unknown
                  ? "dashboard offline — live signal unavailable (§5.3)"
                  : total
                    ? `${tally.green} green · ${tally.amber} amber · ${tally.red} red of ${total} countable signals (D4 per feature; Health counted once per integration)`
                    : "no countable signals for this column";
                return (
                  <th
                    key={integration.slug}
                    className="sticky top-0 z-20 bg-[var(--bg-muted)] px-1 py-1.5 text-center border-b border-l border-[var(--border)] font-normal"
                    style={{ minWidth: `${minColWidth}px` }}
                  >
                    <div className="text-xs font-semibold text-[var(--text)]">
                      {integration.name}
                    </div>
                    <div className="mt-0.5 text-[10px] uppercase tracking-wider text-[var(--text-muted)]">
                      {integration.language}
                    </div>
                    <div className="mt-1">
                      <LevelStrip
                        integration={integration}
                        liveStatus={liveStatus}
                      />
                    </div>
                    <div
                      className="mt-1 text-[10px] tabular-nums text-[var(--text-muted)]"
                      title={tallyTitle}
                    >
                      {tally.unknown ? (
                        <span className="text-[var(--text-muted)]">
                          ? offline
                        </span>
                      ) : (
                        <>
                          <span className="text-[var(--ok)]">
                            ✓ {tally.green}
                          </span>
                          <span className="mx-1 text-[var(--text-muted)]">
                            ·
                          </span>
                          <span className="text-[var(--amber)]">
                            ~ {tally.amber}
                          </span>
                          <span className="mx-1 text-[var(--text-muted)]">
                            ·
                          </span>
                          <span className="text-[var(--danger)]">
                            ✗ {tally.red}
                          </span>
                        </>
                      )}
                    </div>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {featuresByCategory.map((cat) => (
              <CategorySection
                key={cat.id}
                cat={cat}
                integrations={integrations}
                renderCell={renderCell}
                shellUrl={shellUrl}
                liveStatus={liveStatus}
                connection={connection}
                showRefDepth={showRefDepth}
                refCellsByFeature={refCellsByFeature}
                categoryColSpan={categoryColSpan}
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/**
 * Header "live" dot — color-coded per spec §5.7.
 *   connecting → amber pulse
 *   live       → green solid
 *   error      → red solid (paired with offline banner)
 *
 * Exported for unit-testable color-map coverage.
 */
export function LiveIndicator({ status }: { status: ConnectionStatus }) {
  const dotClass =
    status === "live"
      ? "bg-[var(--ok)]"
      : status === "connecting"
        ? "bg-[var(--amber)] animate-pulse"
        : "bg-[var(--danger)]";
  const label =
    status === "live"
      ? "live"
      : status === "connecting"
        ? "connecting"
        : "offline";
  return (
    <span
      data-testid="live-indicator"
      data-status={status}
      data-tone={
        status === "live" ? "green" : status === "connecting" ? "amber" : "red"
      }
      className="inline-flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-[var(--text-muted)]"
      title={`Live data: ${label}`}
    >
      <span className={`inline-block w-2 h-2 rounded-full ${dotClass}`} />
      <span>{label}</span>
    </span>
  );
}

function OfflineBanner() {
  return (
    <div
      role="alert"
      className="mb-4 rounded-md border border-[var(--danger)] bg-[var(--bg-danger)] px-4 py-2 text-xs text-[var(--danger)]"
    >
      dashboard unavailable — check #oss-alerts
    </div>
  );
}
