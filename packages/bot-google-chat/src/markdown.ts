/**
 * Allow only safe link schemes. Permits http:, https:, and mailto:
 * (case-insensitive), scheme-relative `//host` URLs, and relative URLs that
 * carry no scheme at all (no `:` before the first `/`, `?`, or `#`). Any
 * other scheme (javascript:, data:, vbscript:, file:, …) is rejected so it
 * can't be emitted as a link target.
 */
function isSafeUrl(url: string): boolean {
  const trimmed = url.trim();
  if (trimmed.startsWith("//")) return true; // scheme-relative
  const colon = trimmed.indexOf(":");
  if (colon === -1) return true; // no scheme → relative
  const slash = trimmed.indexOf("/");
  const question = trimmed.indexOf("?");
  const hash = trimmed.indexOf("#");
  // A ':' that appears only after a path/query/fragment separator is not a
  // scheme delimiter (e.g. "/a:b", "?x:y") — treat those as relative.
  const beforeDelimiter = (d: number) => d === -1 || colon < d;
  if (
    beforeDelimiter(slash) &&
    beforeDelimiter(question) &&
    beforeDelimiter(hash)
  ) {
    const scheme = trimmed.slice(0, colon).toLowerCase();
    return scheme === "http" || scheme === "https" || scheme === "mailto";
  }
  return true;
}

/**
 * Translate the agent's standard Markdown into Google Chat's text format.
 *
 *   Markdown         →  Google Chat
 *   **bold**         →  *bold*
 *   __bold__         →  *bold*
 *   *italic*         →  _italic_
 *   _italic_         →  _italic_
 *   ~~strike~~       →  ~strike~
 *   - bullet         →  •  bullet
 *   # heading        →  *heading*
 *   [text](url)      →  <url|text>
 *
 * Fenced code (``` … ```) and inline `code` pass through unchanged — they
 * render identically in both formats.
 *
 * Tables (D15): Google Chat has no table primitive; we wrap GFM tables in a
 * code fence so they render in monospace and stay readable.
 */
