/**
 * `page_list` — renders Notion page search results as a Block Kit card:
 * a header, then one row per page (📄 linked title + a greyed snippet and
 * optional last-edited), with dividers and a count footer.
 *
 * The agent searches Notion via MCP and passes the pages it wants to
 * surface; the Slack formatting lives here.
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
  editedBy: z.string().optional().describe("Who last edited it, if known."),
  edited: z
    .string()
    .optional()
    .describe("Human-readable last-edited, e.g. '3d ago'."),
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
    "Render a list of Notion pages as a Block Kit card — a header plus one " +
    "row per page (linked title, a snippet, and optional last-edited). Use " +
    "this whenever you're showing the user pages you found in Notion instead " +
    "of writing them out as prose.",
  // Notion-dark left border so the card reads as "Notion".
  accentColor: "#2F3437",
  props: pageListSchema,
  fallbackText({ heading, pages }) {
    return `${heading ?? "Notion pages"} (${pages.length})`;
  },
  render({ heading, pages }) {
    const blocks: KnownBlock[] = [
      {
        type: "header",
        text: {
          type: "plain_text",
          text: `📚  ${heading ?? "Notion pages"}`,
          emoji: true,
        },
      },
    ];

    pages.forEach((page, i) => {
      const titleLink = page.url
        ? `<${page.url}|*${page.title}*>`
        : `*${page.title}*`;
      blocks.push({
        type: "section",
        text: { type: "mrkdwn", text: `:page_facing_up:  ${titleLink}` },
      });

      const meta = [
        page.snippet,
        page.edited
          ? `:clock3: edited ${page.edited}${page.editedBy ? ` by ${page.editedBy}` : ""}`
          : null,
      ]
        .filter(Boolean)
        .join("\n");
      if (meta) {
        blocks.push({
          type: "context",
          elements: [{ type: "mrkdwn", text: meta }],
        });
      }

      if (i < pages.length - 1) blocks.push({ type: "divider" });
    });

    blocks.push({
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: `${pages.length} page${pages.length === 1 ? "" : "s"}`,
        },
      ],
    });

    return blocks;
  },
});
