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

// @json-render/core peer-depends on zod ^4, but this showcase package is
// pinned to zod ^3 (matching @copilotkit/react-core's own pinning). The
// schemas work at runtime — they're structural and zod 3→4 kept
// `z.object`/`z.string`/`z.number`/`z.array`/`z.nullable` wire-compatible
// — but the type signatures do not unify. The `@ts-expect-error` calls out
// exactly the cross-version gap and is paired with zod-typed props so the
// schema is still an exported contract.
export const catalog = defineCatalog(schema, {
  components: {
    MetricCard: {
      // @ts-expect-error zod v3 schema vs @json-render/core's v4 peer dep
      props: z.object({
        label: z.string(),
        value: z.string(),
        trend: z.string().nullable(),
      }),
      description:
        "A labelled metric (single number) with an optional trend subtitle",
    },
    BarChart: {
      // @ts-expect-error zod v3 schema vs @json-render/core's v4 peer dep
      props: z.object({
        title: z.string(),
        description: z.string().nullable(),
        data: z.array(dataPoint),
      }),
      description:
        "A vertical bar chart for comparing discrete values side by side",
    },
    PieChart: {
      // @ts-expect-error zod v3 schema vs @json-render/core's v4 peer dep
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
