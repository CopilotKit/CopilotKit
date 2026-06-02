/**
 * `issue_list` — renders a set of Linear issues as a clean Block Kit card:
 * a header, then one scannable row per issue (status dot + linked identifier
 * + title, with a greyed meta line for assignee / priority / updated), with
 * dividers between rows and a count footer.
 *
 * The agent fetches issues from the Linear MCP server and passes the fields
 * it wants shown; the Slack formatting lives here. For a single issue (or
 * right after creating one) prefer `issue_card`, which shows a full grid.
 */
import { z } from "zod";
import { defineSlackComponent } from "@copilotkit/slack";
import type { KnownBlock } from "@slack/types";
import {
  accentForIssues,
  priorityShortcode,
  stateShortcode,
} from "./_status.js";

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

const issueListSchema = z.object({
  heading: z
    .string()
    .optional()
    .describe("Optional heading, e.g. 'Open CPK issues this cycle'."),
  issues: z.array(issueSchema).min(1).describe("The issues to render."),
});

export const issueListComponent = defineSlackComponent({
  name: "issue_list",
  description:
    "Render a list of Linear issues as a Block Kit card — a header plus one " +
    "row per issue (status dot, linked identifier, title, and a meta line " +
    "with assignee/priority/updated). Use this whenever you're showing the " +
    "user multiple issues you pulled from Linear instead of writing them out " +
    "as prose. For a single issue, use issue_card.",
  // Left border surfaces the hottest priority in the list (red=urgent,
  // orange=high), else Linear purple.
  accentColor: ({ issues }) => accentForIssues(issues),
  props: issueListSchema,
  fallbackText({ heading, issues }) {
    return `${heading ?? "Linear issues"} (${issues.length})`;
  },
  render({ heading, issues }) {
    const blocks: KnownBlock[] = [
      {
        type: "header",
        text: {
          type: "plain_text",
          text: `📋  ${heading ?? "Linear issues"}`,
          emoji: true,
        },
      },
    ];

    issues.forEach((issue, i) => {
      const idLink = issue.url
        ? `<${issue.url}|*${issue.identifier}*>`
        : `*${issue.identifier}*`;
      blocks.push({
        type: "section",
        text: {
          type: "mrkdwn",
          text: `${stateShortcode(issue.state)}  ${idLink}  ${issue.title}`,
        },
      });

      const prio = priorityShortcode(issue.priority);
      const meta = [
        issue.state,
        issue.assignee
          ? `:bust_in_silhouette: ${issue.assignee}`
          : "unassigned",
        issue.priority ? `${prio ? `${prio} ` : ""}${issue.priority}` : null,
        issue.updated ? `:clock3: ${issue.updated}` : null,
      ]
        .filter(Boolean)
        .join("   ·   ");
      blocks.push({
        type: "context",
        elements: [{ type: "mrkdwn", text: meta }],
      });

      if (i < issues.length - 1) blocks.push({ type: "divider" });
    });

    blocks.push({
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: `${issues.length} issue${issues.length === 1 ? "" : "s"}`,
        },
      ],
    });

    return blocks;
  },
});
