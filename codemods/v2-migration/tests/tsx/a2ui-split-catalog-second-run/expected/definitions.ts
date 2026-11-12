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
    }),
    events: { action: {} },
  },
  Metric: {
    props: z.object({ label: z.string(), value: z.string() }),
  },
  Button: {
    description: "A button with a label child.",
    props: z.object({
      child: child("The id of the label component."),
    }),
    events: { onClick: {} },
  },
  Shortcut: {
    description: "A keyboard shortcut hint.",
    props: z.object({
      // A plain label, not a v0.9 action.
      action: z.string(),
      keys: z.string(),
    }),
  },
};

export type MyDefinitions = typeof myDefinitions;
