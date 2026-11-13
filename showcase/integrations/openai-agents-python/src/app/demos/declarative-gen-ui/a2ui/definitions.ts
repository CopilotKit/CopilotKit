/**
 * Generative UI component DEFINITIONS — platform-agnostic.
 *
 * Each entry declares a custom component name + Zod props schema + a short
 * description. CopilotKit sends these schemas to the agent with each run,
 * so the LLM knows which components it may emit and what each prop
 * expects. `childList()` and `child()` mark the props that hold other
 * components.
 *
 * The React implementations live next to these definitions in
 * `./renderers.tsx`. `./catalog.ts` joins both with `createGenerativeUI`,
 * extending the standard catalog so the built-in components (Text, Row,
 * Column, Image, Card, Button, …) come along for free.
 */
// @region[definitions-zod]
import { z } from "zod";
import { childList, child } from "@copilotkit/react-core/generative-ui";

export const myDefinitions = {
  // Replace the standard Row/Column so `gap` is a pixel value, which the
  // agent's dashboards are tuned for.
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
      children: childList(),
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
      children: childList(),
    }),
  },

  // Replace the standard Text so it aligns flush with sibling components.
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
      child: child().optional(),
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
    // NOTE on B12 (row-keys ⊆ columns[].key): the constraint lives in the
    // description above so the LLM sees the rule. The renderer shows an
    // empty cell for an unknown key.
    props: z.object({
      columns: z.array(z.object({ key: z.string(), label: z.string() })),
      // Cells may be strings or numbers — the renderer stringifies at
      // render time, but accepting both lets the LLM emit raw numerics
      // (e.g. attainment 124) instead of being forced to stringify.
      rows: z.array(z.record(z.string(), z.union([z.string(), z.number()]))),
    }),
  },

  PrimaryButton: {
    description:
      "A styled primary call-to-action button. Attach an optional `action` event that is sent back to the agent when the user clicks it.",
    props: z.object({
      label: z.string(),
    }),
    events: { action: { parameters: z.object({}) } },
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
};
// @endregion[definitions-zod]

export type MyDefinitions = typeof myDefinitions;
