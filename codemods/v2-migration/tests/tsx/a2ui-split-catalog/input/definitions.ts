import { z } from "zod";
import type { CatalogDefinitions } from "@copilotkit/a2ui-renderer";

export const myDefinitions = {
  Row: {
    description: "Horizontal layout container.",
    props: z.object({
      gap: z.number().optional(),
      children: z.array(z.string()),
    }),
  },
  Card: {
    description: "A titled card with one child.",
    props: z.object({
      title: z.string(),
      child: z.string().optional(),
    }),
  },
  PrimaryButton: {
    description: "A call-to-action button.",
    props: z.object({
      label: z.string(),
      // Dispatched back to the agent on click.
      action: z.unknown().optional(),
    }),
  },
  Metric: {
    props: z.object({ label: z.string(), value: z.string() }),
  },
  Button: {
    description: "A button with a label child.",
    props: z.object({
      child: z.string().describe("The id of the label component."),
      action: z
        .union([
          z.object({ event: z.object({ name: z.string() }) }),
          z.null(),
        ])
        .optional(),
    }),
  },
  Shortcut: {
    description: "A keyboard shortcut hint.",
    props: z.object({
      // A plain label, not a v0.9 action.
      action: z.string(),
      keys: z.string(),
    }),
  },
} satisfies CatalogDefinitions;

export type MyDefinitions = typeof myDefinitions;
