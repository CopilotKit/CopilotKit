/** One row of a component's props table. */
export type PropRow = { name: string; type: string; required: boolean; description: string | null };

/** The props table on a component page. Scrolls sideways on narrow screens. */
export function PropsTable({ rows }: { rows: PropRow[] }) {
  return (
    <div className="docs-scroll mt-5 overflow-x-auto rounded-xl border border-border">
      <table className="w-full min-w-[620px] border-collapse text-left text-[13px]">
        <thead>
          <tr className="border-b border-border bg-secondary/30 text-[12.5px] text-muted-foreground">
            <th className="h-10 px-4 font-medium">Prop</th>
            <th className="h-10 px-4 font-medium">Type</th>
            <th className="h-10 w-[92px] px-4 font-medium">Required</th>
            <th className="h-10 px-4 font-medium">Description</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((p) => (
            <tr key={p.name} className="border-b border-border last:border-0 align-top">
              <td className="px-4 py-3">
                <span className="font-mono text-[12.5px] font-medium text-foreground">{p.name}</span>
              </td>
              <td className="max-w-[340px] px-4 py-3">
                <code className="break-words font-mono text-[12px] leading-relaxed text-[oklch(0.8_0.08_230)]">{p.type}</code>
              </td>
              <td className="px-4 py-3 text-muted-foreground">{p.required ? <span className="text-foreground">Yes</span> : "No"}</td>
              <td className="min-w-[200px] px-4 py-3 text-[12.5px] leading-relaxed text-muted-foreground">{p.description ?? "-"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
