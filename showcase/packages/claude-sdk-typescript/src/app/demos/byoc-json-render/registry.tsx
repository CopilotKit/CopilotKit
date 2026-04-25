/**
 * Bridges the byoc-json-render catalog to concrete React components.
 *
 * `defineRegistry` returns a `registry` object that `@json-render/react`'s
 * `<Renderer />` consumes. Each entry is a component function receiving
 * `{ props, children }` — props are already validated + typed by the Zod
 * schemas declared in `./catalog.ts`.
 *
 * Factored out of `json-render-renderer.tsx` so the registry is built
 * exactly once at module scope (`defineRegistry` snapshots the catalog
 * reference; rebuilding it per render would churn `<Renderer />`'s
 * internal memoization unnecessarily).
 */

import { defineRegistry } from "@json-render/react";
import { catalog } from "./catalog";
import { MetricCard } from "./metric-card";
import { BarChart } from "./charts/bar-chart";
import { PieChart } from "./charts/pie-chart";

// Narrow prop shapes for the three components — mirrors the Zod schemas
// in `./catalog.ts`. Without these explicit casts TypeScript reports
// `props: unknown` because `@json-render/core`'s `defineRegistry`
// generics don't infer through the zod v3-vs-v4 peer-dep mismatch
// that the catalog file already documents.
type MetricCardProps = {
  label: string;
  value: string;
  trend: string | null;
};
type BarChartProps = {
  title: string;
  description: string | null;
  data: { label: string; value: number }[];
};
type PieChartProps = BarChartProps;

export const { registry } = defineRegistry(catalog, {
  components: {
    // The agent's system prompt includes a worked example where a MetricCard
    // is the root of a sales dashboard with a BarChart nested in its
    // `children` array. Forward `children` through so that multi-component
    // dashboards render as one wrapped block rather than dropping the chart.
    MetricCard: ({ props, children }) => {
      const p = props as MetricCardProps;
      return (
        <div className="flex w-full flex-col items-stretch gap-3">
          <MetricCard label={p.label} value={p.value} trend={p.trend} />
          {children}
        </div>
      );
    },
    BarChart: ({ props }) => {
      const p = props as BarChartProps;
      return (
        <BarChart title={p.title} description={p.description} data={p.data} />
      );
    },
    PieChart: ({ props }) => {
      const p = props as PieChartProps;
      return (
        <PieChart title={p.title} description={p.description} data={p.data} />
      );
    },
  },
  actions: {},
});
