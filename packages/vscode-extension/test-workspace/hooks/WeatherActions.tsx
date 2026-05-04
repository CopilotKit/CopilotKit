// @ts-nocheck — demo fixture; react-core types are stricter than the stubs need.
// V2 conversion of `addLocation` / `removeLocation` — the previous v1
// `useCopilotAction` registrations are now `useFrontendTool` so the model's
// tool-call surface matches the rest of the v2 fixtures.
import { useFrontendTool } from "@copilotkit/react-core/v2";
import { z } from "zod";
import {
  mockCurrentWeather,
  parseToolResult,
  type CurrentWeather,
} from "./shared/mock-weather";

export function WeatherActions() {
  useFrontendTool({
    name: "addLocation",
    description:
      "Add a city to the user's saved weather dashboard. Returns the current conditions for the freshly-added location so the model can confirm what it just pinned.",
    parameters: z.object({
      city: z.string(),
      country: z.string().optional(),
    }),
    handler: async ({ city, country }) => ({
      ...mockCurrentWeather(city),
      country: country ?? "Unknown",
    }),
    render: ({ args, result, status }) => {
      const data = parseToolResult<CurrentWeather & { country?: string }>(
        result,
      );
      const city = data?.city ?? args?.city ?? "—";
      const country = data?.country ?? args?.country ?? "Unknown";
      const tempF = data?.tempF ?? 0;
      const condition = data?.conditionLabel ?? "Loading…";
      const conditionEmoji = data?.conditionEmoji ?? "⛅";
      const humidity = data?.humidity ?? 0;
      const wind = data?.windMph ?? 0;
      const uv = data?.uvIndex ?? 0;
      const feelsLike = data?.feelsLikeF ?? tempF;
      return (
        <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-sky-500 to-indigo-700 p-6 text-white shadow-xl">
          <div className="absolute -right-8 -top-8 h-40 w-40 rounded-full bg-white/15 blur-2xl" />
          <div className="relative flex items-start justify-between gap-6">
            <div>
              <div className="text-xs font-medium uppercase tracking-widest text-white/70">
                Now in
              </div>
              <h2 className="mt-1 text-3xl font-semibold leading-none">
                {city}
              </h2>
              <div className="mt-1 text-sm text-white/80">{country}</div>
              <div className="mt-4 flex items-end gap-2">
                <span className="text-6xl font-bold leading-none">{tempF}</span>
                <span className="pb-1 text-2xl font-light text-white/80">
                  °F
                </span>
              </div>
              <div className="mt-1 text-sm text-white/75">
                {condition} · Feels like {feelsLike}°F
              </div>
            </div>
            <div className="flex flex-col items-end gap-2">
              <div className="text-6xl drop-shadow-lg">{conditionEmoji}</div>
              <span
                className={
                  "rounded-full px-2.5 py-1 text-[10px] font-medium uppercase tracking-wider " +
                  (status === "complete"
                    ? "bg-emerald-400/20 text-emerald-200"
                    : "bg-white/15 text-white/80")
                }
              >
                {status}
              </span>
            </div>
          </div>
          <div className="relative mt-6 grid grid-cols-3 gap-2 border-t border-white/15 pt-4 text-center text-xs text-white/80">
            <div>
              <div className="font-semibold text-white">{humidity}%</div>
              Humidity
            </div>
            <div>
              <div className="font-semibold text-white">{wind} mph</div>Wind
            </div>
            <div>
              <div className="font-semibold text-white">UV {uv}</div>Index
            </div>
          </div>
        </div>
      );
    },
  });

  useFrontendTool({
    name: "removeLocation",
    description:
      "Remove a saved city from the user's weather dashboard by its identifier.",
    parameters: z.object({
      id: z.string().describe("Identifier of the saved location to remove"),
    }),
    handler: async ({ id }) => ({ removed: id }),
    render: ({ args }) => (
      <div className="flex items-center gap-3 rounded-xl border border-red-400/30 bg-red-500/10 px-4 py-3 text-red-200">
        <span className="text-xl">✕</span>
        <div className="flex-1">
          <div className="text-sm font-semibold text-red-100">
            Location removed
          </div>
          <div className="text-xs text-red-200/70">
            <code className="rounded bg-black/30 px-1.5 py-0.5 font-mono text-[11px]">
              {args?.id ?? "(no id)"}
            </code>
          </div>
        </div>
      </div>
    ),
  });
  return null;
}

export default WeatherActions;