export function markdownToChat(input: string): string {
  if (!input) return input;

  // ── 0. Strip the sentinel control bytes from the input. ──
  // The placeholder/BOLD sentinels below are single non-printing control
  // bytes (\x10 here; \x11/\x12 below). They are collision-proof ONLY
  // BECAUSE we remove any pre-existing occurrences from the input first —
  // input CAN contain them (rare, but possible in pasted/LLM content), and
  // leaving them in would corrupt the placeholder/restore passes. Stripping
  // them up front makes the "can never appear in real input" invariant real.
  const sanitized = input.replace(/[\x10\x11\x12]/g, "");

  // ── 1. Pull code regions and tables out so we don't touch them. ──
  // NOTE: the placeholder (and the BOLD sentinels below) are wrapped in
  // intentional, load-bearing non-printing control-character bytes (\x10
  // here; \x11/\x12 below). They are invisible in most editors but are NOT
  // decorative — they are collision-proof sentinels (the input is stripped
  // of them first, see step 0, so they can never collide with real content).
  // Do NOT "clean them up" or replace them with visible text.
  const codeRegions: string[] = [];
  const codePlaceholder = (i: number) => `CODE${i}`;

  let body = sanitized.replace(/```[\s\S]*?```/g, (match) => {
    codeRegions.push(match);
    return codePlaceholder(codeRegions.length - 1);
  });
  body = body.replace(/`[^`\n]*`/g, (match) => {
    codeRegions.push(match);
    return codePlaceholder(codeRegions.length - 1);
  });

  // GFM-style tables: wrap in a fence with column-aligned cells so they
  // render as a readable monospace table rather than a pile of pipes.
  body = body.replace(
    /(^\|[^\n]+\|\s*\n\|[\s:|-]+\|\s*\n(?:\|[^\n]+\|\s*\n?)+)/gm,
    (table) => {
      const fenced = "```\n" + alignTable(table.trimEnd()) + "\n```";
      codeRegions.push(fenced);
      return codePlaceholder(codeRegions.length - 1);
    },
  );

  // ── 1b. Pull markdown links out into their OWN sentinel placeholders, ──
  // BEFORE the emphasis passes, so `*`/`_`/`~` inside a URL can never be
  // rewritten as Chat emphasis (which would silently mistype the URL path).
  // The link sentinel uses a DISTINCT prefix from the code placeholder
  // (`\x10LINK${i}\x10` vs `\x10CODE${i}\x10`) so the two restore passes can't
  // interfere. The final `<url|text>` form is built NOW with the URL verbatim
  // (never emphasis-transformed); we percent-encode `|`→`%7C` and `>`→`%3E` in
  // the URL and strip them from the TEXT so neither breaks the `<url|text>`
  // delimiters. The URL group tolerates one level of balanced `(...)` so links
  // to pages whose path contains parens (Wikipedia/MSDN, e.g. `.../Foo_(bar)`)
  // aren't truncated at the first `)`. A disallowed scheme (javascript:, …) is
  // NOT emitted as a link — only the visible text is kept (and runs through the
  // emphasis passes as plain text), so a crafted link can't smuggle an href.
  const linkRegions: string[] = [];
  const linkPlaceholder = (i: number) => `\x10LINK${i}\x10`;
  body = body.replace(
    /\[([^\]\n]+)\]\(((?:[^()\s]|\([^()\s]*\))+)\)/g,
    (_m, t: string, u: string) => {
      if (!isSafeUrl(u)) return t; // keep text; let emphasis passes see it
      const safeUrl = u.replace(/\|/g, "%7C").replace(/>/g, "%3E");
      const safeText = t.replace(/[|>]/g, " ").trim();
      linkRegions.push(`<${safeUrl}|${safeText}>`);
      return linkPlaceholder(linkRegions.length - 1);
    },
  );

  // ── 2. Bold first, into a sentinel; then italic won't eat its output. ──
  // The two strings below are single non-printing control-character bytes
  // (\x11 open, \x12 close) — deliberate, load-bearing sentinels, NOT empty
  // strings. Do NOT replace them with visible markers (see note in step 1).
  const BOLD_OPEN = "";
  const BOLD_CLOSE = "";
  body = body.replace(/\*\*([^\n*]+?)\*\*/g, `${BOLD_OPEN}$1${BOLD_CLOSE}`);
  body = body.replace(/__([^\n_]+?)__/g, `${BOLD_OPEN}$1${BOLD_CLOSE}`);

  // Headings (#…) → bold (also sentinel-marked). The whole heading line
  // becomes a single bold span, so any inline **bold**/__bold__ inside it was
  // already turned into BOLD_OPEN/BOLD_CLOSE sentinels above and is now
  // redundant. Strip those inner sentinels before re-wrapping, otherwise the
  // line would carry nested sentinel pairs that collapse to unbalanced `*` on
  // restore (e.g. "# **Important**" → "**Important**" instead of "*Important*").
  const boldSentinel = new RegExp(`[${BOLD_OPEN}${BOLD_CLOSE}]`, "g");
  body = body.replace(
    /^\s{0,3}#{1,6}\s+(.*)$/gm,
    (_m, text: string) =>
      `${BOLD_OPEN}${text.replace(boldSentinel, "").trim()}${BOLD_CLOSE}`,
  );

  // Strikethrough ~~text~~ → ~text~
  body = body.replace(/~~([^\n~]+?)~~/g, "~$1~");

  // Italic *text* → _text_ (skip already-converted bold sentinels).
  body = body.replace(/(^|[^*\w])\*(\S(?:[^*\n]*\S)?)\*(?!\w)/g, "$1_$2_");
  // Italic _text_ stays _text_ (no-op transform, but ensures the form is canonical).

  // (Markdown links were already extracted into sentinel placeholders in step
  // 1b, before the emphasis passes, so their URLs never reach the emphasis
  // transforms and can't be corrupted.)

  // Bullet list markers: `- ` / `* ` / `+ ` at the start of a line → "•  "
  body = body.replace(/^(\s*)[-*+]\s+/gm, "$1•  ");

  // ── 3. Restore sentinels, links, and code regions. ──
  body = body.replace(new RegExp(BOLD_OPEN, "g"), "*");
  body = body.replace(new RegExp(BOLD_CLOSE, "g"), "*");
  // Links restore to their pre-rendered `<url|text>` form (built in step 1b).
  // The LINK and CODE placeholders use distinct prefixes (`\x10LINK` vs
  // `\x10CODE`) so the two restore passes never match each other's sentinels.
  body = body.replace(
    /\x10LINK(\d+)\x10/g,
    (_m, idx) => linkRegions[Number(idx)] ?? "",
  );
  body = body.replace(
    /CODE(\d+)/g,
    (_m, idx) => codeRegions[Number(idx)] ?? "",
  );

  return body;
}

/**
 * Re-render a GFM table with cells padded to consistent column widths so a
 * monospace render in Google Chat reads like a real table instead of pipe-soup.
 * Drops the separator row (no visual value in monospace).
 */
function alignTable(table: string): string {
  const lines = table.split("\n").filter((l) => l.trim().length > 0);
  const rows = lines.map((line) => {
    const cells = line.split("|").map((c) => c.trim());
    if (cells.length > 0 && cells[0] === "") cells.shift();
    if (cells.length > 0 && cells[cells.length - 1] === "") cells.pop();
    return cells;
  });
  const isSeparator = (row: string[]) =>
    row.length > 0 && row.every((c) => /^[-:\s]+$/.test(c));
  const dataRows = rows.filter((r) => !isSeparator(r));
  if (dataRows.length === 0) return table;
  const colCount = Math.max(...dataRows.map((r) => r.length));
  const widths: number[] = [];
  for (let c = 0; c < colCount; c++) {
    let max = 0;
    for (const row of dataRows) {
      const cell = row[c] ?? "";
      if (cell.length > max) max = cell.length;
    }
    widths.push(max);
  }
  return dataRows
    .map((row) => {
      const padded = widths.map((w, c) => (row[c] ?? "").padEnd(w));
      return "| " + padded.join(" | ") + " |";
    })
    .join("\n");
}
