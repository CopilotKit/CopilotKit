/**
 * Generate Search Index
 *
 * Scans reference MDX files and registry data to produce
 * a search index JSON for the shell's Cmd-K search modal.
 *
 * Docs pages are filtered to the ones a reader can actually reach from a
 * sidebar — see lib/docs-searchable/searchable-pages.ts.
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

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
// The docs pages live in shell-docs. The showcase shell's header search links
// to docs routes, so the index scans shell-docs' pages. It also still writes a
// copy into shell-docs/src/data, which the docs app itself doesn't read.
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
// 256 entries once the frontend-neutral pages moved into `docs/(shared)`
// and every frontend's pages were placed by where they live (255 in the
// build test's tree, which stages no snippets); the floor sits ~15% under
// that so ordinary content churn (a section retired, a folder merged)
// passes while a broken navigation walk — which collapses the union to
// near zero — fails the build instead of shipping an empty search.
const MIN_DOCS_ENTRIES = 218;

interface SearchEntry {
  type: "page" | "reference";
  title: string;
  subtitle: string;
  section: string;
  href: string;
}

interface FrontendSearchPage {
  id: string;
  name: string;
}

const FRONTEND_SEARCH_PAGES: readonly FrontendSearchPage[] = [
  { id: "vue", name: "Vue" },
  { id: "react-native", name: "React Native" },
  { id: "angular", name: "Angular" },
  { id: "slack", name: "Slack" },
  { id: "teams", name: "Microsoft Teams" },
];

const FRONTEND_NAMES = new Map(
  FRONTEND_SEARCH_PAGES.map((frontend) => [frontend.id, frontend.name]),
);

function deriveSectionLabel(hrefPrefix: string, href: string): string {
  // Strip prefix to get relative path, then drop the filename
  const rel = href.slice(hrefPrefix.length + 1); // e.g. "concepts/middleware"
  const parts = rel.split("/");
  if (parts.length <= 1) return ""; // top-level page, no section

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
  type: "page" | "reference",
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
  if (slugPath === "using-these-docs" || slugPath === "docs-status") {
    return [];
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

/** Keep the first entry for each destination after all URL rewrites. */
function dedupeByHref(entries: SearchEntry[]): SearchEntry[] {
  const seen = new Set<string>();
  return entries.filter((entry) => {
    if (seen.has(entry.href)) return false;
    seen.add(entry.href);
    return true;
  });
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
 * Work out which docs pages a reader can reach
 * (lib/docs-searchable/emit-searchable-pages.ts).
 *
 * Run as a SUBPROCESS, not imported, with shell-docs as the working
 * directory: the rules read the docs content and the generated registry
 * relative to it. The rules sit in this package, so `gray-matter` resolves
 * from its node_modules and no shell-docs install is needed.
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
    __dirname,
    "lib",
    "docs-searchable",
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
        `A Docker build must stage showcase/scripts (see showcase/shell/Dockerfile).`,
    );
  }

  const outputPath = path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), "searchable-pages-")),
    "searchable-pages.json",
  );

  const result = spawnSync(process.execPath, [tsxCli, emitScript, outputPath], {
    cwd: SHELL_DOCS_ROOT,
    stdio: ["ignore", "inherit", "inherit"],
    env: process.env,
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
  const contentRoots = ["docs", "reference"].map((name) =>
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
  );

  // Track which scan roots exist so a misconfigured checkout produces a
  // loud empty-index rather than a tiny silent one. Missing both
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

  // CopilotKit Docs — only index pages a reader can actually reach.
  //
  // The old behavior indexed every `.mdx` on disk, which offered pages
  // that appear in no sidebar: leftovers from past reorganizations, with
  // stale content and no surrounding context. `searchable-pages` derives
  // the allowed set from the navigation the app renders instead. Reference
  // has its own frontmatter-driven navigation.
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

  const deduplicatedEntries = dedupeByHref(entries);

  // Fail loudly rather than shipping a nearly empty search. Keyed on the
  // content tree, not on whether the filter ran: an earlier version skipped
  // this check whenever the filter had been skipped, which is exactly the
  // combination that let the showcase app ship zero docs rows on a warning.
  // If the docs content is staged, docs rows are expected.
  if (fs.existsSync(docsDir) && docsEntryCount < MIN_DOCS_ENTRIES) {
    throw new Error(
      `[generate-search-index] docs coverage collapsed: ${docsEntryCount} ` +
        `docs entries, expected at least ${MIN_DOCS_ENTRIES}. The navigation ` +
        `walk in lib/docs-searchable/searchable-pages is the likely cause — ` +
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
        ? deduplicatedEntries.filter(
            (entry) => !SHOWCASE_HOST_DESTINATIONS.has(entry.href),
          )
        : deduplicatedEntries;
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, JSON.stringify(payload, null, 2) + "\n");
    console.log(`\nSearch index: ${outputPath} (${payload.length} entries)`);
  }
}

await main();
