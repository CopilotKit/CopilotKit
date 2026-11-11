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
import { parseFrontmatter } from "./frontmatter";
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
  "build generative ui": "lucide/LayoutTemplate",
  "add agent powers": "lucide/Wand2",
  runtime: "lucide/Cpu",
  "observe & operate": "lucide/SearchCheck",
  intelligence: "custom/copilotkit-kite",
  "intelligence platform": "custom/copilotkit-kite",
  channels: "lucide/MessagesSquare",
  deploy: "lucide/Cloud",
  deployment: "lucide/Cloud",
  other: "lucide/Wrench",
  // Built-in Agent (authored) sections — match the section names in
  // `content/docs/integrations/built-in-agent/meta.json`. Adjust here
  // when those section labels change in that meta.json.
  "getting started": "lucide/Rocket",
  basics: "lucide/Sprout",
  "generative ui": "lucide/LayoutTemplate",
  "app control": "lucide/WandSparkles",
  interactivity: "lucide/MousePointer",
  "agent capabilities": "lucide/Sparkles",
  "built-in agent": "lucide/Bot",
  backend: "lucide/Server",
  learn: "lucide/BookOpen",
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
    pages?: MetaPageEntry[];
    root?: boolean;
    icon?: string;
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

/**
 * The route group holding the frontend-neutral pages every frontend has
 * (runtime, Intelligence, concepts, ...). Its `meta.json` lists the sections
 * that close every sidebar; the group isn't part of a page's URL.
 */
