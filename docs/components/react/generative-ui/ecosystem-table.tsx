"use client";

interface EcosystemRow {
  approach: string;
  examples: string;
  strengths: string;
  weaknesses: string;
}

interface EcosystemTableProps {
  data: EcosystemRow[];
}

export function EcosystemTable({ data }: EcosystemTableProps) {
  return (
    <div className="my-8">
      {/* Desktop table */}
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full border-collapse">
          <thead>
            <tr className="bg-foreground text-background">
              <th className="p-4 text-left font-semibold">Approach</th>
              <th className="p-4 text-left font-semibold">Examples</th>
              <th className="p-4 text-left font-semibold">Strengths</th>
              <th className="p-4 text-left font-semibold">Weaknesses</th>
            </tr>
          </thead>
          <tbody>
            {data.map((row, index) => (
              <tr
                key={index}
                className={`border-border border-b ${
                  index % 2 === 0 ? "bg-card/50" : "bg-transparent"
                }`}
              >
                <td className="p-4 font-semibold">{row.approach}</td>
                <td className="text-muted-foreground p-4">{row.examples}</td>
                <td className="text-muted-foreground p-4">{row.strengths}</td>
                <td className="text-muted-foreground p-4">{row.weaknesses}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile stacked cards */}
      <div className="space-y-4 md:hidden">
        {data.map((row, index) => (
          <div
            key={index}
            className="bg-card border-border rounded-lg border p-4"
          >
            <div className="mb-3">
              <div className="text-muted-foreground mb-1 text-sm font-semibold">
                Approach
              </div>
              <div className="text-lg font-bold">{row.approach}</div>
            </div>
            <div className="mb-3">
              <div className="text-muted-foreground mb-1 text-sm font-semibold">
                Examples
              </div>
              <div>{row.examples}</div>
            </div>
            <div className="mb-3">
              <div className="text-muted-foreground mb-1 text-sm font-semibold">
                Strengths
              </div>
              <div>{row.strengths}</div>
            </div>
            <div>
              <div className="text-muted-foreground mb-1 text-sm font-semibold">
                Weaknesses
              </div>
              <div>{row.weaknesses}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
