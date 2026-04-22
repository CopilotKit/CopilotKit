import { useRenderTool } from "@copilotkit/react-core/v2";
import { z } from "zod";

export function WeatherTool() {
  useRenderTool({
    name: "getWeather",
    parameters: z.object({
      city: z.string(),
      units: z.enum(["celsius", "fahrenheit"]).default("fahrenheit"),
    }),
    render: ({ parameters, status }) => {
      const city = parameters.city ?? "Seattle";
      const units = parameters.units ?? "fahrenheit";
      const tempF = 58;
      const tempC = Math.round(((tempF - 32) * 5) / 9);
      const display = units === "celsius" ? tempC : tempF;
      const unit = units === "celsius" ? "°C" : "°F";
      return (
        <div className="flex items-stretch gap-4 overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-br from-slate-800 via-slate-900 to-black p-5 shadow-xl">
          <div className="flex w-32 flex-col items-center justify-center rounded-xl bg-gradient-to-b from-indigo-500/30 to-sky-500/10 p-3">
            <div className="text-5xl drop-shadow-md">🌧️</div>
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
            <div className="mt-1 text-sm text-white/70">
              Light rain · 54{unit} low / 61{unit} high
            </div>
            <div className="mt-4 grid grid-cols-3 gap-2 border-t border-white/10 pt-3 text-center text-[11px] text-white/70">
              <div>
                <div className="font-semibold text-white">88%</div>
                Humidity
              </div>
              <div>
                <div className="font-semibold text-white">11 mph</div>
                Wind
              </div>
              <div>
                <div className="font-semibold text-white">1.2&quot;</div>
                Rain (24h)
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
