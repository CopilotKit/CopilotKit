import { resolveLivePage } from "@/lib/live-docs";
import { earlyAccessChannel } from "@/lib/early-access/channels";
import {
  channelPageMarkdown,
  channelPageSearchText,
} from "@/lib/early-access/markdown";
import {
  earlyAccessEntries,
  entryTitle,
  searchEntries,
} from "./live-inventory";
import { renderLivePageMarkdown } from "./page-markdown";

// Page lookups for agents reading the site through tools (`/api/mcp`): every
// page with its URL, and one page as Markdown. Search finds the early-access
// channels' landing pages (`/whatsapp`) too, so these read them as well.

/** Every page, one per line: `- [Title](/url): description`. */
export async function listPages(): Promise<string> {
  const live = searchEntries().map(({ url, live }) => {
    const title = entryTitle(live);
    const description = live.overview?.subheader ?? live.page.data.description;
    return `- [${title}](${url})${description ? `: ${description}` : ""}`;
  });
  const channels = earlyAccessEntries().map(({ url, id }) => {
    const { title, description } = channelPageSearchText(id);
    return `- [${title}](${url}): ${description}`;
  });
  return [...live, ...channels].join("\n");
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
  const channel = path.length === 1 ? earlyAccessChannel(path[0]) : undefined;
  if (channel) return channelPageMarkdown(channel.id);
  const live = resolveLivePage(path);
  return live ? renderLivePageMarkdown(live, `/${path.join("/")}`) : null;
}
