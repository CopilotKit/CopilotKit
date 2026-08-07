"use client";

/**
 * The only route to row-and-column data. The agent is forbidden from emitting
 * markdown tables (see the prompt), so anything tabular that no richer chart
 * covers comes here. Cells arrive PRE-FORMATTED as strings.
 */
export function DataTable({
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
  if (!columns.length || !rows.length) {
    return <div className="text-sm text-ink-muted">Nothing to show.</div>;
  }
  return (
    <div className="space-y-2">
      {title && <div className="text-sm font-semibold text-ink">{title}</div>}
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr className="border-b border-hairline text-left">
              {columns.map((column, i) => (
                <th
                  key={column}
                  className={`py-2 pr-3 font-semibold uppercase tracking-wide text-ink-muted ${
                    i === 0 ? "" : "text-right"
                  }`}
                >
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, r) => (
              <tr key={r} className="border-b border-hairline/60 last:border-0">
                {row.map((cell, c) => (
                  <td
                    key={c}
                    className={`py-1.5 pr-3 ${
                      c === 0
                        ? "text-ink"
                        : "nw-figure text-right text-ink-muted"
                    }`}
                  >
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {note && <div className="text-[11px] text-ink-muted">{note}</div>}
    </div>
  );
}
