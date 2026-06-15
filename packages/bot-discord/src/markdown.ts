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
/** The separator row under the header: cells of dashes/colons. */
const TABLE_SEP = /^\s*\|?[\s:|-]+\|[\s:|-]+$/;

function wrapPipeTables(text: string): string {
  const lines = text.split("\n");
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    // A table is a header row, a separator row, then >=1 body rows.
    if (
      i + 1 < lines.length &&
      TABLE_ROW.test(lines[i]!) &&
      TABLE_SEP.test(lines[i + 1]!)
    ) {
      const block: string[] = [lines[i]!, lines[i + 1]!];
      i += 2;
      while (i < lines.length && TABLE_ROW.test(lines[i]!) && lines[i]!.includes("|")) {
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
