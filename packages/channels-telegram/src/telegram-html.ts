/**
 * Translate the agent's standard Markdown into Telegram HTML parse mode.
 *
 * Telegram HTML supports only: <b> <i> <u> <s> <a href> <code> <pre> <tg-spoiler>
 * All & < > in text must be entity-escaped.
 *
 *   Markdown         →  Telegram HTML
 *   **bold**         →  <b>bold</b>
 *   __bold__         →  <b>bold</b>
 *   *italic*         →  <i>italic</i>
 *   _italic_         →  <i>italic</i>
 *   ~~strike~~       →  <s>strike</s>
 *   # heading        →  <b>heading</b>
 *   [text](url)      →  <a href="url">text</a>
 *   - bullet         →  •  bullet
 *   `code`           →  <code>code</code>
 *   ```…```          →  <pre>…</pre>
 */

/** Escape & < > " for use inside Telegram HTML text nodes and attributes. */
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Unique placeholder that won't appear in normal text.
// Uses a non-regex-control-char delimiter so ESLint is happy.
const CODE_PLACEHOLDER_RE = /\u{FFFE}CODE(\d+)\u{FFFE}/gu;
function codePlaceholder(i: number): string {
  return `￾CODE${i}￾`;
}

const LINK_PLACEHOLDER_RE = /\u{FFFE}LINK(\d+)\u{FFFE}/gu;
function linkPlaceholder(i: number): string {
  return `￾LINK${i}￾`;
}

export function telegramHtml(input: string): string {
  if (!input) return input;

  // ── 1. Pull code regions out so we don't touch them. ──
  const codeRegions: string[] = [];

  // Fenced code blocks first (```…```)
  let body = input.replace(/```([\s\S]*?)```/g, (_match, inner: string) => {
    const escaped = escapeHtml(inner.replace(/^\n/, "").replace(/\n$/, ""));
    codeRegions.push(`<pre>${escaped}</pre>`);
    return codePlaceholder(codeRegions.length - 1);
  });

  // Inline code `…`
  body = body.replace(/`([^`\n]*)`/g, (_match, inner: string) => {
    const escaped = escapeHtml(inner);
    codeRegions.push(`<code>${escaped}</code>`);
    return codePlaceholder(codeRegions.length - 1);
  });

  // ── 1b. Pull markdown links out before bold/italic transforms mangle URLs. ──
  // The link text and URL will be HTML-escaped in step 2 below via the
  // global escapeHtml pass on the placeholder-free body; the final <a> tag
  // is assembled after escaping so the URL keeps its escaped form (single-escape,
  // consistent with the existing `&`-in-URL behaviour).
  const linkRegions: Array<{ text: string; url: string }> = [];

  body = body.replace(
    /\[([^\]\n]+)\]\(([^)\s]+)\)/g,
    (_m, text: string, url: string) => {
      linkRegions.push({ text, url });
      return linkPlaceholder(linkRegions.length - 1);
    },
  );

  // ── 2. Escape HTML-special chars in the remaining (non-code) text. ──
  body = escapeHtml(body);

  // ── 3. Bold first, into a sentinel; then italic won't eat its output. ──
  const BOLD_OPEN = "\x01B\x01";
  const BOLD_CLOSE = "\x02B\x02";

  body = body.replace(/\*\*([^\n*]+?)\*\*/g, `${BOLD_OPEN}$1${BOLD_CLOSE}`);
  body = body.replace(/__([^\n_]+?)__/g, `${BOLD_OPEN}$1${BOLD_CLOSE}`);

  // Headings (#…) → bold
  body = body.replace(
    /^\s{0,3}#{1,6}\s+(.*)$/gm,
    (_m, text: string) => `${BOLD_OPEN}${text.trim()}${BOLD_CLOSE}`,
  );

  // Strikethrough ~~text~~ → <s>text</s>
  body = body.replace(/~~([^\n~]+?)~~/g, "<s>$1</s>");

  // Italic *text* or _text_ → <i>text</i> (skip bold sentinels)
  body = body.replace(/(^|[^*\w])\*(\S(?:[^*\n]*\S)?)\*(?!\w)/g, "$1<i>$2</i>");
  body = body.replace(/(^|[^_\w])_(\S(?:[^_\n]*\S)?)_(?!\w)/g, "$1<i>$2</i>");

  // Bullet list markers: `- ` / `* ` / `+ ` at the start of a line → "•  "
  body = body.replace(/^(\s*)[-*+]\s+/gm, "$1•  ");

  // ── 4. Restore sentinels and code regions. ──
  body = body.replace(new RegExp(BOLD_OPEN, "g"), "<b>");
  body = body.replace(new RegExp(BOLD_CLOSE, "g"), "</b>");
  body = body.replace(
    CODE_PLACEHOLDER_RE,
    (_m, idx) => codeRegions[Number(idx)] ?? "",
  );

  // ── 5. Restore link placeholders LAST so URLs are never touched by markup passes. ──
  // text and url were captured from the raw input before escapeHtml; escapeHtml
  // was applied globally to the body (which at that point contained only the
  // placeholder token), so here we escape text/url ourselves to produce the
  // same single-escaped output the old inline regex produced.
  body = body.replace(LINK_PLACEHOLDER_RE, (_m, idx) => {
    const link = linkRegions[Number(idx)];
    if (!link) return "";
    const escapedUrl = escapeHtml(link.url);
    const escapedText = escapeHtml(link.text);
    return `<a href="${escapedUrl}">${escapedText}</a>`;
  });

  return body;
}
