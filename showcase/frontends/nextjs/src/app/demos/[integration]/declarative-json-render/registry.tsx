import { defineRegistry } from "@json-render/react";
import { catalog } from "./catalog";
import { MetricCard } from "./metric-card";
import { BarChart } from "./charts/bar-chart";
import { PieChart } from "./charts/pie-chart";

export const { registry } = defineRegistry(catalog, {
  components: {
    // The agent may nest components under any renderer root, so every
    // renderer also renders its children.
    MetricCard: ({ props, children }) => (
      <div className="flex w-full flex-col items-stretch gap-3">
        <MetricCard {...props} />
        {children}
      </div>
    ),
    BarChart: ({ props, children }) => (
      <div className="flex w-full flex-col items-stretch gap-3">
        <BarChart {...props} />
        {children}
      </div>
    ),
    PieChart: ({ props, children }) => (
      <div className="flex w-full flex-col items-stretch gap-3">
        <PieChart {...props} />
        {children}
      </div>
    ),
  },
  actions: {},
});
