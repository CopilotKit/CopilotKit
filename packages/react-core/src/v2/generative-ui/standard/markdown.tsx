import React from "react";
import type { CSSProperties, ReactNode } from "react";
import { Streamdown } from "streamdown";
import { useKatexStyles } from "../../hooks/useKatexStyles";
import { useStandardStyles } from "./styles";

// ---- Links ----

const SAFE_URL = /^(https?:|mailto:)/i;

/** The trimmed URL when it is http, https or mailto. Else `undefined`. */
export function safeHref(url: string) {
  const trimmed = url.trim();
  return SAFE_URL.test(trimmed) ? trimmed : undefined;
}

/** Hides text on screen but keeps it for screen readers. */
const VISUALLY_HIDDEN: CSSProperties = {
  position: "absolute",
  width: 1,
  height: 1,
  padding: 0,
  margin: -1,
  overflow: "hidden",
  clipPath: "inset(50%)",
  whiteSpace: "nowrap",
  border: 0,
};

interface ExternalLinkProps {
  /** A safe URL. Get it from `safeHref`. */
  href: string;
  title?: string;
  style?: CSSProperties;
  children: ReactNode;
}

/**
 * A link that opens in a new tab. Screen readers also hear that it opens a
 * new tab.
 */
export function ExternalLink({
  href,
  title,
  style,
  children,
}: ExternalLinkProps) {
  return (
    <a
      href={href}
      title={title}
      target="_blank"
      rel="noopener noreferrer"
      style={style}
    >
      {children}
      <span style={VISUALLY_HIDDEN}> (opens in a new tab)</span>
    </a>
  );
}

// ---- Inline markdown ----

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
 * Renders a small set of inline markdown: `**bold**`, `*italic*` and
 * `_italic_`, `~~strike~~`, `++underline++`, `` `code` `` and
 * `[label](url)`.
 *
 * - A marker without a closing partner stays literal text.
 * - A link is a link only for http, https and mailto URLs. For other URLs,
 *   only the label shows.
 * - Marks do not nest.
 *
 * @param text - The source text.
 */
export function renderInlineMarkdown(text: string) {
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
          <ExternalLink key={key++} href={href}>
            {link.label}
          </ExternalLink>
        ) : (
          <React.Fragment key={key++}>{link.label}</React.Fragment>
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
        out.push(<Tag key={key++}>{inner}</Tag>);
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

// ---- Block markdown ----

type Block =
  | { kind: "heading"; level: number; text: string }
  | { kind: "paragraph"; text: string }
  | { kind: "list"; ordered: boolean; items: string[] }
  | { kind: "quote"; text: string }
  | { kind: "code"; text: string; language?: string }
  | { kind: "rule" };

const HEADING = /^(#{1,6})\s+(.*)$/;
const BULLET = /^\s*[-*+]\s+(.*)$/;
const NUMBERED = /^\s*\d+[.)]\s+(.*)$/;
const QUOTE = /^\s*>\s?(.*)$/;
const RULE = /^\s*([-*_])(\s*\1){2,}\s*$/;
const FENCE = /^\s*```\s*(\S*)\s*$/;
const HEADING_TAGS = ["h1", "h2", "h3", "h4", "h5", "h6"] as const;

const listItem = (line: string) => BULLET.exec(line) ?? NUMBERED.exec(line);

/**
 * Splits markdown into blocks: headings, paragraphs, bullet and numbered
 * lists, block quotes, fenced code and horizontal rules. The lines of a
 * paragraph join with a space. Other markdown is paragraph text.
 *
 * @param source - The markdown source.
 */
export function parseBlockMarkdown(source: string) {
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  const blocks: Block[] = [];
  const paragraph: string[] = [];
  const flushParagraph = () => {
    if (paragraph.length) {
      blocks.push({ kind: "paragraph", text: paragraph.join(" ") });
    }
    paragraph.length = 0;
  };
  let index = 0;
  while (index < lines.length) {
    const line = lines[index];
    const fence = FENCE.exec(line);
    if (fence) {
      flushParagraph();
      const code: string[] = [];
      index++;
      while (index < lines.length && !FENCE.test(lines[index])) {
        code.push(lines[index++]);
      }
      index++; // The closing fence, or the end of the input.
      blocks.push({
        kind: "code",
        text: code.join("\n"),
        ...(fence[1] ? { language: fence[1] } : {}),
      });
      continue;
    }
    if (line.trim() === "") {
      flushParagraph();
      index++;
      continue;
    }
    const heading = HEADING.exec(line);
    if (heading) {
      flushParagraph();
      blocks.push({
        kind: "heading",
        level: heading[1].length,
        text: heading[2],
      });
      index++;
      continue;
    }
    if (RULE.test(line)) {
      flushParagraph();
      blocks.push({ kind: "rule" });
      index++;
      continue;
    }
    if (listItem(line)) {
      flushParagraph();
      const ordered = NUMBERED.test(line);
      const items: string[] = [];
      while (index < lines.length) {
        const item = listItem(lines[index]);
        if (!item || NUMBERED.test(lines[index]) !== ordered) break;
        items.push(item[1]);
        index++;
      }
      blocks.push({ kind: "list", ordered, items });
      continue;
    }
    if (QUOTE.test(line)) {
      flushParagraph();
      const quoted: string[] = [];
      let quote = QUOTE.exec(lines[index] ?? "");
      while (quote) {
        quoted.push(quote[1]);
        index++;
        quote = QUOTE.exec(lines[index] ?? "");
      }
      blocks.push({ kind: "quote", text: quoted.join(" ") });
      continue;
    }
    paragraph.push(line.trim());
    index++;
  }
  flushParagraph();
  return blocks;
}

/**
 * Renders markdown without a dependency: the blocks of
 * `parseBlockMarkdown`, with `renderInlineMarkdown` for the text in them.
 *
 * @param source - The markdown source.
 */
export function renderBlockMarkdown(source: string) {
  const blocks = parseBlockMarkdown(source);
  return blocks.map((block, key) => {
    switch (block.kind) {
      case "heading": {
        const Tag = HEADING_TAGS[block.level - 1];
        return <Tag key={key}>{renderInlineMarkdown(block.text)}</Tag>;
      }
      case "paragraph":
        return <p key={key}>{renderInlineMarkdown(block.text)}</p>;
      case "list": {
        const Tag = block.ordered ? "ol" : "ul";
        return (
          <Tag key={key}>
            {block.items.map((item, itemKey) => (
              <li key={itemKey}>{renderInlineMarkdown(item)}</li>
            ))}
          </Tag>
        );
      }
      case "quote":
        return (
          <blockquote key={key}>{renderInlineMarkdown(block.text)}</blockquote>
        );
      case "code":
        return (
          <pre key={key}>
            <code data-language={block.language}>{block.text}</code>
          </pre>
        );
      case "rule":
        return <hr key={key} />;
    }
  });
}

// ---- Markdown component ----

interface MarkdownProps {
  text: string;
  streaming?: boolean;
}

/**
 * Full GitHub-flavored markdown, rendered with Streamdown like the chat
 * messages. It has no typography of its own, so it reads like the chat
 * text around the surface. While `streaming` is true, Streamdown closes
 * markdown that is not complete yet.
 */
export function Markdown({ text, streaming = false }: MarkdownProps) {
  useStandardStyles();
  useKatexStyles();
  return (
    <div className="a2ui-markdown" data-a2ui-std="">
      <Streamdown
        mode={streaming ? "streaming" : "static"}
        parseIncompleteMarkdown={streaming}
      >
        {text}
      </Streamdown>
    </div>
  );
}
