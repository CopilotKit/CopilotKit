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
} satisfies CatalogDefinitions;

export type MyDefinitions = typeof myDefinitions;
