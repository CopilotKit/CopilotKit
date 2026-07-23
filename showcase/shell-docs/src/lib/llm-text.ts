// LLM-friendly rendering of docs pages.
//
// Three consumers:
//   1. `/llms.txt`            — index of every docs page (title + URL).
//   2. `/llms-full.txt`       — concatenated full body of every page.
//   3. `/<path>.md` and .mdx  — single-page raw markdown, snippets inlined.
//
// All three reuse `renderPageToLlmText()` so the body shape is consistent
// across endpoints. The renderer takes the raw MDX source (frontmatter +
// body) and:
//
//   - strips the YAML frontmatter (we prepend our own H1 + description)
//   - inlines shared `<Component />` snippets via `inlineSnippets()` from
//     docs-render (same map used at page render time)
//   - resolves `<Snippet />` tags to fenced code blocks by reading the
//     same `demo-content.json` that the runtime <Snippet> component does
//   - strips `<InlineDemo />` (no body content — it's a live iframe demo)
//   - keeps every other JSX tag verbatim (Tabs / Callout / Card render
//     visually but their inner Markdown is still readable as prose)
//
// Snippet resolution mirrors the snippet.tsx server component:
//   - `region="…"` wins when both are passed.
//   - falls back to `file=` + `lines=` slicing when no region marker exists.
//   - uses the page's frontmatter `snippet_framework` / `snippet_cell` as
//     defaults (mirrors the runtime page-context defaults).
//
// Framework resolution for snippets: when a page is requested under a
// framework URL prefix (`/google-adk/...`), that slug overrides the
// frontmatter default. For the framework-agnostic `/<slug>.md` and the
// /llms-full.txt aggregate, we pick the first framework that has a
// resolvable snippet — preferring `langgraph-python` (the north-star
// example) when available so output is deterministic across builds.

import fs from "fs";
import path from "path";
import matter from "gray-matter";
import { CONTENT_DIR, inlineSnippets, loadDoc } from "./docs-render";
import { getDocsFolder, getIntegrations, ROOT_FRAMEWORK } from "./registry";
import {
  REFERENCE_VERSIONS,
  loadReferenceVersionItems,
  resolveReferencePage,
} from "./reference-items";
import {
  AG_UI_CONTENT_DIR,
  DOCS_CONTENT_DIR,
  walkMdx,
} from "./sitemap-helpers";
import demoContent from "@/data/demo-content.json";
import angularSourceContent from "@/data/angular-source-content.json";
import { filterFrontendScopedBlocks } from "./toc";
import type { FrontendId } from "./frontend-options";
import { resolveDocsHref } from "./docs-link-rewrite";

interface Region {
  file: string;
  startLine: number;
  endLine: number;
  code: string;
  language: string;
}

interface DemoFile {
  filename: string;
  language: string;
  content: string;
}

interface DemoRecord {
  regions?: Record<string, Region>;
  files?: DemoFile[];
}

const demos: Record<string, DemoRecord> = (
  demoContent as { demos: Record<string, DemoRecord> }
).demos;

const angularRegions = (
  angularSourceContent as {
    regions: Record<
      string,
      { file: string; language: string; content: string }
    >;
  }
).regions;

// Preferred framework for cross-framework `<Snippet />` resolution when
// the caller hasn't picked one (i.e. `/<slug>.md` without a framework
// scope, or /llms-full.txt). We try this list in order before falling
// back to whichever cell key happens to be present.
const SNIPPET_FRAMEWORK_PREFERENCE = [
  "langgraph-python",
  "langgraph-typescript",
  "google-adk",
  "mastra",
  "built-in-agent",
];

/**
 * Map Angular frontend source slugs to the URLs served by the docs router.
 */
