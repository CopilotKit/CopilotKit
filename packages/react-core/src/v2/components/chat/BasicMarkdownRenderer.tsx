"use client";

import React from "react";
import { parseMarkdown, type MarkdownToken } from "@copilotkit/core";
import type { MarkdownRendererProps } from "../../providers/MarkdownRendererContext";

// Allowlist URL schemes to prevent XSS via javascript:/data:/vbscript: URIs in
// markdown links. Mirrors the safe-prefix behavior the previous streamdown
// renderer enforced. Relative/anchor/mailto/tel links are allowed.
const SAFE_HREF = /^(https?:|mailto:|tel:|#|\/|\.\/|\.\.\/)/i;
const SAFE_IMG_SRC = /^(https?:|data:image\/|\/|\.\/|\.\.\/)/i;

function sanitizeHref(href: string | undefined): string | undefined {
  if (!href) return undefined;
  return SAFE_HREF.test(href.trim()) ? href : undefined;
}

function sanitizeImgSrc(src: string | undefined): string | undefined {
  if (!src) return undefined;
  return SAFE_IMG_SRC.test(src.trim()) ? src : undefined;
}

/**
 * Dependency-light built-in markdown renderer (basic GFM). Walks the
 * framework-agnostic token tree from `@copilotkit/core` into React elements.
 * No syntax highlighting, no math, no table/image action buttons — plug in a
 * custom renderer via `CopilotKitProvider markdownRenderer={...}` for those.
 */
export function BasicMarkdownRenderer({
  content,
  className,
}: MarkdownRendererProps) {
  const tokens = React.useMemo(() => parseMarkdown(content ?? ""), [content]);
  if (!tokens.length) return null;
  return (
    <div className={className}>
      {tokens.map((t, i) => (
        <BlockToken key={i} token={t} />
      ))}
    </div>
  );
}

function renderInline(tokens: MarkdownToken[] | undefined): React.ReactNode {
  if (!tokens) return null;
  return tokens.map((token, i) => {
    switch (token.type) {
      case "text":
        return "tokens" in token && token.tokens
          ? renderInline(token.tokens as MarkdownToken[])
          : (token as { text: string }).text;
      case "strong":
        return <strong key={i}>{renderInline((token as any).tokens)}</strong>;
      case "em":
        return <em key={i}>{renderInline((token as any).tokens)}</em>;
      case "del":
        return <del key={i}>{renderInline((token as any).tokens)}</del>;
      case "codespan":
        return (
          <code key={i} className="cpk:rounded cpk:bg-black/5 cpk:px-1 cpk:py-0.5">
            {(token as { text: string }).text}
          </code>
        );
      case "br":
        return <br key={i} />;
      case "link": {
        const l = token as { href: string; tokens?: MarkdownToken[]; text: string };
        return (
          <a key={i} href={sanitizeHref(l.href)} target="_blank" rel="noopener noreferrer">
            {l.tokens ? renderInline(l.tokens) : l.text}
          </a>
        );
      }
      case "image": {
        const img = token as { href: string; text: string };
        return (
          <img key={i} src={sanitizeImgSrc(img.href)} alt={img.text} className="cpk:max-w-full" />
        );
      }
      case "escape":
        return (token as { text: string }).text;
      default:
        return "text" in token
          ? (token as { text: string }).text
          : null;
    }
  });
}

function BlockToken({ token }: { token: MarkdownToken }): React.ReactElement | null {
  switch (token.type) {
    case "space":
      return null;
    case "heading": {
      const h = token as { depth: number; tokens?: MarkdownToken[] };
      const Tag = `h${Math.min(Math.max(h.depth, 1), 6)}` as keyof JSX.IntrinsicElements;
      return <Tag>{renderInline(h.tokens)}</Tag>;
    }
    case "paragraph":
      return <p>{renderInline((token as any).tokens ?? [])}</p>;
    case "blockquote":
      return (
        <blockquote>
          {(((token as any).tokens as MarkdownToken[] | undefined) ?? []).map((t, i) => (
            <BlockToken key={i} token={t} />
          ))}
        </blockquote>
      );
    case "code": {
      const c = token as { text: string; lang?: string };
      return (
        <pre className="cpk:overflow-x-auto cpk:rounded-lg cpk:bg-black/5 cpk:p-3">
          <code data-language={c.lang || undefined}>{c.text}</code>
        </pre>
      );
    }
    case "hr":
      return <hr />;
    case "list": {
      const list = token as {
        ordered: boolean;
        start?: number | "";
        items: Array<{ tokens: MarkdownToken[] }>;
      };
      const items = list.items.map((item, i) => (
        <li key={i}>
          {(item.tokens ?? []).map((t, j) => (
            <BlockToken key={j} token={t} />
          ))}
        </li>
      ));
      return list.ordered ? (
        <ol start={typeof list.start === "number" ? list.start : undefined}>
          {items}
        </ol>
      ) : (
        <ul>{items}</ul>
      );
    }
    case "table": {
      const tbl = token as {
        header: Array<{ tokens: MarkdownToken[] }>;
        rows: Array<Array<{ tokens: MarkdownToken[] }>>;
      };
      return (
        <div className="cpk:overflow-x-auto">
          <table>
            <thead>
              <tr>
                {tbl.header.map((cell, i) => (
                  <th key={i}>{renderInline(cell.tokens)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {tbl.rows.map((row, i) => (
                <tr key={i}>
                  {row.map((cell, j) => (
                    <td key={j}>{renderInline(cell.tokens)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    }
    case "text": {
      const t = token as { tokens?: MarkdownToken[]; text: string };
      return <p>{t.tokens ? renderInline(t.tokens) : t.text}</p>;
    }
    default:
      return "text" in token ? <span>{(token as any).text}</span> : null;
  }
}

BasicMarkdownRenderer.displayName = "BasicMarkdownRenderer";
