import { h } from "vue";
import type { FunctionalComponent } from "vue";
import { VISUALLY_HIDDEN, safeHref } from "@copilotkit/shared/generative-ui";

// ---- Links ----

interface ExternalLinkProps {
  /** A safe URL. Get it from `safeHref`. */
  href: string;
  title?: string;
}

/**
 * A link that opens in a new tab. Screen readers also hear that it opens a
 * new tab. Its default slot is the link text. A `style` or `class` goes on
 * the anchor.
 *
 * @example
 * ```vue
 * <ExternalLink :href="safeHref(url)">docs</ExternalLink>
 * ```
 */
export const ExternalLink: FunctionalComponent<ExternalLinkProps> = (
  props,
  { slots },
) =>
  h(
    "a",
    {
      href: props.href,
      title: props.title,
      target: "_blank",
      rel: "noopener noreferrer",
    },
    [
      slots.default?.(),
      h("span", { style: VISUALLY_HIDDEN }, " (opens in a new tab)"),
    ],
  );
ExternalLink.props = {
  href: { type: String, required: true },
  title: { type: String, default: undefined },
};

// ---- Inline markdown ----

type Wrap = "strong" | "em" | "s" | "u" | "code";

/** One piece of inline markdown: plain text, a marked span or a safe link. */
type InlineToken =
  | { kind: "text"; text: string }
  | { kind: "mark"; tag: Wrap; text: string }
  | {
      kind: "link";
      text: string;
      /** Always safe: http, https or mailto. */
      href: string;
    };

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
 * Splits a small set of inline markdown into tokens: `**bold**`, `*italic*`
 * and `_italic_`, `~~strike~~`, `++underline++`, `` `code` `` and
 * `[label](url)`.
 *
 * - A marker without a closing partner stays literal text.
 * - A link is a link only for http, https and mailto URLs. For other URLs,
 *   only the label shows.
 * - Marks do not nest.
 *
 * @param text - The source text.
 */
function tokenizeInlineMarkdown(text: string) {
  const out: InlineToken[] = [];
  let buffer = "";
  const flush = () => {
    if (buffer) out.push({ kind: "text", text: buffer });
    buffer = "";
  };

  let index = 0;
  while (index < text.length) {
    const link = matchLink(text, index);
    if (link) {
      flush();
      const href = safeHref(link.url);
      out.push(
        href
          ? { kind: "link", text: link.label, href }
          : { kind: "text", text: link.label },
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
        out.push({ kind: "mark", tag: delimiter.tag, text: inner });
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
  return out;
}

/**
 * Renders a small set of inline markdown as Vue children: `**bold**`,
 * `*italic*` and `_italic_`, `~~strike~~`, `++underline++`, `` `code` `` and
 * `[label](url)`. Plain text stays a string, so Vue escapes it once.
 *
 * - A marker without a closing partner stays literal text.
 * - A link is a link only for http, https and mailto URLs. For other URLs,
 *   only the label shows.
 * - Marks do not nest.
 *
 * @param text - The source text.
 *
 * @example
 * ```ts
 * h("span", renderInlineMarkdown("Was ~~$39~~ now **$29**"));
 * ```
 */
export function renderInlineMarkdown(text: string) {
  const tokens = tokenizeInlineMarkdown(text);
  return tokens.map((token) => {
    switch (token.kind) {
      case "text":
        return token.text;
      case "mark":
        return h(token.tag, token.text);
      case "link":
        return h(ExternalLink, { href: token.href }, () => token.text);
    }
  });
}

/**
 * The inline markdown of `text`, with no element of its own. Text, Caption
 * and Blockquote render their text with it.
 *
 * @example
 * ```vue
 * <span><InlineMarkdown :text="caption" /></span>
 * ```
 */
export const InlineMarkdown: FunctionalComponent<{ text: string }> = (props) =>
  renderInlineMarkdown(props.text);
InlineMarkdown.props = { text: { type: String, required: true } };
