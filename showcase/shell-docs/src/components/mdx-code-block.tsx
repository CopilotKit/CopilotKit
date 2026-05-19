// <MdxCodeBlock> — `pre` override for MDX-rendered fenced code blocks.
//
// Wraps the rehype-code (Shiki) output with Fumadocs's `<CodeBlock>` +
// `<Pre>` chrome so every fenced block gets the floating Copy button and
// — when a `title="..."` meta is supplied on the fence — the file-path
// figcaption. The `data-title` / `data-language` data-attrs come from
// our `transformerMeta` Shiki transformer (see `lib/rehype-code-meta.ts`)
// which copies the title / lang onto the `<pre>` element rehype-code
// emits.
//
// Why Pre matters: rehype-code (Shiki) wraps each source line in
// `<span class="line">` and tokens in colored child spans. Fumadocs's
// `<Pre>` adds `*:flex *:flex-col` to the `<pre>` element so the line
// spans stack as rows. Plain `<pre>` would render the inline tokens
// fine but skip the per-line layout Fumadocs uses for line numbers,
// diff/highlight gutters, etc.

"use client";

import React, { Children, isValidElement } from "react";
import { CodeBlock, Pre } from "fumadocs-ui/components/codeblock";

interface MdxCodeBlockProps extends React.HTMLAttributes<HTMLPreElement> {
  "data-title"?: string;
  "data-language"?: string;
  children?: React.ReactNode;
}

/**
 * Walk a React tree and concatenate every text leaf into a single string.
 * Used to recover the raw source of a highlighted code block when we
 * need to dedent a JSX-nested fence whose body inherited the surrounding
 * indent.
 */
function extractText(node: React.ReactNode): string {
  if (node === null || node === undefined || node === false) return "";
  if (typeof node === "string") return node;
  if (typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(extractText).join("");
  if (isValidElement(node)) {
    const children = (node.props as { children?: React.ReactNode }).children;
    return extractText(children);
  }
  return "";
}

/**
 * Strip uniform leading whitespace from a multi-line code body.
 *
 * Why: when a triple-fenced block sits inside JSX (e.g. ```python inside
 * `<Tab>`/`<Step>`), MDX preserves the JSX nesting's leading indent on
 * every body line. extractText() recovers that text faithfully, so the
 * clipboard payload comes out with 16-24 leading spaces per line and
 * pasted code is invalid. This helper measures the minimum indent
 * across non-blank lines and strips it from every line — turning a
 * uniformly-indented block back into column-0 code.
 *
 * Tabs are counted as 1 unit (we don't expand to N spaces); the goal
 * is to fix uniform-indent leakage, not normalize mixed indentation.
 * Blank lines are left as-is rather than over-trimmed.
 */
function dedent(text: string): string {
  const lines = text.split("\n");
  const nonBlank = lines.filter((l) => l.trim().length > 0);
  if (nonBlank.length === 0) return text;
  const minIndent = Math.min(
    ...nonBlank.map((l) => l.match(/^[\s]*/)![0].length),
  );
  if (minIndent === 0) return text;
  return lines
    .map((l) => (l.length >= minIndent ? l.slice(minIndent) : l))
    .join("\n");
}

export function MdxCodeBlock(props: MdxCodeBlockProps) {
  const {
    "data-title": title,
    "data-language": language,
    children,
    className,
    ...rest
  } = props;

  const rawCodeText = (() => {
    const kids = Children.toArray(children);
    const codeEl = kids.find(
      (k) => isValidElement(k) && (k.type === "code" || k.type === "CODE"),
    );
    if (codeEl && isValidElement(codeEl)) {
      return extractText(
        (codeEl.props as { children?: React.ReactNode }).children,
      );
    }
    return extractText(children);
  })();

  const codeText = dedent(rawCodeText);
  const indentLeaked = codeText !== rawCodeText;

  return (
    <CodeBlock title={title}>
      <Pre {...rest} className={className}>
        {indentLeaked ? (
          // Fence body was uniformly indented (JSX-nested fence). Render
          // the dedented plain text so what's on screen matches what
          // gets copied. We lose token highlighting on these blocks, but
          // the alternative is indented-and-invalid code in the viewer.
          <code className={`language-${language ?? "plaintext"}`}>
            {codeText}
          </code>
        ) : (
          children
        )}
      </Pre>
    </CodeBlock>
  );
}
