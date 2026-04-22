// @ts-nocheck — demo fixture; react-core types are stricter than the stubs need.
// Demonstrates V2 `useComponent` — convenience wrapper over useFrontendTool
// that registers a typed React component as the renderer for a tool call.
// Fixture is a "sunrise/sunset" card driven by a zod-typed schema.
import { useComponent } from "@copilotkit/react-core/v2";
import { z } from "zod";

export function WeatherComponent() {
  useComponent({
    name: "sunTimes",
    description: "Displays today's sunrise and sunset for a city",
    parameters: z.object({
      city: z.string(),
      sunriseISO: z.string(),
      sunsetISO: z.string(),
    }),
    // Keep the same render signature as the other render-tool fixtures so the
    // preview harness can drive it through the shared ActionControls form.
    render: ({ parameters, status }) => {
      const city = parameters.city ?? "Reykjavík";
      const format = (iso?: string) => {
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
      const sunrise = format(parameters.sunriseISO);
      const sunset = format(parameters.sunsetISO);
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
                Daylight ~14h 12m
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
