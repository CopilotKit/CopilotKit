/*
 * Lightweight markdown preview for the chat composer: list markers and links.
 * The composer stays a native <textarea> (caret, selection, IME and undo all
 * keep working); its text is transparent and this layer, drawn underneath with
 * identical metrics, shows the same characters with styling. Every character
 * is kept, so the layers stay aligned — styling may change color or underline,
 * but never glyph widths.
 *
 * Returns an HTML string: every character of the text is escaped and the only
 * markup added is `<span class="cpk-md-*">`, so it is safe for `[innerHTML]`.
 */

/**
 * Composer typography, shared by the textarea and its preview layer so both
 * lay out the text identically.
 */
export const TEXTAREA_TYPOGRAPHY =
  "cpk:antialiased cpk:font-regular cpk:leading-relaxed cpk:text-[16px]";

const FENCE = /^\s*(```|~~~)/;
const LIST_MARKER = /^(\s*)([-*+]|\d{1,9}[.)])(\s+)/;
// A [text](url) link, or a bare URL.
const LINK =
  /\[([^\]\n]+)\]\(([^)\s]+)\)|(https?:\/\/[^\s<>()]+[^\s<>().,;:!?'"])/g;

const HTML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (char) => HTML_ESCAPES[char]!);
}

function span(className: string, text: string): string {
  return `<span class="${className}">${escapeHtml(text)}</span>`;
}

function highlightLinks(text: string): string {
  let html = "";
  let last = 0;
  for (const match of text.matchAll(LINK)) {
    const start = match.index ?? 0;
    if (start > last) html += escapeHtml(text.slice(last, start));
    const [, label, url, bare] = match;
    html += label
      ? span("cpk-md-syntax", "[") +
        span("cpk-md-link", label) +
        span("cpk-md-syntax", `](${url})`)
      : span("cpk-md-link", bare!);
    last = start + match[0].length;
  }
  if (last < text.length) html += escapeHtml(text.slice(last));
  return html;
}

/**
 * Renders composer text with list markers and links styled, character for
 * character. Pair with a transparent textarea of identical typography and
 * padding.
 */
export function highlightMarkdownInput(text: string): string {
  const lines = text.split("\n");
  let inFence = false;

  const html = lines.map((line, index) => {
    const newline = index < lines.length - 1 ? "\n" : "";

    // Fenced code is left as typed.
    const isFence = FENCE.test(line);
    if (isFence) inFence = !inFence;
    if (isFence || inFence) return escapeHtml(line) + newline;

    const list = LIST_MARKER.exec(line);
    const marker = list
      ? escapeHtml(list[1]!) +
        span("cpk-md-list-marker", list[2]!) +
        escapeHtml(list[3]!)
      : "";
    const rest = list ? line.slice(list[0].length) : line;
    return marker + highlightLinks(rest) + newline;
  });

  // A trailing newline has no content to give the last line height.
  return html.join("") + (text.endsWith("\n") ? "​" : "");
}
