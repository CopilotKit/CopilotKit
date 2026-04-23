"use client";
import { Fragment, useMemo } from "react";
import {
  getIntegrations,
  getFeatures,
  getFeatureCategories,
  type Integration,
  type Feature,
  type Demo,
} from "@/lib/registry";
import {
  keyFor,
  mergeRowsToMap,
  resolveCell,
  type ConnectionStatus,
  type LiveStatusMap,
} from "@/lib/live-status";
import { useLiveStatus } from "@/hooks/useLiveStatus";

export interface CellContext {
  integration: Integration;
  feature: Feature;
  demo: Demo;
  /** Hosted URL for runnable demos; empty string for informational (command) demos. */
  hostedUrl: string;
  shellUrl: string;
  /** Live-status map merged across {smoke, health, e2e, qa} dimensions. */
  liveStatus: LiveStatusMap;
  /** Aggregated SSE connection status — worst across dimensions. */
  connection: ConnectionStatus;
}

export type CellRenderer = (ctx: CellContext) => React.ReactNode;

/**
 * Counts green / amber / red signals for a single integration column across
 * all features. QA does not contribute (informational only).
 *
 * Signal scoping (spec §5.4):
 *   - Feature-level dimensions (`smoke`, `e2e`) are counted per feature.
 *   - Integration-level dimensions (`health`) are counted EXACTLY ONCE
 *     per integration — the health row keyed `health:<slug>` is a single
 *     signal for the whole column, not one signal per feature. Double-
 *     counting health across N features would make a single red-health
 *     integration look N× worse than a single red-smoke feature.
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
  // the integration declares. Derived from the `health:<slug>` row directly
  // so we don't rely on resolveCell's per-feature join.
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

  // Feature-level dimensions: smoke + e2e, one tally per feature-with-demo.
  for (const feature of features) {
    const demo = integration.demos.find((d) => d.id === feature.id);
    if (!demo) continue;

    const cell = resolveCell(liveStatus, integration.slug, feature.id, {
      connection,
    });

    tallyTone(cell.smoke.tone);
    tallyTone(cell.e2e.tone);
  }

  return { green, amber, red, unknown: false };
}

function aggregateConnection(
  ...statuses: ConnectionStatus[]
): ConnectionStatus {
  // Worst-wins: error > connecting > live. Any "error" → show offline.
  if (statuses.some((s) => s === "error")) return "error";
  if (statuses.some((s) => s === "connecting")) return "connecting";
  return "live";
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

export function FeatureGrid({
  title,
  subtitle,
  renderCell,
  minColWidth = 200,
  integrations: integrationsProp,
  features: featuresProp,
  onlyGreen = false,
}: {
  title: string;
  subtitle?: string;
  renderCell: CellRenderer;
  minColWidth?: number;
  /** Pre-filtered integrations. Falls back to the full registry when omitted. */
  integrations?: Integration[];
  /** Pre-filtered features. Falls back to the full registry when omitted. */
  features?: Feature[];
  /**
   * Hide any feature row where at least one visible integration has a non-green
   * rollup (red / amber / gray / error) for that feature. Evaluated after live
   * status resolves so it reacts to the SSE stream.
   */
  onlyGreen?: boolean;
}) {
  const shellUrl = resolveShellUrl();
  // `getIntegrations()` / `getFeatures()` call `.sort()` / array spread on
  // every invocation, returning a fresh array identity. Memoize once per
  // mount so downstream `useMemo`s keyed on these arrays don't identity-
  // invalidate every render (C5 F9).
  const allIntegrations = useMemo(() => getIntegrations(), []);
  const allFeatures = useMemo(() => getFeatures(), []);
  const integrations = integrationsProp ?? allIntegrations;
  const features = featuresProp ?? allFeatures;
  const categories = useMemo(() => getFeatureCategories(), []);

  // One subscription per dimension — each resolves into `rows` that we
  // merge into a single keyed `LiveStatusMap` (spec §5.4).
  const smoke = useLiveStatus("smoke");
  const health = useLiveStatus("health");
  const e2e = useLiveStatus("e2e");
  const qa = useLiveStatus("qa");

  const liveStatus = useMemo(
    () => mergeRowsToMap(smoke.rows, health.rows, e2e.rows, qa.rows),
    [smoke.rows, health.rows, e2e.rows, qa.rows],
  );
  const connection = aggregateConnection(
    smoke.status,
    health.status,
    e2e.status,
    qa.status,
  );

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

  // When `onlyGreen` is on, a feature is visible only if EVERY integration
  // that has a demo for it rolls up green. Integrations without a demo for
  // the feature are treated as N/A (they don't sabotage the row), but a row
  // with zero green cells across the visible integrations is still hidden —
  // "fully green" means "something is green and nothing is failing".
  const greenVisible = useMemo(() => {
    if (!onlyGreen) return features;
    return features.filter((f) => {
      let sawGreen = false;
      for (const i of integrations) {
        const hasDemo = i.demos.some((d) => d.id === f.id);
        if (!hasDemo) continue;
        const cell = resolveCell(liveStatus, i.slug, f.id, { connection });
        if (cell.rollup !== "green") return false;
        sawGreen = true;
      }
      return sawGreen;
    });
  }, [onlyGreen, features, integrations, liveStatus, connection]);

  const featuresByCategory = categories
    .map((cat) => ({
      ...cat,
      features: greenVisible.filter((f) => f.category === cat.id),
    }))
    .filter((cat) => cat.features.length > 0);

  const hasVisibleRows = featuresByCategory.length > 0;

  return (
    <div className="px-8 pt-4 pb-6 max-w-[100vw]">
      <header className="mb-3 flex items-center gap-3">
        <h1 className="text-lg font-semibold tracking-tight">{title}</h1>
        <LiveIndicator status={connection} />
        {subtitle && (
          <span className="text-xs text-[var(--text-secondary)]">
            {subtitle}
          </span>
        )}
      </header>

      {connection === "error" && <OfflineBanner />}

      <div className="overflow-auto rounded-md border border-[var(--border)] bg-[var(--bg-surface)]">
        <table className="border-collapse text-[12px]">
          <thead>
            <tr>
              <th className="sticky left-0 top-0 z-30 bg-[var(--bg-muted)] px-3 py-2 text-left min-w-[220px] border-b border-[var(--border)]">
                <span className="text-[10px] font-medium uppercase tracking-wider text-[var(--text-muted)]">
                  Feature
                </span>
              </th>
              {integrations.map((integration) => {
                const tally = tallies.get(integration.slug) ?? {
                  green: 0,
                  amber: 0,
                  red: 0,
                  unknown: false,
                };
                const total = tally.green + tally.amber + tally.red;
                const tallyTitle = tally.unknown
                  ? "dashboard offline — live signal unavailable (§5.3)"
                  : total
                    ? `${tally.green} green · ${tally.amber} amber · ${tally.red} red of ${total} countable signals (E2E + Smoke per feature; Health counted once per integration; QA not tallied — informational only)`
                    : "no countable signals for this column";
                return (
                  <th
                    key={integration.slug}
                    className="sticky top-0 z-20 bg-[var(--bg-muted)] px-2.5 py-2 text-left border-b border-l border-[var(--border)] font-normal"
                    style={{ minWidth: `${minColWidth}px` }}
                  >
                    <div className="text-[12px] font-semibold text-[var(--text)] leading-tight">
                      {integration.name}
                    </div>
                    <div className="mt-0.5 flex items-center gap-2 text-[10px] text-[var(--text-muted)]">
                      <span className="uppercase tracking-wider">
                        {integration.language}
                      </span>
                      <span className="tabular-nums" title={tallyTitle}>
                        {tally.unknown ? (
                          "? offline"
                        ) : (
                          <>
                            <span className="text-[var(--ok)]">
                              {tally.green}
                            </span>
                            <span className="mx-0.5">/</span>
                            <span className="text-[var(--amber)]">
                              {tally.amber}
                            </span>
                            <span className="mx-0.5">/</span>
                            <span className="text-[var(--danger)]">
                              {tally.red}
                            </span>
                          </>
                        )}
                      </span>
                    </div>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {!hasVisibleRows && (
              <tr>
                <td
                  colSpan={integrations.length + 1}
                  className="px-6 py-10 text-center text-xs text-[var(--text-muted)]"
                >
                  No features match the current filters.
                </td>
              </tr>
            )}
            {featuresByCategory.map((cat) => (
              <Fragment key={cat.id}>
                <tr>
                  <td
                    colSpan={integrations.length + 1}
                    className="sticky left-0 px-3 pt-3 pb-1 text-[9.5px] font-medium uppercase tracking-wider text-[var(--text-muted)] bg-[var(--bg-surface)]"
                  >
                    {cat.name}
                  </td>
                </tr>
                {cat.features.map((feature) => {
                  const testing = feature.kind === "testing";
                  return (
                    <tr
                      key={feature.id}
                      className="odd:bg-[var(--bg-alt)] hover:bg-[var(--bg-hover)]"
                    >
                      <td className="sticky left-0 z-10 bg-inherit px-3 py-1.5 border-r border-t border-[var(--border)] align-top">
                        <div
                          className={
                            testing
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
                        </div>
                      </td>
                      {integrations.map((integration) => {
                        const demo = integration.demos.find(
                          (d) => d.id === feature.id,
                        );
                        return (
                          <td
                            key={integration.slug}
                            className="border-l border-t border-[var(--border)] px-2.5 py-1.5 align-top text-left"
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
                            ) : (
                              <div
                                className="text-center text-sm text-[var(--text-faint)]"
                                title="No demo for this feature"
                              >
                                —
                              </div>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </Fragment>
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
