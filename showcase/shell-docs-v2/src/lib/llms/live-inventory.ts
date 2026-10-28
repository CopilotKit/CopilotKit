import { readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import {
  getDocsFolder,
  getDocsMode,
  getIntegrations,
  ROOT_FRAMEWORK,
} from "@/components/docs-mdx/data";
import { resolveLivePage, type ResolvedLivePage } from "@/lib/live-docs";
import {
  LIVE_FRONTENDS,
  REFERENCE_FOLDERS,
  REFERENCE_ROOT_VERSION,
} from "@/lib/live-scope";
import { liveSource, referenceSource } from "@/lib/live-source";
import { findSeoRedirect } from "@/lib/redirects/seo-redirects";

// Which live URLs each machine-facing surface lists, ported from shell-docs:
//
//   llmsFullEntries()  `getAllLlmPages({ channelGuideVariants: "content-unique" })`
//                      in its src/lib/llm-text.ts (/llms-full.txt)
//   sitemapEntries()   its src/app/sitemap.ts
//   searchEntries()    one unscoped URL per page (Cmd-K search, /api/mcp)
//
// Each list is built from the content the way shell-docs built it, then kept
// to the URLs this app actually serves: `resolveLivePage()` must resolve the
// URL, and (except in llms-full.txt) the proxy's legacy table must not
// redirect it. So a URL family the resolver doesn't cover yet drops out here
// rather than listing a 404.

export interface LiveEntry {
  /** Public path, `/mastra/frontend-tools`. */
  url: string;
  live: ResolvedLivePage;
}

type LivePage = ReturnType<typeof liveSource.getPages>[number];

const CHANNELS = ["slack", "teams"] as const;

/** shell-docs' CHANNEL_GUIDE_ROUTES: public slug → source page. */
const CHANNEL_GUIDES: readonly (readonly [string, string])[] = [
  ["overview", "channels"],
  ["intelligence", "channels/intelligence"],
  ["tools", "channels/tools"],
  ["identity-and-memory", "channels/identity-and-memory"],
  ["rich-messages", "channels/rich-messages"],
  ["posting-jsx-as-images", "channels/posting-jsx-as-images"],
  ["render-and-carousel", "channels/render-and-carousel"],
  ["interactive", "channels/interactive"],
  ["commands-and-reactions", "channels/commands-and-reactions"],
  ["files-and-multimodality", "channels/files-and-multimodality"],
  ["threads-and-state", "channels/threads-and-state"],
  ["persistence-and-scaling", "channels/persistence-and-scaling"],
  ["history-and-transcripts", "channels/history-and-transcripts"],
  ["deploy-and-operate", "channels/deploy-and-operate"],
];
const CHANNEL_GUIDE_SOURCES = new Set(CHANNEL_GUIDES.map(([, source]) => source));

/** shell-docs' `channelGuideHref`: Built-in Agent collapses, `overview` is the channel root. */
function channelHref(channel: string, framework: string, slug: string) {
  return `/${[
    channel,
    framework === ROOT_FRAMEWORK ? "" : framework,
    slug === "overview" ? "" : slug,
  ]
    .filter(Boolean)
    .join("/")}`;
}

/** First segments that are never framework-scoped (shell-docs' `isGlobalDocsPath`). */
const GLOBAL_SEGMENTS = new Set(["channels"]);

/** shell-docs' early-access gates: these pages stay out of the aggregates. */
const EARLY_ACCESS_GATES = new Set(["trajectories"]);

/** Frameworks with published docs, in registry order (shell-docs' `getIntegrations()`). */
function visibleFrameworks(): string[] {
  return getIntegrations()
    .map((integration) => integration.slug)
    .filter((slug) => getDocsMode(slug) !== "hidden");
}

/** Non-React, non-channel frontends (shell-docs' `FRONTEND_PAGE_IDS` minus channels). */
function pageFrontends(): string[] {
  return Object.keys(LIVE_FRONTENDS).filter(
    (id) => !CHANNELS.includes(id as (typeof CHANNELS)[number]),
  );
}

const slugOf = (page: LivePage) => page.slugs.join("/");

function bareDocPages(): LivePage[] {
  return liveSource
    .getPages()
    .filter(
      (page) =>
        page.slugs.length > 0 &&
        page.slugs[0] !== "integrations" &&
        page.slugs[0] !== "frontends",
    );
}

/** A framework folder's pages, keyed by their path inside the folder ("" is its index). */
function folderPages(folder: string): Map<string, LivePage> {
  const out = new Map<string, LivePage>();
  for (const page of liveSource.getPages()) {
    const [head, own, ...tail] = page.slugs;
    if (head !== "integrations" || own !== folder) continue;
    // `x/index.mdx` beside `x.mdx` keeps its `index` slug; it's the same URL.
    const key = tail.join("/").replace(/(?:^|\/)index$/, "");
    if (!out.has(key)) out.set(key, page);
  }
  return out;
}

/** A frontend folder's own pages (`frontends/<frontend>/...`), keyed by tail. */
function frontendPages(frontend: string): Map<string, LivePage> {
  const out = new Map<string, LivePage>();
  for (const page of liveSource.getPages()) {
    const [head, own, ...tail] = page.slugs;
    if (head === "frontends" && own === frontend && tail.length) {
      out.set(tail.join("/"), page);
    }
  }
  return out;
}

/** A reference page's live URL: React's under `/reference/v2`, other SDKs under their folder. */
function referenceUrl(slugs: string[]): string {
  const path = REFERENCE_FOLDERS.has(slugs[0])
    ? slugs
    : [REFERENCE_ROOT_VERSION, ...slugs];
  return `/reference/${path.join("/")}`;
}

/**
 * Resolve a public path to a live page. `keepRedirected` keeps a page whose
 * URL the proxy's legacy table redirects: shell-docs' llms-full.txt still
 * carries those pages' text, while its sitemap shouldn't list a redirect.
 */
function resolveUrl(url: string, keepRedirected = false): LiveEntry | null {
  if (!keepRedirected && findSeoRedirect(url)) return null;
  const live = resolveLivePage(url.split("/").filter(Boolean));
  return live ? { url, live } : null;
}

function collect(urls: Iterable<string>, keepRedirected = false): LiveEntry[] {
  const seen = new Set<string>();
  const out: LiveEntry[] = [];
  for (const url of urls) {
    if (seen.has(url)) continue;
    seen.add(url);
    const entry = resolveUrl(url, keepRedirected);
    if (entry) out.push(entry);
  }
  return out;
}

function isEarlyAccess(page: { data: object }): boolean {
  const gate = (page.data as { earlyAccess?: unknown }).earlyAccess;
  return typeof gate === "string" && EARLY_ACCESS_GATES.has(gate);
}

// ---------------------------------------------------------------------------
// /llms-full.txt
// ---------------------------------------------------------------------------

/** shell-docs' `canonicalDocsUrl`, plus `/frontends/*`, which v2 redirects to `/<frontend>/*`. */
function canonicalBareUrl(slug: string): string | null {
  const match = slug.match(/^frontends\/([^/]+)(?:\/(.+))?$/);
  if (!match) return `/${slug}`;
  const [, frontend, tail] = match;
  // `frontends/docs-status` backs every frontend's `using-these-docs`.
  if (frontend === "docs-status") return null;
  if (!tail) return `/${frontend}`;
  return `/${frontend}/${tail === "docs-status" ? "using-these-docs" : tail}`;
}

/**
 * The pages `/llms-full.txt` concatenates, sorted by URL: every unscoped page,
 * each framework's own pages under its URL, Slack and Teams once per provider
 * (plus each framework's connection guide), and the API reference.
 */
export function llmsFullEntries(): LiveEntry[] {
  const urls: string[] = [];

  for (const page of liveSource.getPages()) {
    const slug = slugOf(page);
    if (!slug || page.slugs[0] === "integrations" || isEarlyAccess(page)) {
      continue;
    }
    if (slug === "frontends/slack" || slug === "frontends/teams") continue;
    if (CHANNEL_GUIDE_SOURCES.has(slug) || slug === ROOT_FRAMEWORK) continue;
    const url = canonicalBareUrl(slug);
    if (url) urls.push(url);
  }

  const frameworks = visibleFrameworks();
  for (const framework of frameworks) {
    const pages = folderPages(getDocsFolder(framework));
    const atRoot = framework === ROOT_FRAMEWORK;
    for (const [tail, page] of pages) {
      if (isEarlyAccess(page)) continue;
      if (atRoot) {
        if (tail) urls.push(`/${tail}`);
      } else {
        urls.push(tail ? `/${framework}/${tail}` : `/${framework}`);
      }
    }
  }

  for (const channel of CHANNELS) {
    for (const framework of frameworks) {
      urls.push(channelHref(channel, framework, "connect"));
    }
    for (const [slug] of CHANNEL_GUIDES) {
      urls.push(channelHref(channel, ROOT_FRAMEWORK, slug));
    }
  }

  for (const page of referenceSource.getPages()) {
    urls.push(referenceUrl(page.slugs));
  }

  return collect(urls, true).sort((a, b) => a.url.localeCompare(b.url));
}

// ---------------------------------------------------------------------------
// sitemap.xml
// ---------------------------------------------------------------------------

export interface SitemapEntry {
  url: string;
  lastModified: Date;
}

/**
 * shell-docs' sitemap: the home page, every unscoped page and its variant
 * under each framework, each framework's landing and own pages, the
 * frontends' landings and own pages, Angular's shared pages, the Slack and
 * Teams guides under every framework, and the API reference.
 */
export function sitemapEntries(): SitemapEntry[] {
  const urls: string[] = [];
  const frameworks = visibleFrameworks();
  const scoped = frameworks.filter((slug) => slug !== ROOT_FRAMEWORK);

  const bare = bareDocPages().filter(
    (page) => !CHANNEL_GUIDE_SOURCES.has(slugOf(page)),
  );
  const bareSlugs = new Set(bare.map(slugOf));
  for (const page of bare) {
    const slug = slugOf(page);
    // `/built-in-agent` redirects to `/`.
    if (slug !== ROOT_FRAMEWORK) urls.push(`/${slug}`);
    if (GLOBAL_SEGMENTS.has(page.slugs[0])) continue;
    for (const framework of scoped) urls.push(`/${framework}/${slug}`);
  }

  for (const framework of scoped) {
    urls.push(`/${framework}`);
    for (const tail of folderPages(getDocsFolder(framework)).keys()) {
      if (tail && !GLOBAL_SEGMENTS.has(tail.split("/")[0])) {
        urls.push(`/${framework}/${tail}`);
      }
    }
  }

  // The built-in agent's own pages are served unscoped.
  for (const tail of folderPages(getDocsFolder(ROOT_FRAMEWORK)).keys()) {
    if (tail && !bareSlugs.has(tail)) urls.push(`/${tail}`);
  }

  for (const frontend of pageFrontends()) {
    urls.push(`/${frontend}`, `/${frontend}/using-these-docs`);
    for (const tail of frontendPages(frontend).keys()) {
      urls.push(`/${frontend}/${tail === "docs-status" ? "using-these-docs" : tail}`);
    }
  }

  // Angular publishes the shared pages it supports once under /angular, and
  // each backend's landing and quickstart under /angular/<framework>. An
  // approximation: shell-docs derived this set from its Angular sidebar
  // (`getAngularDocsNavTree`), which also lists a few backend-only pages.
  for (const page of bare) {
    if (isUniversal(page)) urls.push(`/angular/${slugOf(page)}`);
  }
  for (const framework of scoped) {
    urls.push(`/angular/${framework}`, `/angular/${framework}/quickstart`);
  }

  for (const channel of CHANNELS) {
    for (const framework of frameworks) {
      urls.push(channelHref(channel, framework, "connect"));
      for (const [slug] of CHANNEL_GUIDES) {
        urls.push(channelHref(channel, framework, slug));
      }
    }
  }

  // shell-docs lists the reference by file path: `/reference/hooks/useAgent`.
  urls.push("/reference");
  for (const page of referenceSource.getPages()) {
    if (page.slugs.length) urls.push(`/reference/${page.slugs.join("/")}`);
  }

  const now = new Date();
  return [
    { url: "/", lastModified: now },
    ...collect(urls).map(({ url, live }) => ({
      url,
      lastModified: lastModified(live.page) ?? now,
    })),
  ];
}

/** Frontmatter `lastmod`, else the file's mtime (shell-docs' `resolveLastModified`). */
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

const metaPolicyCache = new Map<string, string | null>();

/**
 * Whether a page is "universal" under shell-docs' frontend doc policy:
 * frontmatter `frontend: universal`, else the nearest folder `meta.json`
 * that sets one. Only the page schema keeps `frontend`, so folders are read
 * from disk.
 */
function isUniversal(page: LivePage): boolean {
  const own = policyKind((page.data as { frontend?: unknown }).frontend);
  if (own) return own === "universal";
  if (!page.absolutePath) return false;
  // fumadocs-mdx's `absolutePath` is relative to the app.
  const root = join(process.cwd(), "content", "live", "docs");
  for (let dir = dirname(resolve(page.absolutePath)); dir.startsWith(root); ) {
    let kind = metaPolicyCache.get(dir);
    if (kind === undefined) {
      try {
        const meta = JSON.parse(readFileSync(join(dir, "meta.json"), "utf8"));
        kind = policyKind(meta.frontend);
      } catch {
        kind = null;
      }
      metaPolicyCache.set(dir, kind);
    }
    if (kind) return kind === "universal";
    if (dir === root) break;
    dir = dirname(dir);
  }
  return false;
}

function policyKind(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && "kind" in value) {
    return typeof value.kind === "string" ? value.kind : null;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Search and MCP
// ---------------------------------------------------------------------------

/**
 * Every live page once, at an unscoped URL that serves it: unscoped pages at
 * their own URL, a framework's own pages under its first framework slug, a
 * frontend's under `/<frontend>`, and the reference under its versioned URL.
 * A page whose URL resolves to a different page (a generated framework's
 * copy of an unscoped topic) is left out: readers never see it.
 */
export function searchEntries(): LiveEntry[] {
  const frameworkByFolder = new Map<string, string>();
  for (const framework of visibleFrameworks()) {
    const folder = getDocsFolder(framework);
    if (!frameworkByFolder.has(folder)) frameworkByFolder.set(folder, framework);
  }

  const out: LiveEntry[] = [];
  const seen = new Set<string>();
  /** Keep `url` when it serves the page at `contentPath`. */
  const add = (url: string | null, contentPath: string) => {
    if (!url || seen.has(url)) return;
    const entry = resolveUrl(url);
    if (!entry || entry.live.contentPath !== contentPath) return;
    seen.add(url);
    out.push(entry);
  };

  for (const page of liveSource.getPages()) {
    if (isEarlyAccess(page)) continue;
    const contentPath = `docs/${page.path}`;
    const [head, folder, ...tail] = page.slugs;
    if (head !== "integrations") {
      add(page.slugs.length ? canonicalBareUrl(slugOf(page)) : null, contentPath);
      continue;
    }
    const framework = frameworkByFolder.get(folder);
    if (!framework) continue;
    const rest = tail.join("/");
    if (framework === ROOT_FRAMEWORK) add(rest ? `/${rest}` : null, contentPath);
    else add(rest ? `/${framework}/${rest}` : `/${framework}`, contentPath);
  }
  for (const page of referenceSource.getPages()) {
    add(referenceUrl(page.slugs), `reference/${page.path}`);
  }
  return out;
}
