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

  const activeFeatures = features.filter((f) =>
    integrations.some((i) => i.features.includes(f.id)),
  );

  const featuresByCategory = categories
    .map((cat) => ({
      ...cat,
      features: activeFeatures.filter((f) => f.category === cat.id),
    }))
    .filter((cat) => cat.features.length > 0);

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-light">Internal Feature Matrix</h1>
        <p className="mt-1 text-sm text-[var(--text-muted)]">
          {activeFeatures.length} features × {integrations.length} integrations.
          Demo and code links point to{" "}
          <code className="text-[var(--accent)]">{SHELL_URL}</code>.
        </p>
      </div>

      <div className="overflow-auto rounded-xl border border-[var(--border)] bg-[var(--bg-surface)]">
        <table className="border-collapse text-sm">
          <thead>
            <tr className="border-b-2 border-[var(--border)]">
              <th className="sticky left-0 top-0 z-30 bg-[var(--bg-elevated)] px-4 py-3 text-left min-w-[240px]">
                <span className="text-[10px] font-mono uppercase tracking-widest text-[var(--text-muted)]">
                  Feature
                </span>
              </th>
              {integrations.map((integration) => (
                <th
                  key={integration.slug}
                  className="sticky top-0 z-20 bg-[var(--bg-elevated)] border-l border-[var(--border)] px-3 py-3 text-left min-w-[180px]"
                >
                  <div className="text-xs font-medium text-[var(--text)]">
                    {integration.name}
                  </div>
                  <div className="mt-0.5 text-[10px] font-mono uppercase tracking-wider text-[var(--text-muted)]">
                    {integration.language}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {featuresByCategory.map((cat) => (
              <Fragment key={cat.id}>
                <tr className="bg-[var(--bg-elevated)]/60">
                  <td
                    colSpan={integrations.length + 1}
                    className="sticky left-0 px-4 py-2 text-[10px] font-mono uppercase tracking-widest text-[var(--accent)] border-y border-[var(--border)]"
                  >
                    {cat.name}
                  </td>
                </tr>
                {cat.features.map((feature, rowIdx) => (
                  <tr
                    key={feature.id}
                    className={`border-t border-[var(--border)] ${
                      rowIdx % 2 === 1 ? "bg-[var(--bg)]/30" : ""
                    }`}
                  >
                    <td className="sticky left-0 z-10 bg-[var(--bg-surface)] px-4 py-3 border-r border-[var(--border)]">
                      <div className="font-medium text-[var(--text)]">
                        {feature.name}
                      </div>
                      <div
                        className="mt-0.5 text-[11px] text-[var(--text-muted)] leading-tight max-w-[220px]"
                        title={feature.description}
                      >
                        {feature.description}
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
                          className="border-l border-[var(--border)] px-3 py-3 align-middle text-center"
                        >
                          {supported && demo ? (
                            <div className="inline-flex gap-1.5">
                              <a
                                href={`${SHELL_URL}/integrations/${integration.slug}/${feature.id}/preview`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1 rounded-md bg-[var(--ok-dim)] px-2 py-1 text-[11px] font-medium text-[var(--ok)] hover:bg-[var(--ok)]/25 transition-colors"
                                title="Open hosted demo"
                              >
                                ▶ demo
                              </a>
                              <a
                                href={`${SHELL_URL}/integrations/${integration.slug}/${feature.id}/code`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1 rounded-md bg-[var(--accent-dim)] px-2 py-1 text-[11px] font-medium text-[var(--accent)] hover:bg-[var(--accent)]/25 transition-colors"
                                title="Open code snippet"
                              >
                                {"</>"} code
                              </a>
                            </div>
                          ) : supported ? (
                            <span
                              className="inline-flex items-center rounded-md bg-[var(--bg-elevated)] px-2 py-1 text-[11px] text-[var(--text-muted)]"
                              title="Feature supported but no demo yet"
                            >
                              ○ no demo
                            </span>
                          ) : (
                            <span
                              className="inline-flex items-center justify-center w-7 h-7 rounded-md bg-[var(--danger-dim)] text-[var(--danger)] text-sm font-semibold"
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

      <div className="mt-4 flex gap-5 text-xs text-[var(--text-muted)]">
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center rounded-md bg-[var(--ok-dim)] px-1.5 py-0.5 text-[10px] text-[var(--ok)]">
            ▶ demo
          </span>
          <span className="inline-flex items-center rounded-md bg-[var(--accent-dim)] px-1.5 py-0.5 text-[10px] text-[var(--accent)]">
            {"</>"} code
          </span>
          Supported with live demo + code snippet
        </div>
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center rounded-md bg-[var(--bg-elevated)] px-1.5 py-0.5 text-[10px] text-[var(--text-muted)]">
            ○ no demo
          </span>
          Declared as supported, no demo bundled
        </div>
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center justify-center w-4 h-4 rounded-md bg-[var(--danger-dim)] text-[var(--danger)] text-[10px] font-semibold">
            ✗
          </span>
          Not supported
        </div>
      </div>
    </div>
  );
}
