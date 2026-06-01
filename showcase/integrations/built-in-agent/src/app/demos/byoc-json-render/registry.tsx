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

export const { registry } = defineRegistry(catalog, {
  components: {
    // The agent's system prompt includes a worked example where a MetricCard
    // is the root of a sales dashboard with a BarChart nested in its
    // `children` array. Forward `children` through so that multi-component
    // dashboards render as one wrapped block rather than dropping the chart.
    MetricCard: ({ props, children }) => (
      <div className="flex w-full flex-col items-stretch gap-3">
        <MetricCard
          label={props.label}
          value={props.value}
          trend={props.trend}
        />
        {children}
      </div>
    ),
    BarChart: ({ props }) => (
      <BarChart
        title={props.title}
        description={props.description}
        data={props.data}
      />
    ),
    PieChart: ({ props }) => (
      <PieChart
        title={props.title}
        description={props.description}
        data={props.data}
      />
    ),
  },
});
