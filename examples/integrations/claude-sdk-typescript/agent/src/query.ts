/** query_data tool — returns rows from the sample financial database. */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

type DataRow = Record<string, string>;

function parseCsv(text: string): DataRow[] {
  const lines = text.trim().split(/\r?\n/);
  const header = lines[0].split(",");
  return lines.slice(1).map((line) => {
    // The notes column can contain unquoted commas, so keep the first N-1
    // fields and join the remainder into the last column.
    const parts = line.split(",");
    const row: DataRow = {};
    header.forEach((key, i) => {
      row[key] =
        i === header.length - 1 ? parts.slice(i).join(",") : (parts[i] ?? "");
    });
    return row;
  });
}

const CACHED_DATA: DataRow[] = parseCsv(
  readFileSync(path.join(__dirname, "db.csv"), "utf8"),
);

export const queryData = tool(
  "query_data",
  "Query the financial database with a natural-language query. Always call " +
    "this before rendering a chart so the UI has data to plot.",
  { query: z.string().describe("Natural language query for financial data.") },
  async () => ({
    content: [{ type: "text" as const, text: JSON.stringify(CACHED_DATA) }],
  }),
);
