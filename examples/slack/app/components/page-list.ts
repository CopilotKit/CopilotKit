/**
 * `page_list` — renders Notion page search results as a Block Kit card.
 *
 * The agent searches Notion via MCP, then calls this with the pages it
 * wants to surface. Same split as `issue_list`: the agent produces data,
 * the Slack formatting lives here.
 */
import { z } from "zod";
import { defineSlackComponent } from "@copilotkit/slack";
import type { KnownBlock } from "@slack/types";

const pageSchema = z.object({
  title: z.string().describe("Page title."),
  url: z.string().optional().describe("Link to the page in Notion."),
  snippet: z
    .string()
    .optional()
    .describe("A short excerpt or summary of the page."),
});

const pageListSchema = z.object({
  heading: z
    .string()
    .optional()
    .describe("Optional heading, e.g. 'Runbooks matching “auth outage”'."),
  pages: z.array(pageSchema).min(1).describe("The pages to render."),
});

export const pageListComponent = defineSlackComponent({
  name: "page_list",
  description:
    "Render a list of Notion pages as a Block Kit card (title as a link plus " +
    "an optional snippet). Use this whenever you're showing the user pages you " +
    "found in Notion instead of writing them out as prose.",
  props: pageListSchema,
  fallbackText({ heading, pages }) {
    return `${heading ?? "Notion pages"} (${pages.length})`;
  },
  render({ heading, pages }) {
    const blocks: KnownBlock[] = [];

    if (heading) {
      blocks.push({
        type: "section",
        text: { type: "mrkdwn", text: `:books:  *${heading}*` },
      });
      blocks.push({ type: "divider" });
    }

    for (const page of pages) {
      const titleLink = page.url
        ? `<${page.url}|${page.title}>`
        : `*${page.title}*`;
      blocks.push({
        type: "section",
        text: { type: "mrkdwn", text: `:page_facing_up:  ${titleLink}` },
      });
      if (page.snippet) {
        blocks.push({
          type: "context",
          elements: [{ type: "mrkdwn", text: page.snippet }],
        });
      }
    }

    return blocks;
  },
});
