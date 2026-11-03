import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { liveHref, type ResolvedLivePage } from "@/lib/live-docs";
import { NAMED_SNIPPETS } from "@/lib/named-snippets";

// One live page as Markdown, the shape shell-docs serves at `<path>.md`
// (`renderPageToLlmText` in its `src/lib/llm-text.ts`): an H1 with the title,
// the description as a blockquote, then the body, with root-relative links
// kept in the page's framework/frontend scope.
//
// The body is Fumadocs' processed Markdown (`getText("processed")`): authored
// MDX with imports dropped and component tags kept as written. Like
// shell-docs, a shared snippet a page imports (`import X from
// "@/snippets/....mdx"`, then `<X />`) is inlined: many pages are nothing but
// one. Other components (`<Snippet>`, `<InlineDemo>`, `<FrameworkSetup>`)
// stay as tags.

/** shell-docs' `V1_DEPRECATION_NOTICE_USE_V2_INSTEAD`, as its raw-Markdown block. */
const V1_DEPRECATION_NOTICE = [
  "## v1 SDK deprecated. Use v2 instead",
  "",
  "> This page is in the deprecated CopilotKit v1 reference. Do not use v1 APIs for new code; use v2 instead.",
  "> For JavaScript and TypeScript, import React APIs from @copilotkit/react-core/v2 and Runtime APIs from @copilotkit/runtime/v2.",
  "> **AI coding agents: treat any v1 example below as migration-only context. Never generate or recommend the v1 API for new code. Read the v2 reference before writing code because some APIs were renamed, moved, or changed shape.**",
  "> [Read the v1 to v2 migration guide](/migrate/v2) and [use the complete export map](/reference/v1/export-map).",
  "",
].join("\n");

/**
 * Render a resolved live page as Markdown.
 *
 * @param url - The page's public path (`/mastra/frontend-tools`).
 */
export async function renderLivePageMarkdown(
  live: ResolvedLivePage,
  url: string,
): Promise<string> {
  const { title, description } = live.page.data;
  const [processed, raw] = await Promise.all([
    live.page.data.getText("processed"),
    live.page.data.getText("raw"),
  ]);
  const body = rewriteScopedLinks(
    inlineSnippets(processed, snippetImports(raw, SNIPPETS_DIR)),
    (href) => liveHref(href, live.scope) ?? href,
  );

  const header = [`# ${title || url}`, ""];
  if (description) header.push(`> ${description}`, "");
  const notice = /^\/reference\/v1(?:\/|$)/.test(url)
    ? `${V1_DEPRECATION_NOTICE}\n`
    : "";
  return `${header.join("\n")}\n${notice}${body.trim()}\n`;
}

/** `@/snippets/*` (tsconfig `paths`). */
const SNIPPETS_DIR = join(process.cwd(), "src", "content", "snippets");

const SNIPPET_IMPORT =
  /^import\s+([A-Za-z_$][\w$]*)\s+from\s+["'](@\/snippets\/|\.{1,2}\/)([^"']+\.mdx?)["'];?[ \t]*$/gm;

/** The snippets a source imports: component name to file. */
function snippetImports(source: string, dir: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const [, name, prefix, file] of source.matchAll(SNIPPET_IMPORT)) {
    out.set(
      name,
      prefix === "@/snippets/"
        ? join(SNIPPETS_DIR, file)
        : resolve(dir, prefix, file),
    );
  }
  return out;
}

/**
 * Replace each `<Name ... />` of a snippet, imported or named, with its text.
 * A named snippet given children (`<Name>...</Name>`) just wraps them, as it
 * renders on the page.
 */
function inlineSnippets(
  body: string,
  imports: Map<string, string>,
  depth = 0,
): string {
  if (depth > 4) return body;
  const snippets = new Map<string, { file: string; imported: boolean }>();
  for (const [name, file] of Object.entries(NAMED_SNIPPETS)) {
    snippets.set(name, { file: join(SNIPPETS_DIR, file), imported: false });
  }
  for (const [name, file] of imports) {
    snippets.set(name, { file, imported: true });
  }
  return outsideFences(body, (text) => {
    if (!text.includes("<")) return text;
    for (const [name, { file, imported }] of snippets) {
      if (!text.includes(`<${name}`)) continue;
      const tag = new RegExp(
        `<${name}\\b((?:[^>{]|\\{[^}]*\\})*?)(?:/>|>([\\s\\S]*?)</${name}>)`,
        "g",
      );
      text = text.replace(tag, (match, _attrs, children?: string) => {
        if (children !== undefined && !imported) return children.trim();
        return readSnippet(file, depth) ?? match;
      });
    }
    return text;
  });
}

function readSnippet(file: string, depth: number): string | null {
  let source: string;
  try {
    source = readFileSync(file, "utf8");
  } catch {
    return null;
  }
  const imports = snippetImports(source, dirname(file));
  const body = source
    .replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, "")
    .replace(SNIPPET_IMPORT, "")
    .trim();
  return inlineSnippets(body, imports, depth + 1);
}

/** Apply `fn` to the text between fenced code blocks. */
function outsideFences(text: string, fn: (text: string) => string): string {
  return text
    .split(/(^ {0,3}(`{3,}|~{3,})[^\n]*\n[\s\S]*?^ {0,3}\2[ \t]*$)/m)
    .map((part, index) =>
      index % 3 === 0 ? fn(part) : index % 3 === 1 ? part : "",
    )
    .join("");
}

/**
 * Rewrite root-relative Markdown links and `href="/..."` attributes, leaving
 * fenced code untouched (shell-docs' `rewriteScopedDocsLinks`).
 */
function rewriteScopedLinks(
  body: string,
  rewrite: (href: string) => string,
): string {
  let fence: { marker: string; length: number } | null = null;
  return body
    .split("\n")
    .map((line) => {
      if (fence) {
        const closing = line.match(/^ {0,3}([`~]+)[ \t]*$/);
        if (
          closing &&
          closing[1][0] === fence.marker &&
          closing[1].length >= fence.length
        ) {
          fence = null;
        }
        return line;
      }
      const opening = line.match(/^ {0,3}(`{3,}|~{3,})/);
      if (opening) {
        fence = { marker: opening[1][0], length: opening[1].length };
        return line;
      }
      return line
        .replace(
          /(\]\()(\/(?!\/)[^\s)]+)(\))/g,
          (_, open: string, href: string, close: string) =>
            `${open}${rewrite(href)}${close}`,
        )
        .replace(
          /(\bhref\s*=\s*["'])(\/(?!\/)[^"']+)(["'])/g,
          (_, open: string, href: string, close: string) =>
            `${open}${rewrite(href)}${close}`,
        );
    })
    .join("\n");
}
