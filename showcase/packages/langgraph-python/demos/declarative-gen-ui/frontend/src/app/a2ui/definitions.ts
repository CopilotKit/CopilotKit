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
import { z } from "zod";
import type { CatalogDefinitions } from "@copilotkit/a2ui-renderer";

// @region[definitions-zod]
export const myDefinitions = {
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
      "A small coloured pill communicating the state of something (healthy/degraded/down, online/offline, open/closed). Choose `variant` to match the intent.",
    props: z.object({
      text: z.string(),
      variant: z.enum(["success", "warning", "error", "info"]).optional(),
    }),
  },

  Metric: {
    description:
      "A key/value KPI display with an optional trend indicator. Ideal for dashboards (e.g. 'Revenue • $12.4k • up').",
    props: z.object({
      label: z.string(),
      value: z.string(),
      trend: z.enum(["up", "down", "neutral"]).optional(),
    }),
  },

  InfoRow: {
    description:
      "A compact two-column 'label: value' row. Good for stacks of facts inside a Card (owner, region, last updated, etc.).",
    props: z.object({
      label: z.string(),
      value: z.string(),
    }),
  },

  PrimaryButton: {
    description:
      "A styled primary call-to-action button. Attach an optional `action` that will be dispatched back to the agent when the user clicks it.",
    props: z.object({
      label: z.string(),
      action: z.any().optional(),
    }),
  },
} satisfies CatalogDefinitions;
// @endregion[definitions-zod]

export type MyDefinitions = typeof myDefinitions;
