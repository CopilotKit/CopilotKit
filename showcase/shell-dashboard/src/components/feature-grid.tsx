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

export function FeatureGrid({
  title,
  subtitle,
  renderCell,
  minColWidth = 220,
}: {
  title: string;
  subtitle?: string;
  renderCell: CellRenderer;
  minColWidth?: number;
}) {
  const shellUrl = process.env.NEXT_PUBLIC_SHELL_URL || "http://localhost:3000";
  const integrations = getIntegrations();
  const features = getFeatures();
  const categories = getFeatureCategories();

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

  const featuresByCategory = categories
    .map((cat) => ({
      ...cat,
      features: features.filter((f) => f.category === cat.id),
    }))
    .filter((cat) => cat.features.length > 0);

  return (
    <div className="p-8 max-w-[100vw]">
      <header className="mb-6">
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

      <div className="overflow-auto rounded-lg border border-[var(--border)] bg-[var(--bg-surface)]">
        <table className="border-collapse text-sm">
          <thead>
            <tr>
              <th className="sticky left-0 top-0 z-30 bg-[var(--bg-muted)] px-4 py-3 text-left min-w-[260px] border-b border-[var(--border)]">
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
                    ? `${tally.green} green · ${tally.amber} amber · ${tally.red} red of ${total} countable signals (E2E + Smoke per feature; Health counted once per integration)`
                    : "no countable signals for this column";
                return (
                  <th
                    key={integration.slug}
                    className="sticky top-0 z-20 bg-[var(--bg-muted)] px-3 py-3 text-left border-b border-l border-[var(--border)] font-normal"
                    style={{ minWidth: `${minColWidth}px` }}
                  >
                    <div className="text-xs font-semibold text-[var(--text)]">
                      {integration.name}
                    </div>
                    <div className="mt-0.5 text-[10px] uppercase tracking-wider text-[var(--text-muted)]">
                      {integration.language}
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
              <Fragment key={cat.id}>
                <tr>
                  <td
                    colSpan={integrations.length + 1}
                    className="sticky left-0 px-4 pt-5 pb-1.5 text-[10px] font-medium uppercase tracking-wider text-[var(--text-muted)] bg-[var(--bg-surface)]"
                  >
                    {cat.name}
                  </td>
                </tr>
                {cat.features.map((feature) => {
                  const testing = feature.kind === "testing";
                  return (
                    <tr
                      key={feature.id}
                      className="border-t border-[var(--border)] hover:bg-[var(--bg-hover)]"
                    >
                      <td className="sticky left-0 z-10 bg-[var(--bg-surface)] px-4 py-2 border-r border-[var(--border)] align-top">
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
                            className="border-l border-[var(--border)] px-3 py-2 align-top text-left"
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
