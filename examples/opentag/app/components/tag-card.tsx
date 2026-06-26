/**
 * `tag_card` component — a small card that shows the tag OpenTag has applied to
 * the conversation: the label as a colored header, a one-line rationale, and an
 * optional confidence / "applied by" footer.
 *
 * Authored with the `@copilotkit/bot-ui` JSX vocabulary, which renders to each
 * platform's native format (Block Kit on Slack) — so the same component works
 * unchanged on other adapters. Its exported zod prop schema doubles as the
 * render-tool input schema (see `app/tools/tag-card.tsx`).
 */
import { z } from "zod";
import { Context, Header, Message, Section } from "@copilotkit/bot-ui";
import type { BotNode } from "@copilotkit/bot-ui";

/** Accent color per well-known label; unknown labels fall back to slate. */
function accentForLabel(label: string): string {
  switch (label.toLowerCase()) {
    case "bug":
      return "#EB5757"; // red
    case "urgent":
      return "#E2B340"; // amber
    case "question":
      return "#2D9CDB"; // blue
    case "feature":
      return "#27AE60"; // green
    case "docs":
      return "#9B51E0"; // purple
    default:
      return "#64748B"; // slate
  }
}

export const tagCardSchema = z.object({
  label: z.string().describe("The applied tag, e.g. 'bug' or 'question'."),
  rationale: z
    .string()
    .describe("One-line reason this label fits, grounded in the thread."),
  confidence: z
    .enum(["high", "medium", "low"])
    .optional()
    .describe("How confident you are in the label."),
  appliedBy: z
    .string()
    .optional()
    .describe("Display name of the person who approved the tag, if known."),
});

export type TagCardProps = z.infer<typeof tagCardSchema>;

/** Render an applied tag as a card. */
export function TagCard({
  label,
  rationale,
  confidence,
  appliedBy,
}: TagCardProps): BotNode {
  const footer: string[] = [];
  if (confidence) footer.push(`confidence: ${confidence}`);
  if (appliedBy) footer.push(`applied by ${appliedBy}`);
  const footerText = footer.length ? footer.join("   ·   ") : undefined;

  return (
    <Message accent={accentForLabel(label)}>
      <Header>{`🏷️ Tagged: ${label}`}</Header>
      <Section>{rationale}</Section>
      {footerText ? <Context>{footerText}</Context> : null}
    </Message>
  );
}
