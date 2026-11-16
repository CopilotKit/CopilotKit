/**
 * A2UI catalog definitions for the sales dashboard.
 *
 * Each entry declares a component name, a Zod props schema and a short
 * description. At request time the A2UI middleware serializes these schemas
 * into the agent's context, so the model knows which components it may emit
 * and what each prop expects.
 *
 * The React implementations are in `./renderers.tsx`. `./catalog.ts` wires
 * the two together with `includeBasicCatalog: true`, so the built-in A2UI
 * primitives (Image, Button, List, ...) come along.
 *
 * A description that starts with `REF:common_types.json#/$defs/<Name>` marks
 * an A2UI common type. The catalog serializer turns it into a `$ref`, and
 * A2UI Express needs it to bind positional arguments.
 */
// @region[definitions-zod]
import type { CatalogDefinitions } from "@copilotkit/a2ui-renderer";
import { z } from "../a2ui-zod";

export const myDefinitions = {
  // Override the basic catalog's Row and Column so that `gap` is honoured.
  // The built-in versions ignore it, which makes composed dashboards cramped.
  Row: {
    description:
      "Horizontal layout container. Children share the width evenly. Use `gap` (px) to space dashboard tiles.",
    props: z.object({
      // Keep `children` first. A2UI Express maps positional arguments in
      // property order, so `Row([...], gap=16)` must bind the list to it.
      children: z
        .array(z.string())
        .describe("REF:common_types.json#/$defs/ChildList"),
      gap: z.number().optional(),
      // The enum lists the keys that the renderer maps to CSS. A value
      // outside this set would silently fall back at render time, so the
      // schema rejects it and surfaces model typos early.
      align: z
        .enum(["start", "center", "end", "stretch", "baseline"])
        .optional(),
      justify: z.enum(["start", "center", "end", "spaceBetween"]).optional(),
    }),
  },

  Column: {
    description:
      "Vertical layout container. Use `gap` (px) to space stacked sections.",
    props: z.object({
      // Keep `children` first, as in Row.
      children: z
        .array(z.string())
        .describe("REF:common_types.json#/$defs/ChildList"),
      gap: z.number().optional(),
      align: z
        .enum(["start", "center", "end", "stretch", "baseline"])
        .optional(),
    }),
  },

  // Override the basic catalog's Text so that it aligns flush with sibling
  // components. The built-in version has an 8px outer margin.
  Text: {
    description: "A plain text line. Use for short explanations inside cards.",
    props: z.object({
      text: z.string(),
    }),
  },

  Card: {
    description:
      "A titled card container with an optional subtitle and a single child slot. Use it to group related content (metrics, rows, buttons).",
    props: z.object({
      title: z.string(),
      subtitle: z.string().optional(),
      child: z
        .string()
        .describe("REF:common_types.json#/$defs/ComponentId")
        .optional(),
    }),
  },

  StatusBadge: {
    description:
      "A small coloured pill communicating the state of something (healthy/degraded/at-risk, on-track/behind). Choose `variant` to match the intent.",
    props: z.object({
      text: z.string(),
      variant: z.enum(["success", "warning", "error", "info"]).optional(),
    }),
  },

  Metric: {
    description:
      "A key/value KPI tile with an optional trend indicator and trend delta. Ideal for dashboard KPI rows (e.g. 'Revenue • $4.2M • up 12%').",
    props: z.object({
      label: z.string(),
      value: z.string(),
      trend: z.enum(["up", "down", "neutral"]).optional(),
      trendValue: z.string().optional(),
    }),
  },

  InfoRow: {
    description:
      "A compact two-column 'label: value' row. Good for stacks of facts inside a Card (owner, region, ARR, renewal date, etc.).",
    props: z.object({
      label: z.string(),
      value: z.string(),
    }),
  },

  DataTable: {
    description:
      "A data table with column headers and rows. Ideal for rankings and per-person/per-item breakdowns (rep performance vs quota, deal lists). Each row's keys MUST appear in `columns[].key`; unknown row keys render as blank cells and indicate model/schema drift.",
    // Row keys must be a subset of `columns[].key`. A `.refine(...)` would
    // enforce that, but it returns a `ZodEffects`, and the catalog needs a
    // `ZodObject` (it reads `.shape` at runtime). So the description above
    // states the rule for the model, and the renderer shows an unknown key
    // as an empty cell.
    props: z.object({
      columns: z.array(z.object({ key: z.string(), label: z.string() })),
      // Cells may be strings or numbers. The renderer stringifies them, so
      // the model can emit raw numbers (for example, attainment 124).
      rows: z.array(z.record(z.union([z.string(), z.number()]))),
    }),
  },

  PrimaryButton: {
    description:
      "A styled primary call-to-action button. Attach an optional `action` that will be dispatched back to the agent when the user clicks it.",
    props: z.object({
      label: z.string(),
      // The renderer hands `action` to the A2UI `dispatch` helper as it is,
      // which sends it back to the agent. Demos use different action
      // payloads, so the shape is open. `unknown` makes any reader narrow it.
      action: z.unknown().optional(),
    }),
  },

  PieChart: {
    description:
      "A pie/donut chart with a brand-coloured legend. Provide `title`, `description`, and `data` as an array of `{ label, value }` objects. Great for part-of-whole breakdowns (revenue by region, pipeline by stage).",
    props: z.object({
      title: z.string(),
      description: z.string(),
      data: z.array(
        z.object({
          label: z.string(),
          value: z.number(),
        }),
      ),
    }),
  },

  BarChart: {
    description:
      "A vertical bar chart built on Recharts. Provide `title`, `description`, and `data` as an array of `{ label, value }` objects. Great for comparing series across categories or time (monthly revenue, signups per month).",
    props: z.object({
      title: z.string(),
      description: z.string(),
      data: z.array(
        z.object({
          label: z.string(),
          value: z.number(),
        }),
      ),
    }),
  },
} satisfies CatalogDefinitions;
// @endregion[definitions-zod]

export type MyDefinitions = typeof myDefinitions;
