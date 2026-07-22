"use client";
import React, { Fragment, useMemo, useState } from "react";
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
import type {
  ConnectionStatus,
  LiveStatusMap,
  StarterLevel,
} from "@/lib/live-status";
import {
  resolveStarterRow,
  buildStarterBadge,
  starterIsSupported,
  STARTER_LEVELS,
} from "@/lib/live-status";
import { ToneChip } from "@/components/badges";
import { LevelStrip } from "@/components/level-strip";
import { OverlayColumnHeader } from "@/components/overlay-column-header";
import { RefDepthHeader, RefDepthCell } from "@/components/ref-depth-column";
import { buildCellModel } from "@/lib/cell-model";
import { asParityTier } from "@/lib/page-stats";
import { getRuntimeConfig } from "@/lib/runtime-config.client";
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
 * Counts green / amber / red cells for a single integration column across
 * all features, derived from `buildCellModel().chipColor`.
 *
 * This ensures the header tally matches what the Coverage-tab cells actually
 * render — both use `buildCellModel` as the single source of truth.
 *
 * Gray cells (no data yet, unsupported, or unwired) are excluded from the
 * count so the tally reflects only cells with actionable signal.
 *
 * When the SSE stream is down (`connection === "error"`) we return all-zero —
 * the column header falls back to an "unknown" rendering so stale counts
 * don't read as authoritative while the dashboard is offline.
 *
 * Likewise during the INITIAL load — `connection === "connecting"` with an
 * empty `liveStatus` map (the first PocketBase fetch hasn't resolved yet) — we
 * return `loading: true` (also `unknown: true`). Without this guard the header
 * renders authoritative `✓0 ~0 ✗0` while data is merely in flight, which reads
 * as "every cell is at depth 0" — a lie. `loading` lets the header show a
 * loading affordance instead of fake zeros. Once any rows arrive (even mid
 * reconnect) the tally is authoritative again.
 */
export function computeColumnTally(
  integration: Integration,
  features: Feature[],
  liveStatus: LiveStatusMap,
  connection: ConnectionStatus = "live",
  now: number = Date.now(),
): {
  green: number;
  amber: number;
  red: number;
  unknown: boolean;
  loading: boolean;
} {
  if (connection === "error") {
    return { green: 0, amber: 0, red: 0, unknown: true, loading: false };
  }

  // Initial-load window: connecting AND no rows yet. Surface a loading state
  // (which the header treats as unknown) instead of authoritative zeros.
  if (connection === "connecting" && liveStatus.size === 0) {
    return { green: 0, amber: 0, red: 0, unknown: true, loading: true };
  }

  let green = 0;
  let amber = 0;
  let red = 0;

  for (const feature of features) {
    const isSupported = !integration.not_supported_features?.includes(
      feature.id,
    );
    const isWired = integration.demos.some((d) => d.id === feature.id);

    const model = buildCellModel(
      liveStatus,
      {
        slug: integration.slug,
        featureId: feature.id,
        isSupported,
        isWired,
      },
      now,
    );

    if (model.chipColor === "green") green++;
    else if (model.chipColor === "amber") amber++;
    else if (model.chipColor === "red") red++;
    // gray → skip (no data / unsupported / unwired)
  }

  return { green, amber, red, unknown: false, loading: false };
}

/**
 * Per-bucket feature lists for a single integration column — companion to
 * `computeColumnTally()` that returns `TallyItem[]` arrays instead of counts.
 *
 * Logic mirrors `computeColumnTally()` exactly: both derive from
 * `buildCellModel().chipColor`. Gray cells are excluded.
 */
export function computeColumnTallyDetail(
  integration: Integration,
  features: Feature[],
  liveStatus: LiveStatusMap,
  connection: ConnectionStatus = "live",
  now: number = Date.now(),
): TallyDetail {
  if (connection === "error") {
    return {
      green: [],
      amber: [],
      red: [],
      unknown: true,
      loading: false,
      stale: false,
    };
  }

  // Initial-load window: connecting AND no rows yet — mirror computeColumnTally.
  if (connection === "connecting" && liveStatus.size === 0) {
    return {
      green: [],
      amber: [],
      red: [],
      unknown: true,
      loading: true,
      stale: false,
    };
  }

  // Reconnect-with-rows window: connecting AND rows already exist. The counts
  // below are AUTHORITATIVE (real signal already arrived), but the feed is
  // mid-reconnect so they may be behind the live state — mark `stale` so the
  // header renders the counts in a muted treatment (distinct from the no-rows
  // `loading` affordance). Mutually exclusive with `loading` above.
  const stale = connection === "connecting" && liveStatus.size > 0;

  const green: TallyItem[] = [];
  const amber: TallyItem[] = [];
  const red: TallyItem[] = [];

  for (const feature of features) {
    const isSupported = !integration.not_supported_features?.includes(
      feature.id,
    );
    const isWired = integration.demos.some((d) => d.id === feature.id);

    const model = buildCellModel(
      liveStatus,
      {
        slug: integration.slug,
        featureId: feature.id,
        isSupported,
        isWired,
      },
      now,
    );

    // Gray → skip (no data / unsupported / unwired)
    if (model.chipColor === "gray") continue;

    // Derive dimension from model: D4/D5/D6 failures are "health" (live
    // round-trip/conversation/parity checks); D3 failures are "e2e" (page-load).
    // The D6 rung uses the LADDER-GATED `d6Effective` (NOT raw `d6.status`) so
    // this dimension agrees with the rendered gated D6 badge: when the ladder is
    // broken below D6, d6Effective collapses to null (no D6-specific failure to
    // attribute — the real lower-rung failure surfaces through D5/D4 below).
    //
    // D5 clause: a present D5 failure (red/stale-amber) is a "health" failure,
    // AND an AMBER chip with a green D5 is also "health" — amber means the
    // ladder is intact through a green D5 but D6 is not yet green (awaiting the
    // live parity/conversation confirmation), which is a live-signal surface,
    // not a page-load one. So the chip-is-amber/D5-green case classifies health.
    const dimension: TallyItem["dimension"] =
      (model.d6?.exists &&
        model.d6Effective !== null &&
        model.d6Effective !== "green") ||
      (model.d5?.exists &&
        model.d5.status !== null &&
        (model.d5.status !== "green" || model.chipColor === "amber")) ||
      (model.d4?.exists &&
        model.d4.status !== null &&
        model.d4.status !== "green")
        ? "health"
        : "e2e";

    const item: TallyItem = {
      label: feature.name,
      dimension,
      featureId: feature.id,
    };

    if (model.chipColor === "green") green.push(item);
    else if (model.chipColor === "amber") amber.push(item);
    else if (model.chipColor === "red") red.push(item);
  }

  return { green, amber, red, unknown: false, loading: false, stale };
}

/**
 * Production sentinel the SERVER runtime-config reader emits when `SHELL_URL`
 * is unset on the Railway service (`getRuntimeConfig().shellUrl`). It is
 * truthy, so it would otherwise pass the `serverShellUrl` guard below and get
 * baked into every anchor as `about:blank#shell-url-missing/integrations/...`.
 *
 * Mirrors the SSOT in `shell-dashboard/src/lib/runtime-config.ts`
 * (`PROD_INVALID_SHELL_URL`) — the same literal the verify-deploy dashboard
 * guard mirrors. Kept as a local const (the SSOT is a module-private const,
 * not exported) so the value lives in one shape per consumer with a pointer.
 */
const PROD_INVALID_SHELL_URL = "about:blank#shell-url-missing";

/**
 * Resolve the shell URL used to build Demo / Code / docs-shell links.
 *
 * Prefers the server-threaded value (passed as `serverShellUrl` from the
 * server component wrapper that reads `SHELL_URL` at request time). This
 * is the authoritative source: it is the REAL host during SSR, so anchors
 * are built correctly in the initial HTML — crawlers and no-JS clients get
 * working links, and the `https://ssr-placeholder.invalid/` sentinel never
 * leaks into the rendered DOM.
 *
 * EXCEPTION: when `SHELL_URL` is unset on the server, `getRuntimeConfig()`
 * returns the truthy `about:blank#shell-url-missing` env-unset sentinel. That
 * is NOT a real host, so we must NOT return it (doing so would bake
 * `about:blank#shell-url-missing/integrations/...` into anchors). Fall through
 * to the client config in that case — the verify-deploy dashboard guard fails
 * the deploy loud when this sentinel ships, so this is a defensive fallback.
 *
 * Falls back to the CLIENT runtime config (`window.__SHOWCASE_CONFIG__`)
 * when no server value was threaded (e.g. a stray client-only caller) or when
 * the server value is the env-unset sentinel. That client fallback returns the
 * SSR sentinel during server render, so the server-threaded path is strongly
 * preferred and is what `page.tsx` wires.
 */
function resolveShellUrl(serverShellUrl?: string): string {
  if (serverShellUrl && serverShellUrl !== PROD_INVALID_SHELL_URL) {
    return serverShellUrl;
  }
  return getRuntimeConfig().shellUrl;
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
  /** Shared frozen reference time — see FeatureGridProps.now. */
  now: number;
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
    now,
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
            const refModel = refCell
              ? buildCellModel(
                  liveStatus,
                  {
                    slug: refCell.integration,
                    featureId: refCell.feature ?? feature.id,
                    isSupported: refCell.status !== "unsupported",
                    isWired:
                      refCell.status === "wired" || refCell.status === "stub",
                  },
                  now,
                )
              : undefined;
            return (
              <tr
                key={feature.id}
                data-testid={`feature-row-${feature.id}`}
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
                  (refCell && refModel && !docsOnly ? (
                    <RefDepthCell
                      depth={refModel.achievedDepth}
                      status={
                        !refModel.supported ? "unsupported" : refCell.status
                      }
                      maxDepth={refModel.ceilingDepth}
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
                    !!integration.not_supported_features?.includes(feature.id);
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
      prev.now === next.now &&
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
/*  StarterSection — the "Starter" pseudo-category row-group (spec §d)  */
/* ------------------------------------------------------------------ */

/** Human-readable label per starter sub-row, in STARTER_LEVELS order. */
const STARTER_LEVEL_LABEL: Record<StarterLevel, string> = {
  health: "Health",
  agent: "Agent",
  chat: "Chat",
  interaction: "Interaction",
};

interface StarterSectionProps {
  integrations: Integration[];
  liveStatus: LiveStatusMap;
  connection: ConnectionStatus;
  /** Shared frozen reference time — see FeatureGridProps.now. */
  now: number;
  /** Feature column + integrations + optional ref-depth (same as categories). */
  categoryColSpan: number;
  /** Whether the parity ref-depth spacer column is present. */
  showRefDepth: boolean;
}

/**
 * The "Starter" row-group: four fixed sub-rows (health/agent/chat/interaction)
 * keyed to the integration columns. Rendered like a `CategorySection`, but the
 * cells resolve via `resolveStarterRow` + `buildStarterBadge` (the full 5-state
 * §d vocabulary) instead of the depth model.
 *
 * INFORMATIONAL ONLY: this group never calls `renderCell`/`buildCellModel`, so
 * starter rows cannot contribute to any feature-cell rollup or column tally
 * (spec §d) — the exclusion is structural, not a filter. Ported from the dead
 * `CellMatrix.StarterSection` so it actually renders in the live FeatureGrid.
 */
function StarterSection({
  integrations,
  liveStatus,
  connection,
  now,
  categoryColSpan,
  showRefDepth,
}: StarterSectionProps) {
  const { isOpen, toggle } = useCollapsible({
    name: "Starter",
    defaultOpen: true,
  });

  const supportedCount = integrations.filter((int) =>
    starterIsSupported(int.slug),
  ).length;

  return (
    <Fragment>
      <CategoryHeaderRow
        name="Starter"
        count={`${supportedCount}/${integrations.length}`}
        colSpan={categoryColSpan}
        isOpen={isOpen}
        onToggle={toggle}
      />
      {isOpen &&
        STARTER_LEVELS.map((level) => (
          <tr
            key={level}
            data-testid={`starter-row-${level}`}
            className="grid-row border-t border-[var(--border)]"
          >
            <td
              className="sticky left-0 z-10 px-1 py-1 border-r border-[var(--border)] align-middle min-w-[160px]"
              style={SURFACE_STYLE}
            >
              <span className="text-xs font-medium text-[var(--text)]">
                {STARTER_LEVEL_LABEL[level]}
              </span>
            </td>
            {showRefDepth && (
              <td
                className="sticky left-[160px] z-10 px-1 py-1 border-r-2 border-r-[#c4b5fd] border-l border-[var(--border)] align-middle"
                style={{ backgroundColor: "#f5f0ff" }}
              >
                <span className="text-[var(--text-muted)] text-[10px]">--</span>
              </td>
            )}
            {integrations.map((integration) => {
              const isSupported = starterIsSupported(integration.slug);
              const starterRow = isSupported
                ? resolveStarterRow(liveStatus, integration.slug, level)
                : null;
              const badge = buildStarterBadge(
                level,
                isSupported,
                starterRow,
                now,
                connection,
              );
              return (
                <td
                  key={integration.slug}
                  data-testid={`starter-cell-${integration.slug}-${level}`}
                  className="border-l border-[var(--border)] px-1 py-1 align-middle text-center"
                >
                  <ToneChip
                    tone={badge.tone}
                    label={badge.label}
                    title={badge.tooltip}
                  />
                </td>
              );
            })}
          </tr>
        ))}
    </Fragment>
  );
}

/* ------------------------------------------------------------------ */
/*  FeatureGrid                                                        */
/* ------------------------------------------------------------------ */

export interface FeatureGridProps {
  title: string;
  subtitle?: string;
  renderCell: CellRenderer;
  minColWidth?: number;
  /**
   * Shell host resolved server-side (request-time `SHELL_URL`) and threaded
   * down from the server component wrapper. When provided, Demo / Code links
   * are built with the REAL host during SSR — no `ssr-placeholder.invalid`
   * sentinel in the HTML, and links work pre-hydration. Falls back to the
   * client runtime config when omitted.
   */
  shellUrl?: string;
  /** Merged live-status map from all subscribed dimensions (lifted to page). */
  liveStatus: LiveStatusMap;
  /** Aggregated SSE connection status (lifted to page). */
  connection: ConnectionStatus;
  /**
   * True when the live feed is flapping / partially degraded (from
   * `useLiveStatus().degraded`). Surfaced in the header `LiveIndicator` as a
   * distinct degraded treatment. Defaults to `false` so callers that don't
   * wire it keep the original three-state indicator.
   */
  degraded?: boolean;
  /**
   * Single frozen reference time shared with the page's cells/stats (computed
   * once per render in dashboard-page.tsx, re-sampled on live-status change or
   * the 60s tick). Threaded so the column tallies derive staleness from the
   * SAME `now` as the cells they summarize — without it each `buildCellModel`
   * call would default to its own `Date.now()`, and the tally `useMemo` would
   * never re-evaluate on the tick. Defaults to `Date.now()` for stray callers.
   */
  now?: number;
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
  degraded = false,
  now = Date.now(),
  overlays,
  catalog,
  shellUrl: serverShellUrl,
}: FeatureGridProps) {
  const shellUrl = resolveShellUrl(serverShellUrl);
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
        computeColumnTally(integration, features, liveStatus, connection, now),
      );
    }
    return out;
  }, [integrations, features, liveStatus, connection, now]);

  // Per-bucket feature lists — mirrors tallies but with TallyItem arrays.
  const tallyDetails = useMemo(() => {
    const out = new Map<string, TallyDetail>();
    for (const integration of integrations) {
      out.set(
        integration.slug,
        computeColumnTallyDetail(
          integration,
          features,
          liveStatus,
          connection,
          now,
        ),
      );
    }
    return out;
  }, [integrations, features, liveStatus, connection, now]);

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
        // Validate against the SAME PARITY_TIERS guard `computeParityStats`
        // uses (page-stats.ts) instead of an unchecked `as ParityTier` cast —
        // an unknown/corrupt tier is skipped (logged loud) rather than seeding
        // the header map with a bogus tier value.
        const tier = asParityTier(cell.parity_tier);
        if (tier === undefined) {
          console.error(
            `FeatureGrid parityTierMap: unknown parity_tier ${JSON.stringify(
              cell.parity_tier,
            )} for integration ${JSON.stringify(cell.integration)} — skipping`,
          );
          continue;
        }
        map.set(cell.integration, tier);
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

  // How many integrations SHIP a demo of each feature — the grid's existing
  // `isWired` signal (`integration.demos`). A demo is "common" when ≥2
  // frameworks ship it; anything below that is "unique" and hidden by default
  // so the view shows cross-framework patterns. We deliberately use demos[]
  // (NOT the stale `features[]` list, and NOT `not_supported_features`): a
  // brand-new single-framework demo never appears in another integration's
  // `not_supported_features`, so that signal would wrongly read it as common.
  const frameworkCountByFeature = useMemo(() => {
    const counts = new Map<string, number>();
    for (const feature of features) {
      let n = 0;
      for (const integration of integrations) {
        if (integration.demos.some((d) => d.id === feature.id)) n++;
      }
      counts.set(feature.id, n);
    }
    return counts;
  }, [features, integrations]);

  // "Show deprecated" toggle — default OFF so the LGP gold-standard view
  // doesn't render rows for legacy/replaced patterns (e.g. `hitl`,
  // `agentic-chat-reasoning`). "Show unique" toggle — default OFF so the
  // default view is common ∩ non-deprecated. Operators flip either on to widen
  // the set; both combine with AND.
  const [showDeprecated, setShowDeprecated] = useState(false);
  const [showUnique, setShowUnique] = useState(false);

  const visibleFeatures = useMemo(
    () =>
      features.filter(
        (f) =>
          (showDeprecated || f.deprecated !== true) &&
          (showUnique || (frameworkCountByFeature.get(f.id) ?? 0) >= 2),
      ),
    [features, showDeprecated, showUnique, frameworkCountByFeature],
  );
  const deprecatedCount = useMemo(
    () => features.filter((f) => f.deprecated === true).length,
    [features],
  );
  const uniqueCount = useMemo(
    () =>
      features.filter((f) => (frameworkCountByFeature.get(f.id) ?? 0) < 2)
        .length,
    [features, frameworkCountByFeature],
  );

  const featuresByCategory = useMemo(
    () =>
      categories
        .map((cat) => ({
          ...cat,
          features: visibleFeatures.filter((f) => f.category === cat.id),
        }))
        .filter((cat) => cat.features.length > 0),
    [categories, visibleFeatures],
  );

  // Colspan for category separator row: base (Feature col) + integrations + optional ref-depth
  const categoryColSpan = integrations.length + 1 + (showRefDepth ? 1 : 0);

  return (
    <div className="px-8 pt-3 pb-8">
      <header className="mb-3">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
          <LiveIndicator status={connection} degraded={degraded} />
          {deprecatedCount > 0 && (
            <label
              data-testid="show-deprecated-toggle"
              className="ml-auto flex cursor-pointer items-center gap-1.5 text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)]"
              title={`${deprecatedCount} deprecated feature${deprecatedCount === 1 ? "" : "s"} hidden by default — toggle to show legacy/replaced patterns.`}
            >
              <input
                type="checkbox"
                checked={showDeprecated}
                onChange={(e) => setShowDeprecated(e.target.checked)}
                className="h-3.5 w-3.5 cursor-pointer accent-[var(--accent)]"
              />
              <span>
                Show deprecated{" "}
                <span className="text-[var(--text-muted)]">
                  ({deprecatedCount})
                </span>
              </span>
            </label>
          )}
          {uniqueCount > 0 && (
            <label
              data-testid="show-unique-toggle"
              className={`${deprecatedCount > 0 ? "" : "ml-auto "}flex cursor-pointer items-center gap-1.5 text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)]`}
              title={`${uniqueCount} demo${uniqueCount === 1 ? "" : "s"} supported by only one framework — hidden by default so the view shows cross-framework patterns.`}
            >
              <input
                type="checkbox"
                checked={showUnique}
                onChange={(e) => setShowUnique(e.target.checked)}
                className="h-3.5 w-3.5 cursor-pointer accent-[var(--accent)]"
              />
              <span>
                Show unique{" "}
                <span className="text-[var(--text-muted)]">
                  ({uniqueCount})
                </span>
              </span>
            </label>
          )}
        </div>
        <p className="mt-1 text-sm text-[var(--text-secondary)]">
          {subtitle ? <>{subtitle} · </> : null}
          {visibleFeatures.length} features × {integrations.length} integrations
          {(() => {
            const hidden: string[] = [];
            if (!showDeprecated && deprecatedCount > 0)
              hidden.push(`${deprecatedCount} deprecated`);
            if (!showUnique && uniqueCount > 0)
              hidden.push(`${uniqueCount} unique`);
            return hidden.length ? ` (${hidden.join(", ")} hidden)` : "";
          })()}
          .
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
                // Fail-safe default: a missing tally must render the
                // loading/offline affordance, NEVER authoritative ✓0 ~0 ✗0
                // (the "fake-zero lie" §5.3 guards against). Default toward
                // "we don't know" (unknown+loading), not "everything is zero".
                const tally = tallies.get(integration.slug) ?? {
                  green: 0,
                  amber: 0,
                  red: 0,
                  unknown: true,
                  loading: true,
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
                      parityTier={parityTierMap.get(integration.slug)}
                      minWidth={minColWidth}
                    />
                  );
                }

                // Legacy header rendering (backwards compat when overlays not provided)
                const total = tally.green + tally.amber + tally.red;
                const tallyTitle = tally.loading
                  ? "loading — waiting for the first live signal"
                  : tally.unknown
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
                      {tally.loading ? (
                        <span className="text-[var(--text-muted)] animate-pulse">
                          … loading
                        </span>
                      ) : tally.unknown ? (
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
                now={now}
                showRefDepth={showRefDepth}
                refCellsByFeature={refCellsByFeature}
                categoryColSpan={categoryColSpan}
              />
            ))}
            {/*
             * "Starter" pseudo-category row-group (spec §d). Informational
             * smoke-health for the deployed starter services — rendered after
             * the feature categories, never contributing to any feature cell's
             * rollup or column tally (it does not call renderCell/buildCellModel).
             * Shown across all overlay modes since it is a health surface, not a
             * feature-coverage row.
             */}
            <StarterSection
              integrations={integrations}
              liveStatus={liveStatus}
              connection={connection}
              now={now}
              categoryColSpan={categoryColSpan}
              showRefDepth={showRefDepth}
            />
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
 * DEGRADED OVERRIDE: when the feed is flapping / partially degraded
 * (`degraded` from `useLiveStatus`), the indicator shows a DISTINCT
 * "degraded" treatment that takes visual precedence over the steady
 * connection state — an amber ping-pulse dot labeled "degraded". The stream
 * is technically up (so it is NOT the red "offline" state) but unreliable, so
 * it must read differently from a clean green "live" or a steady amber
 * "connecting". `degraded` defaults to `false` so existing callers that pass
 * only `status` keep the original three-state behavior.
 *
 * Exported for unit-testable color-map coverage.
 */
