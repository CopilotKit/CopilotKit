/**
 * json-render catalog for the byoc-json-render demo.
 *
 * We reuse the prebuilt React schema exposed by `@json-render/react/schema`
 * (flat element tree: `{ root, elements }`) rather than defining our own,
 * because the React renderer we ship is `@json-render/react`'s `<Renderer />`
 * which expects that exact shape.
 *
 * The catalog declares three components (MetricCard, BarChart, PieChart)
 * matching Wave 4a's hashbrown catalog so the two BYOC demos are directly
 * comparable. No actions are declared — this is a read-only rendering demo.
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

/**
 * Human-readable catalog description. Used by the agent's system prompt
 * so the LLM's available component list stays in lockstep with this file
 * (single source of truth, mirrors R4 in the spec).
 */
export const CATALOG_DESCRIPTION = `
Available components (use each as the "type" field of an element):

- MetricCard
  props: { label: string, value: string, trend: string | null }
  Example trend strings: "+12% vs last quarter", "-3% vs last month", null.

- BarChart
  props: { title: string, description: string | null, data: [{ label: string, value: number }] }

- PieChart
  props: { title: string, description: string | null, data: [{ label: string, value: number }] }
`.trim();
