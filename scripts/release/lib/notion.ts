import https from "https";

/**
 * Notion API helper for release notes management.
 *
 * Creates a draft release notes page under the configured parent page.
 * On merge, reads the (potentially edited) page content back for the
 * GitHub Release body.
 *
 * Required env vars:
 *   NOTION_API_KEY              — Notion internal integration token
 *   NOTION_RELEASE_NOTES_PAGE   — Parent page ID for release note drafts
 */

const NOTION_API_VERSION = "2022-06-28";

function notionRequest(
  apiKey: string,
  method: string,
  path: string,
  body?: unknown,
): Promise<any> {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: "api.notion.com",
      path,
      method,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "Notion-Version": NOTION_API_VERSION,
      },
    };

    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (chunk: string) => (data += chunk));
      res.on("end", () => {
        const parsed = JSON.parse(data);
        if (res.statusCode && res.statusCode >= 400) {
          reject(
            new Error(
              `Notion API ${res.statusCode}: ${parsed.message || data}`,
            ),
          );
        } else {
          resolve(parsed);
        }
      });
    });

    req.on("error", reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

/** Convert a markdown string into Notion block children (simplified). */
function markdownToBlocks(markdown: string): any[] {
  const blocks: any[] = [];
  const lines = markdown.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (line.startsWith("### ")) {
      blocks.push({
        object: "block",
        type: "heading_3",
        heading_3: {
          rich_text: [{ type: "text", text: { content: line.slice(4) } }],
        },
      });
    } else if (line.startsWith("## ")) {
      blocks.push({
        object: "block",
        type: "heading_2",
        heading_2: {
          rich_text: [{ type: "text", text: { content: line.slice(3) } }],
        },
      });
    } else if (line.startsWith("- ")) {
      blocks.push({
        object: "block",
        type: "bulleted_list_item",
        bulleted_list_item: {
          rich_text: [{ type: "text", text: { content: line.slice(2) } }],
        },
      });
    } else if (line.trim() === "") {
      continue;
    } else {
      blocks.push({
        object: "block",
        type: "paragraph",
        paragraph: {
          rich_text: [{ type: "text", text: { content: line } }],
        },
      });
    }
  }

  return blocks;
}

/** Convert Notion blocks back to markdown. */
function blocksToMarkdown(blocks: any[]): string {
  const lines: string[] = [];

  for (const block of blocks) {
    const richText =
      block[block.type]?.rich_text
        ?.map((t: any) => t.plain_text || "")
        .join("") || "";

    switch (block.type) {
      case "heading_1":
        lines.push(`# ${richText}`);
        break;
      case "heading_2":
        lines.push(`## ${richText}`);
        break;
      case "heading_3":
        lines.push(`### ${richText}`);
        break;
      case "bulleted_list_item":
        lines.push(`- ${richText}`);
        break;
      case "numbered_list_item":
        lines.push(`1. ${richText}`);
        break;
      case "paragraph":
        lines.push(richText || "");
        break;
      case "divider":
        lines.push("---");
        break;
      default:
        if (richText) lines.push(richText);
    }
  }

  return lines.join("\n");
}

/**
 * Create a Notion page with release notes content.
 * Returns { pageId, url }.
 */
export async function createReleaseDraft(
  version: string,
  markdownContent: string,
): Promise<{ pageId: string; url: string }> {
  const apiKey = process.env.NOTION_API_KEY;
  const parentPageId = process.env.NOTION_RELEASE_NOTES_PAGE;

  if (!apiKey || !parentPageId) {
    throw new Error("NOTION_API_KEY and NOTION_RELEASE_NOTES_PAGE must be set");
  }

  const blocks = markdownToBlocks(markdownContent);

  const page = await notionRequest(apiKey, "POST", "/v1/pages", {
    parent: { page_id: parentPageId },
    properties: {
      title: {
        title: [{ text: { content: `v${version} Release Notes (Draft)` } }],
      },
    },
    children: blocks,
  });

  return {
    pageId: page.id,
    url: page.url,
  };
}

/**
 * Read a Notion page's content back as markdown.
 * Used on merge to get the (potentially human-edited) release notes.
 */
export async function readReleaseDraft(pageId: string): Promise<string> {
  const apiKey = process.env.NOTION_API_KEY;
  if (!apiKey) {
    throw new Error("NOTION_API_KEY must be set");
  }

  const response = await notionRequest(
    apiKey,
    "GET",
    `/v1/blocks/${pageId}/children?page_size=100`,
  );

  return blocksToMarkdown(response.results);
}
