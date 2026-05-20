/**
 * json-render catalog for the byoc-json-render demo.
 *
 * Reuses the prebuilt React schema exposed by `@json-render/react/schema`
 * (flat element tree: `{ root, elements }`) because the React renderer
 * we ship is `@json-render/react`'s `<Renderer />`, which expects that
 * exact shape.
 *
 * Declares three components (MetricCard, BarChart, PieChart) matching
 * the byoc-hashbrown catalog so the two BYOC demos are directly
 * comparable. No actions — this is a read-only rendering demo.
 */

import { defineCatalog } from "@json-render/core";
import { schema } from "@json-render/react/schema";
import { z } from "zod";

/** Numeric data point used by both bar and pie charts. */
const dataPoint = z.object({
  label: z.string(),
  value: z.number(),
});

export const catalog = defineCatalog(schema, {
  components: {
    MetricCard: {
      props: z.object({
        label: z.string(),
        value: z.string(),
        trend: z.string().nullable(),
      }),
      description:
        "A labelled metric (single number) with an optional trend subtitle",
    },
    BarChart: {
      props: z.object({
        title: z.string(),
        description: z.string().nullable(),
        data: z.array(dataPoint),
      }),
      description:
        "A vertical bar chart for comparing discrete values side by side",
    },
    PieChart: {
      props: z.object({
        title: z.string(),
        description: z.string().nullable(),
        data: z.array(dataPoint),
      }),
      description:
        "A donut-style pie chart for breaking a total down into category slices",
    },
  },
  actions: {},
});