function canonicalDocsUrl(slug: string): string {
  if (slug === "frontends/angular") return "angular";
  if (slug === "frontends/angular/docs-status") {
    return "angular/using-these-docs";
  }
  if (slug.startsWith("frontends/angular/")) {
    return slug.replace(/^frontends\//, "");
  }
  return slug;
}

// -----------------------------------------------------------------------
// Public types
// -----------------------------------------------------------------------

export interface LlmPage {
  /** Canonical URL path, no leading slash. e.g. `quickstart` or
   *  `google-adk/generative-ui/reasoning`. */
  url: string;
  /** Frontmatter title (or first H1 fallback). */
  title: string;
  /** Frontmatter description, if present. */
  description?: string;
  /** Absolute path of the source MDX file. */
  filePath: string;
  /** Slug used to resolve the doc via `loadDoc()`. */
  loadSlug: string;
  /** Optional framework slug for snippet resolution. Set on framework
   *  override pages (where `loadSlug` starts with `integrations/<folder>/`). */
  framework?: string;
}

// -----------------------------------------------------------------------
// Page enumeration
// -----------------------------------------------------------------------

/**
 * Enumerate every docs page that should appear in `llms.txt` and the
 * concatenated `llms-full.txt` aggregate. Covers four URL families:
 *
 *   - Bare unscoped docs   (/<slug>)
 *   - Per-framework        (/<framework>/<slug>)
 *   - Reference            (/reference/<slug>)
 *   - AG-UI                (/ag-ui/<slug>)
 *
 * We intentionally do NOT cross-product unscoped pages × every framework
 * — that would emit dozens of near-duplicate entries for the LLM. The
 * bare URL serves as the canonical entry; framework-scoped entries are
 * included only for per-framework override files actually present under
 * `content/docs/integrations/<folder>/`.
 */
export function getAllLlmPages(): LlmPage[] {
  const pages: LlmPage[] = [];
  const seenUrls = new Set<string>();

  const push = (page: LlmPage): void => {
    if (seenUrls.has(page.url)) return;
    seenUrls.add(page.url);
    pages.push(page);
  };

  // ROOT_FRAMEWORK's authored pages win at bare root URLs (the same
  // resolution the live pages use — see UnscopedDocsPage). Walk its
  // folder once so the bare loop below can swap in the override.
  const rootFolder = getDocsFolder(ROOT_FRAMEWORK);
  const rootOverrides = new Map<string, string>(); // slug → filePath
  const rootDir = path.join(CONTENT_DIR, "integrations", rootFolder);
  if (fs.existsSync(rootDir)) {
    for (const { slug, filePath } of walkMdx(rootDir)) {
      rootOverrides.set(slug, filePath);
    }
  }

  // 1. Bare unscoped docs (`src/content/docs/**.mdx`, minus `integrations/`).
  for (const { slug, filePath } of walkMdx(
    DOCS_CONTENT_DIR,
    new Set(["integrations"]),
  )) {
    if (!slug) continue;
    // The root `built-in-agent.mdx` topic page's bare URL permanently
    // redirects to `/` (the retired framework prefix); it stays
    // reachable under other frameworks' scopes only.
    if (slug === ROOT_FRAMEWORK) continue;
    const overridePath = rootOverrides.get(slug);
    const meta = readMetaFromFile(overridePath ?? filePath);
    push({
      url: canonicalDocsUrl(slug),
      title: meta.title ?? slug,
      description: meta.description,
      filePath: overridePath ?? filePath,
      loadSlug: overridePath ? `integrations/${rootFolder}/${slug}` : slug,
      framework: overridePath ? ROOT_FRAMEWORK : undefined,
    });
  }

  // 2. Per-framework override pages — files under
  //    `content/docs/integrations/<folder>/` that don't have a
  //    root-level equivalent. We emit them at `/<framework>/<topic>`,
  //    or at `/<framework>` for the folder's `index.mdx`.
  //
  //    Note: `walkMdx` strips trailing `/index` from yielded slugs, so
  //    a folder's `index.mdx` arrives here as `slug === ""`. The previous
  //    `if (!slug) continue` guard silently skipped framework root URLs
  //    from `/llms.txt`, leaving LLM crawlers unable to find e.g.
  //    `/langgraph-python`. Treat empty slug as the framework root and
  //    emit it as the bare integration URL.
  const integrations = getIntegrations();
  for (const integration of integrations) {
    if (integration.docs_mode === "hidden") continue;
    const folder = getDocsFolder(integration.slug);
    const integrationDir = path.join(CONTENT_DIR, "integrations", folder);
    if (!fs.existsSync(integrationDir)) continue;
    const servedAtRoot = integration.slug === ROOT_FRAMEWORK;
    for (const { slug, filePath } of walkMdx(integrationDir)) {
      const isRoot = !slug;
      // ROOT_FRAMEWORK pages live at bare root URLs. Slugs shadowing a
      // bare doc were already pushed (BIA-resolved) in pass 1, and the
      // folder index's URL would be the home page — skip it.
      if (servedAtRoot && isRoot) continue;
      const url = servedAtRoot
        ? slug
        : isRoot
          ? integration.slug
          : `${integration.slug}/${slug}`;
      const meta = readMetaFromFile(filePath);
      push({
        url,
        title: meta.title ?? (isRoot ? integration.name : slug),
        description: meta.description,
        filePath,
        loadSlug: `integrations/${folder}/${slug || "index"}`,
        framework: integration.slug,
      });
    }
  }

  // 3. Reference docs — all SDK versions at their canonical versioned URLs.
  //
  //    The v2 (current) API reference lives at the root of
  //    `src/content/reference/` (e.g. `hooks/useCopilotAction.mdx`) and is
  //    served at `/reference/v2/hooks/useCopilotAction`. Older versions live
  //    under their own subfolder (`v1/`, `react-native/`, etc.) and are
  //    served at `/reference/v1/hooks/...`.
  //
  //    We enumerate via `loadReferenceVersionItems` (which already knows the
  //    canonical URL for each version) rather than walking the filesystem
  //    directly, so that LLM consumers see the same versioned URL they would
  //    navigate to in the browser.
  for (const version of REFERENCE_VERSIONS) {
    // Version root index page (e.g. `/reference/v2`, `/reference/v1`).
    const rootResolved = resolveReferencePage([version]);
    if (rootResolved) {
      const rootMeta = readMetaFromFile(rootResolved.filePath);
      push({
        url: `reference/${version}`,
        title: rootMeta.title ?? version,
        description: rootMeta.description,
        filePath: rootResolved.filePath,
        loadSlug: `__reference__/${rootResolved.contentSlug}`,
      });
    }

    // Individual API reference pages within this version.
    for (const item of loadReferenceVersionItems(version)) {
      // item.url is the canonical path, e.g. "/reference/v2/hooks/foo".
      // Strip the leading "/" so LlmPage.url has no leading slash.
      const url = item.url.replace(/^\//, "");
      // Resolve the source file via the same logic the page renderer uses.
      const resolved = resolveReferencePage(
        url.replace(/^reference\//, "").split("/"),
      );
      if (!resolved) continue;
      push({
        url,
        title: item.title,
        description: item.description,
        filePath: resolved.filePath,
        // Reference docs live outside CONTENT_DIR; readSource branches on
        // this prefix to read via fs.readFileSync instead of loadDoc().
        loadSlug: `__reference__/${resolved.contentSlug}`,
      });
    }
  }

  // 4. AG-UI.
  for (const { slug, filePath } of walkMdx(AG_UI_CONTENT_DIR)) {
    const meta = readMetaFromFile(filePath);
    push({
      url: slug ? `ag-ui/${slug}` : "ag-ui",
      title: meta.title ?? slug,
      description: meta.description,
      filePath,
      loadSlug: `__ag-ui__/${slug || "index"}`,
    });
  }

  return pages.sort((a, b) => a.url.localeCompare(b.url));
}

function readMetaFromFile(absPath: string): {
  title?: string;
  description?: string;
} {
  try {
    const raw = fs.readFileSync(absPath, "utf-8");
    const { data } = matter(raw);
    return {
      title: typeof data.title === "string" ? data.title : undefined,
      description:
        typeof data.description === "string" ? data.description : undefined,
    };
  } catch (err) {
    // Log so an author whose page has malformed YAML / unreadable file
    // can correlate "my page appears bare in /llms.txt" with the
    // underlying cause. Empty meta is still returned so the rest of the
    // index render keeps going.
    console.error("[llm-text] failed to read meta", absPath, err);
    return {};
  }
}

// -----------------------------------------------------------------------
// Snippet resolution
// -----------------------------------------------------------------------

interface SnippetAttrs {
  region?: string;
  file?: string;
  lines?: string;
  framework?: string;
  cell?: string;
}

/**
 * Parse the attributes of a single `<Snippet ... />` tag. Accepts both
 * single- and double-quoted attribute values. No support for curly-brace
 * JSX expressions — every callsite in our content uses string literals.
 */
function parseSnippetAttrs(tag: string): SnippetAttrs {
  const attrs: SnippetAttrs = {};
  const re = /(\w+)\s*=\s*"([^"]*)"|(\w+)\s*=\s*'([^']*)'/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(tag)) !== null) {
    const name = m[1] ?? m[3];
    const value = m[2] ?? m[4];
    if (name === "region") attrs.region = value;
    else if (name === "file") attrs.file = value;
    else if (name === "lines") attrs.lines = value;
    else if (name === "framework") attrs.framework = value;
    else if (name === "cell") attrs.cell = value;
  }
  return attrs;
}

