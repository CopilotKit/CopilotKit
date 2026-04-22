// @ts-nocheck — demo fixture; react-core types are stricter than the stubs need.
// Demonstrates V2 `useLazyToolRenderer` — a lazy renderer that only loads its
// heavy payload when the tool call is expanded. Fixture is a historical
// temperature chart with a skeleton shimmer while "loading".
import { useLazyToolRenderer } from "@copilotkit/react-core/v2";
import { z } from "zod";

export function LazyHistoricalChart() {
  useLazyToolRenderer({
    name: "historicalTemperatures",
    parameters: z.object({
      city: z.string(),
      range: z.enum(["24h", "7d", "30d", "1y"]).default("7d"),
    }),
    render: ({ parameters, status }) => {
      const bars = [32, 48, 60, 74, 82, 71, 55, 44, 52, 68, 80, 77, 63, 49];
      return (
        <div className="overflow-hidden rounded-2xl border border-violet-400/20 bg-gradient-to-b from-violet-950/40 to-black p-5 text-white shadow-xl">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-widest text-violet-300/80">
                Historical · {parameters.range ?? "7d"}
              </div>
              <h3 className="mt-1 text-lg font-semibold">
                {parameters.city ?? "—"} · Temperatures
              </h3>
            </div>
            {status !== "complete" ? (
              <div className="flex items-center gap-2 rounded-full bg-violet-500/15 px-2.5 py-1 text-[11px] font-medium text-violet-200">
                <span className="inline-block h-1.5 w-1.5 animate-ping rounded-full bg-violet-400" />
                Loading…
              </div>
            ) : (
              <div className="rounded-full bg-emerald-400/15 px-2.5 py-1 text-[11px] font-medium text-emerald-200">
                Ready
              </div>
            )}
          </div>
          <div className="mt-5 flex h-24 items-end gap-1">
            {bars.map((v, i) => (
              <div
                key={i}
                className="flex-1 rounded-t-sm bg-gradient-to-t from-violet-500/30 to-violet-300/80"
                style={{ height: `${v}%` }}
              />
            ))}
          </div>
          <div className="mt-2 flex justify-between text-[10px] text-white/40">
            <span>2w ago</span>
            <span>1w ago</span>
            <span>today</span>
          </div>
        </div>
      );
    },
  });
  return null;
}

export default LazyHistoricalChart;
