// Shared helpers for rendering MDX docs pages. Pulled out of
// `app/docs/[[...slug]]/page.tsx` so both the classic `/docs/<slug>`
// route and the new `/<framework>/<slug>` catch-all can share the same
// nav-tree builder, snippet inliner, and component map.
//
// Only the pieces that don't depend on the rendered React tree live
// here; the big `components` map still lives alongside the docs page
// for now so it can import client components without circular issues.

import fs from "fs";
import path from "path";
import matter from "gray-matter";
import { resolveWithinDir } from "./safe-fs";
import { getDocsMode } from "./registry";
import { isRouteGroupSegment } from "./route-groups";

export const CONTENT_DIR = path.join(process.cwd(), "src/content/docs");
export const SNIPPETS_DIR = path.join(CONTENT_DIR, "..", "snippets");

// Re-exported from lib/framework-categories so client components can
// pull the constant without dragging fs through the bundle.
export {
  FRAMEWORK_CATEGORY_ORDER,
  type FrameworkCategory,
} from "./framework-categories";

// ---------------------------------------------------------------------------
// Nav tree types
// ---------------------------------------------------------------------------

export type NavNodeVariant = "react-docs-proxy" | "frontend-docs-upcoming";

export type FrontendDocsStatus = "feature-complete" | "early-access";

export type NavNode =
  | {
      type: "page";
      title: string;
      slug: string;
      href?: string;
      icon?: string;
      variant?: NavNodeVariant;
    }
  | {
      type: "section";
      title: string;
      icon?: string;
      variant?: NavNodeVariant;
      quickstartHref?: string;
      referenceHref?: string;
      frontendDocsStatus?: FrontendDocsStatus;
    }
  | {
      type: "group";
      title: string;
      slug: string;
      children: NavNode[];
      defaultOpen?: boolean;
      icon?: string;
      variant?: NavNodeVariant;
    };

// Section headers (the all-caps separators) carry the only icons in
// the sidebar — top-level visual scaffolding. Title comparison is
// case-insensitive so meta.json edits don't need to match this map's
// capitalization exactly. Update keys here when section names change
// in `content/docs/meta.json`.
//
// Includes both the agnostic root sections AND per-framework
// `docs_mode: "authored"` sections (e.g. Built-in Agent's own IA,
// whose meta.json lives at
// `content/docs/integrations/built-in-agent/meta.json`). Authored
// frameworks don't merge into the root tree, so they need their own
// section names registered here to receive icons — otherwise the
// section header renders without a glyph and looks visually distinct
// from the generated-mode sidebars.
const SECTION_ICONS: Record<string, string> = {
  // Agnostic root sections (`content/docs/meta.json`).
  "get started": "lucide/Rocket",
  concepts: "lucide/BookOpen",
  "build chat uis": "lucide/MessageSquare",
  "build generative ui": "lucide/Paintbrush",
  "add agent powers": "lucide/Wand2",
  runtime: "lucide/Cpu",
  "observe & operate": "lucide/SearchCheck",
  "intelligence platform": "custom/copilotkit-kite",
  deploy: "lucide/Cloud",
  other: "lucide/MoreHorizontal",
  // Built-in Agent (authored) sections — match the section names in
  // `content/docs/integrations/built-in-agent/meta.json`. Adjust here
  // when those section labels change in that meta.json.
  "getting started": "lucide/Rocket",
  basics: "lucide/BookOpen",
  "generative ui": "lucide/Paintbrush",
  "app control": "lucide/WandSparkles",
  "built-in agent": "lucide/Bot",
  backend: "lucide/Server",
  tutorials: "lucide/ListChecks",
  troubleshooting: "lucide/LifeBuoy",
};

export function sectionIconFor(title: string): string | undefined {
  return SECTION_ICONS[title.toLowerCase()];
}

/**
 * Extract the frontmatter block (content between leading `---` fences)
 * from a raw MDX/Markdown source. Returns empty string when the file
 * has no frontmatter. Used to scope frontmatter regexes so we don't
 * accidentally match `title:` or `description:` that happen to appear
 * inside the MDX body.
 */
function extractFrontmatter(raw: string): string {
  // Accept both LF and CRLF line endings so Windows-authored MDX
  // doesn't silently bypass frontmatter extraction.
  const fmMatch = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  return fmMatch?.[1] ?? "";
}

// Escape text for safe interpolation into an HTML attribute/text context.
// Duplicated here (rather than imported from components/snippet.tsx) to
// keep docs-render server-only / framework-free — snippet.tsx is a
// client component and importing it here would pull client code into
// the server bundle. If this ever grows, extract to a shared util.
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Process-scoped memoization for frequently-called filesystem readers.
// buildNavTree walks the entire content tree on every page render and
// calls readTitle / readMeta O(pages) times per request. Without this
// cache each call reopens and re-parses the file from disk.
//
// Production / build: cache the entire process lifetime — content is
// frozen at deploy time so stale reads aren't possible.
//
// Development: skip the cache so meta.json / frontmatter edits show up
// in the sidebar nav without restarting the dev server. The
// performance hit is acceptable for local dev (the request path
// already does plenty of fs work for MDX rendering).
//
// Memory footprint in production: titles are tiny strings, meta is a
// small JSON object — negligible even with hundreds of docs files.
const isDev = process.env.NODE_ENV === "development";
const titleCache = new Map<string, string | null>();
const metaCache = new Map<
  string,
  {
    title?: string;
    pages?: string[];
    root?: boolean;
    icon?: string;
    frontend?: unknown;
  } | null
>();
// Tree-level cache. Even with title/meta cached, `buildNavTree` still
// allocates ~200 NavNode objects per call and is invoked from every
// page render (sometimes twice in the same render via DocsPageView +
// the route's own pageTree). Keying on `${dir}|${prefix}` makes
// repeated calls return the same array reference. Dev mode skips it
// so meta.json edits propagate without a restart.
const navTreeCache = new Map<string, NavNode[]>();