function parseLineRange(input: string): [number, number] | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const openEnded = trimmed.match(/^(\d+)\s*[-–]\s*$/);
  if (openEnded) {
    const start = parseInt(openEnded[1], 10);
    if (start > 0) return [start, Number.POSITIVE_INFINITY];
    return null;
  }
  const dash = trimmed.match(/^(\d+)\s*[-–]\s*(\d+)$/);
  if (dash) {
    const start = parseInt(dash[1], 10);
    const end = parseInt(dash[2], 10);
    if (start > 0 && end >= start) return [start, end];
    return null;
  }
  const single = trimmed.match(/^(\d+)$/);
  if (single) {
    const n = parseInt(single[1], 10);
    if (n > 0) return [n, n];
  }
  return null;
}

/**
 * Pick a framework slug for snippet lookup. Order:
 *   1. Explicit `framework="..."` on the tag.
 *   2. Caller-supplied `defaultFramework` (URL-scoped framework, or
 *      frontmatter `snippet_framework`).
 *   3. First framework in `SNIPPET_FRAMEWORK_PREFERENCE` that has a
 *      demo record for the cell.
 *   4. First key in `demos` that ends with `::<cell>`.
 *
 * Returns null when no framework has a demo for the cell.
 */
function pickFramework(
  cell: string,
  explicit: string | undefined,
  defaultFramework: string | undefined,
): string | null {
  if (explicit && demos[`${explicit}::${cell}`]) return explicit;
  if (defaultFramework && demos[`${defaultFramework}::${cell}`])
    return defaultFramework;
  for (const fw of SNIPPET_FRAMEWORK_PREFERENCE) {
    if (demos[`${fw}::${cell}`]) return fw;
  }
  for (const key of Object.keys(demos)) {
    const [fw, c] = key.split("::");
    if (c === cell) return fw;
  }
  return null;
}

