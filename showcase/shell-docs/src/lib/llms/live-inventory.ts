import { statSync } from "node:fs";
import {
  getFrameworkVariants,
  getSetupContent,
} from "@/components/docs-mdx/data";
import { getPageIndex, livePages } from "@/lib/live-docs";
import type { ResolvedLivePage } from "@/lib/live-docs";
import { whereIs } from "@/lib/live-pages";
import { findSeoRedirect } from "@/lib/redirects/seo-redirects";
import type { FrontendId } from "@/proto/data";

// Which live URLs each machine-facing surface lists. They all list the same
// thing: every page once, at its canonical URL (`livePages()` in
// `src/lib/live-docs.ts`), so the sitemap, llms.txt, search, and the MCP
// server never offer the same page under a second URL.
//
//   sitemapEntries()   /sitemap.xml
//   llmsFullEntries()  /llms-full.txt
//   searchEntries()    Cmd-K search and /api/mcp, each tagged with the
//                      frontends whose readers have the page

export interface LiveEntry {
  /** Public path, `/mastra/background-tasks`. */
  url: string;
  live: ResolvedLivePage;
}

/** Pages behind an early-access gate stay out of the aggregates. */
const EARLY_ACCESS_GATES = new Set(["trajectories"]);

function isEarlyAccess(page: { data: object }): boolean {
  const gate = (page.data as { earlyAccess?: unknown }).earlyAccess;
  return typeof gate === "string" && EARLY_ACCESS_GATES.has(gate);
}

/** Every page at its canonical URL that the proxy doesn't redirect. */
function entries(): LiveEntry[] {
  return livePages()
    .filter((live) => !findSeoRedirect(live.canonical))
    .map((live) => ({ url: live.canonical, live }))
    .sort((a, b) => a.url.localeCompare(b.url));
}

/**
 * The pages `/llms-full.txt` concatenates, sorted by URL: each page's text
 * once, so a shared page's framework versions are left out.
 */
export function llmsFullEntries(): LiveEntry[] {
  return entries().filter(
    ({ live }) => !live.overview && !live.variant && !isEarlyAccess(live.page),
  );
}

export interface SitemapEntry {
  url: string;
  lastModified: Date;
}

/** The home page and every page at its canonical URL. */
export function sitemapEntries(): SitemapEntry[] {
  const now = new Date();
  return [
    { url: "/", lastModified: now },
    ...entries().map(({ url, live }) => ({
      url,
      lastModified: lastModified(live.page) ?? now,
    })),
  ];
}

const APP_FRONTENDS: FrontendId[] = ["react", "vue", "angular", "react-native"];
const ALL_FRONTENDS: FrontendId[] = [...APP_FRONTENDS, "slack", "teams"];

/** Each reference SDK's readers. */
const REFERENCE_FRONTENDS: Record<string, FrontendId[]> = {
  v2: ["react"],
  v1: ["react"],
  vue: ["vue"],
  angular: ["angular"],
  "react-native": ["react-native"],
  channels: ["slack", "teams"],
};

/** The frontends whose readers have a page: its search tags. */
function frontendsOf({ live, url }: LiveEntry): FrontendId[] {
  const path = live.contentPath;
  if (path.startsWith("reference/")) {
    return REFERENCE_FRONTENDS[url.split("/")[2]] ?? ALL_FRONTENDS;
  }
  const frontend = path.match(/^docs\/frontends\/([^/.]+)/)?.[1];
  if (frontend) return [frontend as FrontendId];
  if (path.startsWith("docs/channels/")) {
    return [url.split("/")[1] as FrontendId];
  }
  // A framework's quickstart builds a React app; its other pages are about
  // the agent, which every frontend connects to.
  if (/^docs\/integrations\/[^/]+\/quickstart\.mdx$/.test(path)) {
    return ["react"];
  }
  if (
    path.startsWith("docs/(shared)/") ||
    path.startsWith("docs/integrations/")
  ) {
    return ALL_FRONTENDS;
  }
  return ["react"];
}

/**
 * Every page once, at its canonical URL, with the frontends that have it. A
 * shared page's framework versions repeat its text, so search lists the page
 * once; the framework's own setup text is indexed on its own
 * (`frameworkSetupEntries`).
 */
export function searchEntries(): (LiveEntry & { frontends: FrontendId[] })[] {
  return entries()
    .filter(
      ({ live }) =>
        !live.overview && !live.variant && !isEarlyAccess(live.page),
    )
    .map((entry) => ({ ...entry, frontends: frontendsOf(entry) }));
}

/** The frontends a framework's version of a shared page opens on. */
function variantFrontends(framework: string, slug: string): FrontendId[] {
  const index = getPageIndex();
  return ALL_FRONTENDS.filter((fe) => whereIs(index, fe, framework, slug));
}

export interface FrameworkSetupEntry {
  /** `/crewai-crews/shared-state`, the framework's version of the page. */
  url: string;
  live: ResolvedLivePage;
  framework: string;
  /** The framework's setup text the page renders, as MDX. */
  sources: string[];
  frontends: FrontendId[];
}

/**
 * Each framework's setup steps on each shared page that shows them
 * (`<FrameworkSetup concept>`), so a search for a framework's own API or
 * caveat ("CopilotKitState context") finds that framework's version of the
 * page, which the page's own text doesn't mention.
 */
export function frameworkSetupEntries(): FrameworkSetupEntry[] {
  const { concepts } = getFrameworkVariants();
  const setup = getSetupContent().concepts;
  return entries().flatMap(({ url, live }) => {
    if (!live.variant || isEarlyAccess(live.page)) return [];
    const slug = url.split("/").slice(2).join("/");
    const sources = (concepts[slug] ?? []).flatMap((concept) => {
      const source = setup[`${live.variant}::${concept}`]?.source;
      return source ? [source] : [];
    });
    if (!sources.length) return [];
    return [
      {
        url,
        live,
        framework: live.variant,
        sources,
        frontends: variantFrontends(live.variant, slug),
      },
    ];
  });
}

/** Frontmatter `lastmod`, else the file's mtime. */
function lastModified(page: {
  data: object;
  absolutePath?: string;
}): Date | undefined {
  const lastmod = (page.data as { lastmod?: unknown }).lastmod;
  if (lastmod instanceof Date || typeof lastmod === "string") {
    const date = new Date(lastmod);
    if (!Number.isNaN(date.getTime())) return date;
  }
  if (!page.absolutePath) return undefined;
  try {
    return statSync(page.absolutePath).mtime;
  } catch {
    return undefined;
  }
}
