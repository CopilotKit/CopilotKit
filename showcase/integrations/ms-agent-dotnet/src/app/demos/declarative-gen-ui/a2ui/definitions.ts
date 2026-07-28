/**
 * A2UI catalog DEFINITIONS — platform-agnostic.
 *
 * Each entry declares a custom component name + Zod props schema + a short
 * description. The runtime's A2UI middleware serialises this schema into
 * the agent's `copilotkit.context` at request time, so the LLM knows which
 * components it may emit and what each prop expects.
 *
 * The React implementations live next to these definitions in
 * `./renderers.tsx`, where they are wired through `createCatalog(...)` with
 * `includeBasicCatalog: true` so the built-in A2UI primitives (Text, Row,
 * Column, Image, Card, Button, …) come along for free.
 */
// @region[definitions-zod]
import { z } from "zod";
import type { CatalogDefinitions } from "@copilotkit/a2ui-renderer";

export const myDefinitions = {
  // Override the basic catalog's Row/Column so `gap` is honoured — the
  // built-in versions ignore it, which makes composed dashboards cramped.
  Row: {
    description:
      "Horizontal layout container. Children share the width evenly. Use `gap` (px) to space dashboard tiles.",
    props: z.object({
      gap: z.number().optional(),
      // Enum mirrors the keys the renderer actually maps to CSS. Anything
      // outside this set silently falls back at render time, so we reject
      // it at schema-parse time to surface LLM typos early.
      align: z
        .enum(["start", "center", "end", "stretch", "baseline"])
        .optional(),
      justify: z.enum(["start", "center", "end", "spaceBetween"]).optional(),
      children: z.array(z.string()),
    }),
  },

  Column: {
    description:
      "Vertical layout container. Use `gap` (px) to space stacked sections.",
    props: z.object({
      gap: z.number().optional(),
      align: z
        .enum(["start", "center", "end", "stretch", "baseline"])
        .optional(),
      children: z.array(z.string()),
    }),
  },

  // Override the basic catalog's Text so it aligns flush with sibling
  // components (the built-in version carries an 8px outer margin).
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
      child: z.string().optional(),
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
    // NOTE on B12 (row-keys ⊆ columns[].key): we'd normally enforce this
    // with `z.object(...).refine(...)`, but the host catalog package's
    // `CatalogComponentDefinition` type requires `props: ZodObject<…>`
    // (it inspects `.shape` at runtime), and `.refine` returns a
    // `ZodEffects` that breaks both the `satisfies CatalogDefinitions`
    // type assertion and the runtime `.shape` access. Until the host
    // type is broadened, we encode the constraint in the description
    // above so the LLM sees the rule, and leave hard enforcement to
    // the rendering pipeline (which already shows the empty cell —
    // detection is the gap, not behaviour).
    props: z.object({
      columns: z.array(z.object({ key: z.string(), label: z.string() })),
      // Cells may be strings or numbers — the renderer stringifies at
      // render time, but accepting both lets the LLM emit raw numerics
      // (e.g. attainment 124) instead of being forced to stringify.
      rows: z.array(z.record(z.union([z.string(), z.number()]))),
    }),
  },

  PrimaryButton: {
    description:
      "A styled primary call-to-action button. Attach an optional `action` that will be dispatched back to the agent when the user clicks it.",
    props: z.object({
      label: z.string(),
      // The renderer hands `action` opaquely to the A2UI `dispatch` helper,
      // which forwards it back to the agent. We don't constrain the shape
      // (different demos use different action payloads), but `z.unknown()`
      // is strictly better than `z.any()` here because it forces any
      // consumer that touches the value to narrow it explicitly.
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
