/**
 * Generate Search Index
 *
 * Scans reference MDX files, AG-UI content, and registry data to produce
 * a search index JSON for the shell's Cmd-K search modal.
 *
 * Docs pages are filtered to the ones a reader can actually reach from a
 * sidebar — see shell-docs/src/lib/searchable-pages.ts.
 *
 * Usage: npx tsx showcase/scripts/generate-search-index.ts
 *
 * Output: showcase/shell-docs/src/data/search-index.json (docs app)
 *         showcase/shell/src/data/search-index.json      (showcase app)
 *         showcase/shell-docs/src/data/search-index-dropped.json (review)
 */

import { spawnSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";

import { buildAngularFeatureSearchEntries } from "./lib/angular-feature-search";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
// MDX docs content now lives in shell-docs. shell-docs consumes the index
// at build time for <SearchModal>; shell keeps a copy so its header search
// (which links to docs routes) stays functional — destinations 301 across
// to docs.showcase.copilotkit.ai. We SCAN from shell-docs (source of truth)
// and WRITE to both.
const SHELL_DOCS_ROOT = path.join(ROOT, "shell-docs");
const SHELL_DOCS_DIR = path.join(SHELL_DOCS_ROOT, "src");
const SHELL_DIR = path.join(ROOT, "shell", "src");
const CONTENT_ROOT = SHELL_DOCS_DIR;
const SHARED_DIR = path.join(ROOT, "shared");

type OutputTarget = "shell-docs" | "shell";

const OUTPUTS: ReadonlyArray<{ target: OutputTarget; path: string }> = [
  {
    target: "shell-docs",
    path: path.join(SHELL_DOCS_DIR, "data", "search-index.json"),
  },
  { target: "shell", path: path.join(SHELL_DIR, "data", "search-index.json") },
];

// Destinations that live on the showcase host rather than the docs host.
// The showcase app IS the showcase and needs these rows; the docs app must
// not offer them, because clicking one leaves the documentation.
const SHOWCASE_HOST_DESTINATIONS = new Set(["/", "/integrations", "/matrix"]);

// The list of dropped docs entries, for review. Lands in the gitignored
// generated-data directory next to the index it explains.
const DROPPED_REPORT_PATH = path.join(
  SHELL_DOCS_DIR,
  "data",
  "search-index-dropped.json",
);

// Coverage floor for the docs portion of the shell-docs index. Measured at
// 583 entries when the navigability filter was introduced; the floor sits
// ~15% under that so ordinary content churn (a section retired, a folder
// merged) passes while a broken navigation walk — which collapses the
// union to near zero — fails the build instead of shipping an empty search.
const MIN_DOCS_ENTRIES = 495;

interface SearchEntry {
  type: "page" | "reference" | "ag-ui";
  title: string;
  subtitle: string;
  section: string;
  href: string;
}

interface FrontendSearchPage {
  id: string;
  name: string;
  guidanceTitle?: "Docs status";
}

const FRONTEND_SEARCH_PAGES: readonly FrontendSearchPage[] = [
  { id: "vue", name: "Vue", guidanceTitle: "Docs status" },
  { id: "react-native", name: "React Native", guidanceTitle: "Docs status" },
  { id: "angular", name: "Angular", guidanceTitle: "Docs status" },
  { id: "slack", name: "Slack" },
  { id: "teams", name: "Microsoft Teams" },
];

const FRONTEND_NAMES = new Map(
  FRONTEND_SEARCH_PAGES.map((frontend) => [frontend.id, frontend.name]),
);

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

function normalizeDocsSearchEntry(entry: SearchEntry): SearchEntry[] {
  const frontendPrefix = "/docs/frontends/";
  if (!entry.href.startsWith(frontendPrefix)) return [entry];

  const slugPath = entry.href.slice(frontendPrefix.length);
  if (slugPath === "using-these-docs") {
    return [];
  }

  if (slugPath === "docs-status") {
    return FRONTEND_SEARCH_PAGES.filter(
      (frontend) => frontend.guidanceTitle === "Docs status",
    ).map((frontend) => ({
      ...entry,
      title: `${frontend.name}: ${frontend.guidanceTitle}`,
      section: "Frontends",
      href: `/${frontend.id}/using-these-docs`,
    }));
  }

  const [frontend, ...tail] = slugPath.split("/").filter(Boolean);
  if (!frontend || !FRONTEND_NAMES.has(frontend)) return [];

  return [
    {
      ...entry,
      section: "Frontends",
      href:
        tail.length > 0
          ? `/${frontend}/${tail.join("/")}`
          : frontend === "slack" || frontend === "teams"
            ? `/${frontend}/connect`
            : `/${frontend}`,
    },
  ];
}

interface SearchablePagesPayload {
  slugs: string[];
  navTitles: Record<string, string>;
  fromNavigation: string[];
  fromLinks: string[];
  forcedIn: string[];
  forcedOut: string[];
  canonicalBySlug: Record<string, string>;
}

/**
 * Ask shell-docs which docs pages a reader can reach.
 *
 * Run as a SUBPROCESS, not imported. This script is invoked from several
 * working directories — shell-docs locally and in its Docker build, `shell`
 * in its own build and in Validate Showcase — and the rules it needs live
 * in shell-docs behind two things that do not survive a cross-directory
 * import: the `@/…` path alias, which tsx resolves from whichever tsconfig
 * it finds at startup, and `gray-matter`, which Node resolves from the
 * importing package's tree. An earlier version pointed `process.chdir` at
 * shell-docs and imported dynamically; that fixed neither, because alias
 * resolution is fixed when tsx boots and dependency resolution follows the
 * file, not the cwd. It passed locally (run from shell-docs) and failed in
 * both CI build contexts.
 *
 * A child process with its own cwd and its own resolution root fixes both,
 * and keeps the reachability rules defined exactly once.
 *
 * Throws when the toolchain is missing. It used to return null and let the
 * caller ship an index with no docs rows, which was wrong: the `shell`
 * Dockerfile copies `shell-docs/src/content/`, so that build HAS the docs
 * tree and consumes the docs rows — its header search links across to the
 * docs host. Degrading it to zero docs rows on a `console.warn` cost the
 * showcase app its entire docs search while CI stayed green. Every build
 * that has the content tree now either gets the real decision or fails.
 */
function loadSearchablePages(): SearchablePagesPayload {
  const emitScript = path.join(
    SHELL_DOCS_ROOT,
    "scripts",
    "emit-searchable-pages.ts",
  );
  const scriptsModules = path.join(__dirname, "node_modules");
  // Prefer shell-docs' own install; fall back to this package's. The
  // fallback is what makes a plain repo checkout work: `showcase/shell` can
  // build without shell-docs ever being installed (it is outside the pnpm
  // workspace and ships its own lockfile), and CI does exactly that.
  const tsxCli = [
    path.join(SHELL_DOCS_ROOT, "node_modules", "tsx", "dist", "cli.mjs"),
    path.join(scriptsModules, "tsx", "dist", "cli.mjs"),
  ].find((candidate) => fs.existsSync(candidate));

  if (!tsxCli || !fs.existsSync(emitScript)) {
    throw new Error(
      `[generate-search-index] the shell-docs content tree is present but its ` +
        `toolchain is not: expected ${emitScript} and a tsx CLI in either ` +
        `${SHELL_DOCS_ROOT}/node_modules or ${scriptsModules}.\n` +
        `Every build that ships docs rows needs the reachability decision, so ` +
        `this cannot be skipped.\n` +
        `A Docker build must stage shell-docs/src/lib, shell-docs/scripts and ` +
        `shell-docs/tsconfig.json (see showcase/shell/Dockerfile).`,
    );
  }

  const outputPath = path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), "searchable-pages-")),
    "searchable-pages.json",
  );

  const result = spawnSync(process.execPath, [tsxCli, emitScript, outputPath], {
    cwd: SHELL_DOCS_ROOT,
    stdio: ["ignore", "inherit", "inherit"],
    env: {
      ...process.env,
      // shell-docs' library imports `gray-matter`, which Node resolves by
      // walking up from the importing FILE — so when shell-docs is not
      // installed, its own tree carries nothing. This package declares
      // gray-matter too; NODE_PATH is what lets the child find it there.
      // Only meaningful for CommonJS resolution, which is what tsx uses for
      // shell-docs (its package.json has no `"type": "module"`).
      NODE_PATH: [scriptsModules, process.env.NODE_PATH]
        .filter(Boolean)
        .join(path.delimiter),
    },
  });

  if (result.status !== 0) {
    throw new Error(
      `[generate-search-index] emit-searchable-pages failed with status ${result.status}. ` +
        `Docs search would ship unfiltered, so this is fatal.`,
    );
  }

  return JSON.parse(
    fs.readFileSync(outputPath, "utf-8"),
  ) as SearchablePagesPayload;
}

