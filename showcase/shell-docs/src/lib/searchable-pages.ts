/**
 * Which docs pages are allowed into the Cmd-K search index.
 *
 * Search used to be built by walking every `.mdx` file under
 * `src/content/docs`. The sidebar is built from curated `meta.json`
 * navigation plus the programmatic reorganization layer in
 * `docs-render.tsx`. The two drifted: search offered pages that appear in
 * no sidebar — leftovers from past reorganizations, with stale content and
 * no surrounding context.
 *
 * A slug is searchable when EITHER of these holds:
 *
 *   (a) It appears in a navigation surface. Navigation is not one tree, so
 *       this is the union over the root tree, every non-hidden
 *       integration's sidebar, and every `"root": true` sub-tree (which the
 *       root walk deliberately skips).
 *
 *   (b) A navigable page links to it, counting the snippets that page
 *       inlines as part of it — most CopilotKit pages are thin wrappers
 *       around shared snippets, and that is where the prose links live
 *       (`intelligence/overview.mdx` is nothing but `<Overview />`, whose
 *       snippet links to `intelligence/headless-ui`). One hop only, no
 *       transitive closure. A page kept out of the sidebar but linked from
 *       prose is intentional content, not a leftover.
 *
 * Frontmatter `search` is an explicit per-page override that wins over
 * both rules: `search: false` forces a page out even when it qualifies,
 * `search: true` forces a page in even when it does not. No page needs it
 * today — it is the escape hatch for a page that is deliberately in no
 * sidebar and that nothing links to either.
 *
 * Slugs are canonical: no leading slash, no `/docs` prefix, route-group
 * segments (`(other)`) stripped, and no trailing `/index`. Route groups
 * are stripped because the sidebar strips them too (`normalizeSidebarNav`)
 * and the middleware 301-redirects any URL that still carries one.
 *
 * This module has no side effects and no Next.js imports, so it is
 * directly unit-testable and importable from a `tsx` build script.
 */

import fs from "fs";
import path from "path";
import matter from "gray-matter";
import {
  CONTENT_DIR,
  buildFrameworkNav,
  buildFrameworkOnlyNav,
  buildNavTree,
  inlineSnippets,
  readMeta,
} from "./docs-render";
import type { NavNode } from "./docs-render";
import { getDocsFolder, getDocsMode, getIntegrations } from "./registry";
import { isRouteGroupSegment } from "./route-groups";

/**
 * One sidebar the docs app can actually render. `integrationFolder` is set
 * when the surface rewrote `integrations/<folder>/<topic>` slugs down to
 * bare `<topic>` — the folder form has to be recovered so entries stay
 * matchable against the on-disk slug the index generator produces.
 */
export interface NavigationSurface {
  /** Human-readable label, used only in diagnostics. */
  id: string;
  nodes: NavNode[];
  integrationFolder?: string;
  /**
   * The public first path segment this surface is served under
   * (`/langgraph-python/…`). Link targets in prose use this form, so it is
   * how a link is mapped back onto `integrationFolder`.
   */
  routeScope?: string;
}

export interface SearchablePagesInput {
  contentDir: string;
  surfaces: NavigationSurface[];
  /**
   * Read the source of one page as the reader sees it. Defaults to a plain
   * file read; `getSearchablePages` supplies a reader that also inlines the
   * page's snippets, because most of the prose that carries links lives in
   * shared snippets rather than in the page file itself.
   */
  readPageSource?: (filePath: string, slug: string) => string;
}

export interface SearchablePages {
  /** Canonical slugs allowed into the docs portion of the search index. */
  slugs: ReadonlySet<string>;
  /** Canonical slug → the title the sidebar shows for it. */
  navTitles: ReadonlyMap<string, string>;
  /** Diagnostics: which rule admitted each slug. */
  fromNavigation: ReadonlySet<string>;
  fromLinks: ReadonlySet<string>;
  forcedIn: ReadonlySet<string>;
  forcedOut: ReadonlySet<string>;
}

/** First path segments on the docs host that are never a docs page. */
const NON_DOCS_ROOT_SEGMENTS = new Set([
  "reference",
  "ag-ui",
  // The integrations explorer and feature matrix live on the showcase host.
  "integrations",
  "matrix",
  "api",
  "_next",
]);

