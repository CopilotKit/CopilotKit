/**
 * Turn an email body into the new text the sender wrote: HTML to plain
 * text, then the quoted history and signature removed.
 */

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ndash: "–",
  mdash: "—",
  hellip: "…",
  rsquo: "’",
  lsquo: "‘",
  rdquo: "”",
  ldquo: "“",
  copy: "©",
};

/** Decode HTML character references. */
export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, ref: string) => {
    if (ref[0] === "#") {
      const code =
        ref[1] === "x" || ref[1] === "X"
          ? parseInt(ref.slice(2), 16)
          : parseInt(ref.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff
        ? String.fromCodePoint(code)
        : match;
    }
    return NAMED_ENTITIES[ref.toLowerCase()] ?? match;
  });
}

/**
 * Markers where mail clients start the quoted history in an HTML reply.
 * Everything from the first marker on is dropped.
 */
const HTML_QUOTE_MARKERS = [
  /<div[^>]*class=["'][^"']*gmail_quote/i, // Gmail
  /<blockquote[^>]*type=["']cite["']/i, // Apple Mail, Thunderbird
  /<div[^>]*id=["']?divRplyFwdMsg/i, // Outlook
  /<div[^>]*id=["']?appendonsend/i, // Outlook
  /<hr[^>]*id=["']?stopSpelling/i, // Outlook.com
  /<div[^>]*class=["'][^"']*yahoo_quoted/i, // Yahoo
  /<div[^>]*class=["'][^"']*moz-cite-prefix/i, // Thunderbird
];

/** Drop the quoted part of an HTML reply. */
export function stripHtmlQuote(html: string): string {
  let cut = html.length;
  for (const marker of HTML_QUOTE_MARKERS) {
    const match = marker.exec(html);
    if (match && match.index < cut) cut = match.index;
  }
  return html.slice(0, cut);
}

/** Convert email HTML to readable plain text. */
export function htmlToText(html: string): string {
  const text = html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<(head|style|script|title)\b[\s\S]*?<\/\1\s*>/gi, "")
    .replace(
      /<a\b[^>]*\bhref=["']([^"']*)["'][^>]*>([\s\S]*?)<\/a\s*>/gi,
      (_m, href: string, label: string) => {
        const inner = label.replace(/<[^>]+>/g, "").trim();
        const url = decodeEntities(href).trim();
        if (!inner) return url;
        if (!/^https?:/i.test(url) || decodeEntities(inner) === url)
          return inner;
        return `${inner} (${url})`;
      },
    )
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<li\b[^>]*>/gi, "\n- ")
    .replace(/<\/(p|div|h[1-6]|tr|table|blockquote|pre|ul|ol)\s*>/gi, "\n")
    .replace(/<(p|div|h[1-6]|tr|table|blockquote|pre|ul|ol)\b[^>]*>/gi, "\n")
    .replace(/<\/t[dh]\s*>/gi, "\t")
    .replace(/<[^>]+>/g, "");
  return collapse(decodeEntities(text));
}

function collapse(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/ /g, " ")
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trimEnd())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** An attribution line that introduces a quote ("On Mon, Jan 1, Ann wrote:"). */
const ATTRIBUTION_RE =
  /^(on\b.+\bwrote|am\b.+\bschrieb\b.*|le\b.+\ba écrit|el\b.+\bescribió|op\b.+\bschreef\b.*|il\b.+\bha scritto)\s*:?\s*$/i;

/** Lines where a forwarded or quoted original starts. */
const SEPARATOR_RES = [
  /^-{2,}\s*original message\s*-{2,}$/i,
  /^-{2,}\s*forwarded message\s*-{2,}$/i,
  /^_{10,}$/,
  /^from:\s.+$/i, // Outlook header block, when followed by Sent:/Date:
];

/** Remove the quoted history and the signature from a plain-text reply. */
export function stripTextQuote(text: string): string {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  let end = lines.length;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!.trim();
    // Attribution, possibly wrapped over two lines by the client.
    const joined = `${line} ${lines[i + 1]?.trim() ?? ""}`.trim();
    if (ATTRIBUTION_RE.test(line)) {
      end = i;
      break;
    }
    if (
      /^on\b/i.test(line) &&
      !/:\s*$/.test(line) &&
      ATTRIBUTION_RE.test(joined)
    ) {
      end = i;
      break;
    }
    if (SEPARATOR_RES.slice(0, 3).some((re) => re.test(line))) {
      end = i;
      break;
    }
    if (
      SEPARATOR_RES[3]!.test(line) &&
      /^(sent|date):\s/i.test(lines[i + 1]?.trim() ?? "")
    ) {
      end = i;
      break;
    }
    // Standard signature delimiter ("-- ").
    if (lines[i] === "-- " || lines[i] === "--") {
      end = i;
      break;
    }
  }
  const kept = lines.slice(0, end);
  // Drop trailing "> quoted" lines. Quotes between new text (bottom-posting) stay.
  while (kept.length > 0) {
    const last = kept[kept.length - 1]!.trim();
    if (last === "" || last.startsWith(">")) kept.pop();
    else break;
  }
  return collapse(kept.join("\n"));
}

/**
 * The new text of an inbound email. Uses the plain-text part when present,
 * else the HTML part converted to text.
 */
export function extractReplyText(email: {
  text?: string | null;
  html?: string | null;
}): string {
  if (email.text && email.text.trim()) return stripTextQuote(email.text);
  if (email.html && email.html.trim()) {
    return stripTextQuote(htmlToText(stripHtmlQuote(email.html)));
  }
  return "";
}
