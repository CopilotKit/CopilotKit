/**
 * Discord's markdown is close to GFM, so this is mostly identity. The single
 * real gap is tables: Discord renders none, so a contiguous GFM pipe-table
 * block is wrapped in a code fence (monospace keeps the columns aligned).
 */
export function discordMarkdown(text: string): string {
  if (!text.includes("|")) return text;
  return wrapPipeTables(text);
}

/** A GFM table row: starts/ends with optional pipes and contains at least one `|`. */
const TABLE_ROW = /^\s*\|?.*\|.*$/;
/** The separator row under the header: cells of dashes/colons (with optional outer pipes). */
const TABLE_SEP = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;
/** A fence delimiter line: ``` or ~~~ optionally followed by a language tag. */
const FENCE = /^\s*(`{3,}|~{3,})/;

/** Count GFM cells in a row: split on unescaped pipes, drop empty leading/trailing cells. */
function cellCount(line: string): number {
  // Split on pipes that are NOT escaped (`\|` is a literal pipe inside a cell,
  // not a column separator). Negative lookbehind needs Node 18+ (supported).
  const cells = line.trim().split(/(?<!\\)\|/);
  // A leading/trailing pipe produces an empty edge cell — ignore those.
  if (cells.length && cells[0]!.trim() === "") cells.shift();
  if (cells.length && cells[cells.length - 1]!.trim() === "") cells.pop();
  return cells.length;
}

function wrapPipeTables(text: string): string {
  const lines = text.split("\n");
  const out: string[] = [];
  let i = 0;
  let inFence = false;
  while (i < lines.length) {
    // Track existing fenced blocks so a model-fenced table is not double-wrapped.
    if (FENCE.test(lines[i]!)) {
      inFence = !inFence;
      out.push(lines[i]!);
      i += 1;
      continue;
    }

    // A table is a header row, a separator row whose column count matches the
    // header, then >=1 body rows. Only detect outside an existing fence so prose
    // with stray `|` (one row, no matching separator) is left alone.
    if (
      !inFence &&
      i + 1 < lines.length &&
      TABLE_ROW.test(lines[i]!) &&
      TABLE_SEP.test(lines[i + 1]!) &&
      cellCount(lines[i + 1]!) === cellCount(lines[i]!)
    ) {
      const block: string[] = [lines[i]!, lines[i + 1]!];
      i += 2;
      while (
        i < lines.length &&
        !FENCE.test(lines[i]!) &&
        TABLE_ROW.test(lines[i]!) &&
        lines[i]!.includes("|")
      ) {
        block.push(lines[i]!);
        i += 1;
      }
      out.push("```", ...block, "```");
      continue;
    }
    out.push(lines[i]!);
    i += 1;
  }
  return out.join("\n");
}
