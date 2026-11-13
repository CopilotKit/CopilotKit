import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import {
  expandFrameworkSetups,
  expandShowcase,
  missingDemoNote,
  type ShowcasePage,
} from "./showcase-markdown";
import { liveHref, type ResolvedLivePage } from "@/lib/live-docs";
import { NAMED_SNIPPETS } from "@/lib/named-snippets";
import { isV1Reference, V1_DEPRECATION_MARKDOWN } from "@/lib/v1-deprecation";

// One live page as Markdown, the shape shell-docs serves at `<path>.md`
// (`renderPageToLlmText` in its `src/lib/llm-text.ts`): an H1 with the title,
// the description as a blockquote, then the body, with root-relative links
// kept in the page's framework/frontend scope.
//
// The body is Fumadocs' processed Markdown (`getText("processed")`): authored
// MDX with imports dropped and component tags kept as written. Like
// shell-docs, a shared snippet a page imports (`import X from
// "@/snippets/....mdx"`, then `<X />`) is inlined: many pages are nothing but
// one. The showcase components (`<Snippet>`, `<FrameworkSetup>`, the
// framework and frontend gates) resolve as the page renders them, in
// `showcase-markdown.ts`; other components stay as tags.

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
  const { snippet_framework, snippet_cell } = live.page.data;
  const showcase: ShowcasePage = {
    scope: live.scope,
    defaultFramework:
      typeof snippet_framework === "string" ? snippet_framework : undefined,
    defaultCell: typeof snippet_cell === "string" ? snippet_cell : undefined,
  };
  const imports = snippetImports(raw, SNIPPETS_DIR);
  // A framework's setup MDX can use shared snippets of its own.
  const mdx = inlineSnippets(
    expandFrameworkSetups(inlineSnippets(processed, imports), showcase),
    imports,
  );
  const body = [
    missingDemoNote(showcase, url),
    rewriteScopedLinks(
      expandShowcase(mdx, showcase),
      (href) => liveHref(href, live.scope) ?? href,
    ).trim(),
  ]
    .filter(Boolean)
    .join("\n\n");

  const header = [`# ${title || url}`, ""];
  if (description) header.push(`> ${description}`, "");
  const notice = isV1Reference(url) ? `${V1_DEPRECATION_MARKDOWN}\n` : "";
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
    .split(/(^[ \t]*(`{3,}|~{3,})[^\n]*\n[\s\S]*?^[ \t]*\2[ \t]*$)/m)
    .map((part, index) =>
      index % 3 === 0 ? fn(part) : index % 3 === 1 ? part : "",
    )
    .join("");
}

/**
 * Rewrite root-relative Markdown links and `href="/..."` attributes, leaving
 * fenced code untouched (shell-docs' `rewriteScopedDocsLinks`). Fences may be
 * indented: MDX has no indented code, and JSX children serialize indented.
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
        const closing = line.match(/^[ \t]*([`~]+)[ \t]*$/);
        if (
          closing &&
          closing[1][0] === fence.marker &&
          closing[1].length >= fence.length
        ) {
          fence = null;
        }
        return line;
      }
      const opening = line.match(/^[ \t]*(`{3,}|~{3,})/);
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
