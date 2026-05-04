// @ts-nocheck — demo fixture; react-core types are stricter than the stubs need.
// V2 `useFrontendTool` for the hero "current weather" card.
//
// Design choice: tool name `displayCurrentWeather` (NOT `getCurrentWeather`).
// LLMs treat verbs like "get" / "fetch" / "lookup" as data-source semantics
// and will call them in a loop expecting fresh data each turn. By naming
// these as render verbs (display / show), the model treats the call as a
// one-shot UI side effect and stops looping.
//
// The handler accepts caller-supplied data (model passes what it knows
// from web search / its training) and fills any gaps with deterministic
// mock values so the card always lights up — useful in playground demos
// where the model may not have a fetchable source for live data.
import { useFrontendTool } from "@copilotkit/react-core/v2";
import { z } from "zod";
import {
  mockCurrentWeather,
  parseToolResult,
  type CurrentWeather,
} from "./shared/mock-weather";

export function CurrentWeatherTool() {
  useFrontendTool({
    name: "displayCurrentWeather",
    // Display-only: rendered card IS the answer, no follow-up turn needed.
    // See chat-source's `allDisplayOnly` short-circuit + the runtime's
    // `tool?.followUp !== false` check in run-handler.ts.
    followUp: false,
    description:
      "Render a UI card showing the current weather for a city — temperature, sky condition, humidity, wind, UV. THIS IS A UI TOOL: it does NOT fetch live weather data. Before calling, gather the actual weather data from a web search tool (e.g. fetch_webpage) or your training knowledge, then pass the values via the args. Calling this once renders the card; do not call it again for the same query — reply with a brief text summary instead.",
    parameters: z.object({
      city: z.string(),
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
      feelsLikeF: z.number().optional(),
      humidity: z.number().optional(),
      windMph: z.number().optional(),
      uvIndex: z.number().optional(),
    }),
    handler: async (args) => mergeWeatherArgs(args),
    render: ({ args, result, status }) => {
      const data =
        parseToolResult<CurrentWeather>(result) ?? mergeWeatherArgs(args);
      return (
        <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-sky-500 via-indigo-500 to-violet-700 p-6 text-white shadow-xl">
          <div className="absolute -right-10 -top-10 h-44 w-44 rounded-full bg-white/15 blur-3xl" />
          <div className="absolute -bottom-12 -left-8 h-32 w-32 rounded-full bg-white/10 blur-2xl" />
          <div className="relative flex items-start justify-between gap-6">
            <div className="flex-1">
              <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-white/70">
                Current weather
              </div>
              <h2 className="mt-1 text-3xl font-bold leading-none">
                {data.city}
              </h2>
              <div className="mt-1 text-sm text-white/80">
                {data.conditionLabel}
              </div>
              <div className="mt-5 flex items-end gap-2">
                <span className="text-6xl font-bold leading-none">
                  {data.tempF}
                </span>
                <span className="pb-1 text-2xl font-light text-white/80">
                  °F
                </span>
                <span className="ml-3 pb-1 text-sm text-white/60">
                  ({data.tempC}°C)
                </span>
              </div>
              <div className="mt-1 text-xs text-white/70">
                Feels like {data.feelsLikeF}°F
              </div>
            </div>
            <div className="flex flex-col items-end gap-2">
              <div className="text-7xl drop-shadow-lg">
                {data.conditionEmoji}
              </div>
              <span
                className={
                  "rounded-full px-2.5 py-1 text-[10px] font-medium uppercase tracking-wider " +
                  (status === "complete"
                    ? "bg-emerald-400/20 text-emerald-100"
                    : "bg-white/15 text-white/80")
                }
              >
                {status}
              </span>
            </div>
          </div>
          <div className="relative mt-6 grid grid-cols-3 gap-2 border-t border-white/15 pt-4 text-center text-xs text-white/85">
            <div>
              <div className="font-semibold text-white">{data.humidity}%</div>
              Humidity
            </div>
            <div>
              <div className="font-semibold text-white">{data.windMph} mph</div>
              Wind
            </div>
            <div>
              <div className="font-semibold text-white">UV {data.uvIndex}</div>
              Index
            </div>
          </div>
        </div>
      );
    },
  });
  return null;
}

/**
 * Merges caller-supplied fields over deterministic mock data for the city,
 * dropping `undefined`s on the overlay (so a missing field falls back to
 * the mock value rather than wiping it out). Returned both from the
 * handler (so the model sees the rendered values) and from the render
 * fallback (so the card looks right even before the tool message lands).
 */
function mergeWeatherArgs(
  args: Partial<CurrentWeather> | undefined,
): CurrentWeather {
  const base = mockCurrentWeather(args?.city ?? "—");
  const overlay = stripUndefined(args ?? {});
  const merged = { ...base, ...overlay } as CurrentWeather;
  // Keep °C in sync if only °F was overridden.
  if (overlay.tempF !== undefined && overlay.tempC === undefined) {
    merged.tempC = Math.round(((overlay.tempF - 32) * 5) / 9);
  }
  if (overlay.condition && !overlay.conditionLabel) {
    const label = base.conditionLabel; // base used the same condition mapping.
    merged.conditionLabel = label;
  }
  return merged;
}

function stripUndefined<T extends object>(o: T): Partial<T> {
  const out: Partial<T> = {};
  for (const k of Object.keys(o) as Array<keyof T>) {
    if (o[k] !== undefined) out[k] = o[k];
  }
  return out;
}

export default CurrentWeatherTool;
