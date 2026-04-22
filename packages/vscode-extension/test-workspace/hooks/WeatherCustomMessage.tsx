// @ts-nocheck — react-core's real useRenderCustomMessages signature differs
// from this demo's call shape. Fixture is only consumed by the scanner and
// the runtime stub bundler, neither of which uses the real types.
//
// Demonstrates V2 `useRenderCustomMessages` — renders a chat message with
// custom UI. Fixture wraps an assistant message in a "Today's weather" card
// complete with current conditions + a witty one-liner.
import { useRenderCustomMessages } from "@copilotkit/react-core/v2";

export function WeatherCustomMessage() {
  useRenderCustomMessages({
    render: (message) => {
      const m = (message ?? {}) as { role?: string; content?: string };
      const role = m.role ?? "assistant";
      const content = m.content ?? "Sunny with a chance of meatballs.";
      return (
        <div className="flex gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-sky-400 to-indigo-500 text-white shadow-md">
            ☁️
          </div>
          <div className="flex-1 rounded-2xl rounded-tl-sm border border-white/10 bg-white/[0.04] p-4">
            <div className="flex items-center gap-2 text-[11px] uppercase tracking-wider text-white/50">
              <span>{role}</span>
              <span className="text-white/30">·</span>
              <span className="rounded-full bg-sky-500/15 px-2 py-0.5 text-[10px] font-semibold text-sky-300">
                Weather card
              </span>
            </div>
            <p className="mt-2 text-sm leading-relaxed text-white/90">
              {content}
            </p>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {[
                { k: "Temp", v: "72°F" },
                { k: "Wind", v: "8 mph" },
                { k: "Precip", v: "0%" },
                { k: "UV", v: "4" },
              ].map(({ k, v }) => (
                <span
                  key={k}
                  className="rounded-md border border-white/5 bg-black/30 px-2 py-0.5 text-[11px] text-white/80"
                >
                  <span className="text-white/40">{k}</span>{" "}
                  <span className="font-semibold text-white">{v}</span>
                </span>
              ))}
            </div>
          </div>
        </div>
      );
    },
  });
  return null;
}

export default WeatherCustomMessage;
