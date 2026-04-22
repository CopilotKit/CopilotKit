import { useCopilotAction } from "@copilotkit/react-core";

export function WeatherActions() {
  useCopilotAction({
    name: "addLocation",
    description: "Add a new city to the weather dashboard",
    parameters: [
      { name: "city", type: "string", required: true },
      { name: "country", type: "string", required: false },
    ],
    available: "frontend",
    render: ({ args, status }) => {
      const city = args?.city ?? "—";
      const country = args?.country ?? "Unknown";
      const tempF = 72;
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
                Partly cloudy · Feels like 74°F
              </div>
            </div>
            <div className="flex flex-col items-end gap-2">
              <div className="text-6xl drop-shadow-lg">⛅</div>
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
              <div className="font-semibold text-white">62%</div>Humidity
            </div>
            <div>
              <div className="font-semibold text-white">8 mph</div>Wind
            </div>
            <div>
              <div className="font-semibold text-white">UV 4</div>Index
            </div>
          </div>
        </div>
      );
    },
  });

  useCopilotAction({
    name: "removeLocation",
    description: "Remove a city from the dashboard",
    parameters: [{ name: "id", type: "string", required: true }],
    available: "frontend",
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
