import { Fragment } from "react";
import {
  getIntegrations,
  getFeatures,
  getFeatureCategories,
  type Integration,
  type Feature,
} from "@/lib/registry";
import { bundleGeneratedAt, isBundleStale } from "@/lib/status";

export interface CellContext {
  integration: Integration;
  feature: Feature;
  hostedUrl: string;
  bundleStale: boolean;
  shellUrl: string;
}

export type CellRenderer = (ctx: CellContext) => React.ReactNode;

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
              {integrations.map((integration) => (
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
                </th>
              ))}
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
                {cat.features.map((feature) => (
                  <tr
                    key={feature.id}
                    className="border-t border-[var(--border)] hover:bg-[var(--bg-hover)]"
                  >
                    <td className="sticky left-0 z-10 bg-[var(--bg-surface)] px-4 py-2 border-r border-[var(--border)] align-top">
                      <div
                        className="font-medium text-[var(--text)]"
                        title={feature.description}
                      >
                        {feature.name}
                      </div>
                    </td>
                    {integrations.map((integration) => {
                      const supported = integration.features.includes(
                        feature.id,
                      );
                      const demo = integration.demos.find(
                        (d) => d.id === feature.id,
                      );
                      return (
                        <td
                          key={integration.slug}
                          className="border-l border-[var(--border)] px-3 py-2 align-top text-left"
                        >
                          {supported && demo ? (
                            renderCell({
                              integration,
                              feature,
                              hostedUrl: `${integration.backend_url}${demo.route}`,
                              bundleStale,
                              shellUrl,
                            })
                          ) : supported ? (
                            <div
                              className="text-center text-[11px] text-[var(--text-muted)]"
                              title="Feature supported but no demo yet"
                            >
                              —
                            </div>
                          ) : (
                            <div
                              className="text-center text-base text-[var(--danger)]"
                              title="Not supported"
                            >
                              ✗
                            </div>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
