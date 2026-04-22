// Shared component used by `ImportedPollenReport.tsx`. Exercises the V2
// `useRenderTool` + imported-component path. Also imports from a second
// shared module (`./pollen-copy`) to confirm the bundler walks a multi-hop
// import graph in preview.
import { describeSeverity } from "./pollen-copy";

export interface PollenReportProps {
  parameters?: { city?: string; tree?: number; grass?: number; weed?: number };
  status?: string;
}

function Bar({
  label,
  value,
  hue,
}: {
  label: string;
  value: number;
  hue: string;
}) {
  const pct = Math.min(100, value * 10);
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-xs">
        <span className="text-white/80">{label}</span>
        <span className="font-semibold text-white">{value} / 10</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-black/30">
        <div
          className={"h-full rounded-full " + hue}
          style={{ width: pct + "%" }}
        />
      </div>
    </div>
  );
}

export function PollenReport({ parameters, status }: PollenReportProps) {
  const city = parameters?.city ?? "Austin";
  const tree = parameters?.tree ?? 7;
  const grass = parameters?.grass ?? 4;
  const weed = parameters?.weed ?? 2;
  const max = Math.max(tree, grass, weed);
  return (
    <div className="overflow-hidden rounded-2xl border border-emerald-400/20 bg-gradient-to-b from-emerald-950/50 to-black p-6 text-white shadow-xl">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-emerald-300/80">
            Pollen report
          </div>
          <h3 className="mt-1 text-lg font-semibold">{city}</h3>
          <p className="mt-0.5 text-xs text-white/60">
            Overall: {describeSeverity(max)}
          </p>
        </div>
        <div className="text-5xl">🌳</div>
      </div>
      <div className="mt-5 flex flex-col gap-3">
        <Bar label="Tree" value={tree} hue="bg-emerald-400" />
        <Bar label="Grass" value={grass} hue="bg-lime-400" />
        <Bar label="Weed" value={weed} hue="bg-amber-400" />
      </div>
      <div className="mt-4 text-right text-[10px] uppercase tracking-wider text-white/40">
        {status ?? "complete"}
      </div>
    </div>
  );
}
