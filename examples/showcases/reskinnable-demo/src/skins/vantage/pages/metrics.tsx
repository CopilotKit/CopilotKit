"use client";

import { useAgentContext } from "@copilotkit/react-core/v2";
import { BadgeCheck, CircleAlert, Database } from "lucide-react";
import { useMetricCatalog, useSources } from "../data/hooks";

export function MetricsPage() {
  const { metrics } = useMetricCatalog();
  const { sources } = useSources();

  useAgentContext({
    description:
      "What is visibly on the Semantic layer page: the connected warehouse " +
      "sources, and every metric definition with its certification status. An " +
      "uncertified metric is not yet agreed across Finance.",
    value: JSON.stringify({
      page: "Semantic layer",
      connectedSources: sources.map((s) => ({
        name: s.name,
        warehouse: s.warehouse,
        tables: s.tableCount,
      })),
      certifiedMetrics: metrics.filter((m) => m.certified).map((m) => m.label),
      uncertifiedMetrics: metrics
        .filter((m) => !m.certified)
        .map((m) => m.label),
    }),
  });

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <header className="space-y-1">
        <h1 className="text-xl font-semibold tracking-tight text-ink">
          Semantic layer
        </h1>
        <p className="text-sm text-ink-muted">
          Where the numbers come from, and what they mean.
        </p>
      </header>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-ink">Sources</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          {sources.map((source) => (
            <div
              key={source.id}
              className="flex items-center gap-3 rounded-[var(--radius)] border border-hairline bg-surface p-3.5"
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--radius)] bg-brand-soft text-brand">
                <Database className="h-4 w-4" />
              </span>
              <span className="min-w-0">
                <span className="block truncate text-sm font-semibold text-ink">
                  {source.name}
                </span>
                <span className="nw-figure block text-[11px] text-ink-muted">
                  {source.warehouse} · {source.tableCount} tables
                </span>
              </span>
            </div>
          ))}
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-ink">Metrics</h2>
        <div className="divide-y divide-hairline overflow-hidden rounded-[var(--radius)] border border-hairline bg-surface">
          {metrics.map((metric) => (
            <div key={metric.id} className="flex items-start gap-3 p-3.5">
              <span
                className={
                  metric.certified
                    ? "mt-0.5 shrink-0 text-positive"
                    : "mt-0.5 shrink-0 text-ink-muted"
                }
              >
                {metric.certified ? (
                  <BadgeCheck className="h-4 w-4" />
                ) : (
                  <CircleAlert className="h-4 w-4" />
                )}
              </span>
              <div className="min-w-0 space-y-0.5">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-semibold text-ink">
                    {metric.label}
                  </span>
                  <span
                    className={
                      metric.certified
                        ? "rounded bg-positive-soft px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-positive"
                        : "rounded bg-surface-muted px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-ink-muted"
                    }
                  >
                    {metric.certified ? "Certified" : "Uncertified"}
                  </span>
                  <span className="text-[11px] text-ink-muted">
                    {metric.owner}
                  </span>
                </div>
                <p className="text-xs text-ink-muted">{metric.definition}</p>
              </div>
            </div>
          ))}
        </div>
        <p className="text-[11px] text-ink-muted">
          Uncertified metrics can be explored but are not yet agreed across
          Finance.
        </p>
      </section>
    </div>
  );
}

export default MetricsPage;
