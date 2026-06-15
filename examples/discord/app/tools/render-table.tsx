/**
 * `render_table` — render tabular data as a table posted into the current
 * thread. Use this for "show X as a table": a list of issues with several
 * fields, metrics parsed from an uploaded CSV, side-by-side comparisons —
 * anything where a chart isn't the right shape.
 *
 * Discord has no native table primitive: `<Table>/<Row>/<Cell>` renders as a
 * GFM pipe table inside a monospace code fence. We author it as JSX over
 * `@copilotkit/bot-ui`'s `<Table>/<Row>/<Cell>` vocabulary and post via
 * `thread.post`. If that post fails (rate-limit / network / message too
 * large), we fall back to posting a plain column-aligned monospace
 * (code-fenced) table as ordinary markdown so the data still lands.
 */
import { z } from "zod";
import { Message, Header, Table, Row, Cell } from "@copilotkit/bot-ui";
import { defineBotTool } from "@copilotkit/bot";

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

// Cap the rendered table at 100 rows (header included) and 20 cols.
const MAX_COLUMNS = 20;
const MAX_DATA_ROWS = 99;

/** Clamp to limits, recording what was dropped. */
export function clamp(
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

/**
 * Column-aligned monospace fallback, wrapped in a code fence.
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

export const renderTableTool = defineBotTool({
  name: "render_table",
  description:
    "Render tabular data as a table posted to the Discord thread. Pass columns " +
    "(each with a header and optional alignment) and rows (arrays of cell " +
    "values in column order). Use for 'show as a table' — issue lists with " +
    "several fields, metrics from a CSV, comparisons — when a chart isn't the " +
    "right shape. Max 20 columns and 100 rows.",
  parameters: schema,
  async handler({ title, columns, rows }, { thread }) {
    const { cols, dataRows, notes } = clamp(columns, rows);

    const table = (
      <Message>
        {title ? <Header>{title}</Header> : null}
        <Table columns={cols}>
          {dataRows.map((r) => (
            <Row>
              {cols.map((_, i) => (
                <Cell>{String(r[i] ?? "")}</Cell>
              ))}
            </Row>
          ))}
        </Table>
      </Message>
    );

    try {
      await thread.post(table);
      return (
        "Rendered the table for the user." +
        (notes.length ? ` (${notes.join("; ")})` : "")
      );
    } catch (e) {
      // The post itself failed (rate-limit / network / message too large) —
      // post the same data as a plain monospace code-fenced markdown table so
      // it still lands.
      console.error(
        "[render_table] table post failed, falling back to monospace:",
        e,
      );
      const mono = toMonospaceTable(cols, dataRows);
      try {
        await thread.post((title ? `**${title}**\n` : "") + mono);
        return (
          "Rendered the table (monospace fallback) for the user." +
          (notes.length ? ` (${notes.join("; ")})` : "")
        );
      } catch (e2) {
        return `Failed to render the table: ${(e2 as Error).message}`;
      }
    }
  },
});