function fenceFor(language: string, code: string): string {
  // Pick a fence string long enough to never collide with backtick
  // sequences inside `code`. Default to triple-backtick; bump to four
  // (or more) if the code contains a longer run.
  let fence = "```";
  const m = code.match(/`{3,}/g);
  if (m) {
    const longest = m.reduce((a, b) => (a.length >= b.length ? a : b));
    fence = "`".repeat(longest.length + 1);
  }
  return `${fence}${language || ""}\n${code}\n${fence}`;
}

/**
 * Render a `// path/to/file` style filename header that matches the
 * comment syntax of the snippet's language. Hardcoding `//` (as the
 * earlier version did) produces syntactically broken code in the fenced
 * block for Python (`//` is integer division), YAML / Bash / TOML
 * (where `#` is the comment marker), or anything else not in the
 * C family — an LLM ingesting `/llms-full.txt` would see what looks
 * like real code from the file but with an invalid first line. JSON
 * has no native comment form, so we drop the header entirely there
 * rather than ship invalid JSON in the fence.
 */
function fileHeaderComment(language: string, text: string): string {
  const lang = (language || "").toLowerCase();
  if (
    lang === "python" ||
    lang === "py" ||
    lang === "bash" ||
    lang === "sh" ||
    lang === "shell" ||
    lang === "yaml" ||
    lang === "yml" ||
    lang === "toml" ||
    lang === "ruby" ||
    lang === "rb" ||
    lang === "r" ||
    lang === "dockerfile" ||
    lang === "makefile" ||
    lang === "ini" ||
    lang === "conf"
  ) {
    return `# ${text}`;
  }
  if (lang === "css" || lang === "scss" || lang === "less") {
    return `/* ${text} */`;
  }
  if (
    lang === "html" ||
    lang === "xml" ||
    lang === "svg" ||
    lang === "md" ||
    lang === "markdown" ||
    lang === "mdx"
  ) {
    return `<!-- ${text} -->`;
  }
  if (lang === "sql") {
    return `-- ${text}`;
  }
  // JSON / JSONC has no portable comment form. Skip the header rather
  // than emit invalid JSON.
  if (lang === "json" || lang === "jsonc") {
    return "";
  }
  // Default to C-style `//` for TS/JS/Java/C/C++/C#/Go/Rust/Swift/Kotlin/Scala/etc.
  return `// ${text}`;
}

