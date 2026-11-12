import { z } from "zod";
import { def, onAction } from "./shared";

export const feedbackDefinitions = {
  Alert: def(
    "Feedback",
    "Inline alert with icon, title and message.",
    z.object({
      title: z.string(),
      message: z.string().optional(),
      tone: z.enum(["info", "success", "warning", "error"]).optional(),
    }),
  ),
  Callout: def(
    "Feedback",
    "Highlighted tip or note with optional emoji/icon and a call to action.",
    z.object({
      title: z.string().optional(),
      text: z.string(),
      icon: z.string().optional(),
      actionLabel: z.string().optional(),
    }),
    onAction("Fires when the call-to-action button is clicked."),
  ),
  Skeleton: def(
    "Feedback",
    "Loading placeholder lines/blocks.",
    z.object({
      lines: z.number().optional(),
      variant: z.enum(["text", "card", "chart"]).optional(),
    }),
  ),
  EmptyState: def(
    "Feedback",
    "Empty or zero-results state with icon, title, hint and optional action: no matches, nothing scheduled, inbox zero.",
    z.object({
      title: z.string(),
      description: z.string().optional(),
      icon: z.string().optional(),
      actionLabel: z.string().optional(),
    }),
    onAction("Fires when the action button is clicked."),
  ),
};
