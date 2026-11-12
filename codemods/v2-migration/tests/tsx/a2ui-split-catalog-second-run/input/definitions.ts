import { z } from "zod";
import { childList, child } from "@copilotkit/react-core/generative-ui";

export const myDefinitions = {
  Row: {
    description: "Horizontal layout container.",
    props: z.object({
      gap: z.number().optional(),
      children: childList(),
    }),
  },
  Card: {
    description: "A titled card with one child.",
    props: z.object({
      title: z.string(),
      child: child().optional(),
    }),
  },
  PrimaryButton: {
    description: "A call-to-action button.",
    props: z.object({
      label: z.string(),
      // Dispatched back to the agent on click.
    }),
    events: { action: {} },
  },
  Metric: {
    props: z.object({ label: z.string(), value: z.string() }),
  },
};

export type MyDefinitions = typeof myDefinitions;