/**
 * Resolve one `<Snippet />` tag to a fenced markdown code block. Returns
 * a short HTML comment when the snippet can't be resolved (so the
 * surrounding prose still reads cleanly).
 */
function resolveSnippet(
  attrs: SnippetAttrs,
  defaultFramework: string | undefined,
  defaultCell: string | undefined,
): string {
  const cell = attrs.cell ?? defaultCell;
  if (!cell) {
    return "<!-- snippet skipped: no cell -->";
  }
  const framework = pickFramework(cell, attrs.framework, defaultFramework);
  if (!framework) {
    return `<!-- snippet skipped: no demo for cell '${cell}' -->`;
  }

  const demo = demos[`${framework}::${cell}`];
  if (!demo) {
    return `<!-- snippet skipped: ${framework}::${cell} not bundled -->`;
  }

  // Region mode wins when both `region` and `file` are passed —
  // matches the runtime <Snippet /> component.
  if (attrs.region) {
    const reg = demo.regions?.[attrs.region];
    if (!reg) {
      return `<!-- snippet skipped: region '${attrs.region}' missing in ${framework}::${cell} -->`;
    }
    const header = fileHeaderComment(reg.language, reg.file);
    return fenceFor(reg.language, header ? `${header}\n${reg.code}` : reg.code);
  }

  // file + lines mode.
  if (attrs.file) {
    const demoFile = demo.files?.find((f) => f.filename === attrs.file);
    if (!demoFile) {
      return `<!-- snippet skipped: file '${attrs.file}' not bundled in ${framework}::${cell} -->`;
    }
    const content = demoFile.content.replace(/\n$/, "");
    if (!attrs.lines) {
      const header = fileHeaderComment(demoFile.language, demoFile.filename);
      return fenceFor(
        demoFile.language,
        header ? `${header}\n${content}` : content,
      );
    }
    const range = parseLineRange(attrs.lines);
    if (!range) {
      return `<!-- snippet skipped: invalid lines='${attrs.lines}' -->`;
    }
    const lines = content.split("\n");
    const [start, end] = range;
    if (start > lines.length) {
      return `<!-- snippet skipped: lines '${attrs.lines}' out of range -->`;
    }
    const slice = lines
      .slice(start - 1, Math.min(end, lines.length))
      .join("\n");
    const header = fileHeaderComment(
      demoFile.language,
      `${demoFile.filename} (lines ${start}-${Math.min(end, lines.length)})`,
    );
    return fenceFor(demoFile.language, header ? `${header}\n${slice}` : slice);
  }

  return "<!-- snippet skipped: needs region or file -->";
}

