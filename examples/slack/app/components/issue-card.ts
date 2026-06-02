/**
 * `issue_card` — a rich single-issue card: a header with the status + id,
 * the title as a link, a two-column metadata grid (status / assignee /
 * priority / team / cycle / updated), an optional description, and an
 * optional labels + "Open in Linear" footer.
 *
 * Use it for one issue — when the user asks about a specific issue, or
 * right after creating one (it doubles as the "filed!" confirmation).
 */
import { z } from "zod";
import { defineSlackComponent } from "@copilotkit/slack";
import type { KnownBlock } from "@slack/types";
import {
  accentForIssue,
  priorityShortcode,
  stateShortcode,
  stateUnicode,
} from "./_status.js";

const issueCardSchema = z.object({
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

/** One `*Label*\nvalue` field for the 2-column grid. */
function field(label: string, value: string) {
  return { type: "mrkdwn" as const, text: `*${label}*\n${value}` };
}

export const issueCardComponent = defineSlackComponent({
  name: "issue_card",
  description:
    "Render ONE Linear issue as a rich Block Kit card with a status header, " +
    "the title as a link, and a metadata grid (status, assignee, priority, " +
    "team, cycle, updated) plus optional description and labels. Use for a " +
    "single issue, or right after creating one (set justCreated: true).",
  // Status/priority-driven left border: red=urgent, orange=high, green=done,
  // blue=in-progress, gray=canceled, else Linear purple.
  accentColor: (issue) => accentForIssue(issue),
  props: issueCardSchema,
  fallbackText({ identifier, title }) {
    return `${identifier} — ${title}`;
  },
  render(issue) {
    const blocks: KnownBlock[] = [
      {
        type: "header",
        text: {
          type: "plain_text",
          text: `${issue.justCreated ? "✅ " : `${stateUnicode(issue.state)} `}${issue.identifier}`,
          emoji: true,
        },
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: issue.url
            ? `<${issue.url}|*${issue.title}*>`
            : `*${issue.title}*`,
        },
      },
    ];

    if (issue.justCreated) {
      blocks.push({
        type: "context",
        elements: [{ type: "mrkdwn", text: ":sparkles: Filed in Linear" }],
      });
    }

    const prio = priorityShortcode(issue.priority);
    const fields = [
      field("Status", `${stateShortcode(issue.state)} ${issue.state ?? "—"}`),
      field("Assignee", issue.assignee ?? "_unassigned_"),
      issue.priority
        ? field("Priority", `${prio ? `${prio} ` : ""}${issue.priority}`)
        : undefined,
      issue.team ? field("Team", issue.team) : undefined,
      issue.cycle ? field("Cycle", issue.cycle) : undefined,
      issue.updated ? field("Updated", issue.updated) : undefined,
    ].filter((f): f is NonNullable<typeof f> => Boolean(f));
    // section `fields` allows at most 10; we never exceed that here.
    blocks.push({ type: "section", fields });

    if (issue.description) {
      const trimmed =
        issue.description.length > 600
          ? `${issue.description.slice(0, 600)}…`
          : issue.description;
      blocks.push({ type: "divider" });
      blocks.push({
        type: "section",
        text: { type: "mrkdwn", text: trimmed },
      });
    }

    const footer: string[] = [];
    if (issue.labels?.length) {
      footer.push(`:label: ${issue.labels.join("  ")}`);
    }
    if (issue.url) footer.push(`<${issue.url}|Open in Linear →>`);
    if (footer.length) {
      blocks.push({
        type: "context",
        elements: [{ type: "mrkdwn", text: footer.join("   ·   ") }],
      });
    }

    return blocks;
  },
});