export const SHARED_GROUP = "(shared)";

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

    // A link entry, `[Title](/path)`, is a row for the page at that URL
    // (`[Overview](/AG-UI-Streams)`); the docs app draws it under the
    // link's title. An off-site link has no page behind it.
    const linkMatch = entry.match(/^\[(.+)\]\((.+)\)$/);
    if (linkMatch) {
      const [, title, url] = linkMatch;
      nodes.push(
        url.startsWith("/") && !url.startsWith("//")
          ? {
              type: "page",
              title,
              slug: url.split(/[?#]/)[0].replace(/^\/+|\/+$/g, ""),
            }
          : { type: "page", title, slug: "", href: url },
      );
      continue;
    }

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
    // doesn't yet exist on disk — since a framework's landing is the
    // bare `/<framework>` URL where the data-driven `FrameworkOverview`
    // renders. Title falls back to "Introduction" when no MDX is present
    // to read from.
    if (entry === "index") {
      const title = fs.existsSync(mdxFile)
        ? readTitle(mdxFile) || "Introduction"
        : "Introduction";
      // At the docs root (no prefix), `"index"` represents the bare
      // `/` page (the unscoped docs landing). Rewrite the slug to ""
      // so the bridge builds `/` rather than `/index`. Inside a
      // sub-folder, `"index"` keeps the folder-relative slug (e.g.
      // `agentic-protocols/index`); `buildFrameworkNav` rewrites a
      // framework's onto its framework URL.
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
      // An explicitly listed nested index is a direct link to the folder
      // root, not a separate `/index` route. This lets a section expose an
      // Overview page without wrapping a one-page folder around it.
      const pageSlug = slug.endsWith("/index")
        ? slug.slice(0, -"/index".length)
        : slug;
      nodes.push({
        type: "page",
        title,
        slug: pageSlug,
        icon: icon ?? undefined,
      });
    } else if (fs.existsSync(subDir) && fs.statSync(subDir).isDirectory()) {
      const subMeta = readMeta(subDir);
      if (subMeta?.root) continue;
      const subPrefix = prefix ? `${prefix}/${entry}` : entry;

      if (subMeta?.pages) {
        const subChildren = buildNavTree(subDir, subPrefix);
        // Fumadocs makes a folder's own `index.mdx` the folder's page even
        // when its meta.json doesn't list `"index"` (the docs app's pages
        // don't), so count it as reachable too.
        if (fs.existsSync(indexFile) && !subMeta.pages.includes("index")) {
          subChildren.unshift({
            type: "page",
            title:
              readTitle(indexFile) || subMeta.title || entry.replace(/-/g, " "),
            slug: subPrefix,
            icon: readIcon(indexFile) ?? undefined,
          });
        }
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

// ---------------------------------------------------------------------------
// Sidebars
// ---------------------------------------------------------------------------

const AGENT_CAPABILITIES = "Agent capabilities";

/** A tree's slugs as URLs: route groups (`(shared)/webmcp`) aren't in them. */
function withoutRouteGroups(nodes: NavNode[]): NavNode[] {
  return nodes.map(withoutRouteGroupSegments);
}

function withoutRouteGroupSegments(node: NavNode): NavNode {
  if (node.type === "section") return node;
  const slug = node.slug
    .split("/")
    .filter((segment) => !isRouteGroupSegment(segment))
    .join("/");
  if (node.type === "page") return { ...node, slug };
  return {
    ...node,
    slug,
    children: node.children.map(withoutRouteGroupSegments),
  };
}

/**
 * A framework's sidebar, composed the way the docs app composes it
 * (shell-docs/src/proto/live-tree.tsx): the app frontends' outline
 * (`docs/meta.json`) with the framework's own pages as one group leading
 * "Agent capabilities", then the sections in `docs/(shared)/meta.json` that
 * close every sidebar. Every framework gets this shape; the built-in agent's
 * is the one the unscoped URLs show.
 *
 * Takes the docs folder (`getDocsFolder(slug)` from lib/registry), not the
 * URL slug: langgraph-python, -typescript and -fastapi share `langgraph/`.
 */
export function buildFrameworkNav(
  folder: string,
  frameworkName?: string,
): NavNode[] {
  const outline = withoutRouteGroups(buildNavTree(CONTENT_DIR));
  const shared = withoutRouteGroups(
    buildNavTree(path.join(CONTENT_DIR, SHARED_GROUP), SHARED_GROUP),
  );
  const own = frameworkGroup(folder, frameworkName);
  if (!own) return [...outline, ...shared];
  const at = outline.findIndex(
    (node) => node.type === "section" && node.title === AGENT_CAPABILITIES,
  );
  const withOwn: NavNode[] =
    at === -1
      ? [
          ...outline,
          {
            type: "section",
            title: AGENT_CAPABILITIES,
            icon: sectionIconFor(AGENT_CAPABILITIES),
          },
          own,
        ]
      : [...outline.slice(0, at + 1), own, ...outline.slice(at + 1)];
  return [...withOwn, ...shared];
}

/**
 * The framework's own pages (`integrations/<folder>/meta.json`) as one group
 * named for it, at their framework URLs: `integrations/mastra/background-tasks`
 * is `background-tasks`, and a folder's `index` is the folder. Its landing
 * and quickstart are left out, since the outline's top rows open them; so
 * are its section headers. Null when nothing else is left.
 */
function frameworkGroup(
  folder: string,
  frameworkName?: string,
): NavNode | null {
  const dir = path.join(CONTENT_DIR, "integrations", folder);
  if (!fs.existsSync(dir)) return null;
  const prefix = `integrations/${folder}`;
  const atFrameworkUrl = (slug: string): string => {
    const topic = slug.startsWith(`${prefix}/`)
      ? slug.slice(prefix.length + 1)
      : slug;
    return topic === "index" ? "" : topic.replace(/\/index$/, "");
  };
  const rewrite = (node: NavNode): NavNode => {
    if (node.type === "section") return node;
    if (node.type === "page")
      return { ...node, slug: atFrameworkUrl(node.slug) };
    return {
      ...node,
      slug: atFrameworkUrl(node.slug),
      children: node.children.map(rewrite),
    };
  };
  const children = buildNavTree(dir, prefix)
    .map(rewrite)
    .filter(
      (node) =>
        node.type === "group" ||
        (node.type === "page" &&
          node.slug !== "" &&
          node.slug !== "quickstart"),
    );
  if (children.length === 0) return null;
  const title = frameworkName ?? readMeta(dir)?.title ?? folder;
  // No page behind the group; the `#` keeps its key from reading as a URL.
  return { type: "group", title, slug: `${prefix}#${title}`, children };
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
  Inspector: "shared/intelligence/inspector.mdx",
  Interactive: "shared/generative-ui/interactive.mdx",
  MCPApps: "shared/generative-ui/mcp-apps.mdx",
  MCPSetup: "shared/guides/mcp-server-setup.mdx",
  MigrateTo1100: "shared/troubleshooting/migrate-to-1.10.X.mdx",
  MigrateTo182: "shared/troubleshooting/migrate-to-1.8.2.mdx",
  MigrateToV2: "shared/troubleshooting/migrate-to-v2.mdx",
  Overview: "shared/intelligence/overview.mdx",
  PrebuiltComponents: "shared/basics/prebuilt-components.mdx",
  ProgrammaticControl: "shared/basics/programmatic-control.mdx",
  ReasoningMessages:
    "shared/guides/custom-look-and-feel/reasoning-messages.mdx",
  SelfHosting: "shared/intelligence/self-hosting.mdx",
  Slots: "shared/basics/slots.mdx",
  HeadlessThreads: "shared/threads/headless-threads.mdx",
  Threads: "shared/threads/headless-threads.mdx",
  ThreadsOverview: "shared/threads/overview.mdx",
  // Local / Self-hosted FastAPI / LangGraph-Platform deployment-URL tabs,
  // reused by the LangSmith deploy partial. Registered here (not just in
  // mdx-registry's STUB_PARTIAL_MAP) so inlineSnippets resolves it and
  // doesn't emit a spurious "snippet missing" warning.
  LangGraphPlatformDeploymentTabs: "langgraph-platform-deployment-tabs.mdx",
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
  "intelligence/headless-ui": "HeadlessUI",
  "intelligence/overview": "Overview",
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
        if (
          runtimeComponentNames.has(componentName) ||
          componentName === "PageAgentPrompt"
        ) {
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
  full?: boolean;
  hideBreadcrumb?: boolean;
  hideTOC?: boolean;
  hideHeader?: boolean;
  hidePageActions?: boolean;
  /**
   * Page-specific prompt for the page-tools "Copy prompt" action. When set,
   * the action copies this text instead of the generic onboarding prompt.
   */
  agentPrompt?: string;
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
    parsed = parseFrontmatter(source);
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
  const full = data.full === true;
  const hideBreadcrumb = data.hideBreadcrumb === true;
  const hideTOC = data.hideTOC === true;
  const hideHeader = data.hideHeader === true;
  const hidePageActions = data.hidePageActions === true;
  const agentPrompt =
    typeof data.agentPrompt === "string" && data.agentPrompt.trim()
      ? data.agentPrompt.trim()
      : undefined;
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
      full,
      hideBreadcrumb,
      hideTOC,
      hideHeader,
      hidePageActions,
      agentPrompt,
      earlyAccess,
    },
  };
}

// ---------------------------------------------------------------------------
// Breadcrumbs
// ---------------------------------------------------------------------------

export type Breadcrumb = { label: string; href: string | null };

function normalizeNavSlug(slug: string): string {
  return slug.replace(/\/index$/, "");
}

function navNodeContainsSlug(node: NavNode, slugPath: string): boolean {
  if (node.type === "section") return false;
  if (node.type === "group") {
    return node.children.some((child) => navNodeContainsSlug(child, slugPath));
  }

  return normalizeNavSlug(node.slug) === normalizeNavSlug(slugPath);
}

function navGroupTrailForSlug(
  node: NavNode,
  slugPath: string,
): string[] | null {
  if (node.type === "section") return null;
  if (node.type === "page") {
    return normalizeNavSlug(node.slug) === normalizeNavSlug(slugPath)
      ? []
      : null;
  }

  for (const child of node.children) {
    const childTrail = navGroupTrailForSlug(child, slugPath);
    if (childTrail !== null) {
      return node.title ? [node.title, ...childTrail] : childTrail;
    }
  }

  return null;
}

/** Return the visible sidebar hierarchy above a guide page. */
export function navAncestorBreadcrumbsForSlug(
  navTree: NavNode[],
  slugPath: string,
): Breadcrumb[] | null {
  let currentSection: string | null = null;

  for (const node of navTree) {
    if (node.type === "section") {
      currentSection = node.title;
      continue;
    }

    const groupTrail = navGroupTrailForSlug(node, slugPath);
    if (groupTrail === null) continue;

    const labels = currentSection
      ? [currentSection, ...groupTrail]
      : groupTrail;
    return labels.map((label) => ({
      label,
      href: null,
    }));
  }

  return null;
}

/** Return the sidebar section that contains a guide page. */
export function navSectionTitleForSlug(
  navTree: NavNode[],
  slugPath: string,
): string | null {
  let currentSection: string | null = null;
  for (const node of navTree) {
    if (node.type === "section") {
      currentSection = node.title;
    } else if (navNodeContainsSlug(node, slugPath)) {
      return currentSection;
    }
  }
  return null;
}

/**
 * Turn a guide page's full breadcrumb trail into the ancestors shown above
 * its title. The title already represents the current page, and the generic
 * "Docs" root adds no information inside the guide surface. Named framework
 * roots and first-level sections such as Cookbook remain visible. When a
 * URL-level folder belongs to a broader sidebar section, prepend that section
 * so paths such as AG-UI retain the visible Concepts hierarchy.
 */
export function visibleGuideBreadcrumbs(
  breadcrumbs: Breadcrumb[],
  sectionTitle?: string | null,
): Breadcrumb[] {
  const ancestors = breadcrumbs.slice(0, -1);
  const hasGenericRoot = ancestors[0]?.label === "Docs";
  const visible = hasGenericRoot ? ancestors.slice(1) : ancestors;
  const isCookbook = breadcrumbs[1]?.label === "Cookbook";

  if (
    !hasGenericRoot ||
    !sectionTitle ||
    isCookbook ||
    visible[0]?.label === sectionTitle
  ) {
    return visible;
  }

  return [{ label: sectionTitle, href: null }, ...visible];
}

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

    // A URL's folder is at the content root or, for a frontend-neutral
    // page, in `(shared)`, which isn't in the URL.
    const baseDir =
      [CONTENT_DIR, path.join(CONTENT_DIR, SHARED_GROUP)].find((dir) => {
        const resolved = resolveWithinDir(dir, partialSlug);
        return (
          resolved &&
          (fs.existsSync(resolved) || fs.existsSync(`${resolved}.mdx`))
        );
      }) ?? CONTENT_DIR;

    // Guard against path traversal on user-supplied slug segments.
    // A resolved path that escapes baseDir becomes null and we
    // fall through to the slug-derived label.
    const mdxFile = resolveWithinDir(baseDir, `${partialSlug}.mdx`);
    const indexFile = resolveWithinDir(
      baseDir,
      path.join(partialSlug, "index.mdx"),
    );
    const dirResolved = resolveWithinDir(baseDir, partialSlug);
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

    const hasLandingPage =
      (mdxFile && fs.existsSync(mdxFile)) ||
      (indexFile && fs.existsSync(indexFile));
    crumbs.push({ label, href: isLast || !hasLandingPage ? null : href });
  }

  return crumbs;
}