// -----------------------------------------------------------------------
// Body rendering
// -----------------------------------------------------------------------

/**
 * Strip the YAML frontmatter block from a raw MDX source. Returns the
 * body untouched when no frontmatter is present.
 */
function stripFrontmatter(source: string): string {
  return source.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "");
}

/**
 * Replace every `<Snippet ... />` tag in `body` with a fenced code block
 * resolved from `demo-content.json`. Both self-closing and split-line
 * forms are handled; the regex is forgiving about whitespace inside the
 * tag.
 */
function expandSnippets(
  body: string,
  defaultFramework: string | undefined,
  defaultCell: string | undefined,
): string {
  return body.replace(/<Snippet\b([\s\S]*?)\/>/g, (_match, inner: string) => {
    const attrs = parseSnippetAttrs(inner);
    return resolveSnippet(attrs, defaultFramework, defaultCell);
  });
}

/** Resolve Angular-authored docs snippets from the canonical Showcase app. */
function expandAngularSnippets(body: string): string {
  return body.replace(
    /<AngularSnippet\b([\s\S]*?)\/>/g,
    (_match, inner: string) => {
      const region = /\bregion\s*=\s*["']([^"']+)["']/.exec(inner)?.[1];
      const source = region ? angularRegions[region] : undefined;
      if (!source) {
        return `<!-- Angular Showcase snippet skipped: missing region ${region ?? "(none)"} -->`;
      }
      const header = fileHeaderComment(source.language, source.file);
      return fenceFor(
        source.language,
        header ? `${header}\n${source.content}` : source.content,
      );
    },
  );
}

/**
 * Drop `<InlineDemo ... />` tags — these mount live iframes in the
 * browser; in plain markdown they're noise. Leave a short note so the
 * LLM still knows a demo exists at that point in the page.
 */
function stripInlineDemos(body: string): string {
  return body.replace(
    /<InlineDemo\b([\s\S]*?)\/>/g,
    (_match, inner: string) => {
      const demoAttr = /demo\s*=\s*["']([^"']+)["']/.exec(inner);
      return demoAttr
        ? `\n<!-- interactive demo: ${demoAttr[1]} -->\n`
        : "\n<!-- interactive demo -->\n";
    },
  );
}

function rewriteAngularLinks(body: string, page: LlmPage): string {
  const parts = page.url.split("/").filter(Boolean);
  if (parts[0] !== "angular") return body;

  const backendSlugs = new Set(
    getIntegrations().map((integration) => integration.slug),
  );
  const backend = parts[1] && backendSlugs.has(parts[1]) ? parts[1] : null;
  const slugHrefPrefix = backend ? `/angular/${backend}` : "/angular";
  const options = {
    slugHrefPrefix,
    frameworkOverride: backend ?? ROOT_FRAMEWORK,
  };
  const rewrite = (href: string): string =>
    resolveDocsHref(href, options) ?? href;

  return body
    .split(/(```[\s\S]*?```)/g)
    .map((chunk, index) => {
      if (index % 2 === 1) return chunk;
      return chunk
        .replace(
          /(\]\()((?:\/(?!\/))[^\s)]+)(\))/g,
          (_match, open: string, href: string, close: string) =>
            `${open}${rewrite(href)}${close}`,
        )
        .replace(
          /(\bhref\s*=\s*["'])((?:\/(?!\/))[^"']+)(["'])/g,
          (_match, open: string, href: string, close: string) =>
            `${open}${rewrite(href)}${close}`,
        );
    })
    .join("");
}

/**
 * Convert an MDX source into LLM-friendly markdown. The output:
 *
 *   - starts with `# <title>` and an optional description blockquote,
 *   - inlines shared snippets (`<AGUI />`, `<FrontendTools />`, etc.)
 *     via the SNIPPET_MAP in docs-render,
 *   - resolves `<Snippet ... />` to fenced code blocks,
 *   - strips `<InlineDemo />`,
 *   - leaves the rest of the MDX intact.
 *
 * `framework` selects which integration's cells `<Snippet />` should
 * resolve to. When undefined, picks the first framework that has a
 * matching cell (with a preference list).
 */
