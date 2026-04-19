import React from "react";
import fs from "fs";
import path from "path";
import { notFound } from "next/navigation";
import { MDXRemote } from "next-mdx-remote/rsc";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import Link from "next/link";
import {
  Callout,
  Cards,
  Card,
  Accordions,
  Accordion,
} from "@/components/mdx-components";
import { PropertyReference } from "@/components/property-reference";
import { getRegistry } from "@/lib/registry";
import { SidebarNav } from "@/components/sidebar-nav";
import { Snippet } from "@/components/snippet";

const CONTENT_DIR = path.join(process.cwd(), "src/content/docs");
// Resolve snippets relative to CONTENT_DIR (which is known to work for filesystem reads)
const SNIPPETS_DIR = path.join(CONTENT_DIR, "..", "snippets");

// ---------------------------------------------------------------------------
// Nav tree types & builder
// ---------------------------------------------------------------------------

type NavNode =
  | { type: "page"; title: string; slug: string }
  | { type: "section"; title: string }
  | { type: "group"; title: string; slug: string; children: NavNode[] };

/** Read the title from an MDX file's frontmatter or first heading. */
function readTitle(filePath: string): string | null {
  if (!fs.existsSync(filePath)) return null;
  const raw = fs.readFileSync(filePath, "utf-8");
  const fmMatch = raw.match(/title:\s*["']?(.+?)["']?\s*$/m);
  if (fmMatch) return fmMatch[1].replace(/["']$/, "");
  const headingMatch = raw.match(/^#\s+(.+)$/m);
  if (headingMatch) return headingMatch[1];
  return null;
}

/** Read a meta.json from a directory, returning null if missing/invalid. */
function readMeta(
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

/**
 * Build a nav tree from a content directory by parsing its meta.json.
 * @param dir   Absolute path to the content directory
 * @param prefix  URL slug prefix (e.g. "integrations/langgraph")
 */
function buildNavTree(dir: string, prefix: string = ""): NavNode[] {
  const meta = readMeta(dir);
  if (!meta) {
    // No meta.json — fall back to filesystem listing
    return buildNavTreeFromFilesystem(dir, prefix);
  }

  const pages = meta.pages;
  if (!pages || !Array.isArray(pages)) {
    return buildNavTreeFromFilesystem(dir, prefix);
  }

  const nodes: NavNode[] = [];

  for (const entry of pages) {
    // Section divider: ---Section Name---
    const sectionMatch = entry.match(/^---(.+)---$/);
    if (sectionMatch) {
      nodes.push({ type: "section", title: sectionMatch[1] });
      continue;
    }

    // External link: [Title](url)
    if (entry.startsWith("[")) continue;

    // Spread syntax: ...dirname — expand subdirectory recursively
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

    // Nested path with slash: e.g. "human-in-the-loop/interrupt-flow"
    // or plain page slug: e.g. "quickstart"
    const slug = prefix ? `${prefix}/${entry}` : entry;
    const mdxFile = path.join(dir, `${entry}.mdx`);
    const indexFile = path.join(dir, entry, "index.mdx");
    const subDir = path.join(dir, entry);

    if (fs.existsSync(mdxFile)) {
      const title =
        readTitle(mdxFile) || entry.split("/").pop()!.replace(/-/g, " ");
      nodes.push({ type: "page", title, slug });
    } else if (fs.existsSync(subDir) && fs.statSync(subDir).isDirectory()) {
      // Directory — check if it has its own meta.json with pages
      const subMeta = readMeta(subDir);
      const subPrefix = prefix ? `${prefix}/${entry}` : entry;

      if (subMeta?.pages) {
        // Has pages — build as a group
        const subChildren = buildNavTree(subDir, subPrefix);
        const groupTitle = subMeta.title || entry.replace(/-/g, " ");
        nodes.push({
          type: "group",
          title: groupTitle.charAt(0).toUpperCase() + groupTitle.slice(1),
          slug: subPrefix,
          children: subChildren,
        });
      } else if (fs.existsSync(indexFile)) {
        // Has index.mdx but no pages — treat as a page link
        const title =
          readTitle(indexFile) || subMeta?.title || entry.replace(/-/g, " ");
        nodes.push({ type: "page", title, slug: subPrefix });
      } else {
        // Directory with no meta pages and no index — build from filesystem
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
    // Skip entries that don't resolve to any file
  }

  return nodes;
}

/** Fallback: build nav from filesystem when meta.json is missing or has no pages. */
function buildNavTreeFromFilesystem(dir: string, prefix: string): NavNode[] {
  if (!fs.existsSync(dir)) return [];
  const nodes: NavNode[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".") || entry.name === "meta.json") continue;
    if (entry.name.startsWith("(")) continue; // skip route groups
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
// Breadcrumb helpers
// ---------------------------------------------------------------------------

type Breadcrumb = { label: string; href: string | null };

function buildBreadcrumbs(slugPath: string): Breadcrumb[] {
  const parts = slugPath.split("/");
  const crumbs: Breadcrumb[] = [{ label: "Docs", href: "/docs" }];

  for (let i = 0; i < parts.length; i++) {
    const partialSlug = parts.slice(0, i + 1).join("/");
    const href = `/docs/${partialSlug}`;
    const isLast = i === parts.length - 1;

    // Try to resolve a nice title
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

// Map component tags to snippet file paths (relative to SNIPPETS_DIR).
// When an MDX page contains only a single component tag like <CopilotRuntime />,
// we replace it with the snippet's actual content so the page renders properly.
const SNIPPET_MAP: Record<string, string> = {
  A2UI: "shared/generative-ui/a2ui.mdx",
  AgUI: "shared/backend/ag-ui.mdx",
  AGUI: "shared/backend/ag-ui.mdx",
  CodingAgents: "shared/coding-agents.mdx",
  CommonIssues: "shared/troubleshooting/common-issues.mdx",
  CopilotRuntime: "copilot-runtime.mdx",
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

// Map page sub-paths to snippet component names for <SharedContent /> resolution.
// Integration pages like integrations/langgraph/coding-agents.mdx use <SharedContent />
// to render the same content as the top-level coding-agents page.
const SUBPATH_TO_COMPONENT: Record<string, string> = {
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

// ---------------------------------------------------------------------------
// Convert markdown tables inside JSX container tags to HTML tables.
// MDX treats content between JSX tags (like <Accordion>) as JSX, not markdown,
// so markdown table syntax renders as raw pipe-delimited text. This function
// finds those regions and converts the tables to HTML before MDX compilation.
// ---------------------------------------------------------------------------

const JSX_CONTAINER_TAGS = ["Accordion", "Tab"];

function convertMarkdownTableToHtml(tableLines: string[]): string {
  if (tableLines.length < 2) return tableLines.join("\n");

  // Parse header row
  const parseRow = (line: string): string[] =>
    line
      .split("|")
      .slice(1, -1)
      .map((cell) => cell.trim());

  const headers = parseRow(tableLines[0]);

  // Verify separator row (line with dashes/colons)
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

function convertTablesInJSX(content: string): string {
  // Build a regex that matches content between opening and closing container tags
  const tagPattern = JSX_CONTAINER_TAGS.join("|");
  // Match: <Tag ...>content</Tag> — non-greedy, handles nested content line by line
  const regex = new RegExp(
    `(<(?:${tagPattern})[^>]*>)([\\s\\S]*?)(<\\/(?:${tagPattern})>)`,
    "g",
  );

  return content.replace(
    regex,
    (match, openTag: string, inner: string, closeTag: string) => {
      // Find markdown table patterns within this region
      const lines = inner.split("\n");
      const result: string[] = [];
      let i = 0;

      while (i < lines.length) {
        const line = lines[i];
        // Check if this line looks like a table row: starts with optional whitespace then |
        if (/^\s*\|.+\|/.test(line)) {
          // Collect consecutive table lines
          const tableLines: string[] = [];
          while (i < lines.length && /^\s*\|.+\|/.test(lines[i])) {
            tableLines.push(lines[i].trim());
            i++;
          }
          // Need at least header + separator (2 lines) to be a table
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

// Replace component tags (e.g. <CopilotRuntime />) with their snippet content.
// Handles both single-component pages and tags embedded in mixed content.
// slugPath is used to resolve <SharedContent /> in integration pages.
function inlineSnippets(content: string, slugPath: string = ""): string {
  // Strip import statements first
  let result = content.replace(/^import\s+.+$/gm, "");

  // Replace all self-closing component tags that have snippet mappings
  // Matches: <ComponentName /> or <ComponentName components={props.components} />
  result = result.replace(
    /<([A-Z]\w*)\s*(?:components=\{[^}]*\}\s*)?\/>/g,
    (match, componentName) => {
      let snippetRel = SNIPPET_MAP[componentName];

      // For <SharedContent />, resolve based on the page's sub-path
      if (!snippetRel && componentName === "SharedContent" && slugPath) {
        // Extract sub-path: integrations/<framework>/<subpath> → <subpath>
        const subPathMatch = slugPath.match(/^integrations\/[^/]+\/(.+)$/);
        if (subPathMatch) {
          const resolvedComponent = SUBPATH_TO_COMPONENT[subPathMatch[1]];
          if (resolvedComponent) {
            snippetRel = SNIPPET_MAP[resolvedComponent];
          }
        }
      }

      if (!snippetRel) return match; // Keep unknown components as-is
      const snippetPath = path.join(SNIPPETS_DIR, snippetRel);
      if (!fs.existsSync(snippetPath)) {
        console.warn(`[docs] Snippet file not found: ${snippetPath}`);
        return match;
      }
      let snippetContent = fs.readFileSync(snippetPath, "utf-8");
      snippetContent = snippetContent.replace(/^---[\s\S]*?---\n?/, "");
      snippetContent = snippetContent.replace(/^import\s+.+$/gm, "");
      // Recursively inline nested component delegates
      return inlineSnippets(snippetContent, slugPath);
    },
  );

  return result;
}

// getNavItems removed — replaced by buildNavTree() above

const components = {
  Callout,
  Cards,
  Card,
  Accordions,
  Accordion,
  PropertyReference,
  FeatureIntegrations: ({ feature }: { feature?: string }) => {
    if (!feature) return null;
    const reg = getRegistry();
    const supporting = reg.integrations.filter(
      (i) => i.deployed && i.features?.includes(feature),
    );
    if (supporting.length === 0) return null;
    return (
      <div className="my-6">
        <div className="text-xs font-mono uppercase tracking-widest text-[var(--text-faint)] mb-2">
          Supported by
        </div>
        <div className="flex flex-wrap gap-2">
          {supporting.map((i) => (
            <Link
              key={i.slug}
              href={`/integrations/${i.slug}?demo=${feature}`}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-full border border-[var(--border)] bg-[var(--bg-surface)] text-[var(--text-secondary)] hover:border-[var(--accent)] hover:text-[var(--accent)] transition-colors"
            >
              {i.name}
            </Link>
          ))}
        </div>
      </div>
    );
  },
  InlineDemo: ({
    integration,
    demo,
  }: {
    integration?: string;
    demo?: string;
  }) => {
    if (!integration || !demo) return null;
    const reg = getRegistry();
    const int = reg.integrations.find((i) => i.slug === integration);
    if (!int || !int.deployed) return null;
    const demoUrl = `${int.backend_url}/demos/${demo}`;
    return (
      <div className="my-6 rounded-xl border border-[var(--border)] overflow-hidden">
        <div className="flex items-center justify-between px-4 py-2 bg-[var(--bg-elevated)] border-b border-[var(--border)]">
          <span className="text-xs font-mono text-[var(--text-muted)]">
            Live Demo: {int.name} — {demo}
          </span>
          <a
            href={`/integrations/${integration}?demo=${demo}`}
            className="text-xs text-[var(--accent)] hover:underline"
          >
            Open full demo →
          </a>
        </div>
        <iframe
          src={demoUrl}
          className="w-full"
          style={{ height: "500px" }}
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
          loading="lazy"
        />
      </div>
    );
  },
  Note: Callout,
  Warning: ({ children }: { children: React.ReactNode }) => (
    <Callout type="warn">{children}</Callout>
  ),
  Tip: ({ children }: { children: React.ReactNode }) => (
    <Callout type="info">{children}</Callout>
  ),
  Steps: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Step: ({
    children,
    title,
  }: {
    children: React.ReactNode;
    title?: string;
  }) => (
    <div style={{ marginBottom: "1rem" }}>
      {title && (
        <h4 style={{ fontWeight: 600, marginBottom: "0.25rem" }}>{title}</h4>
      )}
      {children}
    </div>
  ),
  CardGroup: Cards,
  Tabs: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Tab: ({ children, title }: { children: React.ReactNode; title?: string }) => (
    <div style={{ marginBottom: "1rem" }}>
      {title && (
        <div
          style={{
            fontWeight: 600,
            fontSize: "0.875rem",
            marginBottom: "0.5rem",
            color: "var(--text-secondary)",
          }}
        >
          {title}
        </div>
      )}
      {children}
    </div>
  ),
  Frame: ({ children }: { children: React.ReactNode }) => (
    <div
      style={{
        border: "1px solid var(--border)",
        borderRadius: "0.5rem",
        padding: "1rem",
        marginBottom: "1rem",
      }}
    >
      {children}
    </div>
  ),
  // Fumadocs-specific components we shim
  IntegrationGrid: ({ path }: { path?: string }) => (
    <div
      style={{
        padding: "1rem",
        background: "var(--bg-elevated)",
        borderRadius: "0.5rem",
        marginBottom: "1rem",
        fontSize: "0.875rem",
        color: "var(--text-muted)",
      }}
    >
      See{" "}
      <a href="/integrations" style={{ color: "var(--accent)" }}>
        Integrations
      </a>{" "}
      for all available frameworks{path ? ` (${path})` : ""}.
    </div>
  ),
  FeatureGrid: ({ children }: { children?: React.ReactNode }) => (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(2, 1fr)",
        gap: "0.75rem",
      }}
    >
      {children}
    </div>
  ),
  Feature: ({
    children,
    title,
  }: {
    children?: React.ReactNode;
    title?: string;
  }) => (
    <div
      style={{
        border: "1px solid var(--border)",
        borderRadius: "0.5rem",
        padding: "1rem",
      }}
    >
      {title && (
        <h4 style={{ fontWeight: 600, marginBottom: "0.25rem" }}>{title}</h4>
      )}
      {children}
    </div>
  ),
  video: (props: Record<string, unknown>) => (
    <video
      {...props}
      className={undefined}
      style={{ borderRadius: "0.5rem", width: "100%", marginBottom: "1rem" }}
    />
  ),
  img: (props: Record<string, unknown>) => (
    <img
      {...props}
      className={undefined}
      style={{ borderRadius: "0.5rem", maxWidth: "100%", marginBottom: "1rem" }}
    />
  ),
  CodeGroup: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  // Placeholder; swapped for a context-aware `<Snippet>` below so it can
  // default framework + cell from the current page's slug / frontmatter.
  Snippet: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  Info: Callout,
  Caution: ({ children }: { children: React.ReactNode }) => (
    <Callout type="warn">{children}</Callout>
  ),
  // Passthrough components — render children as-is
  TailoredContent: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  TailoredContentOption: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  SharedContent: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  IframeSwitcher: ({
    children,
    src,
  }: {
    children?: React.ReactNode;
    src?: string;
  }) =>
    src ? (
      <div
        style={{
          border: "1px solid var(--border)",
          borderRadius: "0.5rem",
          overflow: "hidden",
          marginBottom: "1rem",
        }}
      >
        <iframe
          src={src}
          style={{ width: "100%", height: "400px", border: "none" }}
        />
      </div>
    ) : (
      <div>{children}</div>
    ),
  IframeSwitcherGroup: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  RunAndConnect: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  RunAndConnectSnippet: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  MigrateTo: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  MigrateToV: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  HeadlessUI: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  ImageZoom: ({ src, alt }: { src?: string; alt?: string }) => (
    <img
      src={src}
      alt={alt || ""}
      style={{
        borderRadius: "0.5rem",
        maxWidth: "100%",
        marginBottom: "1rem",
        cursor: "zoom-in",
      }}
    />
  ),
  InstallSDKSnippet: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  MCPApps: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  MCPSetup: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  Overview: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  FrameworkOverview: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  CommonIssues: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  ErrorDebugging: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  Observability: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  ObservabilityConnectors: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  Inspector: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  DefaultToolRendering: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  DisplayOnly: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  Interactive: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  PrebuiltComponents: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  ProgrammaticControl: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  CodingAgents: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  Slots: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  FrontendTools: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  FrontEndToolsImpl: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  ToolRendering: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  ToolRenderer: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  ReasoningMessages: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  // Styled components
  YouTubeVideo: ({ id }: { id?: string }) =>
    id ? (
      <div
        style={{
          position: "relative",
          paddingBottom: "56.25%",
          marginBottom: "1rem",
        }}
      >
        <iframe
          src={`https://www.youtube.com/embed/${id}`}
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            width: "100%",
            height: "100%",
            border: "none",
            borderRadius: "0.5rem",
          }}
          allowFullScreen
        />
      </div>
    ) : null,
  CTACards: ({ children }: { children?: React.ReactNode }) => (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(2, 1fr)",
        gap: "0.75rem",
        marginBottom: "1rem",
      }}
    >
      {children}
    </div>
  ),
  AttributeCards: ({ children }: { children?: React.ReactNode }) => (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(2, 1fr)",
        gap: "0.75rem",
        marginBottom: "1rem",
      }}
    >
      {children}
    </div>
  ),
  PatternCard: ({
    children,
    title,
  }: {
    children?: React.ReactNode;
    title?: string;
  }) => (
    <div
      style={{
        border: "1px solid var(--border)",
        borderRadius: "0.5rem",
        padding: "1rem",
        marginBottom: "0.75rem",
      }}
    >
      {title && (
        <h4 style={{ fontWeight: 600, marginBottom: "0.25rem" }}>{title}</h4>
      )}
      {children}
    </div>
  ),
  TwoColumnSection: ({ children }: { children: React.ReactNode }) => (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "1fr 1fr",
        gap: "1.5rem",
        marginBottom: "1rem",
      }}
    >
      {children}
    </div>
  ),
  EcosystemTable: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  FeatureMatrix: () => (
    <div
      style={{
        padding: "1rem",
        background: "var(--bg-elevated)",
        borderRadius: "0.5rem",
        marginBottom: "1rem",
      }}
    >
      See the{" "}
      <a href="/matrix" style={{ color: "var(--accent)" }}>
        Feature Matrix
      </a>{" "}
      for a full comparison.
    </div>
  ),
  IntegrationsGrid: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  IntegrationButtonGroup: ({ children }: { children?: React.ReactNode }) => (
    <div
      style={{
        display: "flex",
        gap: "0.5rem",
        flexWrap: "wrap",
        marginBottom: "1rem",
      }}
    >
      {children}
    </div>
  ),
  // Misc
  AGUI: ({ children }: { children?: React.ReactNode }) => (
    <span>{children}</span>
  ),
  AgUI: ({ children }: { children?: React.ReactNode }) => (
    <span>{children}</span>
  ),
  SignUpSection: () => (
    <div
      style={{
        padding: "1rem",
        background: "var(--bg-elevated)",
        borderRadius: "0.5rem",
        marginBottom: "1rem",
      }}
    >
      <a href="https://cloud.copilotkit.ai" style={{ color: "var(--accent)" }}>
        Sign up for CopilotKit Cloud →
      </a>
    </div>
  ),
  LinkToCopilotCloud: () => (
    <a href="https://cloud.copilotkit.ai" style={{ color: "var(--accent)" }}>
      CopilotKit Cloud
    </a>
  ),
  LandingCodeShowcase: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  UseAgentSnippet: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  InstallPythonSDK: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  ActionButtons: ({ children }: { children?: React.ReactNode }) => (
    <div style={{ display: "flex", gap: "0.5rem", marginBottom: "1rem" }}>
      {children}
    </div>
  ),
  ApproveComponent: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  AskComponent: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  CopilotCloudConfigureCopilotKitProvider: ({
    children,
  }: {
    children?: React.ReactNode;
  }) => <div>{children}</div>,
  GenerativeUISpecsOverview: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  IOptions: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  JsonOptions: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  MessageActionRenderProps: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  CopilotRuntime: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  // HTML/React elements that MDX tries to resolve as components
  Image: ({ src, alt, ...props }: Record<string, unknown>) => (
    <img
      src={src as string}
      alt={(alt as string) || ""}
      style={{ borderRadius: "0.5rem", maxWidth: "100%", marginBottom: "1rem" }}
    />
  ),
  A: ({
    children,
    href,
    ...props
  }: {
    children?: React.ReactNode;
    href?: string;
  }) => (
    <a href={href} style={{ color: "var(--accent)" }}>
      {children}
    </a>
  ),
  Button: ({ children, ...props }: { children?: React.ReactNode }) => (
    <button
      style={{
        padding: "0.5rem 1rem",
        borderRadius: "0.375rem",
        border: "1px solid var(--border)",
        background: "var(--bg-surface)",
        cursor: "pointer",
      }}
    >
      {children}
    </button>
  ),
  Link: ({ children, href }: { children?: React.ReactNode; href?: string }) => (
    <a href={href} style={{ color: "var(--accent)" }}>
      {children}
    </a>
  ),
  Code: ({ children }: { children?: React.ReactNode }) => (
    <code>{children}</code>
  ),
  Progress: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  // Lucide icons — render as empty spans (they're decorative)
  Wrench: () => <span>🔧</span>,
  WrenchIcon: () => <span>🔧</span>,
  PaintbrushIcon: () => <span>🎨</span>,
  UserIcon: () => <span>👤</span>,
  RepeatIcon: () => <span>🔄</span>,
  Book: () => <span>📖</span>,
  BookOpen: () => <span>📖</span>,
  BookA: () => <span>📖</span>,
  Bot: () => <span>🤖</span>,
  Cpu: () => <span>💻</span>,
  CpuIcon: () => <span>💻</span>,
  Database: () => <span>🗄️</span>,
  FileSpreadsheet: () => <span>📊</span>,
  Layers: () => <span>📚</span>,
  MessageCircle: () => <span>💬</span>,
  MessageSquare: () => <span>💬</span>,
  MonitorIcon: () => <span>🖥️</span>,
  Plane: () => <span>✈️</span>,
  Play: () => <span>▶️</span>,
  Plug: () => <span>🔌</span>,
  PlugIcon: () => <span>🔌</span>,
  Settings: () => <span>⚙️</span>,
  Sparkles: () => <span>✨</span>,
  SquareChartGantt: () => <span>📊</span>,
  SquareTerminal: () => <span>💻</span>,
  Trash: () => <span>🗑️</span>,
  Zap: () => <span>⚡</span>,
  X: () => <span>✕</span>,
  Cog: () => <span>⚙️</span>,
  Server: () => <span>🖥️</span>,
  ArrowLeftRight: () => <span>↔️</span>,
  Banknote: () => <span>💰</span>,
  AlertCircle: () => <span>⚠️</span>,
  PiMonitor: () => <span>🖥️</span>,
  // Framework icons
  AwsStrandsIcon: () => <span>☁️</span>,
  MicrosoftIcon: () => <span>Ⓜ️</span>,
  PydanticAIIcon: () => <span>🐍</span>,
  SiLangchain: () => <span>🔗</span>,
  // FontAwesome icons
  FaArrowUp: () => <span>↑</span>,
  FaCloud: () => <span>☁️</span>,
  FaGithub: () => <span>⌨️</span>,
  FaServer: () => <span>🖥️</span>,
  FaWrench: () => <span>🔧</span>,
  // Code example components (render children or nothing)
  CopilotKit: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  CopilotChat: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  CopilotSidebar: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  CopilotPopup: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  CopilotTextarea: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  CopilotKitProvider: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  CopilotUI: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  CloudCopilotKitProvider: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  SelfHostingCopilotRuntimeCreateEndpoint: ({
    children,
  }: {
    children?: React.ReactNode;
  }) => <div>{children}</div>,
  SelfHostingCopilotRuntimeConfigureCopilotKitProvider: ({
    children,
  }: {
    children?: React.ReactNode;
  }) => <div>{children}</div>,
  AgentState: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  AgentStateSnapshot: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  AgentRunResponseUpdate: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  // Chart components
  Bar: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  BarChart: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  XAxis: () => null,
  YAxis: () => null,
  ResponsiveContainer: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  Tooltip: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  TooltipProvider: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  Markdown: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  // App-specific components from code examples
  Chat: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  Task: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  TasksList: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  TasksProvider: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  MapCanvas: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  Email: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  EmailsProvider: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  EmailThread: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  ChatMessage: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  MessageFromA: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  MessageToA: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  Reply: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  PlaceCard: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  Proposal: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  ProposalViewer: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  TripsProvider: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  ResearchProvider: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  ResearchContext: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  ResearchContextType: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  ResearchState: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  SearchInfo: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  SearchProgress: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  YourApp: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  YourMainContent: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  MCPClient: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  McpServerManager: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  McpToolCall: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  GoServer: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
};

function DocsOverview() {
  return (
    <div className="mx-auto max-w-3xl px-6 py-16 text-center">
      <h1 className="text-3xl font-semibold text-[var(--text)] tracking-tight mb-3">
        CopilotKit Documentation
      </h1>
      <p className="text-base text-[var(--text-secondary)] leading-relaxed mb-10">
        Guides, tutorials, and integration documentation for building AI-powered
        applications with CopilotKit.
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-left mb-10">
        <Link
          href="/docs/agentic-chat-ui"
          className="group p-5 rounded-xl border border-[var(--border)] bg-[var(--bg-surface)] hover:border-[var(--accent)] transition-all"
        >
          <h3 className="text-sm font-semibold text-[var(--text)] group-hover:text-[var(--accent)] mb-1">
            Agentic Chat UI
          </h3>
          <p className="text-xs text-[var(--text-muted)]">
            Build chat interfaces with CopilotKit components
          </p>
        </Link>
        <Link
          href="/docs/frontend-tools"
          className="group p-5 rounded-xl border border-[var(--border)] bg-[var(--bg-surface)] hover:border-[var(--accent)] transition-all"
        >
          <h3 className="text-sm font-semibold text-[var(--text)] group-hover:text-[var(--accent)] mb-1">
            Frontend Tools
          </h3>
          <p className="text-xs text-[var(--text-muted)]">
            Define tools your agent can call on the frontend
          </p>
        </Link>
        <Link
          href="/docs/generative-ui"
          className="group p-5 rounded-xl border border-[var(--border)] bg-[var(--bg-surface)] hover:border-[var(--accent)] transition-all"
        >
          <h3 className="text-sm font-semibold text-[var(--text)] group-hover:text-[var(--accent)] mb-1">
            Generative UI
          </h3>
          <p className="text-xs text-[var(--text-muted)]">
            Let your agent generate interactive UI components
          </p>
        </Link>
        <Link
          href="/docs/backend/copilot-runtime"
          className="group p-5 rounded-xl border border-[var(--border)] bg-[var(--bg-surface)] hover:border-[var(--accent)] transition-all"
        >
          <h3 className="text-sm font-semibold text-[var(--text)] group-hover:text-[var(--accent)] mb-1">
            Copilot Runtime
          </h3>
          <p className="text-xs text-[var(--text-muted)]">
            Server-side runtime for connecting agents
          </p>
        </Link>
        <Link
          href="/docs/integrations"
          className="group p-5 rounded-xl border border-[var(--border)] bg-[var(--bg-surface)] hover:border-[var(--accent)] transition-all"
        >
          <h3 className="text-sm font-semibold text-[var(--text)] group-hover:text-[var(--accent)] mb-1">
            Integrations
          </h3>
          <p className="text-xs text-[var(--text-muted)]">
            LangGraph, Mastra, CrewAI, and more
          </p>
        </Link>
        <Link
          href="/docs/learn"
          className="group p-5 rounded-xl border border-[var(--border)] bg-[var(--bg-surface)] hover:border-[var(--accent)] transition-all"
        >
          <h3 className="text-sm font-semibold text-[var(--text)] group-hover:text-[var(--accent)] mb-1">
            Learn
          </h3>
          <p className="text-xs text-[var(--text-muted)]">
            Tutorials and learning resources
          </p>
        </Link>
      </div>

      <p className="text-xs text-[var(--text-faint)]">
        517 pages · Guides · Integrations · Tutorials · Troubleshooting
      </p>
    </div>
  );
}

export default async function DocsPage({
  params,
}: {
  params: Promise<{ slug?: string[] }>;
}) {
  const { slug } = await params;

  // Overview page when no slug
  if (!slug || slug.length === 0) {
    return <DocsOverview />;
  }

  const slugPath = slug.join("/");
  let filePath = path.join(CONTENT_DIR, `${slugPath}.mdx`);

  // Try index.mdx if the path is a directory
  if (!fs.existsSync(filePath)) {
    const indexPath = path.join(CONTENT_DIR, slugPath, "index.mdx");
    if (fs.existsSync(indexPath)) {
      filePath = indexPath;
    } else {
      notFound();
    }
  }

  const source = fs.readFileSync(filePath, "utf-8");
  const rawContent = source.replace(/^---[\s\S]*?---\n?/, "");
  const inlined = inlineSnippets(rawContent, slugPath);
  const content = convertTablesInJSX(inlined);
  const titleMatch =
    source.match(/title:\s*["']?(.+?)["']?\s*$/m) ||
    content.match(/^#\s+(.+)$/m);
  const title =
    titleMatch?.[1] || slugPath.split("/").pop()?.replace(/-/g, " ") || "Docs";

  // Optional page-level defaults for <Snippet>: pages can declare which
  // cell/framework they're documenting in their frontmatter, so individual
  // <Snippet region="..." /> tags don't need to repeat it.
  //
  //   ---
  //   title: Tool Rendering
  //   snippet_framework: langgraph-python
  //   snippet_cell: tool-rendering
  //   ---
  //
  // For pages under `integrations/<framework>/...` we infer the framework
  // from the URL so simpler pages only need `snippet_cell:`.
  const fmMatch = source.match(/^---([\s\S]*?)---/);
  const fm = fmMatch?.[1] ?? "";
  const snippetFrameworkMatch = fm.match(/snippet_framework:\s*(.+?)\s*$/m);
  const snippetCellMatch = fm.match(/snippet_cell:\s*(.+?)\s*$/m);
  const integrationFrameworkMatch = slugPath.match(/^integrations\/([^/]+)/);
  const frameworkSlugMap: Record<string, string> = {
    // The content directory uses `langgraph` as a prefix, but the showcase
    // packages use language-qualified slugs. Default to the Python variant
    // for integration pages since it's the deepest-covered framework.
    langgraph: "langgraph-python",
    mastra: "mastra",
    "microsoft-agent-framework": "ms-agent-python",
    "pydantic-ai": "pydantic-ai",
    llamaindex: "llamaindex",
    agno: "agno",
    "google-adk": "google-adk",
    "aws-strands": "strands",
    crewai: "crewai-crews",
    ag2: "ag2",
    "claude-sdk": "claude-sdk-python",
  };
  const defaultFramework =
    snippetFrameworkMatch?.[1]?.replace(/["']/g, "") ??
    (integrationFrameworkMatch
      ? (frameworkSlugMap[integrationFrameworkMatch[1]] ??
        integrationFrameworkMatch[1])
      : undefined);
  const defaultCell = snippetCellMatch?.[1]?.replace(/["']/g, "");

  // Integration-scoped sidebar: if under integrations/<framework>, scope to that framework
  let navTree: NavNode[];
  let sidebarTitle: string;
  let backLink: { label: string; href: string } | null = null;
  const integrationMatch = slugPath.match(/^integrations\/([^/]+)/);

  if (integrationMatch) {
    const framework = integrationMatch[1];
    const frameworkDir = path.join(CONTENT_DIR, "integrations", framework);
    const frameworkMeta = readMeta(frameworkDir);
    sidebarTitle =
      frameworkMeta?.title ||
      framework.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
    navTree = buildNavTree(frameworkDir, `integrations/${framework}`);
    backLink = { label: "\u2190 Back to Docs", href: "/docs" };
  } else {
    sidebarTitle = "CopilotKit Docs";
    navTree = buildNavTree(CONTENT_DIR);
  }

  const breadcrumbs = buildBreadcrumbs(slugPath);

  function renderNavItem(node: NavNode, depth: number = 0): React.ReactNode {
    const indent = depth * 16;
    if (node.type === "section") {
      return (
        <div
          key={`section-${node.title}`}
          className="text-[10px] font-mono uppercase tracking-widest text-[var(--text-faint)] mt-4 mb-2"
          style={{ paddingLeft: `${indent}px` }}
        >
          {node.title}
        </div>
      );
    }
    if (node.type === "page") {
      const isActive = node.slug === slugPath;
      return (
        <Link
          key={node.slug}
          href={`/docs/${node.slug}`}
          data-active={isActive ? "true" : undefined}
          className={`block py-[5px] text-[13px] transition-colors ${
            isActive
              ? "text-[var(--accent)] font-medium"
              : "text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
          }`}
          style={{ paddingLeft: `${indent}px` }}
        >
          {node.title}
        </Link>
      );
    }
    // group
    return (
      <div key={`group-${node.slug}`} className="mt-1">
        <div
          className="py-[5px] text-[13px] font-medium text-[var(--text-secondary)]"
          style={{ paddingLeft: `${indent}px` }}
        >
          {node.title}
        </div>
        {node.children.map((child) => renderNavItem(child, depth + 1))}
      </div>
    );
  }

  return (
    <div className="flex" style={{ height: "calc(100vh - 52px)" }}>
      {/* Sidebar */}
      <SidebarNav className="w-[220px] shrink-0 border-r border-[var(--border)] bg-[var(--bg)] overflow-y-auto p-4">
        {backLink && (
          <Link
            href={backLink.href}
            className="block text-xs text-[var(--text-muted)] hover:text-[var(--text-secondary)] mb-3 transition-colors"
          >
            {backLink.label}
          </Link>
        )}
        <Link
          href="/docs"
          className="block text-xs font-mono uppercase tracking-widest text-[var(--accent)] mb-4"
        >
          {sidebarTitle}
        </Link>
        {navTree.map((node) => renderNavItem(node))}
      </SidebarNav>

      {/* Content */}
      <main className="flex-1 max-w-3xl px-8 py-8 overflow-y-auto">
        {/* Breadcrumbs */}
        <nav className="flex items-center gap-1 text-xs text-[var(--text-muted)] mb-4 flex-wrap">
          {breadcrumbs.map((crumb, i) => (
            <React.Fragment key={i}>
              {i > 0 && <span className="text-[var(--text-faint)]">&gt;</span>}
              {crumb.href ? (
                <Link
                  href={crumb.href}
                  className="hover:text-[var(--text-secondary)] transition-colors"
                >
                  {crumb.label}
                </Link>
              ) : (
                <span className="text-[var(--text)]">{crumb.label}</span>
              )}
            </React.Fragment>
          ))}
        </nav>

        <h1 className="text-2xl font-semibold text-[var(--text)] tracking-tight mb-6">
          {title}
        </h1>
        <div className="reference-content">
          <MDXRemote
            source={content}
            components={{
              ...components,
              // Bind page-level defaults so <Snippet region="..." /> works
              // without repeating framework + cell on every tag. Explicit
              // `framework`/`cell` props on a tag still override the
              // defaults.
              Snippet: (props: Record<string, unknown>) => (
                <Snippet
                  {...(props as { region: string })}
                  defaultFramework={defaultFramework}
                  defaultCell={defaultCell}
                />
              ),
            }}
            options={{
              mdxOptions: {
                remarkPlugins: [remarkGfm],
                rehypePlugins: [rehypeHighlight],
              },
            }}
          />
        </div>
      </main>
    </div>
  );
}
