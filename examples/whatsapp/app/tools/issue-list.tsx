/**
 * `issue_list` — render several Linear issues as a concise text list.
 *
 * WhatsApp has no rich cards, tables, or clickable Markdown links, so the
 * issues are laid out as a `Section` of `Markdown` lines (`*bold*` title +
 * state, with the URL as plain text). Keep the list short — long messages
 * are split by the platform.
 */
import { z } from "zod";
import { Message, Header, Section } from "@copilotkit/bot-ui";
import { defineBotTool } from "@copilotkit/bot";

const issueListSchema = z.object({
  heading: z
    .string()
    .optional()
    .describe("Optional list heading, e.g. 'Open CPK issues'."),
  issues: z
    .array(
      z.object({
        id: z.string().describe("Issue identifier, e.g. 'CPK-123'."),
        title: z.string().describe("Issue title."),
        state: z
          .string()
          .optional()
          .describe("Workflow state, e.g. 'In Progress'."),
        url: z.string().optional().describe("Link to the issue (plain text)."),
      }),
    )
    .min(1)
    .describe("The issues to list."),
});

type IssueListProps = z.infer<typeof issueListSchema>;

export function IssueList({ heading, issues }: IssueListProps) {
  // One line per issue. WhatsApp renders `*text*` as bold and shows URLs as
  // tappable plain text; there are no real Markdown links.
  const lines = issues.map((i) => {
    const parts = [`**${i.id}** — ${i.title}`];
    if (i.state) parts.push(`(${i.state})`);
    if (i.url) parts.push(i.url);
    return parts.join("  ");
  });
  return (
    <Message>
      {heading ? <Header>{heading}</Header> : null}
      <Section>{lines.join("\n")}</Section>
    </Message>
  );
}

export const issueListTool = defineBotTool({
  name: "issue_list",
  description:
    "Render several Linear issues as a concise WhatsApp text list. Pass an " +
    "optional heading and an array of issues (id, title, optional state, " +
    "optional url). Use this whenever your answer is a set of issues — never " +
    "restate them as prose afterward.",
  parameters: issueListSchema,
  async handler(props, { thread }) {
    await thread.post(<IssueList {...props} />);
    return "Displayed the issue list to the user.";
  },
});