export function readTitle(filePath: string): string | null {
  const cacheKey = path.resolve(filePath);
  if (!isDev && titleCache.has(cacheKey)) return titleCache.get(cacheKey)!;

  if (!fs.existsSync(filePath)) {
    titleCache.set(cacheKey, null);
    return null;
  }
  let raw: string;
  try {
    raw = fs.readFileSync(filePath, "utf-8");
  } catch (err) {
    // A single bad file / permission error used to crash the whole
    // page render. Log loudly and cache a null so we don't retry on
    // every nav build in the same process.
    console.error("[docs-render] failed to read", filePath, err);
    titleCache.set(cacheKey, null);
    return null;
  }
  // Restrict frontmatter matches to the frontmatter block so we don't
  // grab a `title:` line that lives inside an MDX body (e.g. inside a
  // code sample or example config). Falls back to the first H1 when no
  // frontmatter title is set.
  const fm = extractFrontmatter(raw);
  const navTitleMatch = fm.match(/^nav_title:\s*["']?(.+?)["']?\s*$/m);
  const fmMatch = fm.match(/^title:\s*["']?(.+?)["']?\s*$/m);
  let title: string | null = null;
  if (navTitleMatch) {
    title = navTitleMatch[1].replace(/["']$/, "");
  } else if (fmMatch) {
    title = fmMatch[1].replace(/["']$/, "");
  } else {
    const headingMatch = raw.match(/^#\s+(.+)$/m);
    if (headingMatch) title = headingMatch[1];
  }
  titleCache.set(cacheKey, title);
  return title;
}

// Read the sidebar `icon:` field from an MDX file's frontmatter. Page
// icons are opt-in: `icon:` can live in frontmatter as metadata, but
// it only appears in navigation when the page also sets
// `showIcon: true`. This keeps icons available for targeted surfaces
// like cookbook partner pages without turning every icon-bearing docs
// page into an icon row.
export function readIcon(filePath: string): string | null {
  const cacheKey = `icon:${path.resolve(filePath)}`;
  if (!isDev && titleCache.has(cacheKey)) return titleCache.get(cacheKey)!;
  if (!fs.existsSync(filePath)) {
    titleCache.set(cacheKey, null);
    return null;
  }
  let raw: string;
  try {
    raw = fs.readFileSync(filePath, "utf-8");
  } catch {
    titleCache.set(cacheKey, null);
    return null;
  }
  const fm = extractFrontmatter(raw);
  const showIcon = /^showIcon:\s*["']?true["']?\s*$/m.test(fm);
  if (!showIcon) {
    titleCache.set(cacheKey, null);
    return null;
  }
  const match = fm.match(/^icon:\s*["']?(.+?)["']?\s*$/m);
  const icon = match ? match[1].replace(/["']$/, "") : null;
  titleCache.set(cacheKey, icon);
  return icon;
}

// A meta.json `pages` entry is either a string (page slug, section
// header `---Title---`, or spread `...folder`) or an inline-folder
// object: `{ title, pages, defaultOpen?, icon? }`. Inline folders let
// a parent meta.json declare a folder grouping without moving the
// underlying MDX files into a subdirectory — useful for visual
// grouping inside a single content tier.
export type MetaPageEntry =
  | string
  | {
      title: string;
      pages: MetaPageEntry[];
      defaultOpen?: boolean;
      icon?: string;
    };

export function readMeta(dir: string): {
  title?: string;
  pages?: MetaPageEntry[];
  root?: boolean;
  icon?: string;
  frontend?: unknown;
} | null {
  const metaPath = path.join(dir, "meta.json");
  const cacheKey = path.resolve(metaPath);
  if (!isDev && metaCache.has(cacheKey)) return metaCache.get(cacheKey)!;

  if (!fs.existsSync(metaPath)) {
    metaCache.set(cacheKey, null);
    return null;
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(metaPath, "utf-8"));
    metaCache.set(cacheKey, parsed);
    return parsed;
  } catch (err) {
    // Previously swallowed silently — a malformed meta.json rendered
    // as "no nav ordering" with zero signal. Log loudly so authors
    // see the offending path and parse error. Cache the null so we
    // don't re-parse a bad file on every call.
    console.error("[docs-render] failed to parse", metaPath, err);
    metaCache.set(cacheKey, null);
    return null;
  }
}

export function buildNavTree(dir: string, prefix: string = ""): NavNode[] {
  const cacheKey = `${path.resolve(dir)}|${prefix}`;
  if (!isDev) {
    const cached = navTreeCache.get(cacheKey);
    if (cached) return cached;
  }
  const tree = buildNavTreeInner(dir, prefix);
  if (!isDev) navTreeCache.set(cacheKey, tree);
  return tree;
}

function buildNavTreeInner(dir: string, prefix: string): NavNode[] {
  const meta = readMeta(dir);
  if (!meta) return buildNavTreeFromFilesystem(dir, prefix);

  const pages = meta.pages;
  if (!pages || !Array.isArray(pages)) {
    return buildNavTreeFromFilesystem(dir, prefix);
  }

  return parseMetaPages(dir, prefix, pages);
}

// Parse a meta.json `pages` array into NavNodes. Recursive: inline-folder
// objects re-enter via the recursive call so the inner page syntax stays
// identical to the surrounding tree.
function parseMetaPages(
  dir: string,
  prefix: string,
  pages: MetaPageEntry[],
): NavNode[] {
  const nodes: NavNode[] = [];

  for (const entry of pages) {
    // Inline-folder object: `{ title, pages, defaultOpen?, icon? }`.
    // Lets a meta.json declare a folder grouping without moving its
    // MDX files into a subdirectory. The inner pages re-enter this
    // same parser (via the recursive call below) so the syntax inside
    // an inline folder is identical to the surrounding tree.
    if (typeof entry === "object" && entry !== null) {
      const children = parseMetaPages(dir, prefix, entry.pages);
      if (children.length > 0) {
        nodes.push({
          type: "group",
          title: entry.title,
          // No backing directory — slug is purely a stable key for
          // sidebar React reconciliation. Prefix it so the React key
          // doesn't collide with a real folder of the same name.
          slug: `${prefix}#${entry.title}`,
          children,
          defaultOpen: entry.defaultOpen,
          icon: entry.icon,
        });
      }
      continue;
    }

    const sectionMatch = entry.match(/^---(.+)---$/);
    if (sectionMatch) {
      const title = sectionMatch[1];
      nodes.push({ type: "section", title, icon: sectionIconFor(title) });
      continue;
    }

    if (entry.startsWith("[")) continue;

    const spreadMatch = entry.match(/^\.\.\.(.+)$/);
    if (spreadMatch) {
      const subDir = path.join(dir, spreadMatch[1]);
      const subPrefix = prefix ? `${prefix}/${spreadMatch[1]}` : spreadMatch[1];
      if (fs.existsSync(subDir) && fs.statSync(subDir).isDirectory()) {
        const subMeta = readMeta(subDir);
        if (subMeta?.root) continue;
        const subChildren = buildNavTree(subDir, subPrefix);
        if (subChildren.length > 0) {
          const rawGroupTitle =
            subMeta?.title ||
            spreadMatch[1].replace(/[()-]/g, " ").replace(/\s+/g, " ").trim();
          const groupTitle =
            rawGroupTitle.charAt(0).toUpperCase() + rawGroupTitle.slice(1);
          // If the previous emitted node is a section header with the
          // same title as this group's title, the section header
          // already labels this content. Suppress the group title
          // (empty string) so the renderer skips rendering it — the
          // group still wraps its children for indentation/nesting.
          // Without this dedup the sidebar shows "BUILD GENERATIVE UI"
          // (section, uppercase) followed immediately by "Build
          // Generative UI" (group, regular case) — same text, doubled.
          const prev = nodes[nodes.length - 1];
          const isDuplicateOfSection =
            prev?.type === "section" && prev.title === groupTitle;
          nodes.push({
            type: "group",
            title: isDuplicateOfSection ? "" : groupTitle,
            slug: subPrefix,
            children: subChildren,
            icon: subMeta?.icon,
          });
        }
      }
      continue;
    }

    const slug = prefix ? `${prefix}/${entry}` : entry;
    const mdxFile = path.join(dir, `${entry}.mdx`);
    const indexFile = path.join(dir, entry, "index.mdx");
    const subDir = path.join(dir, entry);

    // Special case: a literal `"index"` entry in a folder's meta.json
    // represents the folder's root page (URL = `/<folder>` with no
    // trailing slug). Always emit a page node — even when `index.mdx`
    // doesn't yet exist on disk — so the framework override nav can
    // rewrite it onto the bare `/<framework>` URL where the data-driven
    // `FrameworkOverview` renders. Title falls back to "Introduction"
    // when no MDX is present to read from. `buildFrameworkOverridesNav`
    // handles the final slug rewrite (`"index"` → `""`).
    if (entry === "index") {
      const title = fs.existsSync(mdxFile)
        ? readTitle(mdxFile) || "Introduction"
        : "Introduction";
      // At the docs root (no prefix), `"index"` represents the bare
      // `/` page (the unscoped docs landing). Rewrite the slug to ""
      // so the bridge builds `/` rather than `/index`. Inside a
      // sub-folder, `"index"` keeps the folder-relative slug (e.g.
      // `agentic-protocols/index`) and `buildFrameworkOverridesNav`
      // handles the final framework-scoped rewrite separately.
      const indexSlug = prefix ? slug : "";
      const icon = fs.existsSync(mdxFile) ? readIcon(mdxFile) : null;
      nodes.push({
        type: "page",
        title,
        slug: indexSlug,
        icon: icon ?? undefined,
      });
      continue;
    }

    if (fs.existsSync(mdxFile)) {
      const title =
        readTitle(mdxFile) || entry.split("/").pop()!.replace(/-/g, " ");
      const icon = readIcon(mdxFile);
      nodes.push({ type: "page", title, slug, icon: icon ?? undefined });
    } else if (fs.existsSync(subDir) && fs.statSync(subDir).isDirectory()) {
      const subMeta = readMeta(subDir);
      if (subMeta?.root) continue;
      const subPrefix = prefix ? `${prefix}/${entry}` : entry;

      if (subMeta?.pages) {
        const subChildren = buildNavTree(subDir, subPrefix);
        const groupTitle = subMeta.title || entry.replace(/-/g, " ");
        nodes.push({
          type: "group",
          title: groupTitle.charAt(0).toUpperCase() + groupTitle.slice(1),
          slug: subPrefix,
          children: subChildren,
          icon: subMeta.icon,
        });
      } else if (fs.existsSync(indexFile)) {
        const title =
          readTitle(indexFile) || subMeta?.title || entry.replace(/-/g, " ");
        const icon = readIcon(indexFile);
        nodes.push({
          type: "page",
          title,
          slug: subPrefix,
          icon: icon ?? undefined,
        });
      } else {
        const subChildren = buildNavTreeFromFilesystem(subDir, subPrefix);
        if (subChildren.length > 0) {
          const groupTitle = subMeta?.title || entry.replace(/-/g, " ");
          nodes.push({
            type: "group",
            title: groupTitle.charAt(0).toUpperCase() + groupTitle.slice(1),
            slug: subPrefix,
            children: subChildren,
          });
        }
      }
    } else if (fs.existsSync(indexFile)) {
      const title = readTitle(indexFile) || entry.replace(/-/g, " ");
      nodes.push({ type: "page", title, slug });
    }
  }

  return nodes;
}

export function buildNavTreeFromFilesystem(
  dir: string,
  prefix: string,
): NavNode[] {
  if (!fs.existsSync(dir)) return [];
  const nodes: NavNode[] = [];
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (err) {
    // Permission denied / ENOTDIR / etc. Log and return an empty tree
    // rather than crashing every docs page render downstream.
    console.error("[docs-render] failed to read dir", dir, err);
    return [];
  }
  for (const entry of entries) {
    if (entry.name.startsWith(".") || entry.name === "meta.json") continue;
    if (entry.name.startsWith("(")) continue;
    const slug = prefix
      ? `${prefix}/${entry.name.replace(".mdx", "")}`
      : entry.name.replace(".mdx", "");
    if (entry.isDirectory()) {
      const subMeta = readMeta(path.join(dir, entry.name));
      if (subMeta?.root) continue;
      const subChildren = buildNavTree(path.join(dir, entry.name), slug);
      if (subChildren.length > 0) {
        const groupTitle = subMeta?.title || entry.name.replace(/-/g, " ");
        nodes.push({
          type: "group",
          title: groupTitle.charAt(0).toUpperCase() + groupTitle.slice(1),
          slug,
          children: subChildren,
        });
      }
    } else if (entry.name.endsWith(".mdx") && entry.name !== "index.mdx") {
      const title =
        readTitle(path.join(dir, entry.name)) ||
        entry.name.replace(".mdx", "").replace(/-/g, " ");
      nodes.push({ type: "page", title, slug });
    }
  }
  return nodes;
}

/**
 * Walk `content/docs/integrations/<folder>/` and return NavNodes for
 * pages that have NO root equivalent. These are framework-specific
 * topics (e.g. Built-in Agent's `copilot-runtime`, LangGraph's `auth`
 * and `subgraphs`) that live only in the per-framework tree and need
 * their own sidebar entries. Pages that duplicate root files are
 * skipped — root wins, and the framework view already renders the
 * root MDX with a framework override.
 *
 * Takes the resolved folder name (not the URL slug). Callers should
 * use `getDocsFolder(slug)` from lib/registry to map language/runtime
 * variants to their shared folder (e.g. langgraph-python / typescript
 * / fastapi → `langgraph/`).
 */
export function buildFrameworkOverridesNav(folder: string): NavNode[] {
  const frameworkDir = path.join(CONTENT_DIR, "integrations", folder);
  if (!fs.existsSync(frameworkDir)) return [];
  const nodes = buildNavTree(frameworkDir, `integrations/${folder}`);

  // Drop entries whose equivalent root file exists. Root wins when
  // both are present — the per-framework tree is only an escape hatch
  // for framework-specific topics, not an alternative rendering.
  const prefix = `integrations/${folder}/`;
  const rewriteSlug = (slug: string): string => {
    const stripped = slug.replace(prefix, "");
    if (stripped === "index") return "";
    if (stripped.endsWith("/index")) return stripped.slice(0, -"/index".length);
    return stripped;
  };
  const rootEquivalentExists = (slug: string): boolean => {
    const rootSlug = rewriteSlug(slug);
    if (rootSlug === "") return false;
    const rootMdx = path.join(CONTENT_DIR, `${rootSlug}.mdx`);
    const rootIndex = path.join(CONTENT_DIR, rootSlug, "index.mdx");
    return fs.existsSync(rootMdx) || fs.existsSync(rootIndex);
  };
  const rewriteNode = (node: NavNode): NavNode | null => {
    if (node.type === "page") {
      if (rootEquivalentExists(node.slug)) return null;
      return { ...node, slug: rewriteSlug(node.slug) };
    }
    if (node.type === "group") {
      const children = node.children
        .map(rewriteNode)
        .filter((child): child is NavNode => child !== null);
      if (children.length > 0) {
        return { ...node, slug: rewriteSlug(node.slug), children };
      }
      return null;
    }
    // Intentionally drop section nodes. Per-framework meta.json files
    // tend to mirror the root tree's sections ("Getting Started",
    // "Basics", etc.) and flowing them through here would (a) collide
    // with root sections of the same name on React keys and (b) double
    // up the visual hierarchy — the override block is already wrapped
    // in a single `{frameworkName}` section by mergeFrameworkNav.
    return null;
  };
  const filtered = nodes
    .map(rewriteNode)
    .filter((node): node is NavNode => node !== null);

  // Flatten empty-title wrapper groups. buildNavTree clears the title on
  // a spread-derived group when the preceding section header has the
  // same name (so the renderer doesn't double-print "Generative UI").
  // After we drop section headers above, those wrappers are left as
  // titleless containers that only add an extra indent step around
  // their children. Inline the children at the wrapper's level instead.
  const flattened: NavNode[] = [];
  for (const node of filtered) {
    if (node.type === "group" && node.title === "") {
      flattened.push(...node.children);
    } else {
      flattened.push(node);
    }
  }
  return flattened;
}

/**
 * Build a sidebar that contains ONLY the per-framework MDX tree
 * (no merge with root nav, no root-equivalent filtering). Authored
 * integrations use this because their `integrations/<folder>/meta.json`
 * is the source of truth for page order and section grouping.
 *
 * Slugs are rewritten to drop the `integrations/<folder>/` prefix and
 * the literal `index` → "" rewrite, so links resolve at
 * `/<framework>/<topic>` and the framework root at `/<framework>`.
 */
export function buildFrameworkOnlyNav(
  folder: string,
  sharedSections: string[] = SHARED_ROOT_SECTIONS,
): NavNode[] {
  const frameworkDir = path.join(CONTENT_DIR, "integrations", folder);
  if (!fs.existsSync(frameworkDir)) return [];
  const nodes = buildNavTree(frameworkDir, `integrations/${folder}`);
  const prefix = `integrations/${folder}/`;

  // Recursive slug rewrite so nested groups (e.g. `human-in-the-loop/`,
  // `premium/`) also get the prefix stripped from their children.
  //
  // Two `index` cases need rewriting:
  //   1. Top-level `index` → "" so the framework-root entry resolves to
  //      `/<framework>` (not `/<framework>/index`).
  //   2. Nested `<group>/index` → `<group>` so a folder's own root page
  //      (e.g. `human-in-the-loop/index.mdx`) resolves to
  //      `/<framework>/human-in-the-loop` (the folder URL), not
  //      `/<framework>/human-in-the-loop/index` which 404s. Without
  //      this rewrite the sidebar links into folder-root pages dead-end.
  const rewrite = (node: NavNode): NavNode => {
    if (node.type === "page") {
      const stripped = node.slug.replace(prefix, "");
      let slug = stripped;
      if (stripped === "index") slug = "";
      else if (stripped.endsWith("/index"))
        slug = stripped.slice(0, -"/index".length);
      return { ...node, slug };
    }
    if (node.type === "group") {
      const stripped = node.slug.replace(prefix, "");
      return {
        ...node,
        slug: stripped,
        children: node.children.map(rewrite),
      };
    }
    return node;
  };
  return dropEmptySections(
    appendSharedThreadArchitecturePage(
      appendSharedRootSections(nodes.map(rewrite), sharedSections),
    ),
  );
}

/**
 * Build the sidebar for the ROOT surface (the bare-URL docs, served by
 * the default framework — Built-in Agent). Same as
 * `buildFrameworkOnlyNav` but folds the agnostic root sections
 * (`ROOT_SURFACE_SECTIONS`) into the tree so navigating from a BIA page
 * to an agnostic page (e.g. `/concepts/architecture`, `/backend/ag-ui`)
 * keeps ONE coherent sidebar instead of swapping IAs.
 *
 * Scoped to the root surface only: `buildFrameworkOnlyNav`'s default
 * keeps the shared-section behavior for deepagents, and generated
 * frameworks are untouched.
 */
export function buildRootSurfaceNav(folder: string): NavNode[] {
  return buildFrameworkOnlyNav(folder, ROOT_SURFACE_SECTIONS);
}

const SHARED_ROOT_SECTIONS = ["Intelligence Platform", "Platforms"];

// Sections pulled from the root `meta.json` into the Built-in Agent
// sidebar when it serves the ROOT surface (see `buildRootSurfaceNav`).
// BIA is the default framework and its docs render at the bare root
// URLs, so its sidebar must also navigate the agnostic pages that live
// outside BIA's authored tree (Concepts, the Runtime/backend pages,
// Intelligence Platform, Deploy, What's New, Migrate, …). Without this, landing
// on an agnostic page like `/concepts/architecture` swaps the sidebar
// to the root `meta.json` IA — the jarring "two docs colliding" flip.
//
// Each title slots into a matching empty `---Section---` placeholder in
// BIA's `meta.json` when present (so position is author-controlled),
// otherwise the section appends at the end. "Intelligence Platform" and
// "Platforms" stay in the list so the root surface keeps the generated
// Intelligence Platform IA and shared platform guides.
const ROOT_SURFACE_SECTIONS = [
  "Concepts",
  "Runtime",
  "Intelligence Platform",
  "Deploy",
  "Platforms",
  "Other",
];

/**
 * Remove section headers that have no entries before the next section
 * header (or end of tree). `buildRootSurfaceNav` relies on empty
 * `---Section---` placeholders in BIA's meta.json that get filled by
 * `appendSharedRootSections`; any placeholder whose section isn't in
 * the active shared list would otherwise render as a
 * dangling header. This also guards against authored metas that leave a
 * trailing empty section.
 */
function dropEmptySections(navTree: NavNode[]): NavNode[] {
  return navTree.filter((node, i) => {
    if (node.type !== "section") return true;
    const next = navTree[i + 1];
    // Keep the section only if a non-section node follows it before the
    // next section boundary.
    return next !== undefined && next.type !== "section";
  });
}

function sectionRange(
  navTree: NavNode[],
  sectionTitle: string,
): { start: number; end: number } | null {
  const start = navTree.findIndex(
    (node) =>
      node.type === "section" &&
      node.title.toLowerCase() === sectionTitle.toLowerCase(),
  );
  if (start === -1) return null;

  const nextSection = navTree.findIndex(
    (node, index) => index > start && node.type === "section",
  );
  return { start, end: nextSection === -1 ? navTree.length : nextSection };
}

function hasPageSlug(navTree: NavNode[], slug: string): boolean {
  return navTree.some((node) => {
    if (node.type === "page") return node.slug === slug;
    if (node.type === "group") return hasPageSlug(node.children, slug);
    return false;
  });
}

function findPageBySlug(navTree: NavNode[], slug: string): NavNode | null {
  for (const node of navTree) {
    if (node.type === "page" && node.slug === slug) return node;
    if (node.type === "group") {
      const match = findPageBySlug(node.children, slug);
      if (match) return match;
    }
  }
  return null;
}

function appendSharedThreadArchitecturePage(navTree: NavNode[]): NavNode[] {
  const rootGroup = buildNavTree(CONTENT_DIR).find(
    (node): node is Extract<NavNode, { type: "group" }> =>
      node.type === "group" && node.title === "Threads",
  );
  if (!rootGroup) return navTree;

  const architecturePage = findPageBySlug(
    rootGroup.children,
    "premium/threads-explained",
  );
  if (architecturePage?.type !== "page") return navTree;

  return navTree.map((node) => {
    if (node.type !== "group" || node.title !== "Threads") return node;
    if (hasPageSlug(node.children, architecturePage.slug)) return node;

    // The Architecture page sits second-to-last in the Threads group,
    // just before the client-facing Lifecycle page. Fall back to
    // appending if the Lifecycle anchor isn't present.
    const lifecycleIndex = node.children.findIndex(
      (child) => child.type === "page" && child.slug === "threads-lifecycle",
    );
    const insertAt =
      lifecycleIndex === -1 ? node.children.length : lifecycleIndex;
    const children = [
      ...node.children.slice(0, insertAt),
      architecturePage,
      ...node.children.slice(insertAt),
    ];

    return { ...node, children };
  });
}

// A nav node whose slug carries a route-group segment like `(other)`.
// Route groups are organizational-only — the segment is stripped from
// the real URL — so folding them into a sidebar would emit a bogus
// `/(other)/…` href (and duplicate pages that also live at their
// stripped URL). `appendSharedRootSections` drops these when folding
// root sections into a framework sidebar.
function isRouteGroupNode(node: NavNode): boolean {
  if (node.type === "section") return false;
  return node.slug
    .split("/")
    .some((seg) => seg.startsWith("(") && seg.endsWith(")"));
}

function filterMissingPages(node: NavNode, navTree: NavNode[]): NavNode | null {
  if (node.type === "page") {
    return hasPageSlug(navTree, node.slug) ? null : node;
  }
  if (node.type === "group") {
    const children = node.children
      .map((child) => filterMissingPages(child, navTree))
      .filter((child): child is NavNode => child !== null);
    return children.length > 0 ? { ...node, children } : null;
  }
  return node;
}

/**
 * Authored framework sidebars own their page order, but some root docs
 * sections are global product guidance rather than framework IA. Keep
 * those shared sections in every framework sidebar without duplicating
 * entries across each authored integration's meta.json.
 */
function appendSharedRootSections(
  navTree: NavNode[],
  sharedSections: string[] = SHARED_ROOT_SECTIONS,
): NavNode[] {
  let nextNavTree = navTree;
  const rootNavTree = buildNavTree(CONTENT_DIR);

  for (const sectionTitle of sharedSections) {
    const rootRange = sectionRange(rootNavTree, sectionTitle);
    if (!rootRange) continue;

    const section = rootNavTree[rootRange.start];
    const missingNodes = rootNavTree
      .slice(rootRange.start + 1, rootRange.end)
      .filter((node) => !isRouteGroupNode(node))
      .map((node) => filterMissingPages(node, nextNavTree))
      .filter((node): node is NavNode => node !== null);
    if (missingNodes.length === 0) continue;

    const existingRange = sectionRange(nextNavTree, sectionTitle);
    if (existingRange) {
      nextNavTree = [
        ...nextNavTree.slice(0, existingRange.end),
        ...missingNodes,
        ...nextNavTree.slice(existingRange.end),
      ];
    } else {
      nextNavTree = [...nextNavTree, section, ...missingNodes];
    }
  }

  return nextNavTree;
}

// Map a framework slug to the section-header icon spec used by the
// sidebar bridge. LangGraph variants (-python, -typescript, -fastapi)
// share the LangGraph mark; other integrations have no custom mark yet
// and fall back to no icon. Extend as we ship more.
export function frameworkSectionIcon(framework: string): string | undefined {
  if (framework.startsWith("langgraph")) return "custom/langgraph";
  return undefined;
}

/**
 * Merge per-framework overrides into the root nav tree. The override
 * block is inserted as a labeled section right after the agent-control
 * section in the root ordering.
 *
 * Authored and generated frameworks both use this merged shell so the
 * sidebar information architecture is stable across framework switches.
 * Content resolution still decides whether a given slug renders authored
 * MDX first or the generated/root page first.
 */
export function mergeFrameworkNav(
  rootNav: NavNode[],
  overrideNav: NavNode[],
  frameworkName: string,
  frameworkIcon?: string,
): NavNode[] {
  if (overrideNav.length === 0) return rootNav;

  // Pull the framework-root page (the "Introduction" entry from
  // integrations/<folder>/meta.json's literal "index" slot —
  // buildFrameworkOverridesNav rewrites its slug to "") out of the override
  // nav so we can place it inside the global "Get Started" section instead
  // of stranding it above all section headers as a top-level prefix.
  const introIdx = overrideNav.findIndex(
    (n) => n.type === "page" && n.slug === "",
  );
  const introNode = introIdx >= 0 ? overrideNav[introIdx] : null;
  const remainingOverrideNav =
    introIdx >= 0
      ? [...overrideNav.slice(0, introIdx), ...overrideNav.slice(introIdx + 1)]
      : overrideNav;

  const sectionHeader: NavNode = {
    type: "section",
    title: frameworkName,
    icon: frameworkIcon,
  };
  const isSection = (n: NavNode, title: string) =>
    n.type === "section" && n.title.toLowerCase() === title.toLowerCase();
  // Section names tried in priority order. The first match wins; the
  // override block is inserted right before the *next* section header
  // after the matched anchor. Update this list when the JTBD section
  // names change in content/docs/meta.json.
  const ANCHOR_CANDIDATES = [
    "add agent powers",
    "give your app agent powers",
    "app control",
    "agents & backends",
    "backend",
    "runtime",
  ];
  let insertAt = -1;
  for (const anchor of ANCHOR_CANDIDATES) {
    const anchorIdx = rootNav.findIndex((n) => isSection(n, anchor));
    if (anchorIdx === -1) continue;
    for (let i = anchorIdx + 1; i < rootNav.length; i++) {
      if (rootNav[i].type === "section") {
        insertAt = i;
        break;
      }
    }
    if (insertAt !== -1) break;
  }

  // Reconcile the rootNav's existing root-level introduction with the
  // framework's own introNode. At a framework view we want exactly one
  // Introduction entry, and it should link to the framework root.
  const rootHasIntro = rootNav.some((n) => n.type === "page" && n.slug === "");
  const rootNavWithIntro = (() => {
    if (!introNode) return rootNav;
    if (rootHasIntro) {
      return rootNav.map((n) =>
        n.type === "page" && n.slug === "" ? introNode : n,
      );
    }
    const getStartedIdx = rootNav.findIndex((n) => isSection(n, "get started"));
    if (getStartedIdx === -1) return [introNode, ...rootNav];
    return [
      ...rootNav.slice(0, getStartedIdx + 1),
      introNode,
      ...rootNav.slice(getStartedIdx + 1),
    ];
  })();

  if (insertAt === -1) {
    return [...rootNavWithIntro, sectionHeader, ...remainingOverrideNav];
  }
  const getStartedIdx = rootNav.findIndex((n) => isSection(n, "get started"));
  const prepended = !!introNode && !rootHasIntro && getStartedIdx === -1;
  const splicedAfterAnchor =
    !!introNode &&
    !rootHasIntro &&
    getStartedIdx !== -1 &&
    insertAt > getStartedIdx;
  const adjustedInsertAt =
    prepended || splicedAfterAnchor ? insertAt + 1 : insertAt;
  return [
    ...rootNavWithIntro.slice(0, adjustedInsertAt),
    sectionHeader,
    ...remainingOverrideNav,
    ...rootNavWithIntro.slice(adjustedInsertAt),
  ];
}

/**
 * Build the framework-scoped sidebar IA used by generated framework
 * routes. Generated docs share the root docs IA and layer sparse
 * framework-specific overrides into that tree.
 */
export function buildFrameworkNav(
  docsFolder: string,
  frameworkName: string,
  frameworkSlug: string,
): NavNode[] {
  return mergeFrameworkNav(
    buildNavTree(CONTENT_DIR),
    buildFrameworkOverridesNav(docsFolder),
    frameworkName,
    frameworkSectionIcon(frameworkSlug),
  );
}

/**
 * Return the list of framework slugs whose `integrations/<folder>/`
 * tree contains an MDX file for `slugPath`. Matches either
 * `<slug>.mdx` or `<slug>/index.mdx`. Used by the framework-scoped
 * router to detect that a topic is available in *some* framework but
 * not the one the user is currently viewing, so we can render a
 * helpful "not available for <X>" page instead of a bare 404.
 *
 * Most slugs map 1:1 to their folder, but language/runtime variants
 * share one folder (langgraph-python/typescript/fastapi → `langgraph/`,
 * ms-agent-dotnet/python → `microsoft-agent-framework/`) and two
 * legacy slugs were renamed after the folder existed (google-adk →
 * `adk/`, strands → `aws-strands/`). The caller supplies the
 * slug→folder resolver so this helper stays decoupled from the registry's
 * docs-folder mapping.
 *
 * `docs_mode: hidden` frameworks are filtered out — the "Try X, Y, Z"
 * suggestion surfaces would otherwise dead-end on a 404 (those frameworks
 * have no `/<slug>` route by design).
 */
export function findFrameworksWithPage(
  slugPath: string,
  integrationSlugs: readonly string[],
  slugToFolder: (slug: string) => string,
): string[] {
  const matches: string[] = [];
  for (const slug of integrationSlugs) {
    if (getDocsMode(slug) === "hidden") continue;
    const folder = slugToFolder(slug);
    const mdx = path.join(
      CONTENT_DIR,
      "integrations",
      folder,
      `${slugPath}.mdx`,
    );
    const indexMdx = path.join(
      CONTENT_DIR,
      "integrations",
      folder,
      slugPath,
      "index.mdx",
    );
    if (fs.existsSync(mdx) || fs.existsSync(indexMdx)) matches.push(slug);
  }
  return matches;
}

// ---------------------------------------------------------------------------
// Snippet inlining (same rules as the docs page)
// ---------------------------------------------------------------------------

// Maps `<ComponentName />` MDX references to the relative snippet file
// under SNIPPETS_DIR. Keys are JSX component names (PascalCase) and
// must match EXACTLY what authors write in MDX — they are not
// filesystem paths and are case-sensitive on both sides of the map.
//
// Aliases (same target under multiple keys) are intentional and exist
// because the codebase historically shipped both spellings:
//   - `AgUI` / `AGUI`                — two legal casings; keep both
//     so authors writing either render correctly. Upstream consumers
//     reach this via SUBPATH_TO_COMPONENT which uses `AGUI`.
//   - `FrontendTools` / `FrontEndToolsImpl` — historical name kept
//     for backward compat with existing MDX that still uses
//     `<FrontEndToolsImpl />` (confirmed in live docs content). Don't
//     collapse these without first rewriting all .mdx references.
//
// Filename casing: `migrate-to-1.10.X.mdx` and `migrate-to-1.8.2.mdx`
// match the on-disk files exactly (uppercase X in 1.10.X), verified
// against src/content/snippets/shared/troubleshooting/.
export const SNIPPET_MAP: Record<string, string> = {
  A2UI: "shared/generative-ui/a2ui.mdx",
  AgUI: "shared/backend/ag-ui.mdx",
  AGUI: "shared/backend/ag-ui.mdx", // alias of AgUI
  BuildWithAgents: "shared/guides/build-with-agents.mdx",
  CodingAgents: "shared/coding-agents.mdx",
  CommonIssues: "shared/troubleshooting/common-issues.mdx",
  CopilotRuntime: "copilot-runtime.mdx",
  CustomAgent: "shared/backend/custom-agent.mdx",
  DebugMode: "shared/troubleshooting/debug-mode.mdx",
  DisplayOnly: "shared/generative-ui/display-only.mdx",
  ErrorDebugging: "shared/troubleshooting/error-debugging.mdx",
  FrontendTools: "shared/app-control/frontend-tools.mdx",
  FrontEndToolsImpl: "shared/app-control/frontend-tools.mdx", // alias of FrontendTools
  GenerativeUISpecsOverview: "shared/generative-ui-specs-overview.mdx",
  HeadlessUI: "shared/basics/headless-ui.mdx",
  Inspector: "shared/premium/inspector.mdx",
  Interactive: "shared/generative-ui/interactive.mdx",
  MCPApps: "shared/generative-ui/mcp-apps.mdx",
  MCPSetup: "shared/guides/mcp-server-setup.mdx",
  MigrateTo1100: "shared/troubleshooting/migrate-to-1.10.X.mdx",
  MigrateTo182: "shared/troubleshooting/migrate-to-1.8.2.mdx",
  MigrateToV2: "shared/troubleshooting/migrate-to-v2.mdx",
  Overview: "shared/premium/overview.mdx",
  PrebuiltComponents: "shared/basics/prebuilt-components.mdx",
  ProgrammaticControl: "shared/basics/programmatic-control.mdx",
  ReasoningMessages:
    "shared/guides/custom-look-and-feel/reasoning-messages.mdx",
  SelfHosting: "shared/premium/self-hosting.mdx",
  Slots: "shared/basics/slots.mdx",
  HeadlessThreads: "shared/threads/headless-threads.mdx",
  Threads: "shared/threads/headless-threads.mdx",
  ThreadsOverview: "shared/threads/overview.mdx",
  ToolRenderer: "shared/generative-ui/tool-rendering.mdx", // alias of ToolRendering
  ToolRendering: "shared/generative-ui/tool-rendering.mdx",
  DefaultToolRendering: "shared/guides/default-tool-rendering.mdx",
  // Versionless aliases retained for backward compat with older MDX that
  // emits `<MigrateTo />` / `<MigrateToV />`; both resolve to v2.
  MigrateTo: "shared/troubleshooting/migrate-to-v2.mdx",
  MigrateToV: "shared/troubleshooting/migrate-to-v2.mdx",
  CopilotUI: "copilot-ui.mdx",
  LandingCodeShowcase: "landing-code-showcase.mdx",
  UseAgentSnippet: "use-agent.mdx",
  InstallSDKSnippet: "install-sdk.mdx",
  InstallPythonSDK: "install-python-sdk.mdx",
  RunAndConnect: "coagents/run-and-connect-agent.mdx",
  RunAndConnectSnippet: "coagents/run-and-connect-agent.mdx", // alias of RunAndConnect
  CopilotCloudConfigureCopilotKitProvider:
    "copilot-cloud-configure-copilotkit-provider.mdx",
  // Historical spelling (no `Provider` suffix) still appears in tutorials.
  CopilotCloudConfigureCopilotKit:
    "copilot-cloud-configure-copilotkit-provider.mdx",
  SelfHostingCopilotRuntimeCreateEndpoint:
    "self-hosting-copilot-runtime-create-endpoint.mdx",
  SelfHostingCopilotRuntimeConfigureCopilotKitProvider:
    "self-hosting-copilot-runtime-configure-copilotkit-provider.mdx",
  SelfHostingCopilotRuntimeConfigureCopilotKit:
    "self-hosting-copilot-runtime-configure-copilotkit-provider.mdx",
};

export const SUBPATH_TO_COMPONENT: Record<string, string> = {
  "ag-ui": "AGUI",
  "build-with-agents": "CodingAgents",
  "copilot-runtime": "CopilotRuntime",
  "custom-look-and-feel/headless-ui": "HeadlessUI",
  "custom-look-and-feel/slots": "Slots",
  "frontend-tools": "FrontendTools",
  "generative-ui/a2ui": "A2UI",
  "generative-ui/mcp-apps": "MCPApps",
  "generative-ui/tool-rendering": "ToolRendering",
  "generative-ui/your-components/display-only": "DisplayOnly",
  "generative-ui/your-components/interactive": "Interactive",
  inspector: "Inspector",
  "prebuilt-components": "PrebuiltComponents",
  "programmatic-control": "ProgrammaticControl",
  "premium/headless-ui": "HeadlessUI",
  "premium/overview": "Overview",
  "troubleshooting/common-issues": "CommonIssues",
  "troubleshooting/error-debugging": "ErrorDebugging",
  "troubleshooting/migrate-to-1.10.X": "MigrateTo1100",
  "troubleshooting/migrate-to-1.8.2": "MigrateTo182",
  "troubleshooting/migrate-to-v2": "MigrateToV2",
};

/**
 * Strip leading `import ...` statements from an MDX source WITHOUT
 * touching lines inside fenced code blocks. Previously we ran
 * `/^import\s+.+$/gm` over the whole source, which mangled real code
 * samples like `import os` inside python fences. This implementation
 * walks the source line-by-line, tracks fence state with ``` / ~~~,
 * and only strips `import` lines that appear at the top of the file
 * (before the first non-import, non-blank content line). Import lines
 * that appear *later* in the prose are also preserved — the only ones
 * we want to remove are MDX's JSX component imports, which always sit
 * in the top-of-file block.
 *
 * Covered by: snippet contents that include a Python/JS code fence
 * with an `import` statement must have the `import` preserved in the
 * rendered output.
 */
export function stripLeadingImports(source: string): string {
  const lines = source.split("\n");
  const out: string[] = [];
  let inFence = false;
  let fenceMarker: string | null = null;
  let pastHeader = false;
  // When an `import { ... }` is split across lines, the opening line
  // matches the single-line drop rule but the continuation lines
  // (`  Foo,`, `} from "...";`) do not — historically those continuation
  // lines fell into the content branch and flipped `pastHeader = true`,
  // which then preserved every subsequent import in the MDX body and
  // produced runtime errors like `<p>{Tab}</p>`. Track an open import
  // explicitly so we consume continuations through the closing `from "...";`.
  let inMultilineImport = false;

  for (const line of lines) {
    // Toggle fence state. Match the opening fence's marker (``` or ~~~)
    // so a stray triple-backtick inside a tilde fence (or vice-versa)
    // doesn't prematurely close it.
    const fenceMatch = line.match(/^\s*(```+|~~~+)/);
    if (fenceMatch) {
      if (!inFence) {
        inFence = true;
        // Store the full fence marker (e.g. ``` or ~~~~) rather than
        // its first character, so a single stray `\`` inside a ```
        // fence doesn't prematurely close the block.
        fenceMarker = fenceMatch[1];
      } else if (fenceMarker && line.trim().startsWith(fenceMarker)) {
        inFence = false;
        fenceMarker = null;
      }
      pastHeader = true; // fences are content
      out.push(line);
      continue;
    }

    if (!inFence && !pastHeader) {
      if (inMultilineImport) {
        // Continuation of a multi-line import block. Terminate when we
        // see the closing `from "..."` clause (with OR without the
        // trailing semicolon — modern style routinely omits the `;`).
        // Don't terminate purely on `;` — a bare `;` rarely appears
        // mid-import, and JSX expressions on subsequent body lines
        // (`<Foo prop={a ? b : c};`) could false-match and leave us
        // stuck consuming forever.
        if (/\bfrom\s+["'][^"']+["']\s*;?\s*$/.test(line)) {
          inMultilineImport = false;
        }
        continue;
      }
      if (/^\s*$/.test(line)) {
        // Preserve blank lines in the header region for layout.
        out.push(line);
        continue;
      }
      if (/^import\b/.test(line)) {
        // Single-line import has both `import` AND its `from "..."`
        // (or side-effect form `import "..."`) on the same line. The
        // optional trailing `;` is irrelevant — modern MDX docs often
        // drop it, which was the bug behind the prior fix's regression
        // (the prior version required `;` and so misclassified bare
        // imports as multi-line, then silently consumed the JSX body
        // looking for a non-existent `;` terminator).
        const isSingleLine =
          /\bfrom\s+["'][^"']+["']\s*;?\s*$/.test(line) ||
          /^import\s+["'][^"']+["']\s*;?\s*$/.test(line);
        if (isSingleLine) {
          continue;
        }
        // Multi-line opener: `import {` with the `from "..."` clause
        // on a subsequent line.
        inMultilineImport = true;
        continue;
      }
      // First real content line flips us out of "header" mode.
      pastHeader = true;
    }

    out.push(line);
  }

  return out.join("\n");
}

/**
 * Returns true if `offset` falls inside a Markdown fenced code block
 * (```...``` or ~~~...~~~) or an inline code span (`...`) within
 * `content`. Best-effort: scans from the start of `content` and tracks
 * fence state line by line. Markdown requires fence markers at the start
 * of a line (optionally preceded by up to three spaces), so we anchor on
 * that. Used by `inlineSnippets()` to skip JSX-looking matches that
 * appear inside example code (e.g. `<CopilotChat />` shown as runtime
 * usage in slots.mdx) rather than as snippet imports.
 */
function isInsideCodeFence(content: string, offset: number): boolean {
  // Split the text up to the match into completed lines + a possibly
  // partial trailing line. We treat all completed lines as candidate
  // fence boundaries and the trailing partial line as the context for
  // inline-code (single-backtick) detection.
  const lines = content.slice(0, offset).split("\n");
  const completed = lines.slice(0, -1);
  const currentLine = lines[lines.length - 1] ?? "";

  // Fenced blocks: walk completed lines and toggle on matching
  // opener/closer. CommonMark allows up to 3 leading spaces; MDX in
  // shell-docs is more permissive — fences inside `<Step>` and other
  // JSX containers are routinely indented 8+ spaces. Match any
  // leading whitespace so those fences aren't missed.
  let inFence = false;
  let openerChar: string | null = null;
  for (const line of completed) {
    const fenceMatch = line.match(/^\s*(`{3,}|~{3,})/);
    if (!fenceMatch) continue;
    const marker = fenceMatch[1];
    if (!inFence) {
      inFence = true;
      openerChar = marker[0];
    } else if (marker[0] === openerChar) {
      inFence = false;
      openerChar = null;
    }
  }
  if (inFence) return true;

  // Inline code: count single-backtick toggles on the partial current
  // line. A single backtick opens an inline span that closes on the
  // next single backtick. Runs of 2+ backticks are rare in prose
  // (literal-backtick spans) and intentionally ignored so the common
  // `<Component />` case is caught reliably.
  let inlineToggles = 0;
  let i = 0;
  while (i < currentLine.length) {
    if (currentLine[i] !== "`") {
      i++;
      continue;
    }
    let run = 0;
    while (i + run < currentLine.length && currentLine[i + run] === "`") {
      run++;
    }
    if (run === 1) inlineToggles++;
    i += run;
  }
  return inlineToggles % 2 === 1;
}

/**
 * Names that look like JSX components (PascalCase) imported into the MDX
 * via `import { ... }` or `import Foo` from any path. Imports from
 * `@/snippets/...` are tracked separately so recursive snippet imports can
 * be inlined by their import target instead of requiring every helper in
 * SNIPPET_MAP. Other imports are treated as runtime React components
 * resolved at render time via the docsComponents registry.
 */
function gatherMdxImportComponentInfo(source: string): {
  runtimeComponentNames: Set<string>;
  snippetRelByComponent: Map<string, string>;
} {
  const runtimeComponentNames = new Set<string>();
  const snippetRelByComponent = new Map<string, string>();
  const importRegex =
    /^import\s+(?:type\s+)?([\s\S]*?)\s+from\s+["']([^"']+)["']\s*;?\s*$/gm;
  let m: RegExpExecArray | null;
  while ((m = importRegex.exec(source)) !== null) {
    const importClause = m[1].trim();
    const importPath = m[2];
    const snippetRel = importPath.startsWith("@/snippets/")
      ? importPath.slice("@/snippets/".length)
      : null;
    const names = componentNamesFromImportClause(importClause);

    for (const name of names) {
      if (snippetRel) {
        snippetRelByComponent.set(name, snippetRel);
      } else {
        runtimeComponentNames.add(name);
      }
    }
  }
  return { runtimeComponentNames, snippetRelByComponent };
}

function componentNamesFromImportClause(importClause: string): string[] {
  const names = new Set<string>();
  const defaultMatch = importClause.match(/^([A-Z]\w*)\s*(?:,|$)/);
  if (defaultMatch) names.add(defaultMatch[1]);

  const namespaceMatch = importClause.match(/^\*\s+as\s+([A-Z]\w*)$/);
  if (namespaceMatch) names.add(namespaceMatch[1]);

  const namedMatch = importClause.match(/\{([^}]+)\}/);
  if (namedMatch) {
    for (const part of namedMatch[1].split(",")) {
      const renamed = part.trim().split(/\s+as\s+/);
      const name = renamed[renamed.length - 1].trim();
      if (/^[A-Z]\w*$/.test(name)) names.add(name);
    }
  }

  return [...names];
}

export function inlineSnippets(
  content: string,
  slugPath: string = "",
  seen: Set<string> = new Set(),
): string {
  const { runtimeComponentNames, snippetRelByComponent } =
    gatherMdxImportComponentInfo(content);
  let result = stripLeadingImports(content);

  result = result.replace(
    /<([A-Z]\w*)\s*(?:components=\{[^}]*\}\s*)?\/>/g,
    (match, componentName, offset: number, source: string) => {
      // Skip JSX-looking strings inside code fences / inline code: those
      // are rendered example code, not snippet imports. Suppresses the
      // bulk of `[docs-render] snippet missing` warnings that surfaced
      // post-cutover (e.g. <CopilotChat />, <YourApp />, <WeatherCard />
      // shown as usage examples inside ```tsx ... ``` blocks).
      if (isInsideCodeFence(source, offset)) {
        return match;
      }

      let snippetRel =
        SNIPPET_MAP[componentName] ?? snippetRelByComponent.get(componentName);

      if (!snippetRel && componentName === "SharedContent" && slugPath) {
        // The docs page could live at any of these URL shapes:
        //   - integrations/<framework>/<subpath>    (legacy per-framework docs)
        //   - unselected/<subpath>              (new unselected tree)
        //   - <subpath>                             (framework-scoped
        //                                            /<framework>/<subpath>,
        //                                            which arrives with no
        //                                            prefix here)
        // Try each shape in order to find a SUBPATH_TO_COMPONENT match.
        const candidateSubpaths: string[] = [];
        const integrationsMatch = slugPath.match(/^integrations\/[^/]+\/(.+)$/);
        if (integrationsMatch) candidateSubpaths.push(integrationsMatch[1]);
        if (slugPath.startsWith("unselected/")) {
          candidateSubpaths.push(slugPath.slice("unselected/".length));
        }
        candidateSubpaths.push(slugPath);

        for (const sub of candidateSubpaths) {
          const resolvedComponent = SUBPATH_TO_COMPONENT[sub];
          if (resolvedComponent) {
            snippetRel = SNIPPET_MAP[resolvedComponent];
            if (snippetRel) break;
          }
        }
      }

      if (!snippetRel) {
        // Components ending in `Icon` are conventionally lucide-react
        // icons. shell-docs's MDX renders them via the `docsComponents`
        // global registry in mdx-registry.tsx, so they're real runtime
        // React components — not snippet imports. Skip silently rather
        // than warn (matches the same shape as the fence-aware short
        // circuit above for `<CopilotChat />` in prose backticks).
        if (componentName.endsWith("Icon")) {
          return match;
        }
        // Icon-library components also hit the inliner as bare JSX
        // references (no explicit import — the registry provides them
        // via docsComponents at render time). Lucide square-prefixed
        // icons (SquareTerminal, SquareChartGantt, etc.), react-icons
        // fa/si/pi prefixes, and similar PascalCase + icon-library
        // shapes don't match the trailing-Icon filter above. Skip
        // them by name shape so the inliner doesn't log a warning for
        // every icon usage.
        if (/^(Fa|Si|Pi|Square)[A-Z]/.test(componentName)) {
          return match;
        }
        // Skip components the MDX explicitly imports. They're real React
        // components rendered through the docsComponents registry at
        // request time, not snippet references. stripLeadingImports()
        // above removes the import line; gatherMdxImportComponentInfo()
        // preserved the runtime import set so the inliner can tell these
        // apart from genuine missing-snippet cases.
        if (runtimeComponentNames.has(componentName)) {
          return match;
        }
        // Log so docs authors see a clean signal when a <Component />
        // reference can't be mapped to a snippet file (previously the
        // component just silently rendered nothing). Matches inside code
        // fences are short-circuited above so this warning only fires on
        // genuine prose-level references.
        console.warn(
          "[docs-render] snippet missing for component",
          componentName,
          "from slug",
          slugPath || "(none)",
        );
        return match;
      }
      // Even though snippetRel comes from the hardcoded SNIPPET_MAP,
      // route through resolveWithinDir for defense-in-depth — any
      // future addition that builds the relative path from user
      // input is guarded by default.
      const snippetPath = resolveWithinDir(SNIPPETS_DIR, snippetRel);
      if (!snippetPath || !fs.existsSync(snippetPath)) {
        console.warn(
          "[docs-render] snippet file not found",
          snippetRel,
          "for component",
          componentName,
          "from slug",
          slugPath || "(none)",
        );
        return match;
      }
      // Cycle protection: if this snippet file is already in-flight
      // higher up the recursion, emit a warning and stop. Without
      // this, a self-referencing or mutually-referencing snippet
      // loops until the stack overflows.
      if (seen.has(snippetPath)) {
        console.warn(
          "[docs-render] snippet cycle detected, refusing to re-inline",
          snippetPath,
        );
        return `{/* snippet cycle: ${componentName} */}`;
      }
      let snippetContent: string;
      try {
        snippetContent = fs.readFileSync(snippetPath, "utf-8");
      } catch (err) {
        // Previously a permission error / missing file mid-render
        // crashed the entire docs page. Log and leave the original
        // <Component /> reference in the rendered output.
        console.error("[docs-render] failed to read snippet", snippetPath, err);
        return match;
      }
      snippetContent = snippetContent.replace(/^---[\s\S]*?---\r?\n?/, "");
      const nextSeen = new Set(seen);
      nextSeen.add(snippetPath);
      return inlineSnippets(snippetContent, slugPath, nextSeen);
    },
  );

  return result;
}

// ---------------------------------------------------------------------------
// Markdown tables inside JSX container tags
// ---------------------------------------------------------------------------

// JSX container components whose inner Markdown table bodies should be
// promoted to real HTML tables. Previously only `Accordion` and `Tab`
// were covered, which silently failed for tables inside `Callout`,
// `Card`, `Step`, `Tabs`, etc. Keep this list in rough sync with the
// container-ish entries in mdx-registry.tsx — any JSX component that
// may wrap prose-like MDX bodies belongs here.
const JSX_CONTAINER_TAGS = [
  "Accordion",
  "Tab",
  "Tabs",
  "Callout",
  "Card",
  "Cards",
  "Step",
  "Steps",
];

// Split a GFM table row into cell values. GFM allows tables WITHOUT
// the outer leading/trailing pipes (e.g. "a | b | c"), so we can't
// unconditionally drop the first and last cells. Instead, drop a
// leading/trailing cell only when it's empty (the artifact of an outer
// pipe); keep genuine first/last cells.
function parseTableRow(line: string): string[] {
  const cells = line.split("|").map((cell) => cell.trim());
  if (cells.length > 0 && cells[0] === "") cells.shift();
  if (cells.length > 0 && cells[cells.length - 1] === "") cells.pop();
  return cells;
}

function convertMarkdownTableToHtml(tableLines: string[]): string {
  if (tableLines.length < 2) return tableLines.join("\n");

  const headers = parseTableRow(tableLines[0]);
  const separatorLine = tableLines[1];
  // Accept GFM separator lines with or without outer pipes. Must
  // contain at least one `|` and otherwise consist of spaces, colons,
  // and dashes only.
  if (
    !/^\s*[|:\- ]*\|[|:\- ]*\s*$/.test(separatorLine) ||
    !/\|/.test(separatorLine)
  ) {
    return tableLines.join("\n");
  }

  const bodyRows = tableLines.slice(2).map(parseTableRow);
  // Escape every interpolated cell value. Without this, any MDX table
  // cell containing `<script>`, `&`, or other HTML-significant chars
  // would inject raw HTML into the rendered page (XSS surface, since
  // the output is fed through dangerouslySetInnerHTML-style paths).
  // Covered by: docs pages that place untrusted-looking markup inside
  // `<Accordion>`/`<Callout>` table cells should render as literal text.
  // Emit attribute-free tags so next-mdx-remote parses the result as
  // valid JSX. Previously we set inline `style="..."` strings, but MDX
  // parses inline HTML as JSX, where `style` must be an object — a
  // string crashes the render. Styling comes from the
  // `.reference-content table` rules in globals.css.
  const headerHtml = headers.map((h) => `<th>${escapeHtml(h)}</th>`).join("");
  const bodyHtml = bodyRows
    .map(
      (row) =>
        "<tr>" +
        row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join("") +
        "</tr>",
    )
    .join("");

  return `<table><thead><tr>${headerHtml}</tr></thead><tbody>${bodyHtml}</tbody></table>`;
}

// A line looks like a table row when it contains at least one pipe
// that separates two non-empty cells OR has the classic leading-pipe
// form. Accepts both GFM variants (with / without outer pipes).
const isTableRow = (s: string): boolean =>
  /\S\s*\|\s*\S/.test(s) || /^\s*\|.+/.test(s);

// Separator: at least one pipe, otherwise only spaces, colons, dashes.
const isTableSeparator = (s: string): boolean =>
  /\|/.test(s) && /^\s*[|:\- ]+\s*$/.test(s);

export function convertTablesInJSX(content: string): string {
  const tagPattern = [...JSX_CONTAINER_TAGS]
    .sort((a, b) => b.length - a.length)
    .join("|");
  const regex = new RegExp(
    `(<(${tagPattern})(?:\\s[^>]*)?>)([\\s\\S]*?)(<\\/\\2>)`,
    "g",
  );

  return content.replace(
    regex,
    (
      match,
      openTag: string,
      tagName: string,
      inner: string,
      closeTag: string,
    ) => {
      // Non-greedy `[\s\S]*?` matches through the FIRST close tag of
      // any container in the set, so nested same-tag content (e.g.
      // `<Card>outer <Card>inner</Card> rest</Card>`) closes at the
      // inner `</Card>` and leaves `rest</Card>` stranded. Detect the
      // nesting and bail — the outer match is left untouched, which
      // renders correctly via MDX's own JSX handling (tables inside
      // nested containers simply won't be promoted to HTML tables).
      if (new RegExp(`<${tagName}(?:\\s|>)`).test(inner)) {
        return match;
      }
      const lines = inner.split("\n");
      const result: string[] = [];
      let i = 0;

      while (i < lines.length) {
        const line = lines[i];
        if (isTableRow(line)) {
          const tableLines: string[] = [];
          while (
            i < lines.length &&
            (isTableRow(lines[i]) || isTableSeparator(lines[i]))
          ) {
            tableLines.push(lines[i].trim());
            i++;
          }
          if (tableLines.length >= 2 && isTableSeparator(tableLines[1])) {
            result.push(convertMarkdownTableToHtml(tableLines));
          } else {
            result.push(...tableLines);
          }
        } else {
          result.push(line);
          i++;
        }
      }

      return openTag + result.join("\n") + closeTag;
    },
  );
}

// ---------------------------------------------------------------------------
// Framework / cell lookups
// ---------------------------------------------------------------------------

/**
 * Return the slugs of integrations that have a demo region tagged for
 * the given feature cell. The caller supplies the list of candidate
 * integration slugs and the demo-content map; this helper consults
 * `getDocsMode` to filter `docs_mode: hidden` frameworks out of the
 * result so cross-framework suggestions ("Try X, Y, Z") never point at
 * a 404 page.
 *
 * Shape of `demos`: keys are `"<integrationSlug>::<cell>"`; values are
 * opaque demo records (we only check key presence here).
 */
export function findFrameworksWithCell(
  cell: string,
  integrationSlugs: readonly string[],
  demos: Record<string, unknown>,
): string[] {
  const matches: string[] = [];
  for (const slug of integrationSlugs) {
    if (getDocsMode(slug) === "hidden") continue;
    if (demos[`${slug}::${cell}`]) matches.push(slug);
  }
  return matches;
}

// ---------------------------------------------------------------------------
// Frontmatter helpers
// ---------------------------------------------------------------------------

export interface DocFrontmatter {
  title: string;
  description?: string;
  defaultFramework?: string;
  defaultCell?: string;
  hideTOC?: boolean;
  frontend?: unknown;
  /**
   * Early-access gate id (see `src/lib/early-access.ts`). When set,
   * the page renders blurred behind the matching password gate.
   */
  earlyAccess?: string;
}

function slugSegments(slugPath: string): string[] | null {
  const segments = slugPath.split(/[\\/]+/).filter(Boolean);
  if (segments.some((segment) => segment === "." || segment === "..")) {
    return null;
  }
  return segments;
}

function routeGroupSubdirs(dir: string): string[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((entry) => entry.isDirectory() && isRouteGroupSegment(entry.name))
    .map((entry) => entry.name);
}

function resolveDocThroughRouteGroups(
  dir: string,
  segments: string[],
): string | null {
  if (segments.length === 0) {
    const indexPath = path.join(dir, "index.mdx");
    return fs.existsSync(indexPath) ? indexPath : null;
  }

  const [segment, ...rest] = segments;
  if (rest.length === 0) {
    const mdxPath = path.join(dir, `${segment}.mdx`);
    if (fs.existsSync(mdxPath)) return mdxPath;
    const indexPath = path.join(dir, segment, "index.mdx");
    if (fs.existsSync(indexPath)) return indexPath;
  }

  const directDir = path.join(dir, segment);
  if (fs.existsSync(directDir) && fs.statSync(directDir).isDirectory()) {
    const direct = resolveDocThroughRouteGroups(directDir, rest);
    if (direct) return direct;
  }

  for (const routeGroup of routeGroupSubdirs(dir)) {
    const grouped = resolveDocThroughRouteGroups(
      path.join(dir, routeGroup),
      segments,
    );
    if (grouped) return grouped;
  }

  return null;
}

function resolveRouteGroupedDocPath(slugPath: string): string | null {
  const segments = slugSegments(slugPath);
  if (!segments) return null;

  const filePath = resolveDocThroughRouteGroups(CONTENT_DIR, segments);
  if (!filePath) return null;

  const resolved = resolveWithinDir(
    CONTENT_DIR,
    path.relative(CONTENT_DIR, filePath),
  );
  return resolved && fs.existsSync(resolved) ? resolved : null;
}

/**
 * Load an MDX file by slug and return its raw source + parsed frontmatter
 * metadata for rendering. Returns null when the file doesn't exist.
 */
export function loadDoc(
  slugPath: string,
): { source: string; filePath: string; fm: DocFrontmatter } | null {
  // Guard against path traversal: slugPath is built from URL segments.
  // Without resolveWithinDir, a slug like `../../secrets` would escape
  // CONTENT_DIR via path.join and leak arbitrary files on disk.
  // Covered by: a request for /docs/..%2F..%2Fpackage must return 404.
  const mdxResolved = resolveWithinDir(CONTENT_DIR, `${slugPath}.mdx`);
  const indexResolved = resolveWithinDir(
    CONTENT_DIR,
    path.join(slugPath, "index.mdx"),
  );

  let filePath: string;
  if (mdxResolved && fs.existsSync(mdxResolved)) {
    filePath = mdxResolved;
  } else if (indexResolved && fs.existsSync(indexResolved)) {
    filePath = indexResolved;
  } else {
    // Route groups such as `(other)` organize the sidebar filesystem but
    // are not public URL segments. Resolve `/strands/telemetry` to
    // `integrations/aws-strands/(other)/telemetry/index.mdx`.
    const routeGroupedPath = resolveRouteGroupedDocPath(slugPath);
    if (!routeGroupedPath) return null;
    filePath = routeGroupedPath;
  }

  let source: string;
  try {
    source = fs.readFileSync(filePath, "utf-8");
  } catch (err) {
    // Can't read the MDX — log and treat as a missing doc so the
    // caller renders a 404 rather than crashing the request.
    console.error("[docs-render] failed to read", filePath, err);
    return null;
  }

  // Parse frontmatter with gray-matter rather than a hand-rolled
  // regex: handles quoted values, folded YAML, multiline descriptions,
  // and CRLF line endings correctly. Previously the regex split on
  // `^---\n` and missed anything Windows-authored.
  let data: Record<string, unknown> = {};
  let parsed: { data: Record<string, unknown> } | null = null;
  try {
    parsed = matter(source);
    data = parsed.data ?? {};
  } catch (err) {
    // Malformed YAML — don't crash the page, just render with an empty
    // frontmatter and let the title fall back to the first H1.
    console.error("[docs-render] failed to parse frontmatter", filePath, err);
  }

  const rawTitle = typeof data.title === "string" ? data.title : undefined;
  const headingMatch = rawTitle ? null : source.match(/^#\s+(.+)$/m);
  const title =
    rawTitle ||
    headingMatch?.[1] ||
    slugPath.split("/").pop()?.replace(/-/g, " ") ||
    "Docs";

  const description =
    typeof data.description === "string" ? data.description : undefined;
  const defaultFramework =
    typeof data.snippet_framework === "string"
      ? data.snippet_framework
      : undefined;
  const defaultCell =
    typeof data.snippet_cell === "string" ? data.snippet_cell : undefined;
  const hideTOC = data.hideTOC === true;
  const frontend = data.frontend;
  const earlyAccess =
    typeof data.earlyAccess === "string" ? data.earlyAccess : undefined;

  return {
    source,
    filePath,
    fm: {
      title,
      description,
      defaultFramework,
      defaultCell,
      hideTOC,
      frontend,
      earlyAccess,
    },
  };
}

// ---------------------------------------------------------------------------
// Breadcrumbs
// ---------------------------------------------------------------------------

export type Breadcrumb = { label: string; href: string | null };

export function buildBreadcrumbs(
  slugPath: string,
  opts: { rootLabel: string; rootHref: string | null; slugHrefPrefix: string },
): Breadcrumb[] {
  const parts = slugPath ? slugPath.split("/").filter(Boolean) : [];
  const crumbs: Breadcrumb[] = [{ label: opts.rootLabel, href: opts.rootHref }];

  for (let i = 0; i < parts.length; i++) {
    const partialSlug = parts.slice(0, i + 1).join("/");
    const href = `${opts.slugHrefPrefix}/${partialSlug}`;
    const isLast = i === parts.length - 1;

    // Guard against path traversal on user-supplied slug segments.
    // A resolved path that escapes CONTENT_DIR becomes null and we
    // fall through to the slug-derived label.
    const mdxFile = resolveWithinDir(CONTENT_DIR, `${partialSlug}.mdx`);
    const indexFile = resolveWithinDir(
      CONTENT_DIR,
      path.join(partialSlug, "index.mdx"),
    );
    const dirResolved = resolveWithinDir(CONTENT_DIR, partialSlug);
    const dirMeta = dirResolved ? readMeta(dirResolved) : null;

    let label: string | null = null;
    if (dirMeta?.title) {
      label = dirMeta.title;
    } else if (mdxFile && fs.existsSync(mdxFile)) {
      label = readTitle(mdxFile);
    } else if (indexFile && fs.existsSync(indexFile)) {
      label = readTitle(indexFile);
    }
    if (!label) {
      label = parts[i]
        .replace(/-/g, " ")
        .replace(/\b\w/g, (c) => c.toUpperCase());
    }

    crumbs.push({ label, href: isLast ? null : href });
  }

  return crumbs;
}
