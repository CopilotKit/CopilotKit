import type { Root, Code } from "mdast";
import type { Plugin } from "unified";
import { visit, SKIP } from "unist-util-visit";

/**
 * Remark plugin that rewrites every fenced code block (with a language) into
 * an `<MintCodeBlock>` MDX JSX element. The Astro page renders this as
 * Mintlify's `<CodeBlock>` (filename header, copy button, Ask AI button,
 * language label, syntax highlighting), giving every authored ``` ```tsx
 * title="page.tsx" ``` ``` block the full hosted-docs UI without authors
 * having to write any wrapper.
 *
 * Architecture trade-offs vs. the fallback Shiki pipeline:
 *
 * - `<CodeBlock>` (via `<BaseCodeBlock>`) re-runs Shiki client-side using its
 *   own bundled themes (`dark-plus` + `github-light-default`) and a curated
 *   subset of `@shikijs/transformers`. So we DON'T need Astro's server-side
 *   Shiki to also process these blocks — we leave them as plain text by
 *   excluding language matching here. Mintlify owns the entire rendering.
 * - Mintlify's bundled transformers cover `[!code highlight]`, `[!code focus]`,
 *   `[!code ++]`, `[!code --]`, AND meta-style `{1,3-5}` highlighting. They do
 *   NOT cover `[!code word:foo]` or `[!code error]`/`[!code warning]`. For
 *   word-highlights we strip the `// [!code word:...]` comment so it doesn't
 *   render as visible source — the highlight is dropped silently.
 *
 * Meta string parsing supports the same surface as Shiki/Mintlify:
 *
 * - `title="filename.tsx"` (or single-quoted) → `filename` prop.
 * - `lines`, `wrap`, `expandable` boolean flags → matching props.
 * - `icon="..."` → `icon` prop.
 * - `{1,3-5}` → `highlight="[1,3,4,5]"` (JSON-stringified line numbers).
 */
export const remarkMintlifyCodeBlock: Plugin<[], Root> = () => {
  return (tree) => {
    visit(tree, "code", (node: Code, index, parent) => {
      // Skip if there's no language hint — fenced blocks without a language
      // (`` ``` `` alone) get rendered as a plain `<pre>` by Astro's default
      // pipeline. Wrapping them in `<CodeBlock>` would give them an empty
      // language label and try to highlight nothing; cheaper to leave them.
      if (!node.lang) return;
      if (parent == null || index == null) return;

      const language = node.lang;
      const meta = node.meta ?? "";
      const value = stripUnsupportedNotations(node.value ?? "");

      const { filename, icon, lines, wrap, expandable, highlight, focus } =
        parseMeta(meta);

      const attributes: MdxJsxAttribute[] = [
        attr("language", language),
        attr("code", value),
      ];
      if (filename) attributes.push(attr("filename", filename));
      if (icon) attributes.push(attr("icon", icon));
      if (lines) attributes.push(boolAttr("lines"));
      if (wrap) attributes.push(boolAttr("wrap"));
      if (expandable) attributes.push(boolAttr("expandable"));
      if (highlight) attributes.push(attr("highlight", highlight));
      if (focus) attributes.push(attr("focus", focus));

      // Replace the `code` node in-place with an `mdxJsxFlowElement` —
      // a self-closing `<MintCodeBlock />` with the source text passed as a
      // string `code` prop. The wrapper component (registered in
      // `[...slug].astro`) forwards `code` to `<CodeBlock>` as children, which
      // is what `getNodeText` expects.
      const replacement = {
        type: "mdxJsxFlowElement",
        name: "MintCodeBlock",
        attributes,
        children: [],
      } as unknown as Code;

      parent.children.splice(index, 1, replacement);
      // We replaced the node — don't recurse into its (now-empty) children.
      return [SKIP, index + 1];
    });
  };
};

export default remarkMintlifyCodeBlock;

// --- helpers ---------------------------------------------------------------

interface MdxJsxAttribute {
  type: "mdxJsxAttribute";
  name: string;
  value: string | null;
}

function attr(name: string, value: string): MdxJsxAttribute {
  return { type: "mdxJsxAttribute", name, value };
}

