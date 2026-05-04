// @ts-nocheck — demo fixture; react-core types are stricter than the stubs need.
// Demonstrates V2 `useFrontendTool` registered as a tool the model can call
// to fetch sunrise/sunset times for a city. The handler synthesizes plausible
// times deterministically (real apps would hit a sun-position API); the
// render parses the handler's result so the model doesn't need to know
// the actual ISO times — it only passes the city.
import { useFrontendTool } from "@copilotkit/react-core/v2";
import { z } from "zod";
import {
  mockSunTimes,
  parseToolResult,
  type SunTimes,
} from "./shared/mock-weather";

export function WeatherComponent() {
  useFrontendTool({
    name: "displaySunTimes",
    followUp: false,
    description:
      "Render a UI card with today's sunrise and sunset for a city. UI TOOL: this does NOT fetch real sun-position data. If the model knows the times for the date in question, it can pass them in `sunriseISO` / `sunsetISO`; otherwise the renderer fills in a deterministic placeholder so the card always lights up.",
    parameters: z.object({
      city: z.string().describe("City name, e.g. 'Reykjavík' or 'Tokyo'"),
      sunriseISO: z
        .string()
        .optional()
        .describe("ISO timestamp for today's sunrise, if known"),
      sunsetISO: z
        .string()
        .optional()
        .describe("ISO timestamp for today's sunset, if known"),
    }),
    handler: async ({ city, sunriseISO, sunsetISO }) => {
      const base = mockSunTimes(city);
      return {
        ...base,
        ...(sunriseISO ? { sunriseISO } : {}),
        ...(sunsetISO ? { sunsetISO } : {}),
      };
    },
    render: ({ args, result, status }) => {
      const data = parseToolResult<SunTimes>(result);
      const city = data?.city ?? args?.city ?? "Reykjavík";
      const format = (iso?: string): string => {
        if (!iso) return "--:--";
        try {
          return new Date(iso).toLocaleTimeString(undefined, {
            hour: "2-digit",
            minute: "2-digit",
          });
        } catch {
          return iso;
        }
      };
      const sunrise = format(data?.sunriseISO);
      const sunset = format(data?.sunsetISO);
      const daylight = data?.daylightLabel ?? "Daylight ~--h --m";
      return (
        <div className="relative overflow-hidden rounded-2xl border border-amber-400/30 bg-gradient-to-br from-amber-400 via-orange-500 to-rose-600 p-6 text-white shadow-xl">
          <div className="absolute -left-12 -top-12 h-32 w-32 rounded-full bg-yellow-200/40 blur-2xl" />
          <div className="absolute -bottom-12 -right-8 h-28 w-28 rounded-full bg-rose-400/40 blur-2xl" />
          <div className="relative">
            <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-white/80">
              Sun today · {city}
            </div>
            <div className="mt-4 flex items-center justify-between gap-6">
              <div className="flex-1">
                <div className="text-xs uppercase tracking-wider text-white/70">
                  Sunrise
                </div>
                <div className="mt-1 flex items-center gap-2">
                  <span className="text-3xl">🌅</span>
                  <span className="text-3xl font-bold">{sunrise}</span>
                </div>
              </div>
              <div className="h-16 w-px bg-white/30" />
              <div className="flex-1">
                <div className="text-xs uppercase tracking-wider text-white/70">
                  Sunset
                </div>
                <div className="mt-1 flex items-center gap-2">
                  <span className="text-3xl">🌇</span>
                  <span className="text-3xl font-bold">{sunset}</span>
                </div>
              </div>
            </div>
            <div className="mt-5 flex items-center justify-between text-[11px] text-white/80">
              <span className="inline-flex items-center gap-1.5">
                <span className="inline-block h-1.5 w-1.5 rounded-full bg-white" />
                {daylight}
              </span>
              <span className="rounded-full bg-black/20 px-2 py-0.5 uppercase tracking-wider">
                {status}
              </span>
            </div>
          </div>
        </div>
      );
    },
  });
  return null;
}

export default WeatherComponent;
