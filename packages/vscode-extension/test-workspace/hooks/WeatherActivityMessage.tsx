// @ts-nocheck — react-core's real useRenderActivityMessage signature differs
// from this demo's call shape. Fixture is only consumed by the scanner and
// the runtime stub bundler, neither of which uses the real types.
//
// Demonstrates V2 `useRenderActivityMessage` — renders the inline "assistant
// is doing X" activity indicator. Fixture is a weather-themed loading row
// with a spinning radar glyph and a cycling action label.
import { useRenderActivityMessage } from "@copilotkit/react-core/v2";

export function WeatherActivityMessage() {
  useRenderActivityMessage({
    render: (message) => {
      const m = (message ?? {}) as { content?: string };
      const label = m.content ?? "Fetching forecast…";
      return (
        <div className="inline-flex items-center gap-3 rounded-full border border-white/10 bg-gradient-to-r from-sky-500/10 via-white/[0.02] to-indigo-500/10 px-4 py-2 shadow-sm">
          <span className="relative inline-flex h-4 w-4 items-center justify-center">
            <span className="absolute inset-0 animate-spin rounded-full border-2 border-sky-400/30 border-t-sky-400" />
            <span className="text-[9px]">📡</span>
          </span>
          <span className="text-xs font-medium text-white/80">{label}</span>
          <span className="inline-flex gap-0.5">
            <span className="h-1 w-1 animate-bounce rounded-full bg-sky-400 [animation-delay:0ms]" />
            <span className="h-1 w-1 animate-bounce rounded-full bg-sky-400 [animation-delay:120ms]" />
            <span className="h-1 w-1 animate-bounce rounded-full bg-sky-400 [animation-delay:240ms]" />
          </span>
        </div>
      );
    },
  });
  return null;
}

export default WeatherActivityMessage;
