import { Fragment } from "react";
import {
  getIntegrations,
  getFeatures,
  getFeatureCategories,
} from "@/lib/registry";

const SHELL_URL = process.env.NEXT_PUBLIC_SHELL_URL || "http://localhost:3000";

export default function InternalMatrixPage() {
  const integrations = getIntegrations();
  const features = getFeatures();
  const categories = getFeatureCategories();

  // Show every declared feature — rows with no support yet are useful signal
  // (they surface gaps we want to fill).
  const featuresByCategory = categories
    .map((cat) => ({
      ...cat,
      features: features.filter((f) => f.category === cat.id),
    }))
    .filter((cat) => cat.features.length > 0);

  return (
    <div className="p-8 max-w-[100vw]">
      <header className="mb-6">
        <h1 className="text-xl font-semibold tracking-tight">Feature Matrix</h1>
        <p className="mt-1 text-sm text-[var(--text-secondary)]">
          {features.length} features × {integrations.length} integrations
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
                  className="sticky top-0 z-20 bg-[var(--bg-muted)] px-3 py-3 text-left min-w-[160px] border-b border-l border-[var(--border)] font-normal"
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
                    <td className="sticky left-0 z-10 bg-[var(--bg-surface)] px-4 py-2.5 border-r border-[var(--border)]">
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
                          className="border-l border-[var(--border)] px-3 py-2.5 align-middle text-center"
                        >
                          {supported && demo ? (
                            <div className="inline-flex items-center gap-2 text-xs font-medium">
                              <a
                                href={`${SHELL_URL}/integrations/${integration.slug}/${feature.id}/preview`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-[var(--accent)] hover:text-[var(--accent-hover)] hover:underline"
                              >
                                demo
                              </a>
                              <span className="text-[var(--border-strong)]">
                                ·
                              </span>
                              <a
                                href={`${SHELL_URL}/integrations/${integration.slug}/${feature.id}/code`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-[var(--accent)] hover:text-[var(--accent-hover)] hover:underline"
                              >
                                code
                              </a>
                            </div>
                          ) : supported ? (
                            <span
                              className="text-[11px] text-[var(--text-muted)]"
                              title="Feature supported but no demo yet"
                            >
                              –
                            </span>
                          ) : (
                            <span
                              className="text-base text-[var(--danger)]"
                              title="Not supported"
                            >
                              ✗
                            </span>
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

      <div className="mt-4 flex gap-6 text-xs text-[var(--text-muted)]">
        <div className="flex items-center gap-1.5">
          <span className="text-[var(--accent)] font-medium">demo · code</span>
          supported with live links
        </div>
        <div className="flex items-center gap-1.5">
          <span>–</span>
          supported, no demo yet
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-[var(--danger)]">✗</span>
          not supported
        </div>
      </div>
    </div>
  );
}
