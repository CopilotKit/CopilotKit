// @ts-nocheck — demo fixture; react-core types are stricter than the stubs need.
// Demonstrates V2 `useFrontendTool` — a frontend-registered tool the agent
// can call and whose render is controlled by the client. Fixture shows a
// precipitation gauge with an animated arc.
import { useFrontendTool } from "@copilotkit/react-core/v2";
import { z } from "zod";

export function PrecipGaugeFrontendTool() {
  useFrontendTool({
    name: "precipitationGauge",
    description: "Displays the current precipitation intensity as a gauge",
    parameters: z.object({
      inchesPerHour: z.number().min(0).max(5),
      rainType: z.enum(["drizzle", "rain", "heavy", "storm"]).default("rain"),
    }),
    render: ({ parameters, status }) => {
      const inches = Math.min(5, Math.max(0, parameters.inchesPerHour ?? 0.3));
      const pct = (inches / 5) * 100;
      // Semicircle: 180° arc, use conic-gradient hack for the fill.
      return (
        <div className="overflow-hidden rounded-2xl border border-sky-400/20 bg-gradient-to-b from-sky-950/40 to-black p-5 text-white shadow-xl">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-widest text-sky-300/80">
                Frontend tool · precipitation
              </div>
              <h3 className="mt-1 text-lg font-semibold capitalize">
                {parameters.rainType ?? "rain"}
              </h3>
            </div>
            <span className="rounded-full border border-white/10 bg-black/40 px-2 py-0.5 text-[10px] uppercase tracking-wider text-white/70">
              {status}
            </span>
          </div>
          <div className="mt-6 flex items-center justify-center">
            <div className="relative h-28 w-56 overflow-hidden">
              <div
                className="absolute inset-0 rounded-t-full"
                style={{
                  background:
                    "conic-gradient(from 270deg, rgba(56,189,248,0.9) 0turn, rgba(56,189,248,0.9) " +
                    pct / 200 +
                    "turn, rgba(255,255,255,0.08) " +
                    pct / 200 +
                    "turn, rgba(255,255,255,0.08) 0.5turn, transparent 0.5turn)",
                }}
              />
              <div className="absolute inset-2 rounded-t-full bg-black" />
              <div className="absolute inset-x-0 bottom-2 text-center">
                <div className="text-3xl font-bold text-white">
                  {inches.toFixed(2)}
                </div>
                <div className="text-[11px] text-white/60">in/h</div>
              </div>
            </div>
          </div>
          <div className="mt-4 flex justify-between text-[10px] font-medium uppercase tracking-wider text-white/40">
            <span>0</span>
            <span>moderate</span>
            <span>5</span>
          </div>
        </div>
      );
    },
  });
  return null;
}

export default PrecipGaugeFrontendTool;
