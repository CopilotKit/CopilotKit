import { useCoAgentStateRender } from "@copilotkit/react-core";

export function ForecastAgent() {
  useCoAgentStateRender({
    name: "forecast_agent",
    render: ({ state, status }) => {
      const s = (state ?? {}) as {
        city?: string;
        days?: Array<{
          day: string;
          high: number;
          low: number;
          icon?: string;
        }>;
      };
      const city = s.city ?? "San Francisco";
      const days = s.days?.length
        ? s.days
        : [
            { day: "Mon", high: 72, low: 58, icon: "☀️" },
            { day: "Tue", high: 69, low: 56, icon: "⛅" },
            { day: "Wed", high: 66, low: 55, icon: "🌧️" },
            { day: "Thu", high: 68, low: 57, icon: "⛅" },
            { day: "Fri", high: 74, low: 60, icon: "☀️" },
          ];
      return (
        <div className="overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-b from-slate-800 to-slate-900 p-6 shadow-xl">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-xs font-medium uppercase tracking-widest text-sky-300/80">
                5-day forecast
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
          <div className="mt-6 grid grid-cols-5 gap-2">
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