export function renderPageToLlmText(
  page: LlmPage,
  options: { framework?: string; frontend?: FrontendId } = {},
): string {
  const raw = readSource(page);
  if (!raw) return "";

  const { data } = matter(raw);
  const title =
    (typeof data.title === "string" && data.title) ||
    page.title ||
    page.url ||
    "";
  const description =
    typeof data.description === "string" ? data.description : undefined;
  const frontmatterFramework =
    typeof data.snippet_framework === "string"
      ? data.snippet_framework
      : undefined;
  const frontmatterCell =
    typeof data.snippet_cell === "string" ? data.snippet_cell : undefined;
  const framework = options.framework ?? page.framework ?? frontmatterFramework;

  let body = stripFrontmatter(raw);

  // 1) Inline `<Component />` shared snippets (`<AGUI />`, etc.). Uses
  //    the SNIPPET_MAP / SUBPATH_TO_COMPONENT logic — same as the page
  //    renderer uses for the live HTML view.
  body = inlineSnippets(body, page.loadSlug);

  // Imported snippets can contain frontend-scoped branches of their own.
  // Filter after inlining so raw Markdown output follows the same frontend
  // selection as the live MDX component tree.
  body = filterFrontendScopedBlocks(body, options.frontend);

  // 2) Resolve `<Snippet ... />` to fenced code.
  body = expandSnippets(body, framework, frontmatterCell);

  // 3) Resolve regions from the canonical Angular Showcase app.
  body = expandAngularSnippets(body);

  // 4) Drop `<InlineDemo />`.
  body = stripInlineDemos(body);

  // 5) Keep raw Markdown links in the same Angular surface as the live page.
  body = rewriteAngularLinks(body, page);

  // 6) Prepend an H1 (and description blockquote) so consumers always
  //    get a clear page title — frontmatter alone wouldn't survive the
  //    strip step.
  const header: string[] = [`# ${title}`];
  if (description) header.push("", `> ${description}`);
  header.push("");
  return `${header.join("\n")}${body.trimEnd()}\n`;
}

/**
 * Read the source MDX for a page. Bare docs slugs go through
 * `loadDoc()` (which also handles index files and frontmatter parsing).
 * Reference / AG-UI files use the absolute path stashed on `LlmPage`.
 */
function readSource(page: LlmPage): string | null {
  if (
    page.loadSlug.startsWith("__reference__/") ||
    page.loadSlug.startsWith("__ag-ui__/")
  ) {
    try {
      return fs.readFileSync(page.filePath, "utf-8");
    } catch (err) {
      // Same rationale as `readMetaFromFile` — log so a missing body in
      // `/llms-full.txt` can be traced back to the actual filesystem
      // error rather than silently dropped via the `if (!body) continue`
      // guard in the route handler.
      console.error("[llm-text] failed to read source", page.filePath, err);
      return null;
    }
  }
  const doc = loadDoc(page.loadSlug);
  return doc?.source ?? null;
}

// -----------------------------------------------------------------------
// Index rendering (`llms.txt`)
// -----------------------------------------------------------------------

/**
 * Format the list of pages as the `llms.txt` Markdown index. Each entry
 * is a list item with a Markdown link; optional description follows
 * after a colon.
 */
export function renderLlmsIndex(pages: LlmPage[], baseUrl: string): string {
  const out: string[] = ["# CopilotKit Docs", ""];
  out.push(
    "> Docs, live demos, and integrations for CopilotKit — the frontend framework for AI agents.",
    "",
    "## Pages",
    "",
  );
  for (const page of pages) {
    const url = `${baseUrl}/${page.url}`;
    const title = page.title || page.url;
    const desc = page.description ? `: ${page.description}` : "";
    out.push(`- [${title}](${url})${desc}`);
  }
  return out.join("\n") + "\n";
}
