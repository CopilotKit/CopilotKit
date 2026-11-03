import {
  getAngularSourceRegion,
  getIntegration,
  getSetupSource,
} from "@/components/docs-mdx/data";
import type { DocsScope } from "@/components/docs-mdx/scope";
import {
  frameworkHas,
  hasAngularBackend,
} from "@/components/docs-mdx/showcase/framework-gates";
import {
  inlineDemoTarget,
  missingDemo,
  resolveSnippet,
  snippetFileName,
  type SnippetSource,
} from "@/components/docs-mdx/showcase/sources";
import { ROOT_FRAMEWORK } from "@/lib/live-scope";

// The showcase components of a page as Markdown: what `<FrameworkSetup>`,
// `<Snippet>`, `<AngularSnippet>`, `<InlineDemo>`, and the `<FrontendOnly>`,
// `<WhenAngularBackend>` and `<WhenFrameworkHas>` gates render on the page,
// resolved through the same lookups (`src/components/docs-mdx/showcase`) for
// the page's scope. Code comes out as fenced blocks titled with the file, a
// branch the page doesn't show is dropped, and one it shows loses its tags.
// shell-docs did this in `src/lib/llm-text.ts` (`expandSnippets` & co.).
//
// Tags inside fenced code or inline code spans are left alone.

/** The page the Markdown is for. */
export interface ShowcasePage {
  scope: DocsScope;
  /** Its `snippet_framework` frontmatter (`<Snippet>`, `<WhenFrameworkHas>`). */
  defaultFramework?: string;
  /** Its `snippet_cell` frontmatter (`<Snippet>`). */
  defaultCell?: string;
}

/** `<FrameworkSetup concept>`: the framework's bundled setup MDX, in place. */
export function expandFrameworkSetups(
  body: string,
  { scope }: ShowcasePage,
): string {
  return replaceTags(body, "FrameworkSetup", (attrs) => {
    const framework = scope.framework ?? text(attrs.currentFramework);
    const concept = text(attrs.concept);
    // Nothing bundled is a deliberate "no setup needed here", as on the page.
    return (framework && concept && getSetupSource(framework, concept)) || "";
  });
}

/** Resolve the gates, then the code, the way the page renders them. */
export function expandShowcase(body: string, page: ShowcasePage): string {
  const { scope, defaultFramework, defaultCell } = page;
  let out = filterBlocks(
    body,
    "FrontendOnly",
    (attrs) => attrs.frontend === scope.frontend,
  );
  out = filterBlocks(
    out,
    "WhenAngularBackend",
    (attrs) =>
      hasAngularBackend(scope.framework ?? text(attrs.currentFramework)) ===
      (attrs.selected !== false),
  );
  out = filterBlocks(out, "WhenFrameworkHas", (attrs) =>
    frameworkHas(
      text(attrs.framework) ?? scope.framework ?? defaultFramework,
      text(attrs.flag) ?? "",
      { equals: text(attrs.equals), absent: attrs.absent === true },
    ),
  );

  out = replaceTags(out, "Snippet", (attrs) =>
    snippetMarkdown(
      resolveSnippet(
        {
          region: text(attrs.region),
          file: text(attrs.file),
          lines: text(attrs.lines),
          framework: text(attrs.framework),
          cell: text(attrs.cell),
          defaultFramework,
          defaultCell,
        },
        scope,
      ),
      attrs.noCaption === true,
    ),
  );

  out = replaceTags(out, "AngularSnippet", (attrs) => {
    const region = text(attrs.region);
    const source = region ? getAngularSourceRegion(region) : undefined;
    if (!source) {
      return `<!-- Angular snippet skipped: missing region ${region ?? "(none)"} -->`;
    }
    return fence(
      source.content,
      source.language,
      attrs.noCaption === true ? undefined : source.file,
    );
  });

  // A live demo has no Markdown. Its spot is kept as a comment, with the code
  // an author picked for readers who can't open it (`llmRegion`, or a
  // comma-separated `llmFiles`).
  out = replaceTags(out, "InlineDemo", (attrs) => {
    const target = inlineDemoTarget(
      {
        integration: text(attrs.integration),
        demo: text(attrs.demo),
        defaultFramework,
      },
      scope,
    );
    if ("empty" in target) return "";
    const region = text(attrs.llmRegion);
    const files = region ? [] : (text(attrs.llmFiles)?.split(",") ?? []);
    const code = [
      ...(region ? [{ region }] : []),
      ...files.map((file) => ({ file: file.trim() })),
    ]
      .map((source) =>
        resolveSnippet(
          { ...source, framework: target.slug, cell: target.demo },
          scope,
        ),
      )
      .filter((source) => source.kind === "code")
      .map((source) => snippetMarkdown(source, false));
    return [`<!-- interactive demo: ${target.demo} -->`, ...code].join("\n\n");
  });

  return collapseBlankLines(out);
}

/**
 * The note the page opens with when its framework has no code for its cell
 * (`MissingDemoBanner`), or "". Its links lead to this page on frameworks that
 * have the code, when the URL names the framework.
 */
