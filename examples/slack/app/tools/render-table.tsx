/**
 * `render_table` — render tabular data as a Slack **native Table block**,
 * posted into the current thread. Use this for "show X as a table": a list of
 * issues with several fields, metrics parsed from an uploaded CSV, side-by-side
 * comparisons — anything where a chart isn't the right shape.
 *
 * Authored as JSX over `@copilotkit/bot-ui`'s `<Table>/<Row>/<Cell>` vocabulary
 * and posted via `thread.post`. If the workspace rejects the native Table block,
 * we fall back to a column-aligned monospace (code-fenced) table via the raw
 * escape hatch so the data always lands — the same look the bridge gives GFM
 * tables in prose.
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

// Slack caps the native Table block at 100 rows (header included) and 20 cols.
const MAX_COLUMNS = 20;
const MAX_DATA_ROWS = 99;

/** Clamp to Slack's limits, recording what was dropped. */
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

export const renderTableTool = defineBotTool({
  name: "render_table",
  description:
    "Render tabular data as a table posted to the Slack thread. Pass columns " +
    "(each with a header and optional alignment) and rows (arrays of cell " +
    "values in column order). Use for 'show as a table' — issue lists with " +
    "several fields, metrics from a CSV, comparisons — when a chart isn't the " +
    "right shape. Max 20 columns and 100 rows.",
  parameters: schema,
  async handler({ title, columns, rows }, { thread }) {
    const { cols, dataRows } = clamp(columns, rows);

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
      return "Rendered the table for the user.";
    } catch {
      // Native Table block not accepted (older workspace / unsupported) — post
      // the same data as a monospace code-fenced table via the raw escape hatch
      // so it still lands.
      const mono = toMonospaceTable(cols, dataRows);
      await thread.post({
        raw: [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: (title ? `*${title}*\n` : "") + mono,
            },
          },
        ],
      });
      return "Rendered the table (monospace fallback) for the user.";
    }
  },
});