/**
 * Channel guides are re-routed at runtime onto the Slack and Microsoft
 * Teams surfaces by the search modal (`parseChannelDocsHref`), so their
 * `/docs/channels…` hrefs are index keys rather than destinations and must
 * not be measured against the docs navigation.
 */
function isChannelDocsEntry(href: string): boolean {
  return href === "/docs/channels" || href.startsWith("/docs/channels/");
}

/**
 * Frontend guidance pages are rewritten onto the per-frontend surfaces by
 * `normalizeDocsSearchEntry` and navigate from those surfaces' own
 * sidebars, not from the docs navigation tree.
 */
function isFrontendDocsEntry(href: string): boolean {
  return href.startsWith("/docs/frontends/");
}

async function main() {
  // A content-free build may emit a stub, but a partially staged tree must
  // never overwrite a complete search index with missing content families.
  const contentRoots = ["docs", "reference", "ag-ui"].map((name) =>
    path.join(CONTENT_ROOT, "content", name),
  );
  const missingRoots = contentRoots.filter((root) => !fs.existsSync(root));
  if (missingRoots.length > 0 && missingRoots.length < contentRoots.length) {
    throw new Error(
      `[generate-search-index] incomplete content tree; missing: ${missingRoots.join(", ")}`,
    );
  }

  const entries: SearchEntry[] = [];

  // Static pages. `/` is the showcase front door — it is filtered out of
  // the shell-docs index, where the docs index page already owns it. There
  // is deliberately no static "API Reference" row: the reference index
  // page (`content/reference/index.mdx`) already emits `/reference`.
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
      title: "AG-UI Overview",
      subtitle: "The Agent-User Interaction Protocol",
      section: "",
      href: "/ag-ui",
    },
  );

  // Track which scan roots exist so a misconfigured checkout produces a
  // loud empty-index rather than a tiny silent one. Missing all three
  // means the script is running outside a prepared tree (e.g. shell-docs
  // wasn't built into the expected layout) — fail the run so CI catches
  // the regression instead of shipping a crippled search modal.
  const scanDirsMissing: string[] = [];
  const scanDirsPresent: string[] = [];

  // CopilotKit Reference
  const refDir = path.join(CONTENT_ROOT, "content", "reference");
  if (fs.existsSync(refDir)) {
    const refEntries = scanMdxDir(refDir, "/reference", "reference");
    entries.push(...refEntries);
    console.log(`  Reference: ${refEntries.length} entries`);
    scanDirsPresent.push(refDir);
  } else {
    console.warn(
      `[generate-search-index] scan dir missing: ${refDir} — reference entries will be empty`,
    );
    scanDirsMissing.push(refDir);
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
    // "development/updates" is deliberately absent. It is titled "What's New"
    // and carries a single entry from April 2025, and it renders an <Update>
    // component this app does not provide, so opening it throws. Search must
    // not offer it. The page itself is vendored AG-UI content whose canonical
    // home is docs.ag-ui.com, so it is not fixed here — see the AG-UI mirror
    // question in the OSS-1079 PR.
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
    scanDirsPresent.push(aguiDir);
  } else {
    console.warn(
      `[generate-search-index] scan dir missing: ${aguiDir} — ag-ui entries will be empty`,
    );
    scanDirsMissing.push(aguiDir);
  }

  // CopilotKit Docs — only index pages a reader can actually reach.
  //
  // The old behavior indexed every `.mdx` on disk, which offered pages
  // that appear in no sidebar: leftovers from past reorganizations, with
  // stale content and no surrounding context. `searchable-pages` derives
  // the allowed set from the navigation the app renders instead. Reference
  // and AG-UI are untouched — AG-UI has its own published-slug allowlist
  // above and reference has its own frontmatter-driven navigation.
  const docsDir = path.join(CONTENT_ROOT, "content", "docs");
  let docsEntryCount = 0;
  const droppedDocsEntries: SearchEntry[] = [];
  const pages = fs.existsSync(docsDir) ? loadSearchablePages() : null;
  if (pages) {
    const searchableSlugs = new Set(pages.slugs);

    const kept: SearchEntry[] = [];
    const seenHrefs = new Set<string>();
    for (const entry of scanMdxDir(docsDir, "/docs", "page")) {
      // Canonicalize first: this strips route-group segments (`(other)`),
      // which the middleware would otherwise 301-redirect, and collapses a
      // trailing `/index` — so the emitted URL is the final one and the
      // filter key matches the sidebar's own route-group-free slugs. The
      // mapping is computed by shell-docs and shipped in the payload; see
      // loadSearchablePages for why it is not imported.
      const rawSlug = entry.href.replace(/^\/docs\/?/, "");
      const slug = pages.canonicalBySlug[rawSlug] ?? rawSlug;
      const href = slug ? `/docs/${slug}` : "/docs";
      const canonical = { ...entry, href };

      // Two files can canonicalize onto one URL (a stray `foo.mdx`
      // alongside `foo/index.mdx`). Only one of them is ever served, so
      // only one belongs in the index.
      if (seenHrefs.has(href)) continue;
      seenHrefs.add(href);

      if (isChannelDocsEntry(href) || isFrontendDocsEntry(href)) {
        kept.push(canonical);
        continue;
      }
      if (!searchableSlugs.has(slug)) {
        droppedDocsEntries.push(canonical);
        continue;
      }

      // The sidebar renames some entries; search should name pages the way
      // navigation names them so both surfaces speak the same language.
      const navTitle = pages.navTitles[slug];
      kept.push(navTitle ? { ...canonical, title: navTitle } : canonical);
    }

    const docsEntries = kept.flatMap(normalizeDocsSearchEntry);
    entries.push(...docsEntries);
    docsEntryCount = docsEntries.length;
    console.log(
      `  Docs: ${docsEntries.length} entries ` +
        `(${droppedDocsEntries.length} dropped as unreachable from any sidebar; ` +
        `${pages.fromNavigation.length} slugs in navigation, ` +
        `${pages.fromLinks.length} kept by an inbound prose link, ` +
        `${pages.forcedIn.length} forced in and ${pages.forcedOut.length} forced out by frontmatter)`,
    );

    fs.mkdirSync(path.dirname(DROPPED_REPORT_PATH), { recursive: true });
    fs.writeFileSync(
      DROPPED_REPORT_PATH,
      JSON.stringify(
        droppedDocsEntries
          .map(({ href, title }) => ({ href, title }))
          .sort((a, b) => a.href.localeCompare(b.href)),
        null,
        2,
      ) + "\n",
    );
    console.log(`  Dropped-entry report: ${DROPPED_REPORT_PATH}`);

    scanDirsPresent.push(docsDir);
  } else {
    // The content tree itself is absent. Some build contexts stage no docs
    // content at all and only need the static-pages stub so a header search
    // modal has something to render. A missing TOOLCHAIN is a different
    // matter and throws in loadSearchablePages — see the note there.
    console.warn(
      `[generate-search-index] scan dir missing: ${docsDir} — docs entries will be empty`,
    );
    scanDirsMissing.push(docsDir);
  }

  if (scanDirsPresent.length === 0) {
    // Some build contexts (e.g. the `shell` Docker build) intentionally
    // omit the shell-docs content tree — they only need the static-pages
    // stub so the header search modal has something to render and links
    // resolve across to docs.showcase.copilotkit.ai. Warn loudly so a
    // misconfigured full build is still visible in logs, but don't fail.
    console.warn(
      `[generate-search-index] all scan directories missing — emitting static-pages stub only. Missing: ${scanDirsMissing.join(", ")}`,
    );
  }

  const frontendRegistry = JSON.parse(
    fs.readFileSync(path.join(SHARED_DIR, "frontend-registry.json"), "utf-8"),
  );
  const featureRegistry = JSON.parse(
    fs.readFileSync(path.join(SHARED_DIR, "feature-registry.json"), "utf-8"),
  );
  const angularFeatureEntries = buildAngularFeatureSearchEntries(
    frontendRegistry,
    featureRegistry,
  );
  entries.push(...angularFeatureEntries);
  console.log(`  Angular features: ${angularFeatureEntries.length} entries`);

  // Fail loudly rather than shipping a nearly empty search. Keyed on the
  // content tree, not on whether the filter ran: an earlier version skipped
  // this check whenever the filter had been skipped, which is exactly the
  // combination that let the showcase app ship zero docs rows on a warning.
  // If the docs content is staged, docs rows are expected.
  if (fs.existsSync(docsDir) && docsEntryCount < MIN_DOCS_ENTRIES) {
    throw new Error(
      `[generate-search-index] docs coverage collapsed: ${docsEntryCount} ` +
        `docs entries, expected at least ${MIN_DOCS_ENTRIES}. The navigation ` +
        `walk in shell-docs/src/lib/searchable-pages is the likely cause — ` +
        `a nearly empty search must not ship.`,
    );
  }

  // Write (dual-emit to shell-docs + shell), filtered per target: the docs
  // app must not offer rows that leave the documentation for the showcase
  // host, while the showcase app keeps them because that app is the
  // showcase and its own search needs them.
  for (const { target, path: outputPath } of OUTPUTS) {
    const payload =
      target === "shell-docs"
        ? entries.filter((entry) => !SHOWCASE_HOST_DESTINATIONS.has(entry.href))
        : entries;
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, JSON.stringify(payload, null, 2) + "\n");
    console.log(`\nSearch index: ${outputPath} (${payload.length} entries)`);
  }
}

await main();