export function missingDemoNote(
  { scope, defaultCell }: ShowcasePage,
  url: string,
): string {
  if (!scope.framework || !defaultCell) return "";
  const missing = missingDemo(scope.framework, defaultCell);
  if (!missing) return "";
  if (missing.kind === "unsupported") {
    return `${notYet(missing.integrationName)} The ${missing.featureName} demo for ${missing.integrationName} can't run yet, so its code isn't shown here. See [the framework grid](/) for the frameworks where it runs.`;
  }
  const segments = url.split("/");
  const at = segments.indexOf(scope.framework);
  const links =
    at < 0
      ? ""
      : ` See this page for ${missing.others
          .slice(0, 3)
          .map((slug) => {
            const href = segments
              .flatMap((s, i) =>
                i !== at ? [s] : slug === ROOT_FRAMEWORK ? [] : [slug],
              )
              .join("/");
            return `[${getIntegration(slug)?.name ?? slug}](${href})`;
          })
          .join(", ")}.`;
  return `${notYet(missing.name)} The code on this page comes from the showcase's \`${defaultCell}\` demo, and ${missing.name} doesn't have it yet.${links}`;
}

const notYet = (name: string) => `> **Not available for ${name} yet.**`;

/** A resolved `<Snippet>`: its code, the notice the page shows, or a comment. */
function snippetMarkdown(source: SnippetSource, noCaption: boolean): string {
  switch (source.kind) {
    case "code":
      return fence(
        source.code,
        source.language,
        noCaption ? undefined : snippetFileName(source.file),
      );
    case "hidden":
      return "";
    case "no-framework":
      return "<!-- snippet skipped: no agent framework selected -->";
    case "unsupported":
      return `${notYet(source.integrationName)} The ${source.featureName} demo for ${source.integrationName} can't run yet, so its code isn't shown here.`;
    case "not-yet":
      return `${notYet(source.name)} This sample comes from the showcase's \`${source.cell}\` demo, and ${source.name} doesn't have it yet.`;
    case "no-source":
      return "<!-- snippet skipped: needs region or file -->";
    case "no-cell":
      return `<!-- snippet skipped: no cell for ${source.framework} -->`;
    case "no-demo":
      return `<!-- snippet skipped: no demo for ${source.key} -->`;
    case "no-region":
      return `<!-- snippet skipped: region '${source.region}' missing in ${source.key} -->`;
    case "no-file":
      return `<!-- snippet skipped: file '${source.file}' not bundled in ${source.key} -->`;
    case "bad-lines":
      return `<!-- snippet skipped: ${source.warning} -->`;
    case "no-code":
      return `<!-- snippet skipped: ${source.key} has no code -->`;
  }
}

