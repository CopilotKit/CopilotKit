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
      <div className="hidden md:block overflow-x-auto">
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
                className={`border-b border-border ${
                  index % 2 === 0 ? "bg-card/50" : "bg-transparent"
                }`}
              >
                <td className="p-4 font-semibold">{row.approach}</td>
                <td className="p-4 text-muted-foreground">{row.examples}</td>
                <td className="p-4 text-muted-foreground">{row.strengths}</td>
                <td className="p-4 text-muted-foreground">{row.weaknesses}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile stacked cards */}
      <div className="md:hidden space-y-4">
        {data.map((row, index) => (
          <div
            key={index}
            className="bg-card border border-border rounded-lg p-4"
          >
            <div className="mb-3">
              <div className="font-semibold text-sm text-muted-foreground mb-1">
                Approach
              </div>
              <div className="font-bold text-lg">{row.approach}</div>
            </div>
            <div className="mb-3">
              <div className="font-semibold text-sm text-muted-foreground mb-1">
                Examples
              </div>
              <div>{row.examples}</div>
            </div>
            <div className="mb-3">
              <div className="font-semibold text-sm text-muted-foreground mb-1">
                Strengths
              </div>
              <div>{row.strengths}</div>
            </div>
            <div>
              <div className="font-semibold text-sm text-muted-foreground mb-1">
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
