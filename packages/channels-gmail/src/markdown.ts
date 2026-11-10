/** Escape text for HTML element content and attribute values. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Only web and mail links. Anything else (for example `javascript:`) is dropped. */
export function safeUrl(url: string): string | undefined {
  try {
    const parsed = new URL(url);
    return ["http:", "https:", "mailto:"].includes(parsed.protocol)
      ? parsed.toString()
      : undefined;
  } catch {
    return undefined;
  }
}

const CODE_STYLE =
  "font-family:SFMono-Regular,Consolas,Menlo,monospace;font-size:13px;background:#f6f8fa;border-radius:4px;padding:1px 4px";
const PRE_STYLE =
  "font-family:SFMono-Regular,Consolas,Menlo,monospace;font-size:13px;background:#f6f8fa;border-radius:6px;padding:12px;white-space:pre-wrap;margin:0 0 12px";
const LINK_STYLE = "color:#0969da";

/** Inline Markdown (code, bold, italic, links) on one escaped line. */
function inline(text: string): string {
  const codes: string[] = [];
  let out = escapeHtml(text).replace(/`([^`]+)`/g, (_m, code: string) => {
    codes.push(`<code style="${CODE_STYLE}">${code}</code>`);
    return `\uE000${codes.length - 1}\uE001`;
  });
  out = out
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, label: string, href: string) => {
      // `href` is already escaped; undo that to check the real URL.
      const url = safeUrl(href.replace(/&amp;/g, "&").replace(/&quot;/g, '"'));
      return url
        ? `<a href="${escapeHtml(url)}" style="${LINK_STYLE}">${label}</a>`
        : m;
    })
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/__([^_]+)__/g, "<strong>$1</strong>")
    .replace(/(^|[^*\w])\*([^*\s][^*]*?)\*(?!\w)/g, "$1<em>$2</em>")
    .replace(/(^|[^_\w])_([^_\s][^_]*?)_(?!\w)/g, "$1<em>$2</em>")
    .replace(/~~([^~]+)~~/g, "<s>$1</s>");
  return out.replace(
    /\uE000(\d+)\uE001/g,
    (_m, i: string) => codes[Number(i)]!,
  );
}

/**
 * Convert the Markdown an agent writes to simple, inline-styled email HTML.
 * Covers paragraphs, headings, lists, quotes, code, bold, italic, and links.
 * All text is escaped first, so raw HTML in the input stays text.
 */
export function markdownToHtml(markdown: string): string {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const blocks: string[] = [];
  let paragraph: string[] = [];
  let list: { ordered: boolean; items: string[] } | undefined;
  let quote: string[] = [];

  const flushParagraph = () => {
    if (paragraph.length === 0) return;
    blocks.push(
      `<p style="margin:0 0 12px">${paragraph.map(inline).join("<br>")}</p>`,
    );
    paragraph = [];
  };
  const flushList = () => {
    if (!list) return;
    const tag = list.ordered ? "ol" : "ul";
    blocks.push(
      `<${tag} style="margin:0 0 12px;padding-left:24px">${list.items
        .map((item) => `<li>${inline(item)}</li>`)
        .join("")}</${tag}>`,
    );
    list = undefined;
  };
  const flushQuote = () => {
    if (quote.length === 0) return;
    blocks.push(
      `<blockquote style="margin:0 0 12px;padding-left:12px;border-left:3px solid #d0d7de;color:#57606a">${quote
        .map(inline)
        .join("<br>")}</blockquote>`,
    );
    quote = [];
  };
  const flushAll = () => {
    flushParagraph();
    flushList();
    flushQuote();
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (/^\s*```/.test(line)) {
      flushAll();
      const code: string[] = [];
      for (i++; i < lines.length && !/^\s*```/.test(lines[i]!); i++) {
        code.push(lines[i]!);
      }
      blocks.push(
        `<pre style="${PRE_STYLE}">${escapeHtml(code.join("\n"))}</pre>`,
      );
      continue;
    }
    if (line.trim() === "") {
      flushAll();
      continue;
    }
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      flushAll();
      const size = [22, 20, 18, 16, 15, 14][heading[1]!.length - 1];
      blocks.push(
        `<p style="margin:16px 0 8px;font-size:${size}px;font-weight:600">${inline(heading[2]!)}</p>`,
      );
      continue;
    }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
      flushAll();
      blocks.push(
        '<hr style="border:0;border-top:1px solid #d0d7de;margin:16px 0">',
      );
      continue;
    }
    const bullet = /^\s*[-*+]\s+(.*)$/.exec(line);
    const numbered = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    if (bullet || numbered) {
      flushParagraph();
      flushQuote();
      const ordered = Boolean(numbered);
      if (list && list.ordered !== ordered) flushList();
      list ??= { ordered, items: [] };
      list.items.push((bullet ?? numbered)![1]!);
      continue;
    }
    const quoted = /^\s*>\s?(.*)$/.exec(line);
    if (quoted) {
      flushParagraph();
      flushList();
      quote.push(quoted[1]!);
      continue;
    }
    flushList();
    flushQuote();
    paragraph.push(line);
  }
  flushAll();
  return blocks.join("\n");
}