export function LiveIndicator({
  status,
  degraded = false,
}: {
  status: ConnectionStatus;
  degraded?: boolean;
}) {
  // Degraded takes precedence over the steady connection state — the feed is
  // up but flapping, which must read distinctly from live/connecting/offline.
  // EXCEPTION: a terminal `error` (hard offline, paired with the red
  // OfflineBanner) is strictly worse than flapping and must outrank `degraded`.
  // Gating the override on `status !== "error"` prevents a self-contradicting
  // amber "degraded — feed is up" indicator stacked on the red "offline"
  // banner; when the feed has terminally failed the indicator reads "offline".
  const showDegraded = degraded && status !== "error";
  const dotClass = showDegraded
    ? "bg-[var(--amber)] animate-ping"
    : status === "live"
      ? "bg-[var(--ok)]"
      : status === "connecting"
        ? "bg-[var(--amber)] animate-pulse"
        : "bg-[var(--danger)]";
  const label = showDegraded
    ? "degraded"
    : status === "live"
      ? "live"
      : status === "connecting"
        ? "connecting"
        : "offline";
  const tone = showDegraded
    ? "amber"
    : status === "live"
      ? "green"
      : status === "connecting"
        ? "amber"
        : "red";
  return (
    <span
      data-testid="live-indicator"
      data-status={status}
      data-degraded={showDegraded}
      data-tone={tone}
      className="inline-flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-[var(--text-muted)]"
      title={
        showDegraded
          ? `Live data: ${label} — feed is flapping / partially degraded`
          : `Live data: ${label}`
      }
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
