import type {
  RichTextAnnotations,
  RichTextItem,
  RichTextTextItem,
} from "../types.js";
import { NOTION_LIMITS } from "./budget.js";

/** Annotations the Markdown converter writes. */
const ANNOTATION_KEYS = ["bold", "italic", "strikethrough", "code"] as const;

type AnnotationKey = (typeof ANNOTATION_KEYS)[number];

/** Styling of one run of text: annotation flags plus an optional link. */
interface Style extends Pick<RichTextAnnotations, AnnotationKey> {
  link?: string;
}

/** One run of text with a single style, before it is cut into rich text items. */
interface Segment {
  content: string;
  style: Style;
}

/** One inline Markdown construct, matched at a fixed position (sticky regex). */
interface InlineRule {
  re: RegExp;
  /** The opening marker must not follow a word character (keeps `snake_case` literal). */
  needsWordBoundary?: boolean;
  /** Gets the capture groups (`[inner]`, or `[label, url]` for links). */
  render: (captures: string[], style: Style) => Segment[];
}

const INLINE_RULES: InlineRule[] = [
  {
    re: /`([^`\n]+)`/y,
    render: ([inner = ""], style) => [
      { content: inner, style: { ...style, code: true } },
    ],
  },
  {
    re: /\[([^\]\n]+)\]\(([^)\s]+)(?:\s+"[^"\n]*")?\)/y,
    render: ([label = "", url = ""], style) => {
      if (isLinkableUrl(url))
        return parseInline(label, { ...style, link: url });
      // Notion rejects relative or malformed link URLs: keep both as text.
      return [...parseInline(label, style), { content: ` (${url})`, style }];
    },
  },
  {
    re: /\*\*(?!\s)([^\n]+?)\*\*/y,
    render: ([inner = ""], style) =>
      parseInline(inner, { ...style, bold: true }),
  },
  {
    re: /__(?!\s)([^\n]+?)__(?!\w)/y,
    needsWordBoundary: true,
    render: ([inner = ""], style) =>
      parseInline(inner, { ...style, bold: true }),
  },
  {
    re: /~~(?!\s)([^\n]+?)~~/y,
    render: ([inner = ""], style) =>
      parseInline(inner, { ...style, strikethrough: true }),
  },
  {
    re: /\*(?![\s*])([^*\n]+?)\*/y,
    render: ([inner = ""], style) =>
      parseInline(inner, { ...style, italic: true }),
  },
  {
    re: /_(?![\s_])([^_\n]+?)_(?!\w)/y,
    needsWordBoundary: true,
    render: ([inner = ""], style) =>
      parseInline(inner, { ...style, italic: true }),
  },
];

const INLINE_MARKERS = new Set(["`", "[", "*", "_", "~"]);
const HEADING = /^\s{0,3}#{1,6}\s+(.*?)\s*#*\s*$/;
const FENCE = /^\s{0,3}```/;
const WORD_CHAR = /\w/;

/**
 * Convert Markdown to a Notion `rich_text` array.
 *
 * Inline Markdown maps to annotations: `**bold**`/`__bold__`, `*italic*`/
 * `_italic_`, `~~strike~~`, `` `code` ``, and `[label](https://url)` links.
 * Newlines are kept. Notion comments have no block formatting, so block
 * Markdown degrades to plain lines: a heading becomes a bold line, list
 * markers stay as text, and a fenced code block becomes code-annotated text.
 *
 * Text longer than 2000 characters is split over several items. The result
 * has at most 100 items. When the formatting needs more, the text is sent
 * without formatting, so no text is lost. Only text past 100 items of 2000
 * characters is cut, and then the last item is "…".
 *
 * @param md - Markdown source text.
 * @example
 * markdownToRichText("Deploy **done**");
 * // [{ type: "text", text: { content: "Deploy " } },
 * //  { type: "text", text: { content: "done" }, annotations: { bold: true } }]
 */
export function markdownToRichText(md: string) {
  return segmentsToRichText(markdownToSegments(md));
}

/**
 * Convert literal text to a Notion `rich_text` array with no Markdown parsing.
 * Splits at 2000 characters per item and caps the result at 100 items.
 *
 * @param text - Text to send as-is.
 */
export function plainTextToRichText(text: string) {
  return segmentsToRichText(text ? [{ content: text, style: {} }] : []);
}

/**
 * Keep at most `max` rich text items. When items are dropped, the last kept
 * slot holds a "…" marker so the reader can see the text was cut.
 *
 * @param items - Rich text items to clamp.
 * @param max - Largest number of items to return.
 */
export function clampRichText(items: RichTextItem[], max: number) {
  if (items.length <= max) return items;
  if (max <= 0) return [];
  const marker: RichTextTextItem = { type: "text", text: { content: "…" } };
  return [...items.slice(0, max - 1), marker];
}

/**
 * Flatten a Notion `rich_text` array to plain text. Uses `plain_text` when
 * Notion sent it (responses always do), else the item's own text.
 *
 * @param items - Rich text items, for example a comment's `rich_text`.
 */
export function richTextToPlainText(items: readonly RichTextItem[]) {
  return items.map(plainTextOf).join("");
}

function plainTextOf(item: RichTextItem) {
  if (typeof item.plain_text === "string") return item.plain_text;
  switch (item.type) {
    case "text":
      return item.text.content;
    case "equation":
      return item.equation.expression;
    case "mention":
      return "";
  }
}

function markdownToSegments(md: string) {
  const segments: Segment[] = [];
  const lines = md.split("\n");
  const newline: Segment = { content: "\n", style: {} };
  let fence: string[] | null = null;
  for (const [i, line] of lines.entries()) {
    const isLast = i === lines.length - 1;
    if (FENCE.test(line)) {
      if (fence === null) {
        fence = [];
        continue;
      }
      if (fence.length > 0) {
        segments.push({ content: fence.join("\n"), style: { code: true } });
      }
      fence = null;
      if (!isLast) segments.push(newline);
      continue;
    }
    if (fence !== null) {
      fence.push(line);
      continue;
    }
    const heading = HEADING.exec(line);
    const inline = heading
      ? parseInline(heading[1] ?? "", { bold: true })
      : parseInline(line, {});
    segments.push(...inline);
    if (!isLast) segments.push(newline);
  }
  // An unclosed fence runs to the end of the text.
  if (fence !== null && fence.length > 0) {
    segments.push({ content: fence.join("\n"), style: { code: true } });
  }
  return segments;
}

function parseInline(src: string, style: Style) {
  const out: Segment[] = [];
  let plain = "";
  let i = 0;
  while (i < src.length) {
    const char = src.charAt(i);
    const match = INLINE_MARKERS.has(char) ? matchInline(src, i) : null;
    if (match === null) {
      plain += char;
      i += 1;
      continue;
    }
    if (plain) out.push({ content: plain, style });
    plain = "";
    out.push(...match.rule.render(match.exec.slice(1), style));
    i = match.end;
  }
  if (plain) out.push({ content: plain, style });
  return out;
}

function matchInline(src: string, at: number) {
  const followsWord = at > 0 && WORD_CHAR.test(src.charAt(at - 1));
  for (const rule of INLINE_RULES) {
    if (rule.needsWordBoundary && followsWord) continue;
    rule.re.lastIndex = at;
    const exec = rule.re.exec(src);
    if (exec !== null) return { rule, exec, end: at + exec[0].length };
  }
  return null;
}

function isLinkableUrl(url: string) {
  const isHttp = /^https?:\/\/\S+$/i.test(url);
  return isHttp && url.length <= NOTION_LIMITS.richTextContent;
}

function segmentsToRichText(segments: Segment[]) {
  const merged = mergeSegments(segments);
  const items = merged.flatMap((segment) =>
    splitContent(segment.content).map((content) =>
      toTextItem(content, segment.style),
    ),
  );
  if (items.length <= NOTION_LIMITS.richTextItems) return items;
  // Too much formatting for one comment: keep every character, drop the styling.
  const text = merged.map((segment) => segment.content).join("");
  const plain = splitContent(text).map((content) => toTextItem(content, {}));
  return clampRichText(plain, NOTION_LIMITS.richTextItems);
}

function mergeSegments(segments: Segment[]) {
  const out: Segment[] = [];
  for (const segment of segments) {
    if (!segment.content) continue;
    const last = out.at(-1);
    if (last && sameStyle(last.style, segment.style)) {
      last.content += segment.content;
    } else {
      out.push({ content: segment.content, style: segment.style });
    }
  }
  return out;
}

function sameStyle(a: Style, b: Style) {
  const sameFlags = ANNOTATION_KEYS.every((key) => !a[key] === !b[key]);
  return sameFlags && a.link === b.link;
}

/** Cut text into Notion-sized pieces without splitting a surrogate pair. */
function splitContent(text: string) {
  const size = NOTION_LIMITS.richTextContent;
  const out: string[] = [];
  let start = 0;
  while (start < text.length) {
    let end = Math.min(start + size, text.length);
    const splitsPair =
      end < text.length && isHighSurrogate(text.charCodeAt(end - 1));
    if (splitsPair) end -= 1;
    out.push(text.slice(start, end));
    start = end;
  }
  return out;
}

function isHighSurrogate(code: number) {
  return code >= 0xd800 && code <= 0xdbff;
}

function toTextItem(content: string, style: Style) {
  const annotations: RichTextAnnotations = {};
  for (const key of ANNOTATION_KEYS) {
    if (style[key]) annotations[key] = true;
  }
  const hasAnnotations = Object.keys(annotations).length > 0;
  const item: RichTextTextItem = {
    type: "text",
    text: style.link ? { content, link: { url: style.link } } : { content },
    ...(hasAnnotations ? { annotations } : {}),
  };
  return item;
}