/** Frontend surfaces are routed at `/<frontend>/<topic>`, like frameworks. */
const FRONTEND_SEGMENTS = ["vue", "react-native", "angular", "slack", "teams"];

/**
 * Sidebar titles that identify nothing once the surrounding group is gone.
 *
 * A page can set `nav_title: Overview` so the sidebar reads
 * "Rich Threads › Overview" while the page itself is titled "Rich Threads".
 * Search results are a flat list with no parent to lean on, so a bare
 * "Overview" row is useless — the page's own title is kept instead.
 */
const CONTEXT_ONLY_NAV_TITLES = new Set(["overview", "introduction", "index"]);

/** Whether a sidebar title is specific enough to name a search result. */
export function isUsableSearchTitle(title: string): boolean {
  return !CONTEXT_ONLY_NAV_TITLES.has(title.trim().toLowerCase());
}

/**
 * Canonicalize a docs slug: drop a leading `/docs` or `/`, strip
 * route-group segments, and collapse a trailing `/index` onto the folder.
 */
export function canonicalDocsSlug(slug: string): string {
  const withoutPrefix = slug
    .replace(/^\/?docs(?=\/|$)/, "")
    .replace(/^\/+/, "");
  const segments = withoutPrefix
    .split("/")
    .filter((segment) => segment.length > 0 && !isRouteGroupSegment(segment));
  if (segments[segments.length - 1] === "index") segments.pop();
  return segments.join("/");
}

/**
 * Map every slug spelling a caller might hold for an `.mdx` file onto that
 * file's canonical slug.
 *
 * The search-index generator lives in another package and cannot import
 * `canonicalDocsSlug` — see `scripts/emit-searchable-pages.ts` for why — so
 * it receives this mapping as data instead, and canonicalization stays
 * defined exactly once.
 *
 * Two keys per file, because callers name the same page either way: the
 * disk slug (`foo/index`) and the index-collapsed form (`foo`). Both point
 * at the same canonical value, so a lookup succeeds whichever the caller
 * happens to hold.
 */
export function buildCanonicalSlugMap(contentDir: string): Map<string, string> {
  const map = new Map<string, string>();
  if (!fs.existsSync(contentDir)) return map;

  const walk = (dir: string, prefix: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const child = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(child, prefix ? `${prefix}/${entry.name}` : entry.name);
        continue;
      }
      if (!entry.name.endsWith(".mdx")) continue;

      const base = entry.name.slice(0, -".mdx".length);
      const diskSlug = prefix ? `${prefix}/${base}` : base;
      const canonical = canonicalDocsSlug(diskSlug);
      if (!map.has(diskSlug)) map.set(diskSlug, canonical);

      if (base === "index") {
        // `foo/index.mdx` is served at `/foo`, and that is the spelling the
        // generator's own scan produces for it.
        const collapsed = prefix;
        if (collapsed && !map.has(collapsed)) map.set(collapsed, canonical);
      }
    }
  };

  walk(contentDir, "");
  return map;
}

/**
 * Map every `.mdx` file under `contentDir` to its canonical slug. Two disk
 * paths can canonicalize to the same slug only if the content tree is
 * broken (e.g. `(a)/x.mdx` and `x.mdx`); first walk order wins and the
 * duplicate is ignored, because the router would resolve only one anyway.
 */
export function buildDocsFileIndex(contentDir: string): Map<string, string> {
  const files = new Map<string, string>();
  if (!fs.existsSync(contentDir)) return files;

  const walk = (dir: string, prefix: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const child = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(child, prefix ? `${prefix}/${entry.name}` : entry.name);
      } else if (entry.name.endsWith(".mdx")) {
        const base = entry.name.slice(0, -".mdx".length);
        const diskSlug = prefix ? `${prefix}/${base}` : base;
        const slug = canonicalDocsSlug(diskSlug);
        if (!files.has(slug)) files.set(slug, child);
      }
    }
  };

  walk(contentDir, "");
  return files;
}

