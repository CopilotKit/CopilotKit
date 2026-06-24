/**
 * `issue_card` — a rich single-issue card: a header with the status + id,
 * the title as a link, a two-column metadata grid (status / assignee /
 * priority / team / cycle / updated), an optional description, and an
 * optional labels + "Open in Linear" footer.
 *
 * Use it for one issue — when the user asks about a specific issue, or
 * right after creating one (it doubles as the "filed!" confirmation).
 *
 * Authored with the `@copilotkit/bot-ui` JSX vocabulary; the Block Kit
 * shapes are produced by `renderSlackMessage(renderToIR(<IssueCard .../>))`.
 */
import { z } from "zod";
import {
  Context,
  Divider,
  Fields,
  Field,
  Header,
  Message,
  Section,
} from "@copilotkit/bot-ui";
import type { BotNode } from "@copilotkit/bot-ui";
import { accentForIssue, priorityGlyph, stateGlyph } from "./_status.js";

export const issueCardSchema = z.object({
  identifier: z.string().describe("Issue identifier, e.g. 'CPK-1234'."),
  title: z.string().describe("Issue title."),
  url: z.string().optional().describe("Link to the issue in Linear."),
  state: z.string().optional().describe("Workflow state name."),
  assignee: z.string().optional().describe("Assignee display name."),
  priority: z.string().optional().describe("Priority label."),
  team: z.string().optional().describe("Team key/name, e.g. 'CPK'."),
  cycle: z.string().optional().describe("Cycle name/number."),
  updated: z.string().optional().describe("Human-readable last-updated."),
  description: z
    .string()
    .optional()
    .describe(
      "Issue description (markdown). Kept short; long text is trimmed.",
    ),
  labels: z.array(z.string()).optional().describe("Label names."),
  justCreated: z
    .boolean()
    .optional()
    .describe(
      "Set true right after creating the issue to show a 'Filed' banner.",
    ),
});

export type IssueCardProps = z.infer<typeof issueCardSchema>;

/** Render ONE Linear issue as a rich Block Kit card. */
export function IssueCard(issue: IssueCardProps): BotNode {
  const titleText = issue.url
    ? `[**${issue.title}**](${issue.url})`
    : `**${issue.title}**`;

  const prio = priorityGlyph(issue.priority);

  const description = issue.description
    ? issue.description.length > 600
      ? `${issue.description.slice(0, 600)}…`
      : issue.description
    : undefined;

  const footer: string[] = [];
  if (issue.labels?.length) footer.push(`🏷️ ${issue.labels.join("  ")}`);
  if (issue.url) footer.push(`[Open in Linear →](${issue.url})`);
  const footerText = footer.length ? footer.join("   ·   ") : undefined;

  return (
    <Message accent={accentForIssue(issue)}>
      <Header>
        {`${issue.justCreated ? "✅ " : `${stateGlyph(issue.state)} `}${issue.identifier}`}
      </Header>
      <Section>{titleText}</Section>
      {issue.justCreated ? <Context>{"✨ Filed in Linear"}</Context> : null}
      <Fields>
        <Field>{`**Status**\n${stateGlyph(issue.state)} ${issue.state ?? "—"}`}</Field>
        <Field>{`**Assignee**\n${issue.assignee ?? "_unassigned_"}`}</Field>
        {issue.priority ? (
          <Field>{`**Priority**\n${prio ? `${prio} ` : ""}${issue.priority}`}</Field>
        ) : null}
        {issue.team ? <Field>{`**Team**\n${issue.team}`}</Field> : null}
        {issue.cycle ? <Field>{`**Cycle**\n${issue.cycle}`}</Field> : null}
        {issue.updated ? (
          <Field>{`**Updated**\n${issue.updated}`}</Field>
        ) : null}
      </Fields>
      {description ? <Divider /> : null}
      {description ? <Section>{description}</Section> : null}
      {footerText ? <Context>{footerText}</Context> : null}
    </Message>
  );
}
