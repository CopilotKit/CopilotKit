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

export const CONTENT_DIR = path.join(process.cwd(), "src/content/docs");
export const SNIPPETS_DIR = path.join(CONTENT_DIR, "..", "snippets");

// ---------------------------------------------------------------------------
// Nav tree types
// ---------------------------------------------------------------------------

export type NavNode =
  | { type: "page"; title: string; slug: string }
  | { type: "section"; title: string }
  | { type: "group"; title: string; slug: string; children: NavNode[] };

export function readTitle(filePath: string): string | null {
  if (!fs.existsSync(filePath)) return null;
  const raw = fs.readFileSync(filePath, "utf-8");
  const fmMatch = raw.match(/title:\s*["']?(.+?)["']?\s*$/m);
  if (fmMatch) return fmMatch[1].replace(/["']$/, "");
  const headingMatch = raw.match(/^#\s+(.+)$/m);
  if (headingMatch) return headingMatch[1];
  return null;
}

export function readMeta(
  dir: string,
): { title?: string; pages?: string[]; root?: boolean } | null {
  const metaPath = path.join(dir, "meta.json");
  if (!fs.existsSync(metaPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(metaPath, "utf-8"));
  } catch {
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
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
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

export const SNIPPET_MAP: Record<string, string> = {
  A2UI: "shared/generative-ui/a2ui.mdx",
  AgUI: "shared/backend/ag-ui.mdx",
  AGUI: "shared/backend/ag-ui.mdx",
  CodingAgents: "shared/coding-agents.mdx",
  CommonIssues: "shared/troubleshooting/common-issues.mdx",
  CopilotRuntime: "copilot-runtime.mdx",
  CustomAgent: "shared/backend/custom-agent.mdx",
  DebugMode: "shared/troubleshooting/debug-mode.mdx",
  DisplayOnly: "shared/generative-ui/display-only.mdx",
  ErrorDebugging: "shared/troubleshooting/error-debugging.mdx",
  FrontendTools: "shared/app-control/frontend-tools.mdx",
  FrontEndToolsImpl: "shared/app-control/frontend-tools.mdx",
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

export function inlineSnippets(content: string, slugPath: string = ""): string {
  let result = content.replace(/^import\s+.+$/gm, "");

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

      if (!snippetRel) return match;
      const snippetPath = path.join(SNIPPETS_DIR, snippetRel);
      if (!fs.existsSync(snippetPath)) return match;
      let snippetContent = fs.readFileSync(snippetPath, "utf-8");
      snippetContent = snippetContent.replace(/^---[\s\S]*?---\n?/, "");
      snippetContent = snippetContent.replace(/^import\s+.+$/gm, "");
      return inlineSnippets(snippetContent, slugPath);
    },
  );

  return result;
}

// ---------------------------------------------------------------------------
// Markdown tables inside JSX container tags
// ---------------------------------------------------------------------------

const JSX_CONTAINER_TAGS = ["Accordion", "Tab"];

function convertMarkdownTableToHtml(tableLines: string[]): string {
  if (tableLines.length < 2) return tableLines.join("\n");

  const parseRow = (line: string): string[] =>
    line
      .split("|")
      .slice(1, -1)
      .map((cell) => cell.trim());

  const headers = parseRow(tableLines[0]);
  const separatorLine = tableLines[1];
  if (!/^\s*\|[\s:|-]+\|\s*$/.test(separatorLine)) {
    return tableLines.join("\n");
  }

  const bodyRows = tableLines.slice(2).map(parseRow);
  const headerHtml = headers
    .map(
      (h) =>
        `<th style="padding:6px 12px;border:1px solid var(--border);text-align:left;font-size:0.875rem">${h}</th>`,
    )
    .join("");
  const bodyHtml = bodyRows
    .map(
      (row) =>
        "<tr>" +
        row
          .map(
            (cell) =>
              `<td style="padding:6px 12px;border:1px solid var(--border);font-size:0.875rem">${cell}</td>`,
          )
          .join("") +
        "</tr>",
    )
    .join("\n");

  return `<table style="width:100%;border-collapse:collapse;margin:0.75rem 0"><thead><tr>${headerHtml}</tr></thead><tbody>\n${bodyHtml}\n</tbody></table>`;
}

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
        if (/^\s*\|.+\|/.test(line)) {
          const tableLines: string[] = [];
          while (i < lines.length && /^\s*\|.+\|/.test(lines[i])) {
            tableLines.push(lines[i].trim());
            i++;
          }
          if (
            tableLines.length >= 2 &&
            /^\s*\|[\s:|-]+\|\s*$/.test(tableLines[1])
          ) {
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
  let filePath = path.join(CONTENT_DIR, `${slugPath}.mdx`);
  if (!fs.existsSync(filePath)) {
    const indexPath = path.join(CONTENT_DIR, slugPath, "index.mdx");
    if (fs.existsSync(indexPath)) {
      filePath = indexPath;
    } else {
      return null;
    }
  }

  const source = fs.readFileSync(filePath, "utf-8");
  const fmMatch = source.match(/^---([\s\S]*?)---/);
  const fm = fmMatch?.[1] ?? "";
  const titleMatch =
    source.match(/title:\s*["']?(.+?)["']?\s*$/m) ||
    source.match(/^#\s+(.+)$/m);
  const title =
    titleMatch?.[1]?.replace(/["']$/, "") ||
    slugPath.split("/").pop()?.replace(/-/g, " ") ||
    "Docs";

  const descriptionMatch = fm.match(/^description:\s*(.+?)\s*$/m);
  const description = descriptionMatch?.[1]?.replace(/^["']|["']$/g, "");
  const snippetFrameworkMatch = fm.match(/snippet_framework:\s*(.+?)\s*$/m);
  const snippetCellMatch = fm.match(/snippet_cell:\s*(.+?)\s*$/m);

  return {
    source,
    filePath,
    fm: {
      title,
      description,
      defaultFramework: snippetFrameworkMatch?.[1]?.replace(/["']/g, ""),
      defaultCell: snippetCellMatch?.[1]?.replace(/["']/g, ""),
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

    const mdxFile = path.join(CONTENT_DIR, `${partialSlug}.mdx`);
    const indexFile = path.join(CONTENT_DIR, partialSlug, "index.mdx");
    const dirMeta = readMeta(path.join(CONTENT_DIR, partialSlug));

    let label: string | null = null;
    if (dirMeta?.title) {
      label = dirMeta.title;
    } else if (fs.existsSync(mdxFile)) {
      label = readTitle(mdxFile);
    } else if (fs.existsSync(indexFile)) {
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