/**
 * Collect the slugs and sidebar titles a single navigation surface
 * contributes.
 *
 * Group nodes carry their own slug, which is frequently a real page (a
 * folder with an `index.mdx` rendered as an expandable parent), so they are
 * collected too — except synthetic ones, which use `<prefix>#<title>` as a
 * React reconciliation key rather than a URL.
 *
 * Page nodes that carry an `href` point off-site (for example the
 * Intelligence sidebar's marketing anchor) and contribute nothing: search
 * must never promise a docs page that does not exist.
 */
export function collectNavigationSlugs(
  surface: NavigationSurface,
  fileIndex: ReadonlyMap<string, string>,
): {
  slugs: Set<string>;
  /** Titles from `type: "page"` nodes — the page's own sidebar name. */
  pageTitles: Map<string, string>;
  /**
   * Titles from `type: "group"` nodes. A group title is structural
   * scaffolding and is often auto-derived from the folder name
   * ("Frontend-tools"), so it is only a fallback.
   */
  groupTitles: Map<string, string>;
} {
  const slugs = new Set<string>();
  const pageTitles = new Map<string, string>();
  const groupTitles = new Map<string, string>();

  const add = (rawSlug: string, title: string, kind: "page" | "group") => {
    if (rawSlug.includes("#")) return;
    const slug = canonicalDocsSlug(rawSlug);
    slugs.add(slug);
    const titles = kind === "page" ? pageTitles : groupTitles;
    if (!titles.has(slug) && title && isUsableSearchTitle(title)) {
      titles.set(slug, title);
    }

    // Framework surfaces rewrite `integrations/<folder>/<topic>` down to a
    // bare `<topic>`. Recover the folder form so the entry still matches
    // the on-disk slug, but only when that file actually exists — the bare
    // slug usually comes from the shared root tree instead.
    //
    // Reachability only: no title is recorded for the folder form. The bare
    // entry's title belongs to whichever file the framework actually
    // resolved, which for a generated framework is the shared root page,
    // not `integrations/<folder>/<topic>`. Titles for the folder form come
    // from that integration's own `"root": true` surface, which walks the
    // folder under its real prefix.
    const folder = surface.integrationFolder;
    if (!folder) return;
    const folderSlug = canonicalDocsSlug(
      slug ? `integrations/${folder}/${slug}` : `integrations/${folder}`,
    );
    if (fileIndex.has(folderSlug)) slugs.add(folderSlug);
  };

  const visit = (nodes: NavNode[]) => {
    for (const node of nodes) {
      if (node.type === "section") continue;
      if (node.type === "page") {
        if (node.href) continue;
        add(node.slug, node.title, "page");
        continue;
      }
      add(node.slug, node.title, "group");
      visit(node.children);
    }
  };

  visit(surface.nodes);
  return { slugs, pageTitles, groupTitles };
}

/**
 * Resolve an internal link target to every canonical docs slug it could
 * point at. Empty when the target is not a docs page.
 *
 * Docs pages are served bare (`/threads`) and framework- or
 * frontend-scoped (`/langgraph-python/threads`), so a leading scope
 * segment is stripped. A framework-scoped topic can be backed by either
 * the shared root page (`threads`) or that framework's own override
 * (`integrations/langgraph/threads`), and the URL does not say which — so
 * both candidates come back and the caller keeps whichever exists on disk.
 */
export function docsSlugCandidatesFromLinkTarget(
  target: string,
  folderForScope: (segment: string) => string | null,
): string[] {
  if (!target.startsWith("/")) return [];
  const withoutFragment = target.split("#")[0].split("?")[0];
  const segments = withoutFragment.split("/").filter(Boolean);
  if (segments.length === 0) return [];

  if (segments[0] === "docs") {
    return [canonicalDocsSlug(segments.slice(1).join("/"))];
  }

  const folder = folderForScope(segments[0]);
  if (folder !== null) {
    const topic = canonicalDocsSlug(segments.slice(1).join("/"));
    // A frontend scope (`/vue/…`) has no `integrations/` folder behind it.
    if (folder === "") return [topic];
    const scoped = canonicalDocsSlug(
      topic ? `integrations/${folder}/${topic}` : `integrations/${folder}`,
    );
    return [topic, scoped];
  }

  if (NON_DOCS_ROOT_SEGMENTS.has(segments[0])) return [];
  return [canonicalDocsSlug(segments.join("/"))];
}

