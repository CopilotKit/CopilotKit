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

export const CONTENT_DIR = path.join(process.cwd(), "src/content/docs");
export const SNIPPETS_DIR = path.join(CONTENT_DIR, "..", "snippets");

/**
 * Canonical category ordering for the framework picker / integrations
 * grid / sidebar framework selector. Defined here so every consumer
 * imports the same source of truth.
 *
 * Consumer files (sidebar-framework-selector.tsx, [[...slug]]/page.tsx)
 * previously defined this constant independently — any drift between
 * the copies would show up as divergent category ordering across the
 * UI. Follow-up: once all consumers import from here, remove their
 * local duplicates (owned by later blitz agents / registry refactor).
 */
export const FRAMEWORK_CATEGORY_ORDER = [
  "popular",
  "agent-framework",
  "provider-sdk",
  "enterprise-platform",
  "protocol",
  "emerging",
  "starter",
] as const;

export type FrameworkCategory = (typeof FRAMEWORK_CATEGORY_ORDER)[number];

// ---------------------------------------------------------------------------
// Nav tree types
// ---------------------------------------------------------------------------

export type NavNode =
  | { type: "page"; title: string; slug: string }
  | { type: "section"; title: string }
  | { type: "group"; title: string; slug: string; children: NavNode[] };

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
// cache each call reopens and re-parses the file from disk. We accept
// stale-during-process semantics: the cache lives for the life of the
// Node process, which matches Next.js build-time and server runtime
// lifetimes. Caches are keyed by absolute path.
//
// Memory footprint: titles are tiny strings, meta is a small JSON
// object — negligible even with hundreds of docs files.
const titleCache = new Map<string, string | null>();
const metaCache = new Map<
  string,
  { title?: string; pages?: string[]; root?: boolean } | null
>();

