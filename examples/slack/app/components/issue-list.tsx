/**
 * `issue_list` — renders a set of Linear issues as a compact Block Kit card:
 * a header, ONE section with one scannable line per issue (status dot + linked
 * identifier + title + assignee · updated), and a count footer.
 *
 * This is deliberately a fixed THREE-block layout (header + section + context)
 * regardless of issue count: a card-per-issue layout (~3 blocks each) blows
 * past Slack's per-attachment block limit on long lists and gets rejected with
 * `invalid_attachments`. We instead inline up to `MAX` issues into a single
 * section and surface the overflow in the footer.
 *
 * The agent fetches issues from the Linear MCP server and passes the fields
 * it wants shown; the Slack formatting lives here. For a single issue (or
 * right after creating one) prefer `issue_card`, which shows a full grid.
 *
 * Authored with the `@copilotkit/bot-ui` JSX vocabulary.
 */
import { z } from "zod";
import {
  Context,
  Header,
  Message,
  Section,
  type BotNode,
} from "@copilotkit/bot-ui";
import { accentForIssues, stateShortcode } from "./_status.js";

const issueSchema = z.object({
  identifier: z.string().describe("Linear issue identifier, e.g. 'CPK-1234'."),
  title: z.string().describe("Issue title."),
  url: z.string().optional().describe("Link to the issue in Linear."),
  state: z
    .string()
    .optional()
    .describe("Workflow state name, e.g. 'Todo', 'In Progress', 'Done'."),
  assignee: z
    .string()
    .optional()
    .describe("Assignee display name, or omit if unassigned."),
  priority: z
    .string()
    .optional()
    .describe("Priority label, e.g. 'Urgent', 'High', 'Medium', 'Low'."),
  updated: z
    .string()
    .optional()
    .describe("Human-readable last-updated, e.g. '2d ago'."),
});

export const issueListSchema = z.object({
  heading: z
    .string()
    .optional()
    .describe("Optional heading, e.g. 'Open CPK issues this cycle'."),
  issues: z.array(issueSchema).min(1).describe("The issues to render."),
});

export type IssueListProps = z.infer<typeof issueListSchema>;
type Issue = z.infer<typeof issueSchema>;

/** Max issues rendered inline; the rest are summarized in the footer. */
const MAX = 15;
/** Max title length before trimming (keeps each line scannable). */
const TITLE_MAX = 70;

/** Render a list of Linear issues as a compact, fixed-size Block Kit card. */
export function IssueList({ heading, issues }: IssueListProps): BotNode {
  const lines = issues.slice(0, MAX).map((issue: Issue) => {
    const idLink = issue.url
      ? `[**${issue.identifier}**](${issue.url})`
      : `**${issue.identifier}**`;
    const title =
      issue.title.length > TITLE_MAX
        ? `${issue.title.slice(0, TITLE_MAX)}…`
        : issue.title;
    return `${stateShortcode(issue.state)} ${idLink} ${title} — ${issue.assignee ?? "unassigned"} · ${issue.updated ?? ""}`;
  });

  const footer =
    issues.length > MAX
      ? `Showing ${MAX} of ${issues.length} issues`
      : `${issues.length} issue${issues.length === 1 ? "" : "s"}`;

  return (
    <Message accent={accentForIssues(issues)}>
      <Header>{`📋  ${heading ?? "Linear issues"}`}</Header>
      <Section>{lines.join("\n")}</Section>
      <Context>{footer}</Context>
    </Message>
  );
}
