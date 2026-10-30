import { Fragment } from "react";
import type { CSSProperties, ReactNode } from "react";
import { Link as KumoLink } from "@cloudflare/kumo";
import { VISUALLY_HIDDEN } from "./style";

// The inline markdown of the standard Text, Caption and Blockquote, from
// packages/react-core/src/v2/generative-ui/standard/markdown.tsx
// (renderInlineMarkdown), which the package does not export. Links render
// as Kumo links.

const SAFE_URL = /^(https?:|mailto:)/i;

/** The trimmed URL when it is http, https or mailto. Else `undefined`. */
export function safeHref(url: string) {
  const trimmed = url.trim();
  return SAFE_URL.test(trimmed) ? trimmed : undefined;
}

export { VISUALLY_HIDDEN } from "./style";

const CODE_STYLE: CSSProperties = {
  fontFamily: "var(--font-mono), ui-monospace, monospace",
  fontSize: "0.875em",
  padding: "0.1em 0.35em",
  borderRadius: "var(--radius-sm)",
  background: "var(--color-kumo-recessed)",
};

type Wrap = "strong" | "em" | "s" | "u" | "code";
const DELIMITERS: Array<{ open: string; tag: Wrap }> = [
  { open: "**", tag: "strong" },
  { open: "~~", tag: "s" },
  { open: "++", tag: "u" },
  { open: "`", tag: "code" },
  { open: "*", tag: "em" },
  { open: "_", tag: "em" },
];

/** The link that starts at `start` (`[label](url)`), or `null`. */
function matchLink(text: string, start: number) {
  if (text[start] !== "[") return null;
  const close = text.indexOf("](", start + 1);
  if (close < 0) return null;
  const end = text.indexOf(")", close + 2);
  if (end < 0) return null;
  // One level of balanced parentheses can be in the URL, e.g. "alert(1)".
  let urlEnd = end;
  const inner = text.slice(close + 2, end);
  if (inner.includes("(")) {
    const next = text.indexOf(")", end + 1);
    if (next < 0) return null;
    urlEnd = next;
  }
  return {
    label: text.slice(start + 1, close),
    url: text.slice(close + 2, urlEnd),
    next: urlEnd + 1,
  };
}

/**
 * Renders `**bold**`, `*italic*` and `_italic_`, `~~strike~~`,
 * `++underline++`, `` `code` `` and `[label](url)`. A marker without a
 * closing partner stays literal. Only http, https and mailto URLs become
 * links. Marks do not nest.
 */
export function renderInlineMarkdown(text: string): ReactNode {
  if (!text) return text;
  const out: ReactNode[] = [];
  let buffer = "";
  let key = 0;
  const flush = () => {
    if (buffer) out.push(buffer);
    buffer = "";
  };
  let index = 0;
  while (index < text.length) {
    const link = matchLink(text, index);
    if (link) {
      flush();
      const href = safeHref(link.url);
      out.push(
        href ? (
          <KumoLink
            key={key++}
            href={href}
            variant="inline"
            target="_blank"
            rel="noopener noreferrer"
          >
            {link.label}
            <span style={VISUALLY_HIDDEN}> (opens in a new tab)</span>
          </KumoLink>
        ) : (
          <Fragment key={key++}>{link.label}</Fragment>
        ),
      );
      index = link.next;
      continue;
    }
    const delimiter = DELIMITERS.find((d) => text.startsWith(d.open, index));
    // An underscore inside a word (snake_case) is not emphasis.
    const isIntraWordUnderscore =
      delimiter?.open === "_" && /\w/.test(text[index - 1] ?? "");
    if (delimiter && !isIntraWordUnderscore) {
      const start = index + delimiter.open.length;
      const end = text.indexOf(delimiter.open, start);
      const inner = end > start ? text.slice(start, end) : "";
      // Emphasis must touch its content ("a * b * c" stays literal).
      const isMark =
        inner !== "" && (delimiter.tag === "code" || inner.trim() === inner);
      if (isMark) {
        flush();
        const Tag = delimiter.tag;
        out.push(
          <Tag key={key++} style={Tag === "code" ? CODE_STYLE : undefined}>
            {inner}
          </Tag>,
        );
        index = end + delimiter.open.length;
        continue;
      }
      buffer += delimiter.open;
      index = start;
      continue;
    }
    buffer += text[index];
    index += 1;
  }
  flush();
  return out.length === 1 && typeof out[0] === "string" ? out[0] : out;
}
