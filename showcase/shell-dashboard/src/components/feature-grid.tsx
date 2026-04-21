import { Fragment } from "react";
import {
  getIntegrations,
  getFeatures,
  getFeatureCategories,
  type Integration,
  type Feature,
  type Demo,
} from "@/lib/registry";
import {
  bundleGeneratedAt,
  getDemoStatus,
  healthBadge,
  isBundleStale,
  testBadge,
} from "@/lib/status";
import { getDocsStatus } from "@/lib/docs-status";

export interface CellContext {
  integration: Integration;
  feature: Feature;
  demo: Demo;
  /** Hosted URL for runnable demos; empty string for informational (command) demos. */
  hostedUrl: string;
  bundleStale: boolean;
  shellUrl: string;
}

export type CellRenderer = (ctx: CellContext) => React.ReactNode;

/**
 * Counts binary green / red signals for a single integration column across
 * all features, mirroring the resolution logic used by `DocsRow` + `CellStatus`.
 *
 * Counted as green: `docs-og ok`, `docs-shell ok`, `E2E` pass (fresh or amber),
 * `Smoke` pass, `health up`. Counted as red: `docs-og notfound/error`,
 * `docs-shell notfound/error`, `E2E` fail / none, `Smoke` fail / none,
 * `health down`. Skipped (neither green nor red): `missing` docs, `?` /
 * unknown / stale-bundle signals, QA (non-binary), and cells without a demo.
 */
function computeColumnTally(
  integration: Integration,
  features: Feature[],
  bundleStale: boolean,
): { green: number; red: number } {
  let green = 0;
  let red = 0;

  for (const feature of features) {
    const demo = integration.demos.find((d) => d.id === feature.id);
    if (!demo) continue;

    const isTesting = feature.kind === "testing";

    // Docs signals — only for primary features (matches CellStatus which
    // hides DocsRow for testing features).
    if (!isTesting) {
      const probed = getDocsStatus(feature.id);
      const override = integration.docs_links?.features?.[feature.id];
      const hasOgOverride = override?.og_docs_url !== undefined;
      const hasShellOverride = override?.shell_docs_path !== undefined;

      const ogState = hasOgOverride
        ? override?.og_docs_url
          ? "ok"
          : "missing"
        : probed.og;
      const shellState = hasShellOverride
        ? override?.shell_docs_path
          ? "ok"
          : "missing"
        : probed.shell;

      if (ogState === "ok") green++;
      else if (ogState === "notfound" || ogState === "error") red++;

      if (shellState === "ok") green++;
      else if (shellState === "notfound" || shellState === "error") red++;
    }

    // Test / health signals.
    const s = getDemoStatus(integration.slug, feature.id);
    const e2e = testBadge(s?.e2e ?? null, bundleStale);
    const smoke = testBadge(s?.smoke ?? null, bundleStale);
    const health = healthBadge(
      s?.health ?? { status: "unknown", checked_at: "" },
      bundleStale,
    );

    // testBadge tones: green/amber = passing, red = failing, gray = unknown/stale.
    if (e2e.tone === "green" || e2e.tone === "amber") green++;
    else if (e2e.tone === "red") red++;

    if (smoke.tone === "green" || smoke.tone === "amber") green++;
    else if (smoke.tone === "red") red++;

    if (health.tone === "green") green++;
    else if (health.tone === "red") red++;
  }

  return { green, red };
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
  const bundleStale = isBundleStale();
  const generatedAt = bundleGeneratedAt();

  const featuresByCategory = categories
    .map((cat) => ({
      ...cat,
      features: features.filter((f) => f.category === cat.id),
    }))
    .filter((cat) => cat.features.length > 0);

  return (
    <div className="p-8 max-w-[100vw]">
      <header className="mb-6">
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        <p className="mt-1 text-sm text-[var(--text-secondary)]">
          {subtitle ? <>{subtitle} · </> : null}
          {features.length} features × {integrations.length} integrations.{" "}
          <span
            className={
              bundleStale ? "text-[var(--danger)]" : "text-[var(--text-muted)]"
            }
          >
            Status bundle: {new Date(generatedAt).toLocaleString()}
            {bundleStale && " (stale — signals shown as ?)"}
          </span>
        </p>
      </header>

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
                const tally = computeColumnTally(
                  integration,
                  features,
                  bundleStale,
                );
                const total = tally.green + tally.red;
                const tallyTitle = total
                  ? `${tally.green} green · ${tally.red} red of ${total} countable signals (docs-og, docs-shell, E2E, Smoke, health)`
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
                      <span className="text-[var(--ok)]">✓ {tally.green}</span>
                      <span className="mx-1 text-[var(--text-muted)]">·</span>
                      <span className="text-[var(--danger)]">
                        ✗ {tally.red}
                      </span>
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
                                bundleStale,
                                shellUrl,
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
