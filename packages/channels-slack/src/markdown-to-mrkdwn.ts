/**
 * Translate the agent's standard Markdown into Slack's `mrkdwn` flavour.
 *
 *   Markdown         →  mrkdwn
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
 * render identically in both flavours.
 *
 * Tables (D15): mrkdwn has no table primitive; we wrap GFM tables in a
 * code fence so they render in monospace and stay readable.
 */
export function markdownToMrkdwn(input: string): string {
  if (!input) return input;

  // ── 1. Pull code regions and tables out so we don't touch them. ──
  const codeRegions: string[] = [];
  const codePlaceholder = (i: number) => `CODE${i}`;

  let body = input.replace(/```[\s\S]*?```/g, (match) => {
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

  // ── 2. Bold first, into a sentinel; then italic won't eat its output. ──
  const BOLD_OPEN = "";
  const BOLD_CLOSE = "";
  body = body.replace(/\*\*([^\n*]+?)\*\*/g, `${BOLD_OPEN}$1${BOLD_CLOSE}`);
  body = body.replace(/__([^\n_]+?)__/g, `${BOLD_OPEN}$1${BOLD_CLOSE}`);

  // Headings (#…) → bold (also sentinel-marked).
  body = body.replace(
    /^\s{0,3}#{1,6}\s+(.*)$/gm,
    (_m, text: string) => `${BOLD_OPEN}${text.trim()}${BOLD_CLOSE}`,
  );

  // Strikethrough ~~text~~ → ~text~
  body = body.replace(/~~([^\n~]+?)~~/g, "~$1~");

  // Italic *text* → _text_ (skip already-converted bold sentinels).
  body = body.replace(/(^|[^*\w])\*(\S(?:[^*\n]*\S)?)\*(?!\w)/g, "$1_$2_");
  // Italic _text_ stays _text_ (no-op transform, but ensures the form is canonical).

  // Markdown links [text](url) → <url|text>
  body = body.replace(/\[([^\]\n]+)\]\(([^)\s]+)\)/g, "<$2|$1>");

  // Bullet list markers: `- ` / `* ` / `+ ` at the start of a line → "•  "
  body = body.replace(/^(\s*)[-*+]\s+/gm, "$1•  ");

  // ── 3. Restore sentinels and code regions. ──
  body = body.replace(new RegExp(BOLD_OPEN, "g"), "*");
  body = body.replace(new RegExp(BOLD_CLOSE, "g"), "*");
  body = body.replace(
    /CODE(\d+)/g,
    (_m, idx) => codeRegions[Number(idx)] ?? "",
  );

  return body;
}

/**
 * Re-render a GFM table with cells padded to consistent column widths so a
 * monospace render in Slack reads like a real table instead of pipe-soup.
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
