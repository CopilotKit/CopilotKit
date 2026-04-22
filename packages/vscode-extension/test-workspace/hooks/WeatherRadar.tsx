// @ts-nocheck — react-core's real useRenderToolCall signature is stricter
// than this demo's call shape. Fixture is only consumed by the scanner and
// the runtime stub bundler, neither of which uses the real types.
//
// Demonstrates V2 `useRenderToolCall` — renders a specific tool call as it
// streams. Fixture shows a live radar-loop tile for a "viewRadar" tool.
import { useRenderToolCall } from "@copilotkit/react-core/v2";
import { z } from "zod";

export function WeatherRadar() {
  useRenderToolCall({
    name: "viewRadar",
    parameters: z.object({
      region: z.string(),
      zoom: z.number().min(1).max(12).default(6),
    }),
    render: ({ parameters, status }) => (
      <div className="relative overflow-hidden rounded-2xl border border-cyan-400/20 bg-gradient-to-br from-slate-900 to-black p-5 text-white shadow-xl">
        <div className="absolute left-0 right-0 top-0 h-1 animate-pulse bg-gradient-to-r from-transparent via-cyan-400 to-transparent" />
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-widest text-cyan-300">
            <span className="inline-flex h-2 w-2 rounded-full bg-cyan-400 shadow-[0_0_10px_rgba(34,211,238,0.8)]" />
            Live radar
          </div>
          <span className="rounded-full border border-white/10 bg-black/40 px-2 py-0.5 text-[10px] uppercase tracking-wider text-white/70">
            zoom {parameters.zoom ?? 6}
          </span>
        </div>
        <h3 className="mt-2 text-xl font-semibold">
          {parameters.region ?? "—"}
        </h3>
        <div className="mt-4 grid grid-cols-12 grid-rows-6 gap-px rounded-md bg-black/60 p-0.5 font-mono text-[10px]">
          {Array.from({ length: 72 }).map((_, i) => {
            const intensity = (Math.sin(i / 3) + 1) / 2;
            return (
              <div
                key={i}
                className="h-3 rounded-[1px]"
                style={{
                  background: `rgba(56, ${Math.round(200 * intensity) + 30}, 255, ${0.18 + intensity * 0.5})`,
                }}
              />
            );
          })}
        </div>
        <div className="mt-3 flex items-center justify-between text-xs text-white/60">
          <span>Precip intensity (dBZ)</span>
          <span className="font-mono">{status}</span>
        </div>
      </div>
    ),
  });
  return null;
}

export default WeatherRadar;