/** Boolean MDX attribute: `<Foo bar />`. Represented as a `null` value. */
function boolAttr(name: string): MdxJsxAttribute {
  return { type: "mdxJsxAttribute", name, value: null };
}

interface ParsedMeta {
  filename?: string;
  icon?: string;
  lines: boolean;
  wrap: boolean;
  expandable: boolean;
  highlight?: string;
  focus?: string;
}

/**
 * Parse the meta-string after the language token in a fenced code block.
 *
 * Examples of input:
 *   `title="page.tsx"`
 *   `title='page.tsx' lines`
 *   `title="page.tsx" {1,3-5}`
 */
export function parseMeta(meta: string): ParsedMeta {
  const result: ParsedMeta = {
    lines: false,
    wrap: false,
    expandable: false,
  };
  if (!meta) return result;

  // Quoted key="value" pairs (double or single quotes).
  const kvRegex = /(\w+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  let match: RegExpExecArray | null;
  while ((match = kvRegex.exec(meta)) !== null) {
    const key = match[1].toLowerCase();
    const value = match[2] ?? match[3] ?? "";
    if (key === "title" || key === "filename") result.filename = value;
    else if (key === "icon") result.icon = value;
  }

  // Boolean flags. Strip k=v pairs first so we don't treat `title` as a flag.
  const stripped = meta.replace(kvRegex, " ");
  const tokens = stripped.split(/\s+/).filter(Boolean);
  for (const token of tokens) {
    const lower = token.toLowerCase();
    if (lower === "lines") result.lines = true;
    else if (lower === "wrap") result.wrap = true;
    else if (lower === "expandable") result.expandable = true;
  }

  // `{1,3-5}` highlight ranges.
  const highlightMatch = meta.match(/\{([\d,\-\s]+)\}/);
  if (highlightMatch) {
    const lineNumbers = expandRange(highlightMatch[1]);
    if (lineNumbers.length > 0) {
      result.highlight = JSON.stringify(lineNumbers);
    }
  }

  // `focus={1,3-5}` ranges (not common but mirror Mintlify's prop).
  const focusMatch = meta.match(/focus\s*=\s*\{([\d,\-\s]+)\}/);
  if (focusMatch) {
    const lineNumbers = expandRange(focusMatch[1]);
    if (lineNumbers.length > 0) {
      result.focus = JSON.stringify(lineNumbers);
    }
  }

  return result;
}

/** Expand `1,3-5` into `[1, 3, 4, 5]`. */
function expandRange(input: string): number[] {
  const out: number[] = [];
  for (const part of input.split(",")) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const range = trimmed.split("-").map((n) => Number.parseInt(n, 10));
    if (range.length === 1 && Number.isFinite(range[0])) {
      out.push(range[0]);
    } else if (
      range.length === 2 &&
      Number.isFinite(range[0]) &&
      Number.isFinite(range[1]) &&
      range[1] >= range[0]
    ) {
      for (let n = range[0]; n <= range[1]; n++) out.push(n);
    }
  }
  return out;
}

/**
 * Strip notation transformers that Mintlify's bundled Shiki pipeline doesn't
 * support, so they don't render as visible source comments. Currently only
 * `[!code word:foo]` falls into this bucket — `[!code highlight]`,
 * `[!code focus]`, `[!code ++]`, and `[!code --]` are all handled.
 *
 * The pattern matches the comment line wholesale (e.g. `// [!code word:foo]`)
 * including any trailing whitespace, so the source line collapses cleanly
 * instead of leaving a dangling empty comment.
 */
export function stripUnsupportedNotations(source: string): string {
  // Match `// [!code word:...]` or `# [!code word:...]` etc. — any comment
  // syntax preceded by optional whitespace, on its own line.
  // Also handles `// [!code word:foo]` mid-line: collapse the comment marker
  // and notation while keeping the code that precedes it.
  const standalone =
    /^\s*(?:\/\/|#|<!--|\/\*)\s*\[!code word:[^\]]+\][^\n]*\n?/gm;
  const inline =
    /\s*(?:\/\/|#|<!--|\/\*)\s*\[!code word:[^\]]+\](?:\s*-->|\s*\*\/)?/g;
  return source.replace(standalone, "").replace(inline, "");
}
