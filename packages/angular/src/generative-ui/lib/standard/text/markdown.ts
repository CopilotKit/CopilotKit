import { Component, inject, input } from "@angular/core";
import { CopilotChatAssistantMessageRenderer } from "@copilotkit/angular";
import { GenerativeUIStyles } from "../../styles";
import { safeHref } from "../url";

type Wrap = "strong" | "em" | "s" | "u" | "code";

/**
 * One piece of inline markdown: plain text, a marked span (`**bold**`,
 * `*italic*`, `~~strike~~`, `++underline++`, `` `code` ``) or a safe link.
 * One shape for the three kinds, so a template reads it without narrowing.
 */
export interface InlineToken {
  kind: "text" | "mark" | "link";
  /** The text, or the label of a link. */
  text: string;
  /** The element of a mark. */
  tag?: Wrap;
  /** The URL of a link. Always safe (http, https or mailto). */
  href?: string;
}

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
export function tokenizeInlineMarkdown(text: string): InlineToken[] {
  const out: InlineToken[] = [];
  if (!text) return out;
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
 * The template of the inline tokens. The component that uses it has
 * `tokens()` and `visuallyHidden`. Written without
 * whitespace between the elements, so no space sneaks in between a word and
 * its mark.
 */
export const INLINE_MARKDOWN =
  `@for (token of tokens(); track $index) {` +
  `@if (token.kind === "text") {<ng-container>{{ token.text }}</ng-container>}` +
  `@else if (token.kind === "link") {<a [attr.href]="token.href" target="_blank" rel="noopener noreferrer">{{ token.text }}<span [style]="visuallyHidden"> (opens in a new tab)</span></a>}` +
  `@else if (token.tag === "strong") {<strong>{{ token.text }}</strong>}` +
  `@else if (token.tag === "em") {<em>{{ token.text }}</em>}` +
  `@else if (token.tag === "s") {<s>{{ token.text }}</s>}` +
  `@else if (token.tag === "u") {<u>{{ token.text }}</u>}` +
  `@else {<code>{{ token.text }}</code>}` +
  `}`;

/**
 * Full GitHub-flavored markdown, rendered with the chat's markdown
 * renderer. It has no typography of its own, so it reads like the chat text
 * around the surface. The renderer completes markdown that is still
 * streaming.
 */
@Component({
  selector: "div[copilotGenerativeUIMarkdown]",
  imports: [CopilotChatAssistantMessageRenderer],
  template: `
    <copilot-chat-assistant-message-renderer [content]="text()" />
  `,
  host: { class: "a2ui-markdown", "data-a2ui-std": "" },
})
export class CopilotGenerativeUIMarkdown {
  readonly text = input.required<string>();
  readonly streaming = input<boolean>();

  constructor() {
    inject(GenerativeUIStyles).ensureStandard();
  }
}
