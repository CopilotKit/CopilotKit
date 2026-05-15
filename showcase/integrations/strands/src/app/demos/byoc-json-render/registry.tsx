/**
 * Bridges the byoc-json-render catalog to concrete React components.
 *
 * PR #4271 fix (retroactively applied here from the start): the MetricCard
 * entry forwards `children` through so multi-component dashboards whose
 * root is a MetricCard render the nested charts rather than silently
 * dropping them.
 */

import { defineRegistry } from "@json-render/react";
import { catalog } from "./catalog";
import { MetricCard } from "./metric-card";
import { BarChart } from "./charts/bar-chart";
import { PieChart } from "./charts/pie-chart";

export const { registry } = defineRegistry(catalog, {
  components: {
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
