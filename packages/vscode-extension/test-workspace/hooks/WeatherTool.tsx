// @ts-nocheck — demo fixture; react-core types are stricter than the stubs need.
// V2 `useFrontendTool` for "getWeather" — same general idea as
// `CurrentWeatherTool` but presents the data as a "tool call" card with the
// classic pill-based stat layout. Kept as a separate tool so the model can
// pick the rendering style based on context (compact vs hero card).
import { useFrontendTool } from "@copilotkit/react-core/v2";
import { z } from "zod";
import {
  mockCurrentWeather,
  parseToolResult,
  type CurrentWeather,
} from "./shared/mock-weather";

export function WeatherTool() {
  useFrontendTool({
    name: "displayWeatherCompact",
    followUp: false,
    description:
      "Render a compact weather card for a city — useful inline in multi-tool replies. UI TOOL: gather data first (web search / knowledge), then pass `tempF` and `condition` along with the city.",
    parameters: z.object({
      city: z.string(),
      units: z.enum(["celsius", "fahrenheit"]).default("fahrenheit"),
      tempF: z.number().optional(),
      condition: z
        .enum([
          "sunny",
          "partly-cloudy",
          "cloudy",
          "rain",
          "thunderstorm",
          "snow",
          "windy",
        ])
        .optional(),
    }),
    handler: async ({ city, tempF, condition }) => {
      const base = mockCurrentWeather(city);
      return {
        ...base,
        ...(tempF !== undefined
          ? { tempF, tempC: Math.round(((tempF - 32) * 5) / 9) }
          : {}),
        ...(condition ? { condition } : {}),
      };
    },
    render: ({ args, result, status }) => {
      const data = parseToolResult<CurrentWeather>(result);
      const city = data?.city ?? args?.city ?? "Seattle";
      const units = args?.units ?? "fahrenheit";
      const tempF = data?.tempF ?? 0;
      const tempC = data?.tempC ?? 0;
      const display = units === "celsius" ? tempC : tempF;
      const unit = units === "celsius" ? "°C" : "°F";
      const conditionLabel = data?.conditionLabel ?? "Loading…";
      const conditionEmoji = data?.conditionEmoji ?? "🌧️";
      const humidity = data?.humidity ?? 0;
      const wind = data?.windMph ?? 0;
      return (
        <div className="flex items-stretch gap-4 overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-br from-slate-800 via-slate-900 to-black p-5 shadow-xl">
          <div className="flex w-32 flex-col items-center justify-center rounded-xl bg-gradient-to-b from-indigo-500/30 to-sky-500/10 p-3">
            <div className="text-5xl drop-shadow-md">{conditionEmoji}</div>
            <div className="mt-2 text-[10px] font-medium uppercase tracking-widest text-white/60">
              Tool call
            </div>
            <div className="font-mono text-[11px] text-sky-300">getWeather</div>
          </div>
          <div className="flex-1 text-white">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold">{city}</h3>
              <span
                className={
                  "rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider " +
                  (status === "complete"
                    ? "bg-emerald-400/20 text-emerald-200"
                    : "bg-amber-400/20 text-amber-200")
                }
              >
                {status}
              </span>
            </div>
            <div className="mt-2 flex items-end gap-2">
              <span className="text-5xl font-bold leading-none">{display}</span>
              <span className="pb-1 text-xl font-light text-white/70">
                {unit}
              </span>
            </div>
            <div className="mt-1 text-sm text-white/70">{conditionLabel}</div>
            <div className="mt-4 grid grid-cols-3 gap-2 border-t border-white/10 pt-3 text-center text-[11px] text-white/70">
              <div>
                <div className="font-semibold text-white">{humidity}%</div>
                Humidity
              </div>
              <div>
                <div className="font-semibold text-white">{wind} mph</div>
                Wind
              </div>
              <div>
                <div className="font-semibold text-white">
                  UV {data?.uvIndex ?? 0}
                </div>
                Index
              </div>
            </div>
          </div>
        </div>
      );
    },
  });
  return null;
}

export default WeatherTool;