// Stops at whitespace as well as `)` so a link that carries a title —
// `](/threads "Rich threads")` — still yields `/threads`.
const MARKDOWN_LINK = /\]\(\s*(\/[^)\s]*)/g;
const JSX_HREF = /href=["'](\/[^"']*)["']/g;

/** Every internal `/`-rooted link target in one MDX source. */
export function extractInternalLinkTargets(source: string): string[] {
  const targets: string[] = [];
  for (const pattern of [MARKDOWN_LINK, JSX_HREF]) {
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(source)) !== null) targets.push(match[1]);
  }
  return targets;
}

function readSearchOverride(filePath: string): boolean | null {
  let raw: string;
  try {
    raw = fs.readFileSync(filePath, "utf-8");
  } catch {
    return null;
  }
  let data: Record<string, unknown>;
  try {
    data = matter(raw).data as Record<string, unknown>;
  } catch {
    // A malformed frontmatter block is the content author's problem, not a
    // reason to crash the whole index build. Fall back to the default rules.
    return null;
  }
  const value = data.search;
  return typeof value === "boolean" ? value : null;
}

/**
 * The pure core: given a content tree and the navigation surfaces the app
 * can render, decide which slugs search is allowed to offer.
 */
export function computeSearchablePages(
  input: SearchablePagesInput,
): SearchablePages {
  const { contentDir, surfaces } = input;
  const readPageSource =
    input.readPageSource ?? ((filePath) => fs.readFileSync(filePath, "utf-8"));
  const fileIndex = buildDocsFileIndex(contentDir);

  // Rule (a): union over every navigation surface. Surfaces are consulted
  // in order and the first title wins, so the naming stays stable and does
  // not depend on which integration happens to be walked first.
  const fromNavigation = new Set<string>();
  const navPageTitles = new Map<string, string>();
  const navGroupTitles = new Map<string, string>();
  for (const surface of surfaces) {
    const { slugs, pageTitles, groupTitles } = collectNavigationSlugs(
      surface,
      fileIndex,
    );
    for (const slug of slugs) fromNavigation.add(slug);
    for (const [slug, title] of pageTitles) {
      if (!navPageTitles.has(slug)) navPageTitles.set(slug, title);
    }
    for (const [slug, title] of groupTitles) {
      if (!navGroupTitles.has(slug)) navGroupTitles.set(slug, title);
    }
  }
  const navTitles = new Map(navGroupTitles);
  for (const [slug, title] of navPageTitles) navTitles.set(slug, title);

  // Rule (b): one hop out from any navigable page.
  const scopeFolders = new Map<string, string>();
  for (const segment of FRONTEND_SEGMENTS) scopeFolders.set(segment, "");
  for (const surface of surfaces) {
    if (!surface.routeScope) continue;
    scopeFolders.set(surface.routeScope, surface.integrationFolder ?? "");
  }
  const folderForScope = (segment: string): string | null =>
    scopeFolders.get(segment) ?? null;

  const fromLinks = new Set<string>();
  for (const slug of fromNavigation) {
    const filePath = fileIndex.get(slug);
    if (!filePath) continue;
    let source: string;
    try {
      source = readPageSource(filePath, slug);
    } catch {
      continue;
    }
    for (const target of extractInternalLinkTargets(source)) {
      for (const linked of docsSlugCandidatesFromLinkTarget(
        target,
        folderForScope,
      )) {
        if (linked === "") continue;
        if (fromNavigation.has(linked)) continue;
        if (!fileIndex.has(linked)) continue;
        fromLinks.add(linked);
      }
    }
  }

  // Explicit per-page overrides win over both rules.
  const forcedIn = new Set<string>();
  const forcedOut = new Set<string>();
  for (const [slug, filePath] of fileIndex) {
    const override = readSearchOverride(filePath);
    if (override === true) forcedIn.add(slug);
    else if (override === false) forcedOut.add(slug);
  }

  const slugs = new Set<string>([...fromNavigation, ...fromLinks, ...forcedIn]);
  for (const slug of forcedOut) slugs.delete(slug);

  return { slugs, navTitles, fromNavigation, fromLinks, forcedIn, forcedOut };
}

