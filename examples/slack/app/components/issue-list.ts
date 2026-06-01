/**
 * `issue_list` — renders a set of Linear issues as a Block Kit card.
 *
 * The agent fetches issues from the Linear MCP server, then calls this
 * component with the fields it wants shown. Keeping the render here (not
 * in the agent) means the agent only has to produce data; the Slack
 * formatting — mrkdwn links, status dots, assignee — lives in one place.
 */
import { z } from "zod";
import { defineSlackComponent } from "@copilotkit/slack";
import type { KnownBlock } from "@slack/types";

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
    .describe("Priority label, e.g. 'Urgent', 'High'."),
});

const issueListSchema = z.object({
  heading: z
    .string()
    .optional()
    .describe("Optional heading, e.g. 'Open CPK issues this cycle'."),
  issues: z.array(issueSchema).min(1).describe("The issues to render."),
});

/** Map a Linear workflow-state name to a coloured status dot. */
function stateDot(state?: string): string {
  const s = (state ?? "").toLowerCase();
  if (s.includes("done") || s.includes("complete")) return ":white_check_mark:";
  if (s.includes("progress") || s.includes("started"))
    return ":large_blue_circle:";
  if (s.includes("cancel")) return ":no_entry_sign:";
  if (s.includes("backlog")) return ":white_circle:";
  return ":large_orange_circle:"; // Todo / triage / unknown
}

export const issueListComponent = defineSlackComponent({
  name: "issue_list",
  description:
    "Render a list of Linear issues as a Block Kit card (one row per issue " +
    "with a status dot, the identifier as a link, the title, assignee and " +
    "priority). Use this whenever you're showing the user issues you pulled " +
    "from Linear instead of writing them out as prose.",
  props: issueListSchema,
  fallbackText({ heading, issues }) {
    return `${heading ?? "Linear issues"} (${issues.length})`;
  },
  render({ heading, issues }) {
    const blocks: KnownBlock[] = [];

    if (heading) {
      blocks.push({
        type: "section",
        text: { type: "mrkdwn", text: `:clipboard:  *${heading}*` },
      });
      blocks.push({ type: "divider" });
    }

    for (const issue of issues) {
      const idLink = issue.url
        ? `<${issue.url}|${issue.identifier}>`
        : `*${issue.identifier}*`;
      const meta = [
        issue.state ? issue.state : null,
        issue.assignee
          ? `:bust_in_silhouette: ${issue.assignee}`
          : "unassigned",
        issue.priority ? `:fire: ${issue.priority}` : null,
      ]
        .filter(Boolean)
        .join("  ·  ");

      blocks.push({
        type: "section",
        text: {
          type: "mrkdwn",
          text: `${stateDot(issue.state)}  ${idLink}  ${issue.title}`,
        },
      });
      blocks.push({
        type: "context",
        elements: [{ type: "mrkdwn", text: meta }],
      });
    }

    return blocks;
  },
});
