/**
 * Bridges the byoc-json-render catalog to concrete React components.
 */

import { defineRegistry } from "@json-render/react";
import { catalog } from "./catalog";
import { MetricCard } from "./metric-card";
import { BarChart } from "./charts/bar-chart";
import { PieChart } from "./charts/pie-chart";

export const { registry } = defineRegistry(catalog, {
  components: {
    MetricCard: ({ props }) => (
      <MetricCard label={props.label} value={props.value} trend={props.trend} />
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
