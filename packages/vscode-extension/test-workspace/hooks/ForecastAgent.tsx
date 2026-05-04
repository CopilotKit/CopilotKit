// @ts-nocheck — demo fixture; react-core types are stricter than the stubs need.
// V2 conversion of the previous v1 `useCoAgentStateRender` — the playground
// has no real co-agent backing it, so we expose a multi-day forecast as a
// proper `useFrontendTool` with mock data instead. The model can call this
// directly when the user asks for a 5-day forecast for a city.
import { useFrontendTool } from "@copilotkit/react-core/v2";
import { z } from "zod";
import {
  mockForecast,
  parseToolResult,
  type Forecast,
} from "./shared/mock-weather";

export function ForecastAgent() {
  useFrontendTool({
    name: "displayForecast",
    followUp: false,
    description:
      "Render a multi-day forecast strip for a city (up to 7 days). UI TOOL — does not fetch real forecast data. Pass real values via `days` if you have them; otherwise just the city to use a deterministic placeholder.",
    parameters: z.object({
      city: z.string(),
      days: z.number().int().min(1).max(7).default(5),
    }),
    handler: async ({ city, days }) => mockForecast(city, days ?? 5),
    render: ({ args, result, status }) => {
      const data = parseToolResult<Forecast>(result);
      const city = data?.city ?? args?.city ?? "San Francisco";
      const days = data?.days ?? [
        { day: "Mon", high: 72, low: 58, icon: "☀️", condition: "sunny" },
        {
          day: "Tue",
          high: 69,
          low: 56,
          icon: "⛅",
          condition: "partly-cloudy",
        },
        { day: "Wed", high: 66, low: 55, icon: "🌧️", condition: "rain" },
        {
          day: "Thu",
          high: 68,
          low: 57,
          icon: "⛅",
          condition: "partly-cloudy",
        },
        { day: "Fri", high: 74, low: 60, icon: "☀️", condition: "sunny" },
      ];
      return (
        <div className="overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-b from-slate-800 to-slate-900 p-6 shadow-xl">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-xs font-medium uppercase tracking-widest text-sky-300/80">
                {days.length}-day forecast
              </div>
              <h3 className="mt-1 text-2xl font-semibold text-white">{city}</h3>
            </div>
            <span
              className={
                "inline-flex items-center gap-2 rounded-full px-3 py-1 text-[11px] font-medium uppercase tracking-wider " +
                (status === "complete"
                  ? "bg-emerald-500/15 text-emerald-300"
                  : "bg-sky-500/15 text-sky-300")
              }
            >
              <span
                className={
                  "h-1.5 w-1.5 rounded-full " +
                  (status === "complete"
                    ? "bg-emerald-400"
                    : "animate-pulse bg-sky-400")
                }
              />
              {status === "complete" ? "Ready" : "Streaming…"}
            </span>
          </div>
          <div
            className="mt-6 grid gap-2"
            style={{
              gridTemplateColumns: `repeat(${days.length}, minmax(0, 1fr))`,
            }}
          >
            {days.map((d) => (
              <div
                key={d.day}
                className="flex flex-col items-center gap-1 rounded-xl border border-white/5 bg-white/[0.03] px-2 py-3 text-center"
              >
                <div className="text-[11px] font-semibold uppercase tracking-wider text-white/60">
                  {d.day}
                </div>
                <div className="text-2xl">{d.icon ?? "⛅"}</div>
                <div className="flex items-baseline gap-1 text-xs">
                  <span className="font-semibold text-white">{d.high}°</span>
                  <span className="text-white/40">{d.low}°</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      );
    },
  });
  return null;
}

export default ForecastAgent;
