"use client";

import { cn } from "@/lib/utils";

/** Right-align anything that reads as a figure so columns of money line up. */
function isNumericish(value: string): boolean {
  return /^[-+(]?\s*[$€£]?\s*[\d,.]+\s*%?\)?$/.test(value.trim());
}

/**
 * Tabular data rendered as a real React component in the chat, NOT as markdown.
 *
 * The agent is told never to emit a markdown table: a markdown table is dead
 * text that inherits whatever the prose stylesheet does to it, can't align its
 * own money columns, and can't carry app styling. This renders the same data as
 * a proper component — brand-consistent, tabular-figure aligned, scrollable in a
 * narrow chat column, with its own header treatment.
 */
export function DataTableChat({
  title,
  columns,
  rows,
  note,
}: {
  title?: string;
  columns: string[];
  rows: string[][];
  note?: string;
}) {
  // Structural guard, not a style rule: a one-row "table" is never data the user
  // asked to see — it is the agent narrating ("Matching charge: Delta Airlines
  // …") in table clothing. Instructions alone did not hold, so a table with
  // fewer than two rows renders nothing at all and the agent's own sentence
  // carries the message instead.
  if (!columns.length || rows.length < 2) return null;

  // Decide alignment per column from the data, not per cell, so a column never
  // zig-zags between left and right.
  const alignRight = columns.map((_, col) =>
    rows.every((row) => {
      const cell = row[col];
      return cell === undefined || cell === "" || isNumericish(cell);
    }),
  );

  return (
    <div className="space-y-3 rounded-2xl border border-hairline bg-surface p-4 text-ink shadow-soft">
      {title && <h3 className="text-sm font-semibold text-ink">{title}</h3>}
      {/* Own horizontal scroll so a wide table never makes the conversation
          scroll sideways. */}
      <div className="-mx-1 overflow-x-auto px-1">
        <table className="w-full border-collapse text-[0.8125rem]">
          <thead>
            <tr>
              {columns.map((label, i) => (
                <th
                  key={label + i}
                  scope="col"
                  className={cn(
                    "whitespace-nowrap border-b border-hairline pb-1.5 pr-3 font-medium text-ink-muted",
                    alignRight[i] ? "text-right" : "text-left",
                  )}
                >
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, r) => (
              <tr key={r} className="border-b border-hairline/60 last:border-0">
                {columns.map((_, c) => (
                  <td
                    key={c}
                    className={cn(
                      "py-1.5 pr-3 align-top",
                      alignRight[c] ? "text-right tabular-nums" : "text-left",
                      c === 0 && "font-medium text-ink",
                    )}
                  >
                    {row[c] ?? ""}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {note && <p className="text-xs text-ink-muted">{note}</p>}
    </div>
  );
}

export default DataTableChat;
