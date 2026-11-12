import { resolveLivePage } from "@/lib/live-docs";
import { searchEntries } from "./live-inventory";
import { renderLivePageMarkdown } from "./page-markdown";

// Page lookups for agents reading the site through tools (`/api/mcp`): every
// page with its URL, and one page as Markdown.

/** Every page, one per line: `- [Title](/url): description`. */
export async function listPages(): Promise<string> {
  const live = searchEntries().map(({ url, live }) => {
    const { title, description } = live.page.data;
    return `- [${title}](${url})${description ? `: ${description}` : ""}`;
  });
  return live.join("\n");
}

/**
 * A page as Markdown, or null. Takes `/mastra/x`, `/mastra/x.md`,
 * `/mastra/x#section`, or a full URL; framework- and frontend-scoped URLs
 * resolve as they do on the site.
 */
export async function getPageMarkdown(url: string): Promise<string | null> {
  let pathname: string;
  try {
    pathname = new URL(url, "http://docs.local").pathname;
  } catch {
    pathname = url;
  }
  pathname = pathname.replace(/\.mdx?$/, "");

  const path = pathname
    .split("/")
    .filter(Boolean)
    .map((segment) => {
      try {
        return decodeURIComponent(segment);
      } catch {
        return segment;
      }
    });
  const live = resolveLivePage(path);
  return live ? renderLivePageMarkdown(live, `/${path.join("/")}`) : null;
}
