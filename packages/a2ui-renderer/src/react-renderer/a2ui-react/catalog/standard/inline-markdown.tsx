import React from "react";

/**
 * Minimal inline-markdown renderer for `Text.text` and friends.
 *
 * Supported: `**bold**`, `*italic*` / `_italic_`, `~~strike~~`, `++underline++`,
 * `` `code` `` and `[label](url)`. Markers without a closing partner render as
 * literal text. Links are emitted only for http:, https: and mailto: URLs;
 * any other scheme renders just the label. Emphasis is not nested.
 */

const SAFE_URL = /^(https?:|mailto:)/i;

type Wrap = "strong" | "em" | "s" | "u" | "code";

const DELIMITERS: Array<{ open: string; tag: Wrap }> = [
  { open: "**", tag: "strong" },
  { open: "~~", tag: "s" },
  { open: "++", tag: "u" },
  { open: "`", tag: "code" },
  { open: "*", tag: "em" },
  { open: "_", tag: "em" },
];

function matchLink(text: string, i: number) {
  if (text[i] !== "[") return null;
  const close = text.indexOf("](", i + 1);
  if (close < 0) return null;
  const end = text.indexOf(")", close + 2);
  if (end < 0) return null;
  // Allow one level of balanced parens inside the URL, e.g. "alert(1)".
  let urlEnd = end;
  const inner = text.slice(close + 2, end);
  if (inner.includes("(")) {
    const next = text.indexOf(")", end + 1);
    if (next < 0) return null;
    urlEnd = next;
  }
  return {
    label: text.slice(i + 1, close),
    url: text.slice(close + 2, urlEnd).trim(),
    next: urlEnd + 1,
  };
}

export function renderInlineMarkdown(text: string): React.ReactNode {
  if (!text) return text;
  const out: React.ReactNode[] = [];
  let buffer = "";
  let key = 0;
  const flush = () => {
    if (buffer) out.push(buffer);
    buffer = "";
  };

  let i = 0;
  while (i < text.length) {
    const link = matchLink(text, i);
    if (link) {
      flush();
      out.push(
        SAFE_URL.test(link.url) ? (
          <a
            key={key++}
            href={link.url}
            target="_blank"
            rel="noopener noreferrer"
          >
            {link.label}
          </a>
        ) : (
          <React.Fragment key={key++}>{link.label}</React.Fragment>
        ),
      );
      i = link.next;
      continue;
    }

    const delim = DELIMITERS.find((d) => text.startsWith(d.open, i));
    // Intra-word underscores (snake_case) are not emphasis.
    if (delim && !(delim.open === "_" && /\w/.test(text[i - 1] ?? ""))) {
      const start = i + delim.open.length;
      const end = text.indexOf(delim.open, start);
      const inner = end > start ? text.slice(start, end) : "";
      // Emphasis must hug its content ("a * b * c" stays literal).
      if (inner && (delim.tag === "code" || inner.trim() === inner)) {
        flush();
        const Tag = delim.tag;
        out.push(<Tag key={key++}>{inner}</Tag>);
        i = end + delim.open.length;
        continue;
      }
      buffer += delim.open;
      i = start;
      continue;
    }

    buffer += text[i];
    i += 1;
  }
  flush();
  return out.length === 1 && typeof out[0] === "string" ? out[0] : out;
}