export function readTitle(filePath: string): string | null {
  const cacheKey = path.resolve(filePath);
  if (titleCache.has(cacheKey)) return titleCache.get(cacheKey)!;

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
  const fmMatch = fm.match(/^title:\s*["']?(.+?)["']?\s*$/m);
  let title: string | null = null;
  if (fmMatch) {
    title = fmMatch[1].replace(/["']$/, "");
  } else {
    const headingMatch = raw.match(/^#\s+(.+)$/m);
    if (headingMatch) title = headingMatch[1];
  }
  titleCache.set(cacheKey, title);
  return title;
}

export function readMeta(
  dir: string,
): { title?: string; pages?: string[]; root?: boolean } | null {
  const metaPath = path.join(dir, "meta.json");
  const cacheKey = path.resolve(metaPath);
  if (metaCache.has(cacheKey)) return metaCache.get(cacheKey)!;

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
  const meta = readMeta(dir);
  if (!meta) return buildNavTreeFromFilesystem(dir, prefix);

  const pages = meta.pages;
  if (!pages || !Array.isArray(pages)) {
    return buildNavTreeFromFilesystem(dir, prefix);
  }

  const nodes: NavNode[] = [];

  for (const entry of pages) {
    const sectionMatch = entry.match(/^---(.+)---$/);
    if (sectionMatch) {
      nodes.push({ type: "section", title: sectionMatch[1] });
      continue;
    }

    if (entry.startsWith("[")) continue;

    const spreadMatch = entry.match(/^\.\.\.(.+)$/);
    if (spreadMatch) {
      const subDir = path.join(dir, spreadMatch[1]);
      const subPrefix = prefix ? `${prefix}/${spreadMatch[1]}` : spreadMatch[1];
      if (fs.existsSync(subDir) && fs.statSync(subDir).isDirectory()) {
        const subMeta = readMeta(subDir);
        const subChildren = buildNavTree(subDir, subPrefix);
        if (subChildren.length > 0) {
          const groupTitle =
            subMeta?.title ||
            spreadMatch[1].replace(/[()-]/g, " ").replace(/\s+/g, " ").trim();
          nodes.push({
            type: "group",
            title: groupTitle.charAt(0).toUpperCase() + groupTitle.slice(1),
            slug: subPrefix,
            children: subChildren,
          });
        }
      }
      continue;
    }

    const slug = prefix ? `${prefix}/${entry}` : entry;
    const mdxFile = path.join(dir, `${entry}.mdx`);
    const indexFile = path.join(dir, entry, "index.mdx");
    const subDir = path.join(dir, entry);

    if (fs.existsSync(mdxFile)) {
      const title =
        readTitle(mdxFile) || entry.split("/").pop()!.replace(/-/g, " ");
      nodes.push({ type: "page", title, slug });
    } else if (fs.existsSync(subDir) && fs.statSync(subDir).isDirectory()) {
      const subMeta = readMeta(subDir);
      const subPrefix = prefix ? `${prefix}/${entry}` : entry;

      if (subMeta?.pages) {
        const subChildren = buildNavTree(subDir, subPrefix);
        const groupTitle = subMeta.title || entry.replace(/-/g, " ");
        nodes.push({
          type: "group",
          title: groupTitle.charAt(0).toUpperCase() + groupTitle.slice(1),
          slug: subPrefix,
          children: subChildren,
        });
      } else if (fs.existsSync(indexFile)) {
        const title =
          readTitle(indexFile) || subMeta?.title || entry.replace(/-/g, " ");
        nodes.push({ type: "page", title, slug: subPrefix });
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
      const subChildren = buildNavTree(path.join(dir, entry.name), slug);
      const subMeta = readMeta(path.join(dir, entry.name));
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
  Observability: "shared/premium/observability.mdx",
  ObservabilityConnectors:
    "shared/troubleshooting/observability-connectors.mdx",
  Overview: "shared/premium/overview.mdx",
  PrebuiltComponents: "shared/basics/prebuilt-components.mdx",
  ProgrammaticControl: "shared/basics/programmatic-control.mdx",
  ReasoningMessages:
    "shared/guides/custom-look-and-feel/reasoning-messages.mdx",
  Slots: "shared/basics/slots.mdx",
  ToolRendering: "shared/generative-ui/tool-rendering.mdx",
  DefaultToolRendering: "shared/guides/default-tool-rendering.mdx",
};

export const SUBPATH_TO_COMPONENT: Record<string, string> = {
  "ag-ui": "AGUI",
  "coding-agents": "CodingAgents",
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
  "premium/observability": "Observability",
  "premium/overview": "Overview",
  "troubleshooting/common-issues": "CommonIssues",
  "troubleshooting/error-debugging": "ErrorDebugging",
  "troubleshooting/migrate-to-1.10.X": "MigrateTo1100",
  "troubleshooting/migrate-to-1.8.2": "MigrateTo182",
  "troubleshooting/migrate-to-v2": "MigrateToV2",
  "troubleshooting/observability-connectors": "ObservabilityConnectors",
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
function stripLeadingImports(source: string): string {
  const lines = source.split("\n");
  const out: string[] = [];
  let inFence = false;
  let fenceMarker: string | null = null;
  let pastHeader = false;

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
      if (/^\s*$/.test(line)) {
        // Preserve blank lines in the header region for layout.
        out.push(line);
        continue;
      }
      if (/^import\s+.+$/.test(line)) {
        // Drop this top-of-file MDX import line.
        continue;
      }
      // First real content line flips us out of "header" mode.
      pastHeader = true;
    }

    out.push(line);
  }

  return out.join("\n");
}

export function inlineSnippets(
  content: string,
  slugPath: string = "",
  seen: Set<string> = new Set(),
): string {
  let result = stripLeadingImports(content);

  result = result.replace(
    /<([A-Z]\w*)\s*(?:components=\{[^}]*\}\s*)?\/>/g,
    (match, componentName) => {
      let snippetRel = SNIPPET_MAP[componentName];

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
        // Log so docs authors see a clean signal when a <Component />
        // reference can't be mapped to a snippet file (previously the
        // component just silently rendered nothing).
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
        console.error(
          "[docs-render] failed to read snippet",
          snippetPath,
          err,
        );
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
  const headerHtml = headers
    .map(
      (h) =>
        `<th style="padding:6px 12px;border:1px solid var(--border);text-align:left;font-size:0.875rem">${escapeHtml(h)}</th>`,
    )
    .join("");
  const bodyHtml = bodyRows
    .map(
      (row) =>
        "<tr>" +
        row
          .map(
            (cell) =>
              `<td style="padding:6px 12px;border:1px solid var(--border);font-size:0.875rem">${escapeHtml(cell)}</td>`,
          )
          .join("") +
        "</tr>",
    )
    .join("\n");

  return `<table style="width:100%;border-collapse:collapse;margin:0.75rem 0"><thead><tr>${headerHtml}</tr></thead><tbody>\n${bodyHtml}\n</tbody></table>`;
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
  const tagPattern = JSX_CONTAINER_TAGS.join("|");
  const regex = new RegExp(
    `(<(?:${tagPattern})[^>]*>)([\\s\\S]*?)(<\\/(?:${tagPattern})>)`,
    "g",
  );

  return content.replace(
    regex,
    (_match, openTag: string, inner: string, closeTag: string) => {
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
// Frontmatter helpers
// ---------------------------------------------------------------------------

export interface DocFrontmatter {
  title: string;
  description?: string;
  defaultFramework?: string;
  defaultCell?: string;
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
    return null;
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

  return {
    source,
    filePath,
    fm: {
      title,
      description,
      defaultFramework,
      defaultCell,
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
  const parts = slugPath.split("/");
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
