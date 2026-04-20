/**
 * Generate Search Index
 *
 * Scans reference MDX files, AG-UI content, and registry data to produce
 * a search index JSON for the shell's Cmd-K search modal.
 *
 * Usage: npx tsx showcase/scripts/generate-search-index.ts
 *
 * Output: showcase/shell/src/data/search-index.json
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
// MDX docs content now lives in shell-docs. shell-docs consumes the index
// at build time for <SearchModal>; shell keeps a copy so its header search
// (which links to docs routes) stays functional — destinations 301 across
// to docs.showcase.copilotkit.ai. We SCAN from shell-docs (source of truth)
// and WRITE to both.
const SHELL_DOCS_DIR = path.join(ROOT, "shell-docs", "src");
const SHELL_DIR = path.join(ROOT, "shell", "src");
const CONTENT_ROOT = SHELL_DOCS_DIR;
const OUTPUT_PATHS = [
  path.join(SHELL_DOCS_DIR, "data", "search-index.json"),
  path.join(SHELL_DIR, "data", "search-index.json"),
];

interface SearchEntry {
  type: "page" | "reference" | "ag-ui";
  title: string;
  subtitle: string;
  section: string;
  href: string;
}

// Derive a human-readable section breadcrumb from a relative path.
// e.g. "concepts/middleware" → "Concepts"
//      "sdk/js/client/middleware" → "JS SDK › @ag-ui/client"
//      "backend/copilot-runtime" → "Backend"
const SECTION_LABELS: Record<string, string> = {
  concepts: "Concepts",
  quickstart: "Quickstart",
  drafts: "Draft Proposals",
  tutorials: "Tutorials",
  development: "Development",
  "sdk/js": "JS SDK",
  "sdk/js/core": "JS SDK › @ag-ui/core",
  "sdk/js/client": "JS SDK › @ag-ui/client",
  "sdk/python": "Python SDK",
  "sdk/python/core": "Python SDK › ag_ui.core",
  "sdk/python/encoder": "Python SDK › ag_ui.encoder",
};

function deriveSectionLabel(hrefPrefix: string, href: string): string {
  // Strip prefix to get relative path, then drop the filename
  const rel = href.slice(hrefPrefix.length + 1); // e.g. "concepts/middleware"
  const parts = rel.split("/");
  if (parts.length <= 1) return ""; // top-level page, no section

  // Try longest prefix match first
  for (let len = parts.length - 1; len >= 1; len--) {
    const candidate = parts.slice(0, len).join("/");
    if (SECTION_LABELS[candidate]) return SECTION_LABELS[candidate];
  }

  // Fallback: capitalize first directory
  return (
    parts[0].charAt(0).toUpperCase() + parts[0].slice(1).replace(/-/g, " ")
  );
}

function extractTitle(content: string, filename: string): string {
  // Try frontmatter title
  const fmMatch = content.match(/^---[\s\S]*?title:\s*["']?(.+?)["']?\s*$/m);
  if (fmMatch) return fmMatch[1];

  // Try first heading
  const h1Match = content.match(/^#\s+(.+)$/m);
  if (h1Match) return h1Match[1];

  // Fall back to filename
  return filename.replace(".mdx", "").replace(/-/g, " ");
}

function extractDescription(content: string): string {
  // Strip frontmatter
  const stripped = content.replace(/^---[\s\S]*?---\n?/, "");
  // Strip headings and find first paragraph
  const lines = stripped
    .split("\n")
    .filter(
      (l) =>
        l.trim() &&
        !l.startsWith("#") &&
        !l.startsWith("import") &&
        !l.startsWith("<") &&
        !l.startsWith("```"),
    );
  const first = lines[0]?.trim() || "";
  return first.slice(0, 120);
}

function scanMdxDir(
  dir: string,
  hrefPrefix: string,
  type: "page" | "reference" | "ag-ui",
  allowList?: Set<string>,
): SearchEntry[] {
  const entries: SearchEntry[] = [];

  function walk(currentDir: string, pathPrefix: string) {
    if (!fs.existsSync(currentDir)) return;
    const items = fs.readdirSync(currentDir, { withFileTypes: true });
    for (const item of items) {
      if (item.isDirectory()) {
        walk(path.join(currentDir, item.name), `${pathPrefix}/${item.name}`);
      } else if (item.name.endsWith(".mdx")) {
        const slug = item.name.replace(".mdx", "");
        const href =
          slug === "index"
            ? hrefPrefix + pathPrefix
            : `${hrefPrefix}${pathPrefix}/${slug}`;

        // When an allow list is provided, only include matching slugs.
        // The slug is the href with the prefix stripped and leading slash removed.
        if (allowList) {
          const relSlug = href.slice(hrefPrefix.length + 1);
          if (!allowList.has(relSlug)) continue;
        }

        const content = fs.readFileSync(
          path.join(currentDir, item.name),
          "utf-8",
        );
        const title = extractTitle(content, item.name);
        const subtitle = extractDescription(content);

        const section = deriveSectionLabel(hrefPrefix, href);
        entries.push({ type, title, subtitle, section, href });
      }
    }
  }

  walk(dir, "");
  return entries;
}

function main() {
  const entries: SearchEntry[] = [];

  // Static pages
  entries.push(
    {
      type: "page",
      title: "Home",
      subtitle: "Front door",
      section: "",
      href: "/",
    },
    {
      type: "page",
      title: "Integrations",
      subtitle: "All integrations",
      section: "",
      href: "/integrations",
    },
    {
      type: "page",
      title: "Feature Matrix",
      subtitle: "Compare features across integrations",
      section: "",
      href: "/matrix",
    },
    {
      type: "page",
      title: "API Reference",
      subtitle: "CopilotKit components and hooks",
      section: "",
      href: "/reference",
    },
    {
      type: "page",
      title: "AG-UI Overview",
      subtitle: "The Agent-User Interaction Protocol",
      section: "",
      href: "/ag-ui",
    },
  );

  // CopilotKit Reference
  const refDir = path.join(CONTENT_ROOT, "content", "reference");
  if (fs.existsSync(refDir)) {
    const refEntries = scanMdxDir(refDir, "/reference", "reference");
    entries.push(...refEntries);
    console.log(`  Reference: ${refEntries.length} entries`);
  }

  // AG-UI docs — only index pages that are published in the AG-UI sidebar nav
  const AGUI_PUBLISHED_SLUGS = new Set([
    "introduction",
    "agentic-protocols",
    "quickstart/applications",
    "quickstart/introduction",
    "quickstart/server",
    "quickstart/middleware",
    "quickstart/clients",
    "concepts/architecture",
    "concepts/events",
    "concepts/agents",
    "concepts/middleware",
    "concepts/messages",
    "concepts/reasoning",
    "concepts/state",
    "concepts/serialization",
    "concepts/tools",
    "concepts/capabilities",
    "concepts/generative-ui-specs",
    "drafts/overview",
    "drafts/multimodal-messages",
    "drafts/interrupts",
    "drafts/generative-ui",
    "drafts/meta-events",
    "tutorials/cursor",
    "tutorials/debugging",
    "development/updates",
    "development/roadmap",
    "development/contributing",
    "sdk/js/core/overview",
    "sdk/js/core/types",
    "sdk/js/core/multimodal-inputs",
    "sdk/js/core/events",
    "sdk/js/client/overview",
    "sdk/js/client/abstract-agent",
    "sdk/js/client/http-agent",
    "sdk/js/client/middleware",
    "sdk/js/client/subscriber",
    "sdk/js/client/compaction",
    "sdk/js/encoder",
    "sdk/js/proto",
    "sdk/python/core/overview",
    "sdk/python/core/types",
    "sdk/python/core/multimodal-inputs",
    "sdk/python/core/events",
    "sdk/python/encoder/overview",
  ]);

  const aguiDir = path.join(CONTENT_ROOT, "content", "ag-ui");
  if (fs.existsSync(aguiDir)) {
    const aguiEntries = scanMdxDir(
      aguiDir,
      "/ag-ui",
      "ag-ui",
      AGUI_PUBLISHED_SLUGS,
    );
    entries.push(...aguiEntries);
    console.log(`  AG-UI: ${aguiEntries.length} entries`);
  }

  // CopilotKit Docs
  const docsDir = path.join(CONTENT_ROOT, "content", "docs");
  if (fs.existsSync(docsDir)) {
    const docsEntries = scanMdxDir(docsDir, "/docs", "page");
    entries.push(...docsEntries);
    console.log(`  Docs: ${docsEntries.length} entries`);
  }

  // Write (dual-emit to shell-docs + shell)
  const json = JSON.stringify(entries, null, 2) + "\n";
  for (const outputPath of OUTPUT_PATHS) {
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, json);
    console.log(`\nSearch index: ${outputPath} (${entries.length} entries)`);
  }
}

main();
