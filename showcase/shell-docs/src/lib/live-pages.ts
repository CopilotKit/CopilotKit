import type { FrontendId } from "@/proto/data";
import {
  FRONTEND_FOLDERS,
  LIVE_FRAMEWORKS,
  ROOT_FRAMEWORK,
} from "./live-scope";

/**
 * Which page a URL opens, decided the same way on the server (the page route,
 * sitemap, search) and in the browser (the sidebar, the stack picker). Pure
 * data, so the layout can ship it to the client.
 *
 * A reader's page is looked up, in order, in:
 *
 *   1. their frontend's own folders (`frontends/vue`; Slack's
 *      `frontends/slack`, then the `channels` guide it shares with Teams);
 *   2. their framework's own pages (`integrations/mastra`);
 *   3. on React, the pages at the content root;
 *   4. the shared pages every frontend has (`docs/(shared)`).
 *
 * A page that documents a showcase feature (`snippet_cell` frontmatter)
 * doesn't exist for a framework whose showcase manifest lists that feature
 * in `not_supported_features`. That's the only filter.
 */
export interface PageIndex {
  /** Slugs (`""` is a folder's index) per folder: frontend folders and `integrations/<folder>`. */
  folders: Record<string, string[]>;
  /** Pages at the content root, React's. */
  react: string[];
  /** Pages in `docs/(shared)`, by slug (the route group isn't in URLs). */
  shared: string[];
  /** Per framework slug, the root and shared slugs it has no page for. */
  unsupported: Record<string, string[]>;
}

export type PageLocation =
  | { kind: "frontend"; folder: string; slug: string }
  | { kind: "framework"; folder: string; slug: string }
  | { kind: "react"; slug: string }
  | { kind: "shared"; slug: string };

/**
 * Marks a sidebar row that came from a meta.json link
 * (`[Overview](/channels)`): the row keeps the title the link gives it.
 */
export const LINK_ROW = "link";

/** First segments that are folders, never pages, in any scope. */
const RESERVED = new Set(["frontends", "channels", "integrations"]);

/**
 * Where `slug` lives for a reader on `frontend` and `framework` (the URL's,
 * else the built-in agent), or null when it doesn't exist for them. On a
 * frontend other than React, `quickstart` is the frontend's own root page.
 */
export function whereIs(
  index: PageIndex,
  frontend: FrontendId,
  framework: string | null,
  slug: string,
): PageLocation | null {
  if (RESERVED.has(slug.split("/")[0])) return null;
  const has = (folder: string, s: string) =>
    index.folders[folder]?.includes(s) ?? false;
  for (const folder of FRONTEND_FOLDERS[frontend]) {
    const own = slug === "quickstart" && !has(folder, slug) ? "" : slug;
    if (has(folder, own)) return { kind: "frontend", folder, slug: own };
  }
  const fw = framework ?? ROOT_FRAMEWORK;
  const fwFolder = LIVE_FRAMEWORKS[fw]?.folder;
  // A framework's index is its landing, which the URL `/mastra` opens.
  if (slug && fwFolder && has(`integrations/${fwFolder}`, slug)) {
    return { kind: "framework", folder: `integrations/${fwFolder}`, slug };
  }
  if (!slug || index.unsupported[fw]?.includes(slug)) return null;
  if (frontend === "react" && index.react.includes(slug)) {
    return { kind: "react", slug };
  }
  if (index.shared.includes(slug)) return { kind: "shared", slug };
  return null;
}
