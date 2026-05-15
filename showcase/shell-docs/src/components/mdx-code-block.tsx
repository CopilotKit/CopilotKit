// <MdxCodeBlock> — `pre` override for MDX-rendered fenced code blocks.
//
// rehype-highlight produces `<pre><code class="hljs language-X">...</code></pre>`
// from triple-fenced MDX blocks. By default that gives users a syntax-
// highlighted block but NO copy button and NO file-path caption — both of
// which the QA report flagged on the Quickstart pages.
//
// This component wraps the bare <pre> with the same figure chrome used by
// <Snippet> and <DemoSource>: a header strip with the file path (when a
// `title="..."` meta is supplied on the fence) and a CopyButton that
// copies the raw code text. We share the `<CopyButton>` rather than
// inventing a new one so the visual treatment matches everywhere.
//
// The `title` value is threaded in via `data-title` on the <pre>, which is
// set by the `rehypeCodeMeta` plugin (see lib/rehype-code-meta.ts). The
// plugin parses MDX fence metastrings like ```python title="main.py"`` and
// copies the title onto the parent <pre>'s properties so this React
// component can read it directly — rehype-highlight by itself drops the
// metastring on the floor.
//
// Why client-only: <CopyButton> uses navigator.clipboard, which only exists
// on the client. The <pre> itself is server-rendered (rehype runs at build
// time); we just need this thin shell to be a Client Component so React
// can attach the button's onClick handler.

"use client";

import React, { Children, isValidElement } from "react";
import { CopyButton } from "./copy-button";

interface MdxCodeBlockProps extends React.HTMLAttributes<HTMLPreElement> {
  "data-title"?: string;
  "data-language"?: string;
  children?: React.ReactNode;
}

/**
 * Walk a React tree and concatenate every text leaf into a single string.
 * Used to recover the raw source of a highlighted code block (where the
 * tokens are wrapped in spans we don't want in the clipboard payload).
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

  // Pull the raw code out of the <code> child for the clipboard payload.
  // rehype-highlight always emits a single <code> child, but we walk
  // defensively so an unhighlighted fallback (plain text child) still
  // copies correctly.
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

  // Strip uniform JSX-nesting indent (see `dedent` doc-comment above).
  // When `codeText !== rawCodeText`, a non-zero indent was leaking from
  // the fence's JSX container — in that case we also need to dedent the
  // visible <pre> body so the on-page render matches the copy payload.
  // Otherwise the user sees correctly-indented code in clipboard but
  // 24-sp-indented code on the page (or vice versa).
  const codeText = dedent(rawCodeText);
  const indentLeaked = codeText !== rawCodeText;

  // No title and no need for chrome? Fall through to the global
  // `.reference-content pre` styling — keeps backwards compatibility with
  // pages that don't expect a header strip while still surfacing the copy
  // affordance via a floating button positioned over the top-right corner.
  const hasCaption = Boolean(title);

  return (
    <figure className="mdx-code-block my-5 rounded-xl border border-[var(--border)] shadow-sm overflow-hidden bg-[var(--bg-surface)]">
      {hasCaption && (
        <figcaption className="flex items-center justify-between px-3 py-2 border-b border-[var(--border)] bg-[var(--bg-elevated)] text-[11px] font-mono text-[var(--text-muted)]">
          <span className="truncate">{title}</span>
          <div className="flex items-center gap-2 shrink-0">
            {language && (
              <span className="text-[var(--text-faint)]">{language}</span>
            )}
            <CopyButton text={codeText} />
          </div>
        </figcaption>
      )}
      <div className="relative">
        {!hasCaption && (
          <div className="absolute top-2 right-2 z-10">
            <CopyButton text={codeText} />
          </div>
        )}
        <pre
          {...rest}
          className={`mdx-code-block__pre text-[12.5px] leading-[1.55] overflow-x-auto p-4 m-0 ${className ?? ""}`}
        >
          {indentLeaked ? (
            // Fence body was uniformly indented (JSX-nested fence). Render
            // the dedented plain text so what the user sees matches what
            // they copy. We lose syntax highlighting on these blocks, but
            // the alternative is indented-and-invalid code on screen.
            <code className={`language-${language ?? "plaintext"}`}>
              {codeText}
            </code>
          ) : (
            children
          )}
        </pre>
      </div>
    </figure>
  );
}
