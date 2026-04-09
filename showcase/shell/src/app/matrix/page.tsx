import Link from "next/link";
import {
  getIntegrations,
  getFeatures,
  getFeatureCategories,
  getCategoryLabel,
} from "@/lib/registry";
import { IntegrationsTabs } from "@/components/integrations-tabs";

export default function FeatureMatrixPage() {
  const integrations = getIntegrations();
  const features = getFeatures();
  const featureCategories = getFeatureCategories();

  if (integrations.length === 0) {
    return (
      <div className="mx-auto max-w-7xl px-6 py-8">
        <IntegrationsTabs />
        <h1 className="text-3xl font-light text-[var(--text)] text-center">
          Feature Matrix
        </h1>
        <p className="mt-6 text-[var(--text-muted)]">
          No integrations registered yet.
        </p>
      </div>
    );
  }

  const activeFeatures = features.filter((feature) =>
    integrations.some((i) => i.features.includes(feature.id)),
  );

  const featuresByCategory = featureCategories
    .map((cat) => ({
      ...cat,
      features: activeFeatures.filter((f) => f.category === cat.id),
    }))
    .filter((cat) => cat.features.length > 0);

  return (
    <div className="px-6 py-8">
      <div className="mx-auto max-w-7xl">
        <IntegrationsTabs />
        <h1 className="text-3xl font-light text-[var(--text)]">
          Feature Matrix
        </h1>
        <p className="mt-2 text-sm text-[var(--text-secondary)]">
          {integrations.length} integration
          {integrations.length !== 1 ? "s" : ""} across {activeFeatures.length}{" "}
          features
        </p>
      </div>

      <div className="mt-8 overflow-x-auto rounded-xl border border-[var(--border)] bg-[var(--bg-surface)]">
        <table className="w-full border-collapse">
          <thead>
            {/* Category header row */}
            <tr className="border-b border-[var(--border)]">
              <th className="sticky left-0 z-20 bg-[var(--bg-elevated)] min-w-[200px]" />
              {featuresByCategory.map((cat) => (
                <th
                  key={cat.id}
                  colSpan={cat.features.length}
                  className="border-l border-[var(--border)] bg-[var(--bg-elevated)] px-4 py-3 text-center"
                >
                  <span className="text-[10px] font-mono uppercase tracking-widest text-[var(--accent)]">
                    {cat.name}
                  </span>
                </th>
              ))}
            </tr>
            {/* Feature name row */}
            <tr className="border-b-2 border-[var(--border)]">
              <th className="sticky left-0 z-20 bg-[var(--bg-elevated)] p-4 text-left min-w-[200px]">
                <span className="text-xs font-mono uppercase tracking-wider text-[var(--text-muted)]">
                  Integration
                </span>
              </th>
              {featuresByCategory.map((cat) =>
                cat.features.map((feature, idx) => (
                  <th
                    key={feature.id}
                    className={`bg-[var(--bg-elevated)] px-3 py-3 text-center min-w-[120px] ${
                      idx === 0 ? "border-l border-[var(--border)]" : ""
                    }`}
                    title={feature.description}
                  >
                    <div className="text-[11px] font-medium text-[var(--text-secondary)] leading-tight">
                      {feature.name}
                    </div>
                  </th>
                )),
              )}
            </tr>
          </thead>
          <tbody>
            {integrations.map((integration, rowIdx) => (
              <tr
                key={integration.slug}
                className={`border-t border-[var(--border)] hover:bg-[var(--bg-elevated)]/50 transition-colors ${
                  rowIdx % 2 === 1 ? "bg-[var(--bg)]/30" : ""
                }`}
              >
                <td className="sticky left-0 z-10 bg-[var(--bg-surface)] p-4 border-r border-[var(--border)]">
                  <Link
                    href={`/integrations/${integration.slug}`}
                    className="font-medium text-sm text-[var(--text)] hover:text-[var(--accent)] transition-colors"
                  >
                    {integration.name}
                  </Link>
                  <div className="text-[10px] text-[var(--text-muted)] font-mono mt-0.5">
                    {getCategoryLabel(integration.category)}
                  </div>
                </td>
                {featuresByCategory.map((cat) =>
                  cat.features.map((feature, idx) => {
                    const supported = integration.features.includes(feature.id);
                    const hasDemo = integration.demos.some(
                      (d) => d.id === feature.id,
                    );
                    return (
                      <td
                        key={feature.id}
                        className={`px-3 py-3 text-center ${
                          idx === 0 ? "border-l border-[var(--border)]" : ""
                        }`}
                      >
                        {supported && hasDemo ? (
                          <Link
                            href={`/integrations/${integration.slug}/${feature.id}`}
                            className="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-[var(--accent-dim)] text-[var(--accent)] hover:bg-[var(--accent-light)] transition-colors text-sm"
                            title={`Try ${feature.name} demo`}
                          >
                            ✓
                          </Link>
                        ) : supported ? (
                          <span
                            className="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-[var(--bg-elevated)] text-[var(--text-muted)] text-sm"
                            title="Supported, no demo yet"
                          >
                            ○
                          </span>
                        ) : (
                          <span className="inline-flex items-center justify-center w-8 h-8 text-[var(--border)] text-sm">
                            —
                          </span>
                        )}
                      </td>
                    );
                  }),
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Legend */}
      <div className="mx-auto max-w-7xl mt-4 flex gap-6 text-xs text-[var(--text-muted)]">
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center justify-center w-5 h-5 rounded bg-[var(--accent-dim)] text-[var(--accent)] text-[10px]">
            ✓
          </span>
          Supported with live demo
        </div>
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center justify-center w-5 h-5 rounded bg-[var(--bg-elevated)] text-[var(--text-muted)] text-[10px]">
            ○
          </span>
          Supported, no demo
        </div>
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center justify-center w-5 h-5 text-[var(--border)] text-[10px]">
            —
          </span>
          Not supported
        </div>
      </div>
    </div>
  );
}