/**
 * Build the navigation surfaces the docs app can actually render.
 *
 * Three kinds, and all three are needed — dropping any one of them removes
 * pages that a reader can reach from a real sidebar:
 *
 *   1. the root tree;
 *   2. every non-hidden integration, using the builder the app itself picks
 *      for that integration's `docs_mode`;
 *   3. every `"root": true` sub-tree, which the root walk skips by design
 *      (`if (subMeta?.root) continue`) because each is its own surface.
 */
export function defaultNavigationSurfaces(
  contentDir: string = CONTENT_DIR,
): NavigationSurface[] {
  const surfaces: NavigationSurface[] = [
    { id: "root", nodes: buildNavTree(contentDir) },
  ];

  for (const integration of getIntegrations()) {
    const mode = getDocsMode(integration.slug);
    if (mode === "hidden") continue;
    const folder = getDocsFolder(integration.slug);
    const nodes =
      mode === "authored"
        ? buildFrameworkOnlyNav(folder)
        : buildFrameworkNav(folder, integration.name, integration.slug);
    surfaces.push({
      id: `integration:${integration.slug}`,
      nodes,
      integrationFolder: folder,
      routeScope: integration.slug,
    });
  }

  for (const dir of findRootMetaDirs(contentDir)) {
    surfaces.push({
      id: `root-meta:${dir.slug}`,
      nodes: buildNavTree(dir.absolute, dir.slug),
    });
  }

  return surfaces;
}

/** Every directory below `contentDir` whose meta.json declares `root: true`. */
export function findRootMetaDirs(
  contentDir: string,
): Array<{ slug: string; absolute: string }> {
  const found: Array<{ slug: string; absolute: string }> = [];
  if (!fs.existsSync(contentDir)) return found;

  const walk = (dir: string, prefix: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const absolute = path.join(dir, entry.name);
      const slug = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (readMeta(absolute)?.root) found.push({ slug, absolute });
      walk(absolute, slug);
    }
  };

  walk(contentDir, "");
  return found.sort((a, b) => a.slug.localeCompare(b.slug));
}

/**
 * Read one page the way the reader receives it, with its snippets inlined.
 *
 * Most CopilotKit docs pages are thin wrappers around shared snippets —
 * `intelligence/overview.mdx` is nothing but `<Overview />` from
 * `@/snippets/shared/intelligence/overview.mdx` — and that snippet is
 * where the prose links live. Scanning only the page file sees none of
 * them, so rule (b) would miss links the reader can plainly click.
 *
 * `inlineSnippets` already owns this resolution: the `@/snippets/…` import
 * form, the `SNIPPET_MAP` component names, the `<SharedContent />`
 * indirection through `SUBPATH_TO_COMPONENT` (which needs the slug), and
 * transitive snippet-inside-snippet expansion with a visited set so a
 * cycle cannot hang the build.
 */
export function readPageSourceWithSnippets(
  filePath: string,
  slug: string,
): string {
  const raw = fs.readFileSync(filePath, "utf-8");
  // `inlineSnippets` warns when a `<Component />` maps to no snippet file.
  // Those are real React components from the global MDX registry, and the
  // docs build already reports them when it renders the page — repeating
  // them once per page here would bury the index build's own output and
  // train readers to ignore the warning. Link discovery does not care.
  const warn = console.warn;
  console.warn = () => {};
  try {
    return inlineSnippets(raw, slug);
  } catch (error) {
    // Never let one unresolvable snippet reference cost us the links that
    // are in the page file itself.
    warn(
      `[searchable-pages] Failed to inline snippets for "${slug}"; link discovery will use only the page source.`,
      error,
    );
    return raw;
  } finally {
    console.warn = warn;
  }
}

/** Convenience wrapper over the real content tree and the real registry. */
export function getSearchablePages(
  contentDir: string = CONTENT_DIR,
): SearchablePages {
  return computeSearchablePages({
    contentDir,
    surfaces: defaultNavigationSurfaces(contentDir),
    readPageSource: readPageSourceWithSnippets,
  });
}