/** A fenced block whose fence no run of backticks in `code` can close. */
function fence(code: string, language: string, title?: string): string {
  const longest = Math.max(
    2,
    ...(code.match(/`{3,}/g) ?? []).map((run) => run.length),
  );
  const marker = "`".repeat(longest + 1);
  const info = [language, title && `title="${title}"`].filter(Boolean);
  return `${marker}${info.join(" ")}\n${code.replace(/\n$/, "")}\n${marker}`;
}

// --- Tags in MDX text ---------------------------------------------------

type Attrs = Record<string, string | boolean>;

interface Tag {
  start: number;
  end: number;
  close: boolean;
  self: boolean;
  attrs: Attrs;
}

const text = (value: string | boolean | undefined) =>
  typeof value === "string" ? value : undefined;

/** `a="x" b='y' c={false} d`: strings, booleans, and bare names as `true`. */
function parseAttrs(source: string): Attrs {
  const attrs: Attrs = {};
  const re =
    /([\w-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|\{\s*(?:"([^"]*)"|'([^']*)'|(true|false))\s*\}))?/g;
  for (const m of source.matchAll(re)) {
    const value = m[2] ?? m[3] ?? m[4] ?? m[5];
    attrs[m[1]] = value ?? (m[6] ? m[6] === "true" : true);
  }
  return attrs;
}

/**
 * Fenced code blocks as `[start, end)` offsets. A fence may be indented (MDX
 * has no indented code, and serialized JSX children are indented).
 */
function fenceRanges(source: string): [number, number][] {
  const ranges: [number, number][] = [];
  let open: { marker: string; length: number; start: number } | null = null;
  let pos = 0;
  for (const line of source.split("\n")) {
    const lineEnd = pos + line.length;
    if (open) {
      const close = line.match(/^[ \t]*(`{3,}|~{3,})[ \t]*$/);
      if (
        close &&
        close[1][0] === open.marker &&
        close[1].length >= open.length
      ) {
        ranges.push([open.start, lineEnd]);
        open = null;
      }
    } else {
      const opening = line.match(/^[ \t]*(`{3,}|~{3,})/);
      if (opening) {
        open = {
          marker: opening[1][0],
          length: opening[1].length,
          start: pos,
        };
      }
    }
    pos = lineEnd + 1;
  }
  if (open) ranges.push([open.start, source.length]);
  return ranges;
}

const ATTRS = String.raw`(?:[^>"'{}]|"[^"]*"|'[^']*'|\{[^{}]*\})*?`;

/** `<Name ...>`, `</Name>` and `<Name ... />` outside code, in order. */
function findTags(source: string, name: string): Tag[] {
  if (!source.includes(`<${name}`) && !source.includes(`</${name}`)) return [];
  const fences = fenceRanges(source);
  const tags: Tag[] = [];
  const re = new RegExp(`<(/?)${name}\\b(${ATTRS})(/?)>`, "g");
  for (const m of source.matchAll(re)) {
    const start = m.index;
    if (fences.some(([from, to]) => start >= from && start < to)) continue;
    // An odd number of backticks before it on its line: an inline code span.
    const lineStart = source.lastIndexOf("\n", start - 1) + 1;
    if ((source.slice(lineStart, start).match(/`/g)?.length ?? 0) % 2) {
      continue;
    }
    tags.push({
      start,
      end: start + m[0].length,
      close: m[1] === "/",
      self: m[3] === "/",
      attrs: parseAttrs(m[2]),
    });
  }
  return tags;
}

/**
 * The lines `[start, end)` fills on its own, with their indentation; null
 * when it shares a line with other text.
 */
function ownLines(source: string, start: number, end: number) {
  const lineStart = source.lastIndexOf("\n", start - 1) + 1;
  const indent = source.slice(lineStart, start);
  let lineEnd = source.indexOf("\n", end);
  if (lineEnd < 0) lineEnd = source.length;
  if (indent.trim() || source.slice(end, lineEnd).trim()) return null;
  return {
    start: lineStart,
    end: Math.min(lineEnd + 1, source.length),
    indent,
  };
}

/** Each line of `block` at `indent`, blank lines left empty. */
function indentLines(block: string, indent: string): string {
  return block
    .split("\n")
    .map((line) => (line.trim() ? indent + line : ""))
    .join("\n");
}

/** A tag's children without the tags' lines and their common indentation. */
function unwrap(inner: string): string {
  const lines = inner
    .replace(/^[ \t]*\n/, "")
    .replace(/\n[ \t]*$/, "")
    .split("\n");
  const width = Math.min(
    ...lines
      .filter((line) => line.trim())
      .map((line) => line.length - line.trimStart().length),
  );
  if (!Number.isFinite(width)) return "";
  return lines.map((line) => (line.trim() ? line.slice(width) : "")).join("\n");
}

/** Replace each self-closing `<Name />` with `render(attrs)`, at its indentation. */
function replaceTags(
  source: string,
  name: string,
  render: (attrs: Attrs) => string,
): string {
  let out = "";
  let cursor = 0;
  for (const tag of findTags(source, name)) {
    if (!tag.self) continue;
    const markdown = render(tag.attrs).trim();
    const lines = ownLines(source, tag.start, tag.end);
    if (lines) {
      out += source.slice(cursor, lines.start);
      if (markdown) out += `${indentLines(markdown, lines.indent)}\n`;
      cursor = lines.end;
    } else {
      out += source.slice(cursor, tag.start) + markdown;
      cursor = tag.end;
    }
  }
  return out + source.slice(cursor);
}

/**
 * Keep the children of each `<Name>...</Name>` that `keep` accepts, without
 * the tags, and drop the rest. Nested blocks of the same name are resolved
 * inside the ones kept.
 */
function filterBlocks(
  source: string,
  name: string,
  keep: (attrs: Attrs) => boolean,
): string {
  let out = "";
  let cursor = 0;
  let depth = 0;
  let open: Tag | undefined;
  for (const tag of findTags(source, name)) {
    if (tag.self) {
      // `<Name />` has nothing to keep.
      if (depth > 0) continue;
      const lines = ownLines(source, tag.start, tag.end);
      out += source.slice(cursor, lines?.start ?? tag.start);
      cursor = lines?.end ?? tag.end;
      continue;
    }
    if (!tag.close) {
      if (depth++ === 0) open = tag;
      continue;
    }
    if (depth === 0 || --depth > 0 || !open) continue;
    const inner = source.slice(open.end, tag.start);
    const kept = keep(open.attrs);
    const lines = ownLines(source, open.start, tag.end);
    if (lines) {
      out += source.slice(cursor, lines.start);
      if (kept) {
        const children = filterBlocks(unwrap(inner), name, keep);
        if (children.trim()) out += `${indentLines(children, lines.indent)}\n`;
      }
      cursor = lines.end;
    } else {
      out += source.slice(cursor, open.start);
      if (kept) out += filterBlocks(inner, name, keep);
      cursor = tag.end;
    }
  }
  return out + source.slice(cursor);
}

/** Runs of blank lines outside code, left by dropped blocks, as one. */
function collapseBlankLines(source: string): string {
  const collapse = (part: string) =>
    part.replace(/\n(?:[ \t]*\n){2,}/g, "\n\n");
  let out = "";
  let cursor = 0;
  for (const [start, end] of fenceRanges(source)) {
    out += collapse(source.slice(cursor, start)) + source.slice(start, end);
    cursor = end;
  }
  return out + collapse(source.slice(cursor));
}
