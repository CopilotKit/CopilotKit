/**
 * `page_list` — renders Notion page search results as a Block Kit card:
 * a header, then one row per page (📄 linked title + a greyed snippet and
 * optional last-edited), with dividers and a count footer.
 *
 * The agent searches Notion via MCP and passes the pages it wants to
 * surface; the Slack formatting lives here.
 *
 * Authored with the `@copilotkit/bot-ui` JSX vocabulary.
 */
import { z } from "zod";
import {
  Context,
  Divider,
  Header,
  Message,
  Section,
  type BotNode,
} from "@copilotkit/bot-ui";
import { ACCENT } from "./_status.js";

const pageSchema = z.object({
  title: z.string().describe("Page title."),
  url: z.string().optional().describe("Link to the page in Notion."),
  snippet: z
    .string()
    .optional()
    .describe("A short excerpt or summary of the page."),
  editedBy: z.string().optional().describe("Who last edited it, if known."),
  edited: z
    .string()
    .optional()
    .describe("Human-readable last-edited, e.g. '3d ago'."),
});

export const pageListSchema = z.object({
  heading: z
    .string()
    .optional()
    .describe("Optional heading, e.g. 'Runbooks matching “auth outage”'."),
  pages: z.array(pageSchema).min(1).describe("The pages to render."),
});

export type PageListProps = z.infer<typeof pageListSchema>;
type Page = z.infer<typeof pageSchema>;

/** Render a list of Notion pages as a Block Kit card. */
export function PageList({ heading, pages }: PageListProps): BotNode {
  const rows: BotNode[] = [];
  pages.forEach((page: Page, i: number) => {
    const titleLink = page.url
      ? `[**${page.title}**](${page.url})`
      : `**${page.title}**`;

    const meta = [
      page.snippet,
      page.edited
        ? `:clock3: edited ${page.edited}${page.editedBy ? ` by ${page.editedBy}` : ""}`
        : null,
    ]
      .filter(Boolean)
      .join("\n");

    rows.push(<Section>{`:page_facing_up:  ${titleLink}`}</Section>);
    if (meta) rows.push(<Context>{meta}</Context>);
    if (i < pages.length - 1) rows.push(<Divider />);
  });

  return (
    <Message accent={ACCENT.notion}>
      <Header>{`📚  ${heading ?? "Notion pages"}`}</Header>
      {rows}
      <Context>{`${pages.length} page${pages.length === 1 ? "" : "s"}`}</Context>
    </Message>
  );
}
