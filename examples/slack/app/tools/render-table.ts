/**
 * `render_table` — render tabular data as a Slack **native Table block**,
 * posted into the current thread. Use this for "show X as a table": a list of
 * issues with several fields, metrics parsed from an uploaded CSV, side-by-side
 * comparisons — anything where a chart isn't the right shape.
 *
 * The Table block is newer Block Kit (GA in `chat.postMessage`, but not yet in
 * `@slack/types`), so it's built as a plain object and cast. If the workspace
 * rejects it, we fall back to a column-aligned monospace (code-fenced) table so
 * the data always lands — the same look the bridge gives GFM tables in prose.
 */
import { z } from "zod";
import type { KnownBlock } from "@slack/types";
import type { FrontendTool } from "@copilotkit/slack";

const schema = z.object({
  title: z
    .string()
    .optional()
    .describe("Optional heading shown above the table."),
  columns: z
    .array(
      z.object({
        header: z.string().describe("Column header text."),
        align: z
          .enum(["left", "center", "right"])
          .optional()
          .describe(
            "Alignment for this column's cells. Default left; right for numbers.",
          ),
      }),
    )
    .min(1)
    .describe(
      "Columns, left to right. At most 20 are used; extras are dropped.",
    ),
  rows: z
    .array(z.array(z.coerce.string()))
    .describe(
      "Data rows; each row is an array of cell values in column order " +
        "(numbers are fine — they're rendered as text). Max 100 rows.",
    ),
});

type Column = z.infer<typeof schema>["columns"][number];

// Slack caps the native Table block at 100 rows (header included) and 20 cols.
const MAX_COLUMNS = 20;
const MAX_DATA_ROWS = 99;

interface RawTextCell {
  type: "raw_text";
  text: string;
}
interface TableBlock {
  type: "table";
  rows: RawTextCell[][];
  column_settings?: Array<{ align?: "left" | "center" | "right" }>;
}

const cell = (text: string): RawTextCell => ({ type: "raw_text", text });

/** Clamp to Slack's limits, recording what was dropped. */
function clamp(
  columns: Column[],
  rows: string[][],
): { cols: Column[]; dataRows: string[][]; notes: string[] } {
  const cols = columns.slice(0, MAX_COLUMNS);
  const dataRows = rows.slice(0, MAX_DATA_ROWS);
  const notes: string[] = [];
  if (columns.length > MAX_COLUMNS) {
    notes.push(
      `only the first ${MAX_COLUMNS} of ${columns.length} columns shown`,
    );
  }
  if (rows.length > MAX_DATA_ROWS) {
    notes.push(`only the first ${MAX_DATA_ROWS} of ${rows.length} rows shown`);
  }
  return { cols, dataRows, notes };
}

/** Build the native Table block: header row first, then the data rows. */
export function buildTableBlock(
  cols: Column[],
  dataRows: string[][],
): TableBlock {
  const headerRow = cols.map((c) => cell(c.header));
  const bodyRows = dataRows.map((r) =>
    cols.map((_, i) => cell(String(r[i] ?? ""))),
  );
  const block: TableBlock = { type: "table", rows: [headerRow, ...bodyRows] };
  const settings = cols.map((c) => (c.align ? { align: c.align } : {}));
  if (settings.some((s) => Object.keys(s).length > 0)) {
    block.column_settings = settings;
  }
  return block;
}

/**
 * Column-aligned monospace fallback, wrapped in a code fence — matches the
 * `alignTable` render the bridge applies to GFM tables in streamed prose.
 */
export function toMonospaceTable(cols: Column[], dataRows: string[][]): string {
  const header = cols.map((c) => c.header);
  const body = dataRows.map((r) => cols.map((_, i) => String(r[i] ?? "")));
  const widths = cols.map((_, c) =>
    Math.max(
      (header[c] ?? "").length,
      ...body.map((row) => (row[c] ?? "").length),
    ),
  );
  const fmt = (row: string[]) =>
    "| " +
    cols.map((_, c) => (row[c] ?? "").padEnd(widths[c] ?? 0)).join(" | ") +
    " |";
  return "```\n" + [fmt(header), ...body.map(fmt)].join("\n") + "\n```";
}

export const renderTableTool: FrontendTool<typeof schema> = {
  name: "render_table",
  description:
    "Render tabular data as a table posted to the Slack thread. Pass columns " +
    "(each with a header and optional alignment) and rows (arrays of cell " +
    "values in column order). Use for 'show as a table' — issue lists with " +
    "several fields, metrics from a CSV, comparisons — when a chart isn't the " +
    "right shape. Max 20 columns and 100 rows.",
  parameters: schema,
  async handler({ title, columns, rows }, ctx) {
    const { cols, dataRows, notes } = clamp(columns, rows);
    const ack = (extra: Record<string, unknown>) =>
      JSON.stringify({
        rendered: "table",
        ...(notes.length ? { notes } : {}),
        ...extra,
      });

    const heading: KnownBlock[] = title
      ? [{ type: "header", text: { type: "plain_text", text: title } }]
      : [];
    const tableBlock = buildTableBlock(cols, dataRows);

    try {
      const res = (await ctx.client.chat.postMessage({
        channel: ctx.channel,
        thread_ts: ctx.threadTs,
        text: title ?? "Table",
        blocks: [...heading, tableBlock as unknown as KnownBlock],
      })) as { ts?: string };
      return ack({ ok: true, posted: true, messageTs: res.ts });
    } catch (err) {
      // Native Table block not accepted (older workspace / unsupported) —
      // post the same data as a monospace code-fenced table so it still lands.
      try {
        const res = (await ctx.client.chat.postMessage({
          channel: ctx.channel,
          thread_ts: ctx.threadTs,
          text:
            (title ? `*${title}*\n` : "") + toMonospaceTable(cols, dataRows),
        })) as { ts?: string };
        return ack({
          ok: true,
          posted: true,
          fellBackToMonospace: true,
          reason: (err as Error).message,
          messageTs: res.ts,
        });
      } catch (err2) {
        return ack({ ok: false, error: (err2 as Error).message });
      }
    }
  },
};
